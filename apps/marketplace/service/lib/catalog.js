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
// homepage, source (its source code, optional), donation, featured,
// rating: {stars, count}, version, pwa: {manifest (URL), origin} |
// release: {url, size, sha256}, and optionally (docs/APP-STORE.md "Update
// logs") whatsNew: the listed version's notes {version, date, summary, new,
// improved, fixed, known}, detail: {url, sha256} (a file with every
// version's notes, versionHistory, checked against that SHA-256 when an
// app's page reads it: packagesservice.js getApp), releaseNotesUrl (https:
// a hosted web app's upstream release notes)}. A
// "connector" (a Synergy connector package, docs/SYNERGY-CONNECTORS.md C4)
// has a release as an "ipk" has; Connections installs it. An
// account type (Synergy, docs/SYNERGY-CONNECTORS.md 2.1): lib/accounts.js;
// its icon may be relative to the index.
//
// The device trusts a source's key the first time it is added, after the
// user sees its fingerprint (like an SSH host key or an F-Droid repo), or
// the key servers.json pins for the Phoenix catalog, or an online key the
// pinned offline root delegated to (packagesservice.js, @phoenix/platform
// signed.js), and then takes only indexes signed with it, not expired, and
// not older than the last one it took (no rollback to an index with a
// pulled app). Optional additions inside version 1: "revoked" (entries as
// the revocation list's) and a release's "rollout" {percent, seed}.

"use strict";

var ed25519 = require("./ed25519");
var archive = require("./b64");
var accounts = require("./accounts");
var revocations = require("@phoenix/platform").revocations;

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

// One version's notes from an update log (the catalog checked the log when
// the package came: server/marketplace src/Changelog.php), as the
// Marketplace shows them; null when it is not one. In a history (withRebuild)
// the rebuild entry keeps rebuild and replaces.
var NOTE_LISTS = ["new", "improved", "fixed", "known"];
function releaseNotes(n, withRebuild) {
    if (!n || typeof n !== "object" || Array.isArray(n)) return null;
    if (!/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(n.version || "") || !/^\d{4}-\d{2}-\d{2}$/.test(n.date || "") || typeof n.summary !== "string") return null;
    var out = { version: n.version, date: n.date, summary: str(n.summary, 140) };
    NOTE_LISTS.forEach(function (k) {
        out[k] = Array.isArray(n[k]) ? n[k].filter(function (t) { return typeof t === "string" && t; }).slice(0, 100).map(function (t) { return t.slice(0, 200); }) : [];
    });
    if (withRebuild && n.rebuild === true) {
        out.rebuild = true;
        if (typeof n.replaces === "string" && n.replaces) out.replaces = str(n.replaces, 140);
    }
    return out;
}

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
        // Where its source code is (an open-source app the catalog hosts).
        source: url(e.source),
        rating: e.rating && typeof e.rating.stars === "number" ? { stars: e.rating.stars, count: e.rating.count | 0 } : null,
        version: str(e.version, 40) || "1.0.0"
    };
    // Its update log: the listed version's notes (only when they are that
    // version's), where the whole history is, or a hosted web app's
    // upstream release notes.
    var wn = releaseNotes(e.whatsNew, false);
    if (wn && wn.version === out.version) out.whatsNew = wn;
    if (e.detail && url(e.detail.url) && /^[0-9a-f]{64}$/i.test(e.detail.sha256 || ""))
        out.detail = { url: e.detail.url, sha256: e.detail.sha256.toLowerCase() };
    if (typeof e.releaseNotesUrl === "string" && /^https:\/\/\S+$/i.test(e.releaseNotesUrl)) out.releaseNotesUrl = e.releaseNotesUrl.slice(0, 500);
    if (kind === "pwa") {
        if (!e.pwa || !url(e.pwa.manifest)) return null;
        out.pwa = { manifest: e.pwa.manifest, origin: url(e.pwa.origin) || new URL(e.pwa.manifest).origin };
    } else {
        var r = e.release;
        if (!r || !url(r.url) || !/^[0-9a-f]{64}$/i.test(r.sha256 || "") || !(r.size > 0)) return null;
        out.release = { url: r.url, size: r.size, sha256: r.sha256.toLowerCase() };
        if (typeof r.minPhoenix === "string") out.release.minPhoenix = r.minPhoenix;
        // A staged rollout of this release (docs/PLATFORM-CLIENT.md): offered
        // as an update only to the devices in its percentage.
        if (r.rollout && typeof r.rollout.percent === "number")
            out.release.rollout = { percent: Math.max(0, Math.min(100, r.rollout.percent)), seed: str(r.rollout.seed, 100) };
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
            accounts: accounts.normalizeList(idx.accounts, opts.baseUrl, sourceId),
            // Apps and connectors the catalog withdrew for cause, signed with
            // the index (the same entries as the revocation list's).
            revoked: Array.isArray(idx.revoked) ? idx.revoked.map(revocations.normalizeEntry).filter(Boolean) : []
        };
    });
}

// An app's detail (the index's detail.url; Catalog.php writeDetails): its
// bytes, checked against the index's SHA-256 (hex), -> its versionHistory,
// newest first, starting at the entry's version; throws BAD_INDEX otherwise.
function verifyDetail(bytes, entry, sha256) {
    return Promise.resolve(sha256(bytes)).then(function (h) {
        var hex = Array.prototype.map.call(new Uint8Array(h), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
        if (!entry.detail || hex !== entry.detail.sha256) throw fail("BAD_INDEX", "The app's details are not the ones the catalog signed");
        var d;
        try { d = JSON.parse(archive.fromUtf8(bytes)); } catch (e) { throw fail("BAD_INDEX", "The app's details are not valid JSON"); }
        var list = d && d.id === entry.id && Array.isArray(d.versionHistory) ? d.versionHistory.map(function (n) { return releaseNotes(n, true); }) : [];
        if (!list.length || list.some(function (n) { return !n; }) || list[0].version !== entry.version)
            throw fail("BAD_INDEX", "The app's details are not this version's");
        return list;
    });
}

module.exports = { verifyIndex: verifyIndex, verifyDetail: verifyDetail, fingerprint: fingerprint, normalize: normalize, releaseNotes: releaseNotes };
