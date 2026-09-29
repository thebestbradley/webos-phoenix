// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Opening a file another app handed over (Videos, PDF View, Doc View,
// Podcasts' OPML import), and finding files of a type on the device.
//
// How files arrive, as legacy webOS apps sent them:
//   Files          launch {id, params: {target: "/media/internal/..."}}
//   Email          getResourceInfo {uri: "file:///...", mime}, then open
//                  {id: appIdByExtension, params: {target: "file:///...",
//                  mimeType, fileName}} (core-apps com.palm.app.email
//                  controls/AttachmentsDrawer.js)
//   The browser    open {target: "/media/internal/downloads/x.pdf"} for a
//                  finished download (isis-browser BrowserApp.js
//                  openDownloadedFile); open {target: "http://..."} for a
//                  link the application manager sends to the handler
//   Photos         {imageList: {results: [{file_path, uri}]}} (OSE camera)

import { fileManager, joinPath, kindOf, type FileEntry, type FileKind } from "./files";
import { httpBytes, fromBase64 } from "./web";

export interface OpenParams {
    target?: string;
    mimeType?: string;
    fileName?: string;
    imageList?: { results?: { file_path?: string; uri?: string }[] };
    [key: string]: unknown;
}

/**
 * The file (an absolute path) or web address (http/https) a launch asks to
 * open, or null. "file://" and "storage://" uris become paths.
 */
export function openTarget(p: OpenParams | null | undefined): string | null {
    if (!p) return null;
    const first = p.imageList?.results?.[0];
    const raw = p.target ?? first?.file_path ?? first?.uri;
    if (typeof raw !== "string" || !raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    let path = raw.replace(/^storage:\/\//, "").replace(/^file:\/\//, "");
    try { path = decodeURIComponent(path); } catch { /* keep as is */ }
    return path.startsWith("/") ? joinPath(path) : null;
}

export function isWebAddress(target: string): boolean {
    return /^https?:\/\//i.test(target);
}

/** The name to show for a target ("Report.pdf"). */
export function targetName(target: string, fileName?: string): string {
    if (fileName) return fileName;
    const clean = target.replace(/[?#].*$/, "").replace(/\/+$/, "");
    let name = clean.replace(/^.*\//, "");
    try { name = decodeURIComponent(name); } catch { /* keep */ }
    return name || target;
}

/** Largest file the viewers read into memory. */
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

/** The bytes of a file (through org.webosphoenix.filemanager) or a web address. */
export async function readTarget(target: string): Promise<Uint8Array> {
    if (isWebAddress(target)) return httpBytes(target);
    return fromBase64(await fileManager.readBase64(target, MAX_DOCUMENT_BYTES));
}

/** The text of a file or web address (UTF-8). */
export async function readTargetText(target: string): Promise<string> {
    return new TextDecoder("utf-8").decode(await readTarget(target));
}

export interface FoundFile extends FileEntry {
    kind: FileKind;
}

/**
 * Files under `root` (folders `depth` deep) whose extension is one of
 * `extensions`, newest first. Hidden folders are skipped. For the viewers'
 * libraries; the media indexer does not index documents.
 */
export async function findFiles(extensions: string[], root = "/media/internal", depth = 4): Promise<FoundFile[]> {
    const want = new Set(extensions.map((e) => e.toLowerCase()));
    const out: FoundFile[] = [];
    const walk = async (dir: string, left: number) => {
        let entries: FileEntry[];
        try { entries = await fileManager.list(dir); } catch { return; }
        const subdirs: string[] = [];
        for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            if (e.type === "directory") { if (left > 0) subdirs.push(e.path); continue; }
            const ext = /\.([^./]+)$/.exec(e.name)?.[1]?.toLowerCase() ?? "";
            if (want.has(ext)) out.push({ ...e, kind: kindOf(e) });
        }
        await Promise.all(subdirs.map((d) => walk(d, left - 1)));
    };
    await walk(root, depth);
    // One file shown once, even if a folder is reached twice.
    const seen = new Set<string>();
    return out.filter((f) => !seen.has(f.path) && !!seen.add(f.path)).sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
}
