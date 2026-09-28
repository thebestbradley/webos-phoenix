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

    // ---- Fonts (core apps) ------------------------------------------------------------
    //
    // The original apps and Enyo 1.0 ask for Palm's Prelude typeface under
    // several names ("Prelude", "Prelude Medium", "PreludeWGL-Light", ...).
    // It is not redistributable, and some app styles name it with no
    // fallback (Calculator: font-family: "Prelude Medium"), which leaves a
    // serif font. Alias those names to Prelude if it is installed, otherwise
    // to the same sans-serif fallbacks the shell uses (Theme.qml).
    (function aliasPreludeFonts() {
        if (!global.document || !global.document.fonts || typeof global.FontFace !== "function")
            return;
        var regular = ["Prelude", "Prelude Medium", "Helvetica Neue", "Open Sans", "Liberation Sans", "Arial", "DejaVu Sans"];
        var light = ["Prelude Light", "Helvetica Neue Light", "Open Sans Light", "Liberation Sans", "Arial", "DejaVu Sans"];
        var bold = ["Prelude Bold", "Helvetica Neue Bold", "Open Sans Bold", "Liberation Sans Bold", "Arial Bold", "DejaVu Sans Bold"];
        function src(names) { return names.map(function (n) { return "local(\"" + n + "\")"; }).join(", "); }
        var families = {
            "Prelude": regular, "Prelude Medium": regular, "Prelude-Medium": regular,
            "Prelude Light": light, "Prelude-Light": light, "PreludeWGL-Light": light
        };
        Object.keys(families).forEach(function (family) {
            try {
                global.document.fonts.add(new FontFace(family, src(families[family]), { weight: "100 599" }));
                global.document.fonts.add(new FontFace(family, src(bold), { weight: "600 900" }));
            } catch (e) { /* ignore */ }
        });
    })();

    // ---- Legacy WebKit APIs (core apps) ------------------------------------------------
    //
    // Enyo 1.0 cancels animation frames with webkitCancelRequestAnimationFrame
    // and falls back to clearTimeout when it is missing. Chromium removed
    // that name, and requestAnimationFrame ids share numbers with timer ids,
    // so Enyo ends up cancelling unrelated timers: a Pane's fade between
    // views stops half-way, leaving both views drawn and a transparent scrim
    // that swallows every tap.
    if (!global.webkitCancelRequestAnimationFrame && global.cancelAnimationFrame)
        global.webkitCancelRequestAnimationFrame = global.cancelAnimationFrame.bind(global);
    if (!global.webkitRequestAnimationFrame && global.requestAnimationFrame)
        global.webkitRequestAnimationFrame = global.requestAnimationFrame.bind(global);

    // ---- PalmSystem.simulateMouseClick (Enyo 1.0 focus) -------------------------------
    //
    // When PalmSystem exists, Enyo 1.0 takes the device's "focus at point"
    // path: it cancels native mousedowns, focuses the tapped node itself on
    // mouseup, then asks the system to replay the tap
    // (simulateMouseClick down/up) and ignores events until that replay
    // arrives. With a no-op, the next real tap is swallowed instead (a text
    // field tapped after a button never gets focus). Replay the tap as
    // mouse events at that point, asynchronously like the device does.
    PalmSystem.simulateMouseClick = function (x, y, down) {
        setTimeout(function () {
            var doc = global.document;
            var sx = x - (global.pageXOffset || 0), sy = y - (global.pageYOffset || 0);
            var target = doc.elementFromPoint(sx, sy) || doc.body;
            if (!target) return;
            target.dispatchEvent(new MouseEvent(down ? "mousedown" : "mouseup", {
                bubbles: true, cancelable: true, view: global,
                clientX: sx, clientY: sy, screenX: sx, screenY: sy, button: 0, buttons: down ? 1 : 0
            }));
        }, 0);
    };

    // ---- Card activation (Mojo.stageActivated) ----------------------------------------
    //
    // LunaSysMgr tells a card's page when it is opened or brought to the
    // front (Mojo.stageActivated) and when it is minimized or closed
    // (Mojo.stageDeactivated); Enyo turns these into onWindowActivated /
    // onWindowDeactivated. Email's window, for one, only handles its launch
    // (opening the first folder) once activated. Do the same when a page
    // has loaded and when it becomes visible or hidden. A headless app's
    // main page ("noWindow" in appinfo.json) is not a card: never activated.
    (function cardActivation() {
        var m = /^(\/usr\/palm\/applications\/[^\/]+\/)(.*)$/.exec(global.location.pathname.replace(/\/{2,}/g, "/"));
        if (!m) return;
        var info = {};
        try { info = JSON.parse((PalmSystem.getResource(m[1] + "appinfo.json") || "{}").replace(/^﻿/, "")); } catch (e) { info = {}; }
        if (info.noWindow && !global.opener && m[2] === (info.main || "index.html"))
            return;

        function stage(activated) {
            var mojo = global.Mojo;
            var fn = mojo && (activated ? mojo.stageActivated : mojo.stageDeactivated);
            if (typeof fn === "function") {
                try { fn(); } catch (e) { console.error("[phoenix-runtime] stage " + (activated ? "activation" : "deactivation") + " failed", e); }
            }
        }

        global.addEventListener("load", function () {
            setTimeout(function () { if (global.document.visibilityState !== "hidden") stage(true); }, 0);
        });
        global.document.addEventListener("visibilitychange", function () {
            stage(global.document.visibilityState !== "hidden");
        });
    })();

    // ---- Legacy WebKit border images (core apps) ---------------------------------------
    //
    // Enyo 1.0 and the core apps draw most of their chrome (buttons, pickers,
    // input frames, the Calculator body, ...) with -webkit-border-image and a
    // border-width, but no border-style. The 2011 WebKit they were written
    // for used the border width whenever a border image was set; current
    // Chromium follows the spec and treats the border as "none" (zero
    // width), so the artwork's edges disappear and buttons look flat.
    // Restore the old behaviour: rules that set a border image get
    // border-style: solid (the image replaces the solid line), and rules
    // that clear it get border-style: none, unless the rule says otherwise.
    (function fixLegacyBorderImages() {
        var doc = global.document;
        if (!doc || typeof MutationObserver !== "function")
            return;
        var done = typeof WeakSet === "function" ? new WeakSet() : null;

        function fixRules(rules) {
            for (var i = 0; rules && i < rules.length; ++i) {
                var r = rules[i];
                if (r.cssRules && !r.style) { fixRules(r.cssRules); continue; }
                var s = r.style;
                if (!s) continue;
                var prop = s.getPropertyValue("-webkit-border-image") ? "-webkit-border-image" : "border-image-source";
                var img = s.getPropertyValue(prop);
                if (!img || s.getPropertyValue("border-top-style"))
                    continue;
                s.setProperty("border-style", img === "none" ? "none" : "solid", s.getPropertyPriority(prop));
            }
        }

        function fixSheet(sheet) {
            if (!sheet || (done && done.has(sheet))) return;
            var rules;
            try { rules = sheet.cssRules; } catch (e) { return; } // not loaded yet
            if (!rules) return;
            if (done) done.add(sheet);
            fixRules(rules);
        }

        function fixAll() {
            for (var i = 0; i < doc.styleSheets.length; ++i) fixSheet(doc.styleSheets[i]);
        }

        new MutationObserver(function (records) {
            records.forEach(function (rec) {
                Array.prototype.forEach.call(rec.addedNodes, function (n) {
                    if (n.nodeName === "LINK") n.addEventListener("load", function () { fixSheet(n.sheet); });
                    else if (n.nodeName === "STYLE") fixSheet(n.sheet);
                });
            });
        }).observe(doc, { childList: true, subtree: true });
        doc.addEventListener("DOMContentLoaded", fixAll);
        global.addEventListener("load", fixAll);
    })();

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
})(this);
