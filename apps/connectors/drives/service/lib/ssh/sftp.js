// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An SFTP client, protocol version 3 (draft-ietf-secsh-filexfer-02: what
// OpenSSH's sftp-server and nearly every server speak), over an SSH
// channel (client.js), with the extensions OpenSSH's server offers
// (OpenSSH PROTOCOL 4.x): posix-rename@openssh.com (a rename that replaces),
// statvfs@openssh.com (how full the disk is), fsync@openssh.com,
// limits@openssh.com (how large a read or write may be), and copy-data
// (draft-ietf-secsh-filexfer-extensions-00 7: a copy on the server).
//
// Requests are pipelined: readRange and writeAll keep many READs and
// WRITEs in flight (as OpenSSH's sftp client does, 64 of 32 KB), each
// answered by its id; a short read is asked again from where it stopped.
//
//   createSftp(channel) -> Promise<sftp>   (INIT / VERSION done)
//   sftp.realpath(p) stat(p) lstat(p) opendir(p) readdir(h) close(h)
//   sftp.open(p, flags, attrs?) read(h, offset, len) write(h, offset, bytes)
//   sftp.readRange(h, offset, length, onBytes?) -> Promise<Uint8Array | count>
//   sftp.writeAll(h, offset, bytes)  mkdir(p) rmdir(p) remove(p) rename(a, b)
//   sftp.posixRename(a, b) statvfs(p) fsync(h) copyData(from, to) listdir(p)
//   sftp.extensions {name: version}   sftp.end()
//
// Failures reject with an error with status (the SFTP status code) and
// errorCode "SFTP_STATUS"; a lost connection with the channel's error.

"use strict";

var W = require("./wire");

var FXP = {
    INIT: 1, VERSION: 2, OPEN: 3, CLOSE: 4, READ: 5, WRITE: 6, LSTAT: 7, FSTAT: 8, SETSTAT: 9, FSETSTAT: 10, OPENDIR: 11, READDIR: 12,
    REMOVE: 13, MKDIR: 14, RMDIR: 15, REALPATH: 16, STAT: 17, RENAME: 18, READLINK: 19, SYMLINK: 20,
    STATUS: 101, HANDLE: 102, DATA: 103, NAME: 104, ATTRS: 105, EXTENDED: 200, EXTENDED_REPLY: 201
};
var STATUS = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, PERMISSION_DENIED: 3, FAILURE: 4, BAD_MESSAGE: 5, NO_CONNECTION: 6, CONNECTION_LOST: 7, OP_UNSUPPORTED: 8 };
var OPEN = { READ: 1, WRITE: 2, APPEND: 4, CREAT: 8, TRUNC: 16, EXCL: 32 };
var ATTR = { SIZE: 1, UIDGID: 2, PERMISSIONS: 4, ACMODTIME: 8, EXTENDED: 0x80000000 };
var S_IFMT = 0xf000, S_IFDIR = 0x4000, S_IFLNK = 0xa000, S_IFREG = 0x8000;

// OpenSSH's sftp client's defaults: 32 KB a request, 64 in flight.
var IO_SIZE = 32768;
var IN_FLIGHT = 64;
// The largest message taken from a server (OpenSSH's SFTP_MAX_MSG_LENGTH).
var MAX_MESSAGE = 256 * 1024 + 1024;

function statusError(code, message, what) {
    var e = new Error((what ? what + ": " : "") + (message || "SFTP status " + code));
    e.errorCode = "SFTP_STATUS";
    e.status = code;
    return e;
}

function readAttrs(r) {
    var flags = r.uint32();
    var a = { flags: flags };
    if (flags & ATTR.SIZE) a.size = r.uint64();
    if (flags & ATTR.UIDGID) { a.uid = r.uint32(); a.gid = r.uint32(); }
    if (flags & ATTR.PERMISSIONS) a.mode = r.uint32();
    if (flags & ATTR.ACMODTIME) { a.atime = r.uint32(); a.mtime = r.uint32(); }
    if (flags & ATTR.EXTENDED) {
        var n = r.uint32();
        for (var i = 0; i < n; i++) { r.string(); r.string(); }
    }
    if (a.mode !== undefined) {
        var fmt = a.mode & S_IFMT;
        a.isDirectory = fmt === S_IFDIR;
        a.isSymlink = fmt === S_IFLNK;
        a.isFile = fmt === S_IFREG;
    }
    return a;
}

function writeAttrs(w, a) {
    a = a || {};
    var flags = 0;
    if (a.size !== undefined) flags |= ATTR.SIZE;
    if (a.mode !== undefined) flags |= ATTR.PERMISSIONS;
    if (a.mtime !== undefined) flags |= ATTR.ACMODTIME;
    w.uint32(flags);
    if (a.size !== undefined) w.uint64(a.size);
    if (a.mode !== undefined) w.uint32(a.mode);
    if (a.mtime !== undefined) w.uint32(a.atime !== undefined ? a.atime : a.mtime).uint32(a.mtime);
    return w;
}

function createSftp(channel, opts) {
    opts = opts || {};
    var inbuf = [], inlen = 0;
    var pending = {};
    var nextId = 1;
    var versionWaiter = null;
    var dead = null;
    var api;

    function onBytes(b) {
        inbuf.push(b);
        inlen += b.length;
        for (;;) {
            if (inlen < 4) return;
            var head = take(4, true);
            var len = new W.Reader(head).uint32();
            if (len > MAX_MESSAGE || len < 1) { lost(statusError(STATUS.BAD_MESSAGE, "The server sent an SFTP message of " + len + " bytes")); return; }
            if (inlen < 4 + len) return;
            take(4, false);
            handle(take(len, false));
        }
    }
    function take(n, peekOnly) {
        var out = new Uint8Array(n), off = 0, i = 0;
        while (off < n) {
            var c = inbuf[i], k = Math.min(c.length, n - off);
            out.set(c.subarray(0, k), off);
            off += k;
            if (!peekOnly) {
                if (k === c.length) { inbuf.shift(); } else { inbuf[0] = c.subarray(k); }
            } else i++;
        }
        if (!peekOnly) inlen -= n;
        return out;
    }

    function handle(msg) {
        var r = new W.Reader(msg);
        var type = r.byte();
        if (type === FXP.VERSION) {
            var version = r.uint32();
            var ext = {};
            while (r.left()) { var name = W.latin1(r.string()); ext[name] = W.latin1(r.string()); }
            if (versionWaiter) versionWaiter(version, ext);
            return;
        }
        var id = r.uint32();
        var p = pending[id];
        if (!p) return;
        delete pending[id];
        p.done(type, r);
    }

    function lost(err) {
        if (dead) return;
        dead = err || statusError(STATUS.CONNECTION_LOST, "The connection to the server was lost");
        if (!dead.code && !dead.status) dead.code = "ECONNRESET";
        Object.keys(pending).forEach(function (id) { var p = pending[id]; delete pending[id]; p.fail(dead); });
        if (versionWaiter) versionWaiter(null, null, dead);
        try { channel.close(); } catch (e) { /* gone */ }
    }

    channel.onData(onBytes);
    channel.onClose(function (err) { lost(err); });

    function send(type, build) {
        var w = new W.Writer(64).uint32(0).byte(type);
        var id = nextId;
        nextId = (nextId + 1) >>> 0 || 1;
        w.uint32(id);
        if (build) build(w);
        var b = w.bytes();
        var len = b.length - 4;
        b[0] = (len >>> 24) & 255; b[1] = (len >>> 16) & 255; b[2] = (len >>> 8) & 255; b[3] = len & 255;
        return { id: id, bytes: b };
    }

    // One request -> the reply parsed by expect(type, reader).
    function request(type, build, expect, what) {
        if (dead) return Promise.reject(dead);
        var m = send(type, build);
        return new Promise(function (resolve, reject) {
            pending[m.id] = {
                done: function (rtype, r) {
                    if (rtype === FXP.STATUS) {
                        var code = r.uint32(), text = "";
                        try { text = r.text(); } catch (e) { text = ""; }
                        if (expect.status && code === STATUS.OK) return resolve(true);
                        if (expect.eof && code === STATUS.EOF) return resolve(null);
                        return reject(statusError(code, text, what));
                    }
                    try { resolve(expect(rtype, r)); } catch (e) { reject(e); }
                },
                fail: reject
            };
            try { channel.write(m.bytes); } catch (e) { delete pending[m.id]; reject(e); }
        });
    }

    function statusOnly() { var f = function () { throw statusError(STATUS.BAD_MESSAGE, "Unexpected reply"); }; f.status = true; return f; }
    function expectHandle(type, r) { if (type !== FXP.HANDLE) throw statusError(STATUS.BAD_MESSAGE, "Expected a handle"); return r.string().slice(); }
    function expectAttrs(type, r) { if (type !== FXP.ATTRS) throw statusError(STATUS.BAD_MESSAGE, "Expected attributes"); return readAttrs(r); }
    function expectNames(type, r) {
        if (type !== FXP.NAME) throw statusError(STATUS.BAD_MESSAGE, "Expected names");
        var n = r.uint32(), out = [];
        for (var i = 0; i < n; i++) {
            var name = r.text(), long = r.text();
            out.push({ name: name, longname: long, attrs: readAttrs(r) });
        }
        return out;
    }
    var namesOrEof = function (type, r) { return expectNames(type, r); };
    namesOrEof.eof = true;
    var dataOrEof = function (type, r) { if (type !== FXP.DATA) throw statusError(STATUS.BAD_MESSAGE, "Expected data"); return r.string(); };
    dataOrEof.eof = true;
    function expectExtended(type, r) { if (type !== FXP.EXTENDED_REPLY) throw statusError(STATUS.BAD_MESSAGE, "Expected an extended reply"); return r; }

    var path = function (p) { return function (w) { w.string(p); }; };

    function readRange(handle, offset, length, onBytes) {
        // Requests of ioSize, IN_FLIGHT at a time, delivered in order; a
        // short answer is asked again from where it stopped; EOF ends it.
        var size = api.readSize;
        var chunks = onBytes ? null : [];
        var total = 0;
        return new Promise(function (resolve, reject) {
            var next = offset, end = offset + length;
            var slots = [];       // in order: {offset, len, data?, done}
            var inFlight = 0, finished = false, eof = false;
            function issue() {
                while (!finished && !eof && inFlight < IN_FLIGHT && next < end) {
                    var len = Math.min(size, end - next);
                    var slot = { offset: next, len: len, data: null, done: false };
                    slots.push(slot);
                    ask(slot);
                    next += len;
                }
                if (!inFlight && !finished) deliver();
            }
            function ask(slot) {
                inFlight++;
                request(FXP.READ, function (w) { w.string(handle).uint64(slot.offset).uint32(slot.len); }, dataOrEof, "read").then(function (data) {
                    inFlight--;
                    slot.done = true;
                    if (data === null) { eof = true; slot.data = new Uint8Array(0); }
                    else slot.data = data.slice();
                    deliver();
                    issue();
                }, function (e) { inFlight--; finish(e); });
            }
            function deliver() {
                while (slots.length && slots[0].done) {
                    var s = slots.shift();
                    if (s.data.length) {
                        total += s.data.length;
                        if (onBytes) onBytes(s.data); else chunks.push(s.data);
                    }
                    if (s.data.length < s.len && s.data.length > 0 && !eof) {
                        // A short read: the rest of this slot, before what follows.
                        var rest = { offset: s.offset + s.data.length, len: s.len - s.data.length, data: null, done: false };
                        slots.unshift(rest);
                        ask(rest);
                        return;
                    }
                    if (!s.data.length) eof = true;
                }
                if (!slots.length && (eof || next >= end) && !inFlight) finish(null);
            }
            function finish(err) {
                if (finished) return;
                finished = true;
                if (err) return reject(err);
                resolve(onBytes ? total : W.concat(chunks));
            }
            if (length <= 0) return finish(null);
            issue();
        });
    }

    function writeAll(handle, offset, bytes) {
        var size = api.writeSize;
        return new Promise(function (resolve, reject) {
            var pos = 0, inFlight = 0, finished = false;
            function issue() {
                while (!finished && inFlight < IN_FLIGHT && pos < bytes.length) {
                    var part = bytes.subarray(pos, Math.min(bytes.length, pos + size));
                    var at = offset + pos;
                    pos += part.length;
                    inFlight++;
                    request(FXP.WRITE, (function (p, o) { return function (w) { w.string(handle).uint64(o).string(p); }; })(part, at), statusOnly(), "write")
                        .then(function () { inFlight--; if (pos >= bytes.length && !inFlight) done(null); else issue(); },
                              function (e) { inFlight--; done(e); });
                }
            }
            function done(err) {
                if (finished) return;
                finished = true;
                if (err) reject(err); else resolve(bytes.length);
            }
            if (!bytes.length) return done(null);
            issue();
        });
    }

    function extended(name, build, expect, what) {
        return request(FXP.EXTENDED, function (w) { w.string(name); if (build) build(w); }, expect || statusOnly(), what || name);
    }

    api = {
        extensions: {},
        version: 3,
        readSize: IO_SIZE,
        writeSize: IO_SIZE,
        realpath: function (p) { return request(FXP.REALPATH, path(p), expectNames, "realpath " + p).then(function (n) { return n[0].name; }); },
        stat: function (p) { return request(FXP.STAT, path(p), expectAttrs, "stat " + p); },
        lstat: function (p) { return request(FXP.LSTAT, path(p), expectAttrs, "lstat " + p); },
        fstat: function (h) { return request(FXP.FSTAT, function (w) { w.string(h); }, expectAttrs, "fstat"); },
        opendir: function (p) { return request(FXP.OPENDIR, path(p), expectHandle, "opendir " + p); },
        readdir: function (h) { return request(FXP.READDIR, function (w) { w.string(h); }, namesOrEof, "readdir"); },
        close: function (h) { return request(FXP.CLOSE, function (w) { w.string(h); }, statusOnly(), "close"); },
        open: function (p, flags, attrs) {
            return request(FXP.OPEN, function (w) { writeAttrs(w.string(p).uint32(flags), attrs); }, expectHandle, "open " + p);
        },
        read: function (h, offset, len) { return request(FXP.READ, function (w) { w.string(h).uint64(offset).uint32(len); }, dataOrEof, "read"); },
        write: function (h, offset, bytes) { return request(FXP.WRITE, function (w) { w.string(h).uint64(offset).string(bytes); }, statusOnly(), "write"); },
        readRange: readRange,
        writeAll: writeAll,
        mkdir: function (p, attrs) { return request(FXP.MKDIR, function (w) { writeAttrs(w.string(p), attrs); }, statusOnly(), "mkdir " + p); },
        rmdir: function (p) { return request(FXP.RMDIR, path(p), statusOnly(), "rmdir " + p); },
        remove: function (p) { return request(FXP.REMOVE, path(p), statusOnly(), "remove " + p); },
        rename: function (a, b) { return request(FXP.RENAME, function (w) { w.string(a).string(b); }, statusOnly(), "rename " + a); },
        posixRename: function (a, b) { return extended("posix-rename@openssh.com", function (w) { w.string(a).string(b); }, null, "rename " + a); },
        fsync: function (h) { return extended("fsync@openssh.com", function (w) { w.string(h); }); },
        statvfs: function (p) {
            return extended("statvfs@openssh.com", path(p), function (type, r) {
                expectExtended(type, r);
                var f = {};
                ["bsize", "frsize", "blocks", "bfree", "bavail", "files", "ffree", "favail", "fsid", "flag", "namemax"].forEach(function (k) { f[k] = r.uint64(); });
                return f;
            }, "statvfs " + p);
        },
        // The whole of one open file into another (copy-data's length 0: to the end).
        copyData: function (from, to) {
            return extended("copy-data", function (w) { w.string(from).uint64(0).uint64(0).string(to).uint64(0); }, null, "copy");
        },
        // Every entry of a folder (without . and ..).
        listdir: function (p) {
            return api.opendir(p).then(function (h) {
                var all = [];
                function more() {
                    return api.readdir(h).then(function (names) {
                        if (!names) return all;
                        names.forEach(function (n) { if (n.name !== "." && n.name !== "..") all.push(n); });
                        return more();
                    });
                }
                return more().then(function (r) { return api.close(h).catch(function () {}).then(function () { return r; }); },
                                   function (e) { return api.close(h).catch(function () {}).then(function () { throw e; }); });
            });
        },
        get dead() { return dead; },
        // The session (close(h) is a handle's).
        end: function () { lost(statusError(STATUS.NO_CONNECTION, "Closed")); }
    };

    return new Promise(function (resolve, reject) {
        versionWaiter = function (version, ext, err) {
            versionWaiter = null;
            if (err) return reject(err);
            if (version < 3) return reject(statusError(STATUS.OP_UNSUPPORTED, "The server speaks SFTP " + version + "; Phoenix needs 3"));
            api.version = version;
            api.extensions = ext || {};
            resolve(api);
        };
        var init = new W.Writer().uint32(5).byte(FXP.INIT).uint32(3).bytes();
        try { channel.write(init); } catch (e) { reject(e); }
    }).then(function (sftp) {
        if (!sftp.extensions["limits@openssh.com"]) return sftp;
        return extended("limits@openssh.com", null, function (type, r) {
            expectExtended(type, r);
            return { packet: r.uint64(), read: r.uint64(), write: r.uint64(), handles: r.uint64() };
        }).then(function (l) {
            // Larger requests where the server says it takes them (up to 255 KB).
            if (l.read) sftp.readSize = Math.max(4096, Math.min(l.read, opts.maxIo || 64 * 1024));
            if (l.write) sftp.writeSize = Math.max(4096, Math.min(l.write, opts.maxIo || 64 * 1024));
            sftp.limits = l;
            return sftp;
        }, function () { return sftp; });
    });
}

module.exports = { createSftp: createSftp, FXP: FXP, STATUS: STATUS, OPEN: OPEN, ATTR: ATTR, S_IFDIR: S_IFDIR, S_IFREG: S_IFREG, S_IFLNK: S_IFLNK,
                   readAttrs: readAttrs, writeAttrs: writeAttrs, statusError: statusError };
