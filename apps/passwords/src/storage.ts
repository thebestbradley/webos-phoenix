// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where databases live: .kdbx files under /media/internal (the folder
// Files shows and USB mass storage exposes, so the same file can be synced
// with KeePassXC or KeePassDX), read and written through Files' Luna
// service (org.webosphoenix.filemanager).
//
// Saving is "safe": the new bytes go to NAME.kdbx.tmp, which is then moved
// over NAME.kdbx, so a crash mid-write never leaves half a database. If the
// file changed since it was opened (a sync, or another app), the caller
// merges before saving (see App.tsx save()).
//
// Only non-secret things go to localStorage: the preferences and the
// paths of recently opened databases. Never a password, never an entry.

import { fileManager, joinPath, MEDIA_ROOT, type FileEntry } from "@phoenix/luna";
import { fromBase64, toBase64 } from "@phoenix/secrets";

export const DB_DIR = MEDIA_ROOT + "/passwords";
/** Folders the Open dialog looks in for .kdbx files. */
export const SEARCH_DIRS = [DB_DIR, MEDIA_ROOT + "/Documents", MEDIA_ROOT + "/Downloads", MEDIA_ROOT];
export const MAX_DB_BYTES = 16 * 1024 * 1024;

export interface FileStamp {
    size: number;
    mtime: number;
}

export function isKdbx(name: string): boolean {
    return /\.kdbx$/i.test(name);
}

/** A file name for a new database ("Personal" -> "Personal.kdbx"), or null if the name cannot be used. */
export function fileNameFor(name: string): string | null {
    const base = name.trim().replace(/\.kdbx$/i, "");
    if (!base || base.length > 80 || /[\/\\:*?"<>|\0]/.test(base) || base.startsWith(".")) return null;
    return base + ".kdbx";
}

export function dbName(path: string): string {
    return path.replace(/^.*\//, "").replace(/\.kdbx$/i, "");
}

async function exists(path: string): Promise<FileEntry | null> {
    try {
        return await fileManager.stat(path);
    } catch {
        return null;
    }
}

export async function ensureDbDir(): Promise<void> {
    if (!(await exists(DB_DIR))) await fileManager.mkdir(DB_DIR);
}

/** The .kdbx files in the usual folders, newest first. */
export async function findDatabases(): Promise<FileEntry[]> {
    const seen = new Map<string, FileEntry>();
    for (const dir of SEARCH_DIRS) {
        let entries: FileEntry[] = [];
        try { entries = await fileManager.list(dir); } catch { continue; }
        for (const e of entries) if (e.type === "file" && isKdbx(e.name)) seen.set(e.path, e);
    }
    return [...seen.values()].sort((a, b) => b.mtime - a.mtime);
}

export async function stampOf(path: string): Promise<FileStamp | null> {
    const e = await exists(path);
    return e ? { size: e.size, mtime: e.mtime } : null;
}

export function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
    return !!a && !!b && a.size === b.size && a.mtime === b.mtime;
}

export async function readDatabase(path: string): Promise<{ data: ArrayBuffer; stamp: FileStamp }> {
    const stamp = await stampOf(path);
    if (!stamp) throw new Error("The database file is gone: " + path);
    if (stamp.size > MAX_DB_BYTES) throw new Error("The database file is too large");
    const bytes = fromBase64(await fileManager.readBase64(path, MAX_DB_BYTES));
    return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, stamp: (await stampOf(path)) ?? stamp };
}

/** Write a database safely (temporary file, then move over). Returns the file's new stamp. */
export async function writeDatabase(path: string, data: ArrayBuffer, newFile = false): Promise<FileStamp> {
    const tmp = path + ".tmp";
    if (newFile && (await exists(path))) throw new Error("A database with that name already exists");
    await fileManager.writeBase64(tmp, toBase64(new Uint8Array(data)), true);
    await fileManager.move(tmp, path, true);
    const stamp = await stampOf(path);
    if (!stamp) throw new Error("The database was not saved");
    return stamp;
}

export function newDatabasePath(fileName: string): string {
    return joinPath(DB_DIR, fileName);
}

// ---- Preferences and recent files (not secret) ------------------------------------------

export interface Prefs {
    /** Clear the clipboard after this many seconds. */
    clipboardSeconds: number;
    /** Lock after this many seconds without a touch (0: never). */
    idleSeconds: number;
    /** Lock this many seconds after the card is minimized (0: at once; -1: never). */
    hiddenSeconds: number;
}

export const DEFAULT_PREFS: Prefs = { clipboardSeconds: 30, idleSeconds: 300, hiddenSeconds: 0 };
const PREFS_KEY = "phoenix:org.webosphoenix.passwords:prefs";
const RECENT_KEY = "phoenix:org.webosphoenix.passwords:recent";

export function loadPrefs(): Prefs {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
        const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
        return {
            clipboardSeconds: num(p.clipboardSeconds, DEFAULT_PREFS.clipboardSeconds),
            idleSeconds: num(p.idleSeconds, DEFAULT_PREFS.idleSeconds),
            hiddenSeconds: num(p.hiddenSeconds, DEFAULT_PREFS.hiddenSeconds),
        };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export function savePrefs(p: Prefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* full or unavailable */ }
}

/** Recently opened database paths, most recent first. */
export function loadRecent(): string[] {
    try {
        const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string" && isKdbx(x)).slice(0, 8) : [];
    } catch {
        return [];
    }
}

export function rememberRecent(path: string): void {
    const r = [path, ...loadRecent().filter((p) => p !== path)].slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

export function forgetRecent(path: string): void {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((p) => p !== path))); } catch { /* ignore */ }
}
