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
//   search {query}                      -> {apps} from every source switched on
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
// BAD_SIGNATURE, EXPIRED, ROLLBACK, BAD_INDEX, BAD_SERVER, CONNECTION_FAILED,
// DOWNLOAD_FAILED, BAD_PACKAGE, UNSUPPORTED, NEEDS_DEVMODE, NEEDS_MOJO, BAD_MANIFEST,
// INSTALL_FAILED, BUSY, BAD_PARAMS.
//
// Written against injected dependencies (createPackagesService), so it runs
// unchanged on a device (service.js), in the simulator and in tests.

"use strict";

var catalog = require("./lib/catalog");
var ipkLib = require("./lib/ipk");
var pwa = require("./lib/pwa");
var appMuseum = require("./lib/appmuseum");
var preware = require("./lib/preware");
var version = require("./lib/version");
var md5 = require("./lib/md5");
var b64 = require("./lib/b64");

var SERVICE = "org.webosphoenix.service.packages";
var METHODS = ["getSources", "addSource", "trustSource", "setSource", "removeSource", "refresh", "browse", "search",
               "getApp", "install", "remove", "listInstalled", "updateAll", "scheduled"];
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
//   now(), log(msg) (optional)
function createPackagesService(deps) {
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var ipk = ipkLib.createIpk({ gzip: deps.gzip });
    var busy = {};

    // ---- State -----------------------------------------------------------------------

    function load() {
        var s = deps.state.load() || {};
        s.sources = s.sources || [];
        s.indexes = s.indexes || {};
        s.installed = s.installed || {};
        // Sources the device ships with join once, and stay as the user sets them.
        var known = {};
        s.sources.forEach(function (x) { known[x.id] = true; });
        (deps.defaultSources() || []).forEach(function (d) {
            if (known[d.id] || (s.removedDefaults || []).indexOf(d.id) >= 0) return;
            s.sources.push({ id: d.id, name: d.name, kind: d.kind, url: d.url, key: d.key || null, enabled: !!d.enabled,
                             builtin: true, lastBuild: null, refreshed: null, error: null, fingerprint: null });
        });
        return s;
    }
    function save(s) { deps.state.save(s); }
    function sourceOf(s, id) { return s.sources.filter(function (x) { return x.id === id; })[0] || null; }
    function publicSource(x) {
        return { id: x.id, name: x.name, kind: x.kind, url: x.url, enabled: x.enabled, builtin: !!x.builtin,
                 trusted: x.kind !== "phoenix" || !!x.key, fingerprint: x.fingerprint || null,
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
        if (!src.key) {
            return keyInfo(src.url).then(function (k) {
                src.error = { errorCode: "UNTRUSTED", errorText: "Check this catalog's key before using it" };
                return { id: src.id, ok: false, errorCode: "UNTRUSTED", pending: k };
            });
        }
        var base = src.url.replace(/\/*$/, "/");
        return Promise.all([
            Promise.resolve(deps.requestBytes({ method: "GET", url: base + "index.json", headers: {} })),
            getText(base + "index.json.sig")
        ]).then(function (r) {
            if (r[0].status !== 200) throw err("BAD_SERVER", "HTTP " + r[0].status + " from " + base + "index.json");
            return catalog.verifyIndex(r[0].bytes, r[1], src.key, {
                sha512: deps.crypto.sha512, now: now(), lastBuild: typeof src.lastBuild === "number" ? src.lastBuild : undefined,
                sourceId: src.id
            });
        }, function (e) {
            throw e.code ? e : err("CONNECTION_FAILED", "Could not reach " + base + (e && e.message ? " (" + e.message + ")" : ""));
        }).then(function (idx) {
            s.indexes[src.id] = idx;
            src.lastBuild = idx.build;
            src.count = idx.apps.length;
            if (idx.name && src.name === src.url) src.name = idx.name;
            src.refreshed = now().toISOString();
            src.error = null;
            return { id: src.id, ok: true, build: idx.build };
        });
    }

    function refresh(p) {
        var s = load();
        var list = s.sources.filter(function (x) { return p && p.id ? x.id === p.id : x.enabled; });
        if (p && p.id && !list.length) return Promise.resolve(fail("NOT_FOUND", "No such source"));
        return list.reduce(function (chain, src) {
            return chain.then(function (out) {
                return refreshOne(s, src).then(null, function (e) {
                    src.error = { errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message };
                    log("refresh " + src.id + ": " + e.message);
                    return { id: src.id, ok: false, errorCode: e.code || "UNKNOWN_ERROR", errorText: e.message };
                }).then(function (r) { out.push(r); return out; });
            });
        }, Promise.resolve([])).then(function (results) {
            save(s);
            return { returnValue: true, results: results, sources: s.sources.map(publicSource) };
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
        o.update = inst && inst.sourceId === e.sourceId && e.version && version.compare(e.version, inst.version) > 0 ? e.version : null;
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

    function search(p) {
        var words = String((p && p.query) || "").toLowerCase().trim();
        if (!words) return Promise.resolve({ returnValue: true, apps: [] });
        var s = load();
        var terms = words.split(/\s+/);
        var hits = catalogApps(s, ["pwa", "ipk", "preware"]).filter(function (e) {
            var hay = (e.title + " " + e.summary + " " + e.developer.name + " " + e.categories.join(" ")).toLowerCase();
            return terms.every(function (t) { return hay.indexOf(t) >= 0; });
        });
        var am = museum(s);
        return (am ? am.search(words).then(null, function () { return []; }) : Promise.resolve([])).then(function (classics) {
            return { returnValue: true, apps: hits.concat(classics.slice(0, 30)).map(function (e) { return withState(s, e); }) };
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

    // The package's bytes -> its app, or an error saying why it cannot be installed.
    // dev (Developer Mode): install scripts, services and files outside the
    // app are allowed ({developer: true}: the installer is told so).
    function check(bytes, entry, dev) {
        return ipk.read(bytes).then(function (pkg) {
            var app = pkg.apps[0];
            if (!app || pkg.apps.length > 1) throw err("BAD_PACKAGE", "The package does not hold one app");
            if (entry.kind === "ipk" && (app.id !== entry.id || pkg.control.Package !== entry.id))
                throw err("BAD_PACKAGE", "The package is " + (pkg.control.Package || app.id) + ", not " + entry.id);
            var outside = pkg.files.filter(function (f) { return f.path.indexOf(app.dir) !== 0; });
            var needs = pkg.scripts.length ? "The package runs install scripts as the system"
                : pkg.services.length ? "The app has background services"
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
            return { pkg: pkg, app: app, developer: !!needs, plugins: plugins };
        });
    }

    function sha256Hex(bytes) {
        return Promise.resolve(deps.crypto.sha256(bytes)).then(function (h) { return b64.hex(new Uint8Array(h)); });
    }

    // The package for an entry: downloaded and checked, or (a web app) made.
    function packageFor(s, entry, progress) {
        if (entry.kind === "pwa") {
            progress({ state: "downloading", progress: 10 });
            return getText(entry.pwa.manifest).then(function (text) {
                var m = pwa.parseManifest(text, entry.pwa.manifest);
                if (new URL(m.startUrl).origin !== entry.pwa.origin)
                    throw err("BAD_MANIFEST", "The site's start page is not on " + entry.pwa.origin);
                var icons = pwa.pickIcons(m);
                var want = [icons.small, icons.large].filter(Boolean);
                return Promise.all(want.map(function (i) { return getBytes(i.src, 4 * 1024 * 1024).then(null, function () { return null; }); })).then(function (got) {
                    progress({ state: "checking", progress: 50 });
                    var dir = ipkLib.APP_ROOT + entry.id + "/";
                    var files = [], names = {};
                    if (got[0]) {
                        names.icon = "icon." + pwa.extOf(icons.small.type, icons.small.src);
                        files.push({ path: dir + names.icon, data: got[0] });
                    } else if (entry.icon) {
                        names.icon = "icon.png";
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
            if (entry.kind === "ipk") {
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
    function osInstall(id, path, developer) {
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
        var progress = function (st) {
            ongoing(st);
            push(Object.assign({ returnValue: true, id: p.id }, st));
        };
        return findApp(s, p.sourceId, p.id).then(function (e) {
            entry = e;
            if (entry.verdict && !entry.verdict.ok) throw err("UNSUPPORTED", entry.verdict.text);
            if (entry.kind === "preware" && entry.architecture && entry.architecture !== "all")
                throw err("UNSUPPORTED", "Not for this device yet: " + nativeText(entry.architecture));
            return Promise.all([packageFor(s, entry, progress), devMode()]);
        }).then(function (got) {
            var bytes = got[0];
            return check(bytes, entry, got[1]).then(function (c) {
                appId = c.app.id;
                if (entry.kind !== "classic" && entry.kind !== "preware" && appId !== entry.id) throw err("BAD_PACKAGE", "The package holds another app");
                var owner = load().installed[appId];
                if (owner && owner.sourceId !== entry.sourceId)
                    throw err("UNSUPPORTED", "This app was installed from another catalog; remove it first");
                return Promise.resolve(deps.temp.write(appId + ".ipk", bytes)).then(function (where) {
                    path = where;
                    progress({ state: "installing", progress: 80 });
                    return osInstall(appId, path, c.developer);
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
                    push(done);
                    return done;
                });
            });
        }).then(null, function (e) {
            var r = errorReply(e);
            r.id = p.id;
            r.state = "failed";
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

    // Apps removed some other way (the launcher) are forgotten here too.
    function reconcile() {
        return deps.luna.call("luna://com.webos.applicationManager/listLaunchPoints", {}).then(function (r) {
            if (!r || !Array.isArray(r.launchPoints)) return;
            var present = {};
            r.launchPoints.forEach(function (lp) { present[lp.id] = true; });
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
            if (e && e.version && version.compare(e.version, inst.version) > 0) out.push({ id: id, entry: e });
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
                return { id: id, catalogId: i.catalogId || id, title: i.title, icon: i.icon, version: i.version, sourceId: i.sourceId,
                         kind: i.kind, installedAt: i.installedAt, update: ups[id] || null };
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
            return Promise.resolve({ returnValue: true, sources: load().sources.map(publicSource) });
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
            var s = load();
            return findApp(s, p && p.sourceId, p && p.id).then(function (e) {
                return { returnValue: true, app: withState(s, e) };
            }, errorReply);
        },
        install: install,
        remove: remove,
        listInstalled: listInstalled,
        updateAll: updateAll,
        scheduled: scheduled
    };
}

module.exports = { SERVICE: SERVICE, METHODS: METHODS, ACTIVITY: ACTIVITY, createPackagesService: createPackagesService };
