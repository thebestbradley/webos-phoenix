// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A Phoenix catalog (docs/APP-STORE.md, 3.4): a static, signed JSON index
// any web host or mirror can serve, written by the catalog service
// (server/marketplace, PHP). Next to each other at the source's URL:
//
//   key.json         {"key": "<base64 Ed25519 public key>", "name": "..."}
//   index.json       {"version": 1, "build": 12, "generated", "expires",
//                     "source": {"id", "name"}, "categories": [...],
//                     "apps": [entry, ...], "accounts": [account type, ...]}
//   index.json.sig   base64 Ed25519 signature of index.json's bytes
//
// An entry: {id, kind: "pwa" | "ipk" | "connector", title, developer: {name, url?},
// summary, description, categories, icon (URL), screenshots, license,
// homepage, donation, featured, rating: {stars, count}, version,
// pwa: {manifest (URL), origin} | release: {url, size, sha256}}. A
// "connector" (a Synergy connector package, docs/SYNERGY-CONNECTORS.md C4)
// has a release as an "ipk" has; Connections installs it. An
// account type (Synergy, docs/SYNERGY-CONNECTORS.md 2.1): lib/accounts.js;
// its icon may be relative to the index.
//
// The device trusts a source's key the first time it is added, after the
// user sees its fingerprint (like an SSH host key or an F-Droid repo), and
// then takes only indexes signed with it, not expired, and not older than
// the last one it took (no rollback to an index with a pulled app).

"use strict";

var ed25519 = require("./ed25519");
var archive = require("./b64");
var accounts = require("./accounts");

function fail(code, text, extra) {
    var e = new Error(text);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
}

// A key's fingerprint, as shown to the user: SHA-256 of the key, the first
// 16 bytes in hex, grouped by 2.
function fingerprint(keyBytes, sha256) {
    return Promise.resolve(sha256(keyBytes)).then(function (h) {
        var hex = Array.prototype.map.call(new Uint8Array(h).subarray(0, 16), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
        return hex.match(/.{4}/g).join(" ").toUpperCase();
    });
}

function str(v, max) { return typeof v === "string" ? v.slice(0, max || 4000) : ""; }
function url(v) { return typeof v === "string" && /^https?:\/\//i.test(v) ? v : ""; }

// One entry as the client uses it; null when it is not usable.
function normalize(e, sourceId) {
    if (!e || typeof e.id !== "string" || !/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(e.id)) return null;
    var kind = e.kind === "pwa" || e.kind === "ipk" || e.kind === "connector" ? e.kind : null;
    if (!kind) return null;
    var out = {
        id: e.id, sourceId: sourceId, kind: kind, title: str(e.title, 80) || e.id,
        developer: { name: str(e.developer && e.developer.name, 80), url: url(e.developer && e.developer.url) },
        summary: str(e.summary, 300), description: str(e.description, 8000),
        categories: Array.isArray(e.categories) ? e.categories.filter(function (c) { return typeof c === "string"; }).slice(0, 5) : [],
        icon: url(e.icon), screenshots: Array.isArray(e.screenshots) ? e.screenshots.map(url).filter(Boolean).slice(0, 8) : [],
        license: str(e.license, 80), homepage: url(e.homepage), donation: url(e.donation), featured: !!e.featured,
        rating: e.rating && typeof e.rating.stars === "number" ? { stars: e.rating.stars, count: e.rating.count | 0 } : null,
        version: str(e.version, 40) || "1.0.0"
    };
    if (kind === "pwa") {
        if (!e.pwa || !url(e.pwa.manifest)) return null;
        out.pwa = { manifest: e.pwa.manifest, origin: url(e.pwa.origin) || new URL(e.pwa.manifest).origin };
    } else {
        var r = e.release;
        if (!r || !url(r.url) || !/^[0-9a-f]{64}$/i.test(r.sha256 || "") || !(r.size > 0)) return null;
        out.release = { url: r.url, size: r.size, sha256: r.sha256.toLowerCase() };
        if (typeof r.minPhoenix === "string") out.release.minPhoenix = r.minPhoenix;
    }
    return out;
}

// The index's bytes, its signature (base64) and the trusted key (base64)
// -> the index with normalized entries. lastBuild: the newest build taken
// before. now: Date. baseUrl: the index's address, for relative icons.
function verifyIndex(indexBytes, signatureB64, keyB64, opts) {
    var sig = archive.fromBase64(String(signatureB64 || "").trim());
    var key = archive.fromBase64(String(keyB64 || ""));
    return ed25519.verify(sig, indexBytes, key, opts.sha512).then(function (ok) {
        if (!ok) throw fail("BAD_SIGNATURE", "The catalog's signature does not match its key");
        var idx;
        try { idx = JSON.parse(archive.fromUtf8(indexBytes)); } catch (e) { throw fail("BAD_INDEX", "The catalog is not valid JSON"); }
        if (!idx || idx.version !== 1 || !Array.isArray(idx.apps)) throw fail("BAD_INDEX", "Not a version 1 catalog");
        var now = (opts.now || new Date()).getTime();
        if (idx.expires && Date.parse(idx.expires) < now) throw fail("EXPIRED", "The catalog expired on " + idx.expires);
        if (typeof opts.lastBuild === "number" && !(idx.build >= opts.lastBuild))
            throw fail("ROLLBACK", "The catalog is older than one already seen (build " + idx.build + " < " + opts.lastBuild + ")");
        var sourceId = opts.sourceId;
        var seen = {};
        return {
            build: idx.build, generated: idx.generated || null, expires: idx.expires || null,
            name: str(idx.source && idx.source.name, 80),
            categories: Array.isArray(idx.categories) ? idx.categories.filter(function (c) { return typeof c === "string"; }) : [],
            apps: idx.apps.map(function (e) { return normalize(e, sourceId); }).filter(function (e) {
                if (!e || seen[e.id]) return false;
                seen[e.id] = true;
                return true;
            }),
            accounts: accounts.normalizeList(idx.accounts, opts.baseUrl, sourceId)
        };
    });
}

module.exports = { verifyIndex: verifyIndex, fingerprint: fingerprint, normalize: normalize };
