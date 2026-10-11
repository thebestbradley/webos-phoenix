// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The SSH transport layer (RFC 4253) over a socket of bytes: the version
// exchange, the binary packet protocol, the key exchange and re-exchange,
// encryption and integrity, as a client (the SFTP drive) or a server (the
// tests' and the simulator's stand-in, service/test/fake-sftp.cjs).
//
//   key exchange    curve25519-sha256 (RFC 8731, and its @libssh.org
//                   name), ecdh-sha2-nistp256 / -nistp384 (RFC 5656),
//                   diffie-hellman-group16-sha512 / group14-sha256 (RFC 8268)
//   host keys       ssh-ed25519, ecdsa-sha2-nistp256 / -nistp384,
//                   rsa-sha2-512 / -256 (keys.js); the client checks the
//                   key with verifyHostKey before anything else is sent
//   ciphers         chacha20-poly1305@openssh.com, aes256-ctr, aes128-ctr
//   integrity       hmac-sha2-256-etm@openssh.com, hmac-sha2-512-etm@openssh.com,
//                   hmac-sha2-256, hmac-sha2-512 (for the CTR ciphers)
//   extensions      strict key exchange (kex-strict-c/s-v00@openssh.com:
//                   OpenSSH's PROTOCOL 1.10, the answer to the "Terrapin"
//                   prefix truncation, CVE-2023-48795), ext-info (RFC 8308:
//                   the server's server-sig-algs)
//
// No compression; no SSH-1. Keys are exchanged again after a gigabyte
// either way (RFC 4253 9), and whenever the other side asks.
//
//   var t = createTransport({socket, role: "client", verifyHostKey(info) -> Promise<bool>,
//                            hostKeyAlgorithms?, log?, timers?, now?})
//   var t = createTransport({socket, role: "server", hostKeys: [privateKey], ...})
//   t.ready -> Promise (the first exchange done)
//   t.send(payload)      t.onMessage(fn(type, payload))   t.onClose(fn(error?))
//   t.disconnect(reason, text)   t.sessionId   t.hostKey   t.serverSigAlgs
//
// socket: {write(bytes), onData(fn(bytes)), onClose(fn(error?)), close()}.
// Errors carry errorCode: HOST_KEY_REJECTED, 503_SERVICE_UNAVAILABLE (too
// many connections; with retryAt), SSH_PROTOCOL, SSH_DISCONNECTED,
// CONNECTION_TIMEOUT, or the socket's own code (ECONNRESET, ...).

"use strict";

var W = require("./wire");
var C = require("./crypto");
var K = require("./keys");

var MSG = {
    DISCONNECT: 1, IGNORE: 2, UNIMPLEMENTED: 3, DEBUG: 4, SERVICE_REQUEST: 5, SERVICE_ACCEPT: 6, EXT_INFO: 7,
    KEXINIT: 20, NEWKEYS: 21, KEX_INIT: 30, KEX_REPLY: 31
};
var DISCONNECT = {
    PROTOCOL_ERROR: 2, KEY_EXCHANGE_FAILED: 3, MAC_ERROR: 5, SERVICE_NOT_AVAILABLE: 7, HOST_KEY_NOT_VERIFIABLE: 9,
    BY_APPLICATION: 11, TOO_MANY_CONNECTIONS: 12, NO_MORE_AUTH_METHODS_AVAILABLE: 14
};

var IDENT = "SSH-2.0-WebOSPhoenix_1.0";
// OpenSSH's PACKET_MAX_SIZE: anything longer is not a packet of a working peer.
var MAX_PACKET = 256 * 1024 + 4096;
var REKEY_BYTES = 1024 * 1024 * 1024;
var REKEY_PACKETS = Math.pow(2, 28);
var KEX_TIMEOUT_MS = 30000;
// How long a server that says it has too many connections is left alone.
var BUSY_BACKOFF_MS = 10 * 60 * 1000;

var KEX = {
    "curve25519-sha256": { kind: "x25519", hash: "sha256" },
    "curve25519-sha256@libssh.org": { kind: "x25519", hash: "sha256" },
    "ecdh-sha2-nistp256": { kind: "ecdh", curve: "nistp256", hash: "sha256" },
    "ecdh-sha2-nistp384": { kind: "ecdh", curve: "nistp384", hash: "sha384" },
    "diffie-hellman-group16-sha512": { kind: "dh", group: "group16", hash: "sha512" },
    "diffie-hellman-group14-sha256": { kind: "dh", group: "group14", hash: "sha256" }
};
var KEX_ORDER = Object.keys(KEX);
var HOST_KEY_ORDER = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "rsa-sha2-512", "rsa-sha2-256"];
var CIPHERS = {
    "chacha20-poly1305@openssh.com": { mode: "chacha", keyLen: 64, ivLen: 0, block: 8, aead: true },
    "aes256-ctr": { mode: "ctr", keyLen: 32, ivLen: 16, block: 16 },
    "aes128-ctr": { mode: "ctr", keyLen: 16, ivLen: 16, block: 16 }
};
var CIPHER_ORDER = Object.keys(CIPHERS);
var MACS = {
    "hmac-sha2-256-etm@openssh.com": { hash: "sha256", len: 32, etm: true },
    "hmac-sha2-512-etm@openssh.com": { hash: "sha512", len: 64, etm: true },
    "hmac-sha2-256": { hash: "sha256", len: 32, etm: false },
    "hmac-sha2-512": { hash: "sha512", len: 64, etm: false }
};
var MAC_ORDER = Object.keys(MACS);

function sshError(message, errorCode, extra) {
    var e = new Error(message);
    e.errorCode = errorCode;
    if (errorCode === "SSH_PROTOCOL") e.code = 9;
    return Object.assign(e, extra || {});
}

// Incoming bytes, taken from the front.
function ByteQueue() { this.chunks = []; this.length = 0; }
ByteQueue.prototype.push = function (b) { if (b.length) { this.chunks.push(b); this.length += b.length; } };
ByteQueue.prototype.peek = function (n) {
    if (n > this.length) return null;
    if (this.chunks[0].length >= n) return this.chunks[0].subarray(0, n);
    var out = new Uint8Array(n), off = 0, i = 0;
    while (off < n) {
        var c = this.chunks[i++], take = Math.min(c.length, n - off);
        out.set(c.subarray(0, take), off);
        off += take;
    }
    return out;
};
ByteQueue.prototype.skip = function (n) {
    this.length -= n;
    while (n > 0) {
        var c = this.chunks[0];
        if (c.length <= n) { n -= c.length; this.chunks.shift(); }
        else { this.chunks[0] = c.subarray(n); n = 0; }
    }
};
ByteQueue.prototype.take = function (n) { var b = this.peek(n); if (b) { b = b.slice(); this.skip(n); } return b; };

function negotiate(client, server, what) {
    for (var i = 0; i < client.length; i++) {
        if (/^(ext-info-[cs]|kex-strict-[cs]-v00@openssh\.com)$/.test(client[i])) continue;
        if (server.indexOf(client[i]) >= 0) return client[i];
    }
    throw sshError("No " + what + " in common with the server (it offers " + server.join(", ") + ")", "SSH_PROTOCOL");
}

function uint32Bytes(n) { return new W.Writer(4).uint32(n).bytes(); }

// One direction's keys: encrypt (send) or decrypt (receive).
function directionState(cipherName, macName, key, iv, macKey) {
    var c = CIPHERS[cipherName];
    var s = { name: cipherName, mode: c.mode, block: c.block, aead: !!c.aead, mac: null, macLen: 0, etm: false };
    if (c.mode === "chacha") s.cp = C.chachaPoly(key);
    else {
        s.ctr = C.aesCtr(key, iv);
        var m = MACS[macName];
        s.mac = function (data) { return C.hmac(m.hash, macKey, data); };
        s.macLen = m.len;
        s.etm = m.etm;
    }
    return s;
}

function createTransport(o) {
    var socket = o.socket;
    var role = o.role || "client";
    var log = o.log || function () {};
    var timers = o.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    var now = o.now || function () { return Date.now(); };
    var ident = o.ident || IDENT;

    var inq = new ByteQueue();
    var peerIdent = null;
    var send = { state: null, seq: 0, bytes: 0, packets: 0 };
    var recv = { state: null, seq: 0, bytes: 0, packets: 0, first: null };
    var kex = null;            // the exchange under way
    var firstKex = true, strict = false;
    var sessionId = null;
    var queued = [];           // upper-layer messages held during an exchange
    var paused = false;        // input held while the host key is checked
    var closed = false, closeError = null;
    var msgFns = [], closeFns = [];
    var readyResolve, readyReject;
    var ready = new Promise(function (res, rej) { readyResolve = res; readyReject = rej; });
    ready.catch(function () {});
    var api;

    var kexTimer = timers.setTimeout(function () {
        if (!sessionId) fail(sshError("The server did not finish the SSH handshake in time", "CONNECTION_TIMEOUT"));
    }, o.handshakeTimeoutMs || KEX_TIMEOUT_MS);

    function fail(err) {
        if (closed) return;
        closed = true;
        closeError = err || null;
        timers.clearTimeout(kexTimer);
        try { socket.close(); } catch (e) { /* closed */ }
        readyReject(err || sshError("The connection closed", "SSH_DISCONNECTED"));
        closeFns.forEach(function (f) { try { f(err || null); } catch (e) { log("close handler: " + e.message); } });
    }

    function disconnect(reason, text) {
        if (closed) return;
        try {
            sendPacket(new W.Writer().byte(MSG.DISCONNECT).uint32(reason).string(text || "").string("").bytes());
        } catch (e) { /* the socket is gone already */ }
        fail(reason === DISCONNECT.BY_APPLICATION ? null : sshError(text || "Disconnected", "SSH_DISCONNECTED", { reason: reason }));
    }

    function protocolError(text) {
        log("protocol error: " + text);
        var e = sshError(text, "SSH_PROTOCOL");
        if (!closed) {
            try { sendPacket(new W.Writer().byte(MSG.DISCONNECT).uint32(DISCONNECT.PROTOCOL_ERROR).string(text).string("").bytes()); }
            catch (x) { /* gone */ }
        }
        fail(e);
    }

    // ---- Writing packets ----------------------------------------------------------------------

    function sendPacket(payload) {
        if (closed && payload[0] !== MSG.DISCONNECT) throw sshError("The connection is closed", "SSH_DISCONNECTED");
        var s = send.state;
        var block = s ? s.block : 8;
        var excludeLen = s && (s.aead || s.etm);
        var padLen = block - (((excludeLen ? 0 : 4) + 1 + payload.length) % block);
        if (padLen < 4) padLen += block;
        var body = new Uint8Array(1 + payload.length + padLen);
        body[0] = padLen;
        body.set(payload, 1);
        body.set(C.randomBytes(padLen), 1 + payload.length);
        var lenBytes = uint32Bytes(body.length);
        var out;
        if (!s) out = W.concat([lenBytes, body]);
        else if (s.mode === "chacha") out = s.cp.encrypt(send.seq, lenBytes, body);
        else if (s.etm) {
            var enc = s.ctr.update(body);
            out = W.concat([lenBytes, enc, s.mac(W.concat([uint32Bytes(send.seq), lenBytes, enc]))]);
        } else {
            var plain = W.concat([lenBytes, body]);
            var tag = s.mac(W.concat([uint32Bytes(send.seq), plain]));
            out = W.concat([s.ctr.update(plain), tag]);
        }
        send.seq = (send.seq + 1) >>> 0;
        send.bytes += out.length;
        send.packets++;
        socket.write(out);
    }

    function isKexMessage(type) { return type <= 4 || (type >= 20 && type <= 49); }

    function sendMessage(payload) {
        if (closed) throw closeError || sshError("The connection is closed", "SSH_DISCONNECTED");
        if (kex && kex.sentInit && !kex.sentNewKeys && !isKexMessage(payload[0])) { queued.push(payload); return; }
        if (!sessionId && !isKexMessage(payload[0])) { queued.push(payload); return; }
        sendPacket(payload);
        maybeRekey();
    }

    function maybeRekey() {
        if (kex || !sessionId || closed) return;
        var limit = o.rekeyBytes || REKEY_BYTES;
        if (send.bytes > limit || recv.bytes > limit || send.packets > REKEY_PACKETS || recv.packets > REKEY_PACKETS) {
            log("keys are exchanged again");
            startKex();
        }
    }

    // ---- The key exchange --------------------------------------------------------------------

    function kexinitPayload() {
        var kexAlgs = (o.kexAlgorithms || KEX_ORDER).slice();
        var hostAlgs;
        if (role === "client") {
            if (firstKex) kexAlgs.push("ext-info-c", "kex-strict-c-v00@openssh.com");
            hostAlgs = (o.hostKeyAlgorithms || HOST_KEY_ORDER).slice();
        } else {
            if (firstKex) kexAlgs.push("kex-strict-s-v00@openssh.com");
            hostAlgs = [];
            (o.hostKeys || []).forEach(function (k) { K.SIG_ALGS[k.type].forEach(function (a) { if (hostAlgs.indexOf(a) < 0) hostAlgs.push(a); }); });
        }
        var ciphers = o.ciphers || CIPHER_ORDER, macs = o.macs || MAC_ORDER;
        return new W.Writer().byte(MSG.KEXINIT).raw(C.randomBytes(16))
            .nameList(kexAlgs).nameList(hostAlgs).nameList(ciphers).nameList(ciphers).nameList(macs).nameList(macs)
            .nameList(["none"]).nameList(["none"]).nameList([]).nameList([]).bool(false).uint32(0).bytes();
    }

    function startKex() {
        kex = kex || {};
        if (kex.sentInit) return;
        kex.ours = kexinitPayload();
        kex.sentInit = true;
        sendPacket(kex.ours);
    }

    function parseKexinit(payload) {
        var r = new W.Reader(payload, 17);
        var lists = [];
        for (var i = 0; i < 10; i++) lists.push(r.nameList());
        return { kex: lists[0], hostKey: lists[1], encCS: lists[2], encSC: lists[3], macCS: lists[4], macSC: lists[5],
                 compCS: lists[6], compSC: lists[7], follows: r.bool() };
    }

    function onKexinit(payload) {
        if (kex && kex.theirs) return protocolError("A second KEXINIT during a key exchange");
        startKex();
        kex.theirs = payload;
        var mine = parseKexinit(kex.ours), theirs = parseKexinit(payload);
        var c = role === "client" ? mine : theirs, s = role === "client" ? theirs : mine;
        if (firstKex) {
            strict = role === "client" ? s.kex.indexOf("kex-strict-s-v00@openssh.com") >= 0 : c.kex.indexOf("kex-strict-c-v00@openssh.com") >= 0;
            if (strict && recv.packets !== 1) return protocolError("Strict key exchange: KEXINIT was not the first packet");
            kex.extInfo = role === "server" && c.kex.indexOf("ext-info-c") >= 0;
        }
        var n = kex.n = {
            kex: negotiate(c.kex, s.kex, "key exchange method"),
            hostKey: negotiate(c.hostKey, s.hostKey, "host key algorithm"),
            encCS: negotiate(c.encCS, s.encCS, "cipher (to the server)"),
            encSC: negotiate(c.encSC, s.encSC, "cipher (from the server)"),
            comp: negotiate(c.compCS, s.compCS, "compression")
        };
        n.macCS = CIPHERS[n.encCS].aead ? null : negotiate(c.macCS, s.macCS, "integrity algorithm (to the server)");
        n.macSC = CIPHERS[n.encSC].aead ? null : negotiate(c.macSC, s.macSC, "integrity algorithm (from the server)");
        negotiate(c.compSC, s.compSC, "compression");
        // A guessed first packet that guessed wrong is ignored (RFC 4253 7).
        if (theirs.follows && (c.kex[0] !== s.kex[0] || c.hostKey[0] !== s.hostKey[0])) kex.ignoreNext = true;
        log("key exchange: " + n.kex + ", " + n.hostKey + ", " + n.encCS + (n.macCS ? " + " + n.macCS : ""));
        if (role === "client") sendKexInit();
    }

    function sendKexInit() {
        var m = KEX[kex.n.kex];
        var w = new W.Writer().byte(MSG.KEX_INIT);
        if (m.kind === "x25519") { kex.eph = C.x25519.generate(); w.string(kex.eph.pub); }
        else if (m.kind === "ecdh") { kex.eph = C.ecdh.generate(m.curve); w.string(kex.eph.pub); }
        else { kex.group = C.dhGroup(m.group); kex.eph = kex.group.generate(); w.mpint(kex.eph.e); }
        sendPacket(w.bytes());
    }

    // The exchange hash's inputs common to both sides, and K from the other side's value.
    function secretOf(m, theirPub) {
        if (m.kind === "x25519") return C.x25519.shared(kex.eph.priv, theirPub);
        if (m.kind === "ecdh") return C.ecdh.shared(m.curve, kex.eph.priv, theirPub);
        return kex.group.secret(kex.eph.x, theirPub);
    }

    function exchangeHash(m, hostKeyBlob, clientPub, serverPub, secret) {
        var vc = role === "client" ? ident : peerIdent, vs = role === "client" ? peerIdent : ident;
        var ic = role === "client" ? kex.ours : kex.theirs, is = role === "client" ? kex.theirs : kex.ours;
        var w = new W.Writer().string(vc).string(vs).string(ic).string(is).string(hostKeyBlob);
        if (m.kind === "dh") w.mpint(clientPub).mpint(serverPub);
        else w.string(clientPub).string(serverPub);
        w.mpint(secret);
        return C.hash(m.hash, w.bytes());
    }

    function deriveKeys(m, secret, H) {
        var kEnc = new W.Writer().mpint(secret).bytes();
        var sid = sessionId || H;
        function derive(letter, need) {
            if (!need) return new Uint8Array(0);
            var out = C.hash(m.hash, W.concat([kEnc, H, new Uint8Array([letter.charCodeAt(0)]), sid]));
            while (out.length < need) out = W.concat([out, C.hash(m.hash, W.concat([kEnc, H, out]))]);
            return out.slice(0, need);
        }
        var n = kex.n;
        var cs = CIPHERS[n.encCS], sc = CIPHERS[n.encSC];
        var macCS = n.macCS ? MACS[n.macCS] : null, macSC = n.macSC ? MACS[n.macSC] : null;
        var toServer = directionState(n.encCS, n.macCS, derive("C", cs.keyLen), derive("A", cs.ivLen), derive("E", macCS ? macCS.len : 0));
        var toClient = directionState(n.encSC, n.macSC, derive("D", sc.keyLen), derive("B", sc.ivLen), derive("F", macSC ? macSC.len : 0));
        kex.sendState = role === "client" ? toServer : toClient;
        kex.recvState = role === "client" ? toClient : toServer;
        kex.H = H;
    }

    // The client: the server's answer, its host key checked, then NEWKEYS.
    function onKexReply(payload) {
        var m = KEX[kex.n.kex];
        var r = new W.Reader(payload, 1);
        var hostBlob = r.string().slice();
        var theirPub = m.kind === "dh" ? W.toBigInt(r.mpint()) : r.string().slice();
        var sig = r.string().slice();
        var secret, H;
        try {
            secret = m.kind === "dh" ? secretOf(m, theirPub) : W.toBigInt(secretOf(m, theirPub));
            H = exchangeHash(m, hostBlob, m.kind === "dh" ? kex.eph.e : kex.eph.pub, theirPub, secret);
        } catch (e) {
            return disconnectWith(DISCONNECT.KEY_EXCHANGE_FAILED, "The key exchange failed: " + e.message, "SSH_PROTOCOL");
        }
        if (!K.verify(hostBlob, sig, H, kex.n.hostKey))
            return disconnectWith(DISCONNECT.KEY_EXCHANGE_FAILED, "The server's signature of the key exchange is not valid", "SSH_PROTOCOL");
        var info = { algorithm: kex.n.hostKey, type: K.keyTypeOf(kex.n.hostKey), blob: hostBlob, key: W.base64(hostBlob),
                     fingerprint: K.fingerprint(hostBlob), description: K.describe(hostBlob) };
        // The same server must answer with the same key on a re-exchange.
        if (api.hostKey && !W.equal(api.hostKey.blob, hostBlob))
            return disconnectWith(DISCONNECT.HOST_KEY_NOT_VERIFIABLE, "The server's key changed during the connection", "HOST_KEY_REJECTED");
        deriveKeys(m, secret, H);
        var check = api.hostKey || !o.verifyHostKey ? Promise.resolve(true) : Promise.resolve().then(function () { return o.verifyHostKey(info); });
        paused = true;
        check.then(function (ok) {
            if (closed) return;
            if (!ok) return disconnectWith(DISCONNECT.HOST_KEY_NOT_VERIFIABLE, "The server's key was not accepted", "HOST_KEY_REJECTED", { hostKey: info });
            api.hostKey = info;
            sendNewKeys();
            paused = false;
            pump();
        }, function (e) {
            if (closed) return;
            e = e || {};
            if (!e.errorCode) e.errorCode = "HOST_KEY_REJECTED";
            e.hostKey = e.hostKey || info;
            try { sendPacket(new W.Writer().byte(MSG.DISCONNECT).uint32(DISCONNECT.HOST_KEY_NOT_VERIFIABLE).string("Host key not accepted").string("").bytes()); }
            catch (x) { /* gone */ }
            fail(e);
        });
    }

    function disconnectWith(reason, text, errorCode, extra) {
        if (closed) return;
        try { sendPacket(new W.Writer().byte(MSG.DISCONNECT).uint32(reason).string(text).string("").bytes()); } catch (e) { /* gone */ }
        fail(sshError(text, errorCode, extra));
    }

    // The server: the client's value, our answer signed with the host key.
    function onKexInitServer(payload) {
        var m = KEX[kex.n.kex];
        var r = new W.Reader(payload, 1);
        var theirPub = m.kind === "dh" ? W.toBigInt(r.mpint()) : r.string().slice();
        var hostKey = (o.hostKeys || []).filter(function (k) { return k.type === K.keyTypeOf(kex.n.hostKey); })[0];
        var w = new W.Writer().byte(MSG.KEX_REPLY);
        var ourPub, secret;
        try {
            if (m.kind === "x25519") { kex.eph = C.x25519.generate(); ourPub = kex.eph.pub; }
            else if (m.kind === "ecdh") { kex.eph = C.ecdh.generate(m.curve); ourPub = kex.eph.pub; }
            else { kex.group = C.dhGroup(m.group); kex.eph = kex.group.generate(); ourPub = kex.eph.e; }
            secret = m.kind === "dh" ? secretOf(m, theirPub) : W.toBigInt(secretOf(m, theirPub));
        } catch (e) {
            return disconnectWith(DISCONNECT.KEY_EXCHANGE_FAILED, "The key exchange failed: " + e.message, "SSH_PROTOCOL");
        }
        var blob = K.publicBlob(hostKey);
        var H = exchangeHash(m, blob, theirPub, ourPub, secret);
        w.string(blob);
        if (m.kind === "dh") w.mpint(ourPub); else w.string(ourPub);
        w.string(K.sign(hostKey, H, kex.n.hostKey));
        deriveKeys(m, secret, H);
        sendPacket(w.bytes());
        sendNewKeys();
    }

    function sendNewKeys() {
        sendPacket(new Uint8Array([MSG.NEWKEYS]));
        send.state = kex.sendState;
        if (strict && firstKex) send.seq = 0;
        send.bytes = 0;
        send.packets = 0;
        kex.sentNewKeys = true;
        if (role === "server" && kex.extInfo) {
            sendPacket(new W.Writer().byte(MSG.EXT_INFO).uint32(1).string("server-sig-algs")
                .string("ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,rsa-sha2-512,rsa-sha2-256").bytes());
        }
        // A re-exchange: what waited goes now, in order, before anything newer.
        if (sessionId) flushQueued();
        finishKexIfDone();
    }

    function onNewKeys() {
        if (!kex || !kex.recvState) return protocolError("NEWKEYS before the key exchange");
        recv.state = kex.recvState;
        if (strict && firstKex) recv.seq = 0;
        recv.bytes = 0;
        recv.packets = 0;
        recv.first = null;
        kex.gotNewKeys = true;
        finishKexIfDone();
    }

    function finishKexIfDone() {
        if (!kex.sentNewKeys || !kex.gotNewKeys) return;
        var first = !sessionId;
        if (first) sessionId = kex.H;
        kex = null;
        firstKex = false;
        flushQueued();
        if (first) { timers.clearTimeout(kexTimer); readyResolve(); }
    }

    function flushQueued() {
        var q = queued;
        queued = [];
        q.forEach(function (p) { if (!closed) sendPacket(p); });
    }

    // ---- Reading packets --------------------------------------------------------------------

    function readVersion() {
        // Lines before the version line are allowed from a server (RFC 4253 4.2).
        for (var guard = 0; guard < 64; guard++) {
            var head = inq.peek(Math.min(inq.length, 512));
            if (!head) return false;
            var nl = -1;
            for (var i = 0; i < head.length; i++) if (head[i] === 10) { nl = i; break; }
            if (nl < 0) {
                if (inq.length >= 512) protocolError("The server did not say it speaks SSH");
                return false;
            }
            var line = W.latin1(inq.take(nl + 1)).replace(/\r?\n$/, "");
            if (/^SSH-/.test(line)) {
                if (!/^SSH-(2\.0|1\.99)-/.test(line)) { protocolError("The other side speaks an SSH version Phoenix does not (" + line + ")"); return false; }
                peerIdent = line;
                log("peer: " + line);
                return true;
            }
            if (role === "server") { protocolError("Not an SSH client"); return false; }
        }
        protocolError("The server did not say it speaks SSH");
        return false;
    }

    function readPacket() {
        var s = recv.state, len, body, need, raw;
        if (!s) {
            var lb = inq.peek(4);
            if (!lb) return null;
            len = new W.Reader(lb).uint32();
            if (len < 5 || len > MAX_PACKET || (len + 4) % 8) throw sshError("A packet of the wrong length (" + len + ")", "SSH_PROTOCOL");
            if (inq.length < 4 + len) return null;
            body = inq.take(4 + len).subarray(4);
        } else if (s.mode === "chacha") {
            var el = inq.peek(4);
            if (!el) return null;
            len = s.cp.length(recv.seq, el);
            if (len < 8 || len > MAX_PACKET || len % 8) throw sshError("A packet of the wrong length (" + len + ")", "SSH_PROTOCOL");
            need = 4 + len + 16;
            if (inq.length < need) return null;
            raw = inq.take(need);
            body = s.cp.decrypt(recv.seq, raw.subarray(0, 4 + len), raw.subarray(4 + len));
            if (!body) throw sshError("A packet failed its integrity check", "SSH_PROTOCOL", { reason: DISCONNECT.MAC_ERROR });
        } else if (s.etm) {
            var eb = inq.peek(4);
            if (!eb) return null;
            len = new W.Reader(eb).uint32();
            if (len < 16 || len > MAX_PACKET || len % s.block) throw sshError("A packet of the wrong length (" + len + ")", "SSH_PROTOCOL");
            need = 4 + len + s.macLen;
            if (inq.length < need) return null;
            raw = inq.take(need);
            var tag = s.mac(W.concat([uint32Bytes(recv.seq), raw.subarray(0, 4 + len)]));
            if (!W.equal(tag, raw.subarray(4 + len))) throw sshError("A packet failed its integrity check", "SSH_PROTOCOL", { reason: DISCONNECT.MAC_ERROR });
            body = s.ctr.update(raw.subarray(4, 4 + len));
        } else {
            // The first block, once (the counter moves on), tells the length.
            if (!recv.first) {
                var fb = inq.peek(s.block);
                if (!fb) return null;
                recv.first = s.ctr.update(fb);
                recv.firstLen = new W.Reader(recv.first).uint32();
                if (recv.firstLen < 12 || recv.firstLen > MAX_PACKET || (recv.firstLen + 4) % s.block)
                    throw sshError("A packet of the wrong length (" + recv.firstLen + ")", "SSH_PROTOCOL");
            }
            len = recv.firstLen;
            need = 4 + len + s.macLen;
            if (inq.length < need) return null;
            raw = inq.take(need);
            var plain = W.concat([recv.first, s.ctr.update(raw.subarray(s.block, 4 + len))]);
            recv.first = null;
            var t2 = s.mac(W.concat([uint32Bytes(recv.seq), plain]));
            if (!W.equal(t2, raw.subarray(4 + len))) throw sshError("A packet failed its integrity check", "SSH_PROTOCOL", { reason: DISCONNECT.MAC_ERROR });
            body = plain.subarray(4);
        }
        var pad = body[0];
        if (pad < 4 || pad >= body.length) throw sshError("A packet with bad padding", "SSH_PROTOCOL");
        recv.seq = (recv.seq + 1) >>> 0;
        recv.bytes += 4 + len;
        recv.packets++;
        return body.subarray(1, body.length - pad);
    }

    function pump() {
        try {
            if (peerIdent === null && !readVersion()) return;
            while (!closed && !paused) {
                var payload = readPacket();
                if (!payload) return;
                dispatch(payload);
            }
        } catch (e) {
            if (e.errorCode === "SSH_PROTOCOL") return protocolError(e.message);
            fail(e);
        }
    }

    function dispatch(payload) {
        if (!payload.length) throw sshError("An empty packet", "SSH_PROTOCOL");
        var type = payload[0];
        if (kex && kex.ignoreNext && type >= 30 && type <= 49) { kex.ignoreNext = false; return; }
        // Strict key exchange: nothing but the exchange before the first NEWKEYS.
        if (strict && !sessionId && !(type === MSG.KEXINIT || type === MSG.NEWKEYS || (type >= 30 && type <= 49) || type === MSG.DISCONNECT))
            throw sshError("Strict key exchange: an unexpected message (" + type + ") during the first key exchange", "SSH_PROTOCOL");
        if (!sessionId && firstKex && recv.packets === 1 && type !== MSG.KEXINIT && type !== MSG.DISCONNECT && type !== MSG.IGNORE && type !== MSG.DEBUG)
            throw sshError("The server did not begin with a key exchange", "SSH_PROTOCOL");
        switch (type) {
        case MSG.DISCONNECT: return onDisconnect(payload);
        case MSG.IGNORE: case MSG.DEBUG: case MSG.UNIMPLEMENTED: return;
        case MSG.EXT_INFO: return onExtInfo(payload);
        case MSG.KEXINIT: return onKexinit(payload);
        case MSG.NEWKEYS: return onNewKeys();
        case MSG.KEX_INIT:
            if (role !== "server" || !kex || !kex.n) throw sshError("An unexpected key exchange message", "SSH_PROTOCOL");
            return onKexInitServer(payload);
        case MSG.KEX_REPLY:
            if (role !== "client" || !kex || !kex.n) throw sshError("An unexpected key exchange message", "SSH_PROTOCOL");
            return onKexReply(payload);
        }
        if (type >= 30 && type <= 49) throw sshError("An unexpected key exchange message (" + type + ")", "SSH_PROTOCOL");
        if (!sessionId) throw sshError("A message (" + type + ") before the keys were exchanged", "SSH_PROTOCOL");
        if (!msgFns.length) {
            sendPacket(new W.Writer().byte(MSG.UNIMPLEMENTED).uint32((recv.seq - 1) >>> 0).bytes());
            return;
        }
        msgFns.forEach(function (f) { f(type, payload); });
    }

    function onDisconnect(payload) {
        var r = new W.Reader(payload, 1);
        var reason = r.uint32(), text = "";
        try { text = r.text(); } catch (e) { text = ""; }
        log("the server disconnected: " + reason + " " + text);
        var e;
        if (reason === DISCONNECT.TOO_MANY_CONNECTIONS)
            e = sshError("The server has too many connections" + (text ? " (" + text + ")" : "") + ". Try again later.", "503_SERVICE_UNAVAILABLE",
                         { retryAt: now() + BUSY_BACKOFF_MS, reason: reason });
        else if (reason === DISCONNECT.NO_MORE_AUTH_METHODS_AVAILABLE)
            e = sshError(text || "The server did not accept the sign-in", "401_UNAUTHORIZED", { reason: reason });
        else e = sshError("The server closed the connection" + (text ? ": " + text : ""), "SSH_DISCONNECTED", { reason: reason });
        fail(e);
    }

    function onExtInfo(payload) {
        var r = new W.Reader(payload, 1);
        var n = r.uint32();
        for (var i = 0; i < n && r.left(); i++) {
            var name = W.latin1(r.string()), value = r.string();
            if (name === "server-sig-algs") api.serverSigAlgs = W.latin1(value).split(",");
        }
    }

    socket.onData(function (bytes) {
        if (closed) return;
        inq.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        if (!paused) pump();
    });
    socket.onClose(function (err) {
        if (closed) return;
        var e = err || {};
        fail(Object.assign(sshError(e.message || "The connection was lost", e.errorCode || "SSH_DISCONNECTED"), e.code ? { code: e.code } : { code: "ECONNRESET" }));
    });

    api = {
        role: role,
        ready: ready,
        hostKey: null,
        serverSigAlgs: null,
        get sessionId() { return sessionId; },
        get closed() { return closed; },
        get peerIdent() { return peerIdent; },
        send: sendMessage,
        onMessage: function (fn) { msgFns.push(fn); },
        onClose: function (fn) { if (closed) fn(closeError); else closeFns.push(fn); },
        disconnect: function (reason, text) { disconnect(reason || DISCONNECT.BY_APPLICATION, text || "Bye"); }
    };

    socket.write(W.utf8(ident + "\r\n"));
    if (role === "client" || o.kexFirst !== false) startKex();
    return api;
}

module.exports = { createTransport: createTransport, MSG: MSG, DISCONNECT: DISCONNECT, IDENT: IDENT, KEX_ORDER: KEX_ORDER,
                   HOST_KEY_ORDER: HOST_KEY_ORDER, CIPHER_ORDER: CIPHER_ORDER, MAC_ORDER: MAC_ORDER, sshError: sshError,
                   BUSY_BACKOFF_MS: BUSY_BACKOFF_MS };
