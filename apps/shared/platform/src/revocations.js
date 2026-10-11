// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The signed revocation list (PLATFORM.md 6.7, OPEN-QUESTIONS Q56): apps
// and connectors the catalog withdrew for cause, and online keys never to
// trust again. On the feeds host beside the catalog
// (servers.json "revocations.url"), with a detached signature by the
// catalog's key (the same key, or delegation with scope "catalog", the
// index is checked with):
//
//   revoked.json      {"format": 1, "sequence": n, "generated", "expires",
//                      "apps": [{"id", "kind": "app" | "connector",
//                                "reason": "malware" | "security" | "legal" | "developer",
//                                "date", "text"?}],
//                      "keys": ["<base64 Ed25519 key>", ...]}
//   revoked.json.sig  base64 Ed25519 signature of revoked.json's bytes
//
// What a device does (the owner's default, Q56): "malware" (and
// "security") removes the app and says why; the other reasons warn and
// offer removal (APP-STORE.md 3.9: no silent remote uninstall); a revoked
// app is never installed again from any catalog. The index may also carry
// the same entries as "revoked" (signed with the index).

"use strict";

var b64 = require("./b64");
var signed = require("./signed");

var REASONS = ["malware", "security", "legal", "developer"];
var REMOVE = ["malware", "security"];

function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

function normalizeEntry(e) {
    if (!e || typeof e.id !== "string" || !/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(e.id)) return null;
    var reason = REASONS.indexOf(e.reason) >= 0 ? e.reason : "developer";
    return { id: e.id, kind: e.kind === "connector" ? "connector" : "app", reason: reason,
             remove: REMOVE.indexOf(reason) >= 0, date: typeof e.date === "string" ? e.date : "",
             text: typeof e.text === "string" ? e.text.slice(0, 300) : "" };
}

// bytes, signature, keys (the catalog keys the device trusts) ->
// Promise<{sequence, expires, apps, keys}>; opts {sha512, now, lastSequence}
function verify(bytes, signatureB64, keys, opts) {
    if (!keys || !keys.length) return Promise.reject(err("UNTRUSTED", "No catalog key to check the revocation list with"));
    return signed.verifyWithAny(bytes, signatureB64, keys, opts.sha512, "revocation list").then(function () {
        var r;
        try { r = JSON.parse(b64.fromUtf8(bytes)); } catch (e) { throw err("BAD_FEED", "The revocation list is not JSON"); }
        if (!r || r.format !== 1 || !Array.isArray(r.apps)) throw err("BAD_FEED", "Not a format 1 revocation list");
        var now = ((opts && opts.now) || new Date()).getTime();
        if (r.expires && Date.parse(r.expires) < now) throw err("EXPIRED", "The revocation list expired on " + r.expires);
        var seq = typeof r.sequence === "number" ? r.sequence : 0;
        if (typeof opts.lastSequence === "number" && seq < opts.lastSequence)
            throw err("ROLLBACK", "The revocation list is older than one already seen (" + seq + " < " + opts.lastSequence + ")");
        return {
            sequence: seq, expires: r.expires || null,
            apps: r.apps.map(normalizeEntry).filter(Boolean),
            keys: (Array.isArray(r.keys) ? r.keys : []).filter(function (k) { return typeof k === "string" && b64.fromBase64(k).length === 32; })
        };
    });
}

module.exports = { REASONS: REASONS, normalizeEntry: normalizeEntry, verify: verify };
