// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Who the device trusts for dev bundles (docs/DEV-PUSH.md 9.1), as the
// list devpush.js verify() takes: the platform's dev-signing key (the
// "master", pinned by the image in /etc/palm/phoenix/servers.json
// "devpush": {"key"}), the paired computers' keys, and developer keys the
// owner granted, each with the extra layer on granted keys:
//
// A grant is a certificate the master key signed (never a server record:
// the server cannot mint trust):
//
//   {"format": 1, "type": "phoenix-devpush-grant", "id": "<grant id>",
//    "key": "ed25519:<developer's public key>", "name": "<who>",
//    "account": "<their Phoenix account>"?, "devices": ["<device id>", ...],
//    "product": "1.0", "parts": ["apps" | "shell" | "services" | "roles"],
//    "issued": "<ISO time>", "expires": "<ISO time>"}
//
// with its detached signature (base64 Ed25519 of the JSON text's exact
// bytes, as every Phoenix feed's .sig). Scoped (devices, product line,
// parts; "roles" only when named), short-lived (90 days at most from
// issued), revocable: a revocation list, also signed by the master key,
//
//   {"format": 1, "type": "phoenix-devpush-revocations", "sequence": N,
//    "issued": "<ISO time>", "grants": ["<grant id>", ...],
//    "keys": ["ed25519:<key>", ...]}
//
// never older (a lower sequence) than one taken. A revoked key is trusted
// for nothing (novaservice.js also unpairs it, and lib/proto.js refuses
// and closes its connections); a revoked grant stays listed, marked
// revoked, so a bundle under it is refused with that reason. A key can
// have several entries (a renewed grant, grants with other scopes):
// verify() accepts a bundle if any of them authorizes it. The no-replay counters and the
// daily rate are novaservice.js's (they live beside the bundles applied).

"use strict";

var crypto = require("crypto");
var keys = require("./keys");
var devpush = require("@phoenix/platform/src/devpush");

var MAX_DAYS = 90;
var KEY_RE = /^ed25519:[A-Za-z0-9+/]{43}=$/;
var ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function fail(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

function verifySig(text, signature, keyB64) {
    try {
        return crypto.verify(null, Buffer.from(text, "utf8"), keys.publicKeyObject(keyB64), Buffer.from(String(signature).trim(), "base64"));
    } catch (e) { return false; }
}

// text (the grant's JSON as signed), signature, master key (base64),
// now -> the grant, checked; throws BAD_GRANT with why.
function checkGrant(text, signature, master, now) {
    if (!master) throw fail("BAD_GRANT", "This device pins no platform dev-signing key, so it can take no grants");
    if (typeof text !== "string") text = JSON.stringify(text);
    if (!verifySig(text, signature, master)) throw fail("BAD_GRANT", "The grant is not signed by the platform's dev-signing key");
    var g;
    try { g = JSON.parse(text); } catch (e) { throw fail("BAD_GRANT", "The grant is not JSON"); }
    if (!g || g.format !== 1 || g.type !== "phoenix-devpush-grant") throw fail("BAD_GRANT", "Not a dev push grant");
    if (typeof g.id !== "string" || !ID_RE.test(g.id)) throw fail("BAD_GRANT", "The grant has no id");
    if (typeof g.key !== "string" || !KEY_RE.test(g.key)) throw fail("BAD_GRANT", "The grant names no key");
    if (typeof g.name !== "string" || !g.name) throw fail("BAD_GRANT", "The grant names no one");
    if (!Array.isArray(g.devices) || !g.devices.length || !g.devices.every(function (d) { return typeof d === "string" && ID_RE.test(d) && d !== "any"; })) {
        throw fail("BAD_GRANT", "The grant names no devices");
    }
    if (typeof g.product !== "string" || !/^\d+\.\d+$/.test(g.product)) throw fail("BAD_GRANT", "The grant names no product line");
    if (!Array.isArray(g.parts) || !g.parts.length || !g.parts.every(function (p) { return devpush.PARTS.indexOf(p) >= 0; })) {
        throw fail("BAD_GRANT", "The grant's parts are not " + devpush.PARTS.join(", "));
    }
    var issued = Date.parse(g.issued), expires = Date.parse(g.expires);
    if (!(issued > 0) || !(expires > issued)) throw fail("BAD_GRANT", "The grant's dates are not valid");
    if (expires - issued > MAX_DAYS * 86400000) throw fail("BAD_GRANT", "A grant lasts " + MAX_DAYS + " days at most");
    if (issued > now.getTime() + 300000) throw fail("BAD_GRANT", "The grant is issued in the future");
    return g;
}

// The same for a revocation list.
function checkRevocations(text, signature, master) {
    if (!master) throw fail("BAD_REVOCATIONS", "This device pins no platform dev-signing key");
    if (typeof text !== "string") text = JSON.stringify(text);
    if (!verifySig(text, signature, master)) throw fail("BAD_REVOCATIONS", "The revocation list is not signed by the platform's dev-signing key");
    var r;
    try { r = JSON.parse(text); } catch (e) { throw fail("BAD_REVOCATIONS", "The revocation list is not JSON"); }
    if (!r || r.format !== 1 || r.type !== "phoenix-devpush-revocations" || !Number.isSafeInteger(r.sequence) || r.sequence < 1 ||
        !Array.isArray(r.grants) || !Array.isArray(r.keys)) {
        throw fail("BAD_REVOCATIONS", "Not a dev push revocation list");
    }
    return r;
}

function bare(k) { return String(k).replace(/^ed25519:/, ""); }

// {master (base64) | null, paired: [{key}], grants: [{grant, ...}],
// revocations: {grants, keys} | null, now} -> verify()'s trust list.
function trustList(opts) {
    var rv = opts.revocations || { grants: [], keys: [] };
    var revokedKey = {};
    (rv.keys || []).forEach(function (k) { revokedKey[bare(k)] = true; });
    var out = [];
    if (opts.master && !revokedKey[bare(opts.master)]) out.push({ key: bare(opts.master), kind: "master" });
    (opts.paired || []).forEach(function (p) {
        if (!revokedKey[bare(p.key)]) out.push({ key: bare(p.key), kind: "paired", name: p.name });
    });
    (opts.grants || []).forEach(function (entry) {
        var g = entry.grant;
        if (revokedKey[bare(g.key)]) return;
        out.push({ key: bare(g.key), kind: "grant", name: g.name,
                   grant: { id: g.id, devices: g.devices, product: g.product, parts: g.parts, expires: g.expires,
                            revoked: (rv.grants || []).indexOf(g.id) >= 0 } });
    });
    return out;
}

module.exports = { MAX_DAYS: MAX_DAYS, checkGrant: checkGrant, checkRevocations: checkRevocations, trustList: trustList, verifySig: verifySig };
