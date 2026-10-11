// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An SSH client over ctx.net (the kit's sockets; docs/SYNERGY-SDK.md
// "Staying connected"): the transport (transport.js), user authentication
// (RFC 4252: publickey with an Ed25519, RSA or ECDSA key, password, and
// keyboard-interactive answering the password prompt, RFC 4256, which some
// servers use for passwords) and the connection protocol's channels
// (RFC 4254: a session with the "sftp" subsystem, flow control by windows).
//
//   connect({net, host, port, username, password?, key?, verifyHostKey(info),
//            hostKeyAlgorithms?, log?, timers?, now?}) -> Promise<client>
//   client.openSubsystem("sftp") -> Promise<channel>
//   client.close()   client.onClose(fn(error?))   client.hostKey   client.closed
//   channel.write(bytes)   channel.onData(fn(bytes))   channel.onClose(fn())   channel.close()
//
// Errors carry errorCode 401_UNAUTHORIZED (no method was accepted; methods:
// what the server would take), HOST_KEY_REJECTED, ... (transport.js).

"use strict";

var W = require("./wire");
var K = require("./keys");
var T = require("./transport");

var MSG = {
    SERVICE_REQUEST: 5, SERVICE_ACCEPT: 6,
    USERAUTH_REQUEST: 50, USERAUTH_FAILURE: 51, USERAUTH_SUCCESS: 52, USERAUTH_BANNER: 53, USERAUTH_INFO_REQUEST: 60, USERAUTH_INFO_RESPONSE: 61,
    GLOBAL_REQUEST: 80, REQUEST_SUCCESS: 81, REQUEST_FAILURE: 82,
    CHANNEL_OPEN: 90, CHANNEL_OPEN_CONFIRMATION: 91, CHANNEL_OPEN_FAILURE: 92, CHANNEL_WINDOW_ADJUST: 93, CHANNEL_DATA: 94,
    CHANNEL_EXTENDED_DATA: 95, CHANNEL_EOF: 96, CHANNEL_CLOSE: 97, CHANNEL_REQUEST: 98, CHANNEL_SUCCESS: 99, CHANNEL_FAILURE: 100
};
// Our side's window and packet size: what a pipelined SFTP read keeps in flight.
var WINDOW = 4 * 1024 * 1024;
var MAX_PACKET = 32768;

function fail(message, errorCode, extra) {
    var e = new Error(message);
    e.errorCode = errorCode;
    return Object.assign(e, extra || {});
}

function connect(o) {
    var log = o.log || function () {};
    return o.net.connect({ host: o.host, port: o.port || 22, tls: false, binary: true }).then(function (sock) {
        var socket = {
            write: function (b) { sock.writeBytes(b); },
            onData: function (fn) { sock.onBytes(fn); },
            onClose: function (fn) { sock.onClose(fn); },
            close: function () { sock.close(); }
        };
        return start(socket, o);
    }).catch(function (e) {
        log("connection to " + o.host + ":" + (o.port || 22) + " failed: " + (e && e.message));
        throw e;
    });
}

// The client over a socket of bytes already open (the tests' pipes too).
function start(socket, o) {
    var log = o.log || function () {};
    var t = T.createTransport({
        socket: socket, role: "client", verifyHostKey: o.verifyHostKey, hostKeyAlgorithms: o.hostKeyAlgorithms,
        kexAlgorithms: o.kexAlgorithms, ciphers: o.ciphers, macs: o.macs, rekeyBytes: o.rekeyBytes,
        log: log, timers: o.timers, now: o.now, handshakeTimeoutMs: o.handshakeTimeoutMs
    });
    var waiters = [];            // one-shot handlers for the authentication's answers
    var channels = {};
    var nextChannel = 0;
    var closeFns = [];
    var banner = "";

    function nextMessage(types) {
        return new Promise(function (resolve, reject) { waiters.push({ types: types, resolve: resolve, reject: reject }); });
    }

    t.onMessage(function (type, payload) {
        if (type === MSG.USERAUTH_BANNER) {
            try { banner += new W.Reader(payload, 1).text(); } catch (e) { /* a broken banner is no matter */ }
            return;
        }
        for (var i = 0; i < waiters.length; i++) {
            if (waiters[i].types.indexOf(type) >= 0) {
                var w = waiters.splice(i, 1)[0];
                return w.resolve({ type: type, payload: payload });
            }
        }
        if (type >= 90 && type <= 100) return onChannelMessage(type, payload);
        if (type === MSG.GLOBAL_REQUEST) {
            // keepalive@openssh.com and the like: not ours to grant.
            var r = new W.Reader(payload, 1);
            r.string();
            if (r.bool()) t.send(new Uint8Array([MSG.REQUEST_FAILURE]));
            return;
        }
        log("ignored message " + type);
    });
    t.onClose(function (err) {
        waiters.splice(0).forEach(function (w) { w.reject(err || fail("The connection closed", "SSH_DISCONNECTED")); });
        Object.keys(channels).forEach(function (id) { channels[id].lost(err); });
        closeFns.forEach(function (f) { f(err); });
    });

    // ---- Authentication ----------------------------------------------------------------------

    function userauth(method, extra) {
        var w = new W.Writer().byte(MSG.USERAUTH_REQUEST).string(o.username).string("ssh-connection").string(method);
        if (extra) extra(w);
        t.send(w.bytes());
        return nextMessage([MSG.USERAUTH_SUCCESS, MSG.USERAUTH_FAILURE, MSG.USERAUTH_INFO_REQUEST]);
    }
    function methodsOf(m) {
        var r = new W.Reader(m.payload, 1);
        return { methods: r.nameList(), partial: r.bool() };
    }

    function tryKey(key) {
        var blob = K.publicBlob(key);
        var algs = K.SIG_ALGS[key.type];
        var alg = algs[0];
        // RSA: the strongest hash the server says it takes (RFC 8332 3.3);
        // without ext-info, rsa-sha2-256, which every OpenSSH since 7.2 takes.
        if (key.type === "ssh-rsa") {
            var sa = t.serverSigAlgs;
            alg = sa ? (algs.filter(function (a) { return sa.indexOf(a) >= 0; })[0] || "rsa-sha2-256") : "rsa-sha2-256";
        }
        var data = new W.Writer().string(t.sessionId).byte(MSG.USERAUTH_REQUEST).string(o.username).string("ssh-connection")
            .string("publickey").bool(true).string(alg).string(blob).bytes();
        var sig = K.sign(key, data, alg);
        return userauth("publickey", function (w) { w.bool(true).string(alg).string(blob).string(sig); });
    }

    function tryPassword() {
        return userauth("password", function (w) { w.bool(false).string(o.password); });
    }

    // keyboard-interactive: the password for a prompt that asks for it; any
    // other question (a one-time code) is not answered here.
    function tryKeyboard() {
        return userauth("keyboard-interactive", function (w) { w.string("").string(""); }).then(function answer(m) {
            if (m.type !== MSG.USERAUTH_INFO_REQUEST) return m;
            var r = new W.Reader(m.payload, 1);
            r.text(); r.text(); r.string();
            var n = r.uint32(), answers = [];
            for (var i = 0; i < n; i++) {
                var prompt = r.text();
                r.bool();
                if (!/pass(word|code|phrase)?|kennwort|mot de passe|contrase/i.test(prompt)) {
                    var e = fail("The server asks \"" + prompt.trim() + "\" at sign-in, which Phoenix cannot answer here", "401_UNAUTHORIZED",
                                 { prompt: prompt });
                    t.disconnect(T.DISCONNECT.BY_APPLICATION, "Cannot answer");
                    throw e;
                }
                answers.push(o.password);
            }
            var w = new W.Writer().byte(MSG.USERAUTH_INFO_RESPONSE).uint32(answers.length);
            answers.forEach(function (a) { w.string(a); });
            t.send(w.bytes());
            return nextMessage([MSG.USERAUTH_SUCCESS, MSG.USERAUTH_FAILURE, MSG.USERAUTH_INFO_REQUEST]).then(answer);
        });
    }

    function authenticate() {
        t.send(new W.Writer().byte(MSG.SERVICE_REQUEST).string("ssh-userauth").bytes());
        return nextMessage([MSG.SERVICE_ACCEPT]).then(function () {
            // "none" first: the methods the server takes (RFC 4252 5.2).
            return userauth("none");
        }).then(function (m) {
            if (m.type === MSG.USERAUTH_SUCCESS) return;
            var offered = methodsOf(m).methods;
            var tried = [];
            var plan = [];
            if (o.key && offered.indexOf("publickey") >= 0) plan.push("publickey");
            if (o.password && offered.indexOf("password") >= 0) plan.push("password");
            if (o.password && offered.indexOf("keyboard-interactive") >= 0) plan.push("keyboard-interactive");
            function next(last) {
                if (last && last.type === MSG.USERAUTH_SUCCESS) return null;
                if (last) offered = methodsOf(last).methods;
                var method = plan.filter(function (p) { return tried.indexOf(p) < 0 && offered.indexOf(p) >= 0; })[0];
                if (!method) {
                    var why = tried.length ? "The server did not accept " + (o.key ? "the key" : "the password") + " for " + o.username
                                           : "The server takes none of the sign-in methods given (it takes " + offered.join(", ") + ")";
                    throw fail(why, "401_UNAUTHORIZED", { methods: offered, tried: tried });
                }
                tried.push(method);
                var attempt = method === "publickey" ? tryKey(o.key) : method === "password" ? tryPassword() : tryKeyboard();
                return attempt.then(next);
            }
            return next(null);
        });
    }

    // ---- Channels -------------------------------------------------------------------------------

    function Channel(id) {
        this.id = id;
        this.remote = -1;
        this.localWindow = WINDOW;
        this.consumed = 0;
        this.remoteWindow = 0;
        this.remoteMax = MAX_PACKET;
        this.out = [];           // bytes waiting for the remote window
        this.dataFns = [];
        this.closeFns = [];
        this.requests = [];      // want_reply requests waiting, in order
        this.closed = false;
        this.sentClose = false;
        this.eof = false;
    }
    Channel.prototype.write = function (bytes) {
        if (this.closed || this.sentClose) throw fail("The channel is closed", "SSH_DISCONNECTED");
        this.out.push(bytes);
        this.flush();
    };
    Channel.prototype.flush = function () {
        while (this.out.length && this.remoteWindow > 0 && !t.closed) {
            var b = this.out[0];
            var n = Math.min(b.length, this.remoteWindow, this.remoteMax);
            t.send(new W.Writer(n + 16).byte(MSG.CHANNEL_DATA).uint32(this.remote).string(b.subarray(0, n)).bytes());
            this.remoteWindow -= n;
            if (n === b.length) this.out.shift(); else this.out[0] = b.subarray(n);
        }
    };
    Channel.prototype.pending = function () { return this.out.reduce(function (a, b) { return a + b.length; }, 0); };
    Channel.prototype.onData = function (fn) { this.dataFns.push(fn); };
    Channel.prototype.onClose = function (fn) { if (this.closed) fn(this.error); else this.closeFns.push(fn); };
    Channel.prototype.received = function (data) {
        this.consumed += data.length;
        // The window topped up once half of it is used.
        if (this.consumed >= WINDOW / 2) {
            t.send(new W.Writer().byte(MSG.CHANNEL_WINDOW_ADJUST).uint32(this.remote).uint32(this.consumed).bytes());
            this.consumed = 0;
        }
        this.dataFns.forEach(function (f) { f(data); });
    };
    Channel.prototype.request = function (type, wantReply, extra) {
        var self = this;
        var w = new W.Writer().byte(MSG.CHANNEL_REQUEST).uint32(this.remote).string(type).bool(wantReply);
        if (extra) extra(w);
        t.send(w.bytes());
        if (!wantReply) return Promise.resolve(true);
        return new Promise(function (resolve) { self.requests.push(resolve); });
    };
    Channel.prototype.close = function () {
        if (this.sentClose || this.closed) return;
        this.sentClose = true;
        try { t.send(new W.Writer().byte(MSG.CHANNEL_CLOSE).uint32(this.remote).bytes()); } catch (e) { this.lost(e); }
    };
    Channel.prototype.lost = function (err) {
        if (this.closed) return;
        this.closed = true;
        this.error = err || null;
        delete channels[this.id];
        this.requests.splice(0).forEach(function (r) { r(false); });
        var fns = this.closeFns.splice(0);
        fns.forEach(function (f) { f(err || null); });
    };

    function onChannelMessage(type, payload) {
        var r = new W.Reader(payload, 1);
        var ch = channels[r.uint32()];
        if (!ch) return;
        switch (type) {
        case MSG.CHANNEL_OPEN_CONFIRMATION:
            ch.remote = r.uint32();
            ch.remoteWindow = r.uint32();
            ch.remoteMax = Math.min(r.uint32(), MAX_PACKET);
            return ch.opened && ch.opened.resolve(ch);
        case MSG.CHANNEL_OPEN_FAILURE:
            var code = r.uint32(), text = r.text();
            ch.lost();
            return ch.opened && ch.opened.reject(fail("The server would not open a session (" + code + (text ? ": " + text : "") + ")", "SSH_CHANNEL"));
        case MSG.CHANNEL_WINDOW_ADJUST:
            ch.remoteWindow += r.uint32();
            if (ch.remoteWindow > 4294967295) ch.remoteWindow = 4294967295;
            return ch.flush();
        case MSG.CHANNEL_DATA:
            return ch.received(r.string());
        case MSG.CHANNEL_EXTENDED_DATA:
            r.uint32();
            log("server: " + W.fromUtf8(r.string()).trim());
            return;
        case MSG.CHANNEL_EOF:
            ch.eof = true;
            return;
        case MSG.CHANNEL_CLOSE:
            if (!ch.sentClose) {
                ch.sentClose = true;
                try { t.send(new W.Writer().byte(MSG.CHANNEL_CLOSE).uint32(ch.remote).bytes()); } catch (e) { /* gone */ }
            }
            return ch.lost();
        case MSG.CHANNEL_REQUEST:
            var what = W.latin1(r.string());
            if (r.bool()) t.send(new W.Writer().byte(MSG.CHANNEL_FAILURE).uint32(ch.remote).bytes());
            if (what !== "exit-status" && what !== "keepalive@openssh.com") log("channel request " + what + " not taken");
            return;
        case MSG.CHANNEL_SUCCESS: case MSG.CHANNEL_FAILURE:
            var waiting = ch.requests.shift();
            return waiting && waiting(type === MSG.CHANNEL_SUCCESS);
        }
    }

    function openSession() {
        var id = nextChannel++;
        var ch = new Channel(id);
        channels[id] = ch;
        var p = new Promise(function (resolve, reject) { ch.opened = { resolve: resolve, reject: reject }; });
        t.send(new W.Writer().byte(MSG.CHANNEL_OPEN).string("session").uint32(id).uint32(WINDOW).uint32(MAX_PACKET).bytes());
        return p;
    }

    var client = {
        get hostKey() { return t.hostKey; },
        get closed() { return t.closed; },
        get banner() { return banner; },
        openSubsystem: function (name) {
            return openSession().then(function (ch) {
                return ch.request("subsystem", true, function (w) { w.string(name); }).then(function (ok) {
                    if (!ok) {
                        ch.close();
                        throw fail("The server has no " + name + " (its subsystem was refused)", name === "sftp" ? "SFTP_NOT_AVAILABLE" : "SSH_CHANNEL");
                    }
                    return ch;
                });
            });
        },
        close: function () { t.disconnect(T.DISCONNECT.BY_APPLICATION, "Bye"); },
        onClose: function (fn) { closeFns.push(fn); }
    };

    return t.ready.then(authenticate).then(function () {
        log("signed in as " + o.username);
        return client;
    }, function (e) {
        if (!t.closed) t.disconnect(e && e.errorCode === "401_UNAUTHORIZED" ? T.DISCONNECT.NO_MORE_AUTH_METHODS_AVAILABLE : T.DISCONNECT.BY_APPLICATION,
                                    "Bye");
        throw e;
    });
}

module.exports = { connect: connect, start: start, MSG: MSG, WINDOW: WINDOW, MAX_PACKET: MAX_PACKET };
