// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What every drive's client shares: requests through the kit's HTTP client
// (ctx.http: the account's hosts only, Retry-After, retries, a timeout),
// the answer checked against the statuses expected (else the file
// manager's error for the status, kit.httpError), JSON and text bodies,
// path encoding, and bodies built from parts (multipart uploads).

"use strict";

var kit = require("@phoenix/connector-kit");
var H = require("./hash");

function textOf(res) {
    if (typeof res.body === "string") return res.body;
    if (res.bytes) return typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8").decode(res.bytes) : Buffer.from(res.bytes).toString("utf8");
    return "";
}

function jsonOf(res) {
    try { return JSON.parse(textOf(res) || "null"); } catch (e) { return null; }
}

// res when its status is one of ok, else the error for it (detail: the
// provider's own explanation, from detailOf(res)).
function expect(res, ok, what, detailOf) {
    if (ok.indexOf(res.status) >= 0) return res;
    var detail = "";
    try { detail = detailOf ? detailOf(res) || "" : ""; } catch (e) { detail = ""; }
    throw kit.httpError(res.status, what, detail);
}

// "/a b/c#d" -> "/a%20b/c%23d" (each segment encoded; slashes kept).
function encodePath(p) {
    return String(p).split("/").map(function (s) { return encodeURIComponent(s); }).join("/");
}

function concat(parts) {
    var bytes = parts.map(function (p) { return typeof p === "string" ? H.utf8(p) : p; });
    var n = bytes.reduce(function (a, b) { return a + b.length; }, 0);
    var out = new Uint8Array(n), off = 0;
    bytes.forEach(function (b) { out.set(b, off); off += b.length; });
    return out;
}

function randomId() {
    var s = "";
    for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 0x100000000).toString(36);
    return s;
}

// A request through ctx.http; bytes answers when binary.
function send(ctx, req) {
    return ctx.http.request(req);
}

module.exports = { textOf: textOf, jsonOf: jsonOf, expect: expect, encodePath: encodePath, concat: concat, randomId: randomId, send: send };
