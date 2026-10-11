// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The cryptography SSH needs, in plain JavaScript so the same code runs in
// a device's Node.js and in the simulator's page (which has no Node crypto
// and no synchronous Web Crypto): the audited @noble libraries (MIT; Paul
// Miller) for the curves, hashes and ciphers, and RSA and finite-field
// Diffie-Hellman on BigInt here (modular exponentiation, PKCS #1 v1.5
// signatures: RFC 8017 8.2 and 9.2).
//
//   hashes      sha256, sha384, sha512, hmac(hash, key, data)
//   X25519      curve25519-sha256 key exchange (RFC 8731)
//   Ed25519     ssh-ed25519 keys and signatures (RFC 8709)
//   ECDSA/ECDH  NIST P-256 and P-384 (RFC 5656): host keys, key exchange
//   ChaCha20, Poly1305   chacha20-poly1305@openssh.com (OpenSSH's
//               PROTOCOL.chacha20poly1305)
//   AES-CTR     aes128-ctr, aes256-ctr (RFC 4344)
//   RSA         rsa-sha2-256 / rsa-sha2-512 (RFC 8332): host keys checked,
//               a user's imported key signs
//   DH          diffie-hellman-group14-sha256, group16-sha512 (RFC 8268)

"use strict";

var sha2 = require("@noble/hashes/sha2.js");
var hmacLib = require("@noble/hashes/hmac.js");
var edLib = require("@noble/curves/ed25519.js");
var nist = require("@noble/curves/nist.js");
var chacha = require("@noble/ciphers/chacha.js");
var poly = require("@noble/ciphers/_poly1305.js");
var aes = require("@noble/ciphers/aes.js");
var W = require("./wire");

var HASHES = { sha256: sha2.sha256, sha384: sha2.sha384, sha512: sha2.sha512 };

function randomBytes(n) {
    var out = new Uint8Array(n);
    var g = typeof globalThis !== "undefined" ? globalThis : {};
    if (g.crypto && typeof g.crypto.getRandomValues === "function") {
        for (var i = 0; i < n; i += 65536) g.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
        return out;
    }
    // Older Node: its crypto module.
    var b = require("crypto").randomBytes(n);
    out.set(b);
    return out;
}

function hmac(hashName, key, data) { return hmacLib.hmac(HASHES[hashName], key, data); }

// ---- BigInt arithmetic ------------------------------------------------------------------------

var ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2);

function modPow(base, exp, mod) {
    var result = ONE;
    base %= mod;
    while (exp > ZERO) {
        if (exp & ONE) result = (result * base) % mod;
        exp >>= ONE;
        base = (base * base) % mod;
    }
    return result;
}

function byteLength(n) { return Math.ceil(n.toString(16).length / 2); }

// ---- RSA (PKCS #1 v1.5 signatures) ----------------------------------------------------------

// DigestInfo prefixes (RFC 8017 9.2, note 1).
var DIGEST_INFO = {
    sha256: W.fromBase64("MDEwDQYJYIZIAWUDBAIBBQAEIA=="),
    sha512: W.fromBase64("MFEwDQYJYIZIAWUDBAIDBQAEQA==")
};

function emsaPkcs1(hashName, data, k) {
    var h = HASHES[hashName](data);
    var t = W.concat([DIGEST_INFO[hashName], h]);
    if (k < t.length + 11) throw new Error("The RSA key is too short");
    var em = new Uint8Array(k);
    em[1] = 1;
    for (var i = 2; i < k - t.length - 1; i++) em[i] = 0xff;
    em.set(t, k - t.length);
    return em;
}

// key: {n, e} (BigInt); sig: bytes.
function rsaVerify(key, hashName, data, sig) {
    var k = byteLength(key.n);
    if (sig.length > k || k < 128) return false;
    var s = W.toBigInt(sig);
    if (s >= key.n) return false;
    var m = W.fromBigInt(modPow(s, key.e, key.n), k);
    return W.equal(m, emsaPkcs1(hashName, data, k));
}

// key: {n, e, d, p, q, dp?, dq?, qi?} (BigInt), with the CRT when it has p and q.
function rsaSign(key, hashName, data) {
    var k = byteLength(key.n);
    var m = W.toBigInt(emsaPkcs1(hashName, data, k));
    var s;
    if (key.p && key.q) {
        var dp = key.dp || key.d % (key.p - ONE), dq = key.dq || key.d % (key.q - ONE);
        var qi = key.qi || modPow(key.q, key.p - TWO, key.p);
        var m1 = modPow(m % key.p, dp, key.p), m2 = modPow(m % key.q, dq, key.q);
        var h = (qi * (((m1 - m2) % key.p) + key.p)) % key.p;
        s = m2 + h * key.q;
    } else {
        s = modPow(m, key.d, key.n);
    }
    // Checked before it leaves (a fault in the CRT would give the key away).
    if (modPow(s, key.e, key.n) !== m) throw new Error("RSA signature failed its own check");
    return W.fromBigInt(s, k);
}

// ---- Finite-field Diffie-Hellman (RFC 3526 groups 14 and 16) ---------------------------------

var MODP = {
    // RFC 3526 section 3, 2048 bits.
    group14: "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
             "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
             "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
             "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
             "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
             "15728E5A8AACAA68FFFFFFFFFFFFFFFF",
    // RFC 3526 section 5, 4096 bits.
    group16: "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
             "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
             "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
             "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
             "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
             "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
             "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C" +
             "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A92108011A723C12A787E6D7" +
             "88719A10BDBA5B2699C327186AF4E23C1A946834B6150BDA2583E9CA2AD44CE8DBBBC2DB04DE8EF92E8EFC141FBECAA6" +
             "287C59474E6BC05D99B2964FA090C3A2233BA186515BE7ED1F612970CEE2D7AFB81BDD762170481CD0069127D5B05AA9" +
             "93B4EA988D8FDDC186FFB7DC90A6C08F4DF435C934063199FFFFFFFFFFFFFFFF"
};

function dhGroup(name) {
    var p = BigInt("0x" + MODP[name]);
    return {
        p: p,
        // A fresh exponent of 512 bits (twice the 256 bits these groups give;
        // RFC 8268 4 asks for at least twice the hash's strength).
        generate: function () {
            var x;
            do { x = W.toBigInt(randomBytes(64)); } while (x < TWO);
            return { x: x, e: modPow(TWO, x, p) };
        },
        // K from the other side's value, checked to be in range (RFC 4253 8).
        secret: function (x, f) {
            if (f <= ONE || f >= p - ONE) throw new Error("The server's Diffie-Hellman value is out of range");
            return modPow(f, x, p);
        }
    };
}

// ---- Curves ---------------------------------------------------------------------------------

var x25519 = {
    generate: function () {
        var priv = edLib.x25519.utils.randomSecretKey();
        return { priv: priv, pub: edLib.x25519.getPublicKey(priv) };
    },
    shared: function (priv, pub) {
        if (!pub || pub.length !== 32) throw new Error("The other side's X25519 key is not 32 bytes");
        var k = edLib.x25519.getSharedSecret(priv, pub);
        // RFC 8731 3: an all-zero secret is refused.
        if (k.every(function (b) { return b === 0; })) throw new Error("X25519 gave the all-zero secret");
        return k;
    }
};

var ed25519 = {
    generate: function () {
        var seed = randomBytes(32);
        return { seed: seed, pub: edLib.ed25519.getPublicKey(seed) };
    },
    publicOf: function (seed) { return edLib.ed25519.getPublicKey(seed); },
    sign: function (seed, data) { return edLib.ed25519.sign(data, seed); },
    verify: function (pub, data, sig) {
        try { return edLib.ed25519.verify(sig, data, pub, { zip215: false }); } catch (e) { return false; }
    }
};

var CURVES = { nistp256: { curve: nist.p256, hash: "sha256", size: 32 }, nistp384: { curve: nist.p384, hash: "sha384", size: 48 } };

var ecdh = {
    generate: function (name) {
        var c = CURVES[name].curve;
        var priv = c.utils.randomSecretKey();
        return { priv: priv, pub: c.getPublicKey(priv, false) };
    },
    // The shared point's x coordinate (RFC 5656 4).
    shared: function (name, priv, pub) {
        var c = CURVES[name].curve;
        var point = c.getSharedSecret(priv, pub, true);
        return point.subarray(1);
    }
};

// r, s: the magnitudes; pub: the uncompressed point.
function ecdsaVerify(name, pub, data, r, s) {
    var c = CURVES[name];
    try {
        var sig = new c.curve.Signature(W.toBigInt(r), W.toBigInt(s));
        // OpenSSH's (OpenSSL's) signatures need not have a low s.
        return c.curve.verify(sig, HASHES[c.hash](data), pub, { lowS: false });
    } catch (e) {
        return false;
    }
}

// ---- Ciphers --------------------------------------------------------------------------------

// chacha20-poly1305@openssh.com: a 64-byte key; K_2 (the first 32 bytes)
// for the packet, K_1 (the last 32) for its length; the nonce is the
// sequence number; Poly1305's key is K_2's block 0, the payload starts at
// block 1.
function chachaPoly(key) {
    var k2 = key.subarray(0, 32), k1 = key.subarray(32, 64);
    function nonce(seq) {
        var n = new Uint8Array(8);
        n[4] = (seq >>> 24) & 255; n[5] = (seq >>> 16) & 255; n[6] = (seq >>> 8) & 255; n[7] = seq & 255;
        return n;
    }
    return {
        length: function (seq, encLen) {
            var plain = chacha.chacha20orig(k1, nonce(seq), encLen.slice(), undefined, 0);
            return ((plain[0] << 24) >>> 0) + (plain[1] << 16) + (plain[2] << 8) + plain[3];
        },
        encrypt: function (seq, lenBytes, body) {
            var n = nonce(seq);
            var encLen = chacha.chacha20orig(k1, n, lenBytes, undefined, 0);
            var encBody = chacha.chacha20orig(k2, n, body, undefined, 1);
            var polyKey = chacha.chacha20orig(k2, n, new Uint8Array(32), undefined, 0);
            var tag = poly.poly1305(W.concat([encLen, encBody]), polyKey);
            return W.concat([encLen, encBody, tag]);
        },
        // packet: enc length + enc body; null when the tag does not match.
        decrypt: function (seq, packet, tag) {
            var n = nonce(seq);
            var polyKey = chacha.chacha20orig(k2, n, new Uint8Array(32), undefined, 0);
            if (!W.equal(poly.poly1305(packet, polyKey), tag)) return null;
            return chacha.chacha20orig(k2, n, packet.slice(4), undefined, 1);
        }
    };
}

// AES in counter mode as one stream across packets (RFC 4344 4): each call
// takes whole blocks and moves the counter on.
function aesCtr(key, iv) {
    var counter = iv.slice();
    function advance(blocks) {
        var carry = blocks;
        for (var i = 15; i >= 0 && carry > 0; i--) {
            var v = counter[i] + (carry % 256);
            carry = Math.floor(carry / 256) + (v > 255 ? 1 : 0);
            counter[i] = v & 255;
        }
    }
    return {
        update: function (data) {
            if (data.length % 16) throw new Error("AES-CTR takes whole blocks");
            var out = aes.ctr(key, counter.slice()).encrypt(data);
            advance(data.length / 16);
            return out;
        }
    };
}

module.exports = {
    randomBytes: randomBytes, sha256: sha2.sha256, sha384: sha2.sha384, sha512: sha2.sha512, hash: function (name, data) { return HASHES[name](data); },
    hmac: hmac, x25519: x25519, ed25519: ed25519, ecdh: ecdh, ecdsaVerify: ecdsaVerify, CURVES: CURVES,
    rsaVerify: rsaVerify, rsaSign: rsaSign, modPow: modPow, dhGroup: dhGroup, chachaPoly: chachaPoly, aesCtr: aesCtr
};
