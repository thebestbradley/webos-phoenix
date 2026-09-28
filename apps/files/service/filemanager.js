// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.filemanager on a device: the methods of the Files app's
// service, on the real filesystem with Node's fs. service.js puts them on
// the Luna bus; each takes the request payload and resolves to a webOS
// style reply (returnValue, and errorCode / errorText on failure). The
// simulator implements the same calls in runtime/phoenix-runtime.js
// ("File manager"); the codes are FILE_ERRORS in
// apps/shared/luna/src/files.ts.
//
//   list {path}                               -> {path, entries: [entry]}
//   stat {path}                               -> {entry} (folders add count)
//   mkdir {path}                              -> {path}
//   copy / move {from, to, overwrite?}        -> {path}
//   remove {path, recursive?}                 -> {path}
//   read {path, encoding?, maxBytes?}         -> {path, data, encoding, size}
//   write {path, data, encoding?, overwrite?} -> {path, size}
//
// The service can see the whole filesystem but only changes files under
// the writable roots (the user's storage and temporary folders); the rest
// is reported readOnly, as on the simulator.

"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const E = { BAD_PARAMS: -1, NOT_FOUND: 1, EXISTS: 2, PERMISSION: 3, NOT_DIR: 4, IS_DIR: 5, NOT_EMPTY: 6, TOO_LARGE: 7, INVALID: 8, IO: 9 };
const ERRNO = { ENOENT: E.NOT_FOUND, EEXIST: E.EXISTS, EACCES: E.PERMISSION, EPERM: E.PERMISSION, EROFS: E.PERMISSION,
                ENOTDIR: E.NOT_DIR, EISDIR: E.IS_DIR, ENOTEMPTY: E.NOT_EMPTY, EINVAL: E.INVALID };
const DEFAULT_WRITABLE = ["/media", "/home", "/tmp", "/var/tmp", "/mnt", "/run/media"];
const READ_LIMIT = 16 * 1024 * 1024;

class FileError extends Error {
    constructor(code, text) {
        super(text);
        this.code = code;
    }
}

function ok(extra) {
    return Object.assign({ returnValue: true }, extra);
}

function failure(e) {
    if (e instanceof FileError) return { returnValue: false, errorCode: e.code, errorText: e.message };
    const code = ERRNO[e && e.code] || E.IO;
    return { returnValue: false, errorCode: code, errorText: String(e && e.message || e) };
}

// An absolute, normalised path (or a FileError).
function absolute(p, name) {
    if (typeof p !== "string" || !p.startsWith("/") || p.includes("\0"))
        throw new FileError(E.BAD_PARAMS, (name || "path") + " must be an absolute path");
    return path.posix.normalize(p).replace(/(.)\/+$/, "$1");
}

function inside(p, dir) {
    return p === dir || p.startsWith(dir === "/" ? "/" : dir + "/");
}

async function exists(p) {
    try {
        await fsp.lstat(p);
        return true;
    } catch (e) {
        if (e.code === "ENOENT") return false;
        throw e;
    }
}

/**
 * The methods, bound to a set of writable roots (options.writableRoots,
 * default DEFAULT_WRITABLE; tests use a temporary folder).
 */
function createFileManager(options) {
    const roots = ((options && options.writableRoots) || DEFAULT_WRITABLE).map((r) => path.posix.normalize(r));
    const writableRoot = (p) => roots.some((r) => inside(p, r));

    function checkWritable(p) {
        if (!writableRoot(p) || roots.includes(p))
            throw new FileError(E.PERMISSION, "Read-only: " + p);
    }

    async function entry(p, withCount) {
        const l = await fsp.lstat(p);
        let s = l;
        if (l.isSymbolicLink()) {
            try { s = await fsp.stat(p); } catch (e) { s = l; }
        }
        const dir = s.isDirectory();
        const e = { name: p === "/" ? "" : path.posix.basename(p), path: p, type: dir ? "directory" : "file",
                    size: dir ? 0 : s.size, mtime: Math.round(s.mtimeMs), mode: s.mode & 0o777 };
        if (l.isSymbolicLink()) e.link = true;
        let writable = writableRoot(p) && !roots.includes(p);
        if (writable) {
            try { await fsp.access(p, fs.constants.W_OK); } catch (x) { writable = false; }
        }
        if (!writable) e.readOnly = true;
        if (withCount && dir) {
            try { e.count = (await fsp.readdir(p)).length; } catch (x) { e.count = 0; }
        }
        return e;
    }

    // Recursive copy (fs.cp is still experimental on the Node versions OSE ships).
    async function copyTree(from, to) {
        const s = await fsp.lstat(from);
        if (s.isSymbolicLink()) {
            await fsp.symlink(await fsp.readlink(from), to);
        } else if (s.isDirectory()) {
            await fsp.mkdir(to);
            for (const name of await fsp.readdir(from))
                await copyTree(path.posix.join(from, name), path.posix.join(to, name));
            await fsp.chmod(to, s.mode & 0o777);
        } else {
            await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
        }
    }

    async function removeTree(p) {
        const s = await fsp.lstat(p);
        if (s.isDirectory() && !s.isSymbolicLink()) {
            for (const name of await fsp.readdir(p)) await removeTree(path.posix.join(p, name));
            await fsp.rmdir(p);
        } else {
            await fsp.unlink(p);
        }
    }

    async function prepareTarget(from, to, overwrite, move) {
        if (!(await exists(from))) throw new FileError(E.NOT_FOUND, "No such file or directory: " + from);
        if (inside(to, from)) throw new FileError(E.INVALID, "Cannot " + (move ? "move" : "copy") + " a folder into itself");
        checkWritable(to);
        if (move) checkWritable(from);
        if (await exists(to)) {
            if (!overwrite) throw new FileError(E.EXISTS, "Already exists: " + to);
            await removeTree(to);
        }
    }

    const methods = {
        async list(p) {
            const dir = absolute(p.path);
            const s = await fsp.stat(dir);
            if (!s.isDirectory()) throw new FileError(E.NOT_DIR, "Not a folder: " + dir);
            const names = await fsp.readdir(dir);
            const entries = [];
            for (const name of names) {
                try { entries.push(await entry(path.posix.join(dir, name))); } catch (e) { /* vanished meanwhile */ }
            }
            return ok({ path: dir, entries });
        },

        async stat(p) {
            return ok({ entry: await entry(absolute(p.path), true) });
        },

        async mkdir(p) {
            const dir = absolute(p.path);
            checkWritable(dir);
            await fsp.mkdir(dir);
            return ok({ path: dir });
        },

        async copy(p) {
            const from = absolute(p.from, "from"), to = absolute(p.to, "to");
            await prepareTarget(from, to, !!p.overwrite, false);
            await copyTree(from, to);
            return ok({ path: to });
        },

        async move(p) {
            const from = absolute(p.from, "from"), to = absolute(p.to, "to");
            await prepareTarget(from, to, !!p.overwrite, true);
            try {
                await fsp.rename(from, to);
            } catch (e) {
                if (e.code !== "EXDEV") throw e;
                // Another filesystem (e.g. /tmp to /media/internal): copy, then remove.
                await copyTree(from, to);
                await removeTree(from);
            }
            return ok({ path: to });
        },

        async remove(p) {
            const target = absolute(p.path);
            checkWritable(target);
            const s = await fsp.lstat(target);
            if (s.isDirectory() && !s.isSymbolicLink()) {
                if (p.recursive) await removeTree(target);
                else await fsp.rmdir(target);
            } else {
                await fsp.unlink(target);
            }
            return ok({ path: target });
        },

        async read(p) {
            const file = absolute(p.path);
            const encoding = p.encoding || "utf8";
            if (encoding !== "utf8" && encoding !== "base64") throw new FileError(E.BAD_PARAMS, "encoding must be utf8 or base64");
            const limit = p.maxBytes > 0 ? p.maxBytes : READ_LIMIT;
            const s = await fsp.stat(file);
            if (s.isDirectory()) throw new FileError(E.IS_DIR, "Is a folder: " + file);
            if (s.size > limit) throw new FileError(E.TOO_LARGE, "File is larger than " + limit + " bytes");
            const data = await fsp.readFile(file);
            return ok({ path: file, data: data.toString(encoding), encoding, size: data.length });
        },

        async write(p) {
            const file = absolute(p.path);
            const encoding = p.encoding || "utf8";
            if (typeof p.data !== "string") throw new FileError(E.BAD_PARAMS, "data is required");
            if (encoding !== "utf8" && encoding !== "base64") throw new FileError(E.BAD_PARAMS, "encoding must be utf8 or base64");
            checkWritable(file);
            const bytes = Buffer.from(p.data, encoding);
            if (bytes.length > READ_LIMIT) throw new FileError(E.TOO_LARGE, "Data is larger than " + READ_LIMIT + " bytes");
            try {
                if ((await fsp.stat(file)).isDirectory()) throw new FileError(E.IS_DIR, "Is a folder: " + file);
            } catch (e) {
                if (e instanceof FileError || e.code !== "ENOENT") throw e;
            }
            await fsp.writeFile(file, bytes, { flag: p.overwrite === false ? "wx" : "w" });
            return ok({ path: file, size: bytes.length });
        },
    };

    // Every method resolves to a reply, never rejects.
    const api = {};
    for (const name of Object.keys(methods)) {
        api[name] = (payload) => methods[name](payload || {}).catch(failure);
    }
    return api;
}

module.exports = { createFileManager, ERRORS: E, METHODS: ["list", "stat", "mkdir", "copy", "move", "remove", "read", "write"] };
