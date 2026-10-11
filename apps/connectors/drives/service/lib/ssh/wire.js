// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The SSH wire format (RFC 4251 section 5): byte, boolean, uint32, uint64,
// string, mpint, name-list, read from and written to Uint8Arrays. Shared by
// the transport, the authentication and connection layers, SFTP (which
// uses the same encoding: draft-ietf-secsh-filexfer-02 section 3) and the
// key formats (OpenSSH's are made of the same fields).

"use strict";

var enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
var dec = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

function utf8(s) {
    if (enc) return enc.encode(String(s));
    return new Uint8Array(Buffer.from(String(s), "utf8"));
}
function fromUtf8(b) {
    if (dec) return dec.decode(b);
    return Buffer.from(b).toString("utf8");
}
function latin1(b) {
    var s = "";
    for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.prototype.slice.call(b.subarray(i, i + 8192)));
    return s;
}
function fromLatin1(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
}
function base64(b) {
    var s = latin1(b);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "latin1").toString("base64");
}
function fromBase64(s) {
    var clean = String(s).replace(/[\s]/g, "");
    if (typeof atob === "function") return fromLatin1(atob(clean));
    return new Uint8Array(Buffer.from(clean, "base64"));
}
function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
}
function equal(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
}

// Big-endian unsigned bytes <-> BigInt (mpint's magnitude).
function toBigInt(b) {
    var h = "0x0";
    for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return BigInt(h);
}
function fromBigInt(n, length) {
    var h = n.toString(16);
    if (h.length % 2) h = "0" + h;
    var len = length || h.length / 2;
    var out = new Uint8Array(len);
    for (var i = 0; i < h.length / 2 && i < len; i++) out[len - 1 - i] = parseInt(h.substr(h.length - 2 * (i + 1), 2), 16);
    return out;
}

function WireError(message) {
    var e = new Error(message);
    e.code = "SSH_PROTOCOL";
    return e;
}

// ---- Writing -----------------------------------------------------------------------------

function Writer(size) {
    this.buf = new Uint8Array(size || 256);
    this.len = 0;
}
Writer.prototype.room = function (n) {
    if (this.len + n <= this.buf.length) return;
    var next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
};
Writer.prototype.byte = function (v) { this.room(1); this.buf[this.len++] = v & 255; return this; };
Writer.prototype.bool = function (v) { return this.byte(v ? 1 : 0); };
Writer.prototype.uint32 = function (v) {
    this.room(4);
    var b = this.buf, o = this.len;
    b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255;
    this.len += 4;
    return this;
};
// A file offset or size (up to 2^53 here).
Writer.prototype.uint64 = function (v) {
    var hi = Math.floor(v / 4294967296), lo = v % 4294967296;
    return this.uint32(hi).uint32(lo);
};
Writer.prototype.raw = function (bytes) {
    this.room(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
    return this;
};
Writer.prototype.string = function (v) {
    var b = typeof v === "string" ? utf8(v) : v;
    return this.uint32(b.length).raw(b);
};
Writer.prototype.nameList = function (names) { return this.string(names.join(",")); };
// mpint (RFC 4251 5): two's complement, big-endian, no needless leading
// bytes; a 0x00 first when the top bit of a positive number is set.
Writer.prototype.mpint = function (v) {
    var b = typeof v === "bigint" ? (v === BigInt(0) ? new Uint8Array(0) : fromBigInt(v)) : v;
    var i = 0;
    while (i < b.length && b[i] === 0) i++;
    b = b.subarray(i);
    if (b.length && b[0] & 0x80) return this.uint32(b.length + 1).byte(0).raw(b);
    return this.string(b);
};
Writer.prototype.bytes = function () { return this.buf.slice(0, this.len); };

// ---- Reading -----------------------------------------------------------------------------

function Reader(bytes, offset) {
    this.buf = bytes;
    this.pos = offset || 0;
}
Reader.prototype.need = function (n) {
    if (this.pos + n > this.buf.length) throw WireError("A message ended too soon");
};
Reader.prototype.byte = function () { this.need(1); return this.buf[this.pos++]; };
Reader.prototype.bool = function () { return this.byte() !== 0; };
Reader.prototype.uint32 = function () {
    this.need(4);
    var b = this.buf, o = this.pos;
    this.pos += 4;
    return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
};
Reader.prototype.uint64 = function () {
    var hi = this.uint32(), lo = this.uint32();
    return hi * 4294967296 + lo;
};
Reader.prototype.raw = function (n) {
    this.need(n);
    var out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
};
Reader.prototype.string = function () { return this.raw(this.uint32()); };
Reader.prototype.text = function () { return fromUtf8(this.string()); };
Reader.prototype.nameList = function () {
    var s = latin1(this.string());
    return s ? s.split(",") : [];
};
// An mpint's magnitude (the sign byte dropped; SSH's are all positive here).
Reader.prototype.mpint = function () {
    var b = this.string();
    var i = 0;
    while (i < b.length && b[i] === 0) i++;
    return b.subarray(i);
};
Reader.prototype.rest = function () { return this.raw(this.buf.length - this.pos); };
Reader.prototype.left = function () { return this.buf.length - this.pos; };

module.exports = {
    Writer: Writer, Reader: Reader, utf8: utf8, fromUtf8: fromUtf8, latin1: latin1, fromLatin1: fromLatin1,
    base64: base64, fromBase64: fromBase64, concat: concat, equal: equal, toBigInt: toBigInt, fromBigInt: fromBigInt,
    WireError: WireError
};
