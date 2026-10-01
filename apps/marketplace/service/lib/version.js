// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Package version order, as opkg and dpkg have it: [epoch:]upstream[-revision],
// each part compared as alternating runs of non-digits (letters before
// other characters, "~" before everything, even the end) and numbers.

"use strict";

function order(c) {
    if (c === "~") return -1;
    if (!c) return 0;
    if (/[A-Za-z]/.test(c)) return c.charCodeAt(0);
    return c.charCodeAt(0) + 256;
}

function comparePart(a, b) {
    a = a || "";
    b = b || "";
    var i = 0, j = 0;
    while (i < a.length || j < b.length) {
        // Non-digits.
        while ((i < a.length && !/\d/.test(a[i])) || (j < b.length && !/\d/.test(b[j]))) {
            var ca = i < a.length && !/\d/.test(a[i]) ? a[i] : "";
            var cb = j < b.length && !/\d/.test(b[j]) ? b[j] : "";
            var d = order(ca) - order(cb);
            if (d) return d < 0 ? -1 : 1;
            if (ca) i++;
            if (cb) j++;
            if (!ca && !cb) break;
        }
        // Digits.
        var na = "", nb = "";
        while (i < a.length && /\d/.test(a[i])) na += a[i++];
        while (j < b.length && /\d/.test(b[j])) nb += b[j++];
        var x = parseInt(na || "0", 10), y = parseInt(nb || "0", 10);
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

function split(v) {
    v = String(v || "0").trim();
    var epoch = 0, m = /^(\d+):(.*)$/.exec(v);
    if (m) { epoch = parseInt(m[1], 10); v = m[2]; }
    var dash = v.lastIndexOf("-");
    return { epoch: epoch, upstream: dash >= 0 ? v.slice(0, dash) : v, revision: dash >= 0 ? v.slice(dash + 1) : "" };
}

// -1, 0 or 1.
function compare(a, b) {
    var x = split(a), y = split(b);
    if (x.epoch !== y.epoch) return x.epoch < y.epoch ? -1 : 1;
    return comparePart(x.upstream, y.upstream) || comparePart(x.revision, y.revision);
}

module.exports = { compare: compare };
