// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An SFTP drive: a folder of any SSH server (a NAS, a VPS, a Raspberry Pi,
// a Phoenix device in Developer Mode) as a place in Files, over the kit's
// sockets (ctx.net; a device's TCP, the simulator's relay to this
// computer's network) with Phoenix's own SSH client (lib/ssh). Signed in
// with a password or a key (Ed25519 made on the device, or one imported);
// the server's host key is pinned when the account is made (its
// fingerprint shown and trusted on first use) and a different one is
// refused, loudly, until the account is signed in again.
//
//   list, stat   OPENDIR / READDIR, STAT (symbolic links followed)
//   download     READs pipelined, a chunk at a time (ranged reads)
//   upload       WRITEs pipelined, a chunk at a time, into a hidden
//                ".name.phoenix-part" beside the file, then renamed over it
//                (posix-rename@openssh.com where offered), so a cancelled or
//                broken upload never leaves half a file in its place
//   mkdir        MKDIR; move: RENAME (posix-rename to replace)
//   copy         copy-data on the server where offered (OpenSSH 9.0 and
//                later), else read and written back through the device
//   remove       REMOVE, RMDIR (a folder with what is in it)
//   quota        statvfs@openssh.com: the file system of the drive's folder
//
// Connections are kept per account for a minute after the last call (one
// SSH session, one SFTP channel), so browsing does not sign in each time.

"use strict";

var kit = require("@phoenix/connector-kit");
var client = require("./ssh/client");
var sftpLib = require("./ssh/sftp");
var K = require("./ssh/keys");
var W = require("./ssh/wire");

var E = kit.FILE_ERRORS;
var ST = sftpLib.STATUS;
var OPEN = sftpLib.OPEN;
var IDLE_MS = 60 * 1000;

// ---- Errors -----------------------------------------------------------------------------------

function fileError(code, message, extra) { return Object.assign(kit.fileError(code, message), extra || {}); }

// An SFTP status, a lost connection or an SSH failure -> the file manager's
// error (code), with the account's error code (errorCode: what a sync puts
// on the account in Accounts; a changed host key asks to sign in again).
function mapError(e, what) {
    if (!e) return fileError(E.IO, what + " failed");
    if (typeof e.code === "number" && e.code !== 9) return e;
    if (e.errorCode === "SFTP_STATUS") {
        var m = what + ": " + e.message.replace(/^[^:]*: /, "");
        if (e.status === ST.NO_SUCH_FILE) return fileError(E.NOT_FOUND, m);
        if (e.status === ST.PERMISSION_DENIED) return fileError(E.PERMISSION, m);
        if (e.status === ST.OP_UNSUPPORTED) return fileError(E.UNSUPPORTED, m);
        if (e.status === ST.NO_CONNECTION || e.status === ST.CONNECTION_LOST)
            return fileError(E.OFFLINE, "The connection to the server was lost (" + what + "). Try again.", { reason: "CONNECTION_LOST", errorCode: "CONNECTION_FAILED" });
        return fileError(E.IO, m);
    }
    if (e.errorCode === "HOST_KEY_CHANGED" || e.errorCode === "HOST_KEY_UNKNOWN")
        return fileError(E.AUTH, e.message, { reason: e.errorCode, hostKey: e.hostKey, errorCode: "401_UNAUTHORIZED" });
    if (e.errorCode === "401_UNAUTHORIZED") return fileError(E.AUTH, e.message, { reason: "401_UNAUTHORIZED", errorCode: "401_UNAUTHORIZED" });
    if (e.errorCode === "503_SERVICE_UNAVAILABLE")
        return fileError(E.RATE_LIMITED, e.message, { reason: "503_SERVICE_UNAVAILABLE", errorCode: "503_SERVICE_UNAVAILABLE", retryAt: e.retryAt });
    if (e.errorCode === "SFTP_NOT_AVAILABLE") return fileError(E.UNSUPPORTED, e.message, { reason: "SFTP_NOT_AVAILABLE", errorCode: "UNSUPPORTED_CAPABILITY" });
    if (e.errorCode === "CONNECTION_TIMEOUT")
        return fileError(E.OFFLINE, "The server did not answer in time. Try again.", { reason: "CONNECTION_TIMEOUT", errorCode: "CONNECTION_TIMEOUT" });
    if (e.errorCode === "SSH_DISCONNECTED" && !e.reason)
        return fileError(E.OFFLINE, "The connection to the server was lost. Try again.", { reason: "CONNECTION_LOST", errorCode: "CONNECTION_FAILED" });
    return e;
}

// ---- Host keys --------------------------------------------------------------------------------

// The pinned key's algorithms first, so a server with several keys answers
// with the one trusted (as OpenSSH orders by known_hosts).
function hostKeyOrder(pinned) {
    var all = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "rsa-sha2-512", "rsa-sha2-256"];
    if (!pinned || !pinned.type) return all;
    var first = K.SIG_ALGS[pinned.type] || [];
    return first.concat(all.filter(function (a) { return first.indexOf(a) < 0; }));
}

function changedError(pinned, info, host) {
    var e = new Error("WARNING: the key of " + host + " has changed. It was " + pinned.fingerprint + " and is now " + info.fingerprint +
                      ". Someone could be intercepting the connection, or the server was reinstalled. Phoenix will not connect until " +
                      "you check with the server's owner and sign in to the account again to trust the new key.");
    e.errorCode = "HOST_KEY_CHANGED";
    e.hostKey = { algorithm: info.algorithm, type: info.type, key: info.key, fingerprint: info.fingerprint, description: info.description };
    e.previous = pinned;
    return e;
}

// verifyHostKey for a pinned key {type, key (Base64 blob), fingerprint}.
function pinnedVerifier(pinned, host) {
    return function (info) {
        if (!pinned || !pinned.key) {
            var u = new Error("The server's key was not trusted yet: sign in to the account again");
            u.errorCode = "HOST_KEY_UNKNOWN";
            u.hostKey = info;
            throw u;
        }
        if (info.key === pinned.key) return true;
        throw changedError(pinned, info, host);
    };
}

// ---- Connections ------------------------------------------------------------------------------

var pool = {};

function connectionKey(o) {
    return [o.accountId || "", o.host, o.port, o.user, o.password ? "pw" : "", o.key ? K.fingerprint(K.publicBlob(o.key)) : "",
            o.hostKey ? o.hostKey.key : ""].join("|");
}

/**
 * An SFTP session for o: {net, host, port, user, password?, key?, hostKey,
 * accountId?, log?}, kept for reuse -> Promise<{sftp, client}>.
 */
function session(o) {
    var id = connectionKey(o);
    var p = pool[id];
    if (p && !p.dead) { touch(id); return p.ready; }
    var entry = { dead: false, timer: null };
    pool[id] = entry;
    entry.ready = client.connect({
        net: o.net, host: o.host, port: o.port, username: o.user, password: o.password, key: o.key,
        verifyHostKey: o.verifyHostKey || pinnedVerifier(o.hostKey, o.host), hostKeyAlgorithms: hostKeyOrder(o.hostKey), log: o.log,
        now: o.now, timers: o.timers
    }).then(function (c) {
        entry.client = c;
        c.onClose(function () { drop(id, entry); });
        return c.openSubsystem("sftp").then(function (ch) {
            return sftpLib.createSftp(ch);
        }).then(function (s) {
            entry.sftp = s;
            touch(id);
            return { client: c, sftp: s };
        }, function (e) { c.close(); throw e; });
    }, function (e) { drop(id, entry); throw e; });
    entry.ready.catch(function () { drop(id, entry); });
    return entry.ready;
}

function touch(id) {
    var e = pool[id];
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(function () { drop(id, e, true); }, IDLE_MS);
    if (e.timer && e.timer.unref) e.timer.unref();
}

function drop(id, entry, close) {
    if (entry.dead) return;
    entry.dead = true;
    if (entry.timer) clearTimeout(entry.timer);
    if (pool[id] === entry) delete pool[id];
    if (close && entry.client) { try { entry.client.close(); } catch (e) { /* gone */ } }
}

/** Closes the connections of an account (signed out, removed, credentials changed). */
function closeAccount(accountId) {
    Object.keys(pool).forEach(function (id) { if (id.indexOf(accountId + "|") === 0) drop(id, pool[id], true); });
}

// ---- The drive --------------------------------------------------------------------------------

function timersOf(ctx) {
    return { setTimeout: function (fn, ms) { return ctx.setTimeout(fn, ms); }, clearTimeout: function (h) { return ctx.clearTimeout(h); } };
}

function joinRemote(root, p) {
    if (p === "/") return root;
    return (root === "/" ? "" : root.replace(/\/+$/, "")) + p;
}

/**
 * opts: {host, port, user, password?, key? (parsed), hostKey {type, key,
 * fingerprint}, root (the drive's folder on the server, absolute),
 * accountId}.
 */
function createSftpDrive(ctx, opts) {
    var root = opts.root || "/";
    var conn = { net: ctx.net, host: opts.host, port: opts.port || 22, user: opts.user, password: opts.password, key: opts.key,
                 hostKey: opts.hostKey, accountId: opts.accountId, log: function (m) { ctx.log("sftp " + opts.host + ": " + m); },
                 now: function () { return ctx.now(); }, timers: timersOf(ctx) };

    // fn(sftp) on the account's session; a lost connection once more on a
    // fresh one for what changes nothing (list, stat, reads).
    function run(what, fn, retry) {
        return session(conn).then(function (s) { return fn(s.sftp); }).catch(function (e) {
            if (retry !== false && isLost(e)) {
                closeAccount(conn.accountId || "");
                return session(conn).then(function (s) { return fn(s.sftp); });
            }
            throw e;
        }).catch(function (e) { throw mapError(e, what); });
    }
    function isLost(e) {
        return e && (e.errorCode === "SSH_DISCONNECTED" || (e.errorCode === "SFTP_STATUS" && (e.status === ST.CONNECTION_LOST || e.status === ST.NO_CONNECTION)) ||
                     e.code === "ECONNRESET" || e.code === "EPIPE");
    }

    function entryOf(p, name, a) {
        var dir = !!a.isDirectory;
        var e = { name: name, path: p, type: dir ? "directory" : "file", size: dir ? 0 : a.size || 0, mtime: (a.mtime || 0) * 1000 };
        if (a.mode !== undefined) e.mode = a.mode & 4095;
        if (!dir) e.mimeType = kit.mimeOfName(name);
        return e;
    }

    function statPath(s, p) {
        return s.stat(joinRemote(root, p)).then(function (a) {
            var name = p === "/" ? "" : kit.driveName(p);
            return entryOf(p, name, a);
        });
    }

    function exists(s, p) {
        return s.lstat(joinRemote(root, p)).then(function () { return true; }, function (e) {
            if (e.errorCode === "SFTP_STATUS" && e.status === ST.NO_SUCH_FILE) return false;
            throw e;
        });
    }

    function removeTree(s, p) {
        var remote = joinRemote(root, p);
        return s.lstat(remote).then(function (a) {
            if (!a.isDirectory) return s.remove(remote);
            return s.listdir(remote).then(function (names) {
                return names.reduce(function (chain, n) {
                    return chain.then(function () { return removeTree(s, kit.driveJoin(p, n.name)); });
                }, Promise.resolve());
            }).then(function () { return s.rmdir(remote); });
        });
    }

    // A rename that may replace: posix-rename where offered; else the old
    // file goes first (a folder is never replaced).
    function rename(s, from, to, overwrite) {
        var a = joinRemote(root, from), b = joinRemote(root, to);
        if (!overwrite) {
            return exists(s, to).then(function (there) {
                if (there) throw fileError(E.EXISTS, "Already exists: " + to);
                return s.rename(a, b);
            });
        }
        if (s.extensions["posix-rename@openssh.com"]) return s.posixRename(a, b);
        return s.lstat(b).then(function (t) {
            if (t.isDirectory) throw fileError(E.EXISTS, "A folder is in the way: " + to);
            return s.remove(b);
        }, function () { return null; }).then(function () { return s.rename(a, b); });
    }

    function copyFile(s, from, to) {
        var a = joinRemote(root, from), b = joinRemote(root, to);
        return s.open(a, OPEN.READ).then(function (src) {
            return s.open(b, OPEN.WRITE | OPEN.CREAT | OPEN.TRUNC).then(function (dst) {
                var copied;
                if (s.extensions["copy-data"]) copied = s.copyData(src, dst);
                else {
                    // Through the device, 4 MB at a time.
                    copied = s.fstat(src).then(function (st) {
                        var size = st.size || 0, off = 0;
                        function next() {
                            if (off >= size) return null;
                            var n = Math.min(4 * 1024 * 1024, size - off);
                            return s.readRange(src, off, n).then(function (bytes) {
                                var at = off;
                                off += Math.max(bytes.length, 1);
                                return bytes.length ? s.writeAll(dst, at, bytes).then(next) : null;
                            });
                        }
                        return next();
                    });
                }
                function closeBoth() { return Promise.all([s.close(src).catch(function () {}), s.close(dst).catch(function () {})]); }
                return copied.then(closeBoth, function (e) { return closeBoth().then(function () { throw e; }); });
            });
        });
    }

    function copyTree(s, from, to) {
        return s.stat(joinRemote(root, from)).then(function (a) {
            if (!a.isDirectory) return copyFile(s, from, to);
            return s.mkdir(joinRemote(root, to)).then(function () { return s.listdir(joinRemote(root, from)); }).then(function (names) {
                return names.reduce(function (chain, n) {
                    return chain.then(function () { return copyTree(s, kit.driveJoin(from, n.name), kit.driveJoin(to, n.name)); });
                }, Promise.resolve());
            });
        });
    }

    var drive = {
        list: function (p) {
            return run("list " + p, function (s) {
                var remote = joinRemote(root, p);
                return s.listdir(remote).catch(function (e) {
                    // OpenSSH answers FAILURE for a file: is it one?
                    if (e.errorCode === "SFTP_STATUS" && e.status === ST.FAILURE) {
                        return s.stat(remote).then(function (a) {
                            if (!a.isDirectory) throw fileError(E.NOT_DIR, "Not a folder: " + p);
                            throw e;
                        });
                    }
                    throw e;
                }).then(function (names) {
                    // A link is shown as what it points to (a broken one as a file).
                    return Promise.all(names.map(function (n) {
                        var path = kit.driveJoin(p, n.name);
                        if (!n.attrs.isSymlink) return entryOf(path, n.name, n.attrs);
                        return s.stat(remote.replace(/\/$/, "") + "/" + n.name).then(function (a) { return entryOf(path, n.name, a); },
                                                                                      function () { return entryOf(path, n.name, { size: 0 }); });
                    }));
                });
            });
        },

        stat: function (p) { return run("stat " + p, function (s) { return statPath(s, p); }); },

        download: function (entry, sink, o) {
            return run("download " + entry.path, function (s) {
                return s.open(joinRemote(root, entry.path), OPEN.READ).then(function (h) {
                    var done = 0, size = entry.size;
                    o.onProgress(0, size);
                    function next() {
                        if (o.signal.aborted) throw fileError(E.CANCELED, "Cancelled");
                        if (done >= size) return null;
                        var n = Math.min(o.chunkSize, size - done);
                        return s.readRange(h, done, n).then(function (bytes) {
                            if (!bytes.length) return null;     // the file got shorter
                            return sink.write(bytes).then(function () {
                                done += bytes.length;
                                o.onProgress(done, size);
                                return next();
                            });
                        });
                    }
                    return next().then(function () { return s.close(h).catch(function () {}); },
                                       function (e) { return s.close(h).catch(function () {}).then(function () { throw e; }); });
                });
            }, false);
        },

        upload: function (p, source, o) {
            var dir = kit.driveParent(p), name = kit.driveName(p);
            var part = kit.driveJoin(dir, "." + name + ".phoenix-part");
            return run("upload " + p, function (s) {
                var check = o.overwrite ? Promise.resolve(false) : exists(s, p);
                return check.then(function (there) {
                    if (there) throw fileError(E.EXISTS, "Already exists: " + p);
                    return s.open(joinRemote(root, part), OPEN.WRITE | OPEN.CREAT | OPEN.TRUNC);
                }).then(function (h) {
                    var written = kit.forEachChunk(source, o, function (bytes, offset) { return s.writeAll(h, offset, bytes); }).then(function () {
                        return s.extensions["fsync@openssh.com"] ? s.fsync(h).catch(function () {}) : null;
                    });
                    return written.then(function () { return s.close(h); }, function (e) {
                        return s.close(h).catch(function () {}).then(function () { return s.remove(joinRemote(root, part)).catch(function () {}); })
                            .then(function () { throw e; });
                    });
                }).then(function () {
                    return rename(s, part, p, o.overwrite).catch(function (e) {
                        return s.remove(joinRemote(root, part)).catch(function () {}).then(function () {
                            if (e.code === E.EXISTS) throw e;
                            return exists(s, p).then(function (there) { throw there && !o.overwrite ? fileError(E.EXISTS, "Already exists: " + p) : e; });
                        });
                    });
                }).then(function () { return statPath(s, p); });
            }, false);
        },

        mkdir: function (p) {
            return run("make " + p, function (s) {
                return s.mkdir(joinRemote(root, p)).catch(function (e) {
                    return exists(s, p).then(function (there) {
                        if (there) throw fileError(E.EXISTS, "Already exists: " + p);
                        return exists(s, kit.driveParent(p)).then(function (up) {
                            if (!up) throw fileError(E.NOT_FOUND, "No such folder: " + kit.driveParent(p));
                            throw e;
                        });
                    });
                }).then(function () { return statPath(s, p); });
            }, false);
        },

        move: function (from, to, o) {
            return run("move " + from, function (s) {
                return exists(s, from).then(function (there) {
                    if (!there) throw fileError(E.NOT_FOUND, "No such file or folder: " + from);
                    return rename(s, from, to, o.overwrite);
                });
            }, false);
        },

        copy: function (from, to, o) {
            return run("copy " + from, function (s) {
                return Promise.all([exists(s, from), exists(s, to)]).then(function (r) {
                    if (!r[0]) throw fileError(E.NOT_FOUND, "No such file or folder: " + from);
                    if (r[1] && !o.overwrite) throw fileError(E.EXISTS, "Already exists: " + to);
                    return (r[1] ? removeTree(s, to) : Promise.resolve()).then(function () { return copyTree(s, from, to); });
                });
            }, false);
        },

        remove: function (p) {
            return run("remove " + p, function (s) { return removeTree(s, p); }, false);
        },

        quota: function () {
            return run("quota", function (s) {
                if (!s.extensions["statvfs@openssh.com"]) throw fileError(E.UNSUPPORTED, "This server does not say how full it is");
                return s.statvfs(root).then(function (f) {
                    var unit = f.frsize || f.bsize;
                    // As df: used = blocks - free; total what the user can fill.
                    return { used: (f.blocks - f.bfree) * unit, total: (f.blocks - f.bfree + f.bavail) * unit };
                });
            });
        }
    };
    return drive;
}

/**
 * Connects once to see the server's key (the sign-in page shows its
 * fingerprint to trust): -> {algorithm, type, key, fingerprint, description}.
 * The key is checked against the server's own signature of the key
 * exchange; nothing is signed in.
 */
function probeHostKey(ctx, o) {
    var seen = null;
    var stop = new Error("seen");
    stop.errorCode = "HOST_KEY_SEEN";
    return client.connect({
        net: ctx.net, host: o.host, port: o.port || 22, username: "", hostKeyAlgorithms: hostKeyOrder(o.prefer),
        verifyHostKey: function (info) { seen = info; throw stop; }, log: function (m) { ctx.log("sftp " + o.host + ": " + m); },
        now: function () { return ctx.now(); }, timers: timersOf(ctx)
    }).then(function () { return seen; }, function (e) {
        if (seen) return { algorithm: seen.algorithm, type: seen.type, key: seen.key, fingerprint: seen.fingerprint, description: seen.description };
        throw e;
    });
}

module.exports = { createSftpDrive: createSftpDrive, probeHostKey: probeHostKey, session: session, closeAccount: closeAccount, mapError: mapError,
                   timersOf: timersOf,
                   hostKeyOrder: hostKeyOrder, pinnedVerifier: pinnedVerifier, joinRemote: joinRemote, _pool: pool, base64: W.base64 };
