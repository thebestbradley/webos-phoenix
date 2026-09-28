// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-runtime.js: the webOS app runtime for web apps outside a device.
//
// Legacy webOS web apps (Mojo, Enyo 1.0) and new Phoenix apps talk to the
// system through two globals that the device's web runtime provides:
//
//   PalmSystem          app/window info and system calls (locale, launch
//                       params, banners, orientation, ...)
//   PalmServiceBridge   asynchronous calls on the Luna service bus
//
// On a webOS OSE device WebAppMgr provides both and this file only installs
// small compatibility aliases. In phoenix-sim and in a desktop browser it
// provides them itself, backed by in-page mock services (db8, system
// service, application manager, ...) that persist in localStorage. All apps
// are served from one origin, so they share that data like apps on a device
// share the system database.
//
// It must run before the app's own scripts: phoenix-sim injects it at
// document creation; the browser dev server (tools/serve-rootfs.py) inserts
// it at the top of every app's index.html.
//
// Messages for the shell (launch another app, show a banner, ...) are
// posted through window.phoenixHost. phoenix-sim picks them up from the
// console with the "__phoenix__" prefix; other hosts can replace postToHost.

(function (global) {
    "use strict";

    if (global.__phoenixRuntime)
        return;

    var runtime = global.__phoenixRuntime = {
        version: "0.1.0",
        onDevice: typeof global.PalmServiceBridge === "function" && !!global.PalmSystem,
        services: {},
        log: []
    };

    // ---- Host messaging --------------------------------------------------------

    var host = global.phoenixHost = global.phoenixHost || {
        postToHost: function (type, payload) {
            try {
                console.info("__phoenix__" + JSON.stringify({ type: type, payload: payload || {} }));
            } catch (e) { /* ignore */ }
        }
    };

    // ---- App identity ------------------------------------------------------------

    function appIdFromLocation() {
        var m = /\/usr\/palm\/applications\/([^\/]+)\//.exec(global.location.pathname);
        return m ? m[1] : "com.webos.phoenix.unknown";
    }

    function queryParam(name) {
        var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(global.location.search);
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ---- Storage ------------------------------------------------------------------

    var store = (function () {
        var mem = {};
        var ls = null;
        try {
            ls = global.localStorage;
            ls.setItem("__phoenix_probe", "1");
            ls.removeItem("__phoenix_probe");
        } catch (e) {
            ls = null;
        }
        return {
            get: function (key, fallback) {
                try {
                    var v = ls ? ls.getItem("phoenix:" + key) : mem[key];
                    return v === null || v === undefined ? fallback : JSON.parse(v);
                } catch (e) {
                    return fallback;
                }
            },
            set: function (key, value) {
                var s = JSON.stringify(value);
                if (ls) ls.setItem("phoenix:" + key, s);
                else mem[key] = s;
            }
        };
    })();

    // ---- Device compatibility -------------------------------------------------------

    // Legacy service names that webOS OSE serves under a different name,
    // checked against the services' sysbus files (webosose/luna-sysservice,
    // webosose/sam). db8 still registers com.palm.db and com.palm.tempdb.
    // Only the name changes here; methods whose parameters differ on OSE
    // need per-method adapters (docs/APP-RUNTIME.md).
    var serviceAliases = {
        "com.palm.systemservice": "com.webos.service.systemservice",
        "com.palm.connectionmanager": "com.webos.service.connectionmanager",
        "com.palm.applicationManager": "com.webos.applicationManager"
    };

    function aliasUrl(url) {
        var m = /^(palm|luna):\/\/([^\/]+)(\/.*)?$/.exec(url);
        if (!m || !serviceAliases[m[2]])
            return url;
        return m[1] + "://" + serviceAliases[m[2]] + (m[3] || "/");
    }

    if (runtime.onDevice) {
        var NativeBridge = global.PalmServiceBridge;
        global.PalmServiceBridge = function () {
            var b = new NativeBridge();
            var self = this;
            b.onservicecallback = function (json) {
                if (self.onservicecallback) self.onservicecallback(json);
            };
            this.call = function (url, json) { return b.call(aliasUrl(url), json); };
            this.cancel = function () { return b.cancel(); };
        };
        return;
    }

    // ================================================================================
    // Everything below runs only off-device.
    // ================================================================================

    // ---- PalmSystem -----------------------------------------------------------------

    var launchParams = queryParam("launchParams") || "{}";
    var activated = true;

    var PalmSystem = {
        identifier: appIdFromLocation() + " 1000",
        appIdentifier: appIdFromLocation(),
        activityId: 1000,
        launchParams: launchParams,
        locale: store.get("prefs", {}).locale || "en_us",
        localeRegion: "us",
        phoneRegion: "us",
        timeFormat: store.get("prefs", {}).timeFormat || "HH12",
        TZ: (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
        screenOrientation: "up",
        windowOrientation: "up",
        specifiedWindowOrientation: "free",
        videoOrientation: "up",
        deviceInfo: JSON.stringify({
            modelName: "Phoenix Simulator",
            modelNameAscii: "Phoenix Simulator",
            platformVersion: "3.0.5",
            platformVersionMajor: 3,
            platformVersionMinor: 0,
            platformVersionDot: 5,
            carrierName: "Phoenix",
            serialNumber: "PHOENIX0001",
            screenWidth: global.screen ? global.screen.width : 320,
            screenHeight: global.screen ? global.screen.height : 480,
            minimumCardWidth: 320,
            minimumCardHeight: 188,
            maximumCardWidth: 320,
            maximumCardHeight: 452,
            keyboardAvailable: true,
            keyboardSlider: false,
            keyboardType: "QWERTY",
            wifiAvailable: true,
            bluetoothAvailable: true,
            coreNaviButton: false
        }),
        isActivated: function () { return activated; },
        get isMinimal() { return false; },

        stageReady: function () { host.postToHost("stageReady", { appId: PalmSystem.appIdentifier }); },
        activate: function () { activated = true; host.postToHost("activate", { appId: PalmSystem.appIdentifier }); },
        deactivate: function () { activated = false; },
        hide: function () {},
        show: function () {},
        setWindowOrientation: function (o) { PalmSystem.specifiedWindowOrientation = o; },
        setWindowProperties: function () {},
        enableFullScreenMode: function (on) { host.postToHost("fullScreen", { appId: PalmSystem.appIdentifier, on: !!on }); },
        allowResizeOnPositiveSpaceChange: function () {},
        receivePageUpDownInLandscape: function () {},
        setManualKeyboardEnabled: function () {},
        keyboardShow: function () {},
        keyboardHide: function () {},
        editorFocused: function () {},
        paste: function () {},
        copiedToClipboard: function () {},
        pastedFromClipboard: function () {},
        printFrame: function () { global.print && global.print(); },
        simulateMouseClick: function () {},
        useSimulatedMouseClicks: function () {},
        runTextIndexer: function (text) { return text; },
        playSoundNotification: function () {},
        setAlertSound: function () {},
        receiveKeyEvents: function () {},

        addBannerMessage: function (msg, params, icon) {
            var id = "b" + Date.now();
            host.postToHost("banner", { id: id, appId: PalmSystem.appIdentifier, message: msg, params: params, icon: icon });
            return id;
        },
        removeBannerMessage: function (id) { host.postToHost("removeBanner", { id: id }); },
        clearBannerMessages: function () {},
        addNewContentIndicator: function () { return "nci"; },
        removeNewContentIndicator: function () {},
        addActiveCallBanner: function () {},
        removeActiveCallBanner: function () {},
        updateActiveCallBanner: function () {},

        // Synchronous file read. Returns undefined for missing files, which
        // MojoLoader relies on (e.g. to fall back from concatenated.js to the
        // individual sources listed in a framework's manifest).
        getResource: function (path) {
            try {
                var req = new XMLHttpRequest();
                req.open("GET", path, false);
                req.send(null);
                return req.status >= 200 && req.status < 300 ? req.responseText : undefined;
            } catch (e) {
                // Custom schemes (phoenix-sim) report a missing file by throwing.
                return undefined;
            }
        },
        getIdentifierForFrame: function () { return PalmSystem.identifier; },
        getLocalizedString: function (s) { return s; }
    };

    global.PalmSystem = PalmSystem;
    global.palmGetResource = function (path) { return PalmSystem.getResource(path); };

    // ---- Service bus -------------------------------------------------------------------

    function ok(extra) {
        var r = { returnValue: true };
        for (var k in extra) r[k] = extra[k];
        return r;
    }

    function fail(code, text) {
        return { returnValue: false, errorCode: code, errorText: text };
    }

    // services["com.palm.db"]["/find"] = function (params, reply, ctx) { ... }
    // reply(response) may be called more than once for subscriptions.
    function register(names, methods) {
        names.forEach(function (n) { runtime.services[n] = methods; });
    }
    runtime.register = register;

    var reported = {};

    function dispatch(url, params, reply, ctx) {
        var m = /^(?:palm|luna):\/\/([^\/]+)(\/.*)$/.exec(url);
        if (!m) {
            reply(fail(-1, "Bad service URL: " + url));
            return;
        }
        var service = runtime.services[m[1]];
        var method = m[2].replace(/\/+$/, "") || "/";
        var fn = service && (service[method] || service["*"]);
        if (!fn) {
            if (!reported[url]) {
                reported[url] = true;
                console.warn("[phoenix-runtime] no simulator implementation for " + url);
            }
            reply(fail(-1, "Service not available in the Phoenix simulator: " + url));
            return;
        }
        try {
            fn(params || {}, reply, ctx, method);
        } catch (e) {
            console.error("[phoenix-runtime] " + url + " threw", e);
            reply(fail(-1, String(e && e.message || e)));
        }
    }
    runtime.dispatch = dispatch;

    global.PalmServiceBridge = function () {
        var bridge = this;
        var cancelled = false;
        var ctx = { cancelled: function () { return cancelled; }, onCancel: null };
        this.onservicecallback = null;
        this.call = function (url, json) {
            var params = {};
            try { params = json ? JSON.parse(json) : {}; } catch (e) { params = {}; }
            // Responses are always asynchronous, as on a device.
            setTimeout(function () {
                dispatch(url, params, function (response) {
                    if (cancelled || !bridge.onservicecallback)
                        return;
                    bridge.onservicecallback(JSON.stringify(response));
                }, ctx);
            }, 0);
            return 1;
        };
        this.cancel = function () {
            cancelled = true;
            if (ctx.onCancel) ctx.onCancel();
        };
    };

    // ---- db8 (com.palm.db / com.palm.tempdb) ------------------------------------------

    // A small in-page db8: kinds, put/get/merge/del, find with where/orderBy/
    // limit/select, counts and watches. Enough for the core apps to store and
    // read their data; not a complete implementation of db8's query language.
    function makeDb(name) {
        var key = "db8:" + name;
        var watchers = [];

        function load() { return store.get(key, { objects: {}, kinds: {}, rev: 1, nextId: 1 }); }
        function save(db) { store.set(key, db); }

        function newId(db) {
            return (name === "com.palm.tempdb" ? "t" : "") + "++" + (db.nextId++).toString(36) + Date.now().toString(36);
        }

        function getPath(obj, path) {
            var parts = String(path).split(".");
            var v = obj;
            for (var i = 0; i < parts.length && v !== undefined && v !== null; ++i)
                v = v[parts[i]];
            return v;
        }

        function matchClause(obj, c) {
            var v = getPath(obj, c.prop);
            var target = c.val;
            var vals = Array.isArray(v) ? v : [v];
            var targets = Array.isArray(target) ? target : [target];
            return vals.some(function (x) {
                return targets.some(function (t) {
                    switch (c.op) {
                    case "=": return x === t;
                    case "!=": return x !== t;
                    case "<": return x < t;
                    case "<=": return x <= t;
                    case ">": return x > t;
                    case ">=": return x >= t;
                    case "%": return typeof x === "string" && x.toLowerCase().indexOf(String(t).toLowerCase()) === 0;
                    case "?": return typeof x === "string" && x.toLowerCase().indexOf(String(t).toLowerCase()) >= 0;
                    default: return false;
                    }
                });
            });
        }

        function isOfKind(db, obj, kind) {
            if (!kind) return true;
            if (obj._kind === kind) return true;
            // Kinds may extend others (e.g. "com.palm.contact.palmprofile:1" extends "com.palm.person:1").
            var k = db.kinds[obj._kind];
            var seen = {};
            while (k && k.extends && !seen[obj._kind]) {
                seen[obj._kind] = true;
                if (k.extends.indexOf(kind) >= 0) return true;
                k = db.kinds[k.extends[0]];
            }
            return false;
        }

        function runQuery(db, q, includeDeleted) {
            q = q || {};
            var out = [];
            Object.keys(db.objects).forEach(function (id) {
                var o = db.objects[id];
                if (!includeDeleted && o._del) return;
                if (!isOfKind(db, o, q.from)) return;
                var where = (q.where || []).concat(q.filter || []);
                for (var i = 0; i < where.length; ++i)
                    if (!matchClause(o, where[i])) return;
                out.push(o);
            });
            if (q.orderBy) {
                var dir = q.desc ? -1 : 1;
                out.sort(function (a, b) {
                    var x = getPath(a, q.orderBy), y = getPath(b, q.orderBy);
                    if (x === y) return 0;
                    if (x === undefined) return 1;
                    if (y === undefined) return -1;
                    return (x < y ? -1 : 1) * dir;
                });
            } else if (q.desc) {
                out.reverse();
            }
            return out;
        }

        function select(o, fields) {
            if (!fields) return o;
            var r = { _id: o._id, _kind: o._kind, _rev: o._rev };
            fields.forEach(function (f) { r[f] = getPath(o, f); });
            return r;
        }

        function notify() {
            var w = watchers;
            watchers = [];
            w.forEach(function (cb) { cb(); });
        }

        function put(db, o) {
            o = JSON.parse(JSON.stringify(o));
            if (!o._id) o._id = newId(db);
            o._rev = ++db.rev;
            db.objects[o._id] = o;
            return { id: o._id, rev: o._rev };
        }

        var api = {
            "/putKind": function (p, reply) {
                var db = load();
                db.kinds[p.id] = { extends: p.extends || [], indexes: p.indexes || [] };
                save(db);
                reply(ok());
            },
            "/delKind": function (p, reply) {
                var db = load();
                delete db.kinds[p.id];
                Object.keys(db.objects).forEach(function (id) {
                    if (db.objects[id]._kind === p.id) delete db.objects[id];
                });
                save(db);
                reply(ok());
            },
            "/putPermissions": function (p, reply) { reply(ok()); },
            "/putQuotas": function (p, reply) { reply(ok()); },
            "/compact": function (p, reply) { reply(ok()); },
            "/stats": function (p, reply) { reply(ok({ results: {} })); },
            "/reserveIds": function (p, reply) {
                var db = load(), ids = [];
                for (var i = 0; i < (p.count || 1); ++i) ids.push(newId(db));
                save(db);
                reply(ok({ ids: ids }));
            },
            "/put": function (p, reply) {
                var db = load();
                var results = (p.objects || []).map(function (o) { return put(db, o); });
                save(db);
                reply(ok({ results: results }));
                notify();
            },
            "/get": function (p, reply) {
                var db = load();
                var results = (p.ids || []).map(function (id) { return db.objects[id]; })
                    .filter(function (o) { return o && !o._del; });
                reply(ok({ results: results }));
            },
            "/merge": function (p, reply) {
                var db = load();
                var results = [];
                var targets = p.objects || runQuery(db, p.query).map(function (o) {
                    var m = JSON.parse(JSON.stringify(p.props || {}));
                    m._id = o._id;
                    return m;
                });
                targets.forEach(function (m) {
                    var cur = db.objects[m._id];
                    if (!cur) return;
                    for (var k in m) if (k !== "_rev") cur[k] = m[k];
                    cur._rev = ++db.rev;
                    results.push({ id: cur._id, rev: cur._rev });
                });
                save(db);
                reply(p.query ? ok({ count: results.length }) : ok({ results: results }));
                notify();
            },
            "/del": function (p, reply) {
                var db = load();
                var ids = p.ids || runQuery(db, p.query).map(function (o) { return o._id; });
                var results = [];
                ids.forEach(function (id) {
                    if (!db.objects[id]) return;
                    if (p.purge) delete db.objects[id];
                    else { db.objects[id]._del = true; db.objects[id]._rev = ++db.rev; }
                    results.push({ id: id });
                });
                save(db);
                reply(p.query ? ok({ count: results.length }) : ok({ results: results }));
                notify();
            },
            "/find": function (p, reply, ctx) {
                function answer() {
                    var db = load();
                    var all = runQuery(db, p.query);
                    var start = 0;
                    if (p.query && p.query.page) start = parseInt(p.query.page, 10) || 0;
                    var limit = (p.query && p.query.limit) || 500;
                    var page = all.slice(start, start + limit);
                    var r = ok({ results: page.map(function (o) { return select(o, p.query && p.query.select); }) });
                    if (start + limit < all.length) r.next = String(start + limit);
                    if (p.count) r.count = all.length;
                    return r;
                }
                reply(answer());
                if (p.watch)
                    watchers.push(function () { if (!ctx.cancelled()) reply(ok({ fired: true })); });
            },
            "/search": function (p, reply, ctx) { api["/find"](p, reply, ctx); },
            "/watch": function (p, reply, ctx) {
                reply(ok());
                watchers.push(function () { if (!ctx.cancelled()) reply(ok({ fired: true })); });
            },
            "/batch": function (p, reply) {
                var responses = [];
                (p.operations || []).forEach(function (op) {
                    var fn = api["/" + op.method];
                    if (fn) fn(op.params || {}, function (r) { responses.push(r); }, { cancelled: function () { return true; } });
                    else responses.push(fail(-1, "unsupported batch method " + op.method));
                });
                reply(ok({ responses: responses }));
            }
        };
        return api;
    }

    register(["com.palm.db"], makeDb("com.palm.db"));
    register(["com.palm.tempdb"], makeDb("com.palm.tempdb"));

    // ---- System service ------------------------------------------------------------------

    var defaultPrefs = {
        locale: { languageCode: "en", countryCode: "us", phoneRegion: { countryCode: "us" } },
        region: { countryCode: "us" },
        timeFormat: "HH12",
        timeZone: { ZoneID: PalmSystem.TZ, City: "", Country: "" },
        useNetworkTime: true,
        wallpaper: { wallpaperName: "", wallpaperFile: "" },
        ringtone: { name: "Pre", fullPath: "" },
        systemSounds: true,
        airplaneMode: false,
        rotationLock: false,
        muteSound: false,
        showAlertsWhenLocked: true,
        blinkNotifications: true,
        firstUse: false
    };

    function prefs() {
        var p = store.get("prefs", {});
        var out = {};
        for (var k in defaultPrefs) out[k] = defaultPrefs[k];
        for (k in p) out[k] = p[k];
        return out;
    }

    var prefWatchers = [];

    function timeInfo() {
        var d = new Date();
        return ok({
            localtime: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
                         hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() },
            utc: Math.floor(d.getTime() / 1000),
            offset: -d.getTimezoneOffset(),
            timezone: PalmSystem.TZ,
            TZ: PalmSystem.TZ,
            timeZoneFile: "/usr/share/zoneinfo/" + PalmSystem.TZ,
            NITZValid: false
        });
    }

    register(["com.palm.systemservice", "com.webos.service.systemservice"], {
        "/time/getSystemTime": function (p, reply) { reply(timeInfo()); },
        "/time/getSystemTimezoneFile": function (p, reply) { reply(ok({ timeZoneFile: "/usr/share/zoneinfo/" + PalmSystem.TZ })); },
        "/time/getNTPTime": function (p, reply) { reply(ok({ utc: Math.floor(Date.now() / 1000) })); },
        "/timezone/getTimeZoneRules": function (p, reply) { reply(ok({ results: [] })); },
        "/getPreferences": function (p, reply, ctx) {
            var all = prefs(), r = ok({});
            (p.keys || []).forEach(function (k) { if (k in all) r[k] = all[k]; });
            reply(r);
            if (p.subscribe) {
                prefWatchers.push(function (changed) {
                    if (ctx.cancelled()) return;
                    var any = (p.keys || []).filter(function (k) { return k in changed; });
                    if (!any.length) return;
                    var u = ok({});
                    any.forEach(function (k) { u[k] = changed[k]; });
                    reply(u);
                });
            }
        },
        "/setPreferences": function (p, reply) {
            var saved = store.get("prefs", {});
            for (var k in p) if (k !== "subscribe") saved[k] = p[k];
            store.set("prefs", saved);
            reply(ok());
            prefWatchers.forEach(function (w) { w(p); });
            host.postToHost("preferences", p);
        },
        "/getPreferenceValues": function (p, reply) { reply(ok({ values: [] })); },
        "/deviceInfo/query": function (p, reply) { reply(ok(JSON.parse(PalmSystem.deviceInfo))); },
        "/ringtone/listRingtones": function (p, reply) { reply(ok({ ringtones: [] })); }
    });

    // ---- Application manager -------------------------------------------------------------

    register(["com.palm.applicationManager", "com.webos.applicationManager"], {
        "/launch": function (p, reply) {
            host.postToHost("launch", { id: p.id, params: p.params || {} });
            reply(ok({ processId: String(Date.now()) }));
        },
        "/open": function (p, reply) {
            host.postToHost("open", { target: p.target, id: p.id, params: p.params || {} });
            reply(ok());
        },
        "/running": function (p, reply) { reply(ok({ running: [] })); },
        "/listApps": function (p, reply) { reply(ok({ apps: store.get("apps", []) })); },
        "/listLaunchPoints": function (p, reply) { reply(ok({ launchPoints: store.get("apps", []) })); },
        "/getAppInfo": function (p, reply) {
            var app = store.get("apps", []).filter(function (a) { return a.id === p.appId || a.id === p.id; })[0];
            reply(app ? ok({ appInfo: app }) : fail(-1, "app not found"));
        },
        "/addLaunchPoint": function (p, reply) { reply(ok({ launchPointId: "lp" + Date.now() })); },
        "/getHandlerForMimeType": function (p, reply) { reply(fail(-1, "no handler")); },
        "/listAllHandlersForMime": function (p, reply) { reply(ok({ resources: [] })); }
    });

    // ---- Connectivity, power, accounts and friends -------------------------------------

    register(["com.palm.connectionmanager", "com.webos.service.connectionmanager"], {
        "/getstatus": function (p, reply) {
            reply(ok({
                isInternetConnectionAvailable: true,
                wifi: { state: "connected", ipAddress: "10.0.0.2", ssid: "Phoenix", onInternet: "yes" },
                wan: { state: "disconnected" },
                btpan: { state: "disconnected" }
            }));
        }
    });

    register(["com.palm.power"], {
        "/com/palm/power/batteryStatusQuery": function (p, reply) { reply(ok({ percent: 76, percent_ui: 76, charging: false })); },
        "/com/palm/power/chargerStatusQuery": function (p, reply) { reply(ok({ Charging: false, Connected: false })); },
        "/timeout/set": function (p, reply) { reply(ok()); },
        "/timeout/clear": function (p, reply) { reply(ok()); },
        "/com/palm/power/activityStart": function (p, reply) { reply(ok()); },
        "/com/palm/power/activityEnd": function (p, reply) { reply(ok()); }
    });

    register(["com.palm.display"], {
        "/control/status": function (p, reply) { reply(ok({ event: "displayOn", state: "on" })); },
        "*": function (p, reply) { reply(ok()); }
    });

    register(["com.palm.service.accounts"], {
        "/listAccounts": function (p, reply) { reply(ok({ results: store.get("accounts", []) })); },
        "/listAccountTemplates": function (p, reply) { reply(ok({ results: [] })); },
        "/getAccountInfo": function (p, reply) { reply(fail(-1, "no account")); }
    });

    register(["com.palm.activitymanager"], {
        "*": function (p, reply) { reply(ok({ activityId: Date.now() })); }
    });

    // Services that apps poke but whose absence should not break them.
    register(["com.palm.keys", "com.palm.audio", "com.palm.vibrate", "com.palm.lunabus",
              "com.palm.bus", "com.palm.preferences", "com.palm.systemmanager",
              "com.palm.location", "com.palm.telephony", "com.palm.messaging",
              "com.palm.applicationManager.private", "com.palm.mediaindexer"], {
        "*": function (p, reply) { reply(ok()); }
    });

    // Back gesture: the shell calls this; Mojo/Enyo 1.0 apps treat Escape
    // (and keyIdentifier U+1200001 on devices) as "back".
    runtime.back = function () {
        var target = global.document.activeElement || global.document.body || global.document;
        ["keydown", "keyup"].forEach(function (type) {
            var e = new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true });
            try {
                Object.defineProperty(e, "keyCode", { get: function () { return 27; } });
                Object.defineProperty(e, "keyIdentifier", { get: function () { return "U+1200001"; } });
            } catch (x) { /* ignore */ }
            target.dispatchEvent(e);
        });
        return true;
    };

    // ================================================================================
    // Settings services (simulated webOS OSE APIs used by apps/settings)
    // ================================================================================
    //
    // Simulated versions of exactly the OSE service methods the Settings app
    // calls, with the request/response shapes of the real services. Sources
    // (webosose repositories, master branch):
    //
    //   com.webos.service.wifi               webos-connman-adapter src/wifi_service.c
    //       setstate, findnetworks, connect, getstatus, getprofilelist, deleteprofile
    //   com.webos.service.connectionmanager  webos-connman-adapter src/connectionmanager_service.c
    //       getstatus, setstate ({offlineMode} is airplane mode)
    //   com.webos.service.bluetooth2         com.webos.service.bluetooth2 src/bluetoothmanagerservice.cpp,
    //                                        src/bluetoothmanageradapter.cpp
    //       adapter/getStatus, adapter/setState, adapter/startDiscovery,
    //       adapter/cancelDiscovery, adapter/pair, adapter/unpair, device/getStatus
    //   com.webos.settingsservice            settingsservice inc/SettingsServiceApi.h
    //       getSystemSettings, setSystemSettings, resetSystemSettings
    //       (keys used: localeInfo; picture.backlight for brightness)
    //   com.webos.service.systemservice      luna-sysservice Src/PrefsFactory.cpp, TimePrefsHandler.cpp,
    //                                        DeviceInfoService.cpp, OsInfoService.cpp
    //       getPreferences/setPreferences (existing mock above, extended here),
    //       getPreferenceValues {key:"timeZone"}, time/setSystemTime,
    //       time/getSystemTime, deviceInfo/query, osInfo/query
    //   com.webos.service.audio              audiod-pro src/modules/masterVolumeManager,
    //                                        audioPolicyManager, systemSoundsManager
    //       master/getVolume, master/setVolume, master/muteVolume,
    //       getInputVolume, setInputVolume (streamType pringtones/palerts/pmedia),
    //       playFeedback
    //   com.palm.systemmanager               legacy webOS 2.x (no OSE equivalent yet)
    //       getDeviceLockMode, setDevicePasscode, matchDevicePasscode
    //
    // State lives in the shared store under "settings:state", so every app
    // window sees the same radios. Changes other windows make arrive as
    // "storage" events and are pushed to this page's subscribers.
    //
    // Shell integration: whenever a radio, airplane mode, brightness, mute
    // or rotation lock changes, the runtime posts
    //     phoenixHost.postToHost("systemStatus", { wifiEnabled, wifiConnected,
    //         wifiBars, bluetoothOn, airplaneMode, brightness (0-100),
    //         rotationLocked, muted, wallpaperFile })
    // and the shell calls __phoenixRuntime.applyHostStatus({...same keys})
    // when the user flips a toggle in the system menu (docs/APP-RUNTIME.md).
    (function settingsServices() {
        var KEY = "settings:state";

        // Simulated access points. "password" is what the simulated AP accepts.
        var AIR = [
            { ssid: "Phoenix", security: ["psk"], signalLevel: 92, password: "phoenix123" },
            { ssid: "Sunnyvale Cafe", security: [], signalLevel: 74 },
            { ssid: "Lab 5G", security: ["psk"], signalLevel: 66, password: "webos2009" },
            { ssid: "Library Guest", security: [], signalLevel: 41 },
            { ssid: "Neighbor", security: ["wep"], signalLevel: 23, password: "12345" }
        ];
        var BT_NEARBY = [
            { name: "Speaker S-200", address: "00:1d:fe:10:20:01", typeOfDevice: "bredr", classOfDevice: 2360340 },
            { name: "Headset HS-400", address: "00:1d:fe:10:20:02", typeOfDevice: "bredr", classOfDevice: 2360324 },
            { name: "Car Kit", address: "00:1d:fe:10:20:03", typeOfDevice: "bredr", classOfDevice: 2360328 },
            { name: "Stylus Keyboard", address: "00:1d:fe:10:20:04", typeOfDevice: "ble", classOfDevice: 9536 }
        ];

        function defaults() {
            return {
                wifi: { enabled: true, connected: "Phoenix", profiles: [{ profileId: 1, ssid: "Phoenix", security: "psk" }], nextProfileId: 2 },
                bluetooth: { powered: false, name: "Phoenix", paired: [] },
                offlineMode: false,
                beforeOffline: null,
                settings: {
                    "": { localeInfo: { locales: { UI: "en-US", FMT: "en-US" }, clock: "locale" } },
                    picture: { backlight: 70 }
                },
                audio: { volume: 60, muted: false, streams: { pringtones: 80, palerts: 70, pmedia: 60, pfeedback: 50 } },
                lock: { lockMode: "none", hash: "" },
                timeOffset: 0
            };
        }

        function load() {
            var s = store.get(KEY, null);
            if (!s) return defaults();
            var d = defaults();
            for (var k in d) if (!(k in s)) s[k] = d[k];
            return s;
        }

        var listeners = [];        // functions re-run on every state change
        var suppressHost = false;  // true while applying a state the shell sent

        function hostStatus(s) {
            s = s || load();
            var p = prefs();
            var ap = s.wifi.enabled && s.wifi.connected ? airFor(s.wifi.connected) : null;
            return {
                wifiEnabled: !!s.wifi.enabled,
                wifiConnected: !!ap,
                wifiBars: !s.wifi.enabled ? -1 : ap ? bars(ap.signalLevel) : 0,
                bluetoothOn: !!s.bluetooth.powered,
                airplaneMode: !!s.offlineMode,
                brightness: s.settings.picture.backlight,
                rotationLocked: !!p.rotationLock,
                muted: !!s.audio.muted,
                wallpaperFile: (p.wallpaper && p.wallpaper.wallpaperFile) || ""
            };
        }

        function changed() {
            listeners.slice().forEach(function (fn) { fn(); });
        }

        function save(s) {
            store.set(KEY, s);
            if (!suppressHost)
                host.postToHost("systemStatus", hostStatus(s));
            changed();
        }

        // Another window changed the shared state.
        try {
            global.addEventListener("storage", function (e) {
                if (e.key === "phoenix:" + KEY || e.key === "phoenix:prefs") changed();
            });
        } catch (e) { /* ignore */ }

        // Subscribe helper: reply now, then again whenever the answer changes.
        function watch(p, reply, ctx, compute) {
            var last = JSON.stringify(compute());
            var first = JSON.parse(last);
            if (p.subscribe) first.subscribed = true;
            reply(first);
            if (!p.subscribe) return;
            var fn = function () {
                if (ctx.cancelled()) {
                    listeners = listeners.filter(function (l) { return l !== fn; });
                    return;
                }
                var now = JSON.stringify(compute());
                if (now === last) return;
                last = now;
                var r = JSON.parse(now);
                r.subscribed = true;
                reply(r);
            };
            listeners.push(fn);
        }

        function airFor(ssid) {
            return AIR.filter(function (a) { return a.ssid === ssid; })[0] || null;
        }
        function bars(level) { return level >= 70 ? 3 : level >= 40 ? 2 : 1; }

        // ---- com.webos.service.wifi ------------------------------------------------

        var connecting = null;   // ssid being connected, for connectState

        function networkInfo(s, a) {
            var info = {
                ssid: a.ssid,
                availableSecurityTypes: a.security.length ? a.security : ["none"],
                signalBars: bars(a.signalLevel),
                signalLevel: a.signalLevel,
                supported: true,
                available: true
            };
            var prof = s.wifi.profiles.filter(function (x) { return x.ssid === a.ssid; })[0];
            if (prof) info.profileId = prof.profileId;
            if (s.wifi.connected === a.ssid) info.connectState = "ipConfigured";
            else if (connecting === a.ssid) info.connectState = "associating";
            return { networkInfo: info };
        }

        function wifiStatus() {
            var s = load();
            if (!s.wifi.enabled) return ok({ wakeOnWlan: "disabled", status: "serviceDisabled" });
            var name = s.wifi.connected || connecting;
            if (!name) return ok({ wakeOnWlan: "disabled", status: "serviceEnabled" });
            var a = airFor(name);
            var r = ok({ wakeOnWlan: "disabled", status: "connectionStateChanged" });
            r.networkInfo = {
                ssid: name,
                connectState: s.wifi.connected ? "ipConfigured" : "associating",
                signalBars: bars(a.signalLevel),
                signalLevel: a.signalLevel,
                ipInfo: { interface: "wlan0", ip: "192.168.1.23", subnet: "255.255.255.0", gateway: "192.168.1.1", dns: ["192.168.1.1"] }
            };
            var prof = s.wifi.profiles.filter(function (x) { return x.ssid === name; })[0];
            if (prof) r.networkInfo.profileId = prof.profileId;
            return r;
        }

        function setWifi(s, on) {
            s.wifi.enabled = on;
            if (!on) s.wifi.connected = "";
            else if (!s.wifi.connected && s.wifi.profiles.length) {
                // Auto-join the first known network in range.
                s.wifi.connected = s.wifi.profiles[0].ssid;
            }
        }

        var wifi = {
            "/setstate": function (p, reply) {
                if (p.state !== "enabled" && p.state !== "disabled") return reply(fail(-1, "Invalid parameters"));
                var s = load();
                setWifi(s, p.state === "enabled");
                save(s);
                reply(ok());
            },
            "/getstatus": function (p, reply, ctx) { watch(p, reply, ctx, wifiStatus); },
            "/findnetworks": function (p, reply, ctx) {
                if (!load().wifi.enabled) return reply(fail(-1, "WiFi switched off"));
                watch(p, reply, ctx, function () {
                    var s = load();
                    return ok({ foundNetworks: s.wifi.enabled ? AIR.map(function (a) { return networkInfo(s, a); }) : [] });
                });
            },
            "/scan": function (p, reply) { reply(ok()); },
            "/connect": function (p, reply) {
                var s = load();
                if (!s.wifi.enabled) return reply(fail(-1, "WiFi switched off"));
                var ssid = p.ssid;
                if (p.profileId !== undefined) {
                    var pr = s.wifi.profiles.filter(function (x) { return x.profileId === p.profileId; })[0];
                    if (!pr) return reply(fail(-1, "Profile not found"));
                    ssid = pr.ssid;
                }
                var a = airFor(ssid);
                if (!a) return reply(fail(-1, "Could not establish a connection to access point"));
                var known = s.wifi.profiles.some(function (x) { return x.ssid === ssid; });
                var key = p.security && p.security.simpleSecurity && p.security.simpleSecurity.passKey;
                connecting = ssid;
                s.wifi.connected = "";
                save(s);
                // The real service replies once connman has finished (wifi_service.c).
                setTimeout(function () {
                    var s2 = load();
                    connecting = null;
                    if (a.security.length && !known && key !== a.password) {
                        save(s2);
                        return reply(fail(10, "The supplied password is incorrect"));
                    }
                    s2.wifi.connected = ssid;
                    if (!known) {
                        s2.wifi.profiles.push({ profileId: s2.wifi.nextProfileId++, ssid: ssid, security: a.security[0] || "none" });
                    }
                    save(s2);
                    reply(ok());
                }, 900);
            },
            "/getprofilelist": function (p, reply) {
                var s = load();
                if (!s.wifi.profiles.length) return reply(fail(-1, "Profile not found"));
                reply(ok({ profileList: s.wifi.profiles.map(function (x) {
                    return { wifiProfile: { profileId: x.profileId, ssid: x.ssid, security: { securityType: x.security } } };
                }) }));
            },
            "/deleteprofile": function (p, reply) {
                var s = load();
                var pr = s.wifi.profiles.filter(function (x) { return x.profileId === p.profileId; })[0];
                if (!pr) return reply(fail(-1, "Profile not found"));
                s.wifi.profiles = s.wifi.profiles.filter(function (x) { return x !== pr; });
                if (s.wifi.connected === pr.ssid) s.wifi.connected = "";
                save(s);
                reply(ok());
            }
        };
        register(["com.webos.service.wifi"], wifi);

        // ---- com.webos.service.connectionmanager ------------------------------------

        function cmStatus() {
            var s = load();
            var ap = s.wifi.enabled && s.wifi.connected ? airFor(s.wifi.connected) : null;
            var w = ap ? { state: "connected", interfaceName: "wlan0", ipAddress: "192.168.1.23", netmask: "255.255.255.0",
                           gateway: "192.168.1.1", dns1: "192.168.1.1", method: "dhcp", ssid: ap.ssid, onInternet: "yes" }
                       : { state: "disconnected" };
            return ok({
                isInternetConnectionAvailable: !!ap,
                offlineMode: s.offlineMode ? "enabled" : "disabled",
                wired: { state: "disconnected" },
                wifi: w,
                wifiDirect: { state: "disconnected" }
            });
        }

        function setOffline(s, on) {
            if (on === !!s.offlineMode) return;
            s.offlineMode = on;
            if (on) {
                // Airplane mode switches every radio off and remembers them.
                s.beforeOffline = { wifi: s.wifi.enabled, bluetooth: s.bluetooth.powered };
                setWifi(s, false);
                s.bluetooth.powered = false;
            } else if (s.beforeOffline) {
                setWifi(s, s.beforeOffline.wifi);
                s.bluetooth.powered = s.beforeOffline.bluetooth;
                s.beforeOffline = null;
            }
        }

        var cm = {
            "/getstatus": function (p, reply, ctx) { watch(p, reply, ctx, cmStatus); },
            "/getStatus": function (p, reply, ctx) { watch(p, reply, ctx, cmStatus); },
            "/setstate": function (p, reply) {
                var s = load();
                if (p.offlineMode) setOffline(s, p.offlineMode === "enabled");
                if (p.wifi) setWifi(s, p.wifi === "enabled");
                save(s);
                reply(ok());
            }
        };
        register(["com.webos.service.connectionmanager", "com.palm.connectionmanager"], cm);

        // ---- com.webos.service.bluetooth2 ------------------------------------------

        var discovering = false;
        var discovered = [];
        var pairing = null;

        function adapterStatus() {
            var s = load();
            return ok({ adapters: [{
                powered: !!s.bluetooth.powered, name: s.bluetooth.name, interfaceName: "hci0",
                adapterAddress: "00:1d:fe:00:00:01", discovering: discovering && s.bluetooth.powered,
                discoveryTimeout: 0, discoverable: false, discoverableTimeout: 0, pairable: true, pairableTimeout: 0
            }] });
        }

        function devices() {
            var s = load();
            if (!s.bluetooth.powered) return ok({ adapterAddress: "00:1d:fe:00:00:01", devices: [] });
            var list = BT_NEARBY.filter(function (d) {
                return s.bluetooth.paired.indexOf(d.address) >= 0 || discovered.indexOf(d.address) >= 0;
            }).map(function (d) {
                return { name: d.name, address: d.address, typeOfDevice: d.typeOfDevice, classOfDevice: d.classOfDevice,
                         paired: s.bluetooth.paired.indexOf(d.address) >= 0, pairing: pairing === d.address,
                         trusted: false, blocked: false, rssi: -60, connectedProfiles: [], adapterAddress: "00:1d:fe:00:00:01" };
            });
            return ok({ adapterAddress: "00:1d:fe:00:00:01", devices: list });
        }

        register(["com.webos.service.bluetooth2"], {
            "/adapter/getStatus": function (p, reply, ctx) { watch(p, reply, ctx, adapterStatus); },
            "/adapter/setState": function (p, reply) {
                var s = load();
                if (typeof p.powered === "boolean") {
                    s.bluetooth.powered = p.powered;
                    if (!p.powered) { discovering = false; discovered = []; }
                }
                if (typeof p.name === "string") s.bluetooth.name = p.name;
                save(s);
                reply(ok({ adapterAddress: "00:1d:fe:00:00:01" }));
            },
            "/adapter/startDiscovery": function (p, reply) {
                if (!load().bluetooth.powered) return reply(fail(106, "Bluetooth adapter is off"));
                discovering = true;
                changed();
                reply(ok({ adapterAddress: "00:1d:fe:00:00:01" }));
                // Devices turn up one by one, then discovery times out.
                BT_NEARBY.forEach(function (d, i) {
                    setTimeout(function () {
                        if (!discovering) return;
                        if (discovered.indexOf(d.address) < 0) discovered.push(d.address);
                        changed();
                    }, 400 + i * 350);
                });
                setTimeout(function () { discovering = false; changed(); }, 400 + BT_NEARBY.length * 350 + 1500);
            },
            "/adapter/cancelDiscovery": function (p, reply) {
                discovering = false;
                changed();
                reply(ok({ adapterAddress: "00:1d:fe:00:00:01" }));
            },
            "/adapter/pair": function (p, reply) {
                var s = load();
                if (!p.address) return reply(fail(-1, "Required property not found - 'address'"));
                if (!s.bluetooth.powered) return reply(fail(106, "Bluetooth adapter is off"));
                pairing = p.address;
                changed();
                reply(ok({ adapterAddress: "00:1d:fe:00:00:01", subscribed: !!p.subscribe }));
                setTimeout(function () {
                    var s2 = load();
                    pairing = null;
                    if (s2.bluetooth.paired.indexOf(p.address) < 0) s2.bluetooth.paired.push(p.address);
                    save(s2);
                }, 1200);
            },
            "/adapter/unpair": function (p, reply) {
                var s = load();
                s.bluetooth.paired = s.bluetooth.paired.filter(function (a) { return a !== p.address; });
                save(s);
                reply(ok({ adapterAddress: "00:1d:fe:00:00:01" }));
            },
            "/device/getStatus": function (p, reply, ctx) { watch(p, reply, ctx, devices); }
        });

        // ---- com.webos.settingsservice ------------------------------------------------

        function settingsFor(s, category, keys) {
            var all = s.settings[category || ""] || {};
            var out = {};
            (keys || Object.keys(all)).forEach(function (k) { if (k in all) out[k] = all[k]; });
            return out;
        }

        register(["com.webos.settingsservice"], {
            "/getSystemSettings": function (p, reply, ctx) {
                watch(p, reply, ctx, function () {
                    var r = ok({ method: "getSystemSettings", settings: settingsFor(load(), p.category, p.keys) });
                    if (p.category) r.category = p.category;
                    return r;
                });
            },
            "/setSystemSettings": function (p, reply) {
                var s = load();
                var cat = p.category || "";
                s.settings[cat] = s.settings[cat] || {};
                for (var k in (p.settings || {})) s.settings[cat][k] = p.settings[k];
                save(s);
                reply(ok({ method: "setSystemSettings" }));
            },
            "/resetSystemSettings": function (p, reply) {
                var s = load();
                var d = defaults();
                if (p.category) s.settings[p.category] = d.settings[p.category] || {};
                else s.settings = d.settings;
                save(s);
                reply(ok({ method: "resetSystemSettings" }));
            }
        });

        // ---- com.webos.service.audio ----------------------------------------------

        function volumeStatus() {
            var a = load().audio;
            return ok({ volumeStatus: { muted: !!a.muted, volume: a.volume, soundOutput: "alsa", sessionId: 0 }, callerId: "" });
        }

        register(["com.webos.service.audio"], {
            "/master/getVolume": function (p, reply, ctx) { watch(p, reply, ctx, volumeStatus); },
            "/master/setVolume": function (p, reply) {
                var s = load();
                s.audio.volume = Math.max(0, Math.min(100, p.volume | 0));
                save(s);
                reply(ok({ volume: s.audio.volume, soundOutput: p.soundOutput || "alsa" }));
            },
            "/master/muteVolume": function (p, reply) {
                var s = load();
                s.audio.muted = !!p.mute;
                save(s);
                reply(ok({ mute: s.audio.muted, soundOutput: p.soundOutput || "alsa" }));
            },
            "/getInputVolume": function (p, reply, ctx) {
                watch(p, reply, ctx, function () {
                    return ok({ streamType: p.streamType, volume: load().audio.streams[p.streamType] || 0 });
                });
            },
            "/setInputVolume": function (p, reply) {
                var s = load();
                if (!(p.streamType in s.audio.streams)) return reply(fail(-1, "Audiod Unknown Stream"));
                s.audio.streams[p.streamType] = Math.max(0, Math.min(100, p.volume | 0));
                save(s);
                reply(ok({ streamType: p.streamType, volume: s.audio.streams[p.streamType] }));
            },
            "/playFeedback": function (p, reply) { reply(ok()); },
            "/playSound": function (p, reply) { reply(ok({ playbackId: "sim" + Date.now() })); }
        });

        // ---- com.webos.service.systemservice (additions to the mock above) ----------

        var ZONES = [
            ["Pacific/Honolulu", "Honolulu", "United States", "US"],
            ["America/Anchorage", "Anchorage", "United States", "US"],
            ["America/Los_Angeles", "Los Angeles", "United States", "US"],
            ["America/Denver", "Denver", "United States", "US"],
            ["America/Phoenix", "Phoenix", "United States", "US"],
            ["America/Chicago", "Chicago", "United States", "US"],
            ["America/New_York", "New York", "United States", "US"],
            ["America/Toronto", "Toronto", "Canada", "CA"],
            ["America/Mexico_City", "Mexico City", "Mexico", "MX"],
            ["America/Sao_Paulo", "Sao Paulo", "Brazil", "BR"],
            ["Atlantic/Reykjavik", "Reykjavik", "Iceland", "IS"],
            ["Europe/London", "London", "United Kingdom", "GB"],
            ["Europe/Dublin", "Dublin", "Ireland", "IE"],
            ["Europe/Paris", "Paris", "France", "FR"],
            ["Europe/Berlin", "Berlin", "Germany", "DE"],
            ["Europe/Madrid", "Madrid", "Spain", "ES"],
            ["Europe/Rome", "Rome", "Italy", "IT"],
            ["Europe/Stockholm", "Stockholm", "Sweden", "SE"],
            ["Europe/Athens", "Athens", "Greece", "GR"],
            ["Europe/Moscow", "Moscow", "Russia", "RU"],
            ["Africa/Cairo", "Cairo", "Egypt", "EG"],
            ["Africa/Johannesburg", "Johannesburg", "South Africa", "ZA"],
            ["Asia/Dubai", "Dubai", "United Arab Emirates", "AE"],
            ["Asia/Kolkata", "Kolkata", "India", "IN"],
            ["Asia/Bangkok", "Bangkok", "Thailand", "TH"],
            ["Asia/Singapore", "Singapore", "Singapore", "SG"],
            ["Asia/Shanghai", "Shanghai", "China", "CN"],
            ["Asia/Hong_Kong", "Hong Kong", "China", "HK"],
            ["Asia/Taipei", "Taipei", "Taiwan", "TW"],
            ["Asia/Seoul", "Seoul", "South Korea", "KR"],
            ["Asia/Tokyo", "Tokyo", "Japan", "JP"],
            ["Australia/Perth", "Perth", "Australia", "AU"],
            ["Australia/Sydney", "Sydney", "Australia", "AU"],
            ["Pacific/Auckland", "Auckland", "New Zealand", "NZ"],
            ["Etc/UTC", "UTC", "", ""]
        ];

        function zoneOffset(zone) {
            // Minutes east of UTC, now.
            try {
                var d = new Date();
                var parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric",
                    day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(d);
                var v = {};
                parts.forEach(function (x) { v[x.type] = +x.value; });
                var asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute);
                return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
            } catch (e) {
                return 0;
            }
        }

        var sys = runtime.services["com.webos.service.systemservice"] || {};
        var baseSetPreferences = sys["/setPreferences"];
        var baseSystemTime = sys["/time/getSystemTime"];

        sys["/getPreferenceValues"] = function (p, reply) {
            if (p.key === "timeZone") {
                reply(ok({ timeZone: ZONES.map(function (z) {
                    return { ZoneID: z[0], City: z[1], Country: z[2], CountryCode: z[3], Description: z[1],
                             offsetFromUTC: zoneOffset(z[0]), supportsDST: 1 };
                }) }));
            } else if (p.key === "timeFormat") {
                reply(ok({ timeFormat: ["HH12", "HH24"] }));
            } else if (p.key === "useNetworkTime") {
                reply(ok({ useNetworkTime: [true, false] }));
            } else {
                reply(ok({}));
            }
        };
        sys["/setPreferences"] = function (p, reply, ctx) {
            baseSetPreferences(p, reply, ctx);
            if ("rotationLock" in p || "wallpaper" in p) {
                if (!suppressHost) host.postToHost("systemStatus", hostStatus());
                changed();
            }
        };
        sys["/time/setSystemTime"] = function (p, reply) {
            if (typeof p.utc !== "number") return reply(fail(-1, "accessing utc integer value failed"));
            var s = load();
            s.timeOffset = p.utc * 1000 - Date.now();
            save(s);
            reply(ok());
        };
        sys["/time/getSystemTime"] = function (p, reply, ctx) {
            var off = load().timeOffset || 0;
            baseSystemTime(p, function (r) {
                if (off) {
                    var d = new Date(Date.now() + off);
                    r.utc = Math.floor(d.getTime() / 1000);
                    r.localtime = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
                                    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
                }
                var tz = prefs().timeZone;
                if (tz && tz.ZoneID) r.timezone = r.TZ = tz.ZoneID;
                reply(r);
            }, ctx);
        };
        var deviceInfo = {
            board_type: "phoenix-sim", device_name: "Phoenix Simulator", hardware_id: "SIM-0001",
            hardware_revision: "1.0", keyboard_type: "virtual", modem_present: "N", product_id: "phoenix-sim",
            radio_type: "none", ram_size: "1 GB", serial_number: "PHOENIX0001", storage_free: "5.8 GB",
            storage_size: "8 GB", wifi_addr: "00:1d:fe:00:00:02", bt_addr: "00:1d:fe:00:00:01", wired_addr: ""
        };
        var osInfo = {
            core_os_kernel_version: "6.6.0", core_os_name: "Rockhopper", core_os_release: "2.0.0",
            core_os_release_codename: "rockhopper", webos_api_version: "2.0.0", webos_build_id: "sim",
            webos_build_datetime: "20260928000000", webos_imagename: "webos-phoenix-image", webos_name: "webOS Phoenix",
            webos_prerelease: "", webos_release: "0.1.0", webos_release_codename: "phoenix", webos_manufacturing_version: "0.1.0",
            encryption_key_type: ""
        };
        function pick(all, params) {
            var r = ok({});
            (params && params.length ? params : Object.keys(all)).forEach(function (k) { if (k in all) r[k] = all[k]; });
            return r;
        }
        sys["/deviceInfo/query"] = function (p, reply) {
            // OSE keys (DeviceInfoService.cpp) plus the legacy PalmSystem.deviceInfo fields.
            var r = pick(deviceInfo, p.parameters);
            if (!p.parameters) {
                var legacy = JSON.parse(PalmSystem.deviceInfo);
                for (var k in legacy) r[k] = legacy[k];
            }
            reply(r);
        };
        sys["/osInfo/query"] = function (p, reply) { reply(pick(osInfo, p.parameters)); };

        // ---- com.palm.systemmanager: device lock (legacy webOS API) ----------------

        function hash(s) {
            // Not a secure hash: the simulator only needs to avoid storing the
            // passcode itself. A device implementation must use a real KDF.
            var h = 5381;
            for (var i = 0; i < s.length; ++i) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
            return "djb2:" + (h >>> 0).toString(16);
        }
        var stub = runtime.services["com.palm.systemmanager"] || { "*": function (p, reply) { reply(ok()); } };
        register(["com.palm.systemmanager"], {
            "/getDeviceLockMode": function (p, reply) {
                var l = load().lock;
                reply(ok({ lockMode: l.lockMode, policyState: "none", retriesLeft: 10 }));
            },
            "/setDevicePasscode": function (p, reply) {
                var s = load();
                if (s.lock.lockMode !== "none" && hash(p.oldPasscode || "") !== s.lock.hash)
                    return reply(fail(-1, "Incorrect passcode"));
                if (["none", "pin", "password"].indexOf(p.lockMode) < 0) return reply(fail(-1, "Invalid lock mode"));
                if (p.lockMode === "pin" && !/^[0-9]{4,}$/.test(p.passCode || "")) return reply(fail(-1, "A PIN needs at least 4 digits"));
                if (p.lockMode === "password" && (p.passCode || "").length < 4) return reply(fail(-1, "Passwords need at least 4 characters"));
                s.lock = { lockMode: p.lockMode, hash: p.lockMode === "none" ? "" : hash(p.passCode) };
                save(s);
                reply(ok());
            },
            "/matchDevicePasscode": function (p, reply) {
                var l = load().lock;
                reply(ok({ succeeded: l.lockMode === "none" || hash(p.passCode || "") === l.hash }));
            },
            "*": stub["*"]
        });

        // ---- Phoenix: erase user data (no OSE equivalent yet) -----------------------

        register(["org.webosphoenix.service.reset"], {
            "/eraseUserData": function (p, reply) {
                try {
                    var ls = global.localStorage, keys = [];
                    for (var i = 0; i < ls.length; ++i) if (ls.key(i).indexOf("phoenix:") === 0) keys.push(ls.key(i));
                    keys.forEach(function (k) { ls.removeItem(k); });
                } catch (e) { /* ignore */ }
                save(load());
                reply(ok());
            }
        });

        // ---- Shell <-> runtime ------------------------------------------------------

        // The shell's system menu changed something. Keys as in hostStatus();
        // the shell sends only what changed, missing keys are left alone.
        // Answers with one "systemStatus" message carrying the result (which
        // may differ: e.g. airplane mode also turns the radios off).
        runtime.applyHostStatus = function (st) {
            if (!st) return;
            var s = load();
            if ("airplaneMode" in st) setOffline(s, !!st.airplaneMode);
            if ("wifiEnabled" in st && !!st.wifiEnabled !== !!s.wifi.enabled) setWifi(s, !!st.wifiEnabled);
            if ("bluetoothOn" in st) s.bluetooth.powered = !!st.bluetoothOn;
            if ("brightness" in st) s.settings.picture.backlight = Math.round(st.brightness);
            if ("muted" in st) s.audio.muted = !!st.muted;
            suppressHost = true;
            try {
                if ("rotationLocked" in st && !!st.rotationLocked !== !!prefs().rotationLock)
                    sys["/setPreferences"]({ rotationLock: !!st.rotationLocked }, function () {}, { cancelled: function () { return false; } });
                save(s);
            } finally {
                suppressHost = false;
            }
            host.postToHost("systemStatus", hostStatus());
        };
        runtime.hostStatus = function () { return hostStatus(); };

        // The shell launched an app that is already running, with new launch
        // params: update PalmSystem.launchParams and fire OSE's
        // "webOSRelaunch" document event (detail = params), as WebAppMgr does.
        runtime.relaunch = function (params) {
            PalmSystem.launchParams = JSON.stringify(params || {});
            var e;
            try { e = new CustomEvent("webOSRelaunch", { detail: params || {} }); }
            catch (x) { e = global.document.createEvent("CustomEvent"); e.initCustomEvent("webOSRelaunch", false, false, params || {}); }
            global.document.dispatchEvent(e);
            return true;
        };

        // Tell the shell the saved state when a page starts (radios and
        // wallpaper persist across restarts, like on a device).
        host.postToHost("systemStatus", hostStatus());
    })();

})(this);
