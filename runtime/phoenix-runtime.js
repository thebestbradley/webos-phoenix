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

    // ================================================================================
    // Phone and Messaging services (simulated legacy webOS APIs used by apps/phone
    // and apps/messaging)
    // ================================================================================
    //
    // webOS OSE has no telephony. The Phone and Messaging apps code against
    // the legacy webOS services as LuneOS (webOS-ports) reimplemented them on
    // oFono, and this block simulates exactly those calls:
    //
    //   com.palm.telephony                   webOS-ports/webos-telephonyd src/telephonyservice.c,
    //                                        src/telephonyservice_call.c, src/telephonyservice_sms.c
    //       dial {number, blockId}, answer {id}, ignore {id}, hangup {id},
    //       isTelephonyReady, powerQuery, platformQuery, networkStatusQuery
    //     Phoenix additions (telephonyd leaves call state to oFono, which the
    //     LuneOS phone app reads directly; shaped after oFono's VoiceCall,
    //     CallVolume and MessageWaiting D-Bus APIs, see apps/shared/luna/src/telephony.ts):
    //       callStatusQuery {subscribe}, hold {id}, unhold {id}, sendDtmf {tones},
    //       muteSet {mute}, speakerSet {speaker}, voicemailQuery {subscribe}
    //   org.webosports.service.messaging     webOS-ports/org.webosports.messaging
    //       putMessage {message} -> {threadids}   service/javascript/assistants/PutMessage.js,
    //                                              utils/MessageAssigner.js (thread assignment)
    //   db8 kinds com.palm.smsmessage:1 (extends com.palm.message:1), com.palm.chatthread:1,
    //   com.palm.phonecall:1, com.palm.person:1 (contacts linker schema).
    //
    // Outgoing texts are "sent" as telephonyd does it: a message put in folder
    // "outbox" with status "pending" goes to "sending", then "successful"
    // (or "failed" in airplane mode). Received texts are stored like
    // telephonyservice_sms.c stores them (folder inbox, status successful,
    // from.addr, flags.read false) and assigned to a chat thread.
    //
    // Call state lives in the shared store ("telephony:state"), so the Phone
    // card and any other page see the same calls; other windows' changes
    // arrive as "storage" events. db8 watches also fire across windows here,
    // so Messaging updates when a text arrives through another page.
    //
    // Simulator helpers (phoenix-sim F4 / F5, tools/test-phone-messaging.cjs):
    //   __phoenixRuntime.simulateIncomingCall({number?, name?}) -> call id
    //   __phoenixRuntime.simulateRemoteHangup()
    //   __phoenixRuntime.simulateIncomingSms({from?, text?})
    //   __phoenixRuntime.seedPhoneDemoData(force)   fictional contacts, calls, texts
    // A received text is announced with the host message
    //   phoenixHost.postToHost("notification", {appId, title, body})
    // which the shell shows as a banner and dashboard item for that app.
    (function phoneServices() {
        var KEY = "telephony:state";
        var PHONE_APP = "org.webosphoenix.phone";
        var MESSAGING_APP = "org.webosphoenix.messaging";

        function defaults() {
            return { calls: [], muted: false, speaker: false, nextId: 1,
                     voicemail: { number: "(408) 555-0100", waiting: true, count: 2 } };
        }
        function load() {
            var s = store.get(KEY, null);
            if (!s) return defaults();
            var d = defaults();
            for (var k in d) if (!(k in s)) s[k] = d[k];
            return s;
        }
        var listeners = [];
        function changed() { listeners.slice().forEach(function (fn) { fn(); }); }
        function save(s) { store.set(KEY, s); changed(); }
        function status(s) {
            return ok({ calls: s.calls, muted: !!s.muted, speaker: !!s.speaker });
        }
        function listen(ctx, fn) {
            listeners.push(fn);
            var prev = ctx.onCancel;
            ctx.onCancel = function () {
                var i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
                if (prev) prev();
            };
        }
        function offline() {
            var st = store.get("settings:state", null);
            return !!(st && st.offlineMode);
        }
        function find(s, id) {
            for (var i = 0; i < s.calls.length; ++i) if (s.calls[i].id === id) return s.calls[i];
            return null;
        }
        function live(c) { return c.state !== "disconnected"; }

        // Ended calls stay in the list (state "disconnected") for a moment so
        // every page sees how they ended, then go.
        function end(s, c, reason) {
            c.state = "disconnected";
            c.disconnectReason = reason;
            c.endTime = Date.now();
            if (!s.calls.some(live)) { s.muted = false; s.speaker = false; }
            setTimeout(function () {
                var t = load();
                var before = t.calls.length;
                t.calls = t.calls.filter(function (x) { return live(x) || Date.now() - (x.endTime || 0) < 1500; });
                if (t.calls.length !== before) save(t);
            }, 2000);
        }
        // Move a call on if it is still in one of the given states.
        function later(ms, id, from, fn) {
            setTimeout(function () {
                var s = load(), c = find(s, id);
                if (c && from.indexOf(c.state) >= 0) { fn(s, c); save(s); }
            }, ms);
        }
        function holdOthers(s, except) {
            s.calls.forEach(function (x) { if (x.id !== except && x.state === "active") x.state = "held"; });
        }
        function withCall(p, reply, states, fn) {
            var s = load(), c = find(s, p.id);
            if (!c || !live(c)) return reply(fail(-1, "No call with id " + p.id));
            if (states && states.indexOf(c.state) < 0) return reply(fail(-1, "Call " + p.id + " is " + c.state));
            fn(s, c);
            save(s);
            reply(ok());
        }

        function incoming(opts) {
            opts = opts || {};
            var s = load();
            var id = s.nextId++;
            var busy = s.calls.some(function (x) { return live(x) && x.state !== "incoming"; });
            s.calls.push({ id: id, state: busy ? "waiting" : "incoming", number: opts.number || "(415) 555-0123",
                           name: opts.name || undefined, direction: "incoming", startTime: Date.now() });
            save(s);
            // Unanswered calls stop ringing after 30 s (missed).
            later(opts.ringMs || 30000, id, ["incoming", "waiting"], function (t, c) { end(t, c, "remote"); });
            return id;
        }

        var telephony = {
            "/isTelephonyReady": function (p, reply) {
                reply(ok({ extended: { radioConnected: !offline(), networkRegistered: !offline(), dataRegistered: false, simReady: true } }));
            },
            "/platformQuery": function (p, reply) {
                reply(ok({ extended: { platformType: "gsm", imei: "000000000000000", version: "phoenix-sim" } }));
            },
            "/powerQuery": function (p, reply) { reply(ok({ extended: { powerState: offline() ? "off" : "on" } })); },
            "/networkStatusQuery": function (p, reply) {
                reply(ok({ extended: offline() ? { state: "noservice", registration: "notSearching" }
                                             : { state: "service", registration: "home", networkName: "Phoenix", rat: "umts" } }));
            },
            "/signalStrengthQuery": function (p, reply) { reply(ok({ bars: offline() ? 0 : 4, maxBars: 5 })); },
            "/callStatusQuery": function (p, reply, ctx) {
                reply(status(load()));
                if (p.subscribe) listen(ctx, function () { if (!ctx.cancelled()) reply(status(load())); });
            },
            "/dial": function (p, reply) {
                var number = String(p.number || "").replace(/[^0-9+*#,pw]/gi, "");
                if (!number) return reply(fail(-1, "Invalid number"));
                if (offline()) return reply(fail(-1, "The phone is off (airplane mode)"));
                var s = load();
                holdOthers(s, -1);
                var id = s.nextId++;
                s.calls.push({ id: id, state: "dialing", number: String(p.number), direction: "outgoing", startTime: Date.now() });
                save(s);
                reply(ok());
                later(700, id, ["dialing"], function (t, c) { c.state = "alerting"; });
                later(2200, id, ["dialing", "alerting"], function (t, c) { c.state = "active"; c.connectTime = Date.now(); });
            },
            "/answer": function (p, reply) {
                withCall(p, reply, ["incoming", "waiting"], function (s, c) {
                    holdOthers(s, c.id);
                    c.state = "active";
                    c.connectTime = Date.now();
                });
            },
            "/ignore": function (p, reply) {
                withCall(p, reply, ["incoming", "waiting"], function (s, c) { c.ignored = true; end(s, c, "local"); });
            },
            "/hangup": function (p, reply) {
                withCall(p, reply, null, function (s, c) { end(s, c, "local"); });
            },
            "/hold": function (p, reply) {
                withCall(p, reply, ["active"], function (s, c) { c.state = "held"; });
            },
            "/unhold": function (p, reply) {
                withCall(p, reply, ["held"], function (s, c) { holdOthers(s, c.id); c.state = "active"; });
            },
            "/sendDtmf": function (p, reply) {
                var s = load();
                if (!s.calls.some(function (x) { return x.state === "active"; })) return reply(fail(-1, "No active call"));
                if (!/^[0-9*#abcd]+$/i.test(String(p.tones || ""))) return reply(fail(-1, "Invalid tones"));
                reply(ok());
            },
            "/muteSet": function (p, reply) { var s = load(); s.muted = !!p.mute; save(s); reply(ok()); },
            "/speakerSet": function (p, reply) { var s = load(); s.speaker = !!p.speaker; save(s); reply(ok()); },
            "/voicemailQuery": function (p, reply, ctx) {
                var v = function () { var m = load().voicemail; return ok({ number: m.number, waiting: m.waiting, count: m.count }); };
                reply(v());
                if (p.subscribe) listen(ctx, function () { if (!ctx.cancelled()) reply(v()); });
            },
            // telephonyd's activity callback for the outbox (outgoing-sms.json).
            "/sendSmsFromDb": function (p, reply) { sendOutbox(); reply(ok()); }
        };
        register(["com.palm.telephony"], telephony);

        try {
            global.addEventListener("storage", function (e) { if (e.key === "phoenix:" + KEY) changed(); });
        } catch (x) { /* no window events */ }

        runtime.simulateIncomingCall = function (opts) { return incoming(opts); };
        runtime.simulateRemoteHangup = function () {
            var s = load();
            var c = s.calls.filter(function (x) { return x.state === "active"; })[0] || s.calls.filter(live)[0];
            if (!c) return false;
            end(s, c, "remote");
            save(s);
            return true;
        };

        // ---- db8 helpers and cross-window watches ------------------------------------

        var dbSvc = runtime.services["com.palm.db"];
        function dbCall(method, params) {
            var out;
            dbSvc[method](params, function (r) { if (out === undefined) out = r; }, { cancelled: function () { return true; } });
            return out || {};
        }

        // db8 watches in this page fire for changes other pages make, too.
        var xWatchers = [];
        function crossWindow(reply, ctx) {
            var done = false;
            xWatchers.push(function () {
                if (done || ctx.cancelled()) return;
                done = true;
                reply(ok({ fired: true }));
            });
            return function (r) {
                if (r && r.fired) { if (done) return; done = true; }
                reply(r);
            };
        }
        var baseFind = dbSvc["/find"], baseWatch = dbSvc["/watch"];
        dbSvc["/find"] = function (p, reply, ctx) {
            if (!p.watch) return baseFind(p, reply, ctx);
            baseFind(p, crossWindow(reply, ctx), ctx);
        };
        dbSvc["/watch"] = function (p, reply, ctx) { baseWatch(p, crossWindow(reply, ctx), ctx); };
        try {
            global.addEventListener("storage", function (e) {
                if (e.key !== "phoenix:db8:com.palm.db") return;
                var w = xWatchers;
                xWatchers = [];
                w.forEach(function (fn) { fn(); });
            });
        } catch (x) { /* no window events */ }

        // ---- Messaging: thread assignment (LuneOS MessageAssigner.js) ----------------

        function digits(n) { return String(n || "").replace(/[^0-9]/g, "").split("").reverse().join(""); }
        function sameNumber(a, b) {
            var x = digits(a), y = digits(b);
            if (!x || !y) return false;
            var n = Math.min(7, x.length, y.length);
            return x.slice(0, n) === y.slice(0, n) && (n >= 7 || x === y);
        }
        function personName(p) {
            var n = ((p.name && p.name.givenName) || "") + " " + ((p.name && p.name.familyName) || "");
            return n.trim() || p.nickname || "";
        }
        function personFor(addr) {
            var people = dbCall("/find", { query: { from: "com.palm.person:1" } }).results || [];
            for (var i = 0; i < people.length; ++i) {
                var nums = people[i].phoneNumbers || [];
                for (var j = 0; j < nums.length; ++j)
                    if (sameNumber(nums[j].value, addr)) return people[i];
            }
            return null;
        }

        // Find or create msg's chat thread, update it (summary, timestamp,
        // unread count) and store msg with conversations = [thread id].
        function assign(msg) {
            var incomingMsg = msg.folder === "inbox";
            var addr = incomingMsg ? (msg.from && msg.from.addr) : (msg.to && msg.to[0] && msg.to[0].addr);
            var person = addr ? personFor(addr) : null;
            var thread = null;
            if (msg.conversations && msg.conversations.length)
                thread = (dbCall("/get", { ids: [msg.conversations[0]] }).results || [])[0] || null;
            if (!thread) {
                var threads = dbCall("/find", { query: { from: "com.palm.chatthread:1" } }).results || [];
                for (var i = 0; i < threads.length && !thread; ++i) {
                    var t = threads[i];
                    if ((person && t.personId === person._id) || (!person && t.replyAddress && sameNumber(t.replyAddress, addr)))
                        thread = t;
                }
            }
            thread = thread || { _kind: "com.palm.chatthread:1", unreadCount: 0, flags: {} };
            thread.displayName = (person && personName(person)) || thread.displayName ||
                (!incomingMsg && msg.to[0].name) || addr;
            if (person) thread.personId = person._id;
            thread.normalizedAddress = digits(addr);
            thread.replyAddress = addr;
            thread.replyService = msg.serviceName || "sms";
            thread.summary = msg.messageText;
            thread.timestamp = msg.localTimestamp || Date.now();
            thread.flags = thread.flags || {};
            thread.flags.visible = true;
            if (incomingMsg && !(msg.flags && msg.flags.read)) thread.unreadCount = (thread.unreadCount || 0) + 1;
            var put = dbCall("/put", { objects: [thread] });
            var threadId = put.results[0].id;
            msg.conversations = [threadId];
            var res = dbCall("/put", { objects: [msg] });
            return { threadId: threadId, messageId: res.results[0].id };
        }

        // telephonyd: pending outbox texts -> sending -> successful / failed.
        function sendOutbox() {
            var pending = dbCall("/find", { query: { from: "com.palm.smsmessage:1", where: [
                { prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] } }).results || [];
            pending.forEach(function (m) {
                dbCall("/merge", { objects: [{ _id: m._id, status: "sending" }] });
                setTimeout(function () {
                    dbCall("/merge", { objects: [{ _id: m._id, status: offline() ? "failed" : "successful" }] });
                }, 600);
            });
        }

        register(["org.webosports.service.messaging"], {
            "/putMessage": function (p, reply) {
                var msg = p.message;
                if (!msg || !msg._kind || (!msg.to && !msg.from))
                    return reply(fail(-1, "Requiring valid message argument with _kind member already set."));
                msg = JSON.parse(JSON.stringify(msg));
                var r = assign(msg);
                reply(ok({ threadids: [r.threadId] }));
                if (msg._kind === "com.palm.smsmessage:1" && msg.folder === "outbox" && msg.status === "pending")
                    setTimeout(sendOutbox, 250);
            }
        });

        runtime.simulateIncomingSms = function (opts) {
            opts = opts || {};
            var from = opts.from || "(650) 555-0187";
            var text = opts.text || "Are we still on for lunch at noon?";
            var now = Date.now();
            var r = assign({
                _kind: "com.palm.smsmessage:1", folder: "inbox", status: "successful", serviceName: "sms",
                messageText: text, localTimestamp: now, timestamp: now, simId: 0,
                from: { addr: from }, flags: { read: false, visible: true }
            });
            var person = personFor(from);
            host.postToHost("notification", { appId: MESSAGING_APP, title: person ? personName(person) : from, body: text,
                                              params: { threadId: r.threadId } });
            return r.threadId;
        };

        // ---- Demo data (simulator only; fictional people, 555 numbers) ---------------

        var SEED_VERSION = 1;
        runtime.seedPhoneDemoData = function (force) {
            if (!force && store.get("telephony:seeded", 0) === SEED_VERSION) return false;
            [["com.palm.person:1", []], ["com.palm.message:1", []], ["com.palm.smsmessage:1", ["com.palm.message:1"]],
             ["com.palm.chatthread:1", []], ["com.palm.phonecall:1", []]].forEach(function (k) {
                dbCall("/putKind", { id: k[0], owner: "org.webosphoenix.simulator", extends: k[1] });
            });
            var people = [
                ["Ada", "Palmer", true, [["(408) 555-0142", "type_mobile"]]],
                ["Marcus", "Reyes", true, [["(650) 555-0187", "type_mobile"], ["(650) 555-0110", "type_work"]]],
                ["Priya", "Nair", true, [["(415) 555-0123", "type_mobile"]]],
                ["Lena", "Okafor", true, [["(212) 555-0164", "type_mobile"]]],
                ["Jonah", "Whitfield", false, [["(408) 555-0199", "type_home"]]],
                ["Sam", "Delgado", false, [["(303) 555-0135", "type_mobile"]]],
                ["Theo", "Lindqvist", false, [["(206) 555-0171", "type_work"]]]
            ].map(function (d, i) {
                return { _id: "phoenix-demo-person-" + (i + 1), _kind: "com.palm.person:1",
                         name: { givenName: d[0], familyName: d[1] }, nickname: "", favorite: d[2],
                         sortKey: (d[1] + " " + d[0]).toUpperCase(),
                         phoneNumbers: d[3].map(function (n, j) {
                             return { value: n[0], type: n[1], normalizedValue: digits(n[0]), primary: j === 0 };
                         }) };
            });
            dbCall("/put", { objects: people });

            var now = Date.now(), min = 60000, hour = 60 * min, day = 24 * hour;
            function addr(p, n) {
                var o = { addr: n, service: "com.palm.telephony", normalizedAddr: digits(n) };
                if (p) { o.name = personName(p); o.personId = p._id; o.personGivenName = p.name.givenName; o.personFamilyName = p.name.familyName; }
                return o;
            }
            var calls = [
                ["missed", people[2], "(415) 555-0123", 25 * min, 0],
                ["outgoing", people[1], "(650) 555-0187", 2 * hour, 4 * min + 12000],
                ["incoming", people[0], "(408) 555-0142", day + 3 * hour, 12 * min + 40000],
                ["missed", null, "(510) 555-0118", day + 5 * hour, 0],
                ["outgoing", people[3], "(212) 555-0164", 3 * day, 58000],
                ["incoming", people[4], "(408) 555-0199", 4 * day + 2 * hour, 7 * min]
            ].map(function (c, i) {
                var t = now - c[3];
                var party = addr(c[1], c[2]);
                var rec = { _id: "phoenix-demo-call-" + (i + 1), _kind: "com.palm.phonecall:1", type: c[0], duration: c[4],
                            timestamp: t, timestampInSecs: Math.floor(t / 1000) };
                if (c[0] === "outgoing") { rec.from = { addr: "", service: "com.palm.telephony" }; rec.to = [party]; }
                else { rec.from = party; rec.to = [{ addr: "", service: "com.palm.telephony" }]; }
                return rec;
            });
            dbCall("/put", { objects: calls });

            // Conversations: [person index, [minutes ago, incoming?, text]...]
            [[0, [[3 * 24 * 60, true, "Did you see the Pre 3 is back?"], [3 * 24 * 60 - 2, false, "Running Phoenix on it right now"],
                   [3 * 24 * 60 - 5, true, "Cards! I missed cards."]]],
             [3, [[26 * 60, false, "Landing at 6. Dinner?"], [26 * 60 - 4, true, "Yes! The usual place"]]],
             [1, [[95, true, "Can you send me the build notes?"], [90, false, "Sure, give me a minute"],
                  [12, true, "Thanks, got them. The new dial pad looks great"]]]
            ].forEach(function (conv) {
                var p = people[conv[0]], number = p.phoneNumbers[0].value;
                conv[1].forEach(function (m, i) {
                    var t = now - m[0] * min;
                    var last = i === conv[1].length - 1;
                    assign(m[1] ? { _kind: "com.palm.smsmessage:1", folder: "inbox", status: "successful", serviceName: "sms",
                                    messageText: m[2], localTimestamp: t, timestamp: t, from: { addr: number },
                                    flags: { read: !(last && conv[0] === 1), visible: true } }
                                : { _kind: "com.palm.smsmessage:1", folder: "outbox", status: "successful", serviceName: "sms",
                                    messageText: m[2], localTimestamp: t, timestamp: t, to: [{ addr: number, name: personName(p) }],
                                    flags: { read: true, visible: true } });
                });
            });
            store.set("telephony:seeded", SEED_VERSION);
            return true;
        };
        runtime.seedPhoneDemoData(false);

        // Ids for the shell (sim.qml F4 / F5).
        runtime.phoneAppId = PHONE_APP;
        runtime.messagingAppId = MESSAGING_APP;
    })();

    // ================================================================================
    // Media services (simulated webOS OSE APIs used by apps/camera, apps/photos, apps/music)
    // ================================================================================
    //
    // Sources (webosose repositories, master branch):
    //
    //   com.webos.service.mediaindexer   com.webos.service.mediaindexer src/indexerservice.cpp,
    //                                    src/dbconnector/mediadb.cpp, src/mediaitem.cpp
    //       getImageList / getAudioList / getVideoList {uri?, count?, subscribe?}
    //           -> {imageList|audioList|videoList: {results, count}}; with subscribe
    //              the first reply is {subscribed: true} and the list follows,
    //              again whenever the index changes
    //       getImageMetadata / getAudioMetadata / getVideoMetadata {uri} -> {metadata}
    //       requestDelete {uri}         drop an item from the index
    //       requestMediaScan {path}     rescan a storage device (com.webos.app.camera
    //                                   calls it after taking a snapshot)
    //       getDeviceList               the storage devices ("storage" plugin)
    //     Item fields as in mediadb.cpp's select lists: uri, file_path, type, mime,
    //     title, width, height, file_size, last_modified_date, dirty; audio adds
    //     artist, album, genre, duration, thumbnail, track, ... Item uris are the
    //     device uri + path: "storage:///media/internal/DCIM/100PHNX/CIMG0001.jpg".
    //   com.webos.service.camera2        com.webos.service.camera src/services/camera/camera_service.cpp
    //       getCameraList {subscribe?} -> {deviceList: [{id: "camera1"}]}, getInfo {id}
    //       (the simulator lists the browser's video inputs)
    //   legacy db8 kinds (webOS 2.x/3.x)  com.palm.media.image.file:1, com.palm.media.audio.file:1,
    //       com.palm.media.video.file:1: the index is mirrored into the simulated
    //       com.palm.db so legacy apps that query the old kinds see the same media
    //   org.webosphoenix.service.mediafiles   Phoenix, simulator only so far: write
    //       {path, data (base64), mimeType} and remove {path} under /media/internal.
    //       A web page cannot write files on OSE; the camera's captures go through
    //       this until a Phoenix service provides it on the device (Milestone 1).
    //
    // Files live in IndexedDB ("phoenix-media"), shared by every app page, and
    // the index in the shared store under "media:index". The demo media
    // (apps/media-samples, mounted at /media/internal/samples) is indexed from
    // its index.json on first use. __phoenixRuntime.mediaFiles.url(path) gives
    // a URL for any media path (a blob: URL for stored files); on a device an
    // app uses "file://" + path.
    //
    // Wallpaper: Photos sets it with system service setPreferences {wallpaper}
    // like Settings. For a /media/ file the runtime adds wallpaperUrl (a data:
    // URL of the picture) to "systemStatus", because the shell cannot read
    // IndexedDB.
    (function mediaServices() {
        var MEDIA_ROOT = "/media/internal";
        var DEVICE_URI = "storage://" + MEDIA_ROOT;
        var INDEX_KEY = "media:index";
        var WALLPAPER_KEY = "media:wallpaper";
        var SAMPLES_INDEX = MEDIA_ROOT + "/samples/index.json";
        var LEGACY_KINDS = { image: "com.palm.media.image.file:1", audio: "com.palm.media.audio.file:1", video: "com.palm.media.video.file:1" };
        var LIST_KEYS = { image: "imageList", audio: "audioList", video: "videoList" };
        var MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
                     ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
                     webm: "video/webm", mp4: "video/mp4" };

        function isMediaPath(p) {
            return typeof p === "string" && p.indexOf(MEDIA_ROOT + "/") === 0 && p.split("/").indexOf("..") < 0;
        }
        function extOf(p) { var m = /\.([a-z0-9]+)$/i.exec(p || ""); return m ? m[1].toLowerCase() : ""; }
        function typeOf(p) { var m = MIME[extOf(p)] || ""; return m ? m.split("/")[0] : ""; }
        function titleOf(p) { return String(p).replace(/^.*\//, "").replace(/\.[^.]*$/, ""); }

        // ---- Files (IndexedDB, or memory where there is none: jsdom, private mode) ----

        var memFiles = {};
        var dbPromise = null;
        function idb() {
            if (!dbPromise) {
                dbPromise = new Promise(function (resolve) {
                    try {
                        if (!global.indexedDB) return resolve(null);
                        var req = global.indexedDB.open("phoenix-media", 1);
                        req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
                        req.onsuccess = function () { resolve(req.result); };
                        req.onerror = function () { resolve(null); };
                    } catch (e) {
                        resolve(null);
                    }
                });
            }
            return dbPromise;
        }
        function tx(mode, fn) {
            return idb().then(function (db) {
                if (!db) return fn(null);
                return new Promise(function (resolve, reject) {
                    var t = db.transaction("files", mode), st = t.objectStore("files"), result;
                    Promise.resolve(fn(st)).then(function (r) { result = r; }, function () { /* t.onerror */ });
                    t.oncomplete = function () { resolve(result); };
                    t.onerror = function () { reject(t.error); };
                });
            });
        }
        function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

        var urlCache = {};
        var files = runtime.mediaFiles = {
            write: function (path, blob) {
                delete urlCache[path];
                return tx("readwrite", function (st) {
                    if (!st) { memFiles[path] = blob; return; }
                    return reqP(st.put(blob, path));
                });
            },
            read: function (path) {
                return tx("readonly", function (st) {
                    if (!st) return memFiles[path] || null;
                    return reqP(st.get(path)).then(function (b) { return b || null; });
                });
            },
            remove: function (path) {
                if (urlCache[path] && urlCache[path].indexOf("blob:") === 0) try { URL.revokeObjectURL(urlCache[path]); } catch (e) { /* ignore */ }
                delete urlCache[path];
                return tx("readwrite", function (st) {
                    if (!st) { delete memFiles[path]; return; }
                    return reqP(st.delete(path));
                });
            },
            list: function (prefix) {
                return tx("readonly", function (st) {
                    if (!st) return Object.keys(memFiles).filter(function (k) { return k.indexOf(prefix) === 0; });
                    return reqP(st.getAllKeys()).then(function (keys) {
                        return keys.filter(function (k) { return String(k).indexOf(prefix) === 0; });
                    });
                });
            },
            /** A URL to show or play a media path: a blob: URL for stored files, else the path (rootfs). */
            url: function (path) {
                if (urlCache[path]) return Promise.resolve(urlCache[path]);
                return files.read(path).then(function (blob) {
                    var u = blob && global.URL && URL.createObjectURL ? URL.createObjectURL(blob) : path;
                    urlCache[path] = u;
                    return u;
                }, function () { return path; });
            }
        };

        // ---- The index ---------------------------------------------------------------

        function readSamples() {
            try {
                var txt = PalmSystem.getResource(SAMPLES_INDEX);
                return txt ? JSON.parse(txt) : null;
            } catch (e) {
                return null;
            }
        }

        function makeItem(type, rec) {
            var item = { uri: "storage://" + rec.file_path, file_path: rec.file_path, type: type, dirty: false,
                         mime: rec.mime || MIME[extOf(rec.file_path)] || "", title: rec.title || titleOf(rec.file_path),
                         file_size: rec.file_size || 0, last_modified_date: rec.last_modified_date || new Date().toISOString() };
            for (var k in rec) if (!(k in item)) item[k] = rec[k];
            return item;
        }

        function loadIndex() {
            var idx = store.get(INDEX_KEY, null);
            if (idx) return idx;
            idx = { image: [], audio: [], video: [] };
            var s = readSamples();
            if (s) {
                (s.images || []).forEach(function (r) { idx.image.push(makeItem("image", r)); });
                (s.audios || []).forEach(function (r) { idx.audio.push(makeItem("audio", r)); });
                (s.videos || []).forEach(function (r) { idx.video.push(makeItem("video", r)); });
            }
            saveIndex(idx, true);
            return idx;
        }

        var listWatchers = [];
        function notify() { listWatchers.slice().forEach(function (w) { w(); }); }

        function saveIndex(idx, quiet) {
            store.set(INDEX_KEY, idx);
            mirrorLegacy(idx);
            if (!quiet) notify();
        }

        // Other app pages changed the index (a photo taken in Camera shows up in Photos).
        try {
            global.addEventListener("storage", function (e) {
                if (e.key === "phoenix:" + INDEX_KEY) notify();
            });
        } catch (e) { /* ignore */ }

        // ---- Legacy db8 kinds -------------------------------------------------------------

        function legacyObject(item) {
            var t = Date.parse(item.last_modified_date) || Date.now();
            var o = { _kind: LEGACY_KINDS[item.type], path: item.file_path, size: item.file_size, mimeType: item.mime,
                      createdTime: t, modifiedTime: t, title: item.title };
            if (item.type === "image" || item.type === "video") {
                o.width = item.width || 0;
                o.height = item.height || 0;
                o.albumPath = item.file_path.replace(/\/[^\/]*$/, "");
            }
            if (item.type === "audio") {
                o.artist = item.artist || "";
                o.album = item.album || "";
                o.genre = item.genre || "";
                o.duration = item.duration || 0;
                o.track = { position: item.track || 0, total: item.total_tracks || 0 };
                o.thumbnails = item.thumbnail ? [{ data: item.thumbnail, type: "embedded" }] : [];
            }
            return o;
        }

        function mirrorLegacy(idx) {
            var db = runtime.services["com.palm.db"];
            if (!db) return;
            var noop = function () {};
            var ctx = { cancelled: function () { return true; } };
            Object.keys(LEGACY_KINDS).forEach(function (type) {
                db["/del"]({ query: { from: LEGACY_KINDS[type] }, purge: true }, noop, ctx);
                var objs = (idx[type] || []).map(legacyObject);
                if (objs.length) db["/put"]({ objects: objs }, noop, ctx);
            });
        }

        // ---- Scanning -----------------------------------------------------------------------

        function probe(type, blob) {
            if (type === "image" && global.createImageBitmap) {
                return global.createImageBitmap(blob).then(function (bmp) {
                    var r = { width: bmp.width, height: bmp.height };
                    if (bmp.close) bmp.close();
                    return r;
                }, function () { return {}; });
            }
            if ((type === "video" || type === "audio") && global.document && global.URL && URL.createObjectURL) {
                return new Promise(function (resolve) {
                    var el = global.document.createElement(type);
                    var u = URL.createObjectURL(blob);
                    var done = function (r) { URL.revokeObjectURL(u); resolve(r); };
                    el.preload = "metadata";
                    el.onloadedmetadata = function () {
                        var d = isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : 0;
                        done(type === "video" ? { duration: d, width: el.videoWidth, height: el.videoHeight } : { duration: d });
                    };
                    el.onerror = function () { done({}); };
                    setTimeout(function () { done({}); }, 3000);
                    el.src = u;
                });
            }
            return Promise.resolve({});
        }

        function scan(path) {
            return files.list(path).then(function (paths) {
                var idx = loadIndex();
                var known = {};
                ["image", "audio", "video"].forEach(function (t) { idx[t].forEach(function (it) { known[it.file_path] = true; }); });
                var fresh = paths.filter(function (p) { return !known[p] && typeOf(p); });
                return Promise.all(fresh.map(function (p) {
                    return files.read(p).then(function (blob) {
                        var type = typeOf(p);
                        return probe(type, blob).then(function (meta) {
                            var rec = { file_path: p, file_size: blob ? blob.size : 0, mime: MIME[extOf(p)], last_modified_date: new Date().toISOString() };
                            for (var k in meta) rec[k] = meta[k];
                            return makeItem(type, rec);
                        });
                    });
                })).then(function (items) {
                    // Stored files that are gone leave the index (the samples are not stored).
                    var stored = {};
                    paths.forEach(function (p) { stored[p] = true; });
                    var idx2 = loadIndex();
                    var removed = 0;
                    ["image", "audio", "video"].forEach(function (t) {
                        idx2[t] = idx2[t].filter(function (it) {
                            var gone = it.file_path.indexOf(path) === 0 && it.file_path.indexOf(MEDIA_ROOT + "/samples/") !== 0 && !stored[it.file_path];
                            if (gone) removed++;
                            return !gone;
                        });
                    });
                    items.forEach(function (it) { idx2[it.type].push(it); });
                    if (items.length || removed) saveIndex(idx2);
                    return items.length;
                });
            });
        }

        // ---- com.webos.service.mediaindexer -------------------------------------------------

        function listReply(type, p) {
            var items = loadIndex()[type].filter(function (it) {
                return !p.uri || it.uri.indexOf(p.uri) === 0;
            });
            if (p.count) items = items.slice(0, p.count);
            var r = ok({});
            r[LIST_KEYS[type]] = { results: items, count: items.length };
            return r;
        }

        function listMethod(type) {
            return function (p, reply, ctx) {
                if (p.count !== undefined && (p.count < 0 || p.count > 500))
                    return reply(fail(-1, "Invalid request count"));
                if (p.subscribe) {
                    reply(ok({ subscribed: true }));
                    var w = function () { if (!ctx.cancelled()) reply(listReply(type, p)); };
                    listWatchers.push(w);
                    ctx.onCancel = function () { listWatchers = listWatchers.filter(function (x) { return x !== w; }); };
                    setTimeout(w, 0);
                } else {
                    reply(listReply(type, p));
                }
            };
        }

        function metadataMethod(type) {
            return function (p, reply) {
                if (!p.uri) return reply(fail(-1, "client must specify uri"));
                var it = loadIndex()[type].filter(function (x) { return x.uri === p.uri; })[0];
                reply(it ? ok({ metadata: it }) : fail(-1, "Invalid uri"));
            };
        }

        register(["com.webos.service.mediaindexer"], {
            "/getImageList": listMethod("image"),
            "/getAudioList": listMethod("audio"),
            "/getVideoList": listMethod("video"),
            "/getImageMetadata": metadataMethod("image"),
            "/getAudioMetadata": metadataMethod("audio"),
            "/getVideoMetadata": metadataMethod("video"),
            "/getDeviceList": function (p, reply) {
                reply(ok({ pluginList: [{ active: true, uri: "storage", deviceList: [
                    { uri: DEVICE_URI, name: "Media", description: "Internal media storage", available: true,
                      mountpoint: MEDIA_ROOT, imageCount: loadIndex().image.length,
                      audioCount: loadIndex().audio.length, videoCount: loadIndex().video.length }
                ] }] }));
            },
            "/requestDelete": function (p, reply) {
                if (!p.uri) return reply(fail(-1, "client must specify uri"));
                var idx = loadIndex(), n = 0;
                ["image", "audio", "video"].forEach(function (t) {
                    idx[t] = idx[t].filter(function (it) { if (it.uri === p.uri) { n++; return false; } return true; });
                });
                if (n) saveIndex(idx);
                reply(ok());
            },
            "/requestMediaScan": function (p, reply) {
                if (!p.path) return reply(fail(-1, "client must specify path"));
                if (p.path.indexOf(MEDIA_ROOT) !== 0 && MEDIA_ROOT.indexOf(p.path) !== 0)
                    return reply(fail(-1, "No device for path " + p.path));
                scan(p.path.indexOf(MEDIA_ROOT) === 0 ? p.path : MEDIA_ROOT).then(function () { reply(ok()); },
                    function (e) { reply(fail(-1, String(e && e.message || e))); });
            }
        });

        // ---- org.webosphoenix.service.mediafiles (Phoenix, simulator only so far) ----------

        function b64ToBlob(data, type) {
            var bin = global.atob(data), bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; ++i) bytes[i] = bin.charCodeAt(i);
            return new Blob([bytes], { type: type || "" });
        }

        register(["org.webosphoenix.service.mediafiles"], {
            "/write": function (p, reply) {
                if (!isMediaPath(p.path)) return reply(fail(-1, "path must be under " + MEDIA_ROOT));
                if (typeof p.data !== "string") return reply(fail(-1, "data (base64) is required"));
                var blob;
                try { blob = b64ToBlob(p.data, p.mimeType || MIME[extOf(p.path)]); }
                catch (e) { return reply(fail(-1, "data is not base64")); }
                files.write(p.path, blob).then(function () { reply(ok({ path: p.path, file_size: blob.size })); },
                    function (e) { reply(fail(-1, "write failed: " + (e && e.message || e))); });
            },
            "/remove": function (p, reply) {
                if (!isMediaPath(p.path)) return reply(fail(-1, "path must be under " + MEDIA_ROOT));
                files.remove(p.path).then(function () { reply(ok()); },
                    function (e) { reply(fail(-1, "remove failed: " + (e && e.message || e))); });
            }
        });

        // ---- com.webos.service.camera2 ---------------------------------------------------

        function videoInputs() {
            var md = global.navigator && global.navigator.mediaDevices;
            if (!md || !md.enumerateDevices) return Promise.resolve([]);
            return md.enumerateDevices().then(function (ds) {
                return ds.filter(function (d) { return d.kind === "videoinput"; });
            }, function () { return []; });
        }

        register(["com.webos.service.camera2"], {
            "/getCameraList": function (p, reply) {
                videoInputs().then(function (list) {
                    var r = ok({ deviceList: list.map(function (d, i) { return { id: "camera" + (i + 1) }; }) });
                    if (p.subscribe) r.subscribed = true;
                    reply(r);
                });
            },
            "/getInfo": function (p, reply) {
                videoInputs().then(function (list) {
                    var n = parseInt(String(p.id || "").replace("camera", ""), 10);
                    var d = list[n - 1];
                    if (!d) return reply(fail(-1, "Invalid device id"));
                    reply(ok({ info: { name: d.label || "Camera " + n, type: "camera", builtin: true,
                        details: { video: { maxWidth: 1280, maxHeight: 720, frameRate: 30 } } } }));
                });
            }
        });

        // ---- Wallpaper from a media file ----------------------------------------------------

        // XHR rather than fetch: phoenix-sim's phoenix:// scheme only serves XHR and elements.
        function readUrl(path) {
            return new Promise(function (resolve) {
                try {
                    var req = new XMLHttpRequest();
                    req.open("GET", path, true);
                    req.responseType = "blob";
                    req.onload = function () { resolve(req.status >= 200 && req.status < 300 || req.status === 0 ? req.response : null); };
                    req.onerror = function () { resolve(null); };
                    req.send(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }

        function wallpaperData(path) {
            return files.read(path).then(function (blob) {
                return blob || readUrl(path);
            }).then(function (blob) {
                if (!blob || !global.FileReader) return null;
                return new Promise(function (resolve) {
                    var fr = new FileReader();
                    fr.onload = function () { resolve(fr.result); };
                    fr.onerror = function () { resolve(null); };
                    fr.readAsDataURL(blob);
                });
            }).then(null, function () { return null; });
        }

        var basePost = host.postToHost;
        host.postToHost = function (type, payload) {
            if (type === "systemStatus" && payload && isMediaPath(payload.wallpaperFile)) {
                var c = store.get(WALLPAPER_KEY, null);
                if (c && c.file === payload.wallpaperFile) payload.wallpaperUrl = c.url;
            }
            return basePost.call(host, type, payload);
        };

        var sysSvc = runtime.services["com.webos.service.systemservice"];
        if (sysSvc) {
            var baseSetPrefs = sysSvc["/setPreferences"];
            sysSvc["/setPreferences"] = function (p, reply, ctx) {
                var file = p.wallpaper && p.wallpaper.wallpaperFile;
                if (!isMediaPath(file)) return baseSetPrefs(p, reply, ctx);
                // Read the picture first so the systemStatus that setPreferences
                // sends already carries it.
                wallpaperData(file).then(function (url) {
                    if (url) store.set(WALLPAPER_KEY, { file: file, url: url });
                    baseSetPrefs(p, reply, ctx);
                });
            };
        }

        // A media wallpaper chosen earlier: tell the shell again, now with its picture.
        var wp = prefs().wallpaper;
        if (wp && isMediaPath(wp.wallpaperFile) && runtime.hostStatus)
            host.postToHost("systemStatus", runtime.hostStatus());
    })();
})(this);
