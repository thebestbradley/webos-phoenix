// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.dropshare on a device (docs/APP-RUNTIME.md "DropShare";
// docs/M6-PLAN.md F4 item 8): the web server another phone or computer on
// the same network opens, from the address the DropShare card shows as a
// QR code. The same requests, limits and states as the simulator's server
// (shell/sim/simdropshare.cpp), with the runtime's service API in front
// (runtime/phoenix-runtime.js "DropShare"):
//
//   receive {subscribe}  -> {mode, url, state, files: [{id, name, type,
//       size, received, done, downloads, saved}]} as it changes. Uploads
//       (POST <token>/upload?name=&type=, then POST <token>/done) are
//       written straight into /media/internal/Downloads, a second file of
//       a name numbered ("photo (2).jpg"); saved is the path once whole.
//   send {files: [{path, mimeType?}], subscribe}: the other device lists
//       them (GET <token>/files) and downloads them (GET <token>/file/N),
//       streamed from where they are.
//   stop {}; getStatus {}.
// States: waiting, transferring, done, timeout (ten minutes without a
// request), stopped, failed. Each session has a new token of 128 random
// bits in every address; anything else is 404. Limits: 512 MB a file,
// 2 GB and 50 files a session. Off until the user turns it on (system
// preference dropShareEnabled, Settings > DropShare).
//
// createDropShare({downloads, pages(name) -> Buffer | null, address() ->
// string, enabled() -> Promise<bool>, ongoing(obj), notify(obj), now?,
// idleMs?, limits?}) -> {methods: {receive, send, stop, getStatus}
// (params, respond) -> cancel | undefined, close()}
// STATUS: written against simdropshare.cpp's protocol and
// dropshare.test.ts (real sockets); not yet run on a device.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");

var SERVICE = "org.webosphoenix.dropshare";
var APP = "org.webosphoenix.dropshare";
var DOWNLOADS = "/media/internal/Downloads";

function ok(extra) {
    var r = { returnValue: true };
    for (var k in extra) r[k] = extra[k];
    return r;
}
function fail(text) { return { returnValue: false, errorCode: -1, errorText: text }; }

function cleanName(name) {
    var n = path.basename(String(name || "")).replace(/[\\\/:*?"<>|\x00-\x1f]/g, "_").trim().replace(/^\.+/, "");
    return (n || "file").slice(0, 200);
}

// The device's first LAN address (IPv4, up, not loopback), as SimDropShare
// advertises it.
function lanAddress() {
    var nifs = os.networkInterfaces();
    for (var name in nifs) {
        var list = nifs[name] || [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].family === "IPv4" && !list[i].internal)
                return list[i].address;
    }
    return "127.0.0.1";
}

function sizeOf(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function createDropShare(opts) {
    var downloads = opts.downloads || DOWNLOADS;
    var limits = Object.assign({ file: 512 * 1024 * 1024, session: 2048 * 1024 * 1024, files: 50 }, opts.limits || {});
    var idleMs = opts.idleMs || 10 * 60 * 1000;
    var address = opts.address || lanAddress;
    var session = null;   // {mode, token, url, server, state, files, bytes, idle, subscribers, notified, showing}
    var nextId = 1;
    var last = null;      // the session that ended, for getStatus

    function view(s) {
        if (!s) return ok({ state: "off", url: "", files: [] });
        return ok({ mode: s.mode, url: s.ended ? "" : s.url, state: s.state, files: s.files.map(function (f) {
            return { id: f.id, name: f.name, type: f.type, size: f.size, received: f.received, done: f.done,
                     downloads: f.downloads, saved: f.saved || "" };
        }) });
    }
    function changed(s) {
        var v = view(s);
        s.subscribers.slice().forEach(function (fn) { fn(v); });
        progress(s, v);
    }
    // The ongoing activity while files come; one notification once in.
    function progress(s, v) {
        if (s.mode !== "receive") return;
        var coming = v.files.filter(function (f) { return !f.done; });
        if (v.state === "transferring" && coming.length) {
            var f = coming[0];
            opts.ongoing && opts.ongoing({ id: "dropshare", appId: APP, title: "DropShare",
                body: "Receiving " + f.name + (f.size ? " (" + sizeOf(f.received) + " of " + sizeOf(f.size) + ")" : ""),
                progress: f.size ? Math.min(100, Math.floor(f.received * 100 / f.size)) : -1 });
            s.showing = true;
        } else if (s.showing) {
            opts.ongoing && opts.ongoing({ id: "dropshare", clear: true });
            s.showing = false;
        }
        var saved = v.files.filter(function (x) { return x.saved; });
        if (!coming.length && saved.length > s.notified && v.state !== "transferring") {
            var n = saved.length - s.notified;
            s.notified = saved.length;
            opts.notify && opts.notify({ appId: "org.webosphoenix.files", title: "DropShare",
                body: n === 1 ? saved[saved.length - 1].name + " is in Downloads" : n + " files are in Downloads",
                params: { path: downloads }, soundClass: "notifications" });
        }
    }
    function setState(s, state) {
        if (s.state === state) return;
        s.state = state;
        changed(s);
    }
    function touch(s) {
        clearTimeout(s.idle);
        if (s.server) s.idle = setTimeout(function () { end(s, "timeout"); }, idleMs);
    }
    function closeServer(s) {
        clearTimeout(s.idle);
        if (s.server) {
            s.server.close();
            s.sockets.forEach(function (k) { k.destroy(); });
            s.server = null;
        }
        s.token = "";
    }
    function end(s, state) {
        closeServer(s);
        // Uploads cut off do not count.
        s.files.filter(function (f) { return !f.done && f.mode === "receive"; }).forEach(function (f) {
            try { fs.unlinkSync(f.path); } catch (e) { /* gone */ }
        });
        s.files = s.files.filter(function (f) { return f.done || f.mode !== "receive"; });
        s.ended = true;
        if (session === s) { session = null; last = s; }
        if (s.state === "waiting" || s.state === "transferring" || state === "stopped")
            setState(s, state);
        else
            changed(s);
    }

    // A name not taken in Downloads (nor by an upload under way).
    function freeName(name) {
        var n = cleanName(name);
        var taken = function (x) {
            if (fs.existsSync(path.join(downloads, x))) return true;
            return !!(session && session.files.some(function (f) { return f.name === x; }));
        };
        if (!taken(n)) return n;
        var ext = path.extname(n), base = ext ? n.slice(0, -ext.length) : n;
        for (var i = 2; ; ++i) {
            var x = base + " (" + i + ")" + ext;
            if (!taken(x)) return x;
        }
    }

    function reply(res, status, type, body) {
        res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store",
                                "X-Content-Type-Options": "nosniff", "Connection": "close" });
        res.end(body);
    }
    function replyJson(res, status, o) { reply(res, status, "application/json", JSON.stringify(o)); }

    function handle(s, req, res) {
        touch(s);
        var u;
        try { u = new URL(req.url, "http://x"); } catch (e) { return reply(res, 400, "text/plain", "Bad request\n"); }
        var parts = u.pathname.split("/").filter(Boolean);
        if (!s.token || !parts.length || parts[0] !== s.token) return reply(res, 404, "text/plain", "Not found\n");
        var what = parts.slice(1).join("/");
        var receive = s.mode === "receive";
        if (req.method === "GET" && what === "") {
            var page = opts.pages ? opts.pages(receive ? "receive.html" : "send.html") : null;
            return page ? reply(res, 200, "text/html; charset=utf-8", page) : reply(res, 500, "text/plain", "The page is missing\n");
        }
        if (receive && req.method === "POST" && what === "upload") {
            var length = Number(req.headers["content-length"]);
            if (!(length >= 0) || req.headers["content-length"] === undefined) return reply(res, 411, "text/plain", "Length required\n");
            var count = s.files.filter(function (f) { return f.done || f.received > 0; }).length;
            if (length > limits.file || s.bytes + length > limits.session || count >= limits.files)
                return replyJson(res, 413, { returnValue: false, errorText: "Too large" });
            fs.mkdirSync(downloads, { recursive: true });
            var name = freeName(u.searchParams.get("name") || "");
            var f = { id: nextId++, mode: "receive", name: name, type: u.searchParams.get("type") || "application/octet-stream",
                      size: length, received: 0, done: false, downloads: 0, path: path.join(downloads, name) };
            var out = fs.createWriteStream(f.path, { flags: "wx", mode: 420 });
            s.files.push(f);
            s.bytes += length;
            setState(s, "transferring");
            changed(s);
            var broken = false;
            var drop = function () {
                if (f.done || broken) return;
                broken = true;
                out.destroy();
                try { fs.unlinkSync(f.path); } catch (e) { /* not written */ }
                s.files = s.files.filter(function (x) { return x !== f; });
                s.bytes -= length;
                changed(s);
            };
            req.on("data", function (chunk) {
                if (broken) return;
                f.received += chunk.length;
                if (f.received > length) { drop(); return reply(res, 400, "text/plain", "More than Content-Length\n"); }
                out.write(chunk);
                touch(s);
                changed(s);
            });
            req.on("end", function () {
                if (broken) return;
                out.end(function () {
                    if (f.received !== length) { drop(); return; }
                    f.done = true;
                    f.saved = f.path;
                    replyJson(res, 200, { returnValue: true, name: f.name });
                    changed(s);
                });
            });
            req.on("aborted", drop);
            res.on("close", function () { if (!f.done) drop(); });
            return;
        }
        if (receive && req.method === "POST" && what === "done") {
            replyJson(res, 200, { returnValue: true });
            closeServer(s);
            s.ended = true;
            if (session === s) { session = null; last = s; }
            setState(s, "done");
            return;
        }
        if (!receive && req.method === "GET" && what === "files") {
            return reply(res, 200, "application/json", JSON.stringify({ files: s.files.map(function (x) {
                return { id: x.id, name: x.name, type: x.type, size: x.size };
            }) }));
        }
        if (!receive && req.method === "GET" && /^file\/\d+$/.test(what)) {
            var id = Number(what.slice(5));
            var e = s.files.filter(function (x) { return x.id === id; })[0];
            if (!e) return reply(res, 404, "text/plain", "Not found\n");
            setState(s, "transferring");
            var ascii = e.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
            res.writeHead(200, { "Content-Type": e.type, "Content-Length": e.size, "Cache-Control": "no-store", "Connection": "close",
                                 "Content-Disposition": "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(e.name) });
            var stream = fs.createReadStream(e.path);
            stream.pipe(res);
            res.on("finish", function () {
                e.downloads++;
                changed(s);
                // Every file went: the session is done.
                if (s.files.every(function (x) { return x.downloads > 0; })) {
                    closeServer(s);
                    s.ended = true;
                    if (session === s) { session = null; last = s; }
                    setState(s, "done");
                }
            });
            stream.on("error", function () { res.destroy(); });
            return;
        }
        reply(res, 405, "text/plain", "Not allowed\n");
    }

    function start(mode, files) {
        if (session) end(session, "stopped");
        var s = { mode: mode, token: crypto.randomBytes(16).toString("base64url"), url: "", server: null, state: "waiting",
                  files: files || [], bytes: 0, idle: null, subscribers: [], notified: 0, showing: false, sockets: new Set(), ended: false };
        return new Promise(function (resolve) {
            var server = http.createServer(function (req, res) { handle(s, req, res); });
            server.on("connection", function (k) { s.sockets.add(k); k.on("close", function () { s.sockets.delete(k); }); });
            server.on("error", function (e) { s.state = "failed"; resolve(fail(String(e && e.message || e))); });
            // Every network the device is on, a port of its own.
            server.listen(0, opts.listenHost || "0.0.0.0", function () {
                s.server = server;
                s.url = "http://" + address() + ":" + server.address().port + "/" + s.token + "/";
                session = s;
                touch(s);
                resolve(ok({ session: s }));
            });
        });
    }

    function begin(mode, p, respond, files, onSession) {
        return Promise.resolve(opts.enabled ? opts.enabled() : true).then(function (on) {
            if (!on) return respond(fail("DropShare is off. Turn it on in Settings > DropShare."));
            return start(mode, files).then(function (r) {
                if (!r.returnValue) return respond(r);
                var s = r.session;
                if (onSession) onSession(s);
                if (p.subscribe) s.subscribers.push(respond);
                respond(Object.assign(view(s), p.subscribe ? { subscribed: true } : {}));
            });
        });
    }

    var methods = {
        receive: function (p, respond) {
            var cancelled = false, s0 = null;
            begin("receive", p, function (r) { if (!cancelled) respond(r); }, null, function (s) { s0 = s; });
            return function () { cancelled = true; if (s0 && session === s0) end(s0, "stopped"); };
        },
        send: function (p, respond) {
            var files = (Array.isArray(p.files) ? p.files : []).filter(function (f) { return f && typeof f.path === "string"; });
            if (!files.length) { respond(fail("files: [{path}] is required")); return; }
            var offered = [], names = {};
            for (var i = 0; i < files.length && i < limits.files; ++i) {
                var st;
                try { st = fs.statSync(files[i].path); } catch (e) { respond(fail("Cannot read " + files[i].path)); return; }
                if (!st.isFile() || st.size > limits.file) { respond(fail("The file is too large to share: " + files[i].path)); return; }
                var n = cleanName(files[i].path), k = 2, base = n;
                while (names[n]) { var ext = path.extname(base); n = (ext ? base.slice(0, -ext.length) : base) + " (" + (k++) + ")" + ext; }
                names[n] = true;
                offered.push({ id: nextId++, mode: "send", name: n, type: files[i].mimeType || "application/octet-stream", size: st.size,
                               received: st.size, done: true, downloads: 0, path: files[i].path });
            }
            var cancelled = false, s0 = null;
            begin("send", p, function (r) { if (!cancelled) respond(r); }, offered, function (s) { s0 = s; });
            return function () { cancelled = true; if (s0 && session === s0) end(s0, "stopped"); };
        },
        stop: function (p, respond) {
            if (session) end(session, "stopped");
            respond(ok());
        },
        getStatus: function (p, respond) { respond(session ? view(session) : last ? Object.assign(view(last), { url: "" }) : view(null)); }
    };

    return { methods: methods, close: function () { if (session) end(session, "stopped"); }, current: function () { return session; } };
}

var METHODS = ["receive", "send", "stop", "getStatus"];

module.exports = { createDropShare: createDropShare, METHODS: METHODS, SERVICE: SERVICE, APP: APP, DOWNLOADS: DOWNLOADS,
                   cleanName: cleanName, lanAddress: lanAddress };
