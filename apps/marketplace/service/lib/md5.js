// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// MD5 (RFC 1321), only to check downloads against Preware feeds, which list
// MD5Sum (WebCrypto has no MD5). Not for anything that needs to be secure.
// md5(Uint8Array) -> hex string.

"use strict";

var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
         4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
var K = [];
for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

function md5(bytes) {
    var n = bytes.length, total = ((n + 8) >>> 6 << 6) + 64;
    var m = new Uint8Array(total);
    m.set(bytes);
    m[n] = 0x80;
    var bits = n * 8;
    for (var b = 0; b < 8; b++) m[total - 8 + b] = b < 4 ? (bits >>> (8 * b)) & 255 : Math.floor(bits / 4294967296) >>> (8 * (b - 4)) & 255;
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var w = new Uint32Array(16);
    for (var off = 0; off < total; off += 64) {
        for (var j = 0; j < 16; j++) w[j] = m[off + j * 4] | m[off + j * 4 + 1] << 8 | m[off + j * 4 + 2] << 16 | m[off + j * 4 + 3] << 24;
        var A = a0, B = b0, C = c0, D = d0;
        for (var k = 0; k < 64; k++) {
            var F, g;
            if (k < 16) { F = (B & C) | (~B & D); g = k; }
            else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
            else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * k) % 16; }
            F = (F + A + K[k] + w[g]) >>> 0;
            A = D; D = C; C = B;
            B = (B + ((F << S[k]) | (F >>> (32 - S[k])))) >>> 0;
        }
        a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    var out = "";
    [a0, b0, c0, d0].forEach(function (v) {
        for (var q = 0; q < 4; q++) out += ((v >>> (8 * q)) & 255).toString(16).padStart(2, "0");
    });
    return out;
}

module.exports = { md5: md5 };
