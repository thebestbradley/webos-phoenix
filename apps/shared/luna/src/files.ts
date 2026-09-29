// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Files app's services:
//
//   org.webosphoenix.filemanager   Phoenix: list, stat, mkdir, copy, move,
//       remove, read and write anywhere in the filesystem (read-only where
//       the system is). On a device it is the Node.js service in
//       apps/files/service; the simulator backs it with a virtual
//       filesystem (runtime/phoenix-runtime.js, block "File manager").
//   com.palm.appinstaller          legacy webOS: installNoVerify {target,
//       subscribe} installs an .ipk and reports {ticket, status} until
//       SUCCESS or FAILED_*, as the Preware-era file managers called it
//   com.webos.applicationManager   listAllHandlersForMime {mime} and open
//       {target} / launch {id, params: {target}} for "Open with"
//
// Every reply is webOS style: returnValue, and errorCode / errorText when
// it is false (FILE_ERRORS lists the codes).

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

/** errorCode values of org.webosphoenix.filemanager (errno names in brackets). */
export const FILE_ERRORS = {
    /** Missing or bad parameter. */
    BAD_PARAMS: -1,
    /** [ENOENT] No such file or directory. */
    NOT_FOUND: 1,
    /** [EEXIST] The target exists. */
    EXISTS: 2,
    /** [EACCES, EROFS] Read-only or not permitted. */
    PERMISSION: 3,
    /** [ENOTDIR] A path component is not a folder. */
    NOT_DIR: 4,
    /** [EISDIR] A folder where a file was expected. */
    IS_DIR: 5,
    /** [ENOTEMPTY] Folder not empty (remove without recursive). */
    NOT_EMPTY: 6,
    /** The file is bigger than maxBytes (read) or the store allows (write). */
    TOO_LARGE: 7,
    /** [EINVAL] E.g. copying a folder into itself. */
    INVALID: 8,
    /** Anything else. */
    IO: 9,
} as const;

export type FileType = "file" | "directory";

/** One file or folder, as list and stat return it. */
export interface FileEntry {
    name: string;
    /** Absolute path. */
    path: string;
    type: FileType;
    /** Bytes (files; folders report 0). */
    size: number;
    /** Last modified, ms since the epoch. */
    mtime: number;
    /** Unix mode bits (permissions only: 0o755, 0o644, ...). */
    mode: number;
    /** The caller may not change it (system files, read-only mounts). */
    readOnly?: boolean;
    /** A symbolic link (the rest describes its target). */
    link?: boolean;
    /** Folders: how many entries (stat only). */
    count?: number;
}

export type FileEncoding = "utf8" | "base64";

/** installNoVerify progress (legacy appinstaller status strings). */
export interface InstallStatus {
    ticket?: number;
    status: "STARTING" | "IPKG_INSTALL" | "SUCCESS" | string;
    details?: { reason?: string; [key: string]: unknown };
}

export interface MimeHandler {
    appId: string;
    title?: string;
    mime?: string;
}

declare module "./types" {
    interface LunaApi {
        "luna://org.webosphoenix.filemanager/list": { params: { path: string }; result: { path: string; entries: FileEntry[] } };
        "luna://org.webosphoenix.filemanager/stat": { params: { path: string }; result: { entry: FileEntry } };
        "luna://org.webosphoenix.filemanager/mkdir": { params: { path: string }; result: { path: string } };
        "luna://org.webosphoenix.filemanager/copy": { params: { from: string; to: string; overwrite?: boolean }; result: { path: string } };
        "luna://org.webosphoenix.filemanager/move": { params: { from: string; to: string; overwrite?: boolean }; result: { path: string } };
        "luna://org.webosphoenix.filemanager/remove": { params: { path: string; recursive?: boolean }; result: { path: string } };
        "luna://org.webosphoenix.filemanager/read": {
            params: { path: string; encoding?: FileEncoding; maxBytes?: number };
            result: { path: string; data: string; encoding: FileEncoding; size: number };
        };
        "luna://org.webosphoenix.filemanager/write": {
            params: { path: string; data: string; encoding?: FileEncoding; overwrite?: boolean };
            result: { path: string; size: number };
        };
        "luna://com.palm.appinstaller/installNoVerify": { params: { target: string; subscribe?: boolean }; result: InstallStatus };
        "luna://com.webos.applicationManager/listAllHandlersForMime": { params: { mime: string }; result: { resources?: MimeHandler[] } };
        "luna://com.webos.applicationManager/open": { params: { target: string; id?: string }; result: Record<string, unknown> };
    }
}

const FM = "luna://org.webosphoenix.filemanager";

// ---- org.webosphoenix.filemanager ------------------------------------------------------

export const fileManager = {
    /** list {path}: the folder's entries, unsorted, hidden ones included. */
    async list(path: string): Promise<FileEntry[]> {
        return (await call(`${FM}/list`, { path })).entries;
    },
    /** stat {path} */
    async stat(path: string): Promise<FileEntry> {
        return (await call(`${FM}/stat`, { path })).entry;
    },
    /** mkdir {path}: one new folder (its parent must exist). */
    mkdir(path: string) {
        return call(`${FM}/mkdir`, { path });
    },
    /** copy {from, to}: a file or a whole folder. Fails with EXISTS unless overwrite. */
    copy(from: string, to: string, overwrite = false) {
        return call(`${FM}/copy`, { from, to, overwrite });
    },
    /** move {from, to}: rename or move. */
    move(from: string, to: string, overwrite = false) {
        return call(`${FM}/move`, { from, to, overwrite });
    },
    /** remove {path, recursive}: a folder needs recursive unless it is empty. */
    remove(path: string, recursive = true) {
        return call(`${FM}/remove`, { path, recursive });
    },
    /** read {path, encoding: "utf8"} */
    async readText(path: string, maxBytes?: number): Promise<string> {
        return (await call(`${FM}/read`, { path, encoding: "utf8", ...(maxBytes ? { maxBytes } : {}) })).data;
    },
    /** read {path, encoding: "base64"} */
    async readBase64(path: string, maxBytes?: number): Promise<string> {
        return (await call(`${FM}/read`, { path, encoding: "base64", ...(maxBytes ? { maxBytes } : {}) })).data;
    },
    /** write {path, data, encoding: "utf8"}. overwrite false: fail if it exists (a new file). */
    writeText(path: string, text: string, overwrite = true) {
        return call(`${FM}/write`, { path, data: text, encoding: "utf8", overwrite });
    },
    /** write {path, data, encoding: "base64"} */
    writeBase64(path: string, data: string, overwrite = true) {
        return call(`${FM}/write`, { path, data, encoding: "base64", overwrite });
    },
};

// ---- com.palm.appinstaller (legacy) ----------------------------------------------------

export const appInstaller = {
    /**
     * installNoVerify {target, subscribe}: install an .ipk. onStatus gets
     * every progress reply; the promise settles on SUCCESS or a FAILED_*
     * status (or an error reply).
     */
    install(target: string, onStatus?: (s: InstallStatus) => void): Promise<InstallStatus> {
        return new Promise((resolve, reject) => {
            const sub: Subscription = subscribe("luna://com.palm.appinstaller/installNoVerify", { target }, (r) => {
                onStatus?.(r);
                if (r.status === "SUCCESS") { sub.cancel(); resolve(r); }
                else if (/^FAILED/.test(r.status ?? "")) { sub.cancel(); reject(new Error(r.details?.reason ?? r.status)); }
            }, (e: LunaError) => { sub.cancel(); reject(e); });
        });
    },
};

// ---- Opening files with other apps --------------------------------------------------------

export const openWith = {
    /** listAllHandlersForMime {mime}: apps that say they open this type. */
    async handlers(mime: string): Promise<MimeHandler[]> {
        try {
            return (await call("luna://com.webos.applicationManager/listAllHandlersForMime", { mime })).resources ?? [];
        } catch {
            return [];
        }
    },
    /** launch {id, params: {target}}: open the file in that app. */
    launch(appId: string, path: string) {
        return call("luna://com.webos.applicationManager/launch", { id: appId, params: { target: path } });
    },
    /** open {target}: let the application manager pick the app by MIME type. */
    open(path: string) {
        return call("luna://com.webos.applicationManager/open", { target: fileUri(path) });
    },
};

// ---- Paths --------------------------------------------------------------------------

/** "file:///media/internal/a.txt" */
export function fileUri(path: string): string {
    return "file://" + path.split("/").map(encodeURIComponent).join("/");
}

/** Join and normalise ("/a/b/../c" -> "/a/c"). */
export function joinPath(...parts: string[]): string {
    const out: string[] = [];
    for (const seg of parts.join("/").split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") out.pop();
        else out.push(seg);
    }
    return "/" + out.join("/");
}

/** The folder a path is in ("/" for "/" itself). */
export function parentOf(path: string): string {
    return joinPath(path, "..");
}

export function baseName(path: string): string {
    return path.replace(/\/+$/, "").replace(/^.*\//, "");
}

/** Lower-case extension without the dot ("" if none; dot files have none). */
export function extensionOf(name: string): string {
    const m = /[^.]\.([^./]+)$/.exec(baseName(name));
    return m ? m[1].toLowerCase() : "";
}

/** Is `path` the same as or inside `folder`? */
export function isInside(path: string, folder: string): boolean {
    return path === folder || path.startsWith(folder === "/" ? "/" : folder + "/");
}

/** "name.txt" -> "name 2.txt", "name 3.txt", ... not in `taken`. */
export function uniqueName(name: string, taken: Iterable<string>): string {
    const set = new Set(taken);
    if (!set.has(name)) return name;
    const ext = extensionOf(name);
    const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
    for (let i = 2; ; ++i) {
        const n = ext ? `${stem} ${i}.${ext}` : `${stem} ${i}`;
        if (!set.has(n)) return n;
    }
}

/** A file name the filesystem accepts (no slashes, not "." or ".."). */
export function validFileName(name: string): boolean {
    const n = name.trim();
    return n.length > 0 && n.length <= 255 && !n.includes("/") && n !== "." && n !== ".." && !n.includes("\0");
}

// ---- Types of files ------------------------------------------------------------------

export type FileKind = "folder" | "image" | "audio" | "video" | "text" | "code" | "archive" | "package" | "pdf" | "document" | "book" | "file";

const KINDS: Record<string, [FileKind, string]> = {
    jpg: ["image", "image/jpeg"], jpeg: ["image", "image/jpeg"], png: ["image", "image/png"], gif: ["image", "image/gif"],
    webp: ["image", "image/webp"], bmp: ["image", "image/bmp"], svg: ["image", "image/svg+xml"],
    mp3: ["audio", "audio/mpeg"], ogg: ["audio", "audio/ogg"], oga: ["audio", "audio/ogg"], opus: ["audio", "audio/ogg"],
    m4a: ["audio", "audio/mp4"], wav: ["audio", "audio/wav"], aac: ["audio", "audio/aac"], flac: ["audio", "audio/flac"],
    mp4: ["video", "video/mp4"], m4v: ["video", "video/mp4"], webm: ["video", "video/webm"], mkv: ["video", "video/x-matroska"],
    ogv: ["video", "video/ogg"], mov: ["video", "video/quicktime"],
    txt: ["text", "text/plain"], log: ["text", "text/plain"], md: ["text", "text/markdown"], markdown: ["text", "text/markdown"], csv: ["text", "text/csv"],
    srt: ["text", "application/x-subrip"], vtt: ["text", "text/vtt"],
    ini: ["text", "text/plain"], conf: ["text", "text/plain"], cfg: ["text", "text/plain"], rc: ["text", "text/plain"],
    json: ["code", "application/json"], js: ["code", "text/javascript"], mjs: ["code", "text/javascript"], cjs: ["code", "text/javascript"],
    ts: ["code", "text/plain"], css: ["code", "text/css"], html: ["code", "text/html"], htm: ["code", "text/html"],
    xml: ["code", "application/xml"], opml: ["code", "text/x-opml"], rss: ["code", "application/rss+xml"], sh: ["code", "text/x-sh"], py: ["code", "text/x-python"], c: ["code", "text/x-c"],
    h: ["code", "text/x-c"], cpp: ["code", "text/x-c++"], qml: ["code", "text/plain"], yaml: ["code", "text/yaml"], yml: ["code", "text/yaml"],
    zip: ["archive", "application/zip"], tar: ["archive", "application/x-tar"], gz: ["archive", "application/gzip"],
    tgz: ["archive", "application/gzip"], bz2: ["archive", "application/x-bzip2"], xz: ["archive", "application/x-xz"],
    ipk: ["package", "application/vnd.webos.ipk"],
    pdf: ["pdf", "application/pdf"],
    // Office documents (Doc View reads the OOXML ones) and e-books.
    docx: ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    xlsx: ["document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    pptx: ["document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    doc: ["document", "application/msword"], xls: ["document", "application/vnd.ms-excel"], ppt: ["document", "application/vnd.ms-powerpoint"],
    odt: ["document", "application/vnd.oasis.opendocument.text"],
    epub: ["book", "application/epub+zip"],
};

/** What a file is, by name (folders by type). */
export function kindOf(entry: Pick<FileEntry, "name" | "type">): FileKind {
    if (entry.type === "directory") return "folder";
    return KINDS[extensionOf(entry.name)]?.[0] ?? (/^\.?[a-z]*rc$|^(readme|license|notice|hostname|hosts|fstab|passwd|group)$/i.test(entry.name) ? "text" : "file");
}

/** MIME type by name ("application/octet-stream" when unknown). */
export function mimeOf(name: string): string {
    return KINDS[extensionOf(name)]?.[1] ?? (kindOf({ name, type: "file" }) === "text" ? "text/plain" : "application/octet-stream");
}

/** Files the built-in editor opens: text and code, and small files of unknown type. */
export const TEXT_EDIT_LIMIT = 256 * 1024;
export function opensAsText(entry: Pick<FileEntry, "name" | "type" | "size">): boolean {
    const k = kindOf(entry);
    if (k === "text" || k === "code") return entry.size <= TEXT_EDIT_LIMIT;
    return k === "file" && entry.size <= 64 * 1024;
}

/** Does this look like text (no NUL bytes, few control characters)? */
export function looksLikeText(s: string): boolean {
    if (s.includes("\0")) return false;
    const ctrl = s.slice(0, 4096).replace(/[\t\n\r\f\v\x1b]/g, "").match(/[\x00-\x08\x0e-\x1f]/g);
    return !ctrl || ctrl.length < 4;
}

// ---- Formatting ------------------------------------------------------------------

/** "0 B", "912 B", "1.4 KB", "23 KB", "4.2 MB" (1024-based, as webOS showed sizes). */
export function formatSize(bytes: number): string {
    if (!isFinite(bytes) || bytes < 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return (u === 0 ? String(v) : v < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v))) + " " + units[u];
}

/** "rwxr-xr-x" for 0o755; a leading "d" for folders. */
export function formatMode(mode: number, type?: FileType): string {
    const bits = "rwxrwxrwx";
    let s = "";
    for (let i = 0; i < 9; ++i) s += mode & (1 << (8 - i)) ? bits[i] : "-";
    return (type === "directory" ? "d" : type === "file" ? "-" : "") + s;
}

/** "0755" */
export function formatOctal(mode: number): string {
    return "0" + (mode & 0o777).toString(8).padStart(3, "0");
}

export type SortKey = "name" | "size" | "date";

/**
 * Folders first, then by name (natural, case-insensitive), size (largest
 * first) or date (newest first); ties by name.
 */
export function sortEntries(entries: FileEntry[], key: SortKey): FileEntry[] {
    const byName = (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return entries.slice().sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        const d = key === "size" ? b.size - a.size : key === "date" ? b.mtime - a.mtime : 0;
        return d || byName(a, b);
    });
}

export function isHidden(entry: Pick<FileEntry, "name">): boolean {
    return entry.name.startsWith(".");
}

// ---- URLs ------------------------------------------------------------------------

interface RuntimeFiles { url(path: string): Promise<string> }

/**
 * A URL to show a file (image viewer). On a device the page reads it
 * directly (file://); the simulator's virtual filesystem hands out blob:,
 * data: or rootfs URLs.
 */
export function fileUrl(path: string): Promise<string> {
    const rt = (globalThis as { __phoenixRuntime?: { onDevice?: boolean; fileManager?: RuntimeFiles } }).__phoenixRuntime;
    if (rt?.fileManager && !rt.onDevice) return rt.fileManager.url(path);
    return Promise.resolve(fileUri(path));
}
