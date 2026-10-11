// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The index's vectors: EmbeddingGemma 2's 768 dimensions cut to the first
// 256 (Matryoshka: the model card's "Matryoshka Dimension Truncation",
// MTEB 67.78 at 256 against 68.46 at 768) and normalized again ("slicing
// a unit-length vector does not preserve unit length"), then kept as 8-bit
// integers with one scale each: 260 bytes a vector instead of 3,072.
// Ranking is brute force, a dot product per item: at a phone's scale
// (tens of thousands of passages) that is a few milliseconds
// (services/index/index.test.ts measures 50,000).

"use strict";

var DIM = 256;

// The first dim values of v (an array or typed array), at unit length.
function prepare(v, dim) {
    dim = dim || DIM;
    var n = Math.min(dim, v.length), out = new Float32Array(dim), sum = 0, i;
    for (i = 0; i < n; ++i) { out[i] = v[i]; sum += v[i] * v[i]; }
    var len = Math.sqrt(sum);
    if (len > 0) for (i = 0; i < n; ++i) out[i] /= len;
    return out;
}

// A unit vector as 8-bit integers: q[i] = round(v[i] / scale), scale the
// largest magnitude over 127. The dot product with a float vector x is
// scale * sum(q[i] * x[i]).
function quantize(v, into, at) {
    var dim = v.length, max = 0, i;
    for (i = 0; i < dim; ++i) { var a = Math.abs(v[i]); if (a > max) max = a; }
    var scale = max > 0 ? max / 127 : 1;
    for (i = 0; i < dim; ++i) into[at + i] = Math.round(v[i] / scale);
    return scale;
}

// The similarity of every stored vector with the query (a prepared float
// vector): cosine, as both are at unit length.
function scores(query, vecs, scales, count, dim) {
    dim = dim || DIM;
    var out = new Float32Array(count);
    for (var k = 0, base = 0; k < count; ++k, base += dim) {
        var s = 0;
        for (var i = 0; i < dim; ++i) s += vecs[base + i] * query[i];
        out[k] = s * scales[k];
    }
    return out;
}

// The indexes of the n best scores, best first (those that pass keep(k)).
function top(sc, n, keep) {
    var best = [];
    for (var k = 0; k < sc.length; ++k) {
        if (keep && !keep(k)) continue;
        if (best.length < n) { best.push(k); if (best.length === n) best.sort(function (a, b) { return sc[b] - sc[a]; }); continue; }
        if (sc[k] <= sc[best[n - 1]]) continue;
        var j = n - 1;
        while (j > 0 && sc[best[j - 1]] < sc[k]) { best[j] = best[j - 1]; --j; }
        best[j] = k;
    }
    if (best.length < n) best.sort(function (a, b) { return sc[b] - sc[a]; });
    return best;
}

module.exports = { DIM: DIM, prepare: prepare, quantize: quantize, scores: scores, top: top };
