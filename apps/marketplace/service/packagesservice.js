// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.packages: the Marketplace's service
// (docs/APP-STORE.md, 3.1). It reads catalogs, installs apps from them
// through OSE's installer (com.webos.appInstallService, which takes an .ipk
// file) and keeps them up to date. Three kinds of source:
//
//   phoenix    a signed Phoenix catalog (lib/catalog.js; the catalog service
//              in server/marketplace writes them): web apps (PWAs, packaged
//              here by lib/pwa.js) and .ipk web apps (downloaded, checked
//              against the signed SHA-256)
//   appmuseum  the webOS Archive's App Museum II (lib/appmuseum.js): the
//              original apps, "Classics", read live; off until switched on
//   preware    a Preware feed (lib/preware.js; MD5 checked); off until
//              switched on
//
// Every package is read before it is installed and refused when it has
// install scripts, services, files outside its app, native code it cannot
// run, or (Classics) needs the Mojo framework, which Phoenix cannot ship.
//
// Synergy connectors (kind "connector": an app with its service; Connections
// installs them, docs/SYNERGY-CONNECTORS.md C4) need Developer Mode, as the
// owner decided, until the connector trust tier (C5); except the first-party
// ones Phoenix comes with (/etc/palm/marketplace/preinstalled.json: the
// Fediverse), installed again from a catalog the device ships with, signed
// with its key: those the device itself vouches for, so no Developer Mode
// (firstParty). A pre-installed package counts as installed from that
// catalog the first time the service looks (it was in the image), and can
// be removed and installed again like any other.
//
// Methods:
//   getSources {}                       -> {sources: [...]}, none with secrets
//   addSource {url}                     -> {pending: {url, name, key, fingerprint}}:
//                                          the key, for the user to check
//   trustSource {url, key, name?}       adds (or re-keys) a Phoenix catalog
//   setSource {id, enabled}             switch a source on or off
//   removeSource {id}
//   refresh {id?}                       read the catalogs again; per source
//                                          {id, ok, errorCode, fingerprint}
//   browse {section, category?, page?}  section: "featured" | "web" | "apps" |
//                                          "classics" -> {apps, categories, more}
//   search {query}                      -> {apps, accountTypes} from every source
//                                          switched on
//   listAccountTypes {capability?}      -> {accountTypes}: the account types
//                                          (Synergy) the Phoenix catalogs list,
//                                          each template once; capability (a
//                                          template capability or a list of
//                                          them) keeps those with any of them
//   getApp {sourceId, id}               -> {app} with installed, update, verdicts
//   install {sourceId, id, subscribe}   (also an ongoing activity in the
//                                       notification area while it runs)
//                                       progress {state: "downloading" |
//                                          "checking" | "installing" | "installed"
//                                          | "failed", progress, errorCode, errorText}
//   remove {id}
//   listInstalled {}                    -> {apps: [{id, title, icon, version,
//                                          sourceId, kind, update}]}
//   updateAll {}                        installs every update there is
//   scheduled {$activity}               the daily check (an activity)
//
// Errors: {returnValue: false, errorCode, errorText}: NOT_FOUND, UNTRUSTED,
// BAD_SIGNATURE, NO_DELEGATION, REVOKED_KEY, EXPIRED, ROLLBACK, BAD_INDEX,
// BAD_SERVER, CONNECTION_FAILED, DOWNLOAD_FAILED, BAD_PACKAGE, UNSUPPORTED,
// NEEDS_DEVMODE, NEEDS_MOJO, BAD_MANIFEST, REVOKED, INSTALL_FAILED, BUSY,
// BAD_PARAMS, NOT_SET_UP.
//
// The Phoenix catalog's address and keys (the built-in "phoenix" source)
// and the revocation list's address come from /etc/palm/phoenix/servers.json
// (deps.servers(), @phoenix/platform; docs/PLATFORM-CLIENT.md, "The app
// catalog"): "catalog.key" pins the online key; "catalog.root" pins the
// owner's offline root, which delegates to the online key in key.json
// (scope "catalog", OPEN-QUESTIONS Q45); neither (a development catalog)
// leaves it to the user to check the fingerprint (trustSource). A source
// the user adds is always checked by its fingerprint.
//
// The signed revocation list (servers.json "revocations.url", checked with
// the Phoenix catalog's keys; @phoenix/platform revocations.js; also an
// index's "revoked") is read with every refresh: an installed app or
// connector on it for malware or a security hole is removed and the user
// told why; for another reason the user is warned and offered removal
// (APP-STORE.md 3.9, Q56); none on it installs again. A release with
// "rollout" {percent, seed} is offered as an update only to the devices in
// its percentage (@phoenix/platform rollout.js); a first install takes the
// version the index lists.
//
// Written against injected dependencies (createPackagesService), so it runs
// unchanged on a device (service.js), in the simulator and in tests.

"use strict";

var platform = require("@phoenix/platform");
var catalog = require("./lib/catalog");
var ipkLib = require("./lib/ipk");
var pwa = require("./lib/pwa");
var appMuseum = require("./lib/appmuseum");
var preware = require("./lib/preware");
var accountTypes = require("./lib/accounts");
var version = require("./lib/version");
var md5 = require("./lib/md5");
var b64 = require("./lib/b64");

var SERVICE = "org.webosphoenix.service.packages";
var METHODS = ["getSources", "addSource", "trustSource", "setSource", "removeSource", "refresh", "browse", "search",
               "getApp", "install", "remove", "listInstalled", "updateAll", "scheduled", "listAccountTypes"];
var ACTIVITY = "org.webosphoenix.marketplace.updates";
var PAGE = 20;
var MAX_PACKAGE = 64 * 1024 * 1024;

function fail(code, text) {
    return { returnValue: false, errorCode: code, errorText: text };
}
function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}
function errorReply(e) {
    if (e && typeof e.code === "string" && /^[A-Z_]+$/.test(e.code)) return fail(e.code, e.message);
    return fail("UNKNOWN_ERROR", (e && e.message) || String(e));
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// deps:
//   luna.call(uri, params) -> Promise<reply>;
//   luna.subscribe(uri, params, onReply) -> cancel()
//   request({method, url, headers, body}) -> Promise<{status, headers, body}> (text)
//   requestBytes({method, url, headers}) -> Promise<{status, headers, bytes}>
//   crypto: sha256(bytes), sha512(bytes) -> Promise<Uint8Array>
//   gzip: {gzip, gunzip}
//   state.load() / state.save(obj)       the service's own settings and caches
//   temp.write(name, bytes) -> path; temp.remove(path)
//   defaultSources() -> [{id, name, kind, url, key?, enabled}]
//   servers() (optional) -> Promise<the resolved servers.json>: its
//            "catalog" {url, key, root} is the "phoenix" source's, its
//            "revocations" {url} the revocation list
//   crypto.randomBytes(n) (optional): the device's rollout id
//   preinstalled() (optional) -> [{id, sourceId, version, title?}]: the
//            connector packages the device came with
//            (/etc/palm/marketplace/preinstalled.json), the version each
//            has now (its appinfo.json)
//   firstParty() (optional) -> [{id, sourceId}]: Phoenix's own connector
//            packages the device does not come with but trusts as it trusts
//            those (preinstalled.json "firstParty": the drives, Jabber,
//            Matrix, Delta Chat)
//   now(), log(msg) (optional)
//   pending({appId, catalogId, sourceId, title, icon, state, progress,
//            errorText}) (optional): an install as it goes, for the
//            launcher's pending icon (its progress and error badges), as
//            the App Catalog's downloads reached LunaSysMgr's launcher
//            (ApplicationDescription Status_Installing / Status_Failed)
function createPackagesService(deps) {
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var ipk = ipkLib.createIpk({ gzip: deps.gzip });
    var busy = {};
    var platformCfg = null;   // servers.json, as last read (syncServers)
    var platformLoaded = false;

    // ---- Servers ---------------------------------------------------------------------

    function syncServers() {
        if (!deps.servers) return Promise.resolve(null);
        return Promise.resolve(deps.servers()).then(function (sv) {
            platformCfg = sv || null;
            platformLoaded = true;
            return platformCfg;
        }, function (e) { log("servers: " + e.message); return platformCfg; });
    }
    // The sources the device ships with, the Phoenix catalog's address and
    // keys from servers.json (none there: the source is not set up).
    function shippedSources() {
        var list = deps.defaultSources() || [];
        if (!deps.servers) return list;
        // Not read yet (a call before the first syncServers): the Phoenix
        // catalog is left as it is.
        if (!platformLoaded) return list.filter(function (d) { return d.id !== "phoenix"; });
        var c = platformCfg && platformCfg.catalog;
        return list.map(function (d) {
            if (d.kind !== "phoenix" || d.id !== "phoenix") return d;
            if (!c) return Object.assign({}, d, { url: d.url || null, notSetUp: !d.url });
            // A key the device's sources file gives (the simulator's local
            // catalog) stands when servers.json pins none.
            return Object.assign({}, d, { url: c.url, key: c.key || (d.url === c.url ? d.key : null) || null, root: c.root || null });
        });
    }

    // ---- State -----------------------------------------------------------------------

    function load() {
        var s = deps.state.load() || {};
        s.sources = s.sources || [];
        s.indexes = s.indexes || {};
        s.installed = s.installed || {};
        // Sources the device ships with join once, and stay as the user sets them.
        var known = {};
        s.sources.forEach(function (x) { known[x.id] = true; });
        shippedSources().forEach(function (d) {
            if (known[d.id]) return adoptKey(s, sourceOf(s, d.id), d);
            if ((s.removedDefaults || []).indexOf(d.id) >= 0) return;
            s.sources.push({ id: d.id, name: d.name, kind: d.kind, url: d.url, key: d.key || null, root: d.root || null, enabled: !!d.enabled,
                             builtin: true, lastBuild: null, refreshed: null, error: null, fingerprint: null,
                             keyFromDevice: !!(d.key || d.root) });
        });
        // The connector packages the device came with: installed from their
        // catalog, once (removed, they stay removed).
        s.preinstalledSeen = s.preinstalledSeen || {};
        preinstalledList().forEach(function (pre) {
            if (s.preinstalledSeen[pre.id]) return;
            s.preinstalledSeen[pre.id] = true;
            if (!s.installed[pre.id])
                s.installed[pre.id] = { sourceId: pre.sourceId, catalogId: pre.id, kind: "connector", title: pre.title || pre.id, icon: "",
                                        version: pre.version || "", museumId: null, installedAt: now().toISOString(), preinstalled: true };
        });
        return s;
    }
    function save(s) { deps.state.save(s); }
    // A key the device's sources file gives a catalog it ships with is
    // trusted without asking (the simulator gives its own local catalog's,
    // read from that catalog's data folder): taken when the user has not
    // trusted another, and followed when it changes.
    // The Phoenix catalog's address and its pinned root move with
    // servers.json (an image's update, Developer Mode's override): the
    // source follows, and a key the user trusted for the old address is
    // dropped with it.
    function adoptKey(s, src, d) {
        if (!src || !src.builtin) return;
        if (d.id === "phoenix" && deps.servers && d.url !== undefined && src.url !== d.url) {
            src.url = d.url;
            src.key = d.key || null;
            src.root = d.root || null;
            src.keyFromDevice = !!(d.key || d.root);
            src.fingerprint = null;
            src.lastBuild = null;
            src.error = null;
            delete s.indexes[src.id];
            return;
        }
        if ((d.root || null) !== (src.root || null)) {
            src.root = d.root || null;
            src.lastBuild = null;
            if (src.root) { src.key = null; src.keyFromDevice = true; src.fingerprint = null; }
        }
        if (!d.key || src.key === d.key) return;
        if (src.key && !src.keyFromDevice) return;
        src.key = d.key;
        src.keyFromDevice = true;
        src.fingerprint = null;
        src.lastBuild = null;
        if (src.error && src.error.errorCode === "UNTRUSTED") src.error = null;
    }
    function preinstalledList() {
        try { return (deps.preinstalled ? deps.preinstalled() : []) || []; } catch (e) { return []; }
    }
    function isPreinstalled(id) { return preinstalledList().some(function (p) { return p.id === id; }); }
    // Phoenix's own connector packages the device does not come with but
    // vouches for (preinstalled.json "firstParty": the drives, Jabber,
    // Matrix, Delta Chat): installed from a Phoenix catalog it ships with as a
    // pre-installed one is, without Developer Mode.
    function isFirstParty(id) {
        try { return ((deps.firstParty ? deps.firstParty() : []) || []).some(function (p) { return p.id === id; }); } catch (e) { return false; }
    }
    function sourceOf(s, id) { return s.sources.filter(function (x) { return x.id === id; })[0] || null; }
    function publicSource(x) {
        // insecure: read over plain HTTP from another computer, so anyone on
        // the way can change what it offers (a Preware feed has only MD5
        // sums; OPEN-QUESTIONS Q65). The Marketplace says so.
        var insecure = /^http:\/\//i.test(String(x.url || "")) && !/^http:\/\/(localhost|127\.|\[::1\])/i.test(String(x.url));
        return { id: x.id, name: x.name, kind: x.kind, url: x.url, enabled: x.enabled, builtin: !!x.builtin,
                 trusted: x.kind !== "phoenix" || !!x.key || !!x.root, pinned: !!(x.builtin && x.keyFromDevice), insecure: insecure,
                 notSetUp: !x.url, fingerprint: x.fingerprint || null,
                 refreshed: x.refreshed || null, error: x.error || null, count: x.count || 0 };
    }

    // ---- Reading the catalogs ------------------------------------------------------------

    function getText(url) {
        return Promise.resolve(deps.request({ method: "GET", url: url, headers: { Accept: "application/json, */*" } })).then(function (res) {
            if (res.status === 404) throw err("NOT_FOUND", "Nothing at " + url);
            if (res.status !== 200) throw err("BAD_SERVER", "HTTP " + res.status + " from " + url);
            return res.body;
        }, function (e) {
            throw err("CONNECTION_FAILED", "Could not reach " + url + (e && e.message ? " (" + e.message + ")" : ""));
        });
    }
    function getBytes(url, max) {
        return Promise.resolve(deps.requestBytes({ method: "GET", url: url, headers: {} })).then(function (res) {
            if (res.status !== 200) throw err("DOWNLOAD_FAILED", "HTTP " + res.status + " from " + url);
            if (res.bytes.length > (max || MAX_PACKAGE)) throw err("DOWNLOAD_FAILED", "The download is too large");
            return res.bytes;
        }, function (e) {
            throw err("DOWNLOAD_FAILED", "Could not download " + url + (e && e.message ? " (" + e.message + ")" : ""));
        });
    }
    function keyInfo(url) {
        var base = String(url).replace(/\/*$/, "/");
        return getText(base + "key.json").then(function (text) {
            var k;
            try { k = JSON.parse(text); } catch (e) { throw err("BAD_INDEX", "The catalog's key.json is not JSON"); }
            var key = b64.fromBase64(String(k.key || ""));
            if (key.length !== 32) throw err("BAD_INDEX", "The catalog's key is not an Ed25519 key");
            return catalog.fingerprint(key, deps.crypto.sha256).then(function (fp) {
                return { url: base, name: String(k.name || "").slice(0, 80) || base, key: b64.toBase64(key), fingerprint: fp };
            });
        });
    }

    function refreshOne(s, src) {
        if (src.kind === "appmuseum") {
            // Read live; nothing to keep.
            src.refreshed = now().toISOString();
            src.error = null;
            return Promise.resolve({ id: src.id, ok: true });
        }
        if (src.kind === "preware") {
            var feed = src.url.replace(/\/*$/, "/");
            return getText(feed + "Packages").then(function (text) {
                var apps = preware.parse(text, feed, src.id);
                s.indexes[src.id] = { build: null, categories: [], apps: apps };
                src.count = apps.length;
                src.refreshed = now().toISOString();
                src.error = null;
                return { id: src.id, ok: true };
            });
        }
        if (!src.url) return Promise.reject(err("NOT_SET_UP", "No Phoenix catalog is set up on this device (/etc/palm/phoenix/servers.json)"));
        var revokedKeys = (s.revocations && s.revocations.keys) || [];
        if (src.key && revokedKeys.indexOf(src.key) >= 0)
            return Promise.reject(err("REVOKED_KEY", "This catalog's key was revoked; it is not used any more"));
        if (src.key && !src.fingerprint) {
            return catalog.fingerprint(b64.fromBase64(src.key), deps.crypto.sha256).then(function (fp) {
                src.fingerprint = fp;
                return refreshOne(s, src);
            });
        }
        if (!src.key && !src.root) {
            return keyInfo(src.url).then(function (k) {
                src.error = { errorCode: "UNTRUSTED", errorText: "Check this catalog's key before using it" };
                return { id: src.id, ok: false, errorCode: "UNTRUSTED", pending: k };
            });
        }
        var base = src.url.replace(/\/*$/, "/");
        return Promise.all([
            Promise.resolve(deps.requestBytes({ method: "GET", url: base + "index.json", headers: {} })),
            getText(base + "index.json.sig"),
            catalogKeys(s, src)
        ]).then(function (r) {
            if (r[0].status !== 200) throw err("BAD_SERVER", "HTTP " + r[0].status + " from " + base + "index.json");
            return platform.signed.verifyWithAny(r[0].bytes, r[1], r[2], deps.crypto.sha512, "catalog").then(function (k) {
                return [r[0], r[1], k];
            });
        }).then(function (r) {
            return catalog.verifyIndex(r[0].bytes, r[1], r[2], {
                sha512: deps.crypto.sha512, now: now(), lastBuild: typeof src.lastBuild === "number" ? src.lastBuild : undefined,
                sourceId: src.id, baseUrl: base + "index.json"
            });
        }, function (e) {
            throw e.code ? e : err("CONNECTION_FAILED", "Could not reach " + base + (e && e.message ? " (" + e.message + ")" : ""));
        }).then(function (idx) {
            return markRollouts(s, idx).then(function () {
                s.indexes[src.id] = idx;
                src.lastBuild = idx.build;
                src.count = idx.apps.length;
                if (idx.name && src.name === src.url) src.name = idx.name;
                src.refreshed = now().toISOString();
                src.error = null;
                return { id: src.id, ok: true, build: idx.build };
            });
        });
    }

    // The keys a Phoenix catalog's index may be signed with: the one the
    // device pins or the user trusted, or the online keys the pinned root
    // delegated to (its key.json), never a revoked one.
    function catalogKeys(s, src) {
        var revokedKeys = (s.revocations && s.revocations.keys) || [];
        if (!src.root) return Promise.resolve([src.key]);
        var base = src.url.replace(/\/*$/, "/");
        return getText(base + "key.json").then(function (text) {
            var kj;
            try { kj = JSON.parse(text); } catch (e) { throw err("BAD_INDEX", "The catalog's key.json is not JSON"); }
            return platform.signed.trustedKeys(kj, { root: src.root }, "catalog",
                                               { sha512: deps.crypto.sha512, now: now(), revokedKeys: revokedKeys });
        });
    }

    // A release with a staged rollout this device is not in yet:
    // rolloutWaiting, so it is not offered as an update.
    function rolloutId(s) {
        if (!s.rolloutId) {
            var rnd = deps.crypto.randomBytes ? deps.crypto.randomBytes(16) : null;
            s.rolloutId = rnd ? b64.hex(rnd) : String(Math.random()).slice(2) + String(Date.now());
        }
        return s.rolloutId;
    }
    function markRollouts(s, idx) {
        var staged = idx.apps.filter(function (e) { return e.release && e.release.rollout && e.release.rollout.percent < 100; });
        return staged.reduce(function (chain, e) {
            return chain.then(function () {
                return platform.rollout.check(e.release.rollout, rolloutId(s), deps.crypto.sha256).then(function (r) {
                    if (!r.eligible) e.rolloutWaiting = true;
                });
            });
        }, Promise.resolve());
    }

    // ---- Revocations ----------------------------------------------------------------------

    // The signed list (servers.json "revocations"), checked with the
    // Phoenix catalog's keys; kept until a newer one comes.
    function refreshRevocations(s) {
        var cfg = platformCfg && platformCfg.revocations;
        var src = sourceOf(s, "phoenix");
        if (!cfg || !src || !src.url || (!src.key && !src.root)) return Promise.resolve(null);
        return Promise.all([
            Promise.resolve(deps.requestBytes({ method: "GET", url: cfg.url, headers: {} })),
            Promise.resolve(deps.requestBytes({ method: "GET", url: cfg.url + ".sig", headers: {} })),
            catalogKeys(s, src)
        ]).then(function (r) {
            if (r[0].status === 404) return null;   // none published yet
            if (r[0].status !== 200 || r[1].status !== 200) throw err("BAD_SERVER", "HTTP " + r[0].status + " from " + cfg.url);
            return platform.revocations.verify(r[0].bytes, b64.fromUtf8(r[1].bytes), r[2], {
                sha512: deps.crypto.sha512, now: now(),
                lastSequence: s.revocations && typeof s.revocations.sequence === "number" ? s.revocations.sequence : undefined
            }).then(function (list) {
                s.revocations = { sequence: list.sequence, expires: list.expires, apps: list.apps, keys: list.keys, fetched: now().toISOString() };
                return list;
            });
        }).then(null, function (e) {
            log("revocations: " + e.message);
            s.revocationsError = { errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message };
            return null;
        });
    }
    // Every revoked entry the device knows: the list's and the indexes'.
    function revokedList(s) {
        var out = {};
        ((s.revocations && s.revocations.apps) || []).forEach(function (r) { out[r.id] = r; });
        s.sources.forEach(function (src) {
            var idx = s.indexes[src.id];
            if (src.enabled && src.kind === "phoenix" && idx && idx.revoked) idx.revoked.forEach(function (r) { if (!out[r.id]) out[r.id] = r; });
        });
        return out;
    }
    function revokedFor(s, id, catalogId) {
        var all = revokedList(s);
        return all[id] || (catalogId && all[catalogId]) || null;
    }
    var REASON_TEXT = { malware: "it was found to be harmful", security: "it has a security hole", legal: "of a legal claim",
                        developer: "its developer withdrew it" };
    // Malware and security holes: removed, and the user told why. Other
    // reasons: the user is told once and may remove it (APP-STORE.md 3.9).
    function applyRevocations() {
        var s = load();
        var all = revokedList(s);
        s.revokedSeen = s.revokedSeen || {};
        var todo = Object.keys(s.installed).map(function (id) {
            var rec = s.installed[id], r = all[id] || all[rec.catalogId];
            return r && s.revokedSeen[id] !== r.reason + "|" + r.date ? { id: id, rec: rec, r: r } : null;
        }).filter(Boolean);
        todo.forEach(function (t) { s.revokedSeen[t.id] = t.r.reason + "|" + t.r.date; });
        if (todo.length) save(s);
        return todo.reduce(function (chain, t) {
            return chain.then(function () {
                var why = REASON_TEXT[t.r.reason] || "it was withdrawn";
                var act = t.r.remove ? remove({ id: t.id }).then(function (res) {
                    return res.returnValue ? t.rec.title + " was removed: " + why + "." : null;
                }) : Promise.resolve(t.rec.title + " was withdrawn from the Marketplace because " + why + ". You can remove it in the Marketplace.");
                return act.then(function (message) {
                    if (!message) return null;
                    return deps.luna.call("luna://com.webos.notification/createToast", {
                        message: message, onclick: { appId: "org.webosphoenix.marketplace", params: { section: "updates" } }
                    }).then(null, function () {});
                });
            });
        }, Promise.resolve()).then(function () { return todo.length; });
    }

    function refresh(p) {
        return syncServers().then(function () {
            var s = load();
            var list = s.sources.filter(function (x) { return p && p.id ? x.id === p.id : x.enabled; });
            if (p && p.id && !list.length) return fail("NOT_FOUND", "No such source");
            // The revocation list first: a key it names is not used for the catalogs.
            return refreshRevocations(s).then(function () {
                return list.reduce(function (chain, src) {
                    return chain.then(function (out) {
                        return refreshOne(s, src).then(null, function (e) {
                            src.error = { errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message };
                            log("refresh " + src.id + ": " + e.message);
                            return { id: src.id, ok: false, errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message };
                        }).then(function (r) { out.push(r); return out; });
                    });
                }, Promise.resolve([]));
            }).then(function (results) {
                save(s);
                return applyRevocations().then(null, function (e) { log("revocations: " + e.message); }).then(function () {
                    return { returnValue: true, results: results, sources: load().sources.map(publicSource) };
                });
            });
        });
    }

    // ---- Browsing ------------------------------------------------------------------------

    // What is installed for a catalog entry: by its id, or (Classics, whose
    // catalog ids are the archive's) the package's app id recorded with it.
    function installedFor(s, e) {
        if (s.installed[e.id] && s.installed[e.id].sourceId === e.sourceId) return { appId: e.id, rec: s.installed[e.id] };
        var appId = Object.keys(s.installed).filter(function (k) {
            return s.installed[k].catalogId === e.id && s.installed[k].sourceId === e.sourceId;
        })[0];
        return appId ? { appId: appId, rec: s.installed[appId] } : (s.installed[e.id] ? { appId: e.id, rec: s.installed[e.id] } : null);
    }
    // Why a native package (PDK, or a Preware program) does not install.
    function nativeText(arch) {
        return "it is a native webOS app" + (arch && arch !== "all" ? ", compiled for " + arch + " processors" : "") +
            ". Phoenix runs webOS web apps (Enyo); running native apps is planned, not here yet";
    }
    function withState(s, e) {
        var found = installedFor(s, e), inst = found && found.rec;
        var o = clone(e);
        o.installed = inst ? { version: inst.version, sourceId: inst.sourceId } : null;
        if (found) o.appId = found.appId;
        if (found && ownIcons[found.appId]) o.ownIcon = ownIcons[found.appId];
        o.update = inst && inst.sourceId === e.sourceId && e.version && !e.rolloutWaiting && version.compare(e.version, inst.version) > 0 ? e.version : null;
        var rv = revokedFor(s, e.id, found && found.appId);
        if (rv) {
            o.revoked = { reason: rv.reason, text: rv.text, date: rv.date };
            o.update = null;
            o.verdict = { ok: false, text: "Withdrawn from the Marketplace: " + (REASON_TEXT[rv.reason] || "withdrawn") + (rv.text ? " (" + rv.text + ")" : "") };
        }
        if (e.kind === "preware" && e.architecture !== "all")
            o.verdict = { ok: false, text: "Not for this device yet: " + nativeText(e.architecture) };
        return o;
    }
    function catalogApps(s, kinds) {
        var out = [];
        s.sources.forEach(function (src) {
            if (!src.enabled || !s.indexes[src.id]) return;
            s.indexes[src.id].apps.forEach(function (e) { if (kinds.indexOf(e.kind) >= 0) out.push(e); });
        });
        return out;
    }
    function museum(s) {
        var src = s.sources.filter(function (x) { return x.kind === "appmuseum" && x.enabled; })[0];
        return src ? appMuseum.createAppMuseum({ request: deps.request, url: src.url, sourceId: src.id }) : null;
    }

    function browse(p) {
        p = p || {};
        var s = load(), page = Math.max(0, p.page | 0);
        if (p.section === "classics") {
            var am = museum(s);
            var pw = catalogApps(s, ["preware"]);
            var fromFeeds = pw.filter(function (e) { return !p.category || e.categories.indexOf(p.category) >= 0; });
            var first = fromFeeds.slice(page * PAGE, (page + 1) * PAGE);
            var museumPage = am ? am.browse({ category: p.category, page: page, count: PAGE }) : Promise.resolve([]);
            return museumPage.then(function (apps) {
                var all = apps.concat(first);
                return { returnValue: true, apps: all.map(function (e) { return withState(s, e); }),
                         categories: ["Books", "Business", "Education", "Entertainment", "Finance", "Food", "Games", "Health & Fitness",
                                      "Lifestyle", "Music", "Navigation", "News", "Photography", "Productivity", "Reference", "Social Networking",
                                      "Sports", "Travel", "Utilities", "Weather"],
                         more: apps.length >= PAGE || fromFeeds.length > (page + 1) * PAGE };
            }, errorReply);
        }
        var kinds = p.section === "web" ? ["pwa"] : p.section === "apps" ? ["ipk"] : ["pwa", "ipk"];
        var apps = catalogApps(s, kinds);
        if (p.section === "featured" || !p.section) apps = apps.filter(function (e) { return e.featured; }).concat(apps.filter(function (e) { return !e.featured; }));
        var cats = {};
        apps.forEach(function (e) { e.categories.forEach(function (c) { cats[c] = true; }); });
        if (p.category) apps = apps.filter(function (e) { return e.categories.indexOf(p.category) >= 0; });
        if (p.section !== "featured" && p.section) apps.sort(function (a, b) { return a.title.localeCompare(b.title); });
        return Promise.resolve({ returnValue: true, apps: apps.slice(page * PAGE, (page + 1) * PAGE).map(function (e) { return withState(s, e); }),
                                 categories: Object.keys(cats).sort(), more: apps.length > (page + 1) * PAGE });
    }

    // The account types of the Phoenix catalogs switched on, each template
    // once (the first catalog's). A catalog read before C0, or an old index,
    // has none.
    function catalogAccountTypes(s) {
        var out = [], seen = {};
        s.sources.forEach(function (src) {
            var idx = s.indexes[src.id];
            if (!src.enabled || src.kind !== "phoenix" || !idx) return;
            (idx.accounts || []).forEach(function (t) {
                if (seen[t.templateId]) return;
                seen[t.templateId] = true;
                // Phoenix's own connector from the catalog the device ships with
                // (pre-installed or preinstalled.json "firstParty": the drives, Jabber, ...):
                // installed without Developer Mode (firstPartyEntry).
                if (t.package && !t.package.builtin && (isPreinstalled(t.package.id) || isFirstParty(t.package.id)) && src.builtin && !!src.key) {
                    t = Object.assign({}, t, { package: Object.assign({}, t.package, { firstParty: true }) });
                }
                out.push(t);
            });
        });
        return out;
    }
    function listAccountTypes(p) {
        var caps = p && p.capability !== undefined ? [].concat(p.capability).filter(function (c) { return typeof c === "string"; }) : null;
        var list = catalogAccountTypes(load()).filter(function (t) { return accountTypes.hasCapability(t, caps); });
        return Promise.resolve({ returnValue: true, accountTypes: clone(list) });
    }

    function search(p) {
        var words = String((p && p.query) || "").toLowerCase().trim();
        if (!words) return Promise.resolve({ returnValue: true, apps: [], accountTypes: [] });
        var s = load();
        var terms = words.split(/\s+/);
        var types = catalogAccountTypes(s).filter(function (t) { return accountTypes.matches(t, terms); });
        var hits = catalogApps(s, ["pwa", "ipk", "preware"]).filter(function (e) {
            var hay = (e.title + " " + e.summary + " " + e.developer.name + " " + e.categories.join(" ")).toLowerCase();
            return terms.every(function (t) { return hay.indexOf(t) >= 0; });
        });
        var am = museum(s);
        return (am ? am.search(words).then(null, function () { return []; }) : Promise.resolve([])).then(function (classics) {
            return { returnValue: true, apps: hits.concat(classics.slice(0, 30)).map(function (e) { return withState(s, e); }),
                     accountTypes: clone(types) };
        });
    }

    function findApp(s, sourceId, id) {
        var src = sourceOf(s, sourceId);
        if (!src) return Promise.reject(err("NOT_FOUND", "No such source"));
        if (src.kind === "appmuseum") {
            var am = appMuseum.createAppMuseum({ request: deps.request, url: src.url, sourceId: src.id });
            var museumId = String(id).replace(/^appmuseum\./, "");
            return am.details(museumId).then(function (d) {
                if (!d.url) throw err("NOT_FOUND", "The App Museum has no package for this app");
                return {
                    id: "appmuseum." + museumId, appId: d.appId, museumId: museumId, sourceId: src.id, kind: "classic", title: "",
                    developer: { name: "", url: "" }, summary: "", description: d.description, categories: [], icon: "",
                    screenshots: d.screenshots, license: "", homepage: d.homepage, donation: "", featured: false, rating: null,
                    version: d.version, release: { url: d.url, size: d.size }
                };
            });
        }
        var idx = s.indexes[src.id];
        var e = idx && idx.apps.filter(function (a) { return a.id === id; })[0];
        return e ? Promise.resolve(e) : Promise.reject(err("NOT_FOUND", "The catalog has no app " + id));
    }

    // ---- Installing --------------------------------------------------------------------------

    // Developer Mode (com.webos.service.devmode; Settings > Developer Mode).
    function devMode() {
        return Promise.resolve(deps.luna.call("luna://com.webos.service.devmode/getDevMode", {}))
            .then(function (r) { return !!r && r.status === "enabled"; }, function () { return false; });
    }

    // Whether an entry is a first-party connector the device vouches for:
    // one it came with (preinstalled) or one of Phoenix's own it lists as
    // installed from the catalog (firstParty: the drives), from a Phoenix catalog it ships with
    // (a builtin source) whose key is the one the device was given or the
    // user checked: its index is signed with that key, so the package (its
    // SHA-256 in the index) is the catalog's.
    function firstPartyEntry(s, entry) {
        var src = sourceOf(s, entry.sourceId);
        return entry.kind === "connector" && (isPreinstalled(entry.id) || isFirstParty(entry.id)) &&
            !!src && src.builtin && src.kind === "phoenix" && !!(src.key || src.root);
    }

    // The package's bytes -> its app, or an error saying why it cannot be installed.
    // dev (Developer Mode): install scripts, services and files outside the
    // app are allowed ({developer: true}: the installer is told so).
    // firstParty: a connector the device came with, from a catalog it ships
    // with (firstPartyEntry): installed without Developer Mode.
    function check(bytes, entry, dev, firstParty) {
        return ipk.read(bytes).then(function (pkg) {
            var app = pkg.apps[0];
            if (!app || pkg.apps.length > 1) throw err("BAD_PACKAGE", "The package does not hold one app");
            if ((entry.kind === "ipk" || entry.kind === "connector") && (app.id !== entry.id || pkg.control.Package !== entry.id))
                throw err("BAD_PACKAGE", "The package is " + (pkg.control.Package || app.id) + ", not " + entry.id);
            var outside = pkg.files.filter(function (f) { return f.path.indexOf(app.dir) !== 0; });
            // A Synergy connector carries its service in the app's service/
            // folder (docs/SYNERGY-CONNECTORS.md 3.1): third-party connectors
            // install in Developer Mode only until the connector tier (4.1).
            var connector = pkg.files.some(function (f) {
                return f.path === app.dir + "service/package.json" || f.path.indexOf(app.dir + "service/sysbus/") === 0;
            });
            var needs = pkg.scripts.length ? "The package runs install scripts as the system"
                : pkg.services.length ? "The app has background services"
                : connector && !firstParty ? "It is a Synergy connector (an account type with a background service)"
                : outside.length ? "The package puts files outside its app (" + outside[0].path + ")" : "";
            if (needs && !dev) throw err("NEEDS_DEVMODE", needs + ": turn on Developer Mode in Settings to install it");
            var type = app.appinfo.type || "web";
            if (type !== "web")
                throw err("UNSUPPORTED", "Not for this device yet: " + nativeText(pkg.control.Architecture));
            var has = function (name) { return pkg.files.some(function (f) { return f.path === app.dir + name; }); };
            if (has("sources.json") && !has("depends.js")) throw err("NEEDS_MOJO", "It is a Mojo app: Palm's Mojo framework was never open-sourced, so Phoenix cannot run it");
            // A web app with native PDK plugins (appinfo "plug-ins"; each
            // plugin has a <name>_appinfo.json beside its binary): it installs
            // and runs, but what it asks of its plugins does not happen yet.
            var plugins = !app.appinfo["plug-ins"] ? [] : pkg.files.map(function (f) {
                var m = f.path.indexOf(app.dir) === 0 && /([^/]+)_appinfo\.json$/.exec(f.path);
                return m ? m[1] : "";
            }).filter(Boolean);
            return { pkg: pkg, app: app, developer: !!needs, firstParty: !!(connector && firstParty && !needs), plugins: plugins };
        });
    }

    // An app's icon from its package (appinfo's icon, beside it), as a data:
    // address the launcher can draw before the app is installed: a PNG, JPEG
    // or GIF by its own bytes, at most 256 KB; else "".
    var ICON_TYPES = [["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]], ["image/gif", [0x47, 0x49, 0x46, 0x38]]];
    function packageIcon(c) {
        var name = String((c.app.appinfo && c.app.appinfo.icon) || "icon.png").replace(/^\.?\//, "");
        var f = c.pkg.files.filter(function (x) { return x.path === c.app.dir + name; })[0];
        var data = f && (typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data);
        if (!data || !data.length || data.length > 256 * 1024) return "";
        for (var i = 0; i < ICON_TYPES.length; ++i) {
            var sig = ICON_TYPES[i][1];
            if (sig.every(function (b, k) { return data[k] === b; }))
                return "data:" + ICON_TYPES[i][0] + ";base64," + b64.toBase64(data);
        }
        return "";
    }

    function sha256Hex(bytes) {
        return Promise.resolve(deps.crypto.sha256(bytes)).then(function (h) { return b64.hex(new Uint8Array(h)); });
    }

    // The package for an entry: downloaded and checked, or (a web app) made.
    function packageFor(s, entry, progress) {
        if (entry.kind === "pwa") {
            progress({ state: "downloading", progress: 10 });
            return getText(entry.pwa.manifest).then(function (text) {
                var m = pwa.parseManifest(text, entry.pwa.manifest, entry.pwa.origin + "/");
                if (new URL(m.startUrl).origin !== entry.pwa.origin)
                    throw err("BAD_MANIFEST", "The site's start page is not on " + entry.pwa.origin);
                var icons = pwa.pickIcons(m);
                var fetch = function (i) { return i ? getBytes(i.src, 4 * 1024 * 1024).then(null, function () { return null; }) : Promise.resolve(null); };
                return Promise.all([fetch(icons.small), fetch(icons.large)]).then(function (got) {
                    // None of the site's own icons is there (the catalog then
                    // made one, iconGenerated): the catalog's icon.
                    if (got[0] || !entry.icon) return got;
                    return fetch({ src: entry.icon }).then(function (b) { return [b, null, entry.icon]; });
                }).then(function (got) {
                    progress({ state: "checking", progress: 50 });
                    var dir = ipkLib.APP_ROOT + entry.id + "/";
                    var files = [], names = {};
                    if (got[0]) {
                        names.icon = "icon." + (got[2] ? pwa.extOf("", got[2]) : pwa.extOf(icons.small.type, icons.small.src));
                        files.push({ path: dir + names.icon, data: got[0] });
                    }
                    if (got[1]) {
                        names.large = "icon-256x256." + pwa.extOf(icons.large.type, icons.large.src);
                        files.push({ path: dir + names.large, data: got[1] });
                    }
                    var info = pwa.appinfo(entry, m, names);
                    files.unshift({ path: dir + "appinfo.json", data: JSON.stringify(info, null, 4) + "\n" });
                    return ipk.write({
                        control: { Package: entry.id, Version: info.version, Section: "web", Architecture: "all",
                                   Maintainer: info.vendor, Description: entry.title + " (web app, " + new URL(m.startUrl).host + ")" },
                        files: files
                    });
                });
            });
        }
        var rel = entry.release;
        progress({ state: "downloading", progress: 10 });
        return getBytes(rel.url).then(function (bytes) {
            progress({ state: "checking", progress: 60 });
            if (entry.kind === "ipk" || entry.kind === "connector") {
                if (rel.size && bytes.length !== rel.size) throw err("BAD_PACKAGE", "The download is not the size the catalog signed");
                return sha256Hex(bytes).then(function (h) {
                    if (h !== rel.sha256) throw err("BAD_PACKAGE", "The download is not the package the catalog signed (SHA-256)");
                    return bytes;
                });
            }
            if (entry.kind === "preware" && rel.md5 && md5.md5(bytes) !== rel.md5)
                throw err("BAD_PACKAGE", "The download does not match the feed's MD5 sum");
            return bytes;
        });
    }

    // OSE's installer, to the end: {ok, error}.
    // developer: the package needs Developer Mode (scripts, services, ...).
    // firstParty: a connector the device came with (check), which the
    // installer takes from this service without Developer Mode.
    function osInstall(id, path, developer, firstParty) {
        return new Promise(function (resolve) {
            var done = false, cancel = null;
            function finish(r) {
                if (done) return;
                done = true;
                if (cancel) cancel();
                resolve(r);
            }
            var req = { id: id, ipkUrl: path, subscribe: true };
            if (developer) req.developerMode = true;
            if (firstParty) req.firstParty = true;
            cancel = deps.luna.subscribe("luna://com.webos.appInstallService/install", req, function (r) {
                if (r.returnValue === false && !r.details) return finish({ ok: false, error: r.errorText || "The installer refused the package" });
                var st = r.details && r.details.state;
                if (r.statusValue === 30 || st === "installed") finish({ ok: true, skipped: (r.details && r.details.skipped) || [] });
                else if (r.statusValue === 24 || r.statusValue === 23 || /failed/.test(st || ""))
                    finish({ ok: false, error: (r.details && r.details.reason) || "The installer failed" });
            });
        });
    }

    function install(p, push) {
        push = push || function () {};
        if (!p || !p.sourceId || !p.id) return Promise.resolve(fail("BAD_PARAMS", "sourceId and id are required"));
        if (busy[p.id]) return Promise.resolve(fail("BUSY", "It is being installed already"));
        busy[p.id] = true;
        var s = load(), entry, appId, path;
        // The install is also an ongoing activity in the notification area
        // (org.webosphoenix.ongoing; the shell's), until it ends.
        var ongoingId = SERVICE + "/" + p.sourceId + "/" + p.id;
        var ongoing = function (st) {
            var words = { downloading: "Downloading", checking: "Checking", installing: "Installing" };
            deps.luna.call("luna://org.webosphoenix.ongoing/set", {
                id: ongoingId, appId: "org.webosphoenix.marketplace", title: (entry && entry.title) || p.id,
                body: words[st.state] || "", progress: st.progress, params: { sourceId: p.sourceId, id: p.id }
            }).then(null, function () {});
        };
        // The launcher's pending icon: the package's own once it has been
        // read (packageIcon), else the catalog's (none for an App Museum app;
        // the launcher then draws the app's initial, as for one it cannot load).
        var ownIcon = "";
        // Only an install that got going has an icon to mark failed.
        var pendingShown = false;
        var pending = function (st) {
            if (!deps.pending || (st.state === "failed" && !pendingShown)) return;
            pendingShown = true;
            try {
                deps.pending(Object.assign({
                    appId: appId || (entry && (entry.appId || entry.id)) || p.id, catalogId: p.id, sourceId: p.sourceId,
                    title: (entry && entry.title) || "", icon: ownIcon || (entry && entry.icon) || ""
                }, st));
            } catch (e) { log("pending: " + e.message); }
        };
        var progress = function (st) {
            ongoing(st);
            pending(st);
            push(Object.assign({ returnValue: true, id: p.id }, st));
        };
        return findApp(s, p.sourceId, p.id).then(function (e) {
            entry = e;
            var rv = revokedFor(s, entry.id, entry.appId);
            if (rv) throw err("REVOKED", "Withdrawn from the Marketplace: " + (REASON_TEXT[rv.reason] || "withdrawn") + (rv.text ? " (" + rv.text + ")" : ""));
            if (entry.verdict && !entry.verdict.ok) throw err("UNSUPPORTED", entry.verdict.text);
            if (entry.kind === "preware" && entry.architecture && entry.architecture !== "all")
                throw err("UNSUPPORTED", "Not for this device yet: " + nativeText(entry.architecture));
            return Promise.all([packageFor(s, entry, progress), devMode()]);
        }).then(function (got) {
            var bytes = got[0];
            return check(bytes, entry, got[1], firstPartyEntry(s, entry)).then(function (c) {
                appId = c.app.id;
                ownIcon = packageIcon(c);
                if (entry.kind !== "classic" && entry.kind !== "preware" && appId !== entry.id) throw err("BAD_PACKAGE", "The package holds another app");
                var owner = load().installed[appId];
                if (owner && owner.sourceId !== entry.sourceId)
                    throw err("UNSUPPORTED", "This app was installed from another catalog; remove it first");
                return Promise.resolve(deps.temp.write(appId + ".ipk", bytes)).then(function (where) {
                    path = where;
                    progress({ state: "installing", progress: 80 });
                    return osInstall(appId, path, c.developer, c.firstParty);
                }).then(function (r) {
                    if (!r.ok) throw err("INSTALL_FAILED", r.error);
                    var s2 = load();
                    s2.installed[appId] = {
                        sourceId: entry.sourceId, catalogId: entry.id, kind: entry.kind, title: entry.title || c.app.appinfo.title || appId,
                        icon: entry.icon || "", version: entry.kind === "pwa" ? entry.version : (c.app.appinfo.version || c.pkg.control.Version || entry.version || ""),
                        museumId: entry.museumId || null, installedAt: now().toISOString()
                    };
                    save(s2);
                    if (entry.kind === "classic") {
                        var am = museum(s2);
                        if (am) am.countDownload(entry.museumId);
                    }
                    var done = { returnValue: true, id: p.id, appId: appId, state: "installed", progress: 100 };
                    // What the installer could not do (the simulator: scripts,
                    // services), and native plugins nothing runs yet.
                    var skipped = (r.skipped || []).concat(c.plugins && c.plugins.length
                        ? ["native " + (c.plugins.length > 1 ? "plugins" : "plugin") + " (" + c.plugins.join(", ") + ")"] : []);
                    if (skipped.length) done.skipped = skipped;
                    pending({ state: "installed", progress: 100 });
                    push(done);
                    return done;
                });
            });
        }).then(null, function (e) {
            var r = errorReply(e);
            r.id = p.id;
            r.state = "failed";
            pending({ state: "failed", errorCode: r.errorCode, errorText: r.errorText });
            push(r);
            log("install " + p.id + ": " + r.errorText);
            return r;
        }).then(function (r) {
            deps.luna.call("luna://org.webosphoenix.ongoing/clear", { id: ongoingId }).then(null, function () {});
            delete busy[p.id];
            if (path) Promise.resolve(deps.temp.remove(path)).then(null, function () {});
            return r;
        });
    }

    function remove(p) {
        if (!p || !p.id) return Promise.resolve(fail("BAD_PARAMS", "id is required"));
        return new Promise(function (resolve) {
            var cancel = null, done = false;
            cancel = deps.luna.subscribe("luna://com.webos.appInstallService/remove", { id: p.id, subscribe: true }, function (r) {
                if (done) return;
                if (r.returnValue === false && !r.details) { done = true; return resolve(fail("NOT_FOUND", r.errorText || "No such app")); }
                if (r.statusValue === 31 || (r.details && r.details.state === "removed")) { done = true; resolve({ returnValue: true }); }
                else if (r.statusValue === 25) { done = true; resolve(fail("INSTALL_FAILED", (r.details && r.details.reason) || "Could not remove it")); }
            });
        }).then(function (r) {
            if (r.returnValue) {
                var s = load();
                delete s.installed[p.id];
                save(s);
            }
            return r;
        });
    }

    // The installed apps' own icons as the launcher draws them (their
    // default launch points'), by app id: what the Marketplace shows for an
    // app on the device. A catalog's icon can be missing (the App Museum's
    // details name none) or out of reach (a feed's server); the app's own is
    // on the device.
    var ownIcons = {};

    // Apps removed some other way (the launcher) are forgotten here too.
    function reconcile() {
        // Every app, the hidden ones too (a connector's app is hidden: not a launch point).
        var all = Promise.resolve(deps.luna.call("luna://com.webos.applicationManager/listApps", {})).then(function (r) {
            return r && Array.isArray(r.apps) ? r.apps : null;
        }, function () { return null; });
        return Promise.all([deps.luna.call("luna://com.webos.applicationManager/listLaunchPoints", {}), all]).then(function (got) {
            var r = got[0];
            if (!r || !Array.isArray(r.launchPoints)) return;
            var present = {};
            ownIcons = {};
            r.launchPoints.forEach(function (lp) {
                present[lp.id] = true;
                if (lp.icon && (!lp.launchPointId || lp.launchPointId === lp.id + "_default")) ownIcons[lp.id] = String(lp.icon);
            });
            (got[1] || []).forEach(function (a) {
                present[a.id] = true;
                if (a.icon && !ownIcons[a.id]) ownIcons[a.id] = String(a.icon);
            });
            var s = load(), changed = false;
            Object.keys(s.installed).forEach(function (id) {
                if (!present[id]) { delete s.installed[id]; changed = true; }
            });
            if (changed) save(s);
        }, function () {});
    }

    function updatesOf(s) {
        var out = [];
        Object.keys(s.installed).forEach(function (id) {
            var inst = s.installed[id];
            var idx = s.indexes[inst.sourceId];
            var e = idx && idx.apps.filter(function (a) { return a.id === (inst.catalogId || id); })[0];
            if (e && e.version && !e.rolloutWaiting && !revokedFor(s, id, inst.catalogId) && version.compare(e.version, inst.version) > 0)
                out.push({ id: id, entry: e });
        });
        return out;
    }

    function listInstalled() {
        return reconcile().then(function () {
            var s = load();
            var ups = {};
            updatesOf(s).forEach(function (u) { ups[u.id] = u.entry.version; });
            return { returnValue: true, apps: Object.keys(s.installed).sort().map(function (id) {
                var i = s.installed[id];
                var rv = revokedFor(s, id, i.catalogId);
                return { id: id, catalogId: i.catalogId || id, title: i.title, icon: ownIcons[id] || i.icon || "", catalogIcon: i.icon || "",
                         version: i.version, sourceId: i.sourceId,
                         kind: i.kind, installedAt: i.installedAt, update: ups[id] || null,
                         revoked: rv ? { reason: rv.reason, text: rv.text, date: rv.date } : null };
            }) };
        });
    }

    function updateAll() {
        return refresh({}).then(function () {
            var s = load();
            var list = updatesOf(s);
            return list.reduce(function (chain, u) {
                return chain.then(function (out) {
                    return install({ sourceId: u.entry.sourceId, id: u.entry.id }).then(function (r) { out.push(r); return out; });
                });
            }, Promise.resolve([])).then(function (results) {
                return { returnValue: true, updated: results.filter(function (r) { return r.returnValue; }).map(function (r) { return r.appId; }),
                         failed: results.filter(function (r) { return !r.returnValue; }).map(function (r) { return { id: r.id, errorText: r.errorText }; }) };
            });
        });
    }

    function scheduled(p) {
        var activityId = p && p.$activity && p.$activity.activityId;
        return refresh({}).then(function () {
            var n = updatesOf(load()).length;
            var tell = n ? deps.luna.call("luna://com.webos.notification/createToast", {
                message: n === 1 ? "1 app update in the Marketplace" : n + " app updates in the Marketplace",
                onclick: { appId: "org.webosphoenix.marketplace", params: { section: "updates" } }
            }) : Promise.resolve();
            return Promise.resolve(tell).then(null, function () {}).then(function () {
                return activityId ? deps.luna.call("luna://com.palm.activitymanager/complete", { activityId: activityId, restart: true }) : null;
            }).then(function () { return { returnValue: true, updates: n }; });
        });
    }

    function ensureSchedule() {
        return deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: ACTIVITY, description: "Marketplace update check", type: { background: true, persist: true },
                        schedule: { interval: "24h" }, requirements: { internet: true },
                        callback: { method: "luna://" + SERVICE + "/scheduled", params: {} } }
        }).then(null, function () {});
    }

    return {
        getSources: function () {
            ensureSchedule();
            return syncServers().then(function () {
                var s = load();
                return { returnValue: true, sources: s.sources.map(publicSource),
                         revocations: s.revocations ? { sequence: s.revocations.sequence, fetched: s.revocations.fetched, count: s.revocations.apps.length }
                             : null };
            });
        },
        addSource: function (p) {
            var u = String((p && p.url) || "").trim();
            if (!/^https?:\/\//i.test(u)) return Promise.resolve(fail("BAD_PARAMS", "url: the catalog's address (https://...)"));
            return keyInfo(u).then(function (k) { return { returnValue: true, pending: k }; }, errorReply);
        },
        trustSource: function (p) {
            if (!p || !p.url || !p.key) return Promise.resolve(fail("BAD_PARAMS", "url and key are required"));
            var key = b64.fromBase64(p.key);
            if (key.length !== 32) return Promise.resolve(fail("BAD_PARAMS", "key: a base64 Ed25519 public key"));
            var s = load(), base = String(p.url).replace(/\/*$/, "/");
            var src = s.sources.filter(function (x) { return x.kind === "phoenix" && x.url.replace(/\/*$/, "/") === base; })[0];
            return catalog.fingerprint(key, deps.crypto.sha256).then(function (fp) {
                if (!src) {
                    src = { id: "c" + Date.now().toString(36), name: p.name || base, kind: "phoenix", url: base, enabled: true, builtin: false };
                    s.sources.push(src);
                }
                // A new key starts the build count again.
                if (src.key !== b64.toBase64(key)) src.lastBuild = null;
                src.key = b64.toBase64(key);
                src.fingerprint = fp;
                src.enabled = true;
                save(s);
                return refresh({ id: src.id });
            });
        },
        setSource: function (p) {
            var s = load(), src = sourceOf(s, p && p.id);
            if (!src) return Promise.resolve(fail("NOT_FOUND", "No such source"));
            src.enabled = !!p.enabled;
            save(s);
            return src.enabled ? refresh({ id: src.id }) : Promise.resolve({ returnValue: true, sources: s.sources.map(publicSource) });
        },
        removeSource: function (p) {
            var s = load(), src = sourceOf(s, p && p.id);
            if (!src) return Promise.resolve(fail("NOT_FOUND", "No such source"));
            s.sources = s.sources.filter(function (x) { return x !== src; });
            delete s.indexes[src.id];
            if (src.builtin) s.removedDefaults = (s.removedDefaults || []).concat([src.id]);
            save(s);
            return Promise.resolve({ returnValue: true, sources: s.sources.map(publicSource) });
        },
        refresh: function (p) { return refresh(p || {}); },
        browse: browse,
        search: search,
        getApp: function (p) {
            return reconcile().then(function () {
                var s = load();
                return findApp(s, p && p.sourceId, p && p.id).then(function (e) {
                    return { returnValue: true, app: withState(s, e) };
                }, errorReply);
            });
        },
        install: install,
        remove: remove,
        listInstalled: listInstalled,
        updateAll: updateAll,
        scheduled: scheduled,
        listAccountTypes: listAccountTypes
    };
}

module.exports = { SERVICE: SERVICE, METHODS: METHODS, ACTIVITY: ACTIVITY, createPackagesService: createPackagesService };
