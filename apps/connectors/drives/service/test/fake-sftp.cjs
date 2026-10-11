// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in SSH server with SFTP for the SFTP drive's tests and the
// simulator's demo server (files.example): the protocol, not a simulation
// of the account. The SSH side is the client's own transport in its
// server role (lib/ssh/transport.js: key exchange, an Ed25519 host key,
// strict key exchange, ext-info), user authentication (RFC 4252: none,
// password, publickey with its query and signature, keyboard-interactive)
// and session channels with the "sftp" subsystem (RFC 4254, windows
// honoured both ways); the SFTP side is version 3 over a folder tree in
// memory, with OpenSSH's extensions (posix-rename, statvfs, fsync, limits,
// copy-data) and its status codes (sftp-server.c errno_to_portable).
// tools/test-sftp.cjs checks the client against OpenSSH's own sshd and
// sftp-server.
//
//   var s = createFakeSftp({users: {name: {password?, keys?: [public key line]}}, files?: {path: bytes | "dir"}})
//   s.socket() -> a NetSocket (binary) for the client, over a pipe in memory
//   s.net()    -> Environment.net for the kit (connect to s.host only)
//   s.listen(port?) -> Promise<port> (Node: a real TCP server)   s.stop()
//   s.hostKey {algorithm, blob, key, fingerprint}   s.files   s.read(path)   s.write(path, bytes)
//   s.unauthorized(on)  s.throttle(seconds)  s.requests()   (the conformance suite's)
//   s.dropConnections()   s.sessions()   s.request (HTTP: none; for the suite)

"use strict";

var W = require("../lib/ssh/wire");
var K = require("../lib/ssh/keys");
var T = require("../lib/ssh/transport");
var F = require("../lib/ssh/sftp");

var M = {
    SERVICE_REQUEST: 5, SERVICE_ACCEPT: 6, USERAUTH_REQUEST: 50, USERAUTH_FAILURE: 51, USERAUTH_SUCCESS: 52, USERAUTH_BANNER: 53,
    USERAUTH_PK_OK: 60, USERAUTH_INFO_REQUEST: 60, USERAUTH_INFO_RESPONSE: 61, GLOBAL_REQUEST: 80, REQUEST_FAILURE: 82,
    CHANNEL_OPEN: 90, CHANNEL_OPEN_CONFIRMATION: 91, CHANNEL_OPEN_FAILURE: 92, CHANNEL_WINDOW_ADJUST: 93, CHANNEL_DATA: 94,
    CHANNEL_EOF: 96, CHANNEL_CLOSE: 97, CHANNEL_REQUEST: 98, CHANNEL_SUCCESS: 99, CHANNEL_FAILURE: 100
};
var FX = F.FXP, ST = F.STATUS;
var WINDOW = 2 * 1024 * 1024, PACKET = 32768;

// ---- A pipe: two sockets in memory -------------------------------------------------------------

// The next turn of the event loop, as I/O comes (not a microtask: a
// transfer must let timers run between its packets, as on a socket).
var later = typeof setImmediate === "function" ? setImmediate : (function () {
    if (typeof MessageChannel !== "function") return function (fn) { setTimeout(fn, 0); };
    var ch = new MessageChannel(), fns = [];
    ch.port1.onmessage = function () { var f = fns.shift(); if (f) f(); };
    return function (fn) { fns.push(fn); ch.port2.postMessage(0); };
})();

// As TCP: bytes arrive asynchronously and in order; what comes before the
// other side listens waits for it; what was written before a close is
// still delivered, then the close.
function pipe() {
    function end(name) {
        return { name: name, dataFns: [], closeFns: [], closed: false, queue: [], flushing: false, closeDue: false };
    }
    var a = end("client"), b = end("server");
    function flushSoon(to) {
        if (to.flushing) return;
        to.flushing = true;
        later(function flush() {
            if (!to.dataFns.length) { to.flushing = false; return; }
            var q = to.queue;
            to.queue = [];
            q.forEach(function (x) { to.dataFns.forEach(function (f) { f(x); }); });
            if (to.queue.length) return later(flush);
            to.flushing = false;
            if (to.closeDue) closeNow(to);
        });
    }
    function deliver(to, bytes) {
        to.queue.push(bytes);
        flushSoon(to);
    }
    function closeNow(e) {
        if (e.closeFired) return;
        if (e.queue.length && e.dataFns.length) { flushSoon(e); return; }
        e.closeFired = true;
        setTimeout(function () { e.closeFns.forEach(function (f) { f(undefined); }); }, 0);
    }
    function closeBoth() {
        [a, b].forEach(function (e) {
            if (e.closed) return;
            e.closed = true;
            e.closeDue = true;
            closeNow(e);
        });
    }
    var client = {
        framing: "stream", secure: false,
        write: function (t) { if (!a.closed) deliver(b, W.utf8(t)); },
        writeBytes: function (bytes) { if (!a.closed) deliver(b, bytes.slice()); },
        onData: function () { /* a binary socket: bytes only (onBytes) */ },
        onBytes: function (fn) { a.dataFns.push(fn); flushSoon(a); },
        onClose: function (fn) { a.closeFns.push(fn); },
        close: function () { closeBoth(); }
    };
    var server = {
        write: function (bytes) { if (!b.closed) deliver(a, bytes.slice()); },
        onData: function (fn) { b.dataFns.push(fn); flushSoon(b); },
        onClose: function (fn) { b.closeFns.push(fn); },
        close: function () { closeBoth(); }
    };
    return { client: client, server: server };
}

// ---- Files in memory -----------------------------------------------------------------------------

function createFs(now) {
    var nodes = {};       // path -> {type: "dir" | "file", data?, mtime, mode}
    function norm(p) {
        var parts = [];
        String(p).split("/").forEach(function (s) {
            if (!s || s === ".") return;
            if (s === "..") parts.pop(); else parts.push(s);
        });
        return "/" + parts.join("/");
    }
    function parent(p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
    function mkdirs(p) {
        p = norm(p);
        if (nodes[p]) return;
        if (p !== "/") mkdirs(parent(p));
        nodes[p] = { type: "dir", mtime: now(), mode: 493 };
    }
    mkdirs("/");
    return {
        nodes: nodes, norm: norm, parent: parent, mkdirs: mkdirs,
        get: function (p) { return nodes[norm(p)] || null; },
        put: function (p, data) { p = norm(p); mkdirs(parent(p)); nodes[p] = { type: "file", data: data, mtime: now(), mode: 420 }; },
        children: function (p) {
            p = norm(p);
            var prefix = p === "/" ? "/" : p + "/";
            return Object.keys(nodes).filter(function (k) { return k !== p && k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf("/") < 0; })
                .map(function (k) { return k.slice(prefix.length); }).sort();
        },
        move: function (from, to) {
            from = norm(from); to = norm(to);
            Object.keys(nodes).forEach(function (k) {
                if (k === from || k.indexOf(from + "/") === 0) { nodes[to + k.slice(from.length)] = nodes[k]; delete nodes[k]; }
            });
        }
    };
}

// ---- The server --------------------------------------------------------------------------------

function createFakeSftp(options) {
    options = options || {};
    var now = options.now || function () { return Date.now(); };
    var host = options.host || "files.example";
    var hostKey = options.hostKey || K.generateEd25519("files.example");
    var hostBlob = K.publicBlob(hostKey);
    var users = {};
    Object.keys(options.users || {}).forEach(function (u) { users[u] = Object.assign({ keys: [] }, options.users[u]); });
    var fs = createFs(now);
    var refuse = false, slowDown = 0, connections = 0, sftpRequests = 0;
    var sessions = [];
    var tcp = null;
    var log = options.log || function () {};
    var extensions = options.extensions || { "posix-rename@openssh.com": "1", "statvfs@openssh.com": "2", "fsync@openssh.com": "1",
                                             "limits@openssh.com": "1", "copy-data": "1" };
    var diskSize = options.diskSize || 64 * 1024 * 1024 * 1024;

    Object.keys(users).forEach(function (u) { fs.mkdirs("/home/" + u); });
    Object.keys(options.files || {}).forEach(function (p) {
        var v = options.files[p];
        if (v === "dir") fs.mkdirs(p); else fs.put(p, typeof v === "string" ? W.utf8(v) : v);
    });

    function Session(sock) {
        var self = this;
        this.user = null;
        this.channels = {};
        connections++;
        sessions.push(this);
        var t = this.t = T.createTransport({ socket: sock, role: "server", hostKeys: [hostKey], log: log, now: now });
        t.onClose(function () { sessions = sessions.filter(function (s) { return s !== self; }); });
        if (slowDown) {
            t.ready.then(function () { t.disconnect(T.DISCONNECT.TOO_MANY_CONNECTIONS, "Too many connections; wait " + slowDown + " seconds"); });
            return;
        }
        t.onMessage(function (type, payload) {
            try { self.message(type, payload); } catch (e) { log("fake sftp: " + e.stack); t.disconnect(T.DISCONNECT.PROTOCOL_ERROR, e.message); }
        });
    }
    Session.prototype.send = function (bytes) { this.t.send(bytes); };
    Session.prototype.message = function (type, payload) {
        var r = new W.Reader(payload, 1);
        if (type === M.SERVICE_REQUEST) {
            var svc = W.latin1(r.string());
            if (svc !== "ssh-userauth") return this.t.disconnect(T.DISCONNECT.SERVICE_NOT_AVAILABLE, "No service " + svc);
            return this.send(new W.Writer().byte(M.SERVICE_ACCEPT).string(svc).bytes());
        }
        if (type === M.USERAUTH_REQUEST) return this.auth(r);
        if (type === M.USERAUTH_INFO_RESPONSE) return this.authAnswer(r);
        if (!this.user) return this.t.disconnect(T.DISCONNECT.PROTOCOL_ERROR, "Not signed in");
        if (type === M.GLOBAL_REQUEST) { r.string(); if (r.bool()) this.send(new Uint8Array([M.REQUEST_FAILURE])); return; }
        if (type === M.CHANNEL_OPEN) return this.open(r);
        var ch = this.channels[r.uint32()];
        if (!ch) return;
        if (type === M.CHANNEL_WINDOW_ADJUST) { ch.window += r.uint32(); return ch.flush(); }
        if (type === M.CHANNEL_DATA) return ch.data(r.string());
        if (type === M.CHANNEL_EOF) return;
        if (type === M.CHANNEL_CLOSE) {
            if (!ch.closed) this.send(new W.Writer().byte(M.CHANNEL_CLOSE).uint32(ch.remote).bytes());
            ch.closed = true;
            delete this.channels[ch.id];
            return;
        }
        if (type === M.CHANNEL_REQUEST) {
            var what = W.latin1(r.string()), want = r.bool();
            var ok = what === "subsystem" && W.latin1(r.string()) === "sftp";
            if (ok) ch.sftp = sftpServer(this, ch);
            if (want) this.send(new W.Writer().byte(ok ? M.CHANNEL_SUCCESS : M.CHANNEL_FAILURE).uint32(ch.remote).bytes());
        }
    };
    Session.prototype.authFailure = function () {
        this.send(new W.Writer().byte(M.USERAUTH_FAILURE).nameList(["publickey", "password", "keyboard-interactive"]).bool(false).bytes());
    };
    Session.prototype.auth = function (r) {
        var name = r.text();
        r.string();
        var method = W.latin1(r.string());
        // The demo: any name, with any password or any key (its signature still checked).
        var u = users[name] || (options.acceptAny && (method === "password" || method === "publickey") ? (users[name] = { password: null, keys: [], any: true }) : null);
        if (u && u.any) fs.mkdirs("/home/" + name);
        if (method === "password") {
            r.bool();
            var pw = r.text();
            if (!refuse && u && (u.any || u.password === pw)) return this.success(name);
            return this.authFailure();
        }
        if (method === "keyboard-interactive" && u && (u.password || u.any)) {
            this.pendingUser = name;
            return this.send(new W.Writer().byte(M.USERAUTH_INFO_REQUEST).string("").string("").string("").uint32(1).string("Password: ").bool(false).bytes());
        }
        if (method === "publickey" && u) {
            var signed = r.bool();
            var alg = W.latin1(r.string());
            var blob = r.string().slice();
            var known = u.any || u.keys.some(function (line) { try { return W.equal(K.parsePublicKeyLine(line).blob, blob); } catch (e) { return false; } });
            if (!known || refuse) return this.authFailure();
            if (!signed) return this.send(new W.Writer().byte(M.USERAUTH_PK_OK).string(alg).string(blob).bytes());
            var sig = r.string().slice();
            var data = new W.Writer().string(this.t.sessionId).byte(M.USERAUTH_REQUEST).string(name).string("ssh-connection")
                .string("publickey").bool(true).string(alg).string(blob).bytes();
            if (K.verify(blob, sig, data, alg)) return this.success(name);
        }
        return this.authFailure();
    };
    Session.prototype.authAnswer = function (r) {
        var n = r.uint32(), answer = n ? r.text() : "";
        var u = users[this.pendingUser];
        if (!refuse && u && (u.any || u.password === answer)) return this.success(this.pendingUser);
        return this.authFailure();
    };
    Session.prototype.success = function (name) {
        this.user = name;
        this.send(new Uint8Array([M.USERAUTH_SUCCESS]));
    };
    Session.prototype.open = function (r) {
        var kind = W.latin1(r.string()), remote = r.uint32(), window = r.uint32(), max = r.uint32();
        if (kind !== "session") {
            return this.send(new W.Writer().byte(M.CHANNEL_OPEN_FAILURE).uint32(remote).uint32(3).string("Only sessions").string("").bytes());
        }
        var self = this;
        var id = Object.keys(this.channels).length + 1;
        while (this.channels[id]) id++;
        var ch = this.channels[id] = {
            id: id, remote: remote, window: window, max: Math.min(max, PACKET), out: [], consumed: 0, closed: false,
            write: function (bytes) { ch.out.push(bytes); ch.flush(); },
            flush: function () {
                while (ch.out.length && ch.window > 0 && !ch.closed && !self.t.closed) {
                    var b = ch.out[0], n = Math.min(b.length, ch.window, ch.max);
                    self.send(new W.Writer(n + 16).byte(M.CHANNEL_DATA).uint32(ch.remote).string(b.subarray(0, n)).bytes());
                    ch.window -= n;
                    if (n === b.length) ch.out.shift(); else ch.out[0] = b.subarray(n);
                }
            },
            data: function (bytes) {
                ch.consumed += bytes.length;
                if (ch.consumed >= WINDOW / 2) {
                    self.send(new W.Writer().byte(M.CHANNEL_WINDOW_ADJUST).uint32(ch.remote).uint32(ch.consumed).bytes());
                    ch.consumed = 0;
                }
                if (ch.sftp) ch.sftp(bytes);
            }
        };
        this.send(new W.Writer().byte(M.CHANNEL_OPEN_CONFIRMATION).uint32(remote).uint32(id).uint32(WINDOW).uint32(PACKET).bytes());
    };

    // ---- SFTP over a channel -----------------------------------------------------------------

    function sftpServer(session, ch) {
        var buf = new Uint8Array(0);
        var handles = {}, nextHandle = 1;
        var home = "/home/" + session.user;
        function abs(p) { return fs.norm(p.charAt(0) === "/" ? p : home + "/" + p); }
        function reply(type, id, build) {
            var w = new W.Writer().uint32(0).byte(type);
            if (id !== null) w.uint32(id);
            if (build) build(w);
            var b = w.bytes(), len = b.length - 4;
            b[0] = (len >>> 24) & 255; b[1] = (len >>> 16) & 255; b[2] = (len >>> 8) & 255; b[3] = len & 255;
            ch.write(b);
        }
        function status(id, code, text) { reply(FX.STATUS, id, function (w) { w.uint32(code).string(text || ["Success", "End of file", "No such file", "Permission denied", "Failure"][code] || "Failure").string(""); }); }
        function attrsOf(node) {
            var mode = (node.type === "dir" ? F.S_IFDIR : F.S_IFREG) | node.mode;
            return { size: node.type === "file" ? node.data.length : 4096, mode: mode, mtime: Math.floor(node.mtime / 1000) };
        }
        function attrs(id, node) { reply(FX.ATTRS, id, function (w) { F.writeAttrs(w, attrsOf(node)); }); }
        function handleOf(r) { var h = W.latin1(r.string()); return handles[h] || null; }
        function newHandle(v) { var h = "h" + (nextHandle++); handles[h] = v; return h; }

        function request(msg) {
            var r = new W.Reader(msg);
            var type = r.byte();
            if (type === FX.INIT) {
                return reply(FX.VERSION, null, function (w) {
                    w.uint32(3);
                    Object.keys(extensions).forEach(function (k) { w.string(k).string(extensions[k]); });
                });
            }
            var id = r.uint32();
            sftpRequests++;
            var p, node, h;
            switch (type) {
            case FX.REALPATH:
                p = abs(r.text());
                return reply(FX.NAME, id, function (w) { w.uint32(1).string(p).string(p); F.writeAttrs(w, {}); });
            case FX.STAT: case FX.LSTAT:
                node = fs.get(abs(r.text()));
                return node ? attrs(id, node) : status(id, ST.NO_SUCH_FILE);
            case FX.FSTAT:
                h = handleOf(r);
                return h ? attrs(id, fs.get(h.path)) : status(id, ST.FAILURE);
            case FX.SETSTAT: case FX.FSETSTAT:
                return status(id, ST.OK);
            case FX.OPENDIR:
                p = abs(r.text());
                node = fs.get(p);
                if (!node) return status(id, ST.NO_SUCH_FILE);
                if (node.type !== "dir") return status(id, ST.FAILURE, "Not a directory");
                h = newHandle({ path: p, dir: true, names: [".", ".."].concat(fs.children(p)) });
                return reply(FX.HANDLE, id, function (w) { w.string(h); });
            case FX.READDIR:
                h = handleOf(r);
                if (!h || !h.dir) return status(id, ST.FAILURE);
                if (!h.names.length) return status(id, ST.EOF);
                var batch = h.names.splice(0, 50);
                return reply(FX.NAME, id, function (w) {
                    w.uint32(batch.length);
                    batch.forEach(function (n) {
                        var child = n === "." ? fs.get(h.path) : n === ".." ? fs.get(fs.parent(h.path)) : fs.get(h.path + (h.path === "/" ? "" : "/") + n);
                        w.string(n).string((child.type === "dir" ? "drwxr-xr-x" : "-rw-r--r--") + " 1 " + session.user + " " + n);
                        F.writeAttrs(w, attrsOf(child));
                    });
                });
            case FX.OPEN:
                p = abs(r.text());
                var flags = r.uint32();
                node = fs.get(p);
                if (node && node.type === "dir") return status(id, ST.FAILURE, "Is a directory");
                if (!node) {
                    if (!(flags & F.OPEN.CREAT)) return status(id, ST.NO_SUCH_FILE);
                    var dir = fs.get(fs.parent(p));
                    if (!dir || dir.type !== "dir") return status(id, ST.NO_SUCH_FILE);
                    fs.put(p, new Uint8Array(0));
                } else if (flags & F.OPEN.EXCL && flags & F.OPEN.CREAT) return status(id, ST.FAILURE);
                else if (flags & F.OPEN.TRUNC) { node.data = new Uint8Array(0); node.mtime = now(); }
                h = newHandle({ path: p, flags: flags });
                return reply(FX.HANDLE, id, function (w) { w.string(h); });
            case FX.CLOSE:
                var hn = W.latin1(r.string());
                if (!handles[hn]) return status(id, ST.FAILURE);
                delete handles[hn];
                return status(id, ST.OK);
            case FX.READ:
                h = handleOf(r);
                var off = r.uint64(), len = r.uint32();
                if (!h || h.dir) return status(id, ST.FAILURE);
                node = fs.get(h.path);
                if (!node) return status(id, ST.NO_SUCH_FILE);
                if (off >= node.data.length) return status(id, ST.EOF);
                // At most 32 KB a reply, as a server may answer short.
                var part = node.data.subarray(off, Math.min(node.data.length, off + Math.min(len, 32768)));
                return reply(FX.DATA, id, function (w) { w.string(part); });
            case FX.WRITE:
                h = handleOf(r);
                var at = r.uint64(), data = r.string();
                if (!h || h.dir || !(h.flags & F.OPEN.WRITE)) return status(id, ST.FAILURE);
                node = fs.get(h.path);
                var end = at + data.length;
                if (end > node.data.length) { var grown = new Uint8Array(end); grown.set(node.data); node.data = grown; }
                node.data.set(data, at);
                node.mtime = now();
                return status(id, ST.OK);
            case FX.REMOVE:
                p = abs(r.text());
                node = fs.get(p);
                if (!node) return status(id, ST.NO_SUCH_FILE);
                if (node.type === "dir") return status(id, ST.FAILURE, "Is a directory");
                delete fs.nodes[p];
                return status(id, ST.OK);
            case FX.MKDIR:
                p = abs(r.text());
                if (fs.get(p)) return status(id, ST.FAILURE);
                if (!fs.get(fs.parent(p))) return status(id, ST.NO_SUCH_FILE);
                fs.mkdirs(p);
                return status(id, ST.OK);
            case FX.RMDIR:
                p = abs(r.text());
                node = fs.get(p);
                if (!node) return status(id, ST.NO_SUCH_FILE);
                if (node.type !== "dir" || fs.children(p).length) return status(id, ST.FAILURE);
                delete fs.nodes[p];
                return status(id, ST.OK);
            case FX.RENAME:
                var from = abs(r.text()), to = abs(r.text());
                if (!fs.get(from)) return status(id, ST.NO_SUCH_FILE);
                // OpenSSH's v3 rename: link() + unlink(), so it refuses an existing target.
                if (fs.get(to) || !fs.get(fs.parent(to))) return status(id, fs.get(to) ? ST.FAILURE : ST.NO_SUCH_FILE);
                fs.move(from, to);
                return status(id, ST.OK);
            case FX.EXTENDED:
                return extended(id, W.latin1(r.string()), r);
            }
            return status(id, ST.OP_UNSUPPORTED);
        }

        function extended(id, name, r) {
            if (!extensions[name]) return status(id, ST.OP_UNSUPPORTED);
            if (name === "posix-rename@openssh.com") {
                var from = abs(r.text()), to = abs(r.text());
                if (!fs.get(from)) return status(id, ST.NO_SUCH_FILE);
                var target = fs.get(to);
                if (target && target.type === "dir" && fs.children(to).length) return status(id, ST.FAILURE);
                if (target) delete fs.nodes[fs.norm(to)];
                fs.move(from, to);
                return status(id, ST.OK);
            }
            if (name === "statvfs@openssh.com") {
                var used = Object.keys(fs.nodes).reduce(function (a, k) { return a + (fs.nodes[k].data ? fs.nodes[k].data.length : 0); }, 0);
                var bs = 4096, blocks = diskSize / bs, free = blocks - Math.ceil(used / bs);
                return reply(FX.EXTENDED_REPLY, id, function (w) {
                    [bs, bs, blocks, free, free, 1000000, 999000, 999000, 1, 0, 255].forEach(function (v) { w.uint64(v); });
                });
            }
            if (name === "fsync@openssh.com") return status(id, handleOf(r) ? ST.OK : ST.FAILURE);
            if (name === "limits@openssh.com") {
                return reply(FX.EXTENDED_REPLY, id, function (w) { w.uint64(256 * 1024).uint64(255 * 1024).uint64(255 * 1024).uint64(64); });
            }
            if (name === "copy-data") {
                var src = handleOf(r), soff = r.uint64(), slen = r.uint64(), dst = handleOf(r), doff = r.uint64();
                if (!src || !dst) return status(id, ST.FAILURE);
                var sdata = fs.get(src.path).data;
                var bytes = sdata.subarray(soff, slen ? soff + slen : sdata.length);
                var dnode = fs.get(dst.path);
                var need = doff + bytes.length;
                if (need > dnode.data.length) { var g = new Uint8Array(need); g.set(dnode.data); dnode.data = g; }
                dnode.data.set(bytes, doff);
                return status(id, ST.OK);
            }
            return status(id, ST.OP_UNSUPPORTED);
        }

        return function (bytes) {
            var all = new Uint8Array(buf.length + bytes.length);
            all.set(buf);
            all.set(bytes, buf.length);
            buf = all;
            while (buf.length >= 4) {
                var len = new W.Reader(buf).uint32();
                if (buf.length < 4 + len) return;
                var msg = buf.subarray(4, 4 + len);
                buf = buf.slice(4 + len);
                request(msg);
            }
        };
    }

    // ---- What the tests and the simulator drive ----------------------------------------------

    function socket() {
        var p = pipe();
        new Session(p.server);
        return p.client;
    }

    var server = {
        host: host,
        hostKey: { algorithm: hostKey.type, type: hostKey.type, blob: hostBlob, key: W.base64(hostBlob), fingerprint: K.fingerprint(hostBlob) },
        files: fs,
        socket: socket,
        // As Environment.net: TCP to this server's host (any port) only.
        net: function () {
            return {
                connect: function (c) {
                    if (c.host !== host) return Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND " + c.host), { code: "ENOTFOUND" }));
                    if (!c.binary) return Promise.reject(new Error("SSH needs a binary socket"));
                    return Promise.resolve(socket());
                }
            };
        },
        // HTTP: none here (the conformance suite's FakeServer has it).
        request: function () { return Promise.reject(Object.assign(new Error("No HTTP on an SFTP server"), { code: "ECONNREFUSED" })); },
        // Node only: a real TCP server for the tests that go through Node's net.
        listen: function (port) {
            var net = require("net");
            return new Promise(function (resolve) {
                tcp = net.createServer(function (s) {
                    var dataFns = [], closeFns = [];
                    s.on("data", function (d) { var b = new Uint8Array(d.buffer, d.byteOffset, d.length); dataFns.forEach(function (f) { f(b); }); });
                    s.on("close", function () { closeFns.forEach(function (f) { f(); }); });
                    s.on("error", function () { /* the close follows */ });
                    new Session({ write: function (b) { s.write(Buffer.from(b)); }, onData: function (f) { dataFns.push(f); },
                                  onClose: function (f) { closeFns.push(f); }, close: function () { s.end(); } });
                });
                tcp.listen(port || 0, "127.0.0.1", function () { resolve(tcp.address().port); });
            });
        },
        stop: function () {
            sessions.slice().forEach(function (s) { s.t.disconnect(); });
            return new Promise(function (resolve) { if (tcp) tcp.close(function () { resolve(); }); else resolve(); });
        },
        read: function (p) { var n = fs.get(p); return n && n.type === "file" ? n.data : null; },
        write: function (p, bytes) { fs.put(p, typeof bytes === "string" ? W.utf8(bytes) : bytes); },
        addUser: function (name, u) { users[name] = Object.assign({ keys: [] }, u); fs.mkdirs("/home/" + name); },
        authorize: function (name, line) { users[name].keys.push(line); },
        sessions: function () { return sessions.map(function (s) { return { user: s.user, channels: Object.keys(s.channels).length }; }); },
        signedIn: function () { var s = sessions.filter(function (x) { return x.user; })[0]; return s ? s.user : null; },
        dropConnections: function () { sessions.slice().forEach(function (s) { s.t.disconnect(T.DISCONNECT.BY_APPLICATION, "Dropped"); }); },
        // The conformance suite's switches (docs/SYNERGY-SDK.md "Testing").
        unauthorized: function (on) { refuse = !!on; if (on) sessions.slice().forEach(function (s) { s.t.disconnect(T.DISCONNECT.BY_APPLICATION, "Signed out"); }); },
        throttle: function (seconds) {
            slowDown = seconds;
            if (seconds) sessions.slice().forEach(function (s) { s.t.disconnect(T.DISCONNECT.TOO_MANY_CONNECTIONS, "Too many connections"); });
        },
        requests: function () { return connections + sftpRequests; },
        close: function () { return server.stop(); }
    };
    return server;
}

// The simulator's demo server: files.example, where any name signs in with
// any password into a home folder with a few files (runtime "Drives").
function demoServer(o) {
    var s = createFakeSftp(Object.assign({ host: "files.example", acceptAny: true, users: {} }, o || {}));
    return s;
}

module.exports = { createFakeSftp: createFakeSftp, demoServer: demoServer, pipe: pipe };
