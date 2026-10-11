// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Base64 and UTF-8 for code that runs both in Node.js (a device's service)
// and in a page (the simulator), without Buffer or btoa.

"use strict";

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
    var s = String(text).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    var out = new Uint8Array(Math.floor(s.length * 3 / 4)), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
        buf = ((buf << 6) | B64.indexOf(s[i])) & 0xffffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (buf >> bits) & 255;
        }
    }
    return out.subarray(0, o);
}

function utf8(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    return new Uint8Array(Buffer.from(text, "utf8"));
}
function fromUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString("utf8");
}
function hex(bytes) {
    return Array.prototype.map.call(bytes, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
}

module.exports = { toBase64: toBase64, fromBase64: fromBase64, utf8: utf8, fromUtf8: fromUtf8, hex: hex };
