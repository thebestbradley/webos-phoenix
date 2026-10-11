// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// SASL SCRAM (RFC 5802; SCRAM-SHA-256: RFC 7677), the client's side and,
// for the tests' fake server, the server's. Over Web Crypto (the
// simulator's page, Node 15 and later: crypto.webcrypto), so the same file
// runs everywhere. Channel binding (-PLUS) is not offered: a page cannot
// read the TLS connection's exporter, and a device's must be added with
// the socket (docs/OPEN-QUESTIONS.md).
//
//   var c = clientFirst({username, nonce?})     -> {message, state}
//   clientFinal(state, serverFirst, password, hash) -> Promise<{message, serverSignature}>
//   verifyServerFinal(serverFinal, serverSignature) -> bool
//   hashes: {"SCRAM-SHA-256": "SHA-256", "SCRAM-SHA-1": "SHA-1"}

"use strict";

var HASHES = { "SCRAM-SHA-256": "SHA-256", "SCRAM-SHA-1": "SHA-1" };

function subtle() {
    var g = typeof globalThis !== "undefined" ? globalThis : {};
    if (g.crypto && g.crypto.subtle) return g.crypto;
    try { return require("crypto").webcrypto; } catch (e) { return null; }
}
function randomBytes(n) {
    var c = subtle();
    if (!c) throw new Error("No crypto here");
    var b = new Uint8Array(n);
    c.getRandomValues(b);
    return b;
}

// UTF-8 and Base64 without Node's Buffer (the page has none).
function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
}
function fromUtf8(b) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
    return Buffer.from(b).toString("utf8");
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
    var out = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
        var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < bytes.length) {
        var m = bytes[i] << 16 | (i + 1 < bytes.length ? bytes[i + 1] << 8 : 0);
        out += B64[m >> 18] + B64[(m >> 12) & 63] + (i + 1 < bytes.length ? B64[(m >> 6) & 63] : "=") + "=";
    }
    return out;
}
function fromBase64(text) {
    text = String(text || "").replace(/[^A-Za-z0-9+/]/g, "");
    var out = [], bits = 0, acc = 0;
    for (var i = 0; i < text.length; i++) {
        acc = (acc << 6) | B64.indexOf(text.charAt(i));
        bits += 6;
        if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return new Uint8Array(out);
}

function hmac(hash, key, data) {
    var c = subtle().subtle;
    return c.importKey("raw", key, { name: "HMAC", hash: hash }, false, ["sign"]).then(function (k) {
        return c.sign("HMAC", k, data);
    }).then(function (b) { return new Uint8Array(b); });
}
function digest(hash, data) {
    return subtle().subtle.digest(hash, data).then(function (b) { return new Uint8Array(b); });
}
function pbkdf2(hash, password, salt, iterations) {
    var c = subtle().subtle;
    var bits = hash === "SHA-1" ? 160 : 256;
    return c.importKey("raw", password, "PBKDF2", false, ["deriveBits"]).then(function (k) {
        return c.deriveBits({ name: "PBKDF2", salt: salt, iterations: iterations, hash: hash }, k, bits);
    }).then(function (b) { return new Uint8Array(b); });
}
function xor(a, b) {
    var out = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return out;
}
function equal(a, b) {
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
}

// RFC 5802 5.1: "=" and "," in the name are escaped.
function saslName(s) { return String(s).replace(/=/g, "=3D").replace(/,/g, "=2C"); }
function attributes(msg) {
    var out = {};
    String(msg).split(",").forEach(function (part) {
        var i = part.indexOf("=");
        if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
    });
    return out;
}

function clientFirst(o) {
    var nonce = o.nonce || toBase64(randomBytes(18)).replace(/[^A-Za-z0-9]/g, "");
    var bare = "n=" + saslName(o.username) + ",r=" + nonce;
    return { message: "n,," + bare, state: { bare: bare, nonce: nonce } };
}

// The proof for the server's first message; the signature to expect.
function clientFinal(state, serverFirst, password, hash) {
    var a = attributes(serverFirst);
    if (!a.r || a.r.indexOf(state.nonce) !== 0) return Promise.reject(new Error("The server's nonce does not continue ours"));
    var iterations = parseInt(a.i, 10);
    if (!(iterations >= 1)) return Promise.reject(new Error("No iteration count"));
    // RFC 5802 5.1: "c=" is the GS2 header in Base64 ("n,," without binding).
    var withoutProof = "c=" + toBase64(utf8("n,,")) + ",r=" + a.r;
    var authMessage = utf8(state.bare + "," + serverFirst + "," + withoutProof);
    var salted;
    return pbkdf2(hash, utf8(password), fromBase64(a.s), iterations).then(function (s) {
        salted = s;
        return hmac(hash, salted, utf8("Client Key"));
    }).then(function (clientKey) {
        return digest(hash, clientKey).then(function (storedKey) {
            return hmac(hash, storedKey, authMessage);
        }).then(function (clientSignature) {
            var proof = xor(clientKey, clientSignature);
            return hmac(hash, salted, utf8("Server Key")).then(function (serverKey) {
                return hmac(hash, serverKey, authMessage);
            }).then(function (serverSignature) {
                return { message: withoutProof + ",p=" + toBase64(proof), serverSignature: serverSignature };
            });
        });
    });
}

function verifyServerFinal(serverFinal, serverSignature) {
    var a = attributes(serverFinal);
    if (a.e) return false;
    return !!a.v && equal(fromBase64(a.v), serverSignature);
}

// ---- The server's side (tests' fake server) ------------------------------------------------

function serverKeys(password, salt, iterations, hash) {
    return pbkdf2(hash, utf8(password), salt, iterations).then(function (salted) {
        return Promise.all([hmac(hash, salted, utf8("Client Key")), hmac(hash, salted, utf8("Server Key"))]);
    }).then(function (keys) {
        return digest(hash, keys[0]).then(function (storedKey) { return { storedKey: storedKey, serverKey: keys[1] }; });
    });
}

// clientFirstMessage -> {serverFirst, finish(clientFinalMessage) -> Promise<serverFinal | null>}
function serverExchange(clientFirstMessage, lookup, hash) {
    var gs2 = clientFirstMessage.slice(0, clientFirstMessage.indexOf(",", clientFirstMessage.indexOf(",") + 1) + 1);
    var bare = clientFirstMessage.slice(gs2.length);
    var a = attributes(bare);
    var user = String(a.n || "").replace(/=2C/g, ",").replace(/=3D/g, "=");
    var nonce = a.r + toBase64(randomBytes(12)).replace(/[^A-Za-z0-9]/g, "");
    var salt = randomBytes(16), iterations = 4096;
    var serverFirst = "r=" + nonce + ",s=" + toBase64(salt) + ",i=" + iterations;
    return {
        user: user,
        serverFirst: serverFirst,
        finish: function (clientFinalMessage) {
            var password = lookup(user);
            if (password === null || password === undefined) return Promise.resolve(null);
            var f = attributes(clientFinalMessage);
            var withoutProof = clientFinalMessage.slice(0, clientFinalMessage.lastIndexOf(",p="));
            if (f.r !== nonce) return Promise.resolve(null);
            var authMessage = utf8(bare + "," + serverFirst + "," + withoutProof);
            return serverKeys(password, salt, iterations, hash).then(function (k) {
                return hmac(hash, k.storedKey, authMessage).then(function (clientSignature) {
                    var clientKey = xor(fromBase64(f.p), clientSignature);
                    return digest(hash, clientKey).then(function (check) {
                        if (!equal(check, k.storedKey)) return null;
                        return hmac(hash, k.serverKey, authMessage).then(function (sig) { return "v=" + toBase64(sig); });
                    });
                });
            });
        }
    };
}

module.exports = {
    HASHES: HASHES, clientFirst: clientFirst, clientFinal: clientFinal, verifyServerFinal: verifyServerFinal,
    serverExchange: serverExchange, toBase64: toBase64, fromBase64: fromBase64, utf8: utf8, fromUtf8: fromUtf8,
    randomBytes: randomBytes, digest: digest
};
