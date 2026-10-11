// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One source's index (memos, email, ...) in memory and as one file:
//
//   "PHXIDX01", a 32-bit length, that many bytes of JSON {source, model,
//   dim, rev, stamps, items: [{r, c, h, t, a?, m?}]}, zeros to a multiple
//   of 4, then a 32-bit float scale per item and dim 8-bit integers per
//   item (lib/vectors.js).
//
// An item is one passage of one record: r the record (a db8 _id, a file's
// path), c which passage, h the hash of what was embedded (lib/chunk.js),
// t its time (for "newest first" among equals), a the sender's address
// for email and messages (who said it), m "i" or "a" for a picture's or a
// recording's own embedding. rev: the last db8 revision indexed (the next
// pass asks only for what changed after it); stamps: files' size and time.
// No text is kept: what a result shows is read from the record itself.

"use strict";

var MAGIC = "PHXIDX01";

function createSourceIndex(meta) {
    meta = meta || {};
    var dim = meta.dim || 256;
    var self = {
        source: meta.source || "", model: meta.model || "", dim: dim, rev: meta.rev || 0, stamps: meta.stamps || {},
        items: [], scales: new Float32Array(16), vecs: new Int8Array(16 * dim), dirty: false
    };
    function grow(n) {
        if (n <= self.scales.length) return;
        var cap = Math.max(n, self.scales.length * 2);
        var s = new Float32Array(cap); s.set(self.scales.subarray(0, self.items.length));
        var v = new Int8Array(cap * dim); v.set(self.vecs.subarray(0, self.items.length * dim));
        self.scales = s; self.vecs = v;
    }
    // A passage and its quantized vector (q: dim values, scale).
    self.add = function (item, q, scale) {
        grow(self.items.length + 1);
        var k = self.items.length;
        self.items.push(item);
        self.scales[k] = scale;
        self.vecs.set(q, k * dim);
        self.dirty = true;
    };
    // Every passage of these records out (a set or array of record ids).
    self.removeRecords = function (records) {
        var gone = records instanceof Set ? records : new Set(records);
        if (!gone.size) return 0;
        return self.removeWhere(function (it) { return gone.has(it.r); });
    };
    // The items for which out(item) is true, out.
    self.removeWhere = function (out) {
        var w = 0, n = self.items.length;
        for (var k = 0; k < n; ++k) {
            if (out(self.items[k])) continue;
            if (w !== k) {
                self.items[w] = self.items[k];
                self.scales[w] = self.scales[k];
                self.vecs.copyWithin(w * dim, k * dim, (k + 1) * dim);
            }
            ++w;
        }
        var removed = n - w;
        self.items.length = w;
        if (removed) self.dirty = true;
        return removed;
    };
    // record id -> [hash of each passage], to tell what changed.
    self.hashes = function () {
        var out = new Map();
        self.items.forEach(function (it) {
            var l = out.get(it.r);
            if (!l) out.set(it.r, l = []);
            l[it.c] = it.h;
        });
        return out;
    };
    self.records = function () {
        var s = new Set();
        self.items.forEach(function (it) { s.add(it.r); });
        return s;
    };
    self.count = function () { return self.items.length; };
    self.bytes = function () { return encode(self).length; };
    return self;
}

function encode(idx) {
    var json = JSON.stringify({ source: idx.source, model: idx.model, dim: idx.dim, rev: idx.rev, stamps: idx.stamps, items: idx.items });
    var head = new TextEncoder().encode(json);
    var n = idx.items.length, pad = (4 - ((12 + head.length) % 4)) % 4;
    var out = new Uint8Array(12 + head.length + pad + n * 4 + n * idx.dim);
    for (var i = 0; i < 8; ++i) out[i] = MAGIC.charCodeAt(i);
    new DataView(out.buffer).setUint32(8, head.length, true);
    out.set(head, 12);
    var at = 12 + head.length + pad;
    out.set(new Uint8Array(idx.scales.buffer, idx.scales.byteOffset, n * 4), at);
    out.set(new Uint8Array(idx.vecs.buffer, idx.vecs.byteOffset, n * idx.dim), at + n * 4);
    return out;
}

function decode(bytes) {
    if (!bytes || bytes.length < 12) return null;
    for (var i = 0; i < 8; ++i) if (bytes[i] !== MAGIC.charCodeAt(i)) return null;
    var len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    var meta;
    try { meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len))); } catch (e) { return null; }
    var idx = createSourceIndex(meta), n = (meta.items || []).length, dim = idx.dim;
    var at = 12 + len + (4 - ((12 + len) % 4)) % 4;
    if (bytes.length < at + n * 4 + n * dim) return null;
    idx.items = meta.items || [];
    // Copies, aligned (a Float32Array needs its offset a multiple of 4).
    idx.scales = new Float32Array(Math.max(16, n));
    idx.scales.set(new Float32Array(bytes.slice(at, at + n * 4).buffer));
    idx.vecs = new Int8Array(Math.max(16, n) * dim);
    idx.vecs.set(new Int8Array(bytes.buffer, bytes.byteOffset + at + n * 4, n * dim));
    idx.dirty = false;
    return idx;
}

module.exports = { createSourceIndex: createSourceIndex, encode: encode, decode: decode, MAGIC: MAGIC };
