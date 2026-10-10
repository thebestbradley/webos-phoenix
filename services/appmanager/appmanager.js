// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.applicationManager on webOS OSE: the legacy application
// manager's API, which the original apps and Phoenix's call, over OSE's
// own (SAM, com.webos.applicationManager).
//
// OSE's SAM registers launch, close, closeByAppId, running, listApps,
// getAppInfo, getAppStatus, getAppBasePath, listLaunchPoints,
// addLaunchPoint, updateLaunchPoint, removeLaunchPoint and the app life
// events (webosose/sam src/bus/service/ApplicationManager.cpp:40-180), and
// nothing else: no open {target}, no resource or redirect handlers (their
// schema files are left in files/schema, their methods are gone), no dock
// mode. A link in Email (open {target: "http://..."}), a phone number in
// Contacts (tel:), an attachment Email opens (getResourceInfo), the
// browser's downloads (open a file by its type), Files' "Open with" all
// need them; and the name com.palm.applicationManager is free on OSE
// (SAM's names: files/sysbus/com.webos.sam.service.in). So Phoenix serves
// it, as the simulator's runtime does in the page (runtime/
// phoenix-runtime.js "Application manager", "Redirect handlers",
// "handlers by MIME type"), with the same tables:
//
//   launch {id, params}           SAM's launch, after Phoenix's app aliases
//                                 (com.palm.app.maps is Phoenix Maps, ...)
//   open {id?, target?, params?}  an app by id, or the app for a target: a
//                                 file by its type (the apps' appinfo.json
//                                 "mimeTypes", then Photos/Music), else the
//                                 redirect handler of a web address or
//                                 scheme (/usr/palm/command-resource-
//                                 handlers.json, http(s) to the browser, a
//                                 web app's site, those apps added) ->
//                                 launched with {target}; "No handler for
//                                 <target>" otherwise
//   listApps, getAppInfo, listLaunchPoints, searchApps, launchPointChanges,
//   running, close, addLaunchPoint, removeLaunchPoint: SAM's, in the
//                                 legacy shapes
//   getHandlerForMimeType, getResourceInfo, listAllHandlersForMime,
//   mimeTypeForExtension, getHandlerForExtension, getHandlerForUrl,
//   addResourceHandler, swapResourceHandler, removeHandlersForAppId,
//   listResourceHandlers, listExtensionMap, addRedirectHandler,
//   swapRedirectHandler, listAllHandlersForUrl, listAllHandlersForUrlPattern,
//   listRedirectHandlers          luna-sysmgr's MimeSystem, as the runtime has it
//   listDockModeLaunchPoints, addDockModeLaunchPoint,
//   removeDockModeLaunchPoint, setDockModeLaunchPoints, listDockPoints:
//                                 the exhibitions (appinfo.json
//                                 "exhibitionMode"), the user's in a file
//
// createAppManager({sam(method, params) -> Promise<reply>, readFile(path) ->
// string | null, registry: {load() -> obj | null, save(obj)}, now()}) ->
// {methods: {name: (params, caller) -> Promise<reply>}, watchLaunchPoints}
// STATUS: written against SAM's source and appmanager.test.ts; not yet run
// on a device.

"use strict";

var SERVICE = "com.palm.applicationManager";
var SAM = "com.webos.applicationManager";

// The runtime's (phoenix-runtime.js APP_ALIASES, HELP_TOPICS): apps the
// original apps launch by id that Phoenix replaces. appmanager.test.ts
// checks they are the runtime's.
var APP_ALIASES = {
    "com.palm.app.maps": "org.webosphoenix.maps",
    "com.palm.app.backup": { id: "org.webosphoenix.settings", params: { page: "backup" } },
    "com.palm.app.updates": { id: "org.webosphoenix.settings", params: { page: "updates" } },
    "com.palm.app.textassist": { id: "org.webosphoenix.settings", params: { page: "textassist" } },
    "com.palm.app.searchpreferences": { id: "org.webosphoenix.settings", params: { page: "justtype" } },
    "com.palm.app.certificate": { id: "org.webosphoenix.settings", params: { page: "certificates" } },
    "com.palm.app.help": "org.webosphoenix.help",
    "com.palm.app.photos": "org.webosphoenix.photos",
    "com.palm.app.agendaview": "org.webosphoenix.agenda",
    "com.palm.app.exhibitionpreferences": { id: "org.webosphoenix.settings", params: { page: "exhibition" } },
    "com.palm.app.devmodeswitcher": { id: "org.webosphoenix.settings", params: { page: "devmode" } },
    "com.palm.app.enyo-findapps": "org.webosphoenix.marketplace"
};
var HELP_TOPICS = { universalsearch: "justtype", accountsmgr: "accounts", phone: "phone", messaging: "messaging",
                    camera: "camera", photos: "photos", music: "music", launcher: "launcher", notifications: "notifications" };

// The runtime's file types (phoenix-runtime.js "File manager" MIME) and
// built-in handlers (HANDLERS).
var MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
             bmp: "image/bmp", svg: "image/svg+xml", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
             mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
             txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html",
             js: "text/javascript", css: "text/css", xml: "application/xml", pdf: "application/pdf",
             ipk: "application/vnd.webos.ipk", zip: "application/zip", mkv: "video/x-matroska", ogv: "video/ogg",
             m4v: "video/mp4", mov: "video/quicktime", srt: "application/x-subrip", vtt: "text/vtt",
             opml: "text/x-opml", epub: "application/epub+zip", markdown: "text/markdown", csv: "text/csv",
             docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
             eml: "message/rfc822", kdbx: "application/x-keepass2" };
var HANDLERS = [
    { prefix: "image/", appId: "org.webosphoenix.photos", title: "Photos" },
    { prefix: "video/", appId: "org.webosphoenix.photos", title: "Photos" },
    { prefix: "audio/", appId: "org.webosphoenix.music", title: "Music" },
    { prefix: "application/x-keepass2", appId: "org.webosphoenix.passwords", title: "Passwords" }
];
var BROWSER = "com.palm.app.browser";
var RESOURCE_HANDLERS = "/usr/palm/command-resource-handlers.json";
var DOCK_MODE_MAX_APPS = 3;
var DEFAULT_EXHIBITION_APPS = ["org.webosphoenix.photos"];
// What of each app's appinfo.json the tables need (SAM keeps it whole:
// AppDescription::getJson, src/base/AppDescription.cpp:240-265).
var APP_PROPERTIES = ["id", "title", "icon", "version", "folderPath", "type", "noWindow", "mimeTypes", "siteScope",
                      "exhibitionMode", "dockMode", "exhibitionModeTitle", "removable", "vendor", "visible"];
var APPS_TTL = 2000;

function ok(extra) {
    var r = { returnValue: true };
    for (var k in extra) r[k] = extra[k];
    return r;
}
function fail(code, text) { return { returnValue: false, errorCode: code, errorText: text }; }
// luna-sysmgr's MimeSystem answers: {subscribed: false, returnValue: false, errorCode: "<text>"}.
function legacyFail(text) { return { subscribed: false, returnValue: false, errorCode: text }; }

function aliasId(id) {
    var a = APP_ALIASES[id];
    return a ? (typeof a === "string" ? a : a.id) : id;
}
function aliasParams(id, params) {
    var a = APP_ALIASES[id], out = {};
    if (a && typeof a === "object") for (var k in a.params) out[k] = a.params[k];
    for (var j in params || {}) out[j] = params[j];
    if (id === "com.palm.app.help" && typeof out.target === "string") {
        var m = /^https?:\/\/help\.palm\.com\/([^\/]+)\//i.exec(out.target);
        delete out.target;
        if (m && HELP_TOPICS[m[1].toLowerCase()]) out.topic = HELP_TOPICS[m[1].toLowerCase()];
    }
    return out;
}
function schemeForm(pattern) { return /^\^[a-z][a-z0-9+.-]*\??:$/i.test(pattern); }
// The runtime's sitePattern: a web app's scope as its redirect pattern.
function sitePattern(scope) {
    var esc = function (x) { return x.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); };
    var m = /^https?:\/\/(?:www\.|m\.)?([^\/?#]+)(.*)$/i.exec(String(scope || ""));
    if (!m) return "";
    var path = m[2] || "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    var tail = path.charAt(path.length - 1) === "/" ? esc(path.slice(0, -1)) + "(?:[/?#]|$)" : esc(path);
    return "^https?://(?:www\\.|m\\.)?" + esc(m[1]) + "(?::\\d+)?" + tail;
}
function extOf(p) { var m = /[^.\/]\.([a-z0-9]+)$/i.exec(p || ""); return m ? m[1].toLowerCase() : ""; }
function typeMatches(pattern, mime) {
    if (!pattern || !mime) return false;
    return pattern === mime || (/\/\*$/.test(pattern) && mime.indexOf(pattern.slice(0, -1)) === 0);
}
function decode(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }

function createAppManager(opts) {
    var sam = function (method, params) {
        return Promise.resolve(opts.sam(method, params || {})).then(function (r) { return r || fail(-1, "No reply from SAM"); },
            function (e) { return fail(-1, String(e && e.message || e)); });
    };
    var now = opts.now || function () { return Date.now(); };
    var appsCache = null, appsAt = 0;

    // ---- The apps (SAM) --------------------------------------------------------------
    function apps() {
        if (appsCache && now() - appsAt < APPS_TTL) return Promise.resolve(appsCache);
        return sam("listApps", { properties: APP_PROPERTIES }).then(function (r) {
            var list = r.returnValue !== false && Array.isArray(r.apps) ? r.apps : [];
            appsCache = list.filter(function (a) { return a && typeof a.id === "string"; }).map(function (a) {
                var icon = String(a.icon || "");
                if (icon && icon.charAt(0) !== "/" && !/^[a-z]+:/i.test(icon) && a.folderPath)
                    icon = String(a.folderPath).replace(/\/$/, "") + "/" + icon;
                var out = {};
                for (var k in a) out[k] = a[k];
                out.icon = icon;
                out.title = a.title || a.id;
                return out;
            });
            appsAt = now();
            return appsCache;
        });
    }
    function forget() { appsCache = null; }
    function app(list, id) { return list.filter(function (a) { return a.id === id; })[0] || null; }

    // ---- The handler registry (MimeSystem's table, in a file) --------------------------
    function registry() {
        var r = (opts.registry && opts.registry.load()) || {};
        r.resources = Array.isArray(r.resources) ? r.resources : [];
        r.redirects = Array.isArray(r.redirects) ? r.redirects : [];
        r.activeResource = r.activeResource || {};
        r.activeRedirect = r.activeRedirect || {};
        r.exhibitionApps = Array.isArray(r.exhibitionApps) ? r.exhibitionApps : null;
        r.next = r.next || 1000;
        return r;
    }
    function save(r) { if (opts.registry) opts.registry.save(r); }

    var redirectFile = null;
    function redirectList() {
        if (!redirectFile) {
            try { redirectFile = JSON.parse(opts.readFile(RESOURCE_HANDLERS) || "{}").redirects || []; }
            catch (e) { redirectFile = []; }
        }
        return redirectFile;
    }

    // ---- Redirect handlers (web addresses and schemes) ----------------------------------
    function urlHandlers(list) {
        var reg = registry(), out = [], i = 0;
        redirectList().forEach(function (h) {
            out.push({ url: h.url, appId: h.appId, index: ++i, tag: "system-default", schemeForm: h.schemeForm !== undefined ? !!h.schemeForm : schemeForm(h.url) });
        });
        out.push({ url: "^https?:", appId: BROWSER, index: ++i, tag: "system-default", schemeForm: true });
        list.filter(function (a) { return a.siteScope; })
            .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })
            .forEach(function (a, k) {
                var pattern = sitePattern(a.siteScope);
                if (pattern) out.push({ url: pattern, appId: a.id, index: 2000 + k, tag: "user", schemeForm: false });
            });
        reg.redirects.forEach(function (h) { out.push(Object.assign({ tag: "user" }, h)); });
        return out;
    }
    function urlMatches(list, url) {
        var reg = registry(), groups = {}, order = [];
        urlHandlers(list).forEach(function (h) {
            var re;
            try { re = new RegExp(h.url, "i"); } catch (e) { return; }
            if (!re.test(url)) return;
            if (!groups[h.url]) { groups[h.url] = []; order.push(h.url); }
            groups[h.url].push(h);
        });
        // Web address patterns before whole schemes (ApplicationManagerService.cpp:1320, :1428).
        order = order.filter(function (u) { return !groups[u][0].schemeForm; })
            .concat(order.filter(function (u) { return groups[u][0].schemeForm; }));
        return order.map(function (pattern) {
            var hs = groups[pattern], active = reg.activeRedirect[pattern];
            var a = hs.filter(function (h) { return h.index === active; })[0] || hs[0];
            return { pattern: pattern, active: a, alternates: hs.filter(function (h) { return h !== a; }) };
        });
    }
    function withName(list, h) {
        var a = app(list, h.appId);
        return Object.assign({}, h, { appName: a ? a.title : h.appId });
    }

    // ---- Resource handlers (file types) ---------------------------------------------------
    function registeredTypes(list) {
        var out = [];
        list.forEach(function (a) {
            if (!Array.isArray(a.mimeTypes)) return;
            a.mimeTypes.forEach(function (m) {
                if (m && (m.mime || m.extension))
                    out.push({ appId: a.id, title: a.title, mime: String(m.mime || "").toLowerCase(),
                               extension: String(m.extension || "").toLowerCase(), stream: !!m.stream });
            });
        });
        return out;
    }
    function resourceTable(list) {
        var out = [], i = 0;
        registeredTypes(list).forEach(function (r) {
            out.push({ appId: r.appId, title: r.title, mime: r.mime, extension: r.extension, stream: r.stream, index: ++i, tag: "system-default" });
        });
        HANDLERS.forEach(function (h) {
            if (app(list, h.appId))
                out.push({ appId: h.appId, title: h.title, mime: h.prefix, prefix: true, extension: "", index: ++i, tag: "system-default" });
        });
        registry().resources.forEach(function (r) {
            var a = app(list, r.appId);
            if (a) out.push({ appId: r.appId, title: a.title, mime: r.mime, extension: r.extension || "", stream: !r.shouldDownload,
                              shouldDownload: !!r.shouldDownload, index: r.index, tag: "user" });
        });
        return out;
    }
    function handlersFor(list, mime, ext) {
        mime = String(mime || "").toLowerCase();
        ext = String(ext || "").toLowerCase();
        var seen = {}, out = [];
        resourceTable(list).forEach(function (r) {
            var hit = r.prefix ? mime.indexOf(r.mime) === 0 : (typeMatches(r.mime, mime) || (ext && r.extension === ext));
            if (!hit || seen[r.appId]) return;
            seen[r.appId] = true;
            out.push({ appId: r.appId, title: r.title, mime: mime, index: r.index, tag: r.tag, stream: !!r.stream });
        });
        var active = registry().activeResource[mime];
        var a = out.filter(function (h) { return h.index === active; })[0];
        if (a) out = [a].concat(out.filter(function (h) { return h !== a; }));
        return out;
    }
    function mimeFor(list, ext) {
        return MIME[ext] || (resourceTable(list).filter(function (r) { return r.extension === ext && r.mime && !r.prefix; })[0] || {}).mime || "";
    }
    // A file path, file:// uri or web address -> the first app that opens it.
    function handlerForTarget(list, target) {
        var t = String(target || "");
        var web = /^https?:\/\//i.test(t);
        var path = decode(web ? t.replace(/[?#].*$/, "") : t.replace(/^file:\/\//, ""));
        var ext = extOf(path);
        if (!ext) return null;
        if (web) {
            // Only apps that asked for this extension take a web address.
            var r = registeredTypes(list).filter(function (x) { return x.extension === ext; })[0];
            return r ? r.appId : null;
        }
        if (!/^(file:\/\/)?\//.test(t)) return null;
        var h = handlersFor(list, mimeFor(list, ext) || "application/octet-stream", ext)[0];
        return h ? h.appId : null;
    }
    function asResource(list, h, mime) {
        var a = app(list, h.appId);
        return { mime: mime, extension: h.extension || "", appId: h.appId, streamable: !!h.stream, index: h.index,
                 tag: h.tag || "system-default", appName: a ? a.title : h.title || h.appId };
    }

    // ---- Exhibitions ------------------------------------------------------------------
    function exhibitionApps() {
        var l = registry().exhibitionApps;
        return l ? l : DEFAULT_EXHIBITION_APPS.slice();
    }
    function setExhibitionApps(l) {
        var r = registry();
        r.exhibitionApps = l;
        save(r);
        dockWatchers.slice().forEach(function (w) { w(); });
    }
    var dockWatchers = [];
    function dockModeLaunchPoints(list) {
        var on = exhibitionApps();
        return list.filter(function (a) { return a.exhibitionMode === true || a.dockMode === true; }).map(function (a) {
            return { id: a.id, appId: a.id, launchPointId: a.id + "_default", title: a.title, icon: a.icon,
                     exhibitionModeTitle: a.exhibitionModeTitle || a.title, enabled: on.indexOf(a.id) >= 0 };
        });
    }

    // ---- Launching ------------------------------------------------------------------------
    // An app without a window of its own (appinfo.json "noWindow": the
    // Calendar's and Email's background halves, luna-systemui) runs
    // hidden: SAM passes "preload" to WebAppMgr, which then keeps its
    // window hidden (sam src/base/RunningApp.h:194, src/bus/client/WAM.cpp:
    // 207-209; wam src/core/web_app_base.cc:309-328 SetPreloadState). WebAppMgr
    // itself has no noWindow.
    function launch(id, params) {
        return apps().then(function (list) {
            var a = app(list, id);
            var req = { id: id, params: params || {} };
            if (a && a.noWindow === true) req.preload = "partial";
            return sam("launch", req);
        }).then(function (r) {
            if (r.returnValue === false) return r;
            // The legacy reply: {processId}; SAM's names the instance.
            return ok({ processId: String(r.processId || r.instanceId || r.appId || id) });
        });
    }

    var methods = {
        launch: function (p) {
            if (typeof p.id !== "string" || !p.id) return Promise.resolve(fail(-1, "Must provide an app id"));
            return launch(aliasId(p.id), aliasParams(p.id, p.params));
        },
        open: function (p) {
            if (typeof p.id === "string" && p.id) return launch(aliasId(p.id), aliasParams(p.id, p.params));
            if (typeof p.target !== "string" || !p.target) return Promise.resolve(fail(-1, "Must provide an id or a target"));
            return apps().then(function (list) {
                var handler = handlerForTarget(list, p.target);
                if (!handler) {
                    var m = urlMatches(list, p.target)[0];
                    handler = m ? m.active.appId : null;
                }
                if (!handler) return fail(-1, "No handler for " + p.target);
                return launch(aliasId(handler), aliasParams(handler, { target: p.target }));
            });
        },
        listApps: function () {
            forget();
            return apps().then(function (list) { return ok({ apps: list.filter(function (a) { return a.visible !== false; }) }); });
        },
        getAppInfo: function (p) {
            var id = String(p.appId || p.id || "");
            return sam("getAppInfo", { id: id }).then(function (r) {
                if (r.returnValue === false || !r.appInfo) return fail(-1, "app not found");
                return ok({ appInfo: r.appInfo });
            });
        },
        listLaunchPoints: function () {
            return sam("listLaunchPoints", {}).then(function (r) {
                return r.returnValue === false ? r : ok({ launchPoints: Array.isArray(r.launchPoints) ? r.launchPoints : [] });
            });
        },
        // Launch points whose title has a word starting with the keyword.
        searchApps: function (p) {
            var k = String(p.keyword || "").toLowerCase();
            if (!k) return Promise.resolve(ok({ apps: [] }));
            return sam("listLaunchPoints", {}).then(function (r) {
                var lps = Array.isArray(r.launchPoints) ? r.launchPoints : [];
                return ok({ apps: lps.filter(function (lp) {
                    return (" " + String(lp.title || "").toLowerCase()).indexOf(" " + k) >= 0;
                }).map(function (lp) { return { launchPoint: lp.launchPointId }; }) });
            });
        },
        running: function () {
            return sam("running", {}).then(function (r) {
                if (r.returnValue === false) return r;
                return ok({ running: (Array.isArray(r.running) ? r.running : []).map(function (a) {
                    return { id: a.id, processid: String(a.processid || a.instanceId || a.id) };
                }) });
            });
        },
        // close {processId}: the app running with that process (or id).
        close: function (p) {
            if (typeof p.processId !== "string" || !p.processId) return Promise.resolve(fail(-1, "Must provide a valid processId to close"));
            return sam("running", {}).then(function (r) {
                var a = (Array.isArray(r.running) ? r.running : []).filter(function (x) {
                    return String(x.processid) === p.processId || x.instanceId === p.processId || x.id === p.processId;
                })[0];
                if (!a) return ok();
                return sam("closeByAppId", { id: a.id }).then(function () { return ok(); });
            });
        },
        addLaunchPoint: function (p) {
            var id = typeof p.id === "string" ? p.id : "";
            if (!id || typeof p.title !== "string" || !p.title) return Promise.resolve(fail(-1, "Invalid arguments"));
            var params = p.params;
            if (typeof params === "string") {
                try { params = params ? JSON.parse(params) : {}; } catch (e) { return Promise.resolve(fail(-1, "Invalid arguments")); }
            }
            var req = { id: id, title: p.title, params: params || {} };
            if (typeof p.icon === "string" && p.icon) req.icon = p.icon;
            return sam("addLaunchPoint", req).then(function (r) {
                return r.returnValue === false ? fail(-1, r.errorText || "Failed to save launch point") : ok({ launchPointId: r.launchPointId });
            });
        },
        removeLaunchPoint: function (p) {
            if (typeof p.launchPointId !== "string" || !p.launchPointId) return Promise.resolve(fail(-1, "Must provide a launchPointId"));
            return sam("removeLaunchPoint", { launchPointId: p.launchPointId }).then(function (r) {
                return r.returnValue === false ? fail(-1, r.errorText || "launch point [" + p.launchPointId + "] not found") : ok();
            });
        },
        getSizeOfApps: function (p) {
            if (!Array.isArray(p.appIds)) return Promise.resolve({ subscribed: false, returnValue: false, errorCode: "Missing appIds parameter" });
            var r = { subscribed: false, returnValue: true };
            p.appIds.forEach(function (id) { r[String(id)] = 0; });
            return Promise.resolve(r);
        },
        listPendingLaunchPoints: function () { return Promise.resolve(ok({ launchPoints: [] })); },
        listDockPoints: function () { return Promise.resolve(ok({ dockPoints: [] })); },

        // ---- Handlers by type -------------------------------------------------
        getHandlerForMimeType: function (p) {
            return apps().then(function (list) {
                var h = handlersFor(list, p.mimeType || p.mime)[0];
                return h ? ok({ appId: h.appId, mimeType: p.mimeType || p.mime }) : fail(-1, "no handler");
            });
        },
        getResourceInfo: function (p) {
            return apps().then(function (list) {
                var uri = String(p.uri || "");
                var path = decode(uri.replace(/^file:\/\//, "").replace(/[?#].*$/, ""));
                var ext = extOf(path);
                var mime = MIME[ext] || p.mime || "application/octet-stream";
                var h = handlersFor(list, mime, ext)[0] || (p.mime ? handlersFor(list, p.mime)[0] : null);
                if (!h) return fail(-1, "No handler for " + mime);
                var streams = registeredTypes(list).some(function (r) {
                    return r.appId === h.appId && r.stream && (r.extension === ext || typeMatches(r.mime, mime));
                });
                return ok({ uri: uri, appIdByExtension: h.appId, mimeByExtension: mime, canStream: streams && /^https?:/i.test(uri) });
            });
        },
        listAllHandlersForMime: function (p) {
            return apps().then(function (list) {
                var mime = String(p.mime || p.mimeType || "").toLowerCase();
                var hs = handlersFor(list, mime);
                var r = ok({ subscribed: false, mime: p.mime, resources: hs });
                if (hs.length) {
                    r.resourceHandlers = { activeHandler: asResource(list, hs[0], mime) };
                    if (hs.length > 1) r.resourceHandlers.alternates = hs.slice(1).map(function (h) { return asResource(list, h, mime); });
                }
                return r;
            });
        },
        mimeTypeForExtension: function (p) {
            return apps().then(function (list) {
                var ext = String(p.extension || "").replace(/^\./, "").toLowerCase();
                var mime = mimeFor(list, ext);
                return mime ? { subscribed: false, returnValue: true, mimeType: mime, extension: ext }
                            : legacyFail("No mime mapped to this extension");
            });
        },
        getHandlerForExtension: function (p) {
            return apps().then(function (list) {
                var ext = String(p.extension || "").replace(/^\./, "").toLowerCase();
                var mime = mimeFor(list, ext);
                if (!mime) return legacyFail("No mime type mapped to extension " + ext);
                var h = handlersFor(list, mime, ext)[0];
                return h ? { subscribed: false, returnValue: true, mimeType: mime, appId: h.appId, download: !h.stream }
                         : legacyFail("No handler found for extension " + ext);
            });
        },
        getHandlerForUrl: function (p) {
            return apps().then(function (list) {
                var url = String(p.url || "");
                var path = url.replace(/^file:\/\//, "").replace(/[?#].*$/, "");
                var ext = extOf(path);
                var typed = ext && (!/^https?:/i.test(url) || registeredTypes(list).some(function (r) { return r.extension === ext; }));
                if (typed) {
                    var mime = mimeFor(list, ext) || "application/octet-stream", h = handlersFor(list, mime, ext)[0];
                    if (h) return { subscribed: false, returnValue: true, mimeType: mime, appId: h.appId, download: !/^https?:/i.test(url) || !h.stream };
                }
                var m = urlMatches(list, url)[0];
                return m ? { subscribed: false, returnValue: true, appId: m.active.appId, download: false }
                         : legacyFail("No handler found for url [" + url + "]");
            });
        },
        addResourceHandler: function (p) {
            if (typeof p.appId !== "string" || !p.appId) return Promise.resolve(legacyFail("Missing appId parameter"));
            var mime = String(p.mimeType || "").toLowerCase(), ext = String(p.extension || "").replace(/^\./, "").toLowerCase();
            if (!mime && !ext) return Promise.resolve(legacyFail("Neither extension or mime type provided"));
            return apps().then(function (list) {
                if (!mime) {
                    mime = MIME[ext] || "";
                    if (!mime) return legacyFail("Cannot find mime type for extension [" + ext + "]");
                }
                if (!app(list, p.appId)) return legacyFail("adding handler failed");
                var reg = registry();
                if (!reg.resources.some(function (r) { return r.appId === p.appId && r.mime === mime && (r.extension || "") === ext; })) {
                    reg.resources.push({ appId: p.appId, mime: mime, extension: ext, shouldDownload: !!p.shouldDownload, index: reg.next++ });
                    save(reg);
                }
                return { subscribed: false, returnValue: true };
            });
        },
        swapResourceHandler: function (p) {
            return apps().then(function (list) {
                var mime = String(p.mimeType || "").toLowerCase(), index = Number(p.index);
                if (!handlersFor(list, mime).some(function (h) { return h.index === index; }))
                    return legacyFail("swap failed (incorrect index for mime type, perhaps?)");
                var reg = registry();
                reg.activeResource[mime] = index;
                save(reg);
                return { subscribed: false, returnValue: true };
            });
        },
        removeHandlersForAppId: function (p) {
            if (typeof p.appId !== "string" || !p.appId) return Promise.resolve(legacyFail("Missing appId parameter"));
            var reg = registry();
            reg.resources = reg.resources.filter(function (r) { return r.appId !== p.appId; });
            reg.redirects = reg.redirects.filter(function (r) { return r.appId !== p.appId; });
            save(reg);
            return Promise.resolve({ subscribed: false, returnValue: true });
        },
        listResourceHandlers: function () {
            return apps().then(function (list) {
                return ok({ resourceHandlers: resourceTable(list).map(function (r) { return asResource(list, r, r.mime); }) });
            });
        },
        listExtensionMap: function () {
            return apps().then(function (list) {
                var map = {};
                Object.keys(MIME).forEach(function (e) { map[e] = MIME[e]; });
                resourceTable(list).forEach(function (r) { if (r.extension && r.mime && !map[r.extension]) map[r.extension] = r.mime; });
                return ok({ extensionMap: map });
            });
        },

        // ---- Redirect handlers ----------------------------------------------------
        addRedirectHandler: function (p) {
            if (typeof p.appId !== "string" || !p.appId) return Promise.resolve(legacyFail("Missing appId parameter"));
            if (typeof p.urlPattern !== "string" || !p.urlPattern) return Promise.resolve(legacyFail("Missing urlPattern parameter"));
            if (p.schemeForm !== undefined && typeof p.schemeForm !== "boolean")
                return Promise.resolve(legacyFail("schemeForm parameter incorrectly specified (should be a boolean value)"));
            try { new RegExp(p.urlPattern); } catch (e) { return Promise.resolve(legacyFail("adding handler failed")); }
            return apps().then(function (list) {
                if (!app(list, p.appId)) return legacyFail("adding handler failed");
                var reg = registry();
                if (!reg.redirects.some(function (h) { return h.appId === p.appId && h.url === p.urlPattern; })) {
                    reg.redirects.push({ url: p.urlPattern, appId: p.appId, schemeForm: !!p.schemeForm, index: reg.next++ });
                    save(reg);
                }
                return { subscribed: false, returnValue: true };
            });
        },
        swapRedirectHandler: function (p) {
            return apps().then(function (list) {
                var pattern = String(p.url || ""), index = Number(p.index);
                var h = urlHandlers(list).filter(function (x) { return x.url === pattern && x.index === index; })[0];
                if (!h) return legacyFail("swap failed (incorrect index for url, perhaps?)");
                var reg = registry();
                reg.activeRedirect[pattern] = index;
                save(reg);
                return { subscribed: false, returnValue: true };
            });
        },
        listAllHandlersForUrl: function (p) {
            return apps().then(function (list) {
                var url = String(p.url || ""), m = urlMatches(list, url)[0];
                if (!m) return { subscribed: false, url: url, returnValue: false, errorCode: "No handlers found for " + url };
                var r = { activeHandler: withName(list, m.active) };
                if (m.alternates.length) r.alternates = m.alternates.map(function (h) { return withName(list, h); });
                return { subscribed: false, url: url, returnValue: true, redirectHandlers: r };
            });
        },
        listAllHandlersForUrlPattern: function (p) {
            return apps().then(function (list) {
                var pattern = String(p.urlPattern || p.url || "");
                var hs = urlHandlers(list).filter(function (h) { return h.url === pattern; });
                if (!hs.length) return legacyFail("No handlers found for " + pattern);
                var reg = registry(), active = hs.filter(function (h) { return h.index === reg.activeRedirect[pattern]; })[0] || hs[0];
                var r = { activeHandler: withName(list, active) };
                var alt = hs.filter(function (h) { return h !== active; });
                if (alt.length) r.alternates = alt.map(function (h) { return withName(list, h); });
                return { subscribed: false, urlPattern: pattern, returnValue: true, redirectHandlers: r };
            });
        },
        listRedirectHandlers: function () {
            return apps().then(function (list) {
                return ok({ redirectHandlers: urlHandlers(list).map(function (h) { return withName(list, h); }) });
            });
        },

        // ---- Exhibitions (dock mode) ------------------------------------------------
        listDockModeLaunchPoints: function () {
            return apps().then(function (list) { return ok({ launchPoints: dockModeLaunchPoints(list), maxApps: DOCK_MODE_MAX_APPS }); });
        },
        addDockModeLaunchPoint: function (p) {
            return apps().then(function (list) {
                var id = aliasId(String(p.appId || "")), on = exhibitionApps();
                if (!dockModeLaunchPoints(list).some(function (lp) { return lp.id === id; })) return fail(-1, "Not an exhibition app: " + id);
                if (on.indexOf(id) < 0 && on.length >= DOCK_MODE_MAX_APPS) return fail(-2, "At most " + DOCK_MODE_MAX_APPS + " exhibition apps can be on");
                setExhibitionApps(on.filter(function (a) { return a !== id; }).concat([id]));
                return ok();
            });
        },
        removeDockModeLaunchPoint: function (p) {
            var id = aliasId(String(p.appId || ""));
            setExhibitionApps(exhibitionApps().filter(function (a) { return a !== id; }));
            return Promise.resolve(ok());
        },
        setDockModeLaunchPoints: function (p) {
            return apps().then(function (list) {
                var ids = (Array.isArray(p.appIds) ? p.appIds : []).map(function (a) { return aliasId(String(a)); });
                var known = dockModeLaunchPoints(list).map(function (lp) { return lp.id; });
                var bad = ids.filter(function (a) { return known.indexOf(a) < 0; });
                if (bad.length) return fail(-1, "Not an exhibition app: " + bad[0]);
                if (ids.length > DOCK_MODE_MAX_APPS) return fail(-2, "At most " + DOCK_MODE_MAX_APPS + " exhibition apps can be on");
                setExhibitionApps(ids.filter(function (a, i) { return ids.indexOf(a) === i; }));
                return ok();
            });
        }
    };

    // Subscriptions: listDockModeLaunchPoints {subscribe} hears each change.
    function watchDockMode(send) {
        var w = function () { methods.listDockModeLaunchPoints({}).then(send); };
        dockWatchers.push(w);
        return function () { dockWatchers = dockWatchers.filter(function (x) { return x !== w; }); };
    }

    return { methods: methods, watchDockMode: watchDockMode, forgetApps: forget, handlerForTarget: function (t) {
        return apps().then(function (list) { return handlerForTarget(list, t); });
    } };
}

var METHODS = ["launch", "open", "listApps", "getAppInfo", "listLaunchPoints", "searchApps", "running", "close",
               "addLaunchPoint", "removeLaunchPoint", "getSizeOfApps", "listPendingLaunchPoints", "listDockPoints",
               "getHandlerForMimeType", "getResourceInfo", "listAllHandlersForMime", "mimeTypeForExtension",
               "getHandlerForExtension", "getHandlerForUrl", "addResourceHandler", "swapResourceHandler",
               "removeHandlersForAppId", "listResourceHandlers", "listExtensionMap", "addRedirectHandler",
               "swapRedirectHandler", "listAllHandlersForUrl", "listAllHandlersForUrlPattern", "listRedirectHandlers",
               "listDockModeLaunchPoints", "addDockModeLaunchPoint", "removeDockModeLaunchPoint", "setDockModeLaunchPoints"];

module.exports = { createAppManager: createAppManager, METHODS: METHODS, SERVICE: SERVICE, SAM: SAM,
                   APP_ALIASES: APP_ALIASES, HELP_TOPICS: HELP_TOPICS, MIME: MIME, HANDLERS: HANDLERS,
                   sitePattern: sitePattern, APP_PROPERTIES: APP_PROPERTIES };
