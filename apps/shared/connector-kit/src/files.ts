// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The DOCUMENTS capability: a connector that is a drive (WebDAV, S3,
// Dropbox, OneDrive, Google Drive, Box, ...) gives one provider per account
// with the same few operations (DriveProvider, below), and the kit makes the
// service methods every drive answers alike (docs/SYNERGY-SDK.md "Drives:
// the DOCUMENTS capability"), so Files, the file picker, the save picker and
// the share sheet's Save to Files show each drive the same way
// (createDriveRouter, drives.ts, is the system's side):
//
//   listFiles {accountId, path}               -> {path, entries: [entry]}
//   statFile {accountId, path}                -> {entry}
//   downloadFile {accountId, path, to, transferId?}
//       the file into the device's file `to` (a ".part" file renamed when
//       complete), in ranges of chunkSize bytes -> {path: to, size, entry}
//   uploadFile {accountId, from, to, overwrite?, transferId?}
//       the device's file `from` to the drive's `to`; large files in the
//       provider's chunked upload (Nextcloud chunking, S3 multipart, upload
//       sessions) -> {entry}
//   makeFolder {accountId, path}              -> {entry?}
//   moveFile / copyFile {accountId, from, to, overwrite?}   -> {path}
//   removeFile {accountId, path}              -> {path}
//   searchFiles {accountId, query, path?, limit?} -> {entries} (where the API has a search)
//   driveQuota {accountId}                    -> {used, total?} (bytes)
//   transfers {}                              -> {transfers: [{id, accountId, direction, name,
//                                                path, done, total, startedAt}]}
//   cancelTransfer {transferId}               -> {} (the transfer ends with CANCELED)
//
// Paths inside a drive are absolute ("/", "/Photos/a.jpg"). An entry is the
// file manager's ({name, path, type: "file" | "directory", size, mtime,
// mode, readOnly?}) and may add mimeType, etag. Failures are the file
// manager's error codes (FILE_ERRORS: apps/shared/luna/src/files.ts) with
// the drive's own: OFFLINE (no connection: nothing is lost, try again),
// AUTH (sign in again), QUOTA (the drive is full), CANCELED, NOT_AVAILABLE
// (the provider is not set up in this build: no client id), UNSUPPORTED,
// RATE_LIMITED (with retryAt). A failure never throws past the method.
//
// Transfers report their progress to the notification area's ongoing
// activities (org.webosphoenix.ongoing: "Uploading IMG_0001.jpg", "to
// Nextcloud", a bar), from the first second or the first megabyte, and
// can be cancelled between two chunks (cancelTransfer, or Cancel in Files).

import type { AccountContext, Json, Reply } from "./types";

/** The file manager's error codes, and the drives' own (10 and up). */
export const FILE_ERRORS = {
    BAD_PARAMS: -1, NOT_FOUND: 1, EXISTS: 2, PERMISSION: 3, NOT_DIR: 4, IS_DIR: 5, NOT_EMPTY: 6, TOO_LARGE: 7,
    INVALID: 8, IO: 9, OFFLINE: 10, AUTH: 11, QUOTA: 12, CANCELED: 13, NOT_AVAILABLE: 14, UNSUPPORTED: 15, RATE_LIMITED: 16
} as const;
export type FileErrorCode = (typeof FILE_ERRORS)[keyof typeof FILE_ERRORS];

export interface DriveEntry {
    name: string;
    /** Absolute inside the drive ("/Photos/a.jpg"). */
    path: string;
    type: "file" | "directory";
    size: number;
    /** Last modified, ms since the epoch (0: not known). */
    mtime: number;
    mode?: number;
    readOnly?: boolean;
    mimeType?: string;
    etag?: string;
    /** The provider's own id (Google Drive, Box, OneDrive). */
    id?: string;
}

export interface DriveQuota { used: number; total?: number }

/** Cancellation: checked between two chunks. */
export interface CancelSignal { readonly aborted: boolean }

export interface TransferOptions {
    signal: CancelSignal;
    /** Bytes done so far, of total. */
    onProgress(done: number, total: number): void;
    /** The chunk size to use (the capability's chunkSize, default 8 MB). */
    chunkSize: number;
}

/** The device's file being uploaded. */
export interface ByteSource {
    size: number;
    /** Name and type, for the providers that want them. */
    name: string;
    mimeType: string;
    read(offset: number, length: number): Promise<Uint8Array>;
}

/** Where a download goes: written in order. */
export interface ByteSink { write(bytes: Uint8Array): Promise<void> }

/** What a drive connector gives for one account (CapabilityDefinition.files). */
export interface DriveProvider {
    list(path: string): Promise<DriveEntry[]>;
    stat(path: string): Promise<DriveEntry>;
    download(entry: DriveEntry, sink: ByteSink, opts: TransferOptions): Promise<void>;
    upload(path: string, source: ByteSource, opts: TransferOptions & { overwrite: boolean }): Promise<DriveEntry>;
    mkdir(path: string): Promise<DriveEntry | void>;
    move(from: string, to: string, opts: { overwrite: boolean }): Promise<void>;
    copy?(from: string, to: string, opts: { overwrite: boolean }): Promise<void>;
    remove(path: string): Promise<void>;
    search?(query: string, opts: { path: string; limit: number }): Promise<DriveEntry[]>;
    quota?(): Promise<DriveQuota>;
}

/** The device's files, as the host gives them (a device: fs; the simulator: its store). */
export interface LocalFiles {
    size(path: string): Promise<number>;
    read(path: string, offset: number, length: number): Promise<Uint8Array>;
    /** Writes bytes at the end (append) or as the whole file; makes the folders. */
    write(path: string, bytes: Uint8Array, append: boolean): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
}

// ---- Errors -----------------------------------------------------------------------

export interface FileError extends Error { code: number; reason?: string; retryAt?: number; status?: number }

export function fileError(code: number, message: string, reason?: string): FileError {
    const e = new Error(message) as FileError;
    e.code = code;
    if (reason) e.reason = reason;
    return e;
}

/** The error for an HTTP answer a provider did not expect. */
export function httpError(status: number, what: string, detail?: string): FileError {
    const text = what + ": HTTP " + status + (detail ? " (" + detail + ")" : "");
    let code: number = FILE_ERRORS.IO;
    if (status === 401) code = FILE_ERRORS.AUTH;
    else if (status === 403) code = FILE_ERRORS.PERMISSION;
    else if (status === 404 || status === 410) code = FILE_ERRORS.NOT_FOUND;
    else if (status === 409 || status === 412) code = FILE_ERRORS.EXISTS;
    else if (status === 413) code = FILE_ERRORS.TOO_LARGE;
    else if (status === 423) code = FILE_ERRORS.PERMISSION;
    else if (status === 429) code = FILE_ERRORS.RATE_LIMITED;
    else if (status === 507) code = FILE_ERRORS.QUOTA;
    else if (status === 501 || status === 405) code = FILE_ERRORS.UNSUPPORTED;
    const e = fileError(code, text);
    e.status = status;
    return e;
}

const NETWORK = /^(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ECONNABORTED)$/;
const NETWORK_CODES = ["HOST_NOT_FOUND", "CONNECTION_FAILED", "CONNECTION_TIMEOUT"];

/** Any error -> the file manager's {returnValue: false, errorCode, errorText}. */
export function fileFailure(e: unknown): Reply {
    const x = (e || {}) as FileError & { errorCode?: string; code?: unknown };
    let code: number;
    let reason: string | undefined = x.reason;
    if (typeof x.code === "number") code = x.code;
    else if (typeof x.code === "string" && NETWORK.test(x.code)) { code = FILE_ERRORS.OFFLINE; reason = x.code; }
    else if (x.code === "HOST_NOT_ALLOWED") code = FILE_ERRORS.PERMISSION;
    else if (x.errorCode === "401_UNAUTHORIZED" || x.errorCode === "CREDENTIALS_NOT_FOUND" || x.status === 401) { code = FILE_ERRORS.AUTH; reason = "401_UNAUTHORIZED"; }
    else if (x.errorCode === "503_SERVICE_UNAVAILABLE" || x.status === 429) { code = FILE_ERRORS.RATE_LIMITED; reason = "503_SERVICE_UNAVAILABLE"; }
    else if (x.errorCode && NETWORK_CODES.indexOf(x.errorCode) >= 0) { code = FILE_ERRORS.OFFLINE; reason = x.errorCode; }
    else if (typeof x.status === "number" && x.status >= 400) code = httpError(x.status, "").code;
    else if (/timed out|network|fetch failed|Failed to fetch/i.test(String(x.message || ""))) code = FILE_ERRORS.OFFLINE;
    else code = FILE_ERRORS.IO;
    let text = String((x && x.message) || e);
    if (code === FILE_ERRORS.OFFLINE && !/connection/i.test(text)) text = "No connection to the drive (" + text + "). Try again when you are online.";
    const r: Reply = { returnValue: false, errorCode: code, errorText: text };
    if (reason) r.reason = reason;
    if (x.retryAt) r.retryAt = x.retryAt;
    if (code === FILE_ERRORS.OFFLINE) r.offline = true;
    return r;
}

// ---- Paths ----------------------------------------------------------------------------

/** "/a/b" from any absolute path inside a drive; ".." is refused. */
export function drivePath(p: unknown, name?: string): string {
    if (typeof p !== "string" || p.charAt(0) !== "/" || p.indexOf("\0") >= 0)
        throw fileError(FILE_ERRORS.BAD_PARAMS, (name || "path") + " must be an absolute path inside the drive");
    const parts = p.split("/").filter((s) => s && s !== ".");
    if (parts.indexOf("..") >= 0) throw fileError(FILE_ERRORS.BAD_PARAMS, (name || "path") + " may not contain ..");
    return "/" + parts.join("/");
}
export function driveParent(p: string): string { const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
export function driveName(p: string): string { return p === "/" ? "" : p.slice(p.lastIndexOf("/") + 1); }
export function driveJoin(dir: string, name: string): string { return (dir === "/" ? "" : dir) + "/" + name; }

const MIME: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
    wav: "audio/wav", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", json: "application/json",
    csv: "text/csv", html: "text/html", zip: "application/zip", kdbx: "application/x-keepass2",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text", epub: "application/epub+zip"
};
export function mimeOfName(name: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(name || "");
    return (m && MIME[m[1].toLowerCase()]) || "application/octet-stream";
}

// ---- Transfers --------------------------------------------------------------------------

/**
 * A download in ranges (HTTP Range: bytes=a-b), so a big file never sits in
 * memory and a cancel or a lost connection stops between two chunks.
 * fetchRange(start, end) answers {status, bytes}: 206 for the part, or 200
 * with the whole file (a server that ignores Range), which ends it.
 */
export async function downloadInRanges(size: number, sink: ByteSink, opts: TransferOptions,
                                       fetchRange: (start: number, end: number) => Promise<{ status: number; bytes?: Uint8Array }>,
                                       what: string): Promise<void> {
    let done = 0;
    opts.onProgress(0, size);
    if (size === 0) {
        const r = await fetchRange(0, -1);
        if (r.status !== 200 && r.status !== 206 && r.status !== 416) throw httpError(r.status, what);
        if (r.status !== 416 && r.bytes && r.bytes.length) await sink.write(r.bytes);
        return;
    }
    while (done < size) {
        if (opts.signal.aborted) throw fileError(FILE_ERRORS.CANCELED, "Cancelled");
        const end = Math.min(size, done + opts.chunkSize) - 1;
        const r = await fetchRange(done, end);
        if (r.status === 200) {
            // The whole file at once: the server has no ranges.
            if (r.bytes) await sink.write(done ? r.bytes.subarray(done) : r.bytes);
            opts.onProgress(size, size);
            return;
        }
        if (r.status !== 206) throw httpError(r.status, what);
        const bytes = r.bytes || new Uint8Array(0);
        if (!bytes.length) throw fileError(FILE_ERRORS.IO, what + ": the server sent nothing for bytes " + done + "-" + end);
        await sink.write(bytes);
        done += bytes.length;
        opts.onProgress(done, size);
    }
}

/** source in chunks of chunkSize (the last one shorter), with cancel and progress. */
export async function forEachChunk(source: ByteSource, opts: TransferOptions,
                                   fn: (bytes: Uint8Array, offset: number, last: boolean) => Promise<void>): Promise<void> {
    let offset = 0;
    opts.onProgress(0, source.size);
    do {
        if (opts.signal.aborted) throw fileError(FILE_ERRORS.CANCELED, "Cancelled");
        const len = Math.min(opts.chunkSize, source.size - offset);
        const bytes = len > 0 ? await source.read(offset, len) : new Uint8Array(0);
        const last = offset + len >= source.size;
        await fn(bytes, offset, last);
        offset += len;
        opts.onProgress(offset, source.size);
    } while (offset < source.size);
}

export interface TransferRecord {
    id: string;
    accountId: string;
    direction: "upload" | "download";
    name: string;
    path: string;
    done: number;
    total: number;
    startedAt: number;
}

interface Running extends TransferRecord { canceled: boolean; shown: boolean; lastShown: number; lastPercent: number }

const ONGOING = "luna://org.webosphoenix.ongoing/";
const FILES_APP = "org.webosphoenix.files";
const DEFAULT_CHUNK = 8 * 1024 * 1024;

export interface FilesHost {
    call(uri: string, params: Json): Promise<Json>;
    files?: LocalFiles;
    now(): number;
    log(m: string): void;
    /** The account's context, the provider for it, then the state saved: run fn with them. */
    withProvider<T>(accountId: string, fn: (provider: DriveProvider, ctx: AccountContext, chunkSize: number) => Promise<T>): Promise<T>;
}

/** The DOCUMENTS methods (see the top of this file) over a host. */
export function createFilesMethods(host: FilesHost): Record<string, (p: Json) => Promise<Reply>> {
    const running: Record<string, Running> = {};
    let counter = 0;

    function ok(extra?: Json): Reply { return Object.assign({ returnValue: true }, extra || {}); }

    function accountOf(p: Json): string {
        if (!p || typeof p.accountId !== "string" || !p.accountId) throw fileError(FILE_ERRORS.BAD_PARAMS, "accountId is required");
        return p.accountId;
    }
    function localFiles(): LocalFiles {
        if (!host.files) throw fileError(FILE_ERRORS.UNSUPPORTED, "This host cannot read or write the device's files");
        return host.files;
    }
    function localPath(p: unknown, name: string): string {
        if (typeof p !== "string" || p.charAt(0) !== "/" || /(^|\/)\.\.(\/|$)/.test(p) || p.indexOf("\0") >= 0)
            throw fileError(FILE_ERRORS.BAD_PARAMS, name + " must be an absolute path of the device");
        return p;
    }

    // The ongoing activity of a transfer: shown after a second or a megabyte,
    // updated every 5 % (at most twice a second), cleared at the end.
    function progress(t: Running, label: string) {
        return (done: number, total: number) => {
            t.done = done;
            t.total = total;
            const now = host.now();
            const percent = total > 0 ? Math.floor(done * 100 / total) : -1;
            const due = t.shown ? (percent - t.lastPercent >= 5 && now - t.lastShown >= 500) || (percent === 100 && t.lastPercent !== 100)
                : (now - t.startedAt >= 1000 || total >= 1024 * 1024) && percent < 100;
            if (!due) return;
            t.shown = true;
            t.lastShown = now;
            t.lastPercent = percent;
            host.call(ONGOING + "set", {
                id: "drive-transfer-" + t.id, appId: FILES_APP,
                title: (t.direction === "upload" ? "Uploading " : "Downloading ") + t.name,
                body: (t.direction === "upload" ? "to " : "from ") + label, progress: percent,
                params: { transfer: t.id }
            }).catch(() => {});
        };
    }
    function start(accountId: string, direction: "upload" | "download", path: string, total: number, id?: string): Running {
        const t: Running = { id: id ? String(id) : "t" + host.now().toString(36) + "-" + (++counter), accountId, direction, path,
                             name: path.replace(/^.*\//, ""), done: 0, total, startedAt: host.now(), canceled: false, shown: false,
                             lastShown: 0, lastPercent: -1 };
        running[t.id] = t;
        return t;
    }
    function finish(t: Running): void {
        delete running[t.id];
        if (t.shown) host.call(ONGOING + "clear", { id: "drive-transfer-" + t.id }).catch(() => {});
    }
    function labelOf(ctx: AccountContext): string {
        const a = ctx.account || {};
        return String(a.alias || a.loc_name || a.username || "the drive");
    }

    function method(fn: (p: Json) => Promise<Json>) {
        return (p: Json) => fn(p || {}).then((r) => ok(r), (e) => fileFailure(e));
    }
    const signalOf = (t: Running): CancelSignal => ({ get aborted() { return t.canceled; } });

    return {
        listFiles: method(async (p) => {
            const path = drivePath(p.path || "/");
            const entries = await host.withProvider(accountOf(p), (d) => d.list(path));
            return { path, entries };
        }),
        statFile: method(async (p) => {
            const path = drivePath(p.path || "/");
            return { entry: await host.withProvider(accountOf(p), (d) => d.stat(path)) };
        }),
        makeFolder: method(async (p) => {
            const path = drivePath(p.path);
            if (path === "/") throw fileError(FILE_ERRORS.EXISTS, "The drive's top folder is there already");
            const entry = await host.withProvider(accountOf(p), (d) => d.mkdir(path));
            return entry ? { path, entry } : { path };
        }),
        moveFile: method(async (p) => {
            const from = drivePath(p.from, "from"), to = drivePath(p.to, "to");
            if (from === "/" || to === "/") throw fileError(FILE_ERRORS.PERMISSION, "The drive's top folder cannot move");
            if (to === from || to.indexOf(from + "/") === 0) throw fileError(FILE_ERRORS.INVALID, "Cannot move a folder into itself");
            await host.withProvider(accountOf(p), (d) => d.move(from, to, { overwrite: !!p.overwrite }));
            return { path: to };
        }),
        copyFile: method(async (p) => {
            const from = drivePath(p.from, "from"), to = drivePath(p.to, "to");
            if (to === from || to.indexOf(from + "/") === 0) throw fileError(FILE_ERRORS.INVALID, "Cannot copy a folder into itself");
            await host.withProvider(accountOf(p), (d) => {
                if (!d.copy) throw fileError(FILE_ERRORS.UNSUPPORTED, "This drive cannot copy on the server");
                return d.copy(from, to, { overwrite: !!p.overwrite });
            });
            return { path: to };
        }),
        removeFile: method(async (p) => {
            const path = drivePath(p.path);
            if (path === "/") throw fileError(FILE_ERRORS.PERMISSION, "The drive's top folder cannot be removed");
            await host.withProvider(accountOf(p), (d) => d.remove(path));
            return { path };
        }),
        searchFiles: method(async (p) => {
            const query = String(p.query || "").trim();
            if (!query) throw fileError(FILE_ERRORS.BAD_PARAMS, "query is required");
            const path = drivePath(p.path || "/");
            const limit = Math.max(1, Math.min(200, Number(p.limit) || 50));
            const entries = await host.withProvider(accountOf(p), (d) => {
                if (!d.search) throw fileError(FILE_ERRORS.UNSUPPORTED, "This drive has no search");
                return d.search(query, { path, limit });
            });
            return { entries: entries.slice(0, limit) };
        }),
        driveQuota: method(async (p) => {
            return host.withProvider(accountOf(p), async (d) => {
                if (!d.quota) throw fileError(FILE_ERRORS.UNSUPPORTED, "This drive does not say how full it is");
                const q = await d.quota();
                return q.total === undefined ? { used: q.used } : { used: q.used, total: q.total };
            });
        }),

        downloadFile: method(async (p) => {
            const accountId = accountOf(p);
            const path = drivePath(p.path);
            const to = localPath(p.to, "to");
            const files = localFiles();
            return host.withProvider(accountId, async (d, ctx, chunkSize) => {
                const entry = await d.stat(path);
                if (entry.type === "directory") throw fileError(FILE_ERRORS.IS_DIR, "Is a folder: " + path);
                const t = start(accountId, "download", path, entry.size, p.transferId);
                const part = to + ".part";
                try {
                    await files.write(part, new Uint8Array(0), false);
                    let written = 0;
                    await d.download(entry, { write: async (b) => { await files.write(part, b, true); written += b.length; } },
                                     { signal: signalOf(t), onProgress: progress(t, labelOf(ctx)), chunkSize });
                    if (t.canceled) throw fileError(FILE_ERRORS.CANCELED, "Cancelled");
                    await files.rename(part, to);
                    return { path: to, size: written, entry };
                } catch (e) {
                    await files.remove(part).catch(() => {});
                    throw e;
                } finally {
                    finish(t);
                }
            });
        }),

        uploadFile: method(async (p) => {
            const accountId = accountOf(p);
            const from = localPath(p.from, "from");
            const to = drivePath(p.to, "to");
            if (to === "/") throw fileError(FILE_ERRORS.BAD_PARAMS, "to names the file in the drive");
            const files = localFiles();
            const size = await files.size(from).catch(() => { throw fileError(FILE_ERRORS.NOT_FOUND, "No such file: " + from); });
            return host.withProvider(accountId, async (d, ctx, chunkSize) => {
                const t = start(accountId, "upload", to, size, p.transferId);
                try {
                    const name = driveName(to);
                    const source: ByteSource = { size, name, mimeType: p.mimeType || mimeOfName(name),
                                                 read: (offset, length) => files.read(from, offset, length) };
                    const entry = await d.upload(to, source, { signal: signalOf(t), onProgress: progress(t, labelOf(ctx)), chunkSize,
                                                               overwrite: p.overwrite !== false });
                    return { entry };
                } finally {
                    finish(t);
                }
            });
        }),

        transfers: method(async () => ({
            transfers: Object.keys(running).map((id) => {
                const t = running[id];
                return { id: t.id, accountId: t.accountId, direction: t.direction, name: t.name, path: t.path, done: t.done,
                         total: t.total, startedAt: t.startedAt };
            })
        })),
        cancelTransfer: method(async (p) => {
            const t = running[String(p.transferId || "")];
            if (!t) throw fileError(FILE_ERRORS.NOT_FOUND, "No such transfer (it may have ended)");
            t.canceled = true;
            return {};
        })
    };
}

export const FILES_METHODS = ["listFiles", "statFile", "downloadFile", "uploadFile", "makeFolder", "moveFile", "copyFile", "removeFile",
                              "searchFiles", "driveQuota", "transfers", "cancelTransfer"];

export { DEFAULT_CHUNK };
