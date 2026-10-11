// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// SHA-256, HMAC-SHA-256 (FIPS 180-4, RFC 2104: S3's Signature Version 4) and
// an incremental SHA-1 (Box's chunked upload names each part and the whole
// file by it), in plain JavaScript: the connector runs on a device's Node.js
// and in the simulator's page, which has no synchronous crypto.

"use strict";

function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(s));
    return new Uint8Array(Buffer.from(String(s), "utf8"));
}
function bytesOf(x) { return typeof x === "string" ? utf8(x) : x; }
function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
}
function base64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "latin1").toString("base64");
}

// ---- SHA-256 --------------------------------------------------------------------------

var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

// The message padded to whole 64-byte blocks, with its length in bits.
function pad(bytes) {
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    var out = new Uint8Array(total);
    out.set(bytes);
    out[len] = 0x80;
    var bits = len * 8, hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    out[total - 8] = hi >>> 24; out[total - 7] = hi >>> 16; out[total - 6] = hi >>> 8; out[total - 5] = hi;
    out[total - 4] = lo >>> 24; out[total - 3] = lo >>> 16; out[total - 2] = lo >>> 8; out[total - 1] = lo;
    return out;
}

function sha256(data) {
    var m = pad(bytesOf(data));
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < m.length; off += 64) {
        for (var i = 0; i < 16; i++) w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
        for (i = 16; i < 64; i++) {
            var x = w[i - 15], y = w[i - 2];
            var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (i = 0; i < 64; i++) {
            var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            var t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
            var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
        h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) { out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = h[i] >>> 16; out[i * 4 + 2] = h[i] >>> 8; out[i * 4 + 3] = h[i]; }
    return out;
}

function hmacSha256(key, data) {
    var k = bytesOf(key);
    if (k.length > 64) k = sha256(k);
    var ipad = new Uint8Array(64 + 0), opad = new Uint8Array(64);
    for (var i = 0; i < 64; i++) { ipad[i] = (k[i] || 0) ^ 0x36; opad[i] = (k[i] || 0) ^ 0x5c; }
    var msg = bytesOf(data);
    var inner = new Uint8Array(64 + msg.length);
    inner.set(ipad); inner.set(msg, 64);
    var ih = sha256(inner);
    var outer = new Uint8Array(64 + 32);
    outer.set(opad); outer.set(ih, 64);
    return sha256(outer);
}

// ---- SHA-1, fed in parts ------------------------------------------------------------

function createSha1() {
    var h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    var buf = new Uint8Array(64), used = 0, total = 0;
    var w = new Array(80);
    function block(m, off) {
        for (var i = 0; i < 16; i++) w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
        for (i = 16; i < 80; i++) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (i = 0; i < 80; i++) {
            var f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
            else { f = b ^ c ^ d; k = 0xca62c1d6; }
            var t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
            e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
    }
    return {
        update: function (data) {
            var m = bytesOf(data), i = 0;
            total += m.length;
            if (used) {
                while (used < 64 && i < m.length) buf[used++] = m[i++];
                if (used < 64) return this;
                block(buf, 0);
                used = 0;
            }
            for (; i + 64 <= m.length; i += 64) block(m, i);
            while (i < m.length) buf[used++] = m[i++];
            return this;
        },
        digest: function () {
            var bits = total * 8;
            var tail = new Uint8Array(((used + 9 + 63) >> 6) << 6);
            tail.set(buf.subarray(0, used));
            tail[used] = 0x80;
            var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0, n = tail.length;
            tail[n - 8] = hi >>> 24; tail[n - 7] = hi >>> 16; tail[n - 6] = hi >>> 8; tail[n - 5] = hi;
            tail[n - 4] = lo >>> 24; tail[n - 3] = lo >>> 16; tail[n - 2] = lo >>> 8; tail[n - 1] = lo;
            for (var off = 0; off < n; off += 64) block(tail, off);
            var out = new Uint8Array(20);
            for (var i = 0; i < 5; i++) { out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = h[i] >>> 16; out[i * 4 + 2] = h[i] >>> 8; out[i * 4 + 3] = h[i]; }
            return out;
        }
    };
}

function sha1(data) { return createSha1().update(data).digest(); }

module.exports = { sha256: sha256, hmacSha256: hmacSha256, sha1: sha1, createSha1: createSha1, hex: hex, base64: base64, utf8: utf8 };
