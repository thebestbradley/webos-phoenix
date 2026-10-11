// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The drives as places of the device's file manager
// (org.webosphoenix.filemanager; docs/SHARE-AND-FILES.md "Drives"): every
// account with the DOCUMENTS capability is a folder under /media/drives,
// /media/drives/<accountId>, so the Files app, the file picker, the save
// picker and the share sheet's Save to Files show it like any folder, and
// copying between the device and a drive is an upload or a download.
//
// The file manager (apps/files/service/filemanager.js on a device, the
// simulator's "File manager" block) hands every path under /media/drives
// to this router, which asks the account's connector service (its
// template's DOCUMENTS provider: files.ts's listFiles, statFile,
// downloadFile, uploadFile, ...). The file manager's own methods for the
// device's files are given as `local`. Replies are the file manager's;
// entries under a drive add remote: true, and a drive's own folder adds
// drive: {accountId, templateId, title, account, icon}.
//
// Opening a file of a drive (open {path}) keeps a copy in the cache
// (/media/internal/.phoenix/drive-cache/<accountId>/<path>), downloaded
// again only when the drive's copy changed; offline, the last copy opens
// (stale: true). read and write go through that cache and an upload.

import { fileError, fileFailure, FILE_ERRORS } from "./files";
import type { Json, Reply } from "./types";

export const DRIVES_ROOT = "/media/drives";
const DEFAULT_CACHE = "/media/internal/.phoenix/drive-cache";

/** The file manager's own methods for the device's files (replies, never rejecting). */
export interface LocalFileManager {
    list(p: Json): Promise<Reply>;
    stat(p: Json): Promise<Reply>;
    mkdir(p: Json): Promise<Reply>;
    remove(p: Json): Promise<Reply>;
    read(p: Json): Promise<Reply>;
    write(p: Json): Promise<Reply>;
}

export interface DriveRouterOptions {
    /** A Luna call as the file manager: resolves to the reply. */
    call(uri: string, params: Json): Promise<Json>;
    local: LocalFileManager;
    cacheDir?: string;
    now?(): number;
    log?(m: string): void;
}

export interface DriveRouter {
    /** The path is /media/drives or under it. */
    handles(path: unknown): boolean;
    list(p: Json): Promise<Reply>;
    stat(p: Json): Promise<Reply>;
    mkdir(p: Json): Promise<Reply>;
    copy(p: Json): Promise<Reply>;
    move(p: Json): Promise<Reply>;
    remove(p: Json): Promise<Reply>;
    read(p: Json): Promise<Reply>;
    write(p: Json): Promise<Reply>;
    search(p: Json): Promise<Reply>;
    /** open {path} -> {path: the device's copy, remotePath, entry, stale?} */
    open(p: Json): Promise<Reply>;
    /** transfers {} -> {transfers}: every drive's uploads and downloads under way */
    transfers(p: Json): Promise<Reply>;
    /** cancel {transferId} */
    cancel(p: Json): Promise<Reply>;
    /** quota {path} -> {used, total?} of the drive of path */
    quota(p: Json): Promise<Reply>;
    /** The drive accounts (for the file manager's list of places). */
    drives(): Promise<DriveAccount[]>;
}

export interface DriveAccount {
    accountId: string;
    templateId: string;
    service: string;
    /** The account type's name ("Nextcloud"). */
    title: string;
    /** The account's own name (user@server). */
    account: string;
    icon: string;
}

interface Where { drive: DriveAccount; path: string }

function norm(p: unknown, name?: string): string {
    if (typeof p !== "string" || p.charAt(0) !== "/" || p.indexOf("\0") >= 0)
        throw fileError(FILE_ERRORS.BAD_PARAMS, (name || "path") + " must be an absolute path");
    const out: string[] = [];
    p.split("/").forEach((s) => {
        if (!s || s === ".") return;
        if (s === "..") out.pop();
        else out.push(s);
    });
    return "/" + out.join("/");
}

function ok(extra?: Json): Reply { return Object.assign({ returnValue: true }, extra || {}); }

export function createDriveRouter(opts: DriveRouterOptions): DriveRouter {
    const cacheDir = opts.cacheDir || DEFAULT_CACHE;
    const now = opts.now || (() => Date.now());
    const log = opts.log || (() => {});
    let accountsCache: { at: number; list: DriveAccount[] } | null = null;
    let tempCount = 0;

    const handles = (p: unknown) => typeof p === "string" && (p === DRIVES_ROOT || p.indexOf(DRIVES_ROOT + "/") === 0 ||
                                                              p === DRIVES_ROOT + "/");

    async function call(uri: string, params: Json): Promise<Json> {
        const r = await opts.call(uri, params);
        if (!r || r.returnValue === false) {
            const code = r && typeof r.errorCode === "number" ? r.errorCode : FILE_ERRORS.IO;
            const e = fileError(code, String((r && r.errorText) || "No answer from " + uri.replace(/\/[^/]*$/, "")),
                                r && r.reason);
            if (r && r.retryAt) e.retryAt = r.retryAt;
            throw e;
        }
        return r;
    }

    function serviceOf(account: Json): string | null {
        const cp = (account.capabilityProviders || []).filter((c: Json) => c && c.capability === "DOCUMENTS")[0];
        const impl = String((cp && (cp.implementation || cp.sync || cp.onEnabled)) || "");
        const m = /^(?:palm|luna):\/\/([^/]+)\//.exec(impl);
        return m ? m[1] : null;
    }

    async function drives(): Promise<DriveAccount[]> {
        if (accountsCache && now() - accountsCache.at < 2000) return accountsCache.list;
        // The accounts, and their templates (which name the service: an
        // account's own capability providers may carry only {id, capability}).
        const [r, t] = await Promise.all([
            opts.call("luna://com.palm.service.accounts/listAccounts", { capability: "DOCUMENTS" }),
            opts.call("luna://com.palm.service.accounts/listAccountTemplates", { capability: "DOCUMENTS" })
        ]);
        const templates: Record<string, Json> = {};
        ((t && t.results) || []).forEach((x: Json) => { if (x && x.templateId) templates[x.templateId] = x; });
        const merged = ((r && r.results) || []).filter((a: Json) => a && !a.beingDeleted).map((a: Json) => {
            const tpl = templates[a.templateId] || {};
            return serviceOf(a) ? Object.assign({}, tpl, a) : Object.assign({}, tpl, a, { capabilityProviders: tpl.capabilityProviders || [] });
        });
        const list: DriveAccount[] = merged.filter((a: Json) => serviceOf(a)).map((a: Json) => ({
            accountId: String(a._id), templateId: String(a.templateId || ""), service: serviceOf(a) as string,
            title: String(a.loc_name || a.templateId || "Drive"), account: String(a.username || a.alias || ""),
            icon: String((a.icon && (a.icon.loc_48x48 || a.icon.loc_32x32)) || "")
        }));
        accountsCache = { at: now(), list };
        return list;
    }

    async function where(path: string): Promise<Where | null> {
        const rest = path.slice(DRIVES_ROOT.length + 1);
        if (!rest) return null;
        const i = rest.indexOf("/");
        const id = i < 0 ? rest : rest.slice(0, i);
        const drive = (await drives()).filter((d) => d.accountId === id)[0];
        if (!drive) throw fileError(FILE_ERRORS.NOT_FOUND, "No such drive: " + id + " (its account may have been removed)");
        return { drive, path: i < 0 ? "/" : rest.slice(i) };
    }

    const svc = (w: Where, method: string) => "luna://" + w.drive.service + "/" + method;
    const outside = (w: Where, p: string) => DRIVES_ROOT + "/" + w.drive.accountId + (p === "/" ? "" : p);

    function driveInfo(d: DriveAccount): Json {
        return { accountId: d.accountId, templateId: d.templateId, title: d.title, account: d.account, icon: d.icon };
    }
    function entryOut(w: Where, e: Json): Json {
        const out = Object.assign({}, e, { path: outside(w, e.path), remote: true });
        if (out.mode === undefined) out.mode = e.type === "directory" ? 0o755 : 0o644;
        if (e.path === "/") Object.assign(out, { name: w.drive.accountId, drive: driveInfo(w.drive) });
        return out;
    }
    function rootEntry(withCount: number | null): Json {
        const e: Json = { name: "drives", path: DRIVES_ROOT, type: "directory", size: 0, mtime: 0, mode: 0o555, readOnly: true };
        if (withCount !== null) e.count = withCount;
        return e;
    }

    function cachePathOf(w: Where): string { return cacheDir + "/" + w.drive.accountId + w.path; }
    function tempPath(name: string): string { return cacheDir + "/.transfer/" + now().toString(36) + "-" + (++tempCount) + "-" + name.replace(/[/\\]/g, "-"); }

    async function localOk(r: Promise<Reply>): Promise<Reply> {
        const x = await r;
        if (!x || x.returnValue === false) {
            const e = fileError(typeof x.errorCode === "number" ? x.errorCode : FILE_ERRORS.IO, String(x && x.errorText || "failed"));
            throw e;
        }
        return x;
    }

    // ---- The cache's index: what version of each file is kept -----------------------------
    const INDEX = () => cacheDir + "/index.json";
    async function readIndex(): Promise<Record<string, Json>> {
        const r = await opts.local.read({ path: INDEX(), encoding: "utf8" });
        if (!r || r.returnValue === false) return {};
        try { return JSON.parse(r.data) || {}; } catch (e) { return {}; }
    }
    async function writeIndex(index: Record<string, Json>): Promise<void> {
        await opts.local.write({ path: INDEX(), data: JSON.stringify(index), encoding: "utf8" });
    }
    const versionOf = (e: Json) => [e.etag || "", e.mtime || 0, e.size || 0].join("|");

    async function exists(path: string): Promise<boolean> {
        if (handles(path)) {
            const w = await where(path);
            if (!w) return true;
            try { await call(svc(w, "statFile"), { accountId: w.drive.accountId, path: w.path }); return true; } catch (e) {
                if ((e as Json).code === FILE_ERRORS.NOT_FOUND) return false;
                throw e;
            }
        }
        const r = await opts.local.stat({ path });
        return !!(r && r.returnValue !== false);
    }

    async function isDir(path: string): Promise<boolean> {
        if (handles(path)) {
            const w = await where(path);
            if (!w) return true;
            const r = await call(svc(w, "statFile"), { accountId: w.drive.accountId, path: w.path });
            return r.entry && r.entry.type === "directory";
        }
        const r = await localOk(opts.local.stat({ path }));
        return r.entry.type === "directory";
    }

    async function listAny(path: string): Promise<Json[]> {
        if (handles(path)) {
            const w = await where(path);
            if (!w) throw fileError(FILE_ERRORS.PERMISSION, "Not inside a drive: " + path);
            const r = await call(svc(w, "listFiles"), { accountId: w.drive.accountId, path: w.path });
            return (r.entries || []).map((e: Json) => entryOut(w, e));
        }
        return (await localOk(opts.local.list({ path }))).entries || [];
    }

    async function mkdirAny(path: string): Promise<void> {
        if (handles(path)) {
            const w = await where(path);
            if (!w) throw fileError(FILE_ERRORS.PERMISSION, "Not inside a drive: " + path);
            await call(svc(w, "makeFolder"), { accountId: w.drive.accountId, path: w.path });
            return;
        }
        await localOk(opts.local.mkdir({ path }));
    }

    async function removeAny(path: string): Promise<void> {
        if (handles(path)) {
            const w = await where(path);
            if (!w) throw fileError(FILE_ERRORS.PERMISSION, "A drive is removed in Accounts");
            await call(svc(w, "removeFile"), { accountId: w.drive.accountId, path: w.path });
            return;
        }
        await localOk(opts.local.remove({ path, recursive: true }));
    }

    // One file from anywhere to anywhere (a folder: each of its files).
    async function copyTree(from: string, to: string, transferId?: string): Promise<void> {
        if (await isDir(from)) {
            await mkdirAny(to);
            for (const e of await listAny(from)) await copyTree(e.path, to + "/" + e.name);
            return;
        }
        const src = handles(from) ? await where(from) : null;
        const dst = handles(to) ? await where(to) : null;
        if (src && dst && src.drive.accountId === dst.drive.accountId) {
            try {
                await call(svc(src, "copyFile"), { accountId: src.drive.accountId, from: src.path, to: dst.path, overwrite: true });
                return;
            } catch (e) {
                if ((e as Json).code !== FILE_ERRORS.UNSUPPORTED) throw e;
            }
        }
        if (src && !dst) {
            await call(svc(src, "downloadFile"), { accountId: src.drive.accountId, path: src.path, to, transferId });
            return;
        }
        if (!src && dst) {
            await call(svc(dst, "uploadFile"), { accountId: dst.drive.accountId, from, to: dst.path, overwrite: true, transferId });
            return;
        }
        if (src && dst) {
            // From one drive to another: through a file of the device.
            const temp = tempPath(dst.path.replace(/^.*\//, ""));
            try {
                await call(svc(src, "downloadFile"), { accountId: src.drive.accountId, path: src.path, to: temp });
                await call(svc(dst, "uploadFile"), { accountId: dst.drive.accountId, from: temp, to: dst.path, overwrite: true, transferId });
            } finally {
                await opts.local.remove({ path: temp });
            }
        }
    }

    function wrap(fn: (p: Json) => Promise<Json>) {
        return (p: Json) => fn(p || {}).then((r) => ok(r), (e) => fileFailure(e));
    }

    async function prepare(from: string, to: string, overwrite: boolean, move: boolean): Promise<void> {
        if (to === from || to.indexOf(from + "/") === 0) throw fileError(FILE_ERRORS.INVALID, "Cannot " + (move ? "move" : "copy") + " a folder into itself");
        if (to === DRIVES_ROOT || (handles(to) && !(await where(to)))) throw fileError(FILE_ERRORS.PERMISSION, "Not inside a drive: " + to);
        if (!(await exists(from))) throw fileError(FILE_ERRORS.NOT_FOUND, "No such file or directory: " + from);
        if (await exists(to)) {
            if (!overwrite) throw fileError(FILE_ERRORS.EXISTS, "Already exists: " + to);
            await removeAny(to);
        }
    }

    const router: DriveRouter = {
        handles,
        drives,

        list: wrap(async (p) => {
            const path = norm(p.path);
            if (path === DRIVES_ROOT) {
                const list = await drives();
                return { path, entries: list.map((d) => ({ name: d.accountId, path: DRIVES_ROOT + "/" + d.accountId, type: "directory", size: 0,
                                                            mtime: 0, mode: 0o755, remote: true, drive: driveInfo(d) })) };
            }
            const w = await where(path) as Where;
            const r = await call(svc(w, "listFiles"), { accountId: w.drive.accountId, path: w.path });
            return { path, entries: (r.entries || []).map((e: Json) => entryOut(w, e)) };
        }),

        stat: wrap(async (p) => {
            const path = norm(p.path);
            if (path === DRIVES_ROOT) return { entry: rootEntry((await drives()).length) };
            const w = await where(path) as Where;
            const r = await call(svc(w, "statFile"), { accountId: w.drive.accountId, path: w.path });
            return { entry: entryOut(w, r.entry) };
        }),

        mkdir: wrap(async (p) => {
            const path = norm(p.path);
            await mkdirAny(path);
            return { path };
        }),

        copy: wrap(async (p) => {
            const from = norm(p.from, "from"), to = norm(p.to, "to");
            await prepare(from, to, !!p.overwrite, false);
            await copyTree(from, to, p.transferId);
            return { path: to };
        }),

        move: wrap(async (p) => {
            const from = norm(p.from, "from"), to = norm(p.to, "to");
            const src = handles(from) ? await where(from) : null;
            const dst = handles(to) ? await where(to) : null;
            if (handles(from) && !src) throw fileError(FILE_ERRORS.PERMISSION, "A drive is removed or renamed in Accounts");
            if (src && dst && src.drive.accountId === dst.drive.accountId) {
                await call(svc(src, "moveFile"), { accountId: src.drive.accountId, from: src.path, to: dst.path, overwrite: !!p.overwrite });
                return { path: to };
            }
            await prepare(from, to, !!p.overwrite, true);
            await copyTree(from, to, p.transferId);
            await removeAny(from);
            return { path: to };
        }),

        remove: wrap(async (p) => {
            const path = norm(p.path);
            await removeAny(path);
            return { path };
        }),

        read: wrap(async (p) => {
            const path = norm(p.path);
            const opened = await openFile(path);
            const r = await localOk(opts.local.read(Object.assign({}, p, { path: opened.path })));
            const out: Json = Object.assign({}, r, { path });
            delete out.returnValue;
            return out;
        }),

        write: wrap(async (p) => {
            const path = norm(p.path);
            const w = await where(path);
            if (!w || w.path === "/") throw fileError(FILE_ERRORS.PERMISSION, "Not a file inside a drive: " + path);
            if (p.overwrite === false && await exists(path)) throw fileError(FILE_ERRORS.EXISTS, "Already exists: " + path);
            const temp = tempPath(w.path.replace(/^.*\//, ""));
            try {
                const written = await localOk(opts.local.write({ path: temp, data: p.data, encoding: p.encoding || "utf8" }));
                const up = await call(svc(w, "uploadFile"), { accountId: w.drive.accountId, from: temp, to: w.path, overwrite: true,
                                                               transferId: p.transferId });
                // The device's copy is now the drive's: keep it as the cached one.
                await rememberUpload(w, temp, up.entry).catch((e) => log("cache not kept: " + (e as Error).message));
                return { path, size: written.size };
            } finally {
                await opts.local.remove({ path: temp });
            }
        }),

        search: wrap(async (p) => {
            const path = norm(p.path || DRIVES_ROOT);
            const list = path === DRIVES_ROOT ? await drives() : [];
            const targets: Where[] = path === DRIVES_ROOT ? list.map((d) => ({ drive: d, path: "/" })) : [await where(path) as Where];
            const out: Json[] = [];
            for (const w of targets) {
                try {
                    const r = await call(svc(w, "searchFiles"), { accountId: w.drive.accountId, query: p.query, path: w.path, limit: p.limit });
                    (r.entries || []).forEach((e: Json) => out.push(entryOut(w, e)));
                } catch (e) {
                    // A drive without a search, or offline: the others still answer.
                    if (targets.length === 1) throw e;
                }
            }
            return { entries: out.slice(0, Math.max(1, Math.min(200, Number(p.limit) || 50))) };
        }),

        open: wrap(async (p) => openFile(norm(p.path))),

        transfers: wrap(async () => {
            const services = (await drives()).map((d) => d.service).filter((s, i, a) => a.indexOf(s) === i);
            const all: Json[] = [];
            for (const s of services) {
                const r = await opts.call("luna://" + s + "/transfers", {});
                ((r && r.transfers) || []).forEach((t: Json) => all.push(Object.assign({}, t, { service: s })));
            }
            return { transfers: all };
        }),

        cancel: wrap(async (p) => {
            const services = (await drives()).map((d) => d.service).filter((s, i, a) => a.indexOf(s) === i);
            for (const s of services) {
                const r = await opts.call("luna://" + s + "/cancelTransfer", { transferId: p.transferId });
                if (r && r.returnValue !== false) return {};
            }
            throw fileError(FILE_ERRORS.NOT_FOUND, "No such transfer (it may have ended)");
        }),

        quota: wrap(async (p) => {
            const w = await where(norm(p.path));
            if (!w) throw fileError(FILE_ERRORS.BAD_PARAMS, "path: a drive's folder");
            const r = await call(svc(w, "driveQuota"), { accountId: w.drive.accountId });
            return r.total === undefined ? { used: r.used } : { used: r.used, total: r.total };
        })
    };

    async function rememberUpload(w: Where, temp: string, entry: Json): Promise<void> {
        if (!entry) return;
        const cache = cachePathOf(w);
        const data = await localOk(opts.local.read({ path: temp, encoding: "base64", maxBytes: 16 * 1024 * 1024 }));
        await localOk(opts.local.write({ path: cache, data: data.data, encoding: "base64" }));
        const index = await readIndex();
        index[cache] = { version: versionOf(entry), at: now() };
        await writeIndex(index);
    }

    async function openFile(path: string): Promise<Json> {
        const w = await where(path);
        if (!w || w.path === "/") throw fileError(FILE_ERRORS.IS_DIR, "Is a folder: " + path);
        const cache = cachePathOf(w);
        const index = await readIndex();
        const kept = index[cache];
        let entry: Json;
        try {
            entry = (await call(svc(w, "statFile"), { accountId: w.drive.accountId, path: w.path })).entry;
        } catch (e) {
            // Offline (or the drive refuses): the copy kept last time, if any.
            const code = (e as Json).code;
            if (kept && (code === FILE_ERRORS.OFFLINE || code === FILE_ERRORS.RATE_LIMITED || code === FILE_ERRORS.AUTH) &&
                await exists(cache)) {
                return { path: cache, remotePath: path, entry: Object.assign({ name: path.replace(/^.*\//, ""), path, type: "file" }, kept.entry || {}),
                         stale: true };
            }
            throw e;
        }
        if (entry.type === "directory") throw fileError(FILE_ERRORS.IS_DIR, "Is a folder: " + path);
        const out = entryOut(w, entry);
        if (kept && kept.version === versionOf(entry) && await exists(cache)) return { path: cache, remotePath: path, entry: out, cached: true };
        await call(svc(w, "downloadFile"), { accountId: w.drive.accountId, path: w.path, to: cache });
        const fresh = await readIndex();
        fresh[cache] = { version: versionOf(entry), at: now(), entry: { size: entry.size, mtime: entry.mtime, mimeType: entry.mimeType } };
        await writeIndex(fresh).catch((e) => log("cache index not written: " + (e as Error).message));
        return { path: cache, remotePath: path, entry: out };
    }

    return router;
}
