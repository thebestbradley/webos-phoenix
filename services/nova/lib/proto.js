// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// nova's wire protocol (docs/DEV-PUSH.md 6.2, 6.4): TLS 1.3 on TCP port
// 6965, on the LAN or a USB network link alike, both ends presenting their
// Ed25519 keys (lib/keys.js certificates) and each pinning the other's.
// The same code is novad's (server: service.js on a device, sim.js for the
// simulator) and nova's (client: tools/nova).
//
// On the connection, frames: one byte for the kind ("J" a JSON message,
// "B" bytes), four for the length (big-endian), then the payload. The
// computer sends a request ({op, ...}, and for a push the bundle as the
// next "B" frame); the device answers with progress messages ({progress})
// and then one with "ok" (true, or false with code and error), followed by
// a "B" frame when it says "bytes". Not HTTP: pairing's three messages must
// run over one TLS connection, since the PAKE is bound to that connection's
// exported keying material (RFC 8446 7.5), which an HTTP client's pool does
// not promise; and `forward` turns the connection into a plain stream.
//
// Requests: hello; pair {pA, name}, pairConfirm {confirm, proof} (an
// unpaired computer may send only these three); status; manifest; push
// {signature} + the bundle; get {path}; revert {path?}; restart {what};
// rescan; luna {uri, params}; log {follow, filter}; forward {port}; unpair.

"use strict";

var net = require("net");
var tls = require("tls");
var keys = require("./keys");
var pake = require("./pake");

var PORT = 6965;
var EXPORTER_LABEL = "EXPORTER-nova-pair";
var MAX_JSON = 1 << 20;
var MAX_BYTES = 80 * 1024 * 1024;
// nova forward (docs/DEV-HELPER.md 9.1): the device-local ports a paired
// computer may reach, and nothing else: WebAppMgr's Web Inspector, the
// shell's QML debugger (Developer Mode's QML Debugging switch), SSH.
var FORWARD_PORTS = { 9998: "Web Inspector (WebAppMgr)", 3768: "QML debugger (the shell)", 22: "SSH (nova term)" };

function fail(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

// ---- Frames ---------------------------------------------------------------------------

function frames(socket) {
    var buf = Buffer.alloc(0);
    var queue = [], waiting = [], closed = null, detached = false;
    function deliver(item) {
        if (waiting.length) waiting.shift().resolve(item);
        else queue.push(item);
    }
    function onData(chunk) {
        if (detached) return;
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 5) {
            var kind = String.fromCharCode(buf[0]), n = buf.readUInt32BE(1);
            if ((kind !== "J" && kind !== "B") || (kind === "J" && n > MAX_JSON) || n > MAX_BYTES) {
                return shut(fail("PROTOCOL", "not nova's protocol"));
            }
            if (buf.length < 5 + n) break;
            var body = buf.subarray(5, 5 + n);
            buf = buf.subarray(5 + n);
            if (kind === "J") {
                var msg;
                try { msg = JSON.parse(body.toString("utf8")); } catch (e) { return shut(fail("PROTOCOL", "a message that is not JSON")); }
                // A forward's answer: what follows it is the forwarded
                // stream, not frames (the far end may speak at once, as SSH
                // does, in the same packet).
                if (msg && msg.stream === true) {
                    detached = true;
                    socket.removeListener("data", onData);
                    socket.pause();     // until the stream is piped
                    deliver({ json: msg });
                    return;
                }
                deliver({ json: msg });
            } else deliver({ bytes: Buffer.from(body) });
        }
    }
    function shut(e) {
        if (closed) return;
        closed = e || fail("CLOSED", "The connection closed");
        waiting.splice(0).forEach(function (w) { w.reject(closed); });
        if (e) socket.destroy();
    }
    socket.on("data", onData);
    socket.on("close", function () { shut(null); });
    socket.on("error", function (e) { shut(fail("CLOSED", e.message)); });
    function write(kind, payload) {
        var h = Buffer.alloc(5);
        h[0] = kind.charCodeAt(0);
        h.writeUInt32BE(payload.length, 1);
        socket.write(Buffer.concat([h, payload]));
    }
    return {
        send: function (obj) { write("J", Buffer.from(JSON.stringify(obj), "utf8")); },
        sendBytes: function (b) { write("B", Buffer.from(b)); },
        next: function () {
            if (queue.length) return Promise.resolve(queue.shift());
            if (closed) return Promise.reject(closed);
            return new Promise(function (resolve, reject) { waiting.push({ resolve: resolve, reject: reject }); });
        },
        // The stream from here on is not frames (forward): what came
        // already, then the socket.
        detach: function () {
            detached = true;
            socket.removeListener("data", onData);
            socket.pause();
            var rest = buf;
            buf = Buffer.alloc(0);
            return rest;
        },
        closed: function () { return closed; }
    };
}

// IPv4 and IPv6 private, link-local and loopback addresses: "Push over
// network" answers only these (6.2).
function isPrivate(addr) {
    var a = String(addr || "").replace(/^::ffff:/i, "");
    var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
    if (m) {
        var x = +m[1], y = +m[2];
        return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
    }
    a = a.toLowerCase();
    return a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
}

// ---- The device's end ------------------------------------------------------------------

// nova: createNova()'s object. opts: {host, port, name (this device's, for
// hello), allow(remoteAddress) -> bool, luna(uri, params) -> Promise
// (nova luna-send), log(follow, filter, onLine) -> stop(), connect(port)
// -> net.Socket (nova forward), onError(text)}. -> {server, listening:
// Promise<port>, close()}
function createServer(nova, opts) {
    var k = nova.deviceKey();
    var server = tls.createServer({ key: k.pem, cert: k.cert, requestCert: true, rejectUnauthorized: false,
                                    minVersion: "TLSv1.3", maxVersion: "TLSv1.3" });
    var conns = new Set();
    server.on("secureConnection", function (socket) {
        conns.add(socket);
        socket.on("close", function () { conns.delete(socket); });
        if (opts.allow && !opts.allow(socket.remoteAddress)) return socket.destroy();
        var clientKey = keys.peerKey(socket.getPeerX509Certificate());
        if (!clientKey) return socket.destroy();
        // A revoked key (9.1) is trusted for nothing, hello included.
        if (nova.isRevoked(clientKey)) return socket.destroy();
        socket.novaKey = clientKey;
        serve(nova, opts, socket, clientKey).then(null, function (e) {
            if (e.code !== "CLOSED" && opts.onError) opts.onError(e.message);
            socket.destroy();
        });
    });
    server.on("tlsClientError", function () { /* a client that is not nova */ });
    // A revocation list that names a connected computer's key ends its
    // connections, a forward or a log follow among them.
    var unwatch = nova.watch(function () {
        conns.forEach(function (s) { if (s.novaKey && nova.isRevoked(s.novaKey)) s.destroy(); });
    });
    var listening = new Promise(function (resolve, reject) {
        server.once("error", reject);
        server.listen(opts.port === undefined ? PORT : opts.port, opts.host || "127.0.0.1", function () { resolve(server.address().port); });
    });
    return {
        server: server,
        listening: listening,
        close: function () {
            unwatch();
            conns.forEach(function (s) { s.destroy(); });
            return new Promise(function (resolve) { server.close(function () { resolve(); }); });
        }
    };
}

function serve(nova, opts, socket, clientKey) {
    var f = frames(socket);
    var run = null;
    function reply(obj) { f.send(Object.assign({ ok: true }, obj || {})); }
    function error(e) { f.send({ ok: false, code: e.code || "FAILED", error: e.message || String(e) }); }
    function pairedName() {
        var p = nova.paired().filter(function (x) { return x.key === clientKey; })[0];
        return p ? p.name : null;
    }
    function loop() {
        return f.next().then(function (m) {
            if (!m.json) throw fail("PROTOCOL", "a request was expected");
            var req = m.json;
            var paired = nova.isPaired(clientKey);
            return Promise.resolve().then(function () {
                if (req.op === "hello") {
                    var img = nova.image();
                    return reply({ device: opts.name || "webOS Phoenix", deviceId: img.id, fingerprint: nova.deviceKey().fingerprint,
                                   build: img.build, product: img.product, compatible: img.compatible, devMode: nova.devMode(), paired: paired });
                }
                if (!nova.devMode()) throw fail("NEEDS_DEVMODE", "Developer Mode is off on the device");
                if (req.op === "pair") {
                    run = nova.pairRun(clientKey, socket.exportKeyingMaterial(32, EXPORTER_LABEL), String(req.pA || ""));
                    run.name = String(req.name || "Computer");
                    return reply(run.reply);
                }
                if (req.op === "pairConfirm") {
                    if (!run) throw fail("NOT_PAIRING", "pair first");
                    var r = run;
                    run = null;
                    return reply(r.finish(req.confirm, req.proof, r.name));
                }
                if (!paired) throw fail("NOT_PAIRED", "This computer is not paired with the device: run nova pair");
                switch (req.op) {
                case "status": return reply({ status: nova.status() });
                case "manifest": {
                    var mf = nova.imageManifest();
                    if (!mf) throw fail("NO_MANIFEST", "The device's image has no manifest (/usr/share/phoenix/manifest.json): it needs an image built with dev push");
                    var b = Buffer.from(JSON.stringify(mf));
                    reply({ bytes: b.length });
                    return f.sendBytes(b);
                }
                case "push":
                    return f.next().then(function (body) {
                        if (!body.bytes) throw fail("PROTOCOL", "the bundle was expected");
                        return nova.receive(body.bytes, String(req.signature || ""), { key: clientKey, name: pairedName() },
                                            function (p) { f.send({ progress: p }); });
                    }).then(function (r) { reply({ result: r }); });
                case "get": {
                    var data = nova.readFile(req.path);
                    reply({ bytes: data.length });
                    return f.sendBytes(data);
                }
                case "revert":
                    return (req.path ? nova.revertPath(req.path) : nova.revertAll()).then(function (r) { reply({ result: r }); });
                case "restart":
                case "rescan":
                    return (req.op === "rescan" ? nova.rescan() : nova.restart(req.what)).then(function (r) {
                        if (!r.returnValue) throw fail(r.errorCode, r.errorText);
                        reply({ result: r });
                    });
                case "unpair": return nova.unpair(clientKey).then(function () { reply({}); });
                case "luna":
                    if (!opts.luna) throw fail("UNSUPPORTED", "Luna calls are not available here");
                    if (!/^luna:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*$/.test(String(req.uri || ""))) throw fail("BAD_PARAMS", "uri: luna://service/method");
                    return Promise.resolve(opts.luna(req.uri, req.params || {})).then(function (r) { reply({ reply: r }); });
                case "log":
                    if (!opts.log) throw fail("UNSUPPORTED", "The log is not available here");
                    return new Promise(function (resolve) {
                        var stop = opts.log(!!req.follow, req.filter || null, function (line) { f.send({ line: line }); },
                                            function (e) { stop = null; if (e) error(e); else reply({}); resolve(); });
                        socket.once("close", function () { if (stop) stop(); resolve(); });
                    });
                case "forward": {
                    var port = Number(req.port);
                    if (!FORWARD_PORTS[port]) throw fail("NOT_ALLOWED", "Port " + req.port + " is not one nova forwards (" + Object.keys(FORWARD_PORTS).join(", ") + ")");
                    if (!opts.connect) throw fail("UNSUPPORTED", "Forwarding is not available here");
                    return new Promise(function (resolve) {
                        var local = opts.connect(port);
                        local.once("error", function (e) { error(fail("NOT_LISTENING", "Nothing listens on port " + port + " on the device (" + e.message + ")")); resolve("done"); });
                        local.once("connect", function () {
                            reply({ stream: true });
                            var rest = f.detach();
                            if (rest.length) local.write(rest);
                            socket.pipe(local);
                            local.pipe(socket);
                            resolve("piped");
                        });
                    });
                }
                default: throw fail("BAD_PARAMS", "Unknown request " + req.op);
                }
            }).then(function (r) {
                if (r === "piped") return null;
                return loop();
            }, function (e) {
                if (e.code === "CLOSED") throw e;
                error(e);
                return loop();
            });
        });
    }
    return loop();
}

// ---- The computer's end ----------------------------------------------------------------

// opts: {host, port, key (the computer's: {pem, cert}), expect (the
// device's base64 key: pinned) | null (pairing: any key, which the PAKE
// then binds), timeout (ms)} -> Promise<client>
function connect(opts) {
    return new Promise(function (resolve, reject) {
        var done = false;
        var socket = tls.connect({ host: opts.host, port: opts.port || PORT, key: opts.key.pem, cert: opts.key.cert,
                                   rejectUnauthorized: false, checkServerIdentity: function () { return undefined; },
                                   minVersion: "TLSv1.3", maxVersion: "TLSv1.3", servername: undefined }, function () {
            var deviceKey = keys.peerKey(socket.getPeerX509Certificate());
            if (!deviceKey) { done = true; socket.destroy(); return reject(fail("NOT_NOVAD", "The other end is not a webOS Phoenix device")); }
            if (opts.expect && deviceKey !== String(opts.expect).replace(/^ed25519:/, "")) {
                done = true;
                socket.destroy();
                return reject(fail("WRONG_DEVICE_KEY", "The device at " + opts.host + " has another key (" + keys.fingerprint(deviceKey) +
                                   ") than the one paired with it. If it was erased or reflashed, pair again; otherwise something is in the way"));
            }
            socket.setTimeout(0);
            done = true;
            resolve(client(socket, deviceKey));
        });
        socket.setTimeout(opts.timeout || 8000, function () {
            if (done) return;
            done = true;
            socket.destroy();
            reject(fail("UNREACHABLE", "No answer from " + opts.host + ":" + (opts.port || PORT)));
        });
        socket.on("error", function (e) {
            if (done) return;
            done = true;
            reject(fail("UNREACHABLE", "Could not reach " + opts.host + ":" + (opts.port || PORT) + " (" + (e.code || e.message) + ")"));
        });
    });
}

function client(socket, deviceKey) {
    var f = frames(socket);
    function answer(onMessage) {
        return f.next().then(function (m) {
            if (!m.json) throw fail("PROTOCOL", "a message was expected");
            if (m.json.ok === undefined) {
                if (onMessage) onMessage(m.json);
                return answer(onMessage);
            }
            if (!m.json.ok) throw fail(m.json.code || "FAILED", m.json.error || "The device refused");
            if (m.json.bytes === undefined) return m.json;
            return f.next().then(function (b) {
                if (!b.bytes) throw fail("PROTOCOL", "bytes were expected");
                m.json.data = b.bytes;
                return m.json;
            });
        });
    }
    return {
        socket: socket,
        deviceKey: deviceKey,
        exporter: function () { return socket.exportKeyingMaterial(32, EXPORTER_LABEL); },
        // req, bytes (sent after it), onMessage(progress or line) -> the answer
        request: function (req, bytes, onMessage) {
            f.send(req);
            if (bytes) f.sendBytes(bytes);
            return answer(onMessage);
        },
        // The stream after a forward's answer.
        detach: function () { return f.detach(); },
        close: function () { socket.end(); socket.destroy(); }
    };
}

// The computer's side of pairing (6.4) on a connection made without a
// pinned key: SPAKE2 with the code, bound to both keys and the connection,
// then each side's proof that it holds its key. -> {deviceKey, fingerprint}
function pair(conn, opts) {
    var me = opts.key;
    var ids = require("../novaservice").pairIdentities(me.publicKey, conn.deviceKey);
    var party = pake.party("A", { code: opts.code, salt: ids.salt, A: ids.A, B: ids.B, aad: conn.exporter() });
    var res;
    return conn.request({ op: "pair", pA: party.start().toString("base64"), name: opts.name || "Computer" }).then(function (r) {
        res = party.finish(Buffer.from(String(r.pB || ""), "base64"));
        // The device's confirmation first: a wrong one is a wrong code (or
        // something in the middle), and nothing more is sent.
        if (!party.verify(Buffer.from(String(r.confirm || ""), "base64"))) {
            throw fail("WRONG_CODE", "That code is not the one the device shows (or something between this computer and the device changed the exchange)");
        }
        var crypto = require("crypto");
        var proof = crypto.sign(null, Buffer.from(require("../novaservice").proofText("A", res.TT)), me.privateKey).toString("base64");
        return conn.request({ op: "pairConfirm", confirm: res.confirm.toString("base64"), proof: proof });
    }).then(function (r) {
        var good = require("./trust").verifySig(require("../novaservice").proofText("B", res.TT), r.proof, conn.deviceKey);
        if (!good) throw fail("WRONG_CODE", "The device did not prove it holds its key");
        return { deviceKey: conn.deviceKey, fingerprint: keys.fingerprint(conn.deviceKey) };
    });
}

module.exports = { PORT: PORT, EXPORTER_LABEL: EXPORTER_LABEL, FORWARD_PORTS: FORWARD_PORTS, frames: frames, isPrivate: isPrivate,
                   createServer: createServer, connect: connect, pair: pair, connectLocal: function (port) { return net.connect(port, "127.0.0.1"); } };
