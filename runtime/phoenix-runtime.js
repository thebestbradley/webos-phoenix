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

    // ---- Prototype.js and the standard array methods ---------------------------
    //
    // Apps of the time bundle Prototype.js (Mojo does; Quickoffice's QOWT
    // carries a build of it), which puts its Enumerable on Array.prototype,
    // some, every and find among them. Those stop the loop by throwing
    // $break, which only Prototype's own each catches; a build whose
    // Array#each is a plain loop (QOWT's) lets it escape, so any some()
    // that finds a match throws: in the app's code and in this runtime's
    // services, which run in the page here (on a device they were across
    // the bus). Before any app script runs, the standard some, every and
    // find stay the browser's: an assignment is taken and ignored, so code
    // in strict mode does not fail either. Prototype's other methods
    // (any, detect, collect, ...) and its map and filter are left alone.
    (function keepStandardArrayMethods() {
        ["some", "every", "find"].forEach(function (name) {
            var native = Array.prototype[name];
            if (typeof native !== "function") return;
            try {
                Object.defineProperty(Array.prototype, name, {
                    configurable: false, enumerable: false,
                    get: function () { return native; },
                    set: function () { /* Prototype's; see above */ }
                });
            } catch (e) { /* already fixed by the page: leave it */ }
        });
    })();

    // ---- Host messaging --------------------------------------------------------

    var host = global.phoenixHost = global.phoenixHost || {
        postToHost: function (type, payload) {
            try {
                console.info("__phoenix__" + toJson({ type: type, payload: payload || {} }));
            } catch (e) { /* ignore */ }
        }
    };

    // ---- App identity ------------------------------------------------------------

    function appIdFromLocation() {
        var m = /\/usr\/palm\/applications\/([^\/]+)\//.exec(global.location.pathname);
        if (m)
            return m[1];
        // A framework page the app opened as a window (Enyo 1.0's dashboard
        // window) belongs to that app, as every window of an app did on webOS.
        try {
            var opener = global.opener;
            if (opener && opener.PalmSystem && opener.PalmSystem.appIdentifier)
                return opener.PalmSystem.appIdentifier;
        } catch (e) { /* another origin */ }
        return "com.webos.phoenix.unknown";
    }

    function queryParam(name) {
        var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(global.location.search);
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ---- JSON ---------------------------------------------------------------------
    //
    // Everything the runtime writes as JSON (its stores, service replies,
    // messages to the shell) goes through toJson. Prototype.js 1.6, which
    // 2011 apps bundled (Quickoffice's QOWT), adds Array.prototype.toJSON,
    // and JSON.stringify then writes every array as a string in Prototype's
    // format ({"a":"[1, 2]"}): saved from such a page, the shared settings,
    // media index and db8 came back broken in every other app.
    function toJson(value, replacer, space) {
        var A = Array.prototype;
        var d = Object.prototype.hasOwnProperty.call(A, "toJSON") ? Object.getOwnPropertyDescriptor(A, "toJSON") : null;
        if (!d || !d.configurable) return JSON.stringify(value, replacer, space);
        delete A.toJSON;
        try {
            return JSON.stringify(value, replacer, space);
        } finally {
            Object.defineProperty(A, "toJSON", d);
        }
    }

    // Data written that way before toJson: arrays saved as strings ("[1, 2]")
    // are arrays again. Once per profile (the stores are shared), and only
    // strings that are a JSON array.
    function repairPrototypeArrays(ls) {
        var FLAG = "phoenix:__arraysRepaired";
        if (ls.getItem(FLAG)) return;
        function fix(v) {
            if (typeof v === "string") {
                if (v.length >= 2 && v.charAt(0) === "[" && v.charAt(v.length - 1) === "]") {
                    try {
                        var a = JSON.parse(v);
                        if (Array.isArray(a)) return fix(a);
                    } catch (e) { /* a string, after all */ }
                }
                return v;
            }
            if (Array.isArray(v)) return v.map(fix);
            if (v && typeof v === "object") {
                var o = {};
                for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = fix(v[k]);
                return o;
            }
            return v;
        }
        var keys = [];
        for (var i = 0; i < ls.length; ++i) {
            var k = ls.key(i);
            if (k && k.indexOf("phoenix:") === 0) keys.push(k);
        }
        keys.forEach(function (k) {
            var raw = ls.getItem(k), v;
            try { v = JSON.parse(raw); } catch (e) { return; }
            var out = toJson(fix(v));
            if (out !== raw) {
                try { ls.setItem(k, out); } catch (e) { console.error("[phoenix-runtime] could not repair " + k, e); }
            }
        });
        ls.setItem(FLAG, "1");
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
        if (ls) {
            try { repairPrototypeArrays(ls); } catch (e) { console.error("[phoenix-runtime] array repair failed", e); }
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
                var s = toJson(value);
                if (ls) ls.setItem("phoenix:" + key, s);
                else mem[key] = s;
            }
        };
    })();

    // ---- Temporary files (/tmp) -----------------------------------------------------
    //
    // Files services hand each other by path that a device keeps in /tmp:
    // the backup service's tempDir (written by db8, luna-sysservice and the
    // shell) and the packages the Marketplace downloads for the installer.
    // In this page's memory.
    runtime.tmpFiles = (function () {
        var files = {};
        function bytesOf(v) { return typeof v === "string" ? new TextEncoder().encode(v) : v; }
        return {
            write: function (path, data) { files[path] = bytesOf(data); },
            read: function (path) {
                if (!files[path]) throw new Error("No such file: " + path);
                return files[path];
            },
            readText: function (path) { return new TextDecoder().decode(this.read(path)); },
            remove: function (dir) {
                var pre = dir.replace(/\/$/, "") + "/";
                Object.keys(files).forEach(function (k) { if (k.indexOf(pre) === 0) delete files[k]; });
            },
            list: function () { return Object.keys(files); }
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
        deviceInfo: toJson({
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
        // "free", "up", "down", "left", "right" (also "landscape",
        // "portrait"): the orientation the window keeps; the shell holds the
        // UI there while the card is maximized (see screenOrientationChanged).
        setWindowOrientation: function (o) {
            PalmSystem.specifiedWindowOrientation = o;
            host.postToHost("windowOrientation", { appId: PalmSystem.appIdentifier, orientation: String(o) });
        },
        // enyo.windows.setWindowProperties: blockScreenTimeout keeps the
        // screen on while the card is in front (a video, a flashlight).
        // setSubtleLightbar and fastAccelerometer have nothing to act on.
        setWindowProperties: function (props) {
            if (props && typeof props === "object" && "blockScreenTimeout" in props)
                host.postToHost("windowProperties", { appId: PalmSystem.appIdentifier, blockScreenTimeout: !!props.blockScreenTimeout });
        },
        enableFullScreenMode: function (on) { host.postToHost("fullScreen", { appId: PalmSystem.appIdentifier, on: !!on }); },
        allowResizeOnPositiveSpaceChange: function () {},
        receivePageUpDownInLandscape: function () {},
        // The virtual keyboard under the app's control (Enyo's enyo.keyboard manual
        // mode): see "Virtual keyboard" below.
        setManualKeyboardEnabled: function (on) { runtime.imeSetManual(on); },
        keyboardShow: function (type) { runtime.imeManualShow(type); },
        keyboardHide: function () { runtime.imeManualHide(); },
        editorFocused: function () {},
        // Pastes the system clipboard into the focused field (Enyo's Input
        // and enyo.dom.getClipboard call it): see "Editing" below.
        paste: function () { runtime.paste(); },
        // An app telling the system it used the clipboard (the Isis browser);
        // nothing to do here.
        copiedToClipboard: function () {},
        pastedFromClipboard: function () {},
        printFrame: function () { global.print && global.print(); },
        // The TouchPad launcher's glow on a tapped icon (Just Type).
        applyLaunchFeedback: function () {},
        simulateMouseClick: function () {},
        useSimulatedMouseClicks: function () {},
        runTextIndexer: function (text) { return text; },
        // A sound for the app, without a banner (Email's new-mail sound):
        // LunaSysMgr's BannerMessageHandler played it by the same rules as a
        // banner's (PlaySound event). The shell picks the file and plays it.
        playSoundNotification: function (soundClass, soundFile, duration, wakeupScreen) {
            host.postToHost("sound", { appId: PalmSystem.appIdentifier, soundClass: soundClass ? String(soundClass) : "",
                                       soundFile: soundFile ? String(soundFile) : "", duration: duration | 0,
                                       wakeupScreen: !!wakeupScreen });
        },
        setAlertSound: function () {},
        receiveKeyEvents: function () {},

        // (message, launchParams, icon, soundClass, soundFile, duration,
        // doNotSuppress): the banner's sound plays as it shows (luna-systemui's
        // "Charging Battery" with charging.mp3).
        addBannerMessage: function (msg, params, icon, soundClass, soundFile, duration) {
            var id = "b" + Date.now();
            host.postToHost("banner", { id: id, appId: PalmSystem.appIdentifier, message: msg, params: params, icon: icon,
                                        soundClass: soundClass ? String(soundClass) : "", soundFile: soundFile ? String(soundFile) : "",
                                        duration: duration | 0 });
            return id;
        },
        removeBannerMessage: function (id) { host.postToHost("removeBanner", { id: id }); },
        clearBannerMessages: function () {},
        addNewContentIndicator: function () { return "nci"; },
        removeNewContentIndicator: function () {},
        // The phone's active-call banner (ActiveCallBanner.cpp): who the call
        // is with, timed from startTime (seconds since 1970); a tap
        // relaunches the app with {action: "activecall"}.
        addActiveCallBanner: function (icon, message, startTime) {
            host.postToHost("activeCallBanner", { op: "add", icon: icon ? String(icon) : "", message: String(message || ""),
                                                  startTime: +startTime || 0 });
        },
        removeActiveCallBanner: function () { host.postToHost("activeCallBanner", { op: "remove" }); },
        updateActiveCallBanner: function (icon, message, startTime) {
            host.postToHost("activeCallBanner", { op: "update", icon: icon ? String(icon) : "", message: String(message || ""),
                                                  startTime: +startTime || 0 });
        },

        // Synchronous file read. Returns undefined for missing files, which
        // MojoLoader relies on (e.g. to fall back from concatenated.js to the
        // individual sources listed in a framework's manifest). With "json"
        // in its flags ("const json", as enyo.fetchConfigFile asks for
        // appinfo.json) the file is parsed, as WebAppManager did: Enyo apps
        // read enyo.fetchAppInfo().version and the like.
        getResource: function (path, flags) {
            var text;
            try {
                var req = new XMLHttpRequest();
                req.open("GET", path, false);
                req.send(null);
                text = req.status >= 200 && req.status < 300 ? req.responseText : undefined;
            } catch (e) {
                // Custom schemes (phoenix-sim) report a missing file by throwing.
                return undefined;
            }
            return asResource(text, flags);
        },
        getIdentifierForFrame: function () { return PalmSystem.identifier; },
        getLocalizedString: function (s) { return s; }
    };

    global.PalmSystem = PalmSystem;

    // getResource's flags: "json" (with "const") parses the file (a BOM and
    // all); otherwise the text.
    function asResource(text, flags) {
        if (text === undefined || !/\bjson\b/.test(String(flags || ""))) return text;
        try { return JSON.parse(String(text).replace(/^\ufeff/, "")); } catch (e) { return undefined; }
    }

    // Window types. Enyo opens alerts and dashboards with window.open(url,
    // name, "height=150, attributes={\"window\":\"popupalert\", ...}")
    // (enyo.windows.openPopup/openDashboard) and LunaSysMgr read the type
    // from the attributes. Browsers do not pass window features on, so the
    // runtime puts the type, height, icon, window name, clickableWhenLocked
    // (a dashboard that takes taps on the lock screen) and a popup alert's
    // sound and sound class (AlertWindow::setSoundParams: {"sound": path,
    // "soundclass": "ringtones"}) in the new window's URL fragment
    // (#phoenixWindow=popupalert&phoenixHeight=150), where the simulator's
    // window source reads them.
    if (typeof global.open === "function") {
        var nativeOpen = global.open;
        global.open = function (url, name, features) {
            var f = String(features || ""), attrs = {};
            var m = /attributes=(\{.*\})/.exec(f);
            if (m) { try { attrs = JSON.parse(m[1]); } catch (e) { attrs = {}; } }
            if (attrs.window && attrs.window !== "card" && typeof url === "string") {
                var h = /height=(\d+)/.exec(f);
                // A relative icon (enyo.Dashboard's smallIcon, "images/...") is
                // the app's: the shell gets its device path.
                if (attrs.icon && !/^\//.test(attrs.icon)) {
                    try { attrs.icon = decodeURIComponent(new URL(attrs.icon, global.location.href).pathname); } catch (e) { /* as it is */ }
                }
                url += (url.indexOf("#") < 0 ? "#" : "&") + "phoenixWindow=" + encodeURIComponent(attrs.window)
                     + (h ? "&phoenixHeight=" + h[1] : "")
                     + (attrs.icon ? "&phoenixIcon=" + encodeURIComponent(attrs.icon) : "")
                     + (name ? "&phoenixName=" + encodeURIComponent(name) : "")
                     + (attrs.clickableWhenLocked ? "&phoenixClickableWhenLocked=1" : "")
                     + (attrs.sound ? "&phoenixSound=" + encodeURIComponent(attrs.sound) : "")
                     + (attrs.soundclass ? "&phoenixSoundClass=" + encodeURIComponent(attrs.soundclass) : "");
            }
            return nativeOpen.call(global, url, name, features);
        };
    }
    global.palmGetResource = function (path, flags) { return PalmSystem.getResource(path, flags); };

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
            console.error("[phoenix-runtime] " + url + " threw", e && e.stack ? e.stack : e);
            reply(fail(-1, String(e && e.message || e)));
        }
    }
    // Calls made but not yet dispatched. A page that calls a service and
    // closes its window at once (Enyo's alerts: call, then close()) would
    // lose the call with its timer; on a device it was already on the bus.
    // Calls made while the page is going away (a pagehide handler turning the
    // torch off) are dispatched at once: the timer would never fire. The
    // listener is a capture one so that it runs before the page's own
    // pagehide handlers.
    var unsent = {}, nextUnsent = 1, unloading = false;
    try {
        global.addEventListener("pagehide", function () {
            unloading = true;
            Object.keys(unsent).forEach(function (k) {
                var u = unsent[k];
                if (!u) return;
                clearTimeout(u.timer);
                u.run();
            });
        }, true);
        global.addEventListener("pageshow", function () { unloading = false; });
    } catch (e) { /* ignore */ }

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
            var id = nextUnsent++;
            var run = function () {
                delete unsent[id];
                dispatch(url, params, function (response) {
                    if (cancelled || !bridge.onservicecallback)
                        return;
                    // The app's own handler: what it throws is the app's
                    // uncaught error, as on a device (the reply came over
                    // the bus), never the service's failure.
                    try {
                        bridge.onservicecallback(toJson(response));
                    } catch (e) {
                        setTimeout(function () { throw e; }, 0);
                    }
                }, ctx);
            };
            if (unloading) {
                run();
                return 1;
            }
            unsent[id] = { run: run, timer: setTimeout(run, 0) };
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

        // Properties that only exist in db8 indexes: a "multi" index property
        // is the union of other fields (the core apps' kinds: com.palm.person
        // searchProperty; com.palm.email and com.palm.calendarevent searchText).
        var MULTI_PROPS = {
            searchProperty: ["names.honorificPrefix", "names.givenName", "names.middleName", "names.familyName",
                             "names.honorificSuffix", "organization.name", "nickname", "searchTerms", "ims.value", "emails.value"],
            searchText: ["subject", "from.name", "location", "note"]
        };

        // Like db8's indexes, a path through an array property yields the
        // values of all its elements ("capabilityProviders.capability").
        function getPath(obj, path) {
            if (MULTI_PROPS[path] && obj && obj[path] === undefined) {
                var values = [];
                MULTI_PROPS[path].forEach(function (p) {
                    var v = getPath(obj, p);
                    (Array.isArray(v) ? v : [v]).forEach(function (x) { if (typeof x === "string" && x) values.push(x); });
                });
                return values;
            }
            var parts = String(path).split(".");
            var v = obj;
            for (var i = 0; i < parts.length && v !== undefined && v !== null; ++i) {
                if (Array.isArray(v)) {
                    var rest = parts.slice(i).join("."), all = [];
                    v.forEach(function (e) {
                        var x = getPath(e, rest);
                        if (Array.isArray(x)) all.push.apply(all, x);
                        else if (x !== undefined) all.push(x);
                    });
                    return all;
                }
                v = v[parts[i]];
            }
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
                    // Search indexes are tokenized: a word starting with the text.
                    case "?": return typeof x === "string" && (" " + x.toLowerCase()).split(/[^0-9a-z\u00c0-\uffff]+/)
                        .some(function (w) { return w && w.indexOf(String(t).toLowerCase()) === 0; }) ||
                        (typeof x === "string" && x.toLowerCase().indexOf(String(t).toLowerCase()) === 0);
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
                if (!includeDeleted && o._del && !(q.where || []).some(function (c) { return c.prop === "_del"; })) return;
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
            // Like db8, a dotted field ("from.name") keeps its nesting.
            fields.forEach(function (f) {
                var v = getPath(o, f), parts = f.split("."), at = r;
                if (v === undefined) return;
                for (var i = 0; i < parts.length - 1; i++) {
                    if (typeof at[parts[i]] !== "object" || at[parts[i]] === null) at[parts[i]] = {};
                    at = at[parts[i]];
                }
                at[parts[parts.length - 1]] = v;
            });
            return r;
        }

        function notify() {
            var w = watchers;
            watchers = [];
            w.forEach(function (cb) { cb(); });
        }

        // db8 gives every object inside an array property its own _id
        // (e.g. account capabilityProviders, contact emails); apps rely on it.
        function assignSubIds(db, value) {
            if (Array.isArray(value)) {
                value.forEach(function (e) {
                    if (e && typeof e === "object" && !Array.isArray(e) && e._id === undefined)
                        e._id = (db.nextSubId = (db.nextSubId || 0x100) + 1).toString(16);
                    assignSubIds(db, e);
                });
            } else if (value && typeof value === "object") {
                Object.keys(value).forEach(function (k) { if (k.charAt(0) !== "_") assignSubIds(db, value[k]); });
            }
        }

        // Revision sets: a kind's revSets properties take the object's new
        // _rev when it changes (db8 only bumps them for changes to the
        // listed properties; here any change does). Calendar and Email
        // query and watch them to find what changed.
        function applyRevSets(db, o) {
            var kind = o._kind, seen = {};
            while (kind && db.kinds[kind] && !seen[kind]) {
                seen[kind] = true;
                (db.kinds[kind].revSets || []).forEach(function (name) { o[name] = o._rev; });
                kind = (db.kinds[kind].extends || [])[0];
            }
        }

        function put(db, o) {
            o = JSON.parse(toJson(o));
            assignSubIds(db, o);
            if (!o._id) o._id = newId(db);
            o._rev = ++db.rev;
            applyRevSets(db, o);
            db.objects[o._id] = o;
            return { id: o._id, rev: o._rev };
        }

        var api = {
            "/putKind": function (p, reply) {
                var db = load();
                // "sync": the kind's objects are backed up (MojDbKind's
                // SyncKey; internal/preBackup below dumps only those). Kept
                // when a putKind leaves it out: here it stands for the kind
                // file a device installs (see "Kinds that are backed up").
                var had = db.kinds[p.id];
                db.kinds[p.id] = { extends: p.extends || [], indexes: p.indexes || [],
                                   revSets: (p.revSets || []).map(function (r) { return r.name; }),
                                   sync: p.sync !== undefined ? !!p.sync : !!(had && had.sync) };
                save(db);
                reply(ok());
            },
            // Backup (MojDbServiceHandlerInternal handlePreBackup / handlePostRestore):
            // {dir, bytes, incrementalKey} -> the objects of the kinds marked
            // "sync" dumped to dir/backup-<microseconds>.json, {files: [name]}
            // (none when there is nothing to back up); {dir, files} loads them
            // back, replacing objects with the same _id (MojDbFlagForce). The
            // files go through runtime.tmpFiles, the simulator's temporary
            // folder (org.webosphoenix.service.backup's tempDir).
            "/internal/preBackup": function (p, reply) {
                if (!p.dir || typeof p.bytes !== "number") return reply(fail(-986, "dir and bytes are required"));
                var db = load(), objects = [];
                Object.keys(db.objects).forEach(function (id) {
                    var o = db.objects[id], k = db.kinds[o._kind];
                    if (!o._del && k && k.sync) objects.push(o);
                });
                var files = [];
                if (objects.length) {
                    var file = "backup-" + Date.now() + "000.json";
                    runtime.tmpFiles.write(p.dir.replace(/\/$/, "") + "/" + file, toJson({ objects: objects }));
                    files.push(file);
                }
                reply(ok({ files: files, count: objects.length, description: "db8 objects of the kinds marked sync", version: "1" }));
            },
            "/internal/postRestore": function (p, reply) {
                if (!p.dir || !Array.isArray(p.files)) return reply(fail(-986, "dir and files are required"));
                var db = load(), count = 0;
                try {
                    p.files.forEach(function (f) {
                        var text = runtime.tmpFiles.readText(p.dir.replace(/\/$/, "") + "/" + f);
                        (JSON.parse(text).objects || []).forEach(function (o) {
                            delete o._rev;
                            put(db, o);
                            count++;
                        });
                    });
                } catch (e) {
                    return reply(fail(-1, "Could not load the backup: " + e.message));
                }
                save(db);
                reply(ok({ count: count }));
                notify();
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
                    var m = JSON.parse(toJson(p.props || {}));
                    m._id = o._id;
                    return m;
                });
                targets.forEach(function (m) {
                    var cur = db.objects[m._id];
                    // A merge of an id that is not stored yet (e.g. one from
                    // reserveIds, as the contacts framework saves new contacts)
                    // stores the object, like db8 does.
                    if (!cur) {
                        if (m._kind && !p.query) results.push(put(db, m));
                        return;
                    }
                    assignSubIds(db, m);
                    // Nested objects merge too (db8 merges {flags: {read: true}}
                    // into the stored flags); arrays and values replace.
                    (function deepMerge(target, src) {
                        for (var k in src) {
                            if (k === "_rev") continue;
                            var v = src[k];
                            if (v && typeof v === "object" && !Array.isArray(v) &&
                                target[k] && typeof target[k] === "object" && !Array.isArray(target[k]))
                                deepMerge(target[k], v);
                            else
                                target[k] = v;
                        }
                    })(cur, m);
                    cur._rev = ++db.rev;
                    applyRevSets(db, cur);
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
                    else { db.objects[id]._del = true; db.objects[id]._rev = ++db.rev; applyRevSets(db, db.objects[id]); }
                    results.push({ id: id });
                });
                save(db);
                reply(p.query ? ok({ count: results.length }) : ok({ results: results }));
                notify();
            },
            "/find": function (p, reply, ctx) {
                function answer() {
                    var db = load();
                    var all = runQuery(db, p.query, p.query && p.query.incDel);
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
            // Like db8, a watch fires at once if its query already has results.
            "/watch": function (p, reply, ctx) {
                if (p.query && runQuery(load(), p.query, p.query.incDel).length) {
                    reply(ok({ fired: true }));
                    return;
                }
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
        // The tones LunaSysMgr fell back on (conf/defaultPreferences.txt; the
        // Pre's own Pre.mp3 ringtone was not open-sourced, so the ringtone is
        // Open webOS's ringtone.mp3, as luna-sysservice's examples add it).
        ringtone: { name: "Ringtone", fullPath: "/usr/palm/sounds/ringtone.mp3" },
        alerttone: { name: "alert.wav", fullPath: "/usr/palm/sounds/alert.wav" },
        notificationtone: { name: "notification.wav", fullPath: "/usr/palm/sounds/notification.wav" },
        // "System Sounds" (Preferences systemSounds): the feedback sounds.
        systemSounds: true,
        airplaneMode: false,
        rotationLock: false,
        muteSound: false,
        showAlertsWhenLocked: true,
        blinkNotifications: true,
        // Screen & Lock: seconds until the screen turns off (Phoenix's key
        // for the original's com.palm.display timeout), and how long it
        // stays locked before the PIN or password is asked for ("Lock
        // after"; 0: as soon as the screen is off).
        screenTimeout: 60,
        lockTimeout: 0,
        // Screen & Lock > Advanced gestures: LunaSysMgr's key. A long swipe
        // across the gesture area switches apps (phones).
        sysUiEnableNextPrevGestures: false,
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

    // webOS OSE's toasts (notificationmgr), used by OSE-era apps and by
    // enyo-webos's webOS.notification.showToast. On Phoenix a toast is the
    // calling app's banner, as PalmSystem.addBannerMessage shows it: tapping
    // it opens that app with onclick.params. onclick naming another app or a
    // target URL is not supported yet and is refused, not silently dropped.
    register(["com.webos.notification"], {
        "/createToast": function (p, reply) {
            var click = p.onclick || {};
            if (!p.message) return reply(fail(-1, "message is required"));
            if (click.target) return reply(fail(-1, "onclick.target is not supported in the Phoenix simulator"));
            // For another app (a service's toast: "Updated to ...", opening
            // Settings): its notification, which a tap launches with the params.
            if (click.appId && appId(click.appId) !== PalmSystem.appIdentifier) {
                host.postToHost("notification", { appId: appId(click.appId), title: String(p.message), body: "",
                                                  params: aliasParams(click.appId, click.params) });
                return reply(ok({ toastId: "n" + Date.now() }));
            }
            var id = PalmSystem.addBannerMessage(String(p.message),
                                                 toJson(p.noaction ? {} : click.appId ? aliasParams(click.appId, click.params) : click.params || {}),
                                                 p.iconUrl || "");
            reply(ok({ toastId: id }));
        },
        "/closeToast": function (p, reply) {
            if (!p.toastId) return reply(fail(-1, "toastId is required"));
            PalmSystem.removeBannerMessage(String(p.toastId));
            reply(ok());
        }
    });

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
        // (The Files block below lists the real ones.)
        "/ringtone/listRingtones": function (p, reply) { reply(ok({ ringtones: [] })); }
    });

    // ---- Application manager -------------------------------------------------------------

    // Installed apps and launch points, as the shell knows them (phoenix-sim
    // and tools/serve-rootfs.py serve the list): {id, launchPointId, title,
    // icon, params, hidden, universalSearch}.
    var launchPointCache = null;
    var launchPointWatchers = [];
    function launchPoints() {
        if (!launchPointCache) {
            try { launchPointCache = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/apps.json") || "[]"); }
            catch (e) { launchPointCache = []; }
        }
        return launchPointCache;
    }
    // The installed apps changed (the shell says so, applyHostStatus
    // {appsVersion}): read the list again and tell launchPointChanges.
    function appsChanged() {
        var before = launchPoints();
        launchPointCache = null;
        var after = launchPoints(), was = {}, now = {};
        before.forEach(function (lp) { was[lp.launchPointId] = lp; });
        after.forEach(function (lp) { now[lp.launchPointId] = lp; });
        var changes = [];
        after.forEach(function (lp) { if (!was[lp.launchPointId]) changes.push(Object.assign({ change: "added" }, lp)); });
        before.forEach(function (lp) {
            if (!now[lp.launchPointId]) changes.push({ change: "removed", id: lp.id, launchPointId: lp.launchPointId });
        });
        changes.forEach(function (c) {
            launchPointWatchers = launchPointWatchers.filter(function (w) { return w(c) !== false; });
        });
    }
    runtime.appsChanged = appsChanged;

    function visibleLaunchPoints() {
        return launchPoints().filter(function (lp) { return !lp.hidden; });
    }

    var resourceHandlers = null;
    function resourceHandler(target) {
        if (!resourceHandlers) {
            try { resourceHandlers = JSON.parse(PalmSystem.getResource("/usr/palm/command-resource-handlers.json") || "{}").redirects || []; }
            catch (e) { resourceHandlers = []; }
        }
        for (var i = 0; i < resourceHandlers.length; i++)
            if (new RegExp(resourceHandlers[i].url, "i").test(target)) return resourceHandlers[i].appId;
        return /^https?:/i.test(target) ? "com.palm.app.browser" : null;
    }

    // Apps the original webOS apps launch by id that Phoenix replaces:
    // Contacts' and Calendar's addresses open "com.palm.app.maps" (Google
    // or Bing Maps then), which is Phoenix Maps now; luna-systemui's backup
    // dashboard opens the Backup app, which is a Settings page now. An alias
    // is an app id, or {id, params} for a page of an app (its params are
    // added to the launch's).
    var APP_ALIASES = {
        "com.palm.app.maps": "org.webosphoenix.maps",
        "com.palm.app.backup": { id: "org.webosphoenix.settings", params: { page: "backup" } },
        // System Updates (luna-systemui opens it from its update alerts).
        "com.palm.app.updates": { id: "org.webosphoenix.settings", params: { page: "updates" } },
        "com.palm.app.textassist": { id: "org.webosphoenix.settings", params: { page: "textassist" } }
    };
    function appId(id) {
        var a = APP_ALIASES[id];
        return a ? (typeof a === "string" ? a : a.id) : id;
    }
    function aliasParams(id, params) {
        var a = APP_ALIASES[id], out = {};
        if (a && typeof a === "object") for (var k in a.params) out[k] = a.params[k];
        for (var j in params || {}) out[j] = params[j];
        return out;
    }
    runtime.appAliases = APP_ALIASES;

    register(["com.palm.applicationManager", "com.webos.applicationManager"], {
        "/launch": function (p, reply) {
            host.postToHost("launch", { id: appId(p.id), params: aliasParams(p.id, p.params) });
            reply(ok({ processId: String(Date.now()) }));
        },
        // As on webOS: {id, params} launches the app; {target} goes to the
        // app that handles it (command-resource-handlers.json: mailto: to
        // Email...), web pages to the browser. Other targets go to the shell.
        "/open": function (p, reply) {
            var handler = appId(p.id) || (p.target && resourceHandler(p.target));
            if (handler)
                host.postToHost("launch", { id: handler, params: p.id ? aliasParams(p.id, p.params) : { target: p.target } });
            else
                host.postToHost("open", { target: p.target, params: p.params || {} });
            reply(ok({ processId: String(Date.now()) }));
        },
        "/running": function (p, reply) { reply(ok({ running: [] })); },
        "/listApps": function (p, reply) {
            reply(ok({ apps: launchPoints().filter(function (lp) { return /_default$/.test(lp.launchPointId); }) }));
        },
        "/listLaunchPoints": function (p, reply) { reply(ok({ launchPoints: visibleLaunchPoints() })); },
        // Launch points whose title has a word starting with the keyword
        // (as luna-sysmgr's search did); Just Type shows them as "Launch".
        "/searchApps": function (p, reply) {
            var k = String(p.keyword || "").toLowerCase();
            var hits = !k ? [] : visibleLaunchPoints().filter(function (lp) {
                return (" " + String(lp.title).toLowerCase()).indexOf(" " + k) >= 0;
            });
            reply(ok({ apps: hits.map(function (lp) { return { launchPoint: lp.launchPointId }; }) }));
        },
        // Nothing is installed or removed at run time in the simulator.
        // {subscribe: true}: each launch point added or removed (an app was
        // installed or removed), {change: "added" | "removed", ...launch point}.
        "/launchPointChanges": function (p, reply, ctx) {
            launchPoints();   // what there is now, to tell changes from
            reply(ok({ subscribed: !!p.subscribe }));
            if (p.subscribe) launchPointWatchers.push(function (change) {
                if (ctx.cancelled()) return false;
                reply(ok(change));
                return true;
            });
        },
        "/getAppInfo": function (p, reply) {
            var app = launchPoints().filter(function (a) {
                return /_default$/.test(a.launchPointId) && (a.id === p.appId || a.id === p.id);
            })[0];
            reply(app ? ok({ appInfo: app }) : fail(-1, "app not found"));
        },
        "/addLaunchPoint": function (p, reply) { reply(ok({ launchPointId: "lp" + Date.now() })); },
        "/getHandlerForMimeType": function (p, reply) { reply(fail(-1, "no handler")); },
        "/listAllHandlersForMime": function (p, reply) { reply(ok({ resources: [] })); }
    });

    // ---- Just Type (com.palm.universalsearch) ---------------------------------------------
    // Modelled on openwebos/luna-universalsearchmgr: web search engines from
    // its UniversalSearchList.json, and the "action" (New Memo, New Event...)
    // and "dbsearch" (content search) providers the installed apps declare
    // in their appinfo.json "universalSearch" field. Preferences persist.

    var US_ICONS = "/usr/lib/luna/system/luna-applauncher/images/";
    var US_ENGINES = [
        { id: "google", displayName: "Google", url: "https://www.google.com/search?q=#{searchTerms}",
          suggestURL: "https://suggestqueries.google.com/complete/search?client=firefox&q=#{searchTerms}" },
        { id: "wikipedia", displayName: "Wikipedia", url: "https://en.wikipedia.org/wiki/Special:Search?search=#{searchTerms}",
          suggestURL: "https://en.wikipedia.org/w/api.php?action=opensearch&search=#{searchTerms}&limit=8&namespace=0&format=json" },
        { id: "amazon", displayName: "Amazon", url: "https://www.amazon.com/s/?k=#{searchTerms}", enabled: false },
        { id: "imdb", displayName: "IMDb", url: "https://www.imdb.com/find?q=#{searchTerms}", enabled: false },
        { id: "cnn", displayName: "CNN", url: "https://www.cnn.com/search?q=#{searchTerms}", enabled: false }
    ];
    var US_DEFAULT_PREFS = { defaultSearchEngine: "google", defaultSearch: "true", ContactSearch: "true", AppSearch: "true", GAL: "false" };
    var usWatchers = [];

    function usState() { return store.get("universalsearch", { prefs: {}, enabled: {} }); }
    function usSave(st) {
        store.set("universalsearch", st);
        usWatchers = usWatchers.filter(function (w) { return w(); });
    }
    function usPrefs() {
        var p = {}, saved = usState().prefs, k;
        for (k in US_DEFAULT_PREFS) p[k] = US_DEFAULT_PREFS[k];
        for (k in saved) p[k] = saved[k];
        return p;
    }
    function usEnabled(id, dflt) {
        var e = usState().enabled;
        return id in e ? e[id] : dflt !== false;
    }
    function usProviders(kind) {
        var out = [];
        launchPoints().forEach(function (lp) {
            var item = lp.universalSearch && lp.universalSearch[kind];
            if (!item || !/_default$/.test(lp.launchPointId)) return;
            var x = {}, k;
            for (k in item) x[k] = item[k];
            x.id = lp.id;
            x.iconFilePath = x.iconFilePath || lp.icon;
            x.enabled = usEnabled(kind + ":" + lp.id, true);
            if (kind === "dbsearch" && !x.url) x.url = lp.id;
            out.push(x);
        });
        return out;
    }
    function usList() {
        return ok({
            UniversalSearchList: US_ENGINES.map(function (e) {
                var x = { category: "search", type: "web", iconFilePath: US_ICONS + "search-icon-" + e.id + ".png" }, k;
                for (k in e) x[k] = e[k];
                x.enabled = usEnabled("search:" + e.id, e.enabled);
                return x;
            }),
            ActionList: usProviders("action"),
            DBSearchItemList: usProviders("dbsearch"),
            defaultSearchEngine: usPrefs().defaultSearchEngine
        });
    }
    function usSubscribe(p, reply, ctx, build) {
        reply(build());
        if (p.subscribe) usWatchers.push(function () { if (ctx.cancelled()) return false; reply(build()); return true; });
    }

    register(["com.palm.universalsearch"], {
        "/getUniversalSearchList": function (p, reply, ctx) { usSubscribe(p, reply, ctx, usList); },
        "/getAllSearchPreference": function (p, reply, ctx) {
            usSubscribe(p, reply, ctx, function () { return ok({ SearchPreference: usPrefs() }); });
        },
        "/getSearchPreference": function (p, reply) {
            var r = ok({}), all = usPrefs();
            r[p.key] = all[p.key];
            reply(r);
        },
        "/setSearchPreference": function (p, reply) {
            var st = usState();
            st.prefs[p.key] = String(p.value);
            usSave(st);
            reply(ok());
        },
        // {id, category: "search" | "action" | "dbsearch", enabled}
        "/updateSearchItem": function (p, reply) {
            var st = usState();
            st.enabled[(p.category || "search") + ":" + p.id] = !!p.enabled;
            usSave(st);
            reply(ok());
        },
        "*": function (p, reply) { reply(ok()); }
    });

    // ---- BrowserAdapter (Enyo's WebView) ------------------------------------------------
    // enyo.WebView renders <object type="application/x-palm-browser">: the
    // BrowserAdapter plugin (isis-project/BrowserAdapter), which showed pages
    // that BrowserServer rendered with WebKit. The browser (isis-browser),
    // Email's message view and the account sign-in pages call its scripting
    // API on the node and get callbacks on node.eventListener (see
    // BasicWebView.js). Here the object gets that API and one of two engines:
    //   - in phoenix-sim (phoenix:// pages) a Chromium view that the shell
    //     lays over the object's rectangle (WebAppWindow.qml), driven by
    //     "webView" host messages; its events come back through
    //     __phoenixRuntime.webViewEvent;
    //   - elsewhere an <iframe> inside the object, which shows sites that
    //     allow framing (and can only report same-origin titles).

    var WEBVIEW_TYPE = "application/x-palm-browser";
    var nativeWebViews = global.location && global.location.protocol === "phoenix:";
    var webViews = {};      // id -> adapter
    var nextWebView = 1;

    function WebViewAdapter(node) {
        this.node = node;
        this.id = "wv" + (nextWebView++);
        this.url = "";
        this.title = "";
        this.back = [];         // iframe engine history
        this.forward = [];
        this.rect = "";
        this.hidden = true;
        webViews[this.id] = this;
    }
    WebViewAdapter.prototype = {
        listener: function (name) {
            var l = this.node.eventListener;
            if (l && typeof l[name] === "function")
                l[name].apply(l, Array.prototype.slice.call(arguments, 1));
        },
        post: function (op, extra) {
            var p = { id: this.id, op: op }, k;
            for (k in extra || {}) p[k] = extra[k];
            host.postToHost("webView", p);
        },
        connect: function () {
            var self = this;
            if (this.connected) return;
            this.connected = true;
            if (nativeWebViews) {
                this.post("create", {});
                this.track();
            } else {
                var frame = this.frame = global.document.createElement("iframe");
                frame.style.cssText = "border:0;width:100%;height:100%;display:block;background:white";
                frame.addEventListener("load", function () { self.frameLoaded(); });
                this.node.appendChild(frame);
            }
            setTimeout(function () { self.listener("serverConnected"); }, 0);
        },
        // Keep the native view on the object's rectangle, and out of the way
        // while the object is hidden or an Enyo popup (menu, dialog) is open.
        track: function () {
            var self = this;
            if (this.destroyed) return;
            var n = this.node, r = n.getBoundingClientRect();
            var popup = Array.prototype.some.call(global.document.querySelectorAll(".enyo-popup"), function (e) {
                return e.offsetParent !== null && e.getBoundingClientRect().height > 0;
            });
            var hidden = !n.isConnected || n.offsetParent === null || r.width === 0 || r.height === 0 || popup;
            var rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(",");
            if (rect !== this.rect || hidden !== this.hidden) {
                this.rect = rect;
                this.hidden = hidden;
                this.post("geometry", { x: r.left, y: r.top, width: r.width, height: r.height, visible: !hidden });
            }
            if (!n.isConnected && this.connected) return this.destroy();
            global.requestAnimationFrame(function () { self.track(); });
        },
        destroy: function () {
            if (this.destroyed) return;
            this.destroyed = true;
            if (nativeWebViews) this.post("destroy", {});
            delete webViews[this.id];
        },
        // Cut, Copy, Paste, Select All in the page it shows: the native view
        // runs the command itself (as BrowserServer did); the iframe's page
        // gets it as its own command.
        edit: function (action) {
            if (nativeWebViews)
                return this.post("edit", { action: action });
            var doc = null;
            try { doc = this.frame && this.frame.contentDocument; } catch (e) { doc = null; }
            if (!doc)
                return;
            var rt = this.frame.contentWindow && this.frame.contentWindow.__phoenixRuntime;
            if (rt && rt.edit)
                rt.edit(action);
            else if (action !== "paste")
                doc.execCommand(action);
        },
        // Iframe engine.
        frameNavigate: function (url, fromHistory) {
            if (!fromHistory && this.url) { this.back.push(this.url); this.forward = []; }
            this.url = url;
            this.navigated = true;
            this.listener("loadStarted");
            this.listener("loadProgressChanged", 10);
            this.frame.src = url;
            this.frameReport();
        },
        frameLoaded: function () {
            // The new iframe's about:blank is not a page the app asked for.
            if (!this.navigated) return;
            var doc = null;
            try { doc = this.frame.contentDocument; } catch (e) { doc = null; }
            if (doc && doc.location && doc.location.href !== "about:blank") {
                this.url = doc.location.href;
                this.title = doc.title || "";
            } else {
                this.title = "";
            }
            this.frameReport();
            this.listener("loadProgressChanged", 100);
            this.listener("loadStopped");
            this.listener("documentLoadFinished");
        },
        frameReport: function () {
            this.listener("urlTitleChanged", this.url, this.title || this.url, this.back.length > 0, this.forward.length > 0);
        },
        // The plugin's scripting API (the methods BasicWebView and the apps call).
        api: {
            setPageIdentifier: function (id) { this.pageIdentifier = id; },
            connectBrowserServer: function () { this.connect(); },
            disconnectBrowserServer: function () { this.destroy(); },
            openURL: function (url) {
                if (!url) return;
                // "example.com" is a web address; "/usr/..." a local file.
                if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && url.charAt(0) !== "/") url = "http://" + url;
                if (nativeWebViews) { this.url = url; this.post("open", { url: url }); }
                else if (this.frame) this.frameNavigate(url);
            },
            setHTML: function (url, body) {
                if (nativeWebViews) this.post("html", { url: url || "", html: body || "" });
                else if (this.frame) { this.navigated = true; this.url = url || ""; this.frame.srcdoc = body || ""; }
            },
            goBack: function () {
                if (nativeWebViews) return this.post("back", {});
                if (this.back.length) { this.forward.push(this.url); this.frameNavigate(this.back.pop(), true); }
            },
            goForward: function () {
                if (nativeWebViews) return this.post("forward", {});
                if (this.forward.length) { this.back.push(this.url); this.frameNavigate(this.forward.pop(), true); }
            },
            reloadPage: function () {
                if (nativeWebViews) return this.post("reload", {});
                if (this.url) this.frameNavigate(this.url, true);
            },
            stopLoad: function () {
                if (nativeWebViews) return this.post("stop", {});
                this.listener("loadStopped");
            },
            findInPage: function (text) { if (nativeWebViews) this.post("find", { text: text || "" }); },
            clearHistory: function () { this.back = []; this.forward = []; },
            setVisibleSize: function () {},
            pageFocused: function () {},
            interrogateClicks: function () {},
            setShowClickedLink: function () {},
            setBlockPopups: function () {},
            setAcceptCookies: function () {},
            setEnableJavaScript: function () {},
            setMinFontSize: function () {},
            setHeaderHeight: function () {},
            ignoreMetaTags: function () {},
            addUrlRedirect: function () {},
            setNetworkInterface: function () {},
            setDNSServers: function () {},
            handleFlick: function () {},
            clearCache: function () {},
            clearCookies: function () {},
            // The Edit commands in the page shown here.
            cut: function () { this.edit("cut"); },
            copy: function () { this.edit("copy"); },
            paste: function () { this.edit("paste"); },
            selectAll: function () { this.edit("selectAll"); },
            insertStringAtCursor: function () {},
            selectPopupMenuItem: function () {},
            sendDialogResponse: function () {},
            inspectUrlAtPoint: function () {},
            getImageInfoAtPoint: function () {},
            saveImageAtPoint: function () {},
            saveViewToFile: function () {},
            generateIconFromFile: function () {},
            resizeImage: function () {},
            deleteImage: function () {},
            printFrame: function () {}
        }
    };

    var adapters = typeof WeakMap === "function" ? new WeakMap() : null;
    function adapterFor(node) {
        var a = adapters.get(node);
        if (!a) { a = new WebViewAdapter(node); adapters.set(node, a); }
        return a;
    }
    // The methods exist as soon as Enyo renders the object (BasicWebView
    // checks node.openURL right away), only on BrowserAdapter objects.
    if (adapters && global.HTMLObjectElement) {
        Object.keys(WebViewAdapter.prototype.api).forEach(function (name) {
            if (name in global.HTMLObjectElement.prototype) return;
            Object.defineProperty(global.HTMLObjectElement.prototype, name, {
                configurable: true,
                get: function () {
                    if (String(this.getAttribute("type")).toLowerCase() !== WEBVIEW_TYPE) return undefined;
                    var a = adapterFor(this);
                    return function () { return a.api[name].apply(a, arguments); };
                }
            });
        });
    }

    // Native view events from phoenix-sim: name is a BrowserAdapter callback
    // (urlTitleChanged, loadStarted, loadProgressChanged, loadStopped,
    // documentLoadFinished, mainDocumentLoadFailed).
    runtime.webViewEvent = function (id, name, args) {
        var a = webViews[id];
        if (!a) return;
        if (name === "urlTitleChanged") { a.url = args[0]; a.title = args[1]; }
        a.listener.apply(a, [name].concat(args || []));
    };

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

    // ---- System signals and power ------------------------------------------------------
    // luna-systemui and the apps listen to the system's signals with
    // com.palm.bus/signal/addmatch {category, method}, e.g. powerd's
    // /com/palm/power batteryStatus and USBDockStatus. The simulator keeps a
    // battery (shared by the pages through the store) that phoenix-sim can
    // change (SimWindowSource.simulatePower), and signals it the way powerd
    // did (powerd's batteryStatus / USBDockStatus payloads).

    var signalWatchers = [];
    function signal(category, method, payload) {
        signalWatchers = signalWatchers.filter(function (w) { return !w.ctx.cancelled(); });
        signalWatchers.forEach(function (w) {
            if (w.category === category && (!w.method || w.method === method)) {
                var r = {}, k;
                for (k in payload) r[k] = payload[k];
                w.reply(r);
            }
        });
    }
    runtime.signal = signal;

    register(["com.palm.bus"], {
        // registerServerStatus {serviceName, subscribe}: {serviceName,
        // connected} (luna-service2), here whether the simulator has it;
        // luna-systemui waits for it before subscribing to a service
        // (SysUpdateService.js, com.palm.update).
        "/signal/registerServerStatus": function (p, reply) {
            var name = String(p.serviceName || "");
            reply(ok({ serviceName: name, connected: !!(name && runtime.services[name]) }));
        },
        "/signal/addmatch": function (p, reply, ctx) {
            reply(ok({ subscribed: !!p.subscribe }));
            if (p.subscribe)
                signalWatchers.push({ category: p.category, method: p.method, reply: reply, ctx: ctx });
        },
        "*": function (p, reply) { reply(ok()); }
    });

    // charger: "none", "wall" (a wall charger on the USB port) or "pc"; as
    // on the Pre, both charge over USB (luna-systemui PowerdService.js).
    function powerState() { return store.get("power", { percent: 76, charger: "none" }); }
    function batteryPayload(st) {
        return { percent: st.percent, percent_ui: st.percent, temperature_C: 28,
                 current_mA: st.charger !== "none" ? 800 : -250, capacity_mAh: 1150, voltage_mV: 3900 };
    }
    function chargerPayload(st) {
        var on = st.charger !== "none";
        return { Charging: on, Connected: on, USBConnected: on, USBName: on ? st.charger : "",
                 DockConnected: false, DockPower: false, type: st.charger };
    }
    // {percent, charger}: change the battery and tell the listeners.
    runtime.setPower = function (changes) {
        var st = powerState(), k;
        for (k in changes) st[k] = changes[k];
        store.set("power", st);
        signal("/com/palm/power", "USBDockStatus", chargerPayload(st));
        signal("/com/palm/power", "batteryStatus", batteryPayload(st));
        return st;
    };

    register(["com.palm.power"], {
        "/com/palm/power/batteryStatusQuery": function (p, reply) {
            var st = powerState();
            reply(ok(batteryPayload(st)));
            signal("/com/palm/power", "batteryStatus", batteryPayload(st));
        },
        "/com/palm/power/chargerStatusQuery": function (p, reply) {
            var st = powerState();
            reply(ok(chargerPayload(st)));
            signal("/com/palm/power", "USBDockStatus", chargerPayload(st));
        },
        "/timeout/set": function (p, reply) { reply(ok()); },
        "/timeout/clear": function (p, reply) { reply(ok()); },
        "/com/palm/power/activityStart": function (p, reply) { reply(ok()); },
        "/com/palm/power/activityEnd": function (p, reply) { reply(ok()); }
    });

    register(["com.palm.display"], {
        "/control/status": function (p, reply) { reply(ok({ event: "displayOn", state: "on" })); },
        "*": function (p, reply) { reply(ok()); }
    });

    // com.palm.service.accounts: see "Accounts" below.

    register(["com.palm.activitymanager"], {
        "*": function (p, reply) { reply(ok({ activityId: Date.now() })); }
    });

    // Services that apps poke but whose absence should not break them.
    register(["com.palm.keys", "com.palm.audio", "com.palm.vibrate", "com.palm.lunabus",
              "com.palm.preferences", "com.palm.systemmanager",
              "com.palm.location", "com.palm.telephony", "com.palm.messaging",
              "com.palm.applicationManager.private", "com.palm.mediaindexer"], {
        "*": function (p, reply) { reply(ok()); }
    });

    // ================================================================================
    // Services for the original Open webOS core apps (Accounts, Contacts,
    // Calendar, Email). Modelled on the real implementations in
    // third_party/app-services; see each block for what is simulated.
    // ================================================================================

    // Synchronous call on a simulated service (all of them answer
    // synchronously in-page). Returns the first response.
    function callNow(url, params) {
        var response;
        dispatch(url, params || {}, function (r) { if (!response) response = r; },
                 { cancelled: function () { return true; }, onCancel: null });
        return response || fail(-1, "no response from " + url);
    }
    runtime.callNow = callNow;

    function clone(o) { return o === undefined ? undefined : JSON.parse(toJson(o)); }

    // Application manager additions used by the core apps. Enyo's
    // CrossAppUI (e.g. the Email account wizard inside Accounts) asks for
    // an app's main file to load its pages in an iframe.
    (function appManagerExtras() {
        var am = runtime.services["com.palm.applicationManager"];
        am["/getAppBasePath"] = function (p, reply) {
            var base = "/usr/palm/applications/" + p.appId + "/";
            var info = null;
            try { info = JSON.parse(PalmSystem.getResource(base + "appinfo.json").replace(/^\ufeff/, "")); } catch (e) { info = null; }
            reply(info ? ok({ basePath: base + (info.main || "index.html"), appId: p.appId })
                       : fail(-1, "app not found: " + p.appId));
        };
        // Calendar draws today's date on its launcher icon. The icon path is
        // relative to the calling app; the shell gets it as a host message.
        am["/updateLaunchPointIcon"] = function (p, reply) {
            var icon = p.icon || "";
            if (icon && icon.charAt(0) !== "/" && !/^[a-z]+:/.test(icon))
                icon = "/usr/palm/applications/" + PalmSystem.appIdentifier + "/" + icon;
            host.postToHost("launchPointIcon", { appId: PalmSystem.appIdentifier, launchPointId: p.launchPointId, icon: icon });
            reply(ok({}));
        };
        // Headless apps (Calendar) ask to stay loaded when their windows close.
        if (!PalmSystem.keepAlive) PalmSystem.keepAlive = function () {};
        // Enyo reads window params from PalmSystem.launchParams, and from the
        // URL's enyoWindowParams only when there are no launch params. Pages
        // opened with enyoWindowParams (CrossAppUI iframes such as Email's
        // account wizard inside Accounts) are not app launches: no launchParams.
        if (queryParam("launchParams") === null && queryParam("enyoWindowParams") !== null)
            PalmSystem.launchParams = "";
        // Some apps (Email) spell the connection manager method getStatus.
        var cm = runtime.services["com.palm.connectionmanager"];
        if (cm && !cm["/getStatus"]) cm["/getStatus"] = cm["/getstatus"];
    })();

    // ---- Accounts (com.palm.service.accounts) ---------------------------------------
    //
    // As in app-services/com.palm.service.accounts: accounts are
    // com.palm.account:1 objects in db8, templates are the JSON files under
    // /usr/palm/public/accounts/<templateId>/ (only the templates released
    // with Open webOS exist: the HP webOS profile and the email templates),
    // and listAccounts/getAccountInfo "annotate" accounts with their
    // template. Credentials are kept per account in localStorage. There are
    // no transports: a new account is not validated against a server.
    (function accountsService() {
        var TEMPLATE_FILES = [
            "/usr/palm/public/accounts/com.palm.palmprofile/com.palm.palmprofile.json",
            "/usr/palm/public/accounts/com.palm.othermail/com.palm.othermail.json",
            "/usr/palm/public/accounts/com.palm.imap/com.palm.imap.json",
            "/usr/palm/public/accounts/com.palm.pop/com.palm.pop.json"
        ];
        var ACCOUNT_KIND = "com.palm.account:1";
        var templateCache = null;

        function absolutize(dir, icons) {
            if (!icons) return;
            Object.keys(icons).forEach(function (k) {
                if (icons[k].charAt(0) !== "/") icons[k] = dir + icons[k];
            });
        }

        function templates() {
            if (templateCache) return clone(templateCache);
            var list = [];
            TEMPLATE_FILES.forEach(function (file) {
                var text = PalmSystem.getResource(file);
                if (!text) return;
                var dir = file.slice(0, file.lastIndexOf("/") + 1), parsed;
                try { parsed = JSON.parse(text); } catch (e) { console.warn("[phoenix-runtime] bad account template " + file); return; }
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(function (t) {
                    absolutize(dir, t.icon);
                    (t.capabilityProviders || []).forEach(function (cp) { absolutize(dir, cp.icon); });
                    list.push(t);
                });
            });
            list.sort(function (a, b) {
                return (a.loc_name || "").toLocaleUpperCase().localeCompare((b.loc_name || "").toLocaleUpperCase());
            });
            templateCache = list;
            return clone(list);
        }
        runtime.accountTemplates = templates;

        function templateFor(id) {
            return templates().filter(function (t) { return t.templateId === id; })[0];
        }

        // Account.annotate(): the account's own fields over the template's,
        // each capability provider completed from the template's.
        function annotate(account) {
            var template = templateFor(account.templateId);
            if (!template) return null;
            var subset = account.capabilityProviders || [];
            var result = template;
            for (var k in account) result[k] = account[k];
            result.capabilityProviders = subset.map(function (c) {
                var t = (template.capabilityProviders || []).filter(function (tc) { return tc.id === c.id; })[0] || {};
                var out = {};
                for (var k in c) out[k] = c[k];
                for (k in t) out[k] = t[k];
                return out;
            });
            return result;
        }

        function getAccount(id) {
            return (callNow("palm://com.palm.db/get", { ids: [id] }).results || [])[0];
        }

        function providersFor(template, requested) {
            var seen = {};
            return (requested || []).map(function (r) {
                var t = (template.capabilityProviders || []).filter(function (c) { return c.id === r.id; })[0];
                if (!t || seen[t.id]) return null;
                seen[t.id] = true;
                return { id: t.id, capability: t.capability };
            }).filter(Boolean);
        }

        var credentials = {
            get: function (id) { return store.get("accountCredentials", {})[id]; },
            set: function (id, value) {
                var all = store.get("accountCredentials", {});
                if (value === undefined) delete all[id]; else all[id] = value;
                store.set("accountCredentials", all);
            }
        };

        function listAccounts(p, reply) {
            var where = [];
            if (p.templateId) where.push({ prop: "templateId", op: "=", val: p.templateId });
            else if (p.capability) where.push({ prop: "capabilityProviders.capability", op: "=", val: p.capability });
            where.push({ prop: "beingDeleted", op: "=", val: false });
            var found = callNow("palm://com.palm.db/find", { query: { from: ACCOUNT_KIND, where: where } });
            reply(ok({ results: (found.results || []).map(annotate).filter(Boolean) }));
        }

        register(["com.palm.service.accounts"], {
            "/listAccountTemplates": function (p, reply) {
                var caps = p.capability === undefined ? null : [].concat(p.capability);
                reply(ok({
                    results: templates().filter(function (t) {
                        return !caps || (t.capabilityProviders || []).some(function (c) { return caps.indexOf(c.capability) >= 0; });
                    })
                }));
            },
            "/listAccounts": listAccounts,
            "/listAccountsPublic": listAccounts,
            "/getAccountInfo": function (p, reply) {
                var account = getAccount(p.accountId);
                var annotated = account && annotate(account);
                reply(annotated ? ok({ result: annotated }) : fail(-1, "account not found: " + p.accountId));
            },
            "/createAccount": function (p, reply) {
                var template = templateFor(p.templateId);
                if (!template) return reply(fail(-1, "no account template for id=" + p.templateId));
                if (!p.username) return reply(fail(-1, "missing username"));
                var dup = callNow("palm://com.palm.db/find", { query: { from: ACCOUNT_KIND, where: [
                    { prop: "beingDeleted", op: "=", val: false },
                    { prop: "templateId", op: "=", val: p.templateId },
                    { prop: "username", op: "=", val: p.username }] } });
                if ((dup.results || []).length)
                    return reply({ returnValue: false, errorCode: "DUPLICATE_ACCOUNT", errorText: "Unable to create a duplicate account" });
                var account = {
                    _kind: ACCOUNT_KIND,
                    templateId: p.templateId,
                    username: p.username,
                    alias: p.alias,
                    beingDeleted: false,
                    capabilityProviders: providersFor(template, p.capabilityProviders)
                };
                if (p._sync !== undefined) account._sync = p._sync;
                var put = callNow("palm://com.palm.db/put", { objects: [account] });
                account._id = put.results[0].id;
                account._rev = put.results[0].rev;
                credentials.set(account._id, p.credentials || (p.password ? { common: { password: p.password } } : undefined));
                reply(ok({ result: account }));
            },
            "/modifyAccount": function (p, reply) {
                var account = getAccount(p.accountId), changes = p.object || {};
                if (!account) return reply(fail(-1, "account not found: " + p.accountId));
                var template = templateFor(account.templateId) || {};
                if (changes.capabilityProviders) {
                    var removed = (account.capabilityProviders || []).filter(function (c) {
                        return !changes.capabilityProviders.some(function (n) { return n.id === c.id; });
                    });
                    var alwaysOn = removed.some(function (c) {
                        return (template.capabilityProviders || []).some(function (t) { return t.id === c.id && t.alwaysOn; });
                    });
                    if (alwaysOn) return reply(fail("400_BAD_REQUEST", "can't disable 'alwaysOn' capabilities"));
                }
                var merge = { _id: account._id };
                if (changes.username !== undefined) merge.username = changes.username;
                if (changes.alias !== undefined) merge.alias = changes.alias;
                if (changes.capabilityProviders) merge.capabilityProviders = providersFor(template, changes.capabilityProviders);
                callNow("palm://com.palm.db/merge", { objects: [merge] });
                if (changes.credentials) credentials.set(account._id, changes.credentials);
                reply(ok({}));
            },
            // The real service marks the account, lets each capability's
            // onDelete handler remove its data, then removes the account.
            // Here the account's data is every object with its accountId.
            "/deleteAccount": function (p, reply) {
                var account = getAccount(p.accountId);
                if (!account || account.beingDeleted) return reply(fail(-1, "Unable to find account"));
                callNow("palm://com.palm.db/merge", { objects: [{ _id: account._id, beingDeleted: true }] });
                setTimeout(function () {
                    callNow("palm://com.palm.db/del", { query: { where: [{ prop: "accountId", op: "=", val: account._id }] } });
                    callNow("palm://com.palm.db/del", { ids: [account._id] });
                    credentials.set(account._id, undefined);
                    reply(ok({}));
                }, 300);
            },
            "/readCredentials": function (p, reply) {
                var c = credentials.get(p.accountId);
                var v = c && (p.name ? c[p.name] : c);
                reply(v ? ok({ credentials: v }) : fail(-1, "no credentials"));
            },
            "/readCredentialsPublic": function (p, reply) { reply(fail(-1, "Permission denied.")); },
            "/writeCredentials": function (p, reply) {
                var c = credentials.get(p.accountId) || {};
                if (p.name) c[p.name] = p.credentials; else c = p.credentials;
                credentials.set(p.accountId, c);
                reply(ok({}));
            },
            "/hasCredentials": function (p, reply) { reply(ok({ value: !!credentials.get(p.accountId) })); },
            "/setApplication": function (p, reply) { reply(ok({})); },
            "/notifyAccountCreated": function (p, reply) { reply(ok({})); },
            "/notifyAccountDeleted": function (p, reply) { reply(ok({})); }
        });

        // HP webOS Account (profile) server. There is no server: the profile
        // is the simulator's owner from the sample data.
        function profile() {
            return store.get("profile", { firstName: "", lastName: "", email: "" });
        }
        register(["com.palm.accountservices"], {
            "/getAccountInfo": function (p, reply) {
                var o = profile();
                reply(ok({ firstName: o.firstName, lastName: o.lastName, email: o.email, emailAddress: o.email }));
            },
            "/getAggregatedAccountInfo": function (p, reply) {
                var o = profile();
                reply(ok({
                    accountInfo: { accountState: "B", accountType: "CONSUMER", country: "US", language: "en",
                                   email: o.email, firstName: o.firstName, lastName: o.lastName, id: -1 },
                    accountDevices: [{ deviceName: "Phoenix Simulator", deviceModel: "Phoenix Simulator", deviceType: "Phone",
                                       webOSDisplayName: "webOS Phoenix" }],
                    acctChallengeQuestions: { id: 1001, question: "Where did your parents meet?" },
                    challengeQuestions: [{ id: 1001, question: "Where did your parents meet?" }]
                }));
            },
            "*": function (p, reply) { reply(fail(-1, "The HP webOS Account server is not available in the simulator")); }
        });
        register(["com.palm.deviceprofile"], {
            "/getDeviceProfile": function (p, reply) {
                reply(ok({ deviceInfo: { nduId: "PHOENIX0001", deviceName: "Phoenix Simulator", serialNumber: "PHOENIX0001" } }));
            }
        });
    })();

    // ---- Contacts linker (com.palm.service.contacts.linker) -------------------------
    //
    // The real linker (app-services/com.palm.service.contacts.linker) is a
    // node service built on the contacts loadable framework: it keeps one
    // com.palm.person:1 per group of linked contacts. The Contacts app
    // loads that same framework (global ContactsLib, with Foundations), so
    // these methods run the linker's own steps on the calling page's copy.
    // Not simulated: automatic linking of similar contacts (each new
    // contact gets its own person) and the link backup database.
    (function contactsLinker() {
        function lib() { return global.ContactsLib && global.ContactsLib.Person ? global.ContactsLib : null; }

        // Runs fn (returning a Foundations future) and replies with its result.
        function viaFuture(reply, fn) {
            var L = lib();
            if (!L) return reply(fail(-1, "contacts framework not loaded in this page"));
            var future;
            try { future = fn(L); } catch (e) { return reply(fail(-1, String(e && e.message || e))); }
            future.then(function (f) {
                try { reply(ok(f.result && typeof f.result === "object" ? f.result : { result: f.result })); }
                catch (e) { reply(fail(-1, String(e && e.message || e))); }
            });
        }

        function getPersons(L, ids) {
            return L.PersonFactory && global.Foundations
                ? global.Foundations.Data.DB.get(ids) : null;
        }

        register(["com.palm.service.contacts.linker"], {
            // Autolinker.saveNewPersonAndContacts
            "/saveNewPersonAndContacts": function (p, reply) {
                viaFuture(reply, function (L) {
                    var person = new L.Person(p.person);
                    var contacts = (p.contacts || []).map(function (c) {
                        return c instanceof L.Contact ? c : L.ContactFactory.createContactLinkable(c);
                    });
                    var saveResult;
                    return person._savePersonAttachingTheseContacts(contacts).then(function (f) {
                        saveResult = f.result;
                        return {
                            saveResult: saveResult,
                            person: person.getDBObject(),
                            contacts: contacts.map(function (c) { return c.getDBObject(); })
                        };
                    });
                });
            },
            // LinkerAssistant.manuallyLink
            "/manualLink": function (p, reply) {
                viaFuture(reply, function (L) {
                    var to, from;
                    return getPersons(L, [p.personToLinkTo, p.personToLink]).then(function (f) {
                        (f.result.results || []).forEach(function (r) {
                            var person = L.PersonFactory.createPersonLinkable(r);
                            if (person.getId() === p.personToLinkTo) to = person;
                            else if (person.getId() === p.personToLink) from = person;
                        });
                        if (!to || !from) throw new Error("Trying to fetch one of the people objects failed.");
                        to.mergeContactIds(from.getContactIds().getArray());
                        return to.fixup([from]);
                    }).then(function () {
                        return to.save();
                    }).then(function () {
                        return global.Foundations.Data.DB.del([from.getId()]);
                    }).then(function () { return { result: true }; });
                });
            },
            // LinkerAssistant.manuallyUnlink
            "/manualUnlink": function (p, reply) {
                viaFuture(reply, function (L) {
                    var person, split;
                    return getPersons(L, [p.personToRemoveLinkFrom]).then(function (f) {
                        var r = (f.result.results || [])[0];
                        if (!r) throw new Error("The person to remove the link from does not exist in the db.");
                        person = L.PersonFactory.createPersonLinkable(r);
                        if (!person.getContactIds().remove(p.contactToRemoveFromPerson))
                            throw new Error("The contact you are trying to unlink does not belong to the person you specified");
                        return person.fixup();
                    }).then(function () {
                        return person.save();
                    }).then(function () {
                        split = L.PersonFactory.createPersonLinkable();
                        split.getContactIds().add(p.contactToRemoveFromPerson);
                        return split.fixup();
                    }).then(function () {
                        return split.save();
                    }).then(function () { return { result: true }; });
                });
            },
            // LinkerAssistant.deletePerson: only a person without contacts.
            "/deleteOrphanedPerson": function (p, reply) {
                viaFuture(reply, function (L) {
                    return L.Person.getDisplayablePersonAndContactsById(p.personId).then(function (f) {
                        var person = f.result;
                        if (person && person.getContacts().length === 0) {
                            person.deletePerson();
                            return { result: true };
                        }
                        return { result: false };
                    });
                });
            },
            "*": function (p, reply) { reply(ok({})); }
        });

        // Contacts service: the favourite calls change the person's favorite flag.
        register(["com.palm.service.contacts"], {
            "/favoritePerson": function (p, reply) {
                callNow("palm://com.palm.db/merge", { objects: [{ _id: p.personId, favorite: true }] });
                reply(ok({}));
            },
            "/unfavoritePerson": function (p, reply) {
                callNow("palm://com.palm.db/merge", { objects: [{ _id: p.personId, favorite: false }] });
                reply(ok({}));
            },
            "*": function (p, reply) { reply(fail(-1, "not available in the Phoenix simulator")); }
        });
    })();

    // ---- Email transports (com.palm.smtp, com.palm.imap, com.palm.pop) ---------------
    //
    // mojomail's SMTP service saves outgoing mail (SaveEmailCommand): parts
    // given as "content" are written to the file cache and replaced by a
    // "path", the body's text becomes the summary, and the email is merged
    // into the account's Outbox (sendMail) or Drafts (saveDraft). There is
    // no mail server here: a sent email moves to the Sent folder a moment
    // later, and folder syncs find nothing new. The file cache lives in
    // localStorage and PalmSystem.getResource (palmGetResource) reads it.
    (function emailTransports() {
        var FILE_CACHE = "/var/file-cache/email/phoenix/";
        var readFile = PalmSystem.getResource;
        PalmSystem.getResource = function (path, flags) {
            var cache = store.get("fileCache", {});
            return Object.prototype.hasOwnProperty.call(cache, path) ? asResource(cache[path], flags) : readFile(path, flags);
        };

        function mailAccount(accountId) {
            return (callNow("palm://com.palm.db/find", { query: { from: "com.palm.mail.account:1",
                where: [{ prop: "accountId", op: "=", val: accountId }] } }).results || [])[0];
        }

        // PreviewTextGenerator: tags stripped, whitespace collapsed, 128 chars.
        function previewText(html) {
            var div = global.document.createElement("div");
            div.innerHTML = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
            return (div.textContent || "").replace(/\s+/g, " ").trim().slice(0, 128);
        }

        function saveEmail(p, isDraft, reply) {
            var account = mailAccount(p.accountId);
            var folderId = account && (isDraft ? account.draftsFolderId : account.outboxFolderId);
            if (!folderId) return reply(fail(-1, "no " + (isDraft ? "drafts" : "outbox") + " folder for account " + p.accountId));
            var email = clone(p.email || {});
            var id = email._id || callNow("palm://com.palm.db/reserveIds", { count: 1 }).ids[0];
            var cache = store.get("fileCache", {});
            (email.parts || []).forEach(function (part, i) {
                if (part.content === undefined) return;
                part.path = FILE_CACHE + id + "/" + i + "-" + (part.displayName || "body.html");
                cache[part.path] = part.content;
                if (part.type === "body") email.summary = previewText(part.content);
                delete part.content;
            });
            store.set("fileCache", cache);
            email._id = id;
            email._kind = "com.palm.email:1";
            email.folderId = folderId;
            email.sendStatus = { error: null, fatalError: false, retryCount: 0 };
            email.timestamp = email.timestamp || Date.now();
            email.flags = email.flags || {};
            if (email.flags.visible === undefined) email.flags.visible = true;
            if (email.flags.read === undefined || !isDraft) email.flags.read = true;
            callNow("palm://com.palm.db/merge", { objects: [email] });
            // "Send" at once: the compose card closes as soon as this
            // returns, taking any timer in this page with it.
            if (!isDraft && account.sentFolderId) {
                callNow("palm://com.palm.db/merge", { objects: [{ _id: id, folderId: account.sentFolderId,
                    sendStatus: { error: null, fatalError: false, retryCount: 0, sent: true } }] });
            }
            reply(ok({ emailId: id }));
        }

        register(["com.palm.smtp"], {
            "/sendMail": function (p, reply) { saveEmail(p, !!p.draft, reply); },
            "/saveDraft": function (p, reply) { saveEmail(p, true, reply); },
            "*": function (p, reply) { reply(ok({})); }
        });

        register(["com.palm.imap", "com.palm.pop"], {
            "/downloadMessage": function (p, reply) { reply(fail(-1, "The mail server is not available in the Phoenix simulator")); },
            "/downloadAttachment": function (p, reply) { reply(fail(-1, "The mail server is not available in the Phoenix simulator")); },
            // syncFolder, syncAccount, accountCreated, ...: nothing to sync.
            "*": function (p, reply) { reply(ok({})); }
        });
    })();

    // ---- db8 kinds installed with the system -----------------------------------------
    //
    // On a device the services and apps install their db8 kinds at boot
    // (db/kinds, db8/kinds in app-services and the apps' configuration/).
    // Only inheritance and revision sets matter to the simulated db8:
    // queries "from" a parent kind find objects of its sub-kinds, and
    // revSets properties are bumped on every change.
    (function installSystemKinds() {
        var VERSION = 2;
        if (store.get("db8SystemKinds", 0) >= VERSION)
            return;
        var kinds = {
            "com.palm.contact.palmprofile:1": { extends: ["com.palm.contact:1"] },
            "com.palm.calendar:1": { revSets: ["calendarRevset"] },
            "com.palm.calendarevent:1": { revSets: ["eventDisplayRevset"] },
            "com.palm.mail.account:1": { revSets: ["_revSmtp"] },
            "com.palm.email:1": { revSets: ["EmailProcessorRev"] },
            "com.palm.folder:1": {},
            "com.palm.imap.account:1": { extends: ["com.palm.mail.account:1"], revSets: ["ImapConfigRev"] },
            "com.palm.imap.folder:1": { extends: ["com.palm.folder:1"] },
            "com.palm.imap.email:1": { extends: ["com.palm.email:1"], revSets: ["UpsyncRev"] },
            "com.palm.pop.account:1": { extends: ["com.palm.mail.account:1"] },
            "com.palm.pop.folder:1": { extends: ["com.palm.folder:1"] },
            "com.palm.pop.email:1": { extends: ["com.palm.email:1"] }
        };
        Object.keys(kinds).forEach(function (id) {
            callNow("palm://com.palm.db/putKind", {
                id: id,
                extends: kinds[id].extends || [],
                revSets: (kinds[id].revSets || []).map(function (name) { return { name: name }; })
            });
        });
        store.set("db8SystemKinds", VERSION);
    })();

    // ---- Kinds that are backed up -------------------------------------------------------
    //
    // db8 backs up the kinds whose definition says "sync": true (MojDbKind;
    // internal/preBackup). These are the data that lives only on the device:
    // the local address book, calendar, tasks, memos, messages, the call log,
    // alarms and the apps' own preferences. Data that syncs with an account
    // (email, CardDAV / CalDAV contacts and events) is in sub-kinds of its
    // own and comes back from the server instead. Phoenix's own apps say so
    // in their kind files (apps/tasks/public/configuration/db/kinds); the
    // core apps' kinds get it from meta-phoenix on a device.
    (function backupKinds() {
        var VERSION = 1;
        if (store.get("db8BackupKinds", 0) >= VERSION) return;
        var key = "db8:com.palm.db";
        var db = store.get(key, { objects: {}, kinds: {}, rev: 1, nextId: 1 });
        ["com.palm.person:1", "com.palm.contact.palmprofile:1", "com.palm.calendar:1", "com.palm.calendarevent:1",
         "com.palm.task:1", "com.palm.tasklist:1", "com.palm.note:1", "com.palm.smsmessage:1", "com.palm.chatthread:1",
         "com.palm.phonecall:1", "com.palm.clock.alarm:1", "com.palm.clock.prefs:1", "com.palm.app.contacts.prefs:1",
         "com.palm.app.email.prefs:1", "org.webosphoenix.voicememo:1", "org.webosphoenix.maps.place:1"].forEach(function (id) {
            var k = db.kinds[id] || { extends: [], indexes: [], revSets: [] };
            k.sync = true;
            db.kinds[id] = k;
        });
        store.set(key, db);
        store.set("db8BackupKinds", VERSION);
    })();

    // ---- Sample data (simulator only) ------------------------------------------------
    //
    // The first time the runtime starts in a profile, fill db8 with the
    // demo data in runtime/sample-data.js (fictional contacts, events,
    // emails, ... so the apps have something to show). Never on a device;
    // never again once loaded, even if the user deletes it all.
    // runtime.resetSampleData() loads it again on the next start;
    // runtime.loadSampleData(true) loads it now (objects have fixed ids, so
    // loading again replaces rather than duplicates them).
    // Version 2 added the accounts' credentials: a profile that loaded
    // version 1 gets those alone (its data is the user's now).
    runtime.loadSampleData = function (force) {
        var loaded = store.get("sampleData", 0);
        if (!force && loaded >= 2)
            return;
        var text = PalmSystem.getResource("/usr/share/phoenix/runtime/sample-data.js");
        var data;
        try {
            data = new Function(text + "\nreturn phoenixSampleData;")()(new Date());
        } catch (e) {
            console.warn("[phoenix-runtime] sample data not loaded: " + e);
            return;
        }
        var creds = store.get("accountCredentials", {});
        Object.keys(data.credentials || {}).forEach(function (id) {
            if (!creds[id]) creds[id] = data.credentials[id];
        });
        store.set("accountCredentials", creds);
        if (!force && loaded) {
            store.set("sampleData", data.version || 1);
            return;
        }
        var byDb = {};
        (data.objects || []).forEach(function (o) {
            var db = o._db || "com.palm.db";
            delete o._db;
            (byDb[db] = byDb[db] || []).push(o);
        });
        Object.keys(byDb).forEach(function (db) {
            callNow("palm://" + db + "/put", { objects: byDb[db] });
        });
        if (data.profile) store.set("profile", data.profile);
        (data.prefs || []).forEach(function (p) { store.set(p.key, p.value); });
        store.set("sampleData", data.version || 1);
    };
    runtime.loadSampleData(false);

    runtime.resetSampleData = function () { store.set("sampleData", 0); };

    // ---- Fonts (core apps) ------------------------------------------------------------
    //
    // The original apps and Enyo 1.0 ask for Palm's Prelude typeface under
    // several names ("Prelude", "Prelude Medium", "PreludeWGL-Light", ...).
    // It is not redistributable, and some app styles name it with no
    // fallback (Calculator: font-family: "Prelude Medium"), which leaves a
    // serif font. Alias those names to Prelude if it is installed, otherwise
    // to Open Sans, which Phoenix ships at /usr/share/fonts/open-sans/ and
    // the shell uses too (Theme.qml). "Open Sans" itself resolves to the same
    // files for the Phoenix apps.
    (function aliasPreludeFonts() {
        if (!global.document || !global.document.fonts || typeof global.FontFace !== "function")
            return;
        var dir = "/usr/share/fonts/open-sans/OpenSans-";
        function src(locals, file) {
            return locals.map(function (n) { return "local(\"" + n + "\")"; })
                .concat(["url(\"" + dir + file + ".ttf\")"]).join(", ");
        }
        var faces = {
            regular: src(["Prelude", "Prelude Medium"], "Regular"),
            light: src(["Prelude Light"], "Light"),
            bold: src(["Prelude Bold"], "Bold"),
            italic: src(["Prelude Italic"], "Italic"),
            boldItalic: src(["Prelude Bold Italic"], "BoldItalic")
        };
        var families = {
            "Prelude": faces.regular, "Prelude Medium": faces.regular, "Prelude-Medium": faces.regular,
            "Prelude Light": faces.light, "Prelude-Light": faces.light, "PreludeWGL-Light": faces.light,
            "Open Sans": faces.regular
        };
        Object.keys(families).forEach(function (family) {
            try {
                var doc = global.document;
                doc.fonts.add(new FontFace(family, families[family], { weight: "100 599" }));
                doc.fonts.add(new FontFace(family, faces.bold, { weight: "600 900" }));
                doc.fonts.add(new FontFace(family, faces.italic, { weight: "100 599", style: "italic" }));
                doc.fonts.add(new FontFace(family, faces.boldItalic, { weight: "600 900", style: "italic" }));
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
        try { info = JSON.parse((PalmSystem.getResource(m[1] + "appinfo.json") || "{}").replace(/^\ufeff/, "")); } catch (e) { info = {}; }
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

        // The shell says the card came to the front or left it (phoenix-sim:
        // SimWindowSource onFocusedUidChanged): a minimized card stays
        // visible in card view, so visibilitychange alone misses it. Pages
        // get a "phoenixcardactivation" event with detail {active}; apps
        // that hold secrets (Passwords, Authenticator) lock on it.
        runtime.cardActivated = function (active) {
            try {
                global.dispatchEvent(new CustomEvent("phoenixcardactivation", { detail: { active: !!active } }));
            } catch (e) { console.error("[phoenix-runtime] card activation event failed", e); }
        };
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

    // A faint blur behind the original apps' translucent popups and menus
    // (Enyo's Heritage and Onyx popup, menu and app menu art), for legibility;
    // they stay see-through. A Phoenix addition, like the shell's
    // BackdropBlur. The radius keeps the blur inside the art's rounded corners.
    (function () {
        var doc = global.document;
        if (!doc || !doc.createElement) return;
        function add() {
            if (doc.getElementById("phoenix-backdrop-blur") || !doc.head) return;
            var st = doc.createElement("style");
            st.id = "phoenix-backdrop-blur";
            st.textContent = ".enyo-popup {" +
                " -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); border-radius: 12px; }" +
                " .enyo-popup.enyo-appmenu { border-radius: 0 0 12px 12px; }";
            doc.head.appendChild(st);
        }
        if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", add);
        else add();
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

    // ---- Orientation ------------------------------------------------------------------
    //
    // An app asks for the orientation its window keeps with
    // PalmSystem.setWindowOrientation (Enyo's enyo.setAllowedOrientation,
    // Mojo's stageController.setWindowOrientation); "free" follows the
    // device. The shell holds the UI in that orientation while the card is
    // maximized, as LunaSysMgr did (CardWindow::onSetAppFixedOrientation).
    // When the window turns, the shell resizes the page to the turned card
    // and calls this: PalmSystem.screenOrientation and windowOrientation
    // change, Mojo apps get Mojo.screenOrientationChanged(orientation) as
    // WebAppMgr called it, and a resize event goes out so that Enyo
    // (enyo.sendOrientationChange on window resize, palm/system/system.js:
    // 58-64, 177) sends "windowRotated" also for a half turn, where the
    // page's size does not change.
    runtime.screenOrientationChanged = function (o) {
        if (["up", "down", "left", "right"].indexOf(o) < 0 || PalmSystem.screenOrientation === o)
            return;
        PalmSystem.screenOrientation = o;
        PalmSystem.windowOrientation = o;
        var mojo = global.Mojo;
        if (mojo && typeof mojo.screenOrientationChanged === "function") {
            try { mojo.screenOrientationChanged(o); } catch (e) { console.error("[phoenix-runtime] screenOrientationChanged failed", e); }
        }
        try { global.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
    };

    // ---- Virtual keyboard ----------------------------------------------------------------
    //
    // On webOS the web runtime was the keyboard's input client: WebKit told
    // LunaSysMgr's IMEController when an editable element got or lost the
    // focus, with the field's type (PalmIME::EditorState; luna-sysmgr
    // Src/ime/IMEController.cpp:125-140), the keyboard then showed, typed
    // into the element with key events, and hid when it lost the focus. The
    // shell hears the same here as "inputFocus" host messages
    // ({ focused, state: { type, actions, flags, enterKeyLabel } }) and types
    // with real key events into the page's view. Enyo's manual mode
    // (enyo.keyboard.setManualMode / show / hide over
    // PalmSystem.setManualKeyboardEnabled / keyboardShow / keyboardHide)
    // stops following the focus and shows or hides it on request. The shell
    // tells the app when the keyboard shows or hides, as LunaSysMgr's
    // CardWindow did (View_KeyboardShown -> Mojo.keyboardShown(bool), which
    // Enyo turns into its "keyboardShown" event, palm/system/keyboard.js).

    // PalmIME::FieldType (luna-webkit-api palmimedefines.h:33-44), from the
    // element's type as WebKit named it.
    var fieldTypes = { password: 1, search: 2, range: 3, email: 4, number: 5, tel: 6, url: 7, color: 8 };
    var textInputs = ["", "text", "password", "search", "email", "number", "tel", "url"];

    function editable(el) {
        if (!el || el.disabled || el.readOnly)
            return false;
        var tag = (el.tagName || "").toLowerCase();
        if (tag === "textarea")
            return true;
        if (tag === "input")
            return textInputs.indexOf((el.getAttribute("type") || "").toLowerCase()) >= 0;
        return !!el.isContentEditable;
    }

    function editorState(el) {
        var type = 0;
        if (el && (el.tagName || "").toLowerCase() === "input")
            type = fieldTypes[(el.getAttribute("type") || "").toLowerCase()] || 0;
        return { type: type, actions: 0, flags: 0, enterKeyLabel: "" };
    }

    var ime = { manual: false, reported: null };

    function reportInput(focused, state) {
        var key = focused ? toJson(state) : "";
        if (ime.reported === key)
            return;
        ime.reported = key;
        host.postToHost("inputFocus", { appId: PalmSystem.appIdentifier, focused: !!focused, state: state || null });
    }

    function followFocus() {
        if (ime.manual)
            return;
        var doc = global.document;
        var el = doc && doc.activeElement;
        if (editable(el))
            reportInput(true, editorState(el));
        else
            reportInput(false);
    }

    if (global.document) {
        global.document.addEventListener("focusin", followFocus, true);
        // After the focus has moved on (focusout fires first).
        global.document.addEventListener("focusout", function () { setTimeout(followFocus, 0); }, true);
    }

    runtime.imeSetManual = function (on) {
        ime.manual = !!on;
        if (!ime.manual)
            followFocus();
    };
    runtime.imeManualShow = function (type) {
        if (ime.manual)
            reportInput(true, { type: Number(type) || 0, actions: 0, flags: 0, enterKeyLabel: "" });
    };
    runtime.imeManualHide = function () {
        if (ime.manual)
            reportInput(false);
    };

    // The keyboard's hide key: the element loses the focus
    // (IMEController::hideIME -> InputClient::removeInputFocus).
    runtime.imeRemoveFocus = function () {
        var el = global.document && global.document.activeElement;
        if (el && el.blur && el !== global.document.body)
            el.blur();
        if (ime.manual)
            reportInput(false);
    };

    // The keyboard was shown (before the window shrinks) or hidden (after it
    // grew back).
    runtime.keyboardShown = function (shown) {
        var mojo = global.Mojo;
        if (mojo && typeof mojo.keyboardShown === "function") {
            try { mojo.keyboardShown(!!shown); } catch (e) { console.error("[phoenix-runtime] keyboardShown failed", e); }
        }
    };

    // ---- Editing: Cut, Copy, Paste, Select All ---------------------------------------
    //
    // The app menu's Edit submenu (Enyo's EditMenu, Mojo's editItem) and the
    // edit popup act on the focused field or the page's selection. As in
    // Enyo (base/controls/Input.js), Select All, Cut and Copy are the
    // page's own commands; Paste goes through PalmSystem.paste(), which asks
    // the host to paste the system clipboard into the focused field (on
    // webOS WebAppMgr did it for the page). The clipboard is the system's,
    // so every app shares it. Without a native host (a page in a plain
    // browser) Paste reads the clipboard itself.

    function editTarget() {
        var el = global.document && global.document.activeElement;
        return editable(el) ? el : null;
    }

    function selectedText() {
        var el = editTarget();
        if (el && typeof el.selectionStart === "number")
            return el.value.substring(el.selectionStart, el.selectionEnd);
        var sel = global.getSelection && global.getSelection();
        return sel ? String(sel) : "";
    }

    // What the Edit commands can do now (Enyo's EditMenu disabled its items
    // when nothing editable had the focus).
    runtime.editState = function () {
        var el = editTarget();
        var hasSelection = selectedText().length > 0;
        return { editable: !!el, canSelectAll: !!el, canCut: !!el && hasSelection, canCopy: hasSelection, canPaste: !!el };
    };

    function pasteText() {
        var clip = global.navigator && global.navigator.clipboard;
        if (!clip || !clip.readText)
            return;
        clip.readText().then(function (text) {
            if (text)
                global.document.execCommand("insertText", false, text);
        }, function () { /* no permission: nothing to paste */ });
    }

    runtime.edit = function (action) {
        var doc = global.document;
        if (!doc)
            return false;
        switch (action) {
        case "selectAll":
            var el = editTarget();
            if (el && typeof el.select === "function")
                el.select();
            else
                doc.execCommand("selectAll");
            return true;
        case "cut":
        case "copy":
            return doc.execCommand(action);
        case "paste":
            PalmSystem.paste();
            return true;
        }
        return false;
    };

    // PalmSystem.paste(): the host pastes into the focused field.
    runtime.paste = function () {
        if (nativeWebViews)
            host.postToHost("editAction", { appId: PalmSystem.appIdentifier, action: "paste" });
        else
            pasteText();
    };

    // Every Enyo 1.0 app menu starts with Edit (Enyo's own EditMenu), as
    // Mojo put Edit in every app's menu; the TouchPad apps did not list it
    // themselves, so it is added when Enyo defines enyo.AppMenu (the apps
    // are not changed). An app that has its own EditMenu keeps just that.
    function withEditMenu(AppMenu) {
        var proto = AppMenu && AppMenu.prototype;
        // Enyo 1.0's AppMenu only (Enyo 2 has no EditMenu).
        if (!proto || proto.__phoenixEditMenu || typeof proto.initComponents !== "function")
            return;
        proto.__phoenixEditMenu = true;
        var init = proto.initComponents;
        proto.initComponents = function () {
            init.apply(this, arguments);
            var enyo = global.enyo;
            // A popup is lazy: its items are made when it first opens
            // (enyo.LazyControl.validateComponents calls this again).
            if (this.lazy || !enyo.EditMenu)
                return;
            var has = (this.getControls ? this.getControls() : []).some(function (c) { return c instanceof enyo.EditMenu; });
            if (has)
                return;
            // First on screen (prepend: the client's children) and in the
            // menu's items (its controls: the last one gets the menu's
            // bottom style).
            var edit = this.createComponent({ kind: "EditMenu", prepend: true }, { owner: this });
            var at = this.controls ? this.controls.indexOf(edit) : -1;
            if (at > 0)
                this.controls.unshift(this.controls.splice(at, 1)[0]);
        };
    }

    function watchEnyo() {
        var enyoObj = global.enyo;
        var hook = function (e) {
            if (!e || typeof e !== "object" || e.__phoenixWatched)
                return;
            Object.defineProperty(e, "__phoenixWatched", { value: true });
            var menu = e.AppMenu;
            if (menu)
                return withEditMenu(menu);
            Object.defineProperty(e, "AppMenu", {
                configurable: true,
                enumerable: true,
                get: function () { return menu; },
                set: function (v) { menu = v; withEditMenu(v); }
            });
        };
        if (enyoObj)
            return hook(enyoObj);
        Object.defineProperty(global, "enyo", {
            configurable: true,
            enumerable: true,
            get: function () { return enyoObj; },
            set: function (v) { enyoObj = v; hook(v); }
        });
    }
    watchEnyo();

    // Press and hold with a mouse (the simulator on a computer; touch has
    // Chromium's own long press, which the host turns into the same popup):
    // the word under the pointer is selected and the host shows the edit
    // popup over it, as it does for a right click.
    var HOLD_MS = 500;
    var HOLD_SLOP = 6;

    function wordAround(text, at) {
        var isWord = function (c) { return /[\p{L}\p{N}_'’-]/u.test(c); };
        var start = at;
        var end = at;
        while (start > 0 && isWord(text.charAt(start - 1)))
            start--;
        while (end < text.length && isWord(text.charAt(end)))
            end++;
        return [start, end];
    }

    function selectWordAt(x, y, target) {
        var el = editable(target) ? target : null;
        if (el && typeof el.selectionStart === "number") {
            // The press put the caret under the pointer.
            var w = wordAround(el.value, el.selectionStart);
            el.setSelectionRange(w[0], w[1]);
            var box = el.getBoundingClientRect();
            return { x: x, y: box.top, width: 0, height: box.height };
        }
        var doc = global.document;
        var range = doc.caretRangeFromPoint && doc.caretRangeFromPoint(x, y);
        if (!range)
            return null;
        // Text the page keeps unselectable (Enyo 1.0's own UI, as on webOS).
        var node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        if (!node || global.getComputedStyle(node).userSelect === "none")
            return null;
        var sel = global.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        sel.modify("move", "backward", "word");
        sel.modify("extend", "forward", "word");
        // Words end before the space that follows them.
        var text = String(sel);
        var trimmed = text.replace(/\s+$/, "");
        for (var i = trimmed.length; i < text.length; i++)
            sel.modify("extend", "backward", "character");
        if (!String(sel))
            return null;
        var r = sel.getRangeAt(0).getBoundingClientRect();
        // The word under the pointer, not one the selection moved on to
        // (Selection.modify skips to the next selectable text).
        if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) {
            sel.removeAllRanges();
            return null;
        }
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    }

    function showEditPopup(rect) {
        var s = runtime.editState();
        host.postToHost("editMenu", {
            appId: PalmSystem.appIdentifier,
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            canSelectAll: s.canSelectAll, canCut: s.canCut, canCopy: s.canCopy, canPaste: s.canPaste
        });
    }

    if (global.document && global.PointerEvent) {
        var hold = null;
        var cancelHold = function () {
            if (hold) {
                clearTimeout(hold.timer);
                hold = null;
            }
        };
        global.document.addEventListener("pointerdown", function (e) {
            cancelHold();
            if (e.pointerType !== "mouse" || e.button !== 0)
                return;
            var target = e.target;
            // Links and controls keep their own press.
            if (target.closest && target.closest("a[href], button, select, [role=button]"))
                return;
            var x = e.clientX;
            var y = e.clientY;
            hold = {
                x: x, y: y,
                timer: setTimeout(function () {
                    hold = null;
                    var rect = selectWordAt(x, y, target);
                    if (rect)
                        showEditPopup(rect);
                }, HOLD_MS)
            };
        }, true);
        global.document.addEventListener("pointermove", function (e) {
            if (hold && Math.abs(e.clientX - hold.x) + Math.abs(e.clientY - hold.y) > HOLD_SLOP)
                cancelHold();
        }, true);
        global.document.addEventListener("pointerup", cancelHold, true);
        global.document.addEventListener("pointercancel", cancelHold, true);
    }

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
    //       getDeviceLockMode, setDevicePasscode, matchDevicePasscode,
    //       getSystemStatus (luna-sysmgr SystemService.cpp:3860-3970)
    //   com.webos.service.vpn                LuneOS luneos-vpn-adapter src/vpn_service.c (connman-vpnd
    //                                        on the bus; legacy com.palm.vpn names and error codes):
    //       getStatus, getProfileList, getProfileDetails, getConnectionDetails,
    //       getAgents, getAgentFormFields, connect, disconnect, addProfile,
    //       updateProfile, deleteProfile, uiPromptResponse, acceptEula. See "VPN" below.
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

        // A demo profile, as the system menu had (a fictional server and the
        // example keys of the WireGuard documentation): a connman-vpnd
        // connection, its path and properties (see "VPN" below).
        var DEMO_VPN = {
            path: "/net/connman/vpn/connection/vpn_example_com",
            props: { Name: "Office", Type: "wireguard", Host: "vpn.example.com", State: "idle", Immutable: false,
                     "WireGuard.PrivateKey": "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=",
                     "WireGuard.PublicKey": "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=",
                     "WireGuard.Address": "10.8.0.2/32", "WireGuard.DNS": "10.8.0.1",
                     "WireGuard.AllowedIPs": "0.0.0.0/0, ::/0", "WireGuard.EndpointPort": "51820" }
        };

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
                timeOffset: 0,
                vpn: { connections: [DEMO_VPN] }
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
                timeFormat: p.timeFormat === "HH24" ? "HH24" : "HH12",
                muted: !!s.audio.muted,
                // What the shell's system sounds follow (SystemSounds.qml):
                // volumes (master, then pringtones / palerts / pfeedback),
                // "System Sounds", the keyboard's clicks and the tones.
                volume: s.audio.volume,
                streams: { pringtones: s.audio.streams.pringtones, palerts: s.audio.streams.palerts,
                           pfeedback: s.audio.streams.pfeedback },
                systemSounds: p.systemSounds !== false,
                tapSounds: tapSounds(p),
                // Settings > Text Assist (the keyboard): suggestions,
                // auto-correction, swipe typing, double space for a period,
                // and when the learned words were last forgotten.
                textAssist: textAssist(p),
                // The keyboards (Settings > Text Assist > Keyboards) and the
                // one in use (the language key switches).
                keyboards: keyboardCombos(p),
                keyboard: keyboardInUse(p),
                ringtone: (p.ringtone && p.ringtone.fullPath) || "",
                alerttone: (p.alerttone && p.alerttone.fullPath) || "",
                notificationtone: (p.notificationtone && p.notificationtone.fullPath) || "",
                showAlertsWhenLocked: p.showAlertsWhenLocked !== false,
                // What the volume keys adjust, as audiod's scenarios
                // (NativeAlertManager::actOnChanged): the shell's volume
                // indicator draws the phone, ringtone or music picture.
                audioScenario: audioScenario(),
                screenTimeout: typeof p.screenTimeout === "number" ? p.screenTimeout : 60,
                lockTimeout: typeof p.lockTimeout === "number" ? p.lockTimeout : 0,
                advancedGestures: !!p.sysUiEnableNextPrevGestures,
                // Settings > Accessibility: the shell's animations.
                reduceMotion: !!(p.accessibility && p.accessibility.reduceMotion),
                wallpaperFile: (p.wallpaper && p.wallpaper.wallpaperFile) || "",
                // The system menu's VPN drawer: each profile's name, its state
                // (disconnected, connecting, connected) and whether connecting
                // asks for a user name and password (then the drawer opens
                // Settings > VPN, which answers the prompt).
                vpnProfiles: (s.vpn ? s.vpn.connections : []).map(function (c) {
                    var st = vpnApiState(c.props.State);
                    return { name: c.props.Name, state: st === "disconnecting" ? "connecting" : st === "unknown" ? "disconnected" : st,
                             needsCredentials: vpnNeedsCredentials(c) };
                })
            };
        }

        // The keyboard's "Keyboard clicks": x_palm_virtualkeyboard_prefs
        // (a JSON string, VirtualKeyboardPreferences.cpp:233, 325) TapSounds.
        function keyboardPrefs(p) {
            var kb = p.x_palm_virtualkeyboard_prefs;
            if (typeof kb === "string") { try { kb = JSON.parse(kb); } catch (e) { kb = null; } }
            return kb && typeof kb === "object" ? kb : {};
        }
        function tapSounds(p) {
            return keyboardPrefs(p).TapSounds !== false;
        }
        // "ringtone" while a call rings, "phone" during one (dialing,
        // alerting, active, held), "media" while an app holds the media
        // audio focus (com.webos.service.audiofocusmanager), else "system".
        function audioScenario() {
            var t = store.get("telephony:state", null), calls = (t && t.calls) || [];
            if (calls.some(function (c) { return c.state === "incoming" || c.state === "waiting"; }))
                return "ringtone";
            if (calls.some(function (c) { return c.state !== "disconnected"; }))
                return "phone";
            var f = store.get("audiofocus", null);
            return f && f.streamType === "pmedia" ? "media" : "system";
        }
        // The keyboards the user turned on (x_palm_virtualkeyboard_prefs
        // keyboards, VirtualKeyboardPreferences::virtualKeyboardPreferencesChanged):
        // [{layout, language}], and the one in use
        // (x_palm_virtualkeyboard_settings {layout, language}). The layouts
        // the keyboard has, and the languages it has words for ("none":
        // no suggestions or corrections).
        var KEYBOARD_LAYOUTS = ["qwerty", "qwertz", "azerty"];
        var KEYBOARD_LANGUAGES = ["en", "de", "fr", "none"];
        function keyboardCombo(c) {
            if (!c || typeof c !== "object") return null;
            var layout = String(c.layout || "").toLowerCase(), language = String(c.language || "").toLowerCase();
            return KEYBOARD_LAYOUTS.indexOf(layout) >= 0 && KEYBOARD_LANGUAGES.indexOf(language) >= 0
                ? { layout: layout, language: language } : null;
        }
        function keyboardCombos(p) {
            var list = (keyboardPrefs(p).keyboards || []).map(keyboardCombo).filter(Boolean);
            return list.length ? list : [{ layout: "qwerty", language: "en" }];
        }
        function keyboardInUse(p) {
            var st = p.x_palm_virtualkeyboard_settings;
            if (typeof st === "string") { try { st = JSON.parse(st); } catch (e) { st = null; } }
            var c = keyboardCombo(st), list = keyboardCombos(p);
            for (var i = 0; c && i < list.length; ++i)
                if (list[i].layout === c.layout && list[i].language === c.language)
                    return list[i];
            return list[0];
        }
        function textAssist(p) {
            var kb = keyboardPrefs(p);
            return { suggestions: kb.WordSuggestions !== false, autoCorrect: kb.AutoCorrect !== false,
                     swipe: kb.SwipeTyping !== false, spaces2period: kb.spaces2period !== false,
                     forgetWords: typeof kb.ForgetWords === "number" ? kb.ForgetWords : 0 };
        }

        function changed() {
            listeners.slice().forEach(function (fn) { fn(); });
        }

        function save(s) {
            vpnFollowNetwork(s);
            store.set(KEY, s);
            if (!suppressHost)
                host.postToHost("systemStatus", hostStatus(s));
            changed();
        }

        // Another window changed the shared state.
        try {
            global.addEventListener("storage", function (e) {
                if (e.key === "phoenix:" + KEY || e.key === "phoenix:prefs" || e.key === "phoenix:deviceLocked") changed();
            });
        } catch (e) { /* ignore */ }

        // Subscribe helper: reply now, then again whenever the answer changes.
        function watch(p, reply, ctx, compute) {
            var last = toJson(compute());
            var first = JSON.parse(last);
            if (p.subscribe) first.subscribed = true;
            reply(first);
            if (!p.subscribe) return;
            var fn = function () {
                if (ctx.cancelled()) {
                    listeners = listeners.filter(function (l) { return l !== fn; });
                    return;
                }
                var now = toJson(compute());
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
            // playFeedback {name, sink?}: a named feedback sound (the
            // keyboard's key clicks, "appclose"). Silent when "System
            // Sounds" is off and no sink was named (SoundPlayerPool::
            // playFeedback), or when no sound of that name ships.
            "/playFeedback": playFeedback,
            "/systemsounds/playFeedback": playFeedback,
            // playSound {fileName, sink} (audiod-pro PlaybackManager), plus
            // Phoenix's loop, duration (ms, stop after), volume (0..1, else
            // the stream's) and fallback (played if the file cannot be).
            "/playSound": function (p, reply) {
                if (!p.fileName || !p.sink) return reply(fail(-1, "fileName and sink are required"));
                reply(ok({ playbackId: sounds.play(p) }));
            },
            // controlPlayback {playbackId, requestType: "stop" | "pause" | "play"}
            "/controlPlayback": function (p, reply) {
                if (!sounds.control(p.playbackId, p.requestType)) return reply(fail(-1, "Invalid playbackId"));
                reply(ok({ playbackId: p.playbackId }));
            },
            "/getPlaybackStatus": function (p, reply) {
                var a = sounds.active[p.playbackId];
                reply(ok({ playbackId: p.playbackId, state: a ? (a.audio.paused ? "paused" : "playing") : "stopped" }));
            }
        });
        // Enyo's sound service (PalmServices "palm://com.palm.audio/systemsounds/").
        var legacyAudio = runtime.services["com.palm.audio"] || {};
        register(["com.palm.audio"], {
            "/systemsounds/playFeedback": playFeedback,
            "*": legacyAudio["*"] || function (p, reply) { reply(ok()); }
        });

        // ---- The sound player (HTML audio; the simulator's audiod) -------------------
        //
        // __phoenixRuntime.sounds:
        //   play({fileName, sink, loop?, duration?, volume?, fallback?, playbackId?}) -> playbackId
        //   control(playbackId, "stop" | "pause" | "play") -> bool
        //   log         what played: [{playbackId, fileName, sink, loop, duration, volume}]
        //   active      playbackId -> {audio, ...} while playing
        //   createAudio(url) -> an HTMLAudioElement (tests replace it)
        // The shell plays its system sounds through one runtime page
        // (SimWindowSource.playSound).
        var FEEDBACK_DIR = "/usr/share/phoenix/sounds/feedback";
        var FEEDBACK = ["key", "space", "backspace", "return", "appclose"];
        var nextPlayback = 1;
        var sounds = runtime.sounds = {
            log: [],
            active: {},
            createAudio: function (url) { return new global.Audio(url); },
            // A URL for a device path: a /media file of the Files store, else
            // the rootfs path itself (served by phoenix-sim and serve-rootfs.py).
            urlFor: function (path) {
                return runtime.fileManager && /^\/media\//.test(path) ? runtime.fileManager.url(path) : Promise.resolve(path);
            },
            play: function (p) {
                var id = p.playbackId ? String(p.playbackId) : "pb" + (nextPlayback++);
                var st = load().audio;
                var vol = typeof p.volume === "number" ? p.volume
                    : st.muted ? 0 : (st.volume / 100) * ((st.streams[p.sink] === undefined ? 100 : st.streams[p.sink]) / 100);
                var entry = { playbackId: id, fileName: String(p.fileName), sink: String(p.sink), loop: !!p.loop,
                              duration: p.duration > 0 ? p.duration | 0 : -1, volume: Math.max(0, Math.min(1, vol)) };
                sounds.log.push(entry);
                if (sounds.log.length > 100) sounds.log.shift();
                var rec = { entry: entry, audio: null, timer: null, stopped: false };
                sounds.active[id] = rec;
                var start = function (path, isFallback) {
                    sounds.urlFor(path).then(function (url) {
                        if (rec.stopped) return;
                        var a;
                        try { a = sounds.createAudio(url); } catch (e) { return sounds.control(id, "stop"); }
                        rec.audio = a;
                        a.loop = entry.loop;
                        a.volume = entry.volume;
                        a.addEventListener("ended", function () { if (!entry.loop) sounds.control(id, "stop"); });
                        a.addEventListener("error", function () {
                            // SoundPlayer::healthCheck: the fallback instead.
                            if (!isFallback && p.fallback && !rec.stopped) start(String(p.fallback), true);
                            else sounds.control(id, "stop");
                        });
                        var r = a.play && a.play();
                        if (r && r.catch) r.catch(function () { /* no audio output, autoplay policy */ });
                    });
                };
                if (entry.volume > 0) start(entry.fileName, false);
                if (entry.duration > 0) rec.timer = setTimeout(function () { sounds.control(id, "stop"); }, entry.duration);
                return id;
            },
            control: function (id, what) {
                var rec = sounds.active[id];
                if (!rec) return false;
                if (what === "pause") { if (rec.audio) rec.audio.pause(); return true; }
                if (what === "play") { if (rec.audio && rec.audio.play) rec.audio.play(); return true; }
                rec.stopped = true;
                if (rec.timer) clearTimeout(rec.timer);
                if (rec.audio) { try { rec.audio.pause(); } catch (e) { /* ignore */ } }
                delete sounds.active[id];
                return true;
            }
        };
        function playFeedback(p, reply) {
            if (!p.name) return reply(fail(-1, "name is required"));
            var silent = (!p.sink && prefs().systemSounds === false) || FEEDBACK.indexOf(p.name) < 0 || p.play === false;
            if (!silent)
                sounds.play({ fileName: FEEDBACK_DIR + "/" + p.name + ".wav", sink: p.sink || "pfeedback" });
            reply(ok());
        }

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
            if (["rotationLock", "wallpaper", "timeFormat", "showAlertsWhenLocked", "screenTimeout", "lockTimeout", "sysUiEnableNextPrevGestures", "systemSounds", "ringtone", "alerttone",
                 "notificationtone", "x_palm_virtualkeyboard_prefs", "x_palm_virtualkeyboard_settings", "accessibility"].some(function (k) { return k in p; })) {
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
            core_os_release_codename: "rockhopper", webos_api_version: "2.0.0", webos_build_id: "1",
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
        sys["/osInfo/query"] = function (p, reply) {
            // The running system: the booted slot (System updates, below).
            var b = runtime.updateSlots && runtime.updateSlots.booted();
            if (b) { osInfo.webos_release = b.version; osInfo.webos_build_id = String(b.build); }
            reply(pick(osInfo, p.parameters));
        };

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
            // The lock screen is up, as the shell last said (SystemService
            // getLockStatus); subscribe to hear it lock and unlock. The phone
            // app answers a ringing call when the user unlocks.
            "/getLockStatus": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ locked: !!store.get("deviceLocked", false) }); });
            },
            // How the UI and the device are turned, as the shell last said
            // ({ orientation: { ui, device } }); subscribe to follow them.
            // ime.visible: the virtual keyboard is up, as the shell last said.
            "/getSystemStatus": function (p, reply, ctx) {
                watch(p, reply, ctx, function () {
                    var o = store.get("orientation", null) || {};
                    // gestureArea (Phoenix): the shell says whether there is one.
                    return ok({ ime: { visible: !!store.get("imeVisible", false) }, orientation: { ui: o.ui || "up", device: o.device || "up" },
                                gestureArea: !!store.get("gestureArea", false) });
                });
            },
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

        // ---- Developer Mode (com.webos.service.devmode, OSE's API) ------------------
        //
        //   getDevMode {}                 -> {status: "enabled" | "disabled"}
        //   setDevMode {status}           OSE restarts the device for it; the
        //                                 simulator applies it at once
        //
        // Settings > Developer Mode asks for the device passcode first
        // (matchDevicePasscode); with Developer Mode on, the Marketplace
        // installs packages with install scripts and services, and the
        // Terminal's sudo and SSH become possible (docs/TERMINAL.md T4).
        // Wiping the device (erase) turns it off.
        function devMode() { return store.get("devMode", false) ? "enabled" : "disabled"; }
        var devModeWatchers = [];
        register(["com.webos.service.devmode"], {
            "/getDevMode": function (p, reply, ctx) {
                reply(ok({ status: devMode(), subscribed: !!p.subscribe }));
                if (p.subscribe) devModeWatchers.push({ reply: reply, ctx: ctx });
            },
            "/setDevMode": function (p, reply) {
                if (p.status !== "enabled" && p.status !== "disabled")
                    return reply(fail(-1, "status: \"enabled\" or \"disabled\""));
                store.set("devMode", p.status === "enabled");
                reply(ok({ status: devMode() }));
                devModeWatchers = devModeWatchers.filter(function (w) { return !w.ctx.cancelled(); });
                devModeWatchers.forEach(function (w) { w.reply(ok({ status: devMode() })); });
            }
        });

        // ---- Phoenix: erase (no OSE equivalent yet) ---------------------------------
        //
        // Device Info's reset options, as legacy webOS had them: eraseUserData
        // ("Erase Apps & Data") removes the apps' data, accounts and settings
        // but keeps the user's files (the USB drive: /media/internal, its
        // index); fullErase ("Full Erase") removes those files too. First Use
        // runs at the next start either way.

        // The user's files: the file manager's tree and the media index.
        var USER_FILE_KEYS = ["phoenix:files:vfs", "phoenix:media:index"];
        function eraseStore(keepFiles) {
            try {
                var ls = global.localStorage, keys = [];
                for (var i = 0; i < ls.length; ++i) {
                    var k = ls.key(i);
                    if (k.indexOf("phoenix:") === 0 && !(keepFiles && USER_FILE_KEYS.indexOf(k) >= 0))
                        keys.push(k);
                }
                keys.forEach(function (k) { ls.removeItem(k); });
            } catch (e) { /* ignore */ }
            save(load());
        }
        register(["org.webosphoenix.service.reset"], {
            "/eraseUserData": function (p, reply) {
                eraseStore(true);
                reply(ok());
            },
            "/fullErase": function (p, reply) {
                eraseStore(false);
                var media = runtime.mediaFiles;
                (media ? media.clear() : Promise.resolve()).then(function () { reply(ok()); },
                    function (e) { reply(fail(-1, "Could not erase the files: " + e)); });
            }
        });

        // ---- VPN (com.webos.service.vpn: LuneOS luneos-vpn-adapter) ----------------
        //
        // OSE has no VPN service, and legacy webOS's com.palm.vpn (PmVpnDaemon)
        // was not released. LuneOS bridges connman-vpnd onto the bus as
        // com.webos.service.vpn, keeping the legacy method names and error codes
        // (github.com/webOS-ports/luneos-vpn-adapter, Apache-2.0, master 40bdda2:
        // src/vpn_service.c, vpn_errors.h, vpn_providers.c, profile_build.c,
        // files/formfields/*.json). Phoenix uses it unchanged on a device; this
        // simulates it, wire for wire: the replies, the -1 to -10 errors, the
        // state mapping, the subscriptions and the credential prompt (connect
        // answers -7 with a promptId, pushes the prompt on getStatus, and
        // uiPromptResponse answers it). Only connman-vpnd is pretended: the
        // connections (path + properties, kept in "settings:state"), their
        // State (idle -> configuration -> ready), and credentials it asks for.
        //
        // Differences, all on purpose: nothing is really tunnelled; the
        // credentials are kept in the simulated store (connman-vpnd keeps them
        // under /var/lib/connman-vpn, 0600, and re-supplies them itself); and
        // a VPN needs Wi-Fi here (no mobile data in the simulator).

        // vpn_providers.c: [connmanType, guid, label, technology, deprecated, import].
        var VPN_PROVIDERS = [
            ["wireguard", "com.webos.vpn.wireguard", "WireGuard", "WireGuard", false, "wg-conf"],
            ["openvpn", "com.webos.vpn.openvpn", "OpenVPN", "ssl", false, "ovpn"],
            ["openconnect", "com.webos.vpn.openconnect", "OpenConnect (AnyConnect)", "ssl", false, null],
            ["vpnc", "com.webos.vpn.vpnc", "Cisco IPsec", "IPSec", false, null],
            ["l2tp", "com.webos.vpn.l2tp", "L2TP/IPsec", "L2TP", false, null],
            ["pptp", "com.webos.vpn.pptp", "PPTP", "PPTP", true, null]
        ];
        // files/formfields/<type>.json "vpnFormFields", verbatim. These and the
        // provider table above: Copyright (c) 2026 Herman van Hazendonk,
        // Apache-2.0 (NOTICE).
        var VPN_FORM_FIELDS = {"l2tp":[{"id":"l2tpUser","type":"textfield","label":"User name","connmanProperty":"L2TP.User"},{"id":"l2tpPassword","type":"passwordfield","label":"Password","connmanProperty":"L2TP.Password"},{"id":"l2tpIpsecSaref","type":"checkbox","label":"Use IPsec SA reference","trueValue":"true","falseValue":"false","connmanProperty":"L2TP.IPsecSaref"},{"id":"l2tpPort","type":"textfield","label":"UDP port","value":"1701","inputType":"number","connmanProperty":"L2TP.Port"},{"id":"l2tpDefaultRoute","type":"checkbox","label":"Use as default route","value":"true","trueValue":"true","falseValue":"false","connmanProperty":"L2TP.DefaultRoute"},{"id":"pppdReqMppe128","type":"checkbox","label":"Require MPPE 128-bit","trueValue":"true","falseValue":"false","connmanProperty":"PPPD.ReqMPPE128"},{"id":"pppdRefuseEap","type":"checkbox","label":"Refuse EAP","trueValue":"true","falseValue":"false","connmanProperty":"PPPD.RefuseEAP"},{"id":"pppdEchoInterval","type":"textfield","label":"LCP echo interval (s)","inputType":"number","connmanProperty":"PPPD.EchoInterval"},{"id":"pppdEchoFailure","type":"textfield","label":"LCP echo failures","inputType":"number","connmanProperty":"PPPD.EchoFailure"}],"openconnect":[{"id":"ocAuthType","type":"listselector","label":"Authentication","value":"cookie","connmanProperty":"OpenConnect.AuthType","options":[{"label":"Cookie","value":"cookie"},{"label":"Username / password then cookie","value":"cookie_with_userpass"},{"label":"Username / password","value":"userpass"},{"label":"Certificate","value":"publickey"},{"label":"PKCS#12","value":"pkcs"}]},{"id":"ocUsergroup","type":"textfield","label":"Login group","connmanProperty":"OpenConnect.Usergroup"},{"id":"ocCaCert","type":"textfield","label":"CA certificate","connmanProperty":"OpenConnect.CACert"},{"id":"ocClientCert","type":"textfield","label":"Client certificate","connmanProperty":"OpenConnect.ClientCert"},{"id":"ocUserPrivateKey","type":"textfield","label":"Client private key","connmanProperty":"OpenConnect.UserPrivateKey"},{"id":"ocPkcsClientCert","type":"textfield","label":"PKCS#12 bundle","connmanProperty":"OpenConnect.PKCSClientCert"},{"id":"ocServerCert","type":"textfield","label":"Server cert fingerprint (SHA1)","connmanProperty":"OpenConnect.ServerCert"},{"id":"ocAllowSelfSigned","type":"checkbox","label":"Allow self-signed server certificate","trueValue":"true","falseValue":"false","connmanProperty":"OpenConnect.AllowSelfSignedCert"},{"id":"ocDisableIPv6","type":"checkbox","label":"Disable IPv6","trueValue":"true","falseValue":"false","connmanProperty":"OpenConnect.DisableIPv6"},{"id":"ocNoDtls","type":"checkbox","label":"Disable DTLS / ESP","trueValue":"true","falseValue":"false","connmanProperty":"OpenConnect.NoDTLS"},{"id":"ocNoHttpKeepalive","type":"checkbox","label":"Disable HTTP keep-alive","trueValue":"true","falseValue":"false","connmanProperty":"OpenConnect.NoHTTPKeepalive"},{"id":"ocMtu","type":"textfield","label":"MTU","inputType":"number","connmanProperty":"VPN.MTU"}],"openvpn":[{"id":"ovpnConfigFile","type":"textfield","label":"Config file","hint":"use Import to set this","editable":false,"connmanProperty":"OpenVPN.ConfigFile"},{"id":"ovpnCaCert","type":"textfield","label":"CA certificate","connmanProperty":"OpenVPN.CACert"},{"id":"ovpnCert","type":"textfield","label":"Client certificate","connmanProperty":"OpenVPN.Cert"},{"id":"ovpnKey","type":"textfield","label":"Client key","connmanProperty":"OpenVPN.Key"},{"id":"ovpnAuthUserPass","type":"checkbox","label":"Username / password auth","trueValue":"-","falseValue":"","connmanProperty":"OpenVPN.AuthUserPass","note":"connman's ov_options table maps OpenVPN.AuthUserPass -> --auth-user-pass and treats the literal value \"-\" as \"query over the OpenVPN management interface\". Empty clears it. Never write \"true\"/\"false\" here."},{"id":"ovpnProto","type":"listselector","label":"Protocol","value":"udp","connmanProperty":"OpenVPN.Proto","options":[{"label":"UDP","value":"udp"},{"label":"TCP","value":"tcp"}]},{"id":"ovpnPort","type":"textfield","label":"Port","value":"1194","inputType":"number","connmanProperty":"OpenVPN.Port"},{"id":"ovpnDeviceType","type":"listselector","label":"Device type","value":"tun","connmanProperty":"OpenVPN.DeviceType","options":[{"label":"tun (layer 3)","value":"tun"},{"label":"tap (layer 2)","value":"tap"}]},{"id":"ovpnCipher","type":"textfield","label":"Cipher","connmanProperty":"OpenVPN.Cipher"},{"id":"ovpnAuth","type":"textfield","label":"HMAC digest","connmanProperty":"OpenVPN.Auth"},{"id":"ovpnRemoteCertTls","type":"listselector","label":"Verify peer cert type","value":"server","connmanProperty":"OpenVPN.RemoteCertTls","options":[{"label":"server","value":"server"},{"label":"client","value":"client"}]},{"id":"ovpnCompLzo","type":"listselector","label":"LZO compression","value":"adaptive","connmanProperty":"OpenVPN.CompLZO","options":[{"label":"Adaptive","value":"adaptive"},{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]},{"id":"ovpnMtu","type":"textfield","label":"MTU","inputType":"number","connmanProperty":"OpenVPN.MTU"},{"id":"ovpnAuthNoCache","type":"checkbox","label":"Never cache credentials","trueValue":"true","falseValue":"false","connmanProperty":"OpenVPN.AuthNoCache"}],"pptp":[{"id":"pptpDeprecationWarning","type":"status","statusType":"error","value":"PPTP encryption is broken and can be decrypted by an attacker. Use WireGuard or OpenVPN where possible."},{"id":"pptpUser","type":"textfield","label":"User name","connmanProperty":"PPTP.User"},{"id":"pptpPassword","type":"passwordfield","label":"Password","connmanProperty":"PPTP.Password"},{"id":"pppdReqMppe128","type":"checkbox","label":"Require MPPE 128-bit","value":"true","trueValue":"true","falseValue":"false","connmanProperty":"PPPD.RequirMPPE128"},{"id":"pppdRefuseEap","type":"checkbox","label":"Refuse EAP","trueValue":"true","falseValue":"false","connmanProperty":"PPPD.RefuseEAP"},{"id":"pppdEchoInterval","type":"textfield","label":"LCP echo interval (s)","inputType":"number","connmanProperty":"PPPD.EchoInterval"}],"vpnc":[{"id":"vpnUserId","type":"textfield","label":"User name","connmanProperty":"VPNC.Xauth.Username"},{"id":"vpnPassword","type":"passwordfield","label":"Password","connmanProperty":"VPNC.Xauth.Password"},{"id":"vpnGroupId","type":"textfield","label":"Group name","connmanProperty":"VPNC.IPSec.ID","required":true},{"id":"vpnGroupSecret","type":"passwordfield","label":"Group password","connmanProperty":"VPNC.IPSec.Secret"},{"id":"vpnDomain","type":"textfield","label":"Domain","connmanProperty":"VPNC.Domain"},{"id":"vpnDeadPeerDetection","type":"textfield","label":"DPD idle timeout (our side)","inputType":"number","connmanProperty":"VPNC.DPDTimeout"},{"id":"vpnEncryptionMethod","type":"listselector","label":"Encryption method","value":"secure","connmanPropertyMap":{"secure":{"VPNC.SingleDES":"","VPNC.NoEncryption":""},"singledes":{"VPNC.SingleDES":"yes","VPNC.NoEncryption":""},"noencryption":{"VPNC.SingleDES":"","VPNC.NoEncryption":"yes"}},"options":[{"label":"Secure","value":"secure"},{"label":"Single DES","value":"singledes","deprecated":true},{"label":"No encryption","value":"noencryption","deprecated":true}]},{"id":"vpnNatTraversal","type":"listselector","label":"NAT traversal","value":"natt","connmanProperty":"VPNC.NATTMode","options":[{"label":"NAT-T (auto-detect)","value":"natt"},{"label":"Cisco-UDP","value":"cisco-udp"},{"label":"NAT-T (always)","value":"force-natt"},{"label":"Disabled","value":"none"}]},{"id":"vpnIkeAuthmode","type":"textfield","label":"IKE auth mode","connmanProperty":"VPNC.IKE.Authmode"},{"id":"vpnIkeDhGroup","type":"textfield","label":"IKE DH group","connmanProperty":"VPNC.IKE.DHGroup"},{"id":"vpnPfs","type":"textfield","label":"Perfect forward secrecy group","connmanProperty":"VPNC.PFS"},{"id":"vpnVendor","type":"textfield","label":"Gateway vendor","connmanProperty":"VPNC.Vendor"},{"id":"vpnDeviceType","type":"listselector","label":"Device type","value":"tun","connmanProperty":"VPNC.DeviceType","options":[{"label":"tun (layer 3)","value":"tun"},{"label":"tap (layer 2)","value":"tap"}]}],"wireguard":[{"id":"wgPrivateKey","type":"passwordfield","label":"Private key","connmanProperty":"WireGuard.PrivateKey","required":true},{"id":"wgPublicKey","type":"textfield","label":"Peer public key","connmanProperty":"WireGuard.PublicKey","required":true},{"id":"wgPresharedKey","type":"passwordfield","label":"Preshared key","connmanProperty":"WireGuard.PresharedKey"},{"id":"wgAddress","type":"textfield","label":"Address","hint":"10.2.0.2/24","connmanProperty":"WireGuard.Address","required":true},{"id":"wgDns","type":"textfield","label":"DNS servers","hint":"comma separated","connmanProperty":"WireGuard.DNS"},{"id":"wgAllowedIPs","type":"textfield","label":"Allowed IPs","value":"0.0.0.0/0, ::/0","connmanProperty":"WireGuard.AllowedIPs"},{"id":"wgEndpointPort","type":"textfield","label":"Endpoint port","value":"51820","inputType":"number","connmanProperty":"WireGuard.EndpointPort"},{"id":"wgListenPort","type":"textfield","label":"Local listen port","inputType":"number","connmanProperty":"WireGuard.ListenPort"},{"id":"wgKeepalive","type":"textfield","label":"Persistent keepalive (s)","inputType":"number","connmanProperty":"WireGuard.PersistentKeepalive"}]};
        var VPN_ERR = {
            "-1": "", "-2": "Invalid parameters.", "-3": "Profile not found.",
            "-4": "Profile with that name already exists.", "-7": "User authentication required.",
            "-8": "connman-vpnd is not available.", "-9": "Unknown VPN agent."
        };
        var VPN_CONNECT_MS = 1200;
        var VPN_DISCONNECT_MS = 300;

        function vpnErr(code, text) {
            return { returnValue: false, errorCode: code, errorText: text || VPN_ERR[String(code)] };
        }
        function vpnProvider(by, v) {
            for (var i = 0; i < VPN_PROVIDERS.length; ++i) {
                var p = VPN_PROVIDERS[i];
                if (by === "guid" ? p[1] === v : String(v || "").toLowerCase() === p[0]) return p;
            }
            return null;
        }
        // connman State -> the API's (vpn_service.c).
        function vpnApiState(st) {
            return { ready: "connected", configuration: "connecting", disconnect: "disconnecting",
                     idle: "disconnected", failure: "disconnected" }[st] || "unknown";
        }
        // connman's connection path: Host (and Domain), non-alphanumerics as "_".
        function vpnPath(host, domain) {
            return "/net/connman/vpn/connection/" + (host + (domain ? "_" + domain : "")).replace(/[^A-Za-z0-9]/g, "_");
        }
        function vpnConnections() { return load().vpn.connections; }
        function vpnByName(s, name) {
            return s.vpn.connections.filter(function (c) { return c.props.Name === name; })[0] || null;
        }
        // luna_service_object_get_string: a non-empty string, or absent.
        function vpnStr(p, k) { return p && typeof p[k] === "string" && p[k] !== "" ? p[k] : null; }

        function vpnEntry(c) {
            var e = { vpnProfileName: c.props.Name || "" };
            var prov = vpnProvider("type", c.props.Type);
            if (prov) e.vpnAgentGuid = prov[1];
            if (c.props.Host) e.vpnHost = c.props.Host;
            e.vpnProfileConnectState = vpnApiState(c.props.State);
            e.immutable = !!c.props.Immutable;
            e.splitRouting = !!c.props.SplitRouting;
            return e;
        }
        function vpnStatus() {
            return { returnValue: true, connmanVpnAvailable: true,
                     activeProfiles: vpnConnections().filter(function (c) { return vpnApiState(c.props.State) !== "disconnected"; }).map(vpnEntry) };
        }
        function vpnList() {
            return { returnValue: true, vpnProfiles: vpnConnections().map(vpnEntry) };
        }
        // The descriptor, filled from the connection (getProfileDetails): secrets
        // never come back (connman hides them), the rest as connman has them.
        function vpnFill(fields, props) {
            return fields.map(function (f) {
                var o = JSON.parse(toJson(f));
                if (o.type === "rowgroup" && o.vpnFormFields) o.vpnFormFields = vpnFill(o.vpnFormFields, props);
                if (o.type === "groups" && o.groups) o.groups.forEach(function (g) { g.vpnFormFields = vpnFill(g.vpnFormFields || [], props); });
                if (o.connmanProperty) {
                    if (o.type === "passwordfield") { o.value = ""; o.hasStoredValue = false; }
                    else if (typeof props[o.connmanProperty] === "string") o.value = props[o.connmanProperty];
                }
                return o;
            });
        }
        function vpnDetails(c) {
            var r = { returnValue: true, vpnProfileName: c.props.Name || "" };
            var prov = vpnProvider("type", c.props.Type);
            if (prov) r.vpnAgentGuid = prov[1];
            r.immutable = !!c.props.Immutable;
            var vp = {};
            if (c.props.Host) vp.vpnHost = c.props.Host;
            if (c.props.Domain) vp.vpnDomain = c.props.Domain;
            if (prov && VPN_FORM_FIELDS[prov[0]]) vp.vpnFormFields = vpnFill(VPN_FORM_FIELDS[prov[0]], c.props);
            r.vpnProfile = vp;
            return r;
        }
        // getConnectionDetails: the tunnel's addresses once it is up.
        function vpnConnDetails(c) {
            var p = c.props, r = { returnValue: true, state: vpnApiState(p.State) };
            if (p.Type) r.tunnelType = p.Type;
            if (p.Host) r.serverHostname = p.Host;
            if (p.Domain) r.domain = p.Domain;
            if (p.State === "ready") {
                var addr = String(p["WireGuard.Address"] || "10.8.0.6/24").split(",")[0].trim().split("/");
                var bits = addr[1] ? Math.max(0, Math.min(32, parseInt(addr[1], 10))) : 32;
                var mask = [0, 8, 16, 24].map(function (sh) { return (((0xffffffff << (32 - bits)) >>> 0) >>> (24 - sh)) & 255; }).join(".");
                r.clientIpAddress = addr[0];
                r.netmask = bits === 0 ? "0.0.0.0" : mask;
                r.index = 7;
                r.ifName = p.Type === "wireguard" ? "wg0" : p.Type === "l2tp" || p.Type === "pptp" ? "ppp0" : "tun0";
                var up = Math.max(0, Date.now() - (c.since || Date.now()));
                r.bytesRx = Math.round(up * 2.1);
                r.bytesTx = Math.round(up * 0.7);
            }
            r.splitRouting = !!p.SplitRouting;
            var dns = p["WireGuard.DNS"];
            if (p.State === "ready") r.nameservers = dns ? dns.split(/\s*,\s*/) : ["10.8.0.1"];
            return r;
        }

        // What connman-vpnd asks the agent for when connecting (its
        // RequestInput fields), per type; none once it has them stored.
        function vpnCredentialKeys(c) {
            var p = c.props;
            switch (String(p.Type).toLowerCase()) {
            case "openvpn": return p["OpenVPN.AuthUserPass"] === "-" ? ["OpenVPN.Username", "OpenVPN.Password"] : [];
            case "vpnc": return p["VPNC.Xauth.Password"] ? [] : ["VPNC.Xauth.Username", "VPNC.Xauth.Password"];
            case "l2tp": return p["L2TP.Password"] ? [] : ["Username", "Password"];
            case "pptp": return p["PPTP.Password"] ? [] : ["Username", "Password"];
            case "openconnect": return p["OpenConnect.AuthType"] === "userpass" || p["OpenConnect.AuthType"] === "cookie_with_userpass"
                ? ["Username", "Password"] : (p["OpenConnect.AuthType"] || "cookie") === "cookie" ? ["OpenConnect.Cookie"] : [];
            }
            return [];
        }
        function vpnNeedsCredentials(c) {
            return vpnCredentialKeys(c).length > 0 && !c.credentials;
        }
        // on_agent_prompt: the prompt's fields from connman's request.
        function vpnPromptFields(c, keys) {
            var f = [{ id: "Host", type: "label", label: "Host", value: c.props.Host },
                     { id: "Name", type: "label", label: "Name", value: c.props.Name }];
            keys.forEach(function (k) {
                var secret = /Password|Cookie/.test(k);
                f.push({ id: k, type: secret ? "passwordfield" : "textfield", label: k, required: true,
                         promptValueType: secret ? "password" : "string" });
            });
            return f;
        }

        // getStatus also carries prompts, notices and promptResolved for this
        // page's subscribers (the agent's calls; vpn_service.c on_agent_*).
        var vpnAgentListeners = [];
        var vpnPrompts = {};        // promptId -> {name, keys}
        var vpnPending = {};        // path -> true while a connect is unanswered
        function vpnAgentPush(payload) {
            vpnAgentListeners.slice().forEach(function (fn) { fn(payload); });
        }

        // A subscribable method: the first reply always says subscribed;
        // pushes, the same object without it, whenever it changes.
        function vpnWatch(p, reply, ctx, compute, onSubscribe) {
            var first = compute();
            var last = toJson(first);
            var subscribed = p.subscribe === true && first.returnValue !== false;
            var r = JSON.parse(last);
            r.subscribed = subscribed;
            reply(r);
            if (!subscribed) return;
            var fn = function () {
                if (ctx.cancelled()) { listeners = listeners.filter(function (l) { return l !== fn; }); return; }
                var now = compute();
                if (now.returnValue === false) return;          // a deleted profile: the key goes silent
                var str = toJson(now);
                if (str === last) return;
                last = str;
                reply(now);
            };
            listeners.push(fn);
            if (onSubscribe) onSubscribe();
        }
        // The lookup preamble (vpn_service.c): -2, -8, -3.
        function vpnLookup(p, reply) {
            var name = vpnStr(p, "vpnProfileName");
            if (!name) { reply(vpnErr(-2)); return null; }
            var s = load(), c = vpnByName(s, name);
            if (!c) { reply(vpnErr(-3)); return null; }
            return { s: s, c: c };
        }
        function vpnSetState(path, st, extra) {
            var s = load(), c = s.vpn.connections.filter(function (x) { return x.path === path; })[0];
            if (!c) return null;
            c.props.State = st;
            if (st === "ready") c.since = Date.now();
            if (extra) extra(c);
            save(s);
            return c;
        }
        // connman brings it up (configuration -> ready), or fails it.
        function vpnBringUp(path, done) {
            setTimeout(function () {
                var s = load(), c = s.vpn.connections.filter(function (x) { return x.path === path; })[0];
                // Taken down meanwhile (disconnect, deleted): connman aborts the Connect.
                if (!c || c.props.State !== "configuration") return done && done(vpnErr(-6, "Operation aborted"));
                if (!netUp(s)) {
                    vpnSetState(path, "idle");
                    vpnAgentPush({ vpnProfileName: c.props.Name, notice: "connect-failed", noticeSeverity: "errorNotice" });
                    return done && done(vpnErr(-6, "Input/output error"));
                }
                vpnSetState(path, "ready");
                if (done) done({ returnValue: true });
            }, VPN_CONNECT_MS);
        }
        function netUp(s) {
            return !s.offlineMode && !!(s.wifi.enabled && s.wifi.connected);
        }
        // Carrier loss: connman takes the VPN down with it.
        function vpnFollowNetwork(s) {
            if (!s.vpn || netUp(s)) return;
            s.vpn.connections.forEach(function (c) {
                if (c.props.State === "ready" || c.props.State === "configuration") c.props.State = "idle";
            });
        }
        function vpnBuildProps(fields, props) {
            (fields || []).forEach(function (f) {
                if (!f || typeof f !== "object") return;
                if (f.type === "rowgroup") return vpnBuildProps(f.vpnFormFields, props);
                if (f.type === "groups") return (f.groups || []).forEach(function (g) { vpnBuildProps(g.vpnFormFields, props); });
                var v = typeof f.value === "string" && f.value !== "" ? f.value : null;
                if (v === null) return;
                if (f.connmanPropertyMap && typeof f.connmanPropertyMap === "object") {
                    var m = f.connmanPropertyMap[v] || {};
                    Object.keys(m).forEach(function (k) { props[k] = typeof m[k] === "string" ? m[k] : ""; });
                } else if (typeof f.connmanProperty === "string" && f.connmanProperty) {
                    props[f.connmanProperty] = v;
                }
            });
        }

        register(["com.webos.service.vpn"], {
            "/getStatus": function (p, reply, ctx) {
                vpnWatch(p, reply, ctx, vpnStatus, function () {
                    var fn = function (payload) {
                        if (ctx.cancelled()) { vpnAgentListeners = vpnAgentListeners.filter(function (l) { return l !== fn; }); return; }
                        reply(payload);
                    };
                    vpnAgentListeners.push(fn);
                });
            },
            "/getProfileList": function (p, reply, ctx) { vpnWatch(p, reply, ctx, vpnList); },
            "/getProfileDetails": function (p, reply, ctx) {
                var name = vpnStr(p, "vpnProfileName");
                if (!vpnLookup(p, reply)) return;
                vpnWatch(p, reply, ctx, function () {
                    var c = vpnByName(load(), name);
                    return c ? vpnDetails(c) : vpnErr(-3);
                });
            },
            "/getConnectionDetails": function (p, reply, ctx) {
                var name = vpnStr(p, "vpnProfileName");
                if (!vpnLookup(p, reply)) return;
                vpnWatch(p, reply, ctx, function () {
                    var c = vpnByName(load(), name);
                    return c ? vpnConnDetails(c) : vpnErr(-3);
                });
            },
            "/getAgents": function (p, reply) {
                reply({ returnValue: true, vpnAgents: VPN_PROVIDERS.map(function (v) {
                    var a = { vpnAgentGuid: v[1], vpnAgentLabel: v[2], vpnAgentTechnology: [v[3]], connmanType: v[0],
                              vpnAgentIcon: "", vpnAgentEula: "" };
                    if (v[4]) a.deprecated = true;
                    if (v[5]) a.supportsImport = [v[5]];
                    return a;
                }) });
            },
            "/getAgentFormFields": function (p, reply) {
                var guid = vpnStr(p, "vpnAgentGuid");
                if (!guid) return reply(vpnErr(-2));
                var prov = vpnProvider("guid", guid);
                if (!prov) return reply(vpnErr(-9));
                reply({ returnValue: true, vpnAgentGuid: guid, vpnFormFields: JSON.parse(toJson(VPN_FORM_FIELDS[prov[0]])) });
            },
            "/connect": function (p, reply) {
                var l = vpnLookup(p, reply);
                if (!l) return;
                var c = l.c, path = c.path;
                if (vpnPending[path]) return reply(vpnErr(-6, "A connection attempt for this profile is already in progress."));
                if (c.props.State === "ready") return reply(vpnErr(-6, "Already connected"));
                if (c.props.State === "configuration") return reply(vpnErr(-6, "In progress"));
                if (!netUp(l.s)) return reply(vpnErr(-6, "Input/output error"));
                // Only one VPN at a time: connman takes the other down.
                l.s.vpn.connections.forEach(function (o) {
                    if (o !== c && (o.props.State === "ready" || o.props.State === "configuration")) o.props.State = "idle";
                });
                c.props.State = "configuration";
                save(l.s);
                if (vpnNeedsCredentials(c)) {
                    // RequestInput: the prompt is pushed, then the call answered -7.
                    var keys = vpnCredentialKeys(c);
                    vpnPrompts[path] = { name: c.props.Name, keys: keys };
                    vpnAgentPush({ promptId: path, promptType: "form", vpnProfileName: c.props.Name,
                                   vpnAgentGuid: vpnProvider("type", c.props.Type)[1], label: c.props.Name,
                                   vpnFormFields: vpnPromptFields(c, keys) });
                    var r = vpnErr(-7);
                    r.promptId = path;
                    return reply(r);
                }
                vpnPending[path] = true;
                vpnBringUp(path, function (r) { delete vpnPending[path]; if (r) reply(r); });
            },
            "/disconnect": function (p, reply) {
                var name = vpnStr(p, "vpnProfileName"), s = load();
                var down = function (c) {
                    c.props.State = "disconnect";
                    var path = c.path;
                    setTimeout(function () { vpnSetState(path, "idle"); }, VPN_DISCONNECT_MS);
                };
                if (!name) {
                    s.vpn.connections.forEach(function (c) { if (vpnApiState(c.props.State) !== "disconnected") down(c); });
                    save(s);
                    return reply({ returnValue: true });
                }
                var c = vpnByName(s, name);
                if (!c) return reply(vpnErr(-3));
                if (c.props.State === "idle" || c.props.State === "failure") return reply(vpnErr(-6, "Not connected"));
                delete vpnPrompts[c.path];
                down(c);
                save(s);
                reply({ returnValue: true });
            },
            "/addProfile": function (p, reply) {
                var name = vpnStr(p, "vpnProfileName"), guid = vpnStr(p, "vpnAgentGuid");
                if (!name || !guid) return reply(vpnErr(-2));
                var prov = vpnProvider("guid", guid);
                if (!prov) return reply(vpnErr(-9));
                var s = load();
                if (vpnByName(s, name)) return reply(vpnErr(-4));
                var vp = p.vpnProfile && typeof p.vpnProfile === "object" ? p.vpnProfile : null;
                var host = vpnStr(vp, "vpnHost");
                if (!host) return reply(vpnErr(-2));
                var domain = vpnStr(vp, "vpnDomain");
                var props = { Type: prov[0], Name: name, Host: host };
                if (domain) props.Domain = domain;
                vpnBuildProps(vp.vpnFormFields, props);
                var path = vpnPath(host, domain);
                // connman keys connections by Host and Domain: the same server
                // under a new name is the same connection (a known limitation).
                var same = s.vpn.connections.filter(function (c) { return c.path === path; })[0];
                if (same) {
                    for (var k in props) same.props[k] = props[k];
                    delete same.credentials;
                } else {
                    props.State = "idle";
                    props.Immutable = false;
                    s.vpn.connections.push({ path: path, props: props });
                }
                save(s);
                reply({ returnValue: true, vpnProfilePath: path });
            },
            "/updateProfile": function (p, reply) {
                var l = vpnLookup(p, reply);
                if (!l) return;
                if (l.c.props.Immutable) return reply(vpnErr(-10, "This profile is provisioned and cannot be changed."));
                var vp = p.vpnProfile && typeof p.vpnProfile === "object" ? p.vpnProfile : {};
                var host = vpnStr(vp, "vpnHost"), domain = vpnStr(vp, "vpnDomain");
                if (host) l.c.props.Host = host;
                if (domain) l.c.props.Domain = domain;
                var before = toJson(l.c.props);
                vpnBuildProps(vp.vpnFormFields, l.c.props);
                if (toJson(l.c.props) !== before) delete l.c.credentials;
                save(l.s);
                reply({ returnValue: true });
            },
            "/deleteProfile": function (p, reply) {
                var l = vpnLookup(p, reply);
                if (!l) return;
                if (l.c.props.Immutable) return reply(vpnErr(-10, "This profile is provisioned and cannot be removed."));
                l.s.vpn.connections = l.s.vpn.connections.filter(function (c) { return c !== l.c; });
                delete vpnPrompts[l.c.path];
                save(l.s);
                reply({ returnValue: true });
            },
            "/uiPromptResponse": function (p, reply) {
                var id = vpnStr(p, "promptId");
                if (!id) return reply(vpnErr(-2));
                reply({ returnValue: true });
                var prompt = vpnPrompts[id];
                if (!prompt) return;
                delete vpnPrompts[id];
                if (p.cancelled === true || p.buttonId === "backButton") {
                    vpnSetState(id, "failure");
                    setTimeout(function () { vpnSetState(id, "idle"); }, VPN_DISCONNECT_MS);
                    return;
                }
                var given = {};
                (Array.isArray(p.vpnFormFields) ? p.vpnFormFields : []).forEach(function (f) {
                    if (f && typeof f === "object" && ["label", "status", "button"].indexOf(f.type) < 0
                            && vpnStr(f, "id") && vpnStr(f, "value")) given[f.id] = f.value;
                });
                if (!prompt.keys.every(function (k) { return given[k]; })) {
                    // connman: the login failed (ReportError), the connection ends.
                    vpnSetState(id, "idle");
                    vpnAgentPush({ vpnProfileName: prompt.name, notice: "auth-failed", noticeSeverity: "errorNotice" });
                    return;
                }
                // connman-vpnd keeps the credentials for the next time.
                vpnSetState(id, "configuration", function (c) { c.credentials = given; });
                vpnBringUp(id);
            },
            "/acceptEula": function (p, reply) { reply({ returnValue: true }); }
        });

        // The system menu's VPN rows: connect or disconnect by name, as the
        // shell asks every page (idempotent). A profile that needs credentials
        // is not connected from here: the drawer opens Settings > VPN instead.
        function vpnFromShell(s, st) {
            if (!s.vpn) return;
            var c;
            if (st.vpnConnect && (c = vpnByName(s, st.vpnConnect)) && !vpnNeedsCredentials(c)
                    && (c.props.State === "idle" || c.props.State === "failure") && netUp(s)) {
                s.vpn.connections.forEach(function (o) {
                    if (o !== c && (o.props.State === "ready" || o.props.State === "configuration")) o.props.State = "idle";
                });
                c.props.State = "configuration";
                var path = c.path;
                setTimeout(function () { vpnBringUp(path); }, 0);
            }
            if (st.vpnDisconnect && (c = vpnByName(s, st.vpnDisconnect)) && (c.props.State === "ready" || c.props.State === "configuration")) {
                c.props.State = "disconnect";
                var p2 = c.path;
                setTimeout(function () { vpnSetState(p2, "idle"); }, VPN_DISCONNECT_MS);
            }
        }

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
            // The system menu's volume slider: the master volume.
            if ("volume" in st) s.audio.volume = Math.max(0, Math.min(100, Math.round(st.volume)));
            vpnFromShell(s, st);
            // The shell's lock screen (com.palm.systemmanager getLockStatus).
            if ("deviceLocked" in st && !!st.deviceLocked !== !!store.get("deviceLocked", false)) {
                store.set("deviceLocked", !!st.deviceLocked);
                changed();
            }
            // How the UI and the device are turned (getSystemStatus).
            if (st.orientation && toJson(st.orientation) !== toJson(store.get("orientation", null))) {
                store.set("orientation", { ui: st.orientation.ui, device: st.orientation.device });
                changed();
            }
            // The device has a gesture area (getSystemStatus gestureArea).
            if ("gestureArea" in st && !!st.gestureArea !== !!store.get("gestureArea", false)) {
                store.set("gestureArea", !!st.gestureArea);
                changed();
            }
            // The virtual keyboard is up ({ ime: { visible } }, getSystemStatus).
            if (st.ime && !!st.ime.visible !== !!store.get("imeVisible", false)) {
                store.set("imeVisible", !!st.ime.visible);
                changed();
            }
            suppressHost = true;
            try {
                // The keyboard's language key chose another keyboard.
                if (st.keyboard && keyboardCombo(st.keyboard))
                    sys["/setPreferences"]({ x_palm_virtualkeyboard_settings: JSON.stringify(keyboardCombo(st.keyboard)) },
                                           function () {}, { cancelled: function () { return false; } });
                if ("rotationLocked" in st && !!st.rotationLocked !== !!prefs().rotationLock)
                    sys["/setPreferences"]({ rotationLock: !!st.rotationLocked }, function () {}, { cancelled: function () { return false; } });
                save(s);
            } finally {
                suppressHost = false;
            }
            host.postToHost("systemStatus", hostStatus());
        };
        runtime.hostStatus = function () { return hostStatus(); };

        // The user tapped the app's name in the status bar. LunaSysMgr
        // relaunched the app with {"palm-command": "open-app-menu"}, which
        // Enyo turns into enyo.appMenu.toggle() for its active window
        // (enyo.windows.events.handleAppMenu); pages call it here, in the
        // card's own window. Other apps get a "phoenixAppMenu" document event
        // (@phoenix/ui AppMenu).
        runtime.openAppMenu = function () {
            if (global.enyo && global.enyo.appMenu) {
                global.enyo.appMenu.toggle();
                return true;
            }
            var e;
            try { e = new CustomEvent("phoenixAppMenu"); }
            catch (x) { e = global.document.createEvent("CustomEvent"); e.initCustomEvent("phoenixAppMenu", false, false, null); }
            global.document.dispatchEvent(e);
            return true;
        };

        // The shell launched an app that is already running, with new launch
        // params: update PalmSystem.launchParams, then tell the app. Enyo 1.0
        // and Mojo apps are told through Mojo.relaunch(), as LunaSysMgr did
        // (enyo-1.0 palm/system/windows/events.js: windowParamsChange,
        // applicationRelaunch); OSE apps through the "webOSRelaunch" document
        // event (detail = params), as WebAppMgr does.
        runtime.relaunch = function (params) {
            PalmSystem.launchParams = toJson(params || {});
            if (global.Mojo && typeof global.Mojo.relaunch === "function") {
                global.Mojo.relaunch();
                return true;
            }
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
    //       isTelephonyReady, powerQuery, platformQuery, networkStatusQuery,
    //       simStatusQuery, subscriberIdQuery (src/telephonyservice_misc.c,
    //       telephonyservice_sim.c; the values are fictional: the ITU test
    //       network 001-01, a 555 number, the IMEI standard's example)
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
    //   phoenixHost.postToHost("notification", {appId, title, body, params, soundClass})
    // which the shell shows as a banner and dashboard item for that app, with
    // the notification tone (soundClass "notifications").
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
        // The shell hears of it too (its volume indicator: audioScenario).
        function save(s) {
            store.set(KEY, s);
            changed();
            if (runtime.hostStatus) host.postToHost("systemStatus", runtime.hostStatus());
        }
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
                reply(ok({ extended: { platformType: "gsm", imei: "490154203237518", carrier: "Phoenix",
                                       mcc: 1, mnc: 1, version: "phoenix-sim" } }));
            },
            "/simStatusQuery": function (p, reply) { reply(ok({ extended: { state: "simready" } })); },
            "/subscriberIdQuery": function (p, reply) {
                reply(ok({ extended: { platformType: "gsm", imsi: "001010123456789", msisdn: "+14085550199" } }));
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
                msg = JSON.parse(toJson(msg));
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
                                              params: { threadId: r.threadId }, soundClass: "notifications" });
            return r.threadId;
        };

        // ---- Demo data (simulator only; fictional people, 555 numbers) ---------------

        var SEED_VERSION = 1;
        runtime.seedPhoneDemoData = function (force) {
            if (!force && store.get("telephony:seeded", 0) === SEED_VERSION) return false;
            // The people come from the sample contacts; a forced reseed restores them too.
            if (force && runtime.loadSampleData) runtime.loadSampleData(true);
            [["com.palm.person:1", []], ["com.palm.message:1", []], ["com.palm.smsmessage:1", ["com.palm.message:1"]],
             ["com.palm.chatthread:1", []], ["com.palm.phonecall:1", []]].forEach(function (k) {
                dbCall("/putKind", { id: k[0], owner: "org.webosphoenix.simulator", extends: k[1] });
            });
            // The people are the simulator's sample contacts (runtime/sample-data.js,
            // loaded earlier), so Phone, Messaging and Contacts share one address book.
            var persons = dbCall("/find", { query: { from: "com.palm.person:1" } }).results || [];
            var people = [["Ada", "Palmer"], ["Marcus", "Reyes"], ["Priya", "Nair"], ["Lena", "Okafor"],
                          ["Jonah", "Whitfield"], ["Sam", "Delgado"], ["Theo", "Lindqvist"]].map(function (n) {
                return persons.filter(function (p) {
                    return p.name && p.name.givenName === n[0] && p.name.familyName === n[1];
                })[0] || null;
            });

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
                var p = people[conv[0]];
                if (!p || !p.phoneNumbers || !p.phoneNumbers.length) return;
                var number = p.phoneNumbers[0].value;
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
                     webm: "video/webm", mp4: "video/mp4", m4v: "video/mp4", ogv: "video/ogg", mkv: "video/x-matroska", mov: "video/quicktime" };

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
            // Every stored file (Device Info > Full Erase).
            clear: function () {
                Object.keys(urlCache).forEach(function (k) {
                    if (urlCache[k].indexOf("blob:") === 0) try { URL.revokeObjectURL(urlCache[k]); } catch (e) { /* ignore */ }
                });
                urlCache = {};
                return tx("readwrite", function (st) {
                    if (!st) { memFiles = {}; return; }
                    return reqP(st.clear());
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

        function sampleItem(type, r) {
            var rec = {};
            for (var k in r) if (k !== "subtitles") rec[k] = r[k];
            return makeItem(type, rec);
        }
        function loadIndex() {
            var idx = store.get(INDEX_KEY, null);
            var s;
            if (idx) {
                // Demo videos that shipped after this index was made.
                s = idx.videoSamples ? null : readSamples();
                if (s) {
                    var have = {};
                    idx.video.forEach(function (it) { have[it.file_path] = true; });
                    (s.videos || []).forEach(function (r) { if (!have[r.file_path]) idx.video.push(sampleItem("video", r)); });
                    idx.videoSamples = true;
                    saveIndex(idx, true);
                }
                return idx;
            }
            idx = { image: [], audio: [], video: [], videoSamples: true };
            s = readSamples();
            if (s) {
                (s.images || []).forEach(function (r) { idx.image.push(makeItem("image", r)); });
                (s.audios || []).forEach(function (r) { idx.audio.push(makeItem("audio", r)); });
                (s.videos || []).forEach(function (r) { idx.video.push(sampleItem("video", r)); });
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
                    // Later answers come from timers and other pages' changes,
                    // where a throw would reach no one: the subscriber gets it
                    // as an error instead of waiting for ever.
                    var w = function () {
                        if (ctx.cancelled()) return;
                        var r;
                        try { r = listReply(type, p); } catch (e) {
                            console.error("[phoenix-runtime] mediaindexer list failed", e && e.stack ? e.stack : e);
                            r = fail(-1, "The media index could not be read: " + (e && e.message || e));
                        }
                        reply(r);
                    };
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

        // ---- Screen captures (Phoenix; docs/SCREENSHOTS.md SC1-SC2) -----------------------
        //
        // The shell grabs the screen and hands the picture to one page:
        // runtime.saveScreenshot({data: base64 PNG, app: the app in front's
        // title}). It is saved where the original saved them,
        // /media/internal/screencaptures, named "<app> YYYY-MM-DD at
        // HH.MM.SS.png" (the original's name had the day before the month),
        // indexed for Photos' Screen captures album, and a notification
        // ("Screen captured") opens it in the Screenshot app's preview.
        var CAPTURE_DIR = MEDIA_ROOT + "/screencaptures";
        var SCREENSHOT_APP = "org.webosphoenix.screenshot";
        function captureName(app, d) {
            function two(n) { return (n < 10 ? "0" : "") + n; }
            var safe = String(app || "Screen").replace(/[\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Screen";
            return safe + " " + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate())
                + " at " + two(d.getHours()) + "." + two(d.getMinutes()) + "." + two(d.getSeconds()) + ".png";
        }
        runtime.saveScreenshot = function (p) {
            p = p || {};
            var path = CAPTURE_DIR + "/" + captureName(p.app, p.time ? new Date(p.time) : new Date());
            var blob;
            try { blob = b64ToBlob(String(p.data || "").replace(/^data:image\/png;base64,/, ""), "image/png"); }
            catch (e) { return Promise.reject(new Error("not a PNG")); }
            return files.write(path, blob).then(function () {
                return scan(CAPTURE_DIR);
            }).then(function () {
                host.postToHost("notification", { appId: SCREENSHOT_APP, title: "Screen captured",
                                                  body: path.slice(CAPTURE_DIR.length + 1).replace(/\.png$/, ""),
                                                  params: { path: path } });
                return path;
            });
        };

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

    // ================================================================================
    // File manager (org.webosphoenix.filemanager, com.palm.appinstaller; apps/files)
    // ================================================================================
    //
    // The Files app browses and changes the whole filesystem through a Phoenix
    // service; on a device that is the Node.js service in apps/files/service,
    // with the same methods and replies. Every reply is webOS style
    // (returnValue, errorCode, errorText); the codes are FILE_ERRORS in
    // apps/shared/luna/src/files.ts:
    //
    //   list {path}                          -> {path, entries: [entry]}
    //   stat {path}                          -> {entry} (folders add count)
    //   mkdir {path}                         -> {path}
    //   copy / move {from, to, overwrite?}   -> {path} (folders recursively)
    //   remove {path, recursive?}            -> {path}
    //   read {path, encoding?, maxBytes?}    -> {path, data, encoding, size}
    //   write {path, data, encoding?, overwrite?} -> {path, size}
    //   entry: {name, path, type: "file"|"directory", size, mtime (ms), mode, readOnly?}
    //
    // Here the filesystem is virtual: one map of path -> node in the shared
    // store ("files:vfs"), so every app page sees the same files. File
    // contents are kept in one of three ways:
    //   inline  text or base64 in the node (what write stores; 1 MB at most)
    //   ref     a file of the rootfs (runtime/rootfs.json), read over HTTP:
    //           the demo media, apps' appinfo.json, the runtime itself
    //   media   a file in the media block's IndexedDB store (runtime.mediaFiles,
    //           e.g. the Camera's pictures), picked up whenever a folder is listed
    // The first start seeds a /media/internal like a webOS phone's (Downloads,
    // Documents, Pictures, Music, ringtones, the demo media) and read-only
    // system folders (/usr/palm/applications with the installed apps, /etc).
    //
    // com.palm.appinstaller installNoVerify {target, subscribe} (legacy webOS,
    // as Preware-era file managers installed .ipk files) installs the package
    // for real ("Installing apps" below).
    // The application manager learns listAllHandlersForMime and
    // getHandlerForMimeType for "Open with" (Photos, Music).
    //
    // __phoenixRuntime.fileManager: url(path) (a URL to show a file), reset()
    // (seed again), and the service methods for tests.
    (function fileManagerService() {
        var VFS_KEY = "files:vfs";
        var SEED_VERSION = 1;
        var MEDIA_ROOT = "/media/internal";
        var INLINE_LIMIT = 1024 * 1024;
        var READ_LIMIT = 16 * 1024 * 1024;
        var E = { BAD_PARAMS: -1, NOT_FOUND: 1, EXISTS: 2, PERMISSION: 3, NOT_DIR: 4, IS_DIR: 5,
                  NOT_EMPTY: 6, TOO_LARGE: 7, INVALID: 8, IO: 9 };
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
        // "Open with": apps that say they open these types.
        var HANDLERS = [
            { prefix: "image/", appId: "org.webosphoenix.photos", title: "Photos" },
            { prefix: "video/", appId: "org.webosphoenix.photos", title: "Photos" },
            { prefix: "audio/", appId: "org.webosphoenix.music", title: "Music" },
            { prefix: "application/x-keepass2", appId: "org.webosphoenix.passwords", title: "Passwords" }
        ];

        function extOf(p) { var m = /[^.\/]\.([a-z0-9]+)$/i.exec(p || ""); return m ? m[1].toLowerCase() : ""; }
        function mimeOf(p) { return MIME[extOf(p)] || "application/octet-stream"; }
        function nameOf(p) { return p === "/" ? "" : p.replace(/^.*\//, ""); }
        function parentOf(p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
        function inside(p, dir) { return p === dir || p.indexOf(dir === "/" ? "/" : dir + "/") === 0; }

        // An absolute, normalised path, or null.
        function norm(p) {
            if (typeof p !== "string" || p.charAt(0) !== "/" || p.indexOf("\0") >= 0) return null;
            var out = [];
            p.split("/").forEach(function (s) {
                if (!s || s === ".") return;
                if (s === "..") out.pop();
                else out.push(s);
            });
            return "/" + out.join("/");
        }

        // ---- Bytes ---------------------------------------------------------------------

        function utf8Bytes(s) {
            if (global.TextEncoder) return new TextEncoder().encode(s);
            var bin = unescape(encodeURIComponent(s)), b = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; ++i) b[i] = bin.charCodeAt(i);
            return b;
        }
        function utf8Text(bytes) {
            if (global.TextDecoder) return new TextDecoder("utf-8").decode(bytes);
            var s = "";
            for (var i = 0; i < bytes.length; ++i) s += String.fromCharCode(bytes[i]);
            try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
        }
        function toB64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; i += 0x8000)
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return global.btoa(s);
        }
        function fromB64(data) {
            var bin = global.atob(data), b = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; ++i) b[i] = bin.charCodeAt(i);
            return b;
        }
        function blobBytes(blob) {
            if (!blob) return Promise.resolve(null);
            if (typeof blob.arrayBuffer === "function")
                return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
            return new Promise(function (resolve, reject) {
                var fr = new FileReader();
                fr.onload = function () { resolve(new Uint8Array(fr.result)); };
                fr.onerror = function () { reject(fr.error); };
                fr.readAsArrayBuffer(blob);
            });
        }
        // A rootfs file over HTTP (XHR: phoenix-sim's scheme serves XHR, not fetch).
        function fetchRef(url, head) {
            return new Promise(function (resolve) {
                try {
                    var req = new XMLHttpRequest();
                    req.open(head ? "HEAD" : "GET", url, true);
                    if (!head) req.responseType = "arraybuffer";
                    req.onload = function () {
                        var good = req.status >= 200 && req.status < 300 || req.status === 0;
                        if (!good) return resolve(null);
                        if (head) return resolve(parseInt(req.getResponseHeader("Content-Length"), 10));
                        resolve(req.response ? new Uint8Array(req.response) : null);
                    };
                    req.onerror = function () { resolve(null); };
                    req.send(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }

        // ---- The virtual filesystem ---------------------------------------------------------

        var T0 = Date.parse("2026-01-15T09:00:00Z");

        function seed() {
            var nodes = {};
            function dir(p, ro, m) { nodes[p] = { t: "d", m: m || T0, mode: 493, ro: !!ro }; }
            function text(p, s, m, ro) { nodes[p] = { t: "f", m: m || T0, mode: 420, ro: !!ro, data: s, enc: "utf8", size: utf8Bytes(s).length }; }
            function ref(p, url, size, m, ro) { nodes[p] = { t: "f", m: m || T0, mode: 420, ro: !!ro, ref: url, size: size >= 0 ? size : -1 }; }
            function when(iso) { return Date.parse(iso); }

            ["/", "/etc", "/etc/palm", "/usr", "/usr/palm", "/usr/palm/applications", "/usr/palm/frameworks",
             "/usr/share", "/usr/share/phoenix", "/usr/share/phoenix/runtime", "/var", "/var/log", "/media", "/home"
            ].forEach(function (p) { dir(p, true); });
            dir("/tmp", false);
            dir("/home/root", false);

            text("/etc/hostname", "webos-phoenix\n", T0, true);
            text("/etc/hosts", "127.0.0.1\tlocalhost\n127.0.1.1\twebos-phoenix\n::1\t\tlocalhost ip6-localhost\n", T0, true);
            text("/etc/os-release", "ID=webos-phoenix\nNAME=\"webOS Phoenix\"\nVERSION=\"0.1.0 (simulator)\"\n" +
                 "PRETTY_NAME=\"webOS Phoenix 0.1.0\"\nID_LIKE=webos\nHOME_URL=\"https://github.com/thebestbradley/webos-phoenix\"\n", T0, true);
            text("/etc/palm/device-info.json", toJson({ modelName: "Phoenix Simulator", platformVersion: "3.0.5" }, null, 2) + "\n", T0, true);
            text("/var/log/messages", "Jan 15 09:00:01 webos-phoenix kernel: Booting webOS Phoenix (simulator)\n" +
                 "Jan 15 09:00:03 webos-phoenix LunaSysMgr: Phoenix shell started\n", T0, true);
            ref("/usr/share/phoenix/runtime/phoenix-runtime.js", "/usr/share/phoenix/runtime/phoenix-runtime.js", -1, T0, true);
            ref("/usr/share/phoenix/runtime/sample-data.js", "/usr/share/phoenix/runtime/sample-data.js", -1, T0, true);
            dir("/usr/palm/frameworks/enyo", true);
            dir("/usr/palm/frameworks/enyo/1.0", true);
            dir("/usr/palm/frameworks/enyo/1.0/framework", true);
            ref("/usr/palm/frameworks/enyo/1.0/framework/enyo.js", "/usr/palm/frameworks/enyo/1.0/framework/enyo.js", -1, T0, true);

            // Installed apps: the dev server's list, else the ones Phoenix ships.
            var apps = [];
            try {
                var txt = PalmSystem.getResource("/apps.json");
                if (txt) JSON.parse(txt).forEach(function (a) { if (!a.appId) apps.push({ id: a.id, icon: a.icon }); });
            } catch (e) { apps = []; }
            if (!apps.length) {
                ["com.palm.app.accounts", "com.palm.app.calculator", "com.palm.app.calendar", "com.palm.app.clock",
                 "com.palm.app.contacts", "com.palm.app.email", "com.palm.app.notes", "org.webosphoenix.camera",
                 "org.webosphoenix.files", "org.webosphoenix.messaging", "org.webosphoenix.music", "org.webosphoenix.phone",
                 "org.webosphoenix.photos", "org.webosphoenix.settings"].forEach(function (id) { apps.push({ id: id }); });
            }
            apps.forEach(function (a) {
                var base = "/usr/palm/applications/" + a.id;
                dir(base, true);
                ref(base + "/appinfo.json", base + "/appinfo.json", -1, T0, true);
                if (a.icon && a.icon.indexOf(base + "/") === 0 && a.icon.slice(base.length + 1).indexOf("/") < 0)
                    ref(a.icon, a.icon, -1, T0, true);
            });

            // The user's storage (USB mass storage on a webOS phone).
            dir(MEDIA_ROOT, false, when("2026-09-01T08:00:00Z"));
            ["Downloads", "Documents", "Pictures", "Music", "ringtones", ".thumbnails"].forEach(function (d) {
                dir(MEDIA_ROOT + "/" + d, false, when("2026-09-01T08:00:00Z"));
            });
            text(MEDIA_ROOT + "/Documents/Welcome.txt",
                 "Welcome to webOS Phoenix!\n\n" +
                 "This is your device's internal storage, /media/internal. Connect a real phone over USB " +
                 "and it shows up as a drive; here in the simulator it lives in the browser.\n\n" +
                 "Tap a file to open it, or hold it to select several. The menu at the top sorts the " +
                 "list and shows hidden files.\n", when("2026-09-01T08:05:00Z"));
            text(MEDIA_ROOT + "/Documents/Shopping list.txt",
                 "- Coffee beans\n- Oat milk\n- Batteries (AA)\n- Birthday card for Sam\n", when("2026-09-20T17:42:00Z"));
            text(MEDIA_ROOT + "/Documents/Trip notes.md",
                 "# Harbor weekend\n\n* Ferry leaves 8:15\n* Pack the camera\n* Dinner at the pier\n", when("2026-09-12T20:10:00Z"));
            text(MEDIA_ROOT + "/Downloads/release-notes.txt",
                 "webOS Phoenix 0.1.0\n\nNew: Files, a file manager for the whole device.\n", when("2026-09-25T12:00:00Z"));
            // A real (tiny) app package to install: apps/media-samples/media/packages,
            // made by apps/media-samples/tools/make-sample-ipk.cjs.
            ref(MEDIA_ROOT + "/Downloads/org.example.hello_1.0.0_all.ipk",
                MEDIA_ROOT + "/samples/packages/org.example.hello_1.0.0_all.ipk", 3106, when("2026-09-26T15:30:00Z"));

            // The demo media (apps/media-samples, mounted at /media/internal/samples).
            var samples = null;
            try { samples = JSON.parse(PalmSystem.getResource(MEDIA_ROOT + "/samples/index.json") || "null"); } catch (e) { samples = null; }
            var sm = when("2026-09-01T08:00:00Z");
            dir(MEDIA_ROOT + "/samples", false, sm);
            dir(MEDIA_ROOT + "/samples/photos", false, sm);
            dir(MEDIA_ROOT + "/samples/music", false, sm);
            dir(MEDIA_ROOT + "/samples/music/art", false, sm);
            ref(MEDIA_ROOT + "/samples/index.json", MEDIA_ROOT + "/samples/index.json", -1, sm);
            var images = (samples && samples.images) || [], audios = (samples && samples.audios) || [];
            images.forEach(function (r) { ref(r.file_path, r.file_path, r.file_size, Date.parse(r.last_modified_date) || sm); });
            audios.forEach(function (r) {
                ref(r.file_path, r.file_path, r.file_size, Date.parse(r.last_modified_date) || sm);
                if (r.thumbnail && !nodes[r.thumbnail]) ref(r.thumbnail, r.thumbnail, -1, sm);
            });
            // Pictures, Music and ringtones hold copies of some of them.
            images.slice(0, 3).forEach(function (r) { ref(MEDIA_ROOT + "/Pictures/" + nameOf(r.file_path), r.file_path, r.file_size, Date.parse(r.last_modified_date) || sm); });
            audios.forEach(function (r) { ref(MEDIA_ROOT + "/Music/" + nameOf(r.file_path), r.file_path, r.file_size, Date.parse(r.last_modified_date) || sm); });
            if (audios[0]) ref(MEDIA_ROOT + "/ringtones/Arcade Ring.ogg", audios[0].file_path, audios[0].file_size, sm);

            var v = { version: SEED_VERSION, nodes: nodes, mediaSeen: {} };
            addSampleFiles(v, samples);
            return v;
        }

        // The demo videos (with their subtitles) and documents, also added
        // to a filesystem seeded before they shipped.
        // The demo media's index, read once per page: it is a synchronous
        // request (PalmSystem.getResource), and the samples cannot change
        // while a page is open. Reading it on every call made each file
        // manager request, and so every command in the Terminal, take as
        // long as a request.
        var sampleIndex;
        function readSampleIndex() {
            if (sampleIndex === undefined) {
                try { sampleIndex = JSON.parse(PalmSystem.getResource(MEDIA_ROOT + "/samples/index.json") || "null"); }
                catch (e) { sampleIndex = null; }
            }
            return sampleIndex;
        }
        function sampleFiles(samples) {
            var out = [];
            ((samples && samples.videos) || []).forEach(function (r) {
                out.push(r);
                (r.subtitles || []).forEach(function (sub) { out.push({ file_path: sub, file_size: -1, last_modified_date: r.last_modified_date }); });
            });
            ((samples && samples.documents) || []).forEach(function (r) { out.push(r); });
            return out;
        }
        function addSampleFiles(v, samples) {
            var list = sampleFiles(samples);
            var key = list.map(function (r) { return r.file_path; }).join("|");
            if (v.samplesKey === key) return false;
            var sm = Date.parse("2026-09-01T08:00:00Z");
            list.forEach(function (r) {
                var p = norm(r.file_path);
                if (!p || v.nodes[p]) return;
                for (var d = parentOf(p); !v.nodes[d]; d = parentOf(d))
                    v.nodes[d] = { t: "d", m: sm, mode: 493, ro: false };
                v.nodes[p] = { t: "f", m: Date.parse(r.last_modified_date) || sm, mode: 420, ro: false, ref: r.file_path,
                               size: r.file_size >= 0 ? r.file_size : -1 };
            });
            v.samplesKey = key;
            return true;
        }

        function load() {
            var v = store.get(VFS_KEY, null);
            if (!v || v.version !== SEED_VERSION || !v.nodes) {
                v = seed();
                store.set(VFS_KEY, v);
            } else if (addSampleFiles(v, readSampleIndex())) {
                save(v);
            }
            syncDocumentIndex(v);
            return v;
        }
        function save(v) {
            try {
                store.set(VFS_KEY, v);
                syncDocumentIndex(v);
                return true;
            } catch (e) {
                return false;   // quota
            }
        }

        // webOS 3's media indexer also listed the documents on the USB
        // drive, in db8 kind com.palm.media.misc.file:1: {path, name (the
        // stem), extension, size, modifiedTime (s), mimeType, searchKey}.
        // Quickoffice's "My TouchPad" is that list (its LocalFileService
        // finds in the kind). Kept in step with the files here; hidden
        // folders are left out, as the indexer did.
        var DOC_TYPES = {
            doc: "application/msword", docx: MIME.docx, xls: "application/vnd.ms-excel", xlsx: MIME.xlsx,
            ppt: "application/vnd.ms-powerpoint", pptx: MIME.pptx, pdf: "application/pdf", txt: "text/plain",
            rtf: "application/rtf", csv: "text/csv", odt: "application/vnd.oasis.opendocument.text",
            ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation"
        };
        var DOC_KIND = "com.palm.media.misc.file:1";
        var docIndexSig = null;
        function syncDocumentIndex(v) {
            var want = [];
            Object.keys(v.nodes).sort().forEach(function (path) {
                var n = v.nodes[path];
                if (n.t !== "f" || path.indexOf(MEDIA_ROOT + "/") !== 0 || /\/\./.test(path)) return;
                var m = /\/([^\/]*?)(?:\.([^.\/]+))?$/.exec(path), ext = m && m[2] ? m[2].toLowerCase() : "";
                if (!DOC_TYPES[ext]) return;
                want.push({ _id: "phoenix-document:" + path, _kind: DOC_KIND, path: path, name: m[1], extension: ext,
                            size: n.size >= 0 ? n.size : 0, modifiedTime: Math.floor((n.m || 0) / 1000),
                            mimeType: DOC_TYPES[ext], searchKey: m[1].toLowerCase().replace(/\s+/g, "_") });
            });
            var sig = toJson(want);
            if (sig === docIndexSig) return;
            docIndexSig = sig;
            var keep = {};
            want.forEach(function (o) { keep[o._id] = true; });
            var have = (callNow("palm://com.palm.db/find", { query: { from: DOC_KIND } }) || {}).results || [];
            var gone = have.filter(function (o) { return !keep[o._id]; }).map(function (o) { return o._id; });
            var changed = want.filter(function (o) {
                var h = have.filter(function (x) { return x._id === o._id; })[0];
                return !h || h.size !== o.size || h.modifiedTime !== o.modifiedTime;
            });
            if (gone.length) callNow("palm://com.palm.db/del", { ids: gone });
            if (changed.length) callNow("palm://com.palm.db/put", { objects: changed });
        }

        function children(v, p) {
            var pre = p === "/" ? "/" : p + "/";
            return Object.keys(v.nodes).filter(function (k) {
                return k !== "/" && k.indexOf(pre) === 0 && k.indexOf("/", pre.length) < 0;
            });
        }
        function subtree(v, p) {
            return Object.keys(v.nodes).filter(function (k) { return inside(k, p); });
        }
        function entry(v, p, withCount) {
            var n = v.nodes[p];
            var e = { name: nameOf(p), path: p, type: n.t === "d" ? "directory" : "file",
                      size: n.t === "d" || !(n.size >= 0) ? 0 : n.size, mtime: n.m, mode: n.mode };
            if (n.ro) e.readOnly = true;
            if (withCount && n.t === "d") e.count = children(v, p).length;
            return e;
        }
        function touch(v, p) { if (v.nodes[p]) v.nodes[p].m = Date.now(); }

        // Refs whose size is not known yet (HEAD request, once).
        function fillSizes(paths) {
            var v = load();
            var todo = paths.filter(function (p) { var n = v.nodes[p]; return n && n.ref && n.size === -1; });
            if (!todo.length) return Promise.resolve();
            return Promise.all(todo.map(function (p) {
                return fetchRef(v.nodes[p].ref, true).then(function (n) { return [p, n]; });
            })).then(function (sizes) {
                var v2 = load();
                sizes.forEach(function (s) { if (v2.nodes[s[0]]) v2.nodes[s[0]].size = s[1] >= 0 ? s[1] : -2; });
                save(v2);
            });
        }

        // Files other apps stored with the media block (Camera pictures): add
        // the ones not seen before, with their folders.
        function syncMedia() {
            var mf = runtime.mediaFiles;
            if (!mf) return Promise.resolve();
            return mf.list(MEDIA_ROOT + "/").then(function (paths) {
                var v = load();
                var fresh = paths.filter(function (p) { return !v.mediaSeen[p]; });
                if (!fresh.length) return;
                return Promise.all(fresh.map(function (p) {
                    return mf.read(p).then(function (b) { return [p, b ? b.size : 0]; }, function () { return [p, 0]; });
                })).then(function (found) {
                    var v2 = load();
                    found.forEach(function (f) {
                        var p = norm(f[0]);
                        v2.mediaSeen[f[0]] = true;
                        if (!p || v2.nodes[p]) return;
                        for (var d = parentOf(p); !v2.nodes[d]; d = parentOf(d))
                            v2.nodes[d] = { t: "d", m: Date.now(), mode: 493 };
                        v2.nodes[p] = { t: "f", m: Date.now(), mode: 420, media: true, size: f[1] };
                    });
                    save(v2);
                });
            }, function () { /* no store */ });
        }

        // The bytes of a file node.
        function bytesOf(n, p) {
            if (n.data !== undefined) return Promise.resolve(n.enc === "base64" ? fromB64(n.data) : utf8Bytes(n.data));
            if (n.ref) return fetchRef(n.ref, false);
            if (n.media && runtime.mediaFiles) return runtime.mediaFiles.read(p).then(blobBytes);
            return Promise.resolve(new Uint8Array(0));
        }

        function forgetMedia(p) {
            if (p.indexOf(MEDIA_ROOT + "/") !== 0 || !runtime.services["com.webos.service.mediaindexer"]) return;
            callNow("luna://com.webos.service.mediaindexer/requestDelete", { uri: "storage://" + p });
        }

        // ---- Checks shared by the methods ------------------------------------------------------

        // A new child of an existing, writable folder: the error reply, or null.
        function checkTarget(v, p, overwrite) {
            var parent = v.nodes[parentOf(p)];
            if (!parent) return fail(E.NOT_FOUND, "No such folder: " + parentOf(p));
            if (parent.t !== "d") return fail(E.NOT_DIR, "Not a folder: " + parentOf(p));
            if (parent.ro) return fail(E.PERMISSION, "Read-only folder: " + parentOf(p));
            var n = v.nodes[p];
            if (n && !overwrite) return fail(E.EXISTS, "Already exists: " + p);
            if (n && n.ro) return fail(E.PERMISSION, "Read-only: " + p);
            return null;
        }
        function checkRemovable(v, p) {
            if (p === "/") return fail(E.PERMISSION, "Cannot remove /");
            if (!v.nodes[p]) return fail(E.NOT_FOUND, "No such file or directory: " + p);
            var parent = v.nodes[parentOf(p)];
            if (parent && parent.ro) return fail(E.PERMISSION, "Read-only folder: " + parentOf(p));
            var ro = subtree(v, p).filter(function (k) { return v.nodes[k].ro; })[0];
            if (ro) return fail(E.PERMISSION, "Read-only: " + ro);
            return null;
        }
        function dropTree(v, p) {
            subtree(v, p).forEach(function (k) {
                var n = v.nodes[k];
                if (n.media && runtime.mediaFiles) runtime.mediaFiles.remove(k);
                if (n.t === "f") forgetMedia(k);
                delete v.nodes[k];
            });
        }

        // Copy (or move) the tree at `from` to `to`. Media files are copied in
        // the media store when they stay under /media/internal, else inline.
        function transfer(from, to, move) {
            var v = load();
            var src = subtree(v, from).sort();
            var jobs = src.map(function (k) {
                var n = v.nodes[k], dest = to + k.slice(from.length);
                var copy = {};
                for (var f in n) copy[f] = n[f];
                delete copy.ro;
                if (!move) copy.m = Date.now();
                if (!n.media) return Promise.resolve([dest, copy, k]);
                return runtime.mediaFiles.read(k).then(function (blob) {
                    if (dest.indexOf(MEDIA_ROOT + "/") === 0 && blob)
                        return runtime.mediaFiles.write(dest, blob).then(function () { return [dest, copy, k]; });
                    return blobBytes(blob).then(function (b) {
                        delete copy.media;
                        copy.data = toB64(b || new Uint8Array(0));
                        copy.enc = "base64";
                        return [dest, copy, k];
                    });
                });
            });
            return Promise.all(jobs).then(function (done) {
                var v2 = load();
                if (move) {
                    src.forEach(function (k) {
                        var n = v2.nodes[k];
                        if (n && n.media && runtime.mediaFiles) runtime.mediaFiles.remove(k);
                        if (n && n.t === "f") forgetMedia(k);
                        delete v2.nodes[k];
                    });
                }
                done.forEach(function (d) {
                    v2.nodes[d[0]] = d[1];
                    if (d[1].media) v2.mediaSeen[d[0]] = true;
                });
                touch(v2, parentOf(to));
                if (move) touch(v2, parentOf(from));
                if (!save(v2)) return fail(E.TOO_LARGE, "Not enough room to store the copy");
                if (done.some(function (d) { return d[1].media; }) && runtime.services["com.webos.service.mediaindexer"])
                    callNow("luna://com.webos.service.mediaindexer/requestMediaScan", { path: MEDIA_ROOT });
                return ok({ path: to });
            });
        }

        function copyOrMove(move) {
            return function (p, reply) {
                var from = norm(p.from), to = norm(p.to);
                if (!from || !to) return reply(fail(E.BAD_PARAMS, "from and to must be absolute paths"));
                var v = load();
                if (!v.nodes[from]) return reply(fail(E.NOT_FOUND, "No such file or directory: " + from));
                if (inside(to, from)) return reply(fail(E.INVALID, "Cannot " + (move ? "move" : "copy") + " a folder into itself"));
                var bad = checkTarget(v, to, !!p.overwrite) || (move ? checkRemovable(v, from) : null);
                if (bad) return reply(bad);
                if (v.nodes[to]) {
                    bad = checkRemovable(v, to);
                    if (bad) return reply(bad);
                    dropTree(v, to);
                    save(v);
                }
                transfer(from, to, move).then(reply, ioError(reply));
            };
        }

        function ioError(reply) {
            return function (e) { reply(fail(E.IO, String(e && e.message || e))); };
        }

        // ---- org.webosphoenix.filemanager ------------------------------------------------------

        var methods = {
            "/list": function (p, reply) {
                var path = norm(p.path);
                if (!path) return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                syncMedia().then(function () {
                    var v = load(), n = v.nodes[path];
                    if (!n) return reply(fail(E.NOT_FOUND, "No such file or directory: " + path));
                    if (n.t !== "d") return reply(fail(E.NOT_DIR, "Not a folder: " + path));
                    var kids = children(v, path);
                    fillSizes(kids).then(function () {
                        var v2 = load();
                        reply(ok({ path: path, entries: children(v2, path).map(function (k) { return entry(v2, k); }) }));
                    });
                }).then(null, ioError(reply));
            },
            "/stat": function (p, reply) {
                var path = norm(p.path);
                if (!path) return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                syncMedia().then(function () { return fillSizes([path]); }).then(function () {
                    var v = load();
                    if (!v.nodes[path]) return reply(fail(E.NOT_FOUND, "No such file or directory: " + path));
                    reply(ok({ entry: entry(v, path, true) }));
                }).then(null, ioError(reply));
            },
            "/mkdir": function (p, reply) {
                var path = norm(p.path);
                if (!path || path === "/") return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                var v = load();
                var bad = checkTarget(v, path, false);
                if (bad) return reply(bad);
                v.nodes[path] = { t: "d", m: Date.now(), mode: 493 };
                touch(v, parentOf(path));
                save(v);
                reply(ok({ path: path }));
            },
            "/copy": copyOrMove(false),
            "/move": copyOrMove(true),
            "/remove": function (p, reply) {
                var path = norm(p.path);
                if (!path) return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                syncMedia().then(function () {
                    var v = load();
                    var bad = checkRemovable(v, path);
                    if (bad) return reply(bad);
                    if (v.nodes[path].t === "d" && !p.recursive && children(v, path).length)
                        return reply(fail(E.NOT_EMPTY, "Folder not empty: " + path));
                    dropTree(v, path);
                    touch(v, parentOf(path));
                    save(v);
                    reply(ok({ path: path }));
                }).then(null, ioError(reply));
            },
            "/read": function (p, reply) {
                var path = norm(p.path), enc = p.encoding || "utf8";
                if (!path) return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                if (enc !== "utf8" && enc !== "base64") return reply(fail(E.BAD_PARAMS, "encoding must be utf8 or base64"));
                var limit = p.maxBytes > 0 ? p.maxBytes : READ_LIMIT;
                syncMedia().then(function () {
                    var v = load(), n = v.nodes[path];
                    if (!n) return reply(fail(E.NOT_FOUND, "No such file or directory: " + path));
                    if (n.t === "d") return reply(fail(E.IS_DIR, "Is a folder: " + path));
                    if (n.size > limit) return reply(fail(E.TOO_LARGE, "File is larger than " + limit + " bytes"));
                    if (n.data !== undefined && n.enc === enc && enc === "utf8")
                        return reply(ok({ path: path, data: n.data, encoding: enc, size: n.size }));
                    bytesOf(n, path).then(function (b) {
                        if (!b) return reply(fail(E.IO, "Cannot read " + path));
                        if (b.length > limit) return reply(fail(E.TOO_LARGE, "File is larger than " + limit + " bytes"));
                        reply(ok({ path: path, data: enc === "utf8" ? utf8Text(b) : toB64(b), encoding: enc, size: b.length }));
                    }, ioError(reply));
                }).then(null, ioError(reply));
            },
            "/write": function (p, reply) {
                var path = norm(p.path), enc = p.encoding || "utf8";
                if (!path) return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                if (typeof p.data !== "string") return reply(fail(E.BAD_PARAMS, "data is required"));
                if (enc !== "utf8" && enc !== "base64") return reply(fail(E.BAD_PARAMS, "encoding must be utf8 or base64"));
                var v = load();
                var bad = checkTarget(v, path, p.overwrite !== false);
                if (bad) return reply(bad);
                var old = v.nodes[path];
                if (old && old.t === "d") return reply(fail(E.IS_DIR, "Is a folder: " + path));
                var size;
                try { size = enc === "utf8" ? utf8Bytes(p.data).length : fromB64(p.data).length; }
                catch (e) { return reply(fail(E.BAD_PARAMS, "data is not base64")); }
                if (size > INLINE_LIMIT) return reply(fail(E.TOO_LARGE, "The simulator stores files up to 1 MB"));
                if (old && old.media && runtime.mediaFiles) runtime.mediaFiles.remove(path);
                v.nodes[path] = { t: "f", m: Date.now(), mode: old ? old.mode : 420, data: p.data, enc: enc, size: size };
                touch(v, parentOf(path));
                if (!save(v)) return reply(fail(E.TOO_LARGE, "Not enough room to store " + path));
                reply(ok({ path: path, size: size }));
            }
        };
        register(["org.webosphoenix.filemanager"], methods);

        // com.palm.appinstaller (Files' .ipk sheet): see "Installing apps" below.

        // ---- Application manager: handlers by MIME type ---------------------------------------

        // Apps register the types they open with appinfo.json "mimeTypes"
        // ([{mime, extension, stream}], luna-sysmgr ApplicationDescription;
        // Email's message/rfc822 in core-apps): Videos, PDF View, Doc View,
        // Podcasts. Photos and Music (HANDLERS above) come after them.
        function registeredTypes() {
            var out = [];
            launchPoints().forEach(function (lp) {
                if (!/_default$/.test(lp.launchPointId) || !lp.mimeTypes || !lp.mimeTypes.forEach) return;
                lp.mimeTypes.forEach(function (m) {
                    if (m && (m.mime || m.extension))
                        out.push({ appId: lp.id, title: lp.title, mime: String(m.mime || "").toLowerCase(),
                                   extension: String(m.extension || "").toLowerCase(), stream: !!m.stream });
                });
            });
            return out;
        }
        function typeMatches(pattern, mime) {
            if (!pattern || !mime) return false;
            return pattern === mime || (/\/\*$/.test(pattern) && mime.indexOf(pattern.slice(0, -1)) === 0);
        }
        function handlersFor(mime, ext) {
            mime = String(mime || "").toLowerCase();
            ext = String(ext || "").toLowerCase();
            var seen = {}, out = [];
            function add(appId, title) {
                if (seen[appId]) return;
                seen[appId] = true;
                out.push({ appId: appId, title: title, mime: mime, index: out.length });
            }
            registeredTypes().forEach(function (r) {
                if (typeMatches(r.mime, mime) || (ext && r.extension === ext)) add(r.appId, r.title);
            });
            HANDLERS.forEach(function (h) { if (mime.indexOf(h.prefix) === 0) add(h.appId, h.title); });
            return out;
        }
        // A file path, file:// uri or web address -> the first app that opens it.
        function handlerForTarget(target) {
            var t = String(target || "");
            var web = /^https?:\/\//i.test(t);
            var path = web ? t.replace(/[?#].*$/, "") : t.replace(/^file:\/\//, "");
            try { path = decodeURIComponent(path); } catch (e) { /* keep */ }
            var ext = extOf(path);
            if (!ext) return null;
            if (web) {
                // Only apps that asked for this extension take a web address;
                // other pages stay in the browser.
                var r = registeredTypes().filter(function (x) { return x.extension === ext; })[0];
                return r ? r.appId : null;
            }
            var h = handlersFor(mimeOf(path), ext)[0];
            return h ? h.appId : null;
        }
        runtime.handlerForTarget = handlerForTarget;
        var am = runtime.services["com.palm.applicationManager"];
        if (am) {
            am["/listAllHandlersForMime"] = function (p, reply) { reply(ok({ mime: p.mime, resources: handlersFor(p.mime) })); };
            am["/getHandlerForMimeType"] = function (p, reply) {
                var h = handlersFor(p.mimeType || p.mime)[0];
                reply(h ? ok({ appId: h.appId, mimeType: p.mimeType || p.mime }) : fail(-1, "no handler"));
            };
            // Email asks before opening an attachment (AttachmentsDrawer.js):
            // {uri, mime} -> {appIdByExtension, mimeByExtension, uri, canStream}.
            am["/getResourceInfo"] = function (p, reply) {
                var uri = String(p.uri || "");
                var path = uri.replace(/^file:\/\//, "").replace(/[?#].*$/, "");
                try { path = decodeURIComponent(path); } catch (e) { /* keep */ }
                var mime = MIME[extOf(path)] || p.mime || "application/octet-stream";
                var h = handlersFor(mime, extOf(path))[0] || (p.mime ? handlersFor(p.mime)[0] : null);
                if (!h) return reply(fail(-1, "No handler for " + mime));
                // stream: the app plays a web address itself (Videos); else it is downloaded first.
                var ext = extOf(path);
                var streams = registeredTypes().some(function (r) {
                    return r.appId === h.appId && r.stream && (r.extension === ext || typeMatches(r.mime, mime));
                });
                reply(ok({ uri: uri, appIdByExtension: h.appId, mimeByExtension: mime, canStream: streams && /^https?:/i.test(uri) }));
            };
            // open {target}: a file goes to the app that handles its type
            // (the browser's finished downloads, "Open by Type" in Files).
            var baseOpen = am["/open"];
            am["/open"] = function (p, reply, ctx) {
                var app = !p.id && p.target && handlerForTarget(p.target);
                if (app) {
                    host.postToHost("launch", { id: app, params: { target: p.target } });
                    return reply(ok({ processId: String(Date.now()), appId: app }));
                }
                baseOpen(p, reply, ctx);
            };
        }

        // ---- For the Files app and tests --------------------------------------------------------

        var urls = {};
        runtime.fileManager = {
            /** A URL to show a file: its rootfs path, a blob: URL or a data: URL. */
            url: function (path) {
                var p = norm(path);
                var n = p && load().nodes[p];
                if (!n || n.t !== "f") return Promise.resolve(path);
                if (n.ref) return Promise.resolve(n.ref);
                if (n.media && runtime.mediaFiles) return runtime.mediaFiles.url(p);
                var key = p + "@" + n.m + ":" + n.size;
                if (urls[key]) return Promise.resolve(urls[key]);
                return bytesOf(n, p).then(function (b) {
                    var type = mimeOf(p);
                    var u = global.URL && URL.createObjectURL ? URL.createObjectURL(new Blob([b], { type: type }))
                                                              : "data:" + type + ";base64," + toB64(b);
                    urls[key] = u;
                    return u;
                });
            },
            /** Throw the virtual filesystem away and seed it again. */
            reset: function () { store.set(VFS_KEY, seed()); },
            errors: E
        };
        // The documents' index (com.palm.media.misc.file:1) is there for
        // apps that read it without asking this service (Quickoffice).
        setTimeout(function () { try { load(); } catch (e) { /* the store is unavailable */ } }, 0);

        // ringtone/listRingtones: the system's ringtones (Open webOS's
        // /usr/palm/sounds), then the user's (/media/internal/ringtones, the
        // folder luna-sysservice's addRingtone copies into), as
        // {name, fullPath}; the name is the file's without its extension.
        var SYSTEM_RINGTONES = [
            { name: "Ringtone", fullPath: "/usr/palm/sounds/ringtone.mp3", system: true },
            { name: "Phone", fullPath: "/usr/palm/sounds/phone.wav", system: true }
        ];
        runtime.services["com.webos.service.systemservice"]["/ringtone/listRingtones"] = function (p, reply) {
            var v = load(), dir = MEDIA_ROOT + "/ringtones";
            var mine = children(v, dir).filter(function (k) {
                return v.nodes[k].t === "f" && /^audio\//.test(mimeOf(k)) && nameOf(k).charAt(0) !== ".";
            }).sort().map(function (k) {
                return { name: nameOf(k).replace(/\.[^.]*$/, ""), fullPath: k };
            });
            reply(ok({ ringtones: SYSTEM_RINGTONES.concat(mine) }));
        };
    })();

    // ================================================================================
    // HTTP, downloads and audio focus (Videos, Podcasts, PDF View, Doc View)
    // ================================================================================
    //
    //   __phoenixRuntime.http.request({method, url, headers, body, binary,
    //       follow}) -> Promise<{status, headers, body | bodyBase64, url}>: what
    //       @phoenix/luna's httpRequest() uses in the simulator. Feeds and
    //       podcast directories do not allow cross-origin requests, so it goes
    //       through the host's proxy: POST /__phoenix/proxy on a page served
    //       over HTTP (tools/serve-rootfs.py, the tests), GET
    //       /__phoenix/proxy?req=... on phoenix-sim's phoenix:// pages.
    //   com.webos.service.downloadmanager (and legacy com.palm.downloadmanager,
    //       which the Isis browser calls)   OSE's download manager keeps the
    //       legacy API: download {target, targetDir?, targetFilename?,
    //       subscribe} -> {ticket, url, target, subscribed}, then
    //       {ticket, amountReceived, amountTotal} and at the end {ticket,
    //       completed: true, completionStatusCode, destPath, destFile, target,
    //       url, mimetype} (interrupted: true when it failed); cancelDownload
    //       {ticket}; getAllHistory; clearHistory. Files land under
    //       /media/internal (default folder /media/internal/downloads) in the
    //       media block's store, so Files, the media indexer and the apps see
    //       them.
    //   com.webos.service.audiofocusmanager   requestFocus {requestType,
    //       streamType, displayId, subscribe} -> {result: "AF_GRANTED"}; the
    //       app that held the focus is told {result: "AF_LOST"}. The holder
    //       is kept in the shared store, so Music, Videos and Podcasts pages
    //       pause each other. releaseFocus -> {result: "AF_SUCCESSFULLY_RELEASED"};
    //       getStatus -> {audioFocusStatus: [{appId, streamType, requestType}]}.
    //
    // __phoenixRuntime.downloads: list() (the history), reset().
    (function mediaAppServices() {
        var MEDIA_ROOT = "/media/internal";
        var DOWNLOAD_DIR = MEDIA_ROOT + "/downloads";
        var HISTORY_KEY = "downloads:history";
        var FOCUS_KEY = "audiofocus";

        // ---- HTTP -----------------------------------------------------------------------

        function b64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; i += 0x8000)
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return global.btoa(s);
        }
        function request(req) {
            var r = { method: req.method || "GET", url: req.url, headers: req.headers || {}, body: req.body,
                      binary: !!req.binary, follow: req.follow !== false };
            var viaHost = /^https?:$/.test(global.location.protocol)
                ? fetch("/__phoenix/proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: toJson(r) })
                : global.location.protocol === "phoenix:"
                ? fetch("/__phoenix/proxy?req=" + encodeURIComponent(toJson(r)))
                : null;
            if (viaHost) {
                return viaHost.then(function (res) { return res.json(); }).then(function (x) {
                    if (x.error) {
                        var e = new Error(x.error);
                        e.code = x.code;
                        throw e;
                    }
                    return x;
                });
            }
            return fetch(r.url, { method: r.method, headers: r.headers, body: r.body, credentials: "omit",
                                  redirect: r.follow ? "follow" : "manual" }).then(function (res) {
                var headers = {};
                res.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
                var body = r.binary
                    ? res.arrayBuffer().then(function (buf) { return { bodyBase64: b64(new Uint8Array(buf)) }; })
                    : res.text().then(function (t) { return { body: t }; });
                return body.then(function (b) {
                    b.status = res.status;
                    b.headers = headers;
                    b.url = res.url || r.url;
                    return b;
                });
            }, function (e) {
                var err = new Error("Could not reach " + r.url + " (no answer, or cross-origin requests refused): " + e.message);
                err.code = "ECONNREFUSED";
                throw err;
            });
        }
        runtime.http = { request: request };

        // ---- Download manager -------------------------------------------------------------

        var ticketSeq = store.get("downloads:ticket", 0);
        var running = {};
        function history() { return store.get(HISTORY_KEY, []); }
        function remember(rec) {
            var h = history().filter(function (x) { return x.ticket !== rec.ticket; });
            h.unshift(rec);
            store.set(HISTORY_KEY, h.slice(0, 50));
        }
        function fileNameOf(url) {
            var name = String(url).replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^.*\//, "");
            try { name = decodeURIComponent(name); } catch (e) { /* keep */ }
            name = name.replace(/[\/\\\u0000]/g, "_");
            return name || "download";
        }
        function fromB64(s) {
            var bin = global.atob(s), out = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
            return out;
        }

        function download(p, reply, ctx) {
            var url = String(p.target || p.url || "");
            if (!/^https?:\/\//i.test(url)) return reply(fail(-1, "target must be an http or https URL"));
            var dir = String(p.targetDir || DOWNLOAD_DIR).replace(/\/+$/, "");
            if (dir.indexOf(MEDIA_ROOT) !== 0 || dir.split("/").indexOf("..") >= 0)
                return reply(fail(-1, "targetDir must be under " + MEDIA_ROOT));
            var name = p.targetFilename ? String(p.targetFilename).replace(/[\/\\]/g, "_") : fileNameOf(url);
            var path = dir + "/" + name;
            var ticket = ++ticketSeq;
            store.set("downloads:ticket", ticketSeq);
            var rec = { ticket: ticket, url: url, target: path, destPath: dir + "/", destFile: name, mimetype: p.mime || "",
                        owner: PalmSystem.appIdentifier || "", amountReceived: 0, amountTotal: 0, completed: false };
            running[ticket] = { aborted: false };
            remember(rec);
            reply(ok({ ticket: ticket, url: url, target: path, subscribed: !!p.subscribe }));
            var send = function (x) { if (!ctx.cancelled()) reply(ok(x)); };
            request({ url: url, binary: true, follow: true }).then(function (res) {
                if (running[ticket].aborted) throw { aborted: true };
                if (res.status < 200 || res.status > 299) throw { status: res.status };
                var bytes = fromB64(res.bodyBase64 || "");
                var total = bytes.length;
                rec.amountTotal = total;
                rec.mimetype = rec.mimetype || (res.headers && res.headers["content-type"] || "").split(";")[0];
                // Progress in a few steps, as the real service reports it.
                send({ ticket: ticket, url: url, amountReceived: Math.floor(total / 2), amountTotal: total });
                var blob = new Blob([bytes], { type: rec.mimetype || "" });
                if (!runtime.mediaFiles) throw { status: -1 };
                return runtime.mediaFiles.write(path, blob).then(function () { return total; });
            }).then(function (total) {
                if (running[ticket].aborted) throw { aborted: true };
                rec.amountReceived = total;
                rec.completed = true;
                rec.completionStatusCode = 200;
                remember(rec);
                delete running[ticket];
                send({ ticket: ticket, url: url, amountReceived: total, amountTotal: total });
                send({ ticket: ticket, url: url, target: path, destPath: rec.destPath, destFile: name, mimetype: rec.mimetype,
                       amountReceived: total, amountTotal: total, completed: true, completionStatusCode: 200,
                       interrupted: false, aborted: false });
            }, function (e) {
                var aborted = !!(e && e.aborted);
                rec.completed = true;
                rec.aborted = aborted;
                rec.interrupted = !aborted;
                rec.completionStatusCode = e && e.status ? e.status : -1;
                remember(rec);
                delete running[ticket];
                send({ ticket: ticket, url: url, target: path, destPath: rec.destPath, destFile: name, completed: true,
                       completionStatusCode: rec.completionStatusCode, interrupted: !aborted, aborted: aborted });
            });
        }

        var dm = {
            "/download": download,
            "/cancelDownload": function (p, reply) {
                var r = running[p.ticket];
                if (!r) return reply(fail(-1, "No such download: " + p.ticket));
                r.aborted = true;
                reply(ok({ ticket: p.ticket }));
            },
            "/getAllHistory": function (p, reply) {
                var owner = p.owner;
                reply(ok({ items: history().filter(function (h) { return !owner || h.owner === owner; }) }));
            },
            "/clearHistory": function (p, reply) {
                store.set(HISTORY_KEY, p.owner ? history().filter(function (h) { return h.owner !== p.owner; }) : []);
                reply(ok());
            }
        };
        register(["com.webos.service.downloadmanager", "com.palm.downloadmanager"], dm);
        runtime.downloads = {
            list: history,
            reset: function () { store.set(HISTORY_KEY, []); }
        };

        // ---- Audio focus -------------------------------------------------------------------

        var pageId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var focusSeq = 0;
        var holders = [];   // this page's subscribers: {token, reply, ctx, streamType}

        function current() { return store.get(FOCUS_KEY, null); }
        // Tell this page's subscribers that are not the holder that they lost it.
        function tellLosers() {
            var h = current();
            holders = holders.filter(function (w) {
                if (w.ctx.cancelled()) return false;
                if (h && h.token === w.token) return true;
                w.reply(ok({ result: "AF_LOST", streamType: w.streamType }));
                return false;
            });
        }
        try {
            global.addEventListener("storage", function (e) {
                if (e.key === "phoenix:" + FOCUS_KEY) tellLosers();
            });
        } catch (e) { /* ignore */ }

        register(["com.webos.service.audiofocusmanager"], {
            "/requestFocus": function (p, reply, ctx) {
                if (!p.requestType) return reply(fail(-1, "requestType is required"));
                var token = pageId + ":" + (++focusSeq);
                var streamType = p.streamType || "pmedia";
                store.set(FOCUS_KEY, { token: token, appId: PalmSystem.appIdentifier || "", streamType: streamType,
                                       requestType: p.requestType, time: Date.now() });
                tellLosers();
                if (runtime.hostStatus) host.postToHost("systemStatus", runtime.hostStatus());
                if (p.subscribe) {
                    var w = { token: token, reply: reply, ctx: ctx, streamType: streamType };
                    holders.push(w);
                    ctx.onCancel = function () { holders = holders.filter(function (x) { return x !== w; }); };
                }
                reply(ok({ result: "AF_GRANTED", subscribed: !!p.subscribe }));
            },
            "/releaseFocus": function (p, reply) {
                var h = current();
                if (h && h.token.indexOf(pageId + ":") === 0) {
                    store.set(FOCUS_KEY, null);
                    if (runtime.hostStatus) host.postToHost("systemStatus", runtime.hostStatus());
                }
                reply(ok({ result: "AF_SUCCESSFULLY_RELEASED" }));
            },
            "/getStatus": function (p, reply) {
                var h = current();
                reply(ok({ audioFocusStatus: h ? [{ appId: h.appId, streamType: h.streamType, requestType: h.requestType }] : [] }));
            }
        });
    })();

    // ================================================================================
    // Activity manager and alarms (com.palm.activitymanager, com.palm.power timeout;
    // Tasks reminders, apps/tasks)
    // ================================================================================
    //
    // Legacy webOS apps scheduled alarms as activities with a schedule whose
    // callback runs when the time comes; the Clock app's alarms
    // (com.palm.app.clock utility/activitymanager.js), Calendar's midnight
    // icon update (app/AppIcon.js) and the calendar reminders service
    // (app-services com.palm.service.calendar.reminders) all do:
    //
    //   create {activity: {name, description, type, schedule: {start, local?},
    //           callback: {method, params}}, start, replace}  -> {activityId}
    //   complete {activityId | activityName, restart?, schedule?, callback?}
    //   cancel / stop {activityId | activityName}
    //   getDetails {activityId | activityName}  -> {activity}
    //   list  -> {activities}
    //
    // schedule.start is "YYYY-MM-DD HH:MM:SS", in UTC (with or without a
    // trailing Z) unless "local": true. When it comes, the callback is
    // called with $activity {activityId, name} added to its params; for
    // an application manager launch, inside the app's launch params (where
    // Calendar reads params.$activity.activityId). A fired activity stays
    // until it is completed or replaced, and is not fired again. Activities
    // without a schedule are kept but never fire here (they wait on
    // triggers the simulator does not have).
    // One requirement is honoured: requirements {charging: true} holds an
    // activity until the charger is connected (System Updates' "install at
    // next charge"); it fires then, or at once if it already is.
    //
    // The older alarm API, com.palm.power timeout/set {key, at: "MM/DD/YYYY
    // HH:MM:SS" (UTC) | in: "HH:MM:SS", uri, params} and timeout/clear {key},
    // goes on the same schedule (as activity "timeout:" + key).
    //
    // Activities live in the shared store ("activities"), so every app page
    // sees them and any page may fire one: the page of the app a launch is
    // for fires it at once (as OSE's webOSRelaunch, the card is not brought
    // up: the app decides what to show), other pages a second later (the
    // shell then starts or relaunches the app without focusing its card).
    // One page claims each activity in the store before firing it. What is
    // due while no page runs fires when the next page starts. A dashboard or
    // popup alert of the app counts as another page (it may outlive the
    // app's card).
    //
    // For tests: __phoenixRuntime.activities.fireDue(at) fires everything
    // due by `at` (ms) at once, as if the clock had moved on; list() shows
    // what is scheduled.
    (function activityManagerService() {
        var KEY = "activities";
        var GRACE_MS = 1000;          // other pages wait this long for the app's own page
        var MAX_WAIT_MS = 60000;      // re-check at least this often (clock changes)
        var timer = null;

        function load() { return store.get(KEY, { nextId: 1, byName: {} }); }
        function save(st) { store.set(KEY, st); }

        // "2026-09-28 14:05:00Z" (UTC), or local time with local: true.
        function parseStart(schedule) {
            var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z)?$/.exec(String(schedule && schedule.start || ""));
            if (!m) return null;
            var f = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
            return schedule.local && !m[7] ? new Date(f[0], f[1], f[2], f[3], f[4], f[5]).getTime()
                                          : Date.UTC(f[0], f[1], f[2], f[3], f[4], f[5]);
        }

        function find(st, p) {
            if (p.activityName && st.byName[p.activityName]) return st.byName[p.activityName];
            for (var n in st.byName)
                if (st.byName[n].activityId === p.activityId) return st.byName[n];
            return null;
        }

        function details(a) {
            return { activityId: a.activityId, name: a.name, description: a.description || "", type: a.type || {},
                     schedule: a.schedule, callback: a.callback, creator: a.creator,
                     state: a.fired ? "running" : a.due !== null ? "waiting" : "queued" };
        }

        function create(p, reply) {
            var a = p.activity;
            if (!a || !a.name) { reply(fail(-1, "activity.name is required")); return; }
            var st = load();
            var old = st.byName[a.name];
            if (old && !p.replace) { reply(fail(17, "Activity with that name already exists")); return; }
            var due = a.schedule ? parseStart(a.schedule) : null;
            if (a.schedule && a.schedule.start && due === null) { reply(fail(22, "Invalid schedule start: " + a.schedule.start)); return; }
            var entry = {
                activityId: st.nextId++, name: a.name, description: a.description, type: a.type,
                schedule: a.schedule || null, callback: a.callback || null, creator: PalmSystem.appIdentifier,
                due: p.start === false ? null : due, fired: false
            };
            if (a.requirements && a.requirements.charging === true) entry.charging = true;
            // With no schedule or trigger, a started activity runs now: its
            // callback is called once, by the page that created it.
            var now = p.start !== false && !a.schedule && !a.trigger && !!entry.callback &&
                (!entry.charging || charging());
            if (now) entry.fired = true;
            st.byName[a.name] = entry;
            save(st);
            reply(ok({ activityId: entry.activityId }));
            if (now) setTimeout(function () { fire(entry); }, 0);
            arm();
        }

        function complete(p, reply) {
            var st = load(), a = find(st, p);
            if (!a) { reply(fail(2, "Activity not found")); return; }
            if (p.restart) {
                if (p.schedule) a.schedule = p.schedule;
                if (p.callback) a.callback = p.callback;
                a.due = a.schedule ? parseStart(a.schedule) : null;
                a.fired = false;
            } else {
                delete st.byName[a.name];
            }
            save(st);
            reply(ok({ activityId: a.activityId }));
            arm();
        }

        function cancel(p, reply) {
            var st = load(), a = find(st, p);
            if (!a) { reply(fail(2, "Activity not found")); return; }
            delete st.byName[a.name];
            save(st);
            reply(ok({ activityId: a.activityId }));
            arm();
        }

        function isAppLaunch(method) {
            return /^(?:palm|luna):\/\/com\.(?:palm|webos)\.applicationManager\/(?:launch|open)\/?$/.test(String(method || ""));
        }

        // A dashboard or popup alert the app opened (#phoenixWindow=, see
        // window.open above) is not the app: it may be all that is left of
        // it once its card is closed, and a relaunch there is never seen.
        function systemWindow() {
            return /[#&]phoenixWindow=/.test(String(global.location && global.location.hash || ""));
        }

        function forThisPage(a) {
            return !!a.callback && isAppLaunch(a.callback.method) && a.callback.params &&
                a.callback.params.id === PalmSystem.appIdentifier && !systemWindow();
        }

        function fire(a) {
            if (!a.callback || !a.callback.method) return;
            var act = { activityId: a.activityId, name: a.name };
            var params = clone(a.callback.params || {});
            if (isAppLaunch(a.callback.method) && params.id) {
                params.params = params.params || {};
                params.params.$activity = act;
                if (params.id === PalmSystem.appIdentifier && !systemWindow() && runtime.relaunch) {
                    runtime.relaunch(params.params);
                    return;
                }
            } else {
                params.$activity = act;
            }
            dispatch(a.callback.method, params, function () {}, { cancelled: function () { return true; }, onCancel: null });
        }

        function charging() { return store.get("power", { charger: "none" }).charger !== "none"; }

        // Fire what is due (for this page: see above). `at` forces the time.
        function check(at) {
            var now = at === undefined ? Date.now() : at;
            var st = load(), due = [];
            var plugged = charging();
            for (var n in st.byName) {
                var a = st.byName[n];
                if (a.charging && !a.fired && !a.schedule && a.callback && plugged) {
                    a.fired = true;
                    a.due = now;
                    due.push(a);
                    continue;
                }
                if (a.charging && !plugged) continue;
                if (a.fired || a.due === null || a.due === undefined || a.due > now) continue;
                if (at === undefined && !forThisPage(a) && now < a.due + GRACE_MS) continue;
                a.fired = true;
                due.push(a);
            }
            if (due.length) save(st);
            due.sort(function (x, y) { return x.due - y.due; }).forEach(fire);
            arm();
            return due.length;
        }

        function arm() {
            if (timer) clearTimeout(timer);
            timer = null;
            var st = load(), next = Infinity;
            for (var n in st.byName) {
                var a = st.byName[n];
                if (a.fired || a.due === null || a.due === undefined) continue;
                next = Math.min(next, forThisPage(a) ? a.due : a.due + GRACE_MS);
            }
            if (next === Infinity) return;
            timer = setTimeout(function () { timer = null; check(); },
                               Math.max(0, Math.min(MAX_WAIT_MS, next - Date.now())));
        }

        register(["com.palm.activitymanager"], {
            "/create": create,
            "/complete": complete,
            "/cancel": cancel,
            "/stop": cancel,
            "/getDetails": function (p, reply) {
                var a = find(load(), p);
                reply(a ? ok({ activity: details(a) }) : fail(2, "Activity not found"));
            },
            "/list": function (p, reply) {
                var st = load(), out = [];
                for (var n in st.byName) out.push(details(st.byName[n]));
                reply(ok({ activities: out }));
            },
            // adopt, release, monitor, focus, ...: nothing to do here.
            "*": function (p, reply) { reply(ok({ activityId: p.activityId || 0 })); }
        });

        // com.palm.power timeout/set and timeout/clear (the pre-activity alarm API).
        var power = runtime.services["com.palm.power"];
        if (power) {
            power["/timeout/set"] = function (p, reply) {
                if (!p.key || !p.uri) { reply(fail(-1, "key and uri are required")); return; }
                var start, m;
                if (p.at && (m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(p.at)))
                    start = m[3] + "-" + m[1] + "-" + m[2] + " " + m[4] + ":" + m[5] + ":" + m[6] + "Z";
                else if (p["in"] && (m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(p["in"])))
                    start = new Date(Date.now() + ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
                else { reply(fail(-1, "at or in is required")); return; }
                create({ start: true, replace: true, activity: { name: "timeout:" + p.key, description: "com.palm.power timeout",
                    schedule: { start: start }, callback: { method: p.uri, params: p.params || {} } } }, function (r) {
                    reply(r.returnValue ? ok({ key: p.key }) : r);
                });
            };
            power["/timeout/clear"] = function (p, reply) {
                cancel({ activityName: "timeout:" + p.key }, function () { reply(ok({ key: p.key })); });
            };
        }

        global.addEventListener && global.addEventListener("storage", function (e) {
            if (e.key === "phoenix:" + KEY) arm();
            else if (e.key === "phoenix:power") check();   // the charger, for requirements.charging
        });
        var setPower = runtime.setPower;
        runtime.setPower = function (changes) {
            var st = setPower(changes);
            check();
            return st;
        };
        // What came due while no page was running.
        setTimeout(function () { check(); }, 0);

        runtime.activities = {
            /** Fire every activity due by `at` (ms) now, from this page. Returns how many. */
            fireDue: function (at) { return check(at === undefined ? Date.now() : at); },
            list: function () {
                var st = load(), out = [];
                for (var n in st.byName) out.push(details(st.byName[n]));
                return out;
            },
            parseStart: parseStart
        };
    })();

    // ================================================================================
    // Text to speech (com.webos.service.tts; apps/maps)
    // ================================================================================
    //
    // com.webos.service.tts speak {text, language?, clear?} is simulated by
    // remembering what was said (__phoenixRuntime.tts.spoken), so tests can
    // check Maps' spoken directions; stop {} forgets the queue. (The
    // location service is simulated in the block "First use, emergency
    // information, location and help".)
    (function textToSpeech() {
        var spoken = [];
        register(["com.webos.service.tts"], {
            "/speak": function (p, reply) {
                if (typeof p.text !== "string" || !p.text) return reply(fail(-1, "text is required"));
                spoken.push({ text: p.text, language: p.language || "en-US", time: Date.now() });
                reply(ok({ msgID: "sim" + spoken.length }));
            },
            "/stop": function (p, reply) { reply(ok()); },
            "/getStatus": function (p, reply) { reply(ok({ status: "idle" })); }
        });
        runtime.tts = { spoken: spoken };
    })();

    // ================================================================================
    // Voice memos (org.webosphoenix.transcriber; apps/voicememos)
    // ================================================================================
    //
    // Voice Memos records with getUserMedia and MediaRecorder and saves 16 kHz
    // WAV files under /media/internal/voicememos through the media block's
    // org.webosphoenix.service.mediafiles, like the Camera; its memos (title,
    // path, duration, transcript) are db8 objects of org.webosphoenix.voicememo:1.
    // This block simulates the speech-to-text service it calls. On a device
    // that is the Node.js service in apps/voicememos/service, which runs
    // whisper.cpp; the requests, replies and error codes are the same
    // (TRANSCRIBE_ERRORS in apps/shared/luna/src/transcriber.ts):
    //
    //   transcribe {path, language?, subscribe?}
    //       -> with subscribe: {subscribed, state: "queued" | "transcribing",
    //          progress} while it works; then (or without subscribe, only)
    //          {state: "done", progress: 100, text, segments: [{start, end,
    //          text}], language, engine}
    //   getStatus {} -> {engine: "simulator", installed: true, live}
    //   listen {language?, subscribe}   simulator only: live captions from the
    //       browser's Web Speech API while recording, when the browser has
    //       one ({live: true} in getStatus): {text, final: true} per phrase
    //       until cancelled, or an error (ENGINE_NOT_INSTALLED) when it
    //       cannot run (no network, no permission)
    //
    // The simulator cannot run whisper.cpp, and it never makes up a
    // transcript: only the demo memos the app ships
    // (apps/voicememos/public/samples, listed with their scripts in
    // samples.json) get their known text, recognised by size and FNV-1a hash
    // of the file's bytes, whatever the memo is called. Any other recording
    // gets the placeholder "(transcription runs on the device with
    // whisper.cpp)" with placeholder: true, which the app shows but does not
    // store as searchable text.
    (function voiceMemoServices() {
        var APP_ID = "org.webosphoenix.voicememos";
        var SAMPLES = "/usr/palm/applications/" + APP_ID + "/samples/samples.json";
        var PLACEHOLDER = "(transcription runs on the device with whisper.cpp)";
        var E = { BAD_PARAMS: -1, NOT_FOUND: 1, ENGINE_NOT_INSTALLED: 2, MODEL_NOT_INSTALLED: 3, UNSUPPORTED_FORMAT: 4, FAILED: 5 };

        var samples = null;
        function demoMemos() {
            if (samples === null) {
                try { samples = JSON.parse(PalmSystem.getResource(SAMPLES) || "{}").memos || []; }
                catch (e) { samples = []; }
            }
            return samples;
        }

        // 32-bit FNV-1a, as apps/voicememos/tools/make-samples.cjs writes it.
        function fnv1a(bytes) {
            var h = 0x811c9dc5;
            for (var i = 0; i < bytes.length; ++i) {
                h ^= bytes[i];
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return ("0000000" + h.toString(16)).slice(-8);
        }

        function demoFor(bytes) {
            var hash = null;
            return demoMemos().filter(function (m) {
                if (m.file_size !== bytes.length) return false;
                if (hash === null) hash = fnv1a(bytes);
                return m.fnv1a === hash;
            })[0] || null;
        }

        // The file's bytes from the simulated filesystem (files the apps
        // stored, the rootfs), or null when there is none.
        function readBytes(path) {
            return new Promise(function (resolve) {
                dispatch("luna://org.webosphoenix.filemanager/read", { path: path, encoding: "base64" }, function (r) {
                    if (!r.returnValue) return resolve(null);
                    try {
                        var bin = global.atob(r.data), b = new Uint8Array(bin.length);
                        for (var i = 0; i < bin.length; ++i) b[i] = bin.charCodeAt(i);
                        resolve(b);
                    } catch (e) {
                        resolve(null);
                    }
                }, { cancelled: function () { return false; }, onCancel: null });
            });
        }

        function speechRecognition() {
            return global.SpeechRecognition || global.webkitSpeechRecognition || null;
        }

        register(["org.webosphoenix.transcriber"], {
            "/transcribe": function (p, reply, ctx) {
                if (typeof p.path !== "string" || p.path.charAt(0) !== "/")
                    return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                var language = p.language || "en";
                var progress = function (state, n) {
                    if (p.subscribe && !ctx.cancelled()) reply(ok({ subscribed: true, state: state, progress: n }));
                };
                progress("queued", 0);
                readBytes(p.path).then(function (bytes) {
                    if (ctx.cancelled()) return;
                    if (!bytes) return reply(fail(E.NOT_FOUND, "No such file: " + p.path));
                    var demo = demoFor(bytes);
                    if (!demo) {
                        return setTimeout(function () {
                            reply(ok({ state: "done", progress: 100, text: PLACEHOLDER, segments: [], language: language,
                                       engine: "simulator", placeholder: true }));
                        }, 150);
                    }
                    // The demo memo: its script, after a short show of progress.
                    [20, 45, 70, 90].forEach(function (n, i) {
                        setTimeout(function () { progress("transcribing", n); }, 150 * (i + 1));
                    });
                    setTimeout(function () {
                        if (ctx.cancelled() && p.subscribe) return;
                        reply(ok({ state: "done", progress: 100, text: demo.text, segments: demo.segments || [],
                                   language: demo.language || "en", engine: "simulator" }));
                    }, 750);
                });
            },
            "/getStatus": function (p, reply) {
                reply(ok({ engine: "simulator", installed: true, live: !!speechRecognition() }));
            },
            "/listen": function (p, reply, ctx) {
                var SR = speechRecognition();
                if (!SR) return reply(fail(E.ENGINE_NOT_INSTALLED, "This browser has no speech recognition"));
                var rec, stopped = false;
                try {
                    rec = new SR();
                    rec.lang = p.language === "en" || !p.language ? "en-US" : p.language;
                    rec.continuous = true;
                    rec.interimResults = false;
                } catch (e) {
                    return reply(fail(E.ENGINE_NOT_INSTALLED, "Speech recognition is not available"));
                }
                rec.onresult = function (ev) {
                    if (stopped || ctx.cancelled()) return;
                    for (var i = ev.resultIndex; i < ev.results.length; ++i) {
                        var r = ev.results[i];
                        if (r.isFinal && r[0] && r[0].transcript.trim())
                            reply(ok({ subscribed: true, text: r[0].transcript.trim(), final: true }));
                    }
                };
                rec.onerror = function (ev) {
                    if (stopped || ctx.cancelled()) return;
                    stopped = true;
                    reply(fail(E.ENGINE_NOT_INSTALLED, "Speech recognition is not available (" + (ev && ev.error || "error") + ")"));
                };
                // Chromium ends a continuous session after a while of silence:
                // go on listening, unless it ended at once (it cannot run).
                var since = Date.now();
                rec.onend = function () {
                    if (stopped || ctx.cancelled()) return;
                    if (Date.now() - since < 1000) { stopped = true; return; }
                    since = Date.now();
                    try { rec.start(); } catch (e) { stopped = true; }
                };
                ctx.onCancel = function () {
                    stopped = true;
                    try { rec.stop(); } catch (e) { /* ignore */ }
                };
                try {
                    rec.start();
                    reply(ok({ subscribed: true, listening: true }));
                } catch (e) {
                    stopped = true;
                    reply(fail(E.ENGINE_NOT_INSTALLED, "Speech recognition is not available"));
                }
            }
        });

        // A file deleted through mediafiles/remove (a memo, or a picture
        // deleted in Photos) leaves the file manager's view too: its
        // virtual filesystem only learns about new media files by itself.
        var mf = runtime.services["org.webosphoenix.service.mediafiles"];
        if (mf && mf["/remove"] && runtime.services["org.webosphoenix.filemanager"]) {
            var baseRemove = mf["/remove"];
            mf["/remove"] = function (p, reply, ctx) {
                baseRemove(p, function (r) {
                    if (!r.returnValue) return reply(r);
                    dispatch("luna://org.webosphoenix.filemanager/remove", { path: p.path }, function () { reply(r); },
                             { cancelled: function () { return false; }, onCancel: null });
                }, ctx);
            };
        }

        runtime.voiceMemos = { placeholder: PLACEHOLDER, errors: E };
    })();

    // ---- Node.js device services in the page --------------------------------------
    //
    // Some Phoenix services are Node.js modules a device runs with
    // run-js-service (apps/dav/service, apps/settings/service). The simulator
    // runs the same code in the page: nodeServiceLoader(dir, label) is a
    // require() for its CommonJS modules (relative requires only), read
    // from the virtual rootfs; nodeServiceLuna() is its luna.call(uri,
    // params) -> Promise<reply> on the simulated bus; proxiedRequest is its
    // HTTP, {method, url, headers, body} -> Promise<{status, headers, body}>.
    // Servers do not allow cross-origin requests, so each goes through a
    // proxy of the host: a page served over HTTP (tools/serve-rootfs.py, the
    // tests) POSTs it to /__phoenix/proxy; phoenix-sim's phoenix:// pages GET
    // /__phoenix/proxy?req=... (its RootfsSchemeHandler). Elsewhere it uses
    // fetch directly, which only works with servers that send CORS headers.
    // proxiedRequestBytes is the same with the body as a Uint8Array (bytes).
    function nodeServiceLoader(serviceDir, label) {
        var modules = {};
        function normPath(p) {
            var out = [];
            p.split("/").forEach(function (s) {
                if (s === "..") out.pop();
                else if (s && s !== ".") out.push(s);
            });
            return out.join("/");
        }
        function loadModule(rel) {
            rel = normPath(rel);
            if (modules[rel]) return modules[rel].exports;
            var text = PalmSystem.getResource(serviceDir + rel);
            if (!text) throw new Error(label + " module not found: " + serviceDir + rel);
            var module = { exports: {} };
            modules[rel] = module;
            var dir = rel.indexOf("/") >= 0 ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
            function req(name) {
                if (name.charAt(0) !== ".") throw new Error(label + ": no module " + name + " in the simulator");
                return loadModule(dir + name + (/\.js$/.test(name) ? "" : ".js"));
            }
            new Function("module", "exports", "require", text + "\n//# sourceURL=" + serviceDir + rel)(module, module.exports, req);
            return module.exports;
        }
        return loadModule;
    }

    function nodeServiceLuna() {
        return {
            // A subscription: onReply for each reply until cancel().
            subscribe: function (uri, params, onReply) {
                var stopped = false;
                dispatch(uri, clone(params || {}), function (r) {
                    if (!stopped) setTimeout(function () { if (!stopped) onReply(r); }, 0);
                }, { cancelled: function () { return stopped; }, onCancel: null });
                return function () { stopped = true; };
            },
            call: function (uri, params) {
                return new Promise(function (resolve) {
                    var done = false;
                    dispatch(uri, clone(params || {}), function (r) {
                        if (done) return;
                        done = true;
                        setTimeout(function () { resolve(r); }, 0);
                    }, { cancelled: function () { return done; }, onCancel: null });
                });
            }
        };
    }

    function proxiedRequestBytes(req) {
        return proxiedRequest(Object.assign({}, req, { binary: true, follow: true })).then(function (r) {
            if (r.bytes) return r;
            var s = atob(r.bodyBase64 || ""), bytes = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
            return { status: r.status, headers: r.headers, bytes: bytes };
        });
    }

    function proxiedRequest(req) {
        var viaHost = /^https?:$/.test(global.location.protocol)
            ? fetch("/__phoenix/proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: toJson(req) })
            : global.location.protocol === "phoenix:"
            ? fetch("/__phoenix/proxy?req=" + encodeURIComponent(toJson(req)))
            : null;
        if (viaHost) {
            return viaHost.then(function (res) { return res.json(); }).then(function (r) {
                if (r.error) {
                    var e = new Error(r.error);
                    e.code = r.code;
                    throw e;
                }
                return r;
            });
        }
        return fetch(req.url, { method: req.method, headers: req.headers, body: req.body, credentials: "omit" })
            .then(function (res) {
                return (req.binary ? res.arrayBuffer() : res.text()).then(function (body) {
                    var h = {};
                    res.headers.forEach(function (v, k) { h[k.toLowerCase()] = v; });
                    var out = { status: res.status, headers: h };
                    if (req.binary) out.bytes = new Uint8Array(body);
                    else out.body = body;
                    return out;
                });
            }, function (e) {
                var err = new Error("Could not reach " + req.url + " (no answer, or cross-origin requests refused): " + e.message);
                err.code = "ECONNREFUSED";
                throw err;
            });
    }

    // ================================================================================
    // CardDAV and CalDAV (Synergy transport org.webosphoenix.service.dav; apps/dav)
    // ================================================================================
    //
    // The CardDAV & CalDAV account (template com.webosphoenix.dav) syncs
    // contacts and calendars with a real server. Nothing here reimplements it:
    // this block runs the device's own service code, apps/dav/service
    // (davservice.js and lib/, CommonJS modules without dependencies), in the
    // page, loaded from /usr/palm/applications/org.webosphoenix.dav/service/,
    // and gives it what run-js-service gives it on a device ("Node.js device
    // services in the page" above): luna calls on the simulated bus (db8,
    // tempdb, accounts, activities) and HTTP for the DAV client
    // (docs/SYNERGY.md).
    //
    // It also adds to the blocks above what a Synergy transport needs from
    // the system, only for accounts of templates listed in DAV_TEMPLATES:
    //   - com.palm.service.accounts lists the template (read from
    //     /usr/palm/public/accounts/com.webosphoenix.dav/), creates, modifies
    //     and deletes its accounts, and calls the capability callbacks as
    //     app-services' handlers do: onCreate then onEnabled(true) after
    //     createAccount (notify-created.js), onEnabled(true/false) when
    //     capabilities are switched (modify.js), onCredentialsChanged
    //     (credentials.js), onEnabled(false) then onDelete before the account
    //     and its data go (notify-deleted.js);
    //   - "Sync now" (Contacts and Calendar) is an activity with no schedule,
    //     which the activity manager above runs at once. Interval schedules
    //     (the periodic sync) are not run: there is no background process in
    //     the simulator;
    //   - db8 learns the transport's kinds (com.palm.contact.dav:1 extends
    //     com.palm.contact:1, ...).
    //
    // One sync at a time per account across all pages (a lock in the shared
    // store). __phoenixRuntime.dav: sync(accountId) -> Promise, service() (the
    // service's methods), templates().
    (function davTransport() {
        var SERVICE = "org.webosphoenix.service.dav";
        var SERVICE_DIR = "/usr/palm/applications/org.webosphoenix.dav/service/";
        var DAV_TEMPLATES = ["/usr/palm/public/accounts/com.webosphoenix.dav/com.webosphoenix.dav.json"];
        var ACCOUNT_KIND = "com.palm.account:1";
        var LOCK_MS = 5 * 60 * 1000;

        var loadModule = nodeServiceLoader(SERVICE_DIR, "DAV service");
        var luna = nodeServiceLuna();
        var request = proxiedRequest;

        var methods = null;
        function service() {
            if (!methods) {
                var davservice = loadModule("davservice.js");
                methods = davservice.createDavService({
                    luna: luna,
                    request: request,
                    log: function (m) { console.info("[dav] " + m); }
                });
            }
            return methods;
        }

        // ---- The service on the simulated bus ---------------------------------------------

        function lockKey(accountId) { return "dav:syncLock:" + accountId; }

        var serviceMethods = {};
        ["checkCredentials", "onCreate", "onEnabled", "onCredentialsChanged", "onDelete", "accountSettings"].forEach(function (name) {
            serviceMethods["/" + name] = function (p, reply) {
                var m;
                try { m = service(); } catch (e) { return reply(fail(-1, String(e.message || e))); }
                m[name](p).then(reply, function (e) { reply(fail("UNKNOWN_ERROR", String(e && e.message || e))); });
            };
        });
        serviceMethods["/sync"] = function (p, reply) {
            var key = lockKey(p.accountId);
            var held = store.get(key, 0);
            if (held && Date.now() - held < LOCK_MS) return reply(ok({ alreadyRunning: true }));
            store.set(key, Date.now());
            var m;
            try { m = service(); } catch (e) { store.set(key, 0); return reply(fail(-1, String(e.message || e))); }
            m.sync(p).then(function (r) {
                store.set(key, 0);
                reply(r);
            }, function (e) {
                store.set(key, 0);
                reply(fail("UNKNOWN_ERROR", String(e && e.message || e)));
            });
        };
        register([SERVICE], serviceMethods);

        // ---- db8 kinds ----------------------------------------------------------------------

        (function installKinds() {
            var VERSION = 1;
            if (store.get("davKinds", 0) >= VERSION) return;
            [["com.palm.contact.dav:1", ["com.palm.contact:1"]],
             ["com.palm.calendar.dav:1", ["com.palm.calendar:1"]],
             ["com.palm.calendarevent.dav:1", ["com.palm.calendarevent:1"]],
             ["org.webosphoenix.dav.account:1", []],
             ["org.webosphoenix.dav.collection:1", []],
             ["org.webosphoenix.dav.item:1", []]].forEach(function (k) {
                callNow("palm://com.palm.db/putKind", { id: k[0], owner: SERVICE, extends: k[1] });
            });
            callNow("palm://com.palm.tempdb/putKind", { id: "com.palm.account.syncstate:1", owner: "com.palm.service.accounts" });
            store.set("davKinds", VERSION);
        })();

        // ---- Accounts: the template, its accounts and their callbacks ------------------------

        var templateCache = null;
        function templates() {
            if (templateCache) return clone(templateCache);
            var list = [];
            DAV_TEMPLATES.forEach(function (file) {
                var text = PalmSystem.getResource(file), t;
                if (!text) return;
                try { t = JSON.parse(text); } catch (e) { console.warn("[phoenix-runtime] bad account template " + file); return; }
                var dir = file.slice(0, file.lastIndexOf("/") + 1);
                var abs = function (icons) {
                    Object.keys(icons || {}).forEach(function (k) { if (icons[k].charAt(0) !== "/") icons[k] = dir + icons[k]; });
                };
                (Array.isArray(t) ? t : [t]).forEach(function (x) {
                    abs(x.icon);
                    (x.capabilityProviders || []).forEach(function (cp) { abs(cp.icon); });
                    list.push(x);
                });
            });
            templateCache = list;
            return clone(list);
        }
        function templateFor(id) { return templates().filter(function (t) { return t.templateId === id; })[0]; }
        function isDav(templateId) { return !!templateFor(templateId); }

        // Account.annotate (app-services models/account-model.js), as the block above.
        function annotate(account) {
            var template = templateFor(account.templateId);
            if (!template) return null;
            var result = template, subset = account.capabilityProviders || [];
            for (var k in account) result[k] = account[k];
            result.capabilityProviders = subset.map(function (c) {
                var t = (template.capabilityProviders || []).filter(function (tc) { return tc.id === c.id; })[0] || {};
                var out = {};
                for (var k2 in c) out[k2] = c[k2];
                for (k2 in t) out[k2] = t[k2];
                return out;
            });
            return result;
        }

        function getAccount(id) { return (callNow("palm://com.palm.db/get", { ids: [id] }).results || [])[0]; }

        function providersFor(template, requested) {
            var seen = {};
            return (requested || []).map(function (r) {
                var t = (template.capabilityProviders || []).filter(function (c) { return c.id === r.id; })[0];
                if (!t || seen[t.id]) return null;
                seen[t.id] = true;
                return { id: t.id, capability: t.capability };
            }).filter(Boolean);
        }

        // Calls one callback per provider, one after another; failures are logged.
        function notify(calls) {
            return calls.reduce(function (p, c) {
                return p.then(function () {
                    return luna.call(c.address, c.params).then(function (r) {
                        if (!r || r.returnValue === false) console.warn("[phoenix-runtime] " + c.address + " failed: " + toJson(r));
                    });
                });
            }, Promise.resolve());
        }

        function callbacks(template, providerIds, prop, params) {
            return (template.capabilityProviders || []).filter(function (cp) {
                return providerIds.indexOf(cp.id) >= 0 && cp[prop];
            }).map(function (cp) {
                var p = clone(params);
                if (prop === "onEnabled") p.capabilityProviderId = cp.id;
                return { address: cp[prop], params: p };
            });
        }

        // One call per distinct address (the providers share one service).
        function unique(calls) {
            var seen = {};
            return calls.filter(function (c) {
                if (seen[c.address]) return false;
                seen[c.address] = true;
                return true;
            });
        }

        var accounts = runtime.services["com.palm.service.accounts"];
        var original = {};
        ["listAccountTemplates", "listAccounts", "listAccountsPublic", "getAccountInfo", "createAccount",
         "modifyAccount", "deleteAccount"].forEach(function (m) { original[m] = accounts["/" + m]; });

        accounts["/listAccountTemplates"] = function (p, reply, ctx) {
            original.listAccountTemplates(p, function (r) {
                if (!r.returnValue) return reply(r);
                var caps = p.capability === undefined ? null : [].concat(p.capability);
                var extra = templates().filter(function (t) {
                    return !caps || (t.capabilityProviders || []).some(function (c) { return caps.indexOf(c.capability) >= 0; });
                });
                var all = (r.results || []).concat(extra);
                all.sort(function (a, b) {
                    return (a.loc_name || "").toLocaleUpperCase().localeCompare((b.loc_name || "").toLocaleUpperCase());
                });
                reply(ok({ results: all }));
            }, ctx);
        };

        function listWithDav(name) {
            return function (p, reply, ctx) {
                original[name](p, function (r) {
                    if (!r.returnValue) return reply(r);
                    var where = [{ prop: "beingDeleted", op: "=", val: false }];
                    if (p.templateId) where.push({ prop: "templateId", op: "=", val: p.templateId });
                    else if (p.capability) where.push({ prop: "capabilityProviders.capability", op: "=", val: p.capability });
                    var mine = (callNow("palm://com.palm.db/find", { query: { from: ACCOUNT_KIND, where: where } }).results || [])
                        .filter(function (a) { return isDav(a.templateId); }).map(annotate).filter(Boolean);
                    reply(ok({ results: (r.results || []).concat(mine) }));
                }, ctx);
            };
        }
        accounts["/listAccounts"] = listWithDav("listAccounts");
        accounts["/listAccountsPublic"] = listWithDav("listAccountsPublic");

        accounts["/getAccountInfo"] = function (p, reply, ctx) {
            var a = getAccount(p.accountId);
            if (a && isDav(a.templateId)) return reply(ok({ result: annotate(a) }));
            original.getAccountInfo(p, reply, ctx);
        };

        // handlers/create.js and notify-created.js.
        accounts["/createAccount"] = function (p, reply, ctx) {
            var template = templateFor(p.templateId);
            if (!template) return original.createAccount(p, reply, ctx);
            if (!p.username) return reply(fail(-1, "missing username"));
            var dup = callNow("palm://com.palm.db/find", { query: { from: ACCOUNT_KIND, where: [
                { prop: "beingDeleted", op: "=", val: false }, { prop: "templateId", op: "=", val: p.templateId },
                { prop: "username", op: "=", val: p.username }] } });
            if ((dup.results || []).length)
                return reply({ returnValue: false, errorCode: "DUPLICATE_ACCOUNT", errorText: "Unable to create a duplicate account" });
            var account = { _kind: ACCOUNT_KIND, templateId: p.templateId, username: p.username, alias: p.alias,
                            beingDeleted: false, capabilityProviders: providersFor(template, p.capabilityProviders) };
            var put = callNow("palm://com.palm.db/put", { objects: [account] });
            account._id = put.results[0].id;
            account._rev = put.results[0].rev;
            var creds = p.credentials || (p.password ? { common: { password: p.password } } : null);
            if (creds) callNow("palm://com.palm.service.accounts/writeCredentials", { accountId: account._id, credentials: creds });
            reply(ok({ result: account }));
            var ids = account.capabilityProviders.map(function (c) { return c.id; });
            setTimeout(function () {
                notify(unique(callbacks(template, ids, "onCreate", { accountId: account._id, config: p.config })))
                    .then(function () { return notify(callbacks(template, ids, "onEnabled", { accountId: account._id, enabled: true })); });
            }, 500);
        };

        // handlers/modify.js: capabilities switched on and off, new credentials.
        accounts["/modifyAccount"] = function (p, reply, ctx) {
            var account = getAccount(p.accountId);
            if (!account || !isDav(account.templateId)) return original.modifyAccount(p, reply, ctx);
            var template = templateFor(account.templateId);
            var changes = p.object || {};
            var before = (account.capabilityProviders || []).map(function (c) { return c.id; });
            var merge = { _id: account._id };
            if (changes.username !== undefined) merge.username = changes.username;
            if (changes.alias !== undefined) merge.alias = changes.alias;
            if (changes.capabilityProviders) merge.capabilityProviders = providersFor(template, changes.capabilityProviders);
            callNow("palm://com.palm.db/merge", { objects: [merge] });
            if (changes.credentials)
                callNow("palm://com.palm.service.accounts/writeCredentials", { accountId: account._id, credentials: changes.credentials });
            reply(ok({}));
            var calls = [];
            if (merge.capabilityProviders) {
                var after = merge.capabilityProviders.map(function (c) { return c.id; });
                calls = calls.concat(callbacks(template, after.filter(function (id) { return before.indexOf(id) < 0; }),
                                               "onEnabled", { accountId: account._id, enabled: true }));
                calls = calls.concat(callbacks(template, before.filter(function (id) { return after.indexOf(id) < 0; }),
                                               "onEnabled", { accountId: account._id, enabled: false }));
            }
            if (changes.credentials) {
                var now = (getAccount(account._id).capabilityProviders || []).map(function (c) { return c.id; });
                calls = calls.concat(unique(callbacks(template, now, "onCredentialsChanged", { accountId: account._id })));
            }
            notify(calls);
        };

        // handlers/delete.js and notify-deleted.js.
        accounts["/deleteAccount"] = function (p, reply, ctx) {
            var account = getAccount(p.accountId);
            if (!account || account.beingDeleted || !isDav(account.templateId)) return original.deleteAccount(p, reply, ctx);
            var template = templateFor(account.templateId);
            var ids = (account.capabilityProviders || []).map(function (c) { return c.id; });
            var all = (template.capabilityProviders || []).map(function (c) { return c.id; });
            notify(callbacks(template, ids, "onEnabled", { accountId: account._id, enabled: false }))
                .then(function () { return notify(unique(callbacks(template, all, "onDelete", { accountId: account._id }))); })
                .then(function () { original.deleteAccount(p, reply, ctx); });
        };

        runtime.dav = {
            service: service,
            templates: templates,
            sync: function (accountId) { return luna.call("palm://" + SERVICE + "/sync", { accountId: accountId }); }
        };
    })();


    // ================================================================================
    // Backup and restore (org.webosphoenix.service.backup; apps/settings/service)
    // ================================================================================
    //
    // Like the DAV transport above, this runs the device's own service
    // (apps/settings/service/backupservice.js and lib/, loaded from
    // /usr/palm/services/org.webosphoenix.service.backup/) and gives it what
    // service.js gives it on a device:
    //
    //   participants  the registrations in /etc/palm/backup/ (read by name:
    //                 the simulator cannot list a folder): db8's and the
    //                 shell's (apps/settings/service/etc/palm/backup/) and
    //                 luna-sysservice's (compat/rootfs)
    //   temp          runtime.tmpFiles, in this page's memory
    //   usb           the USB drive, through org.webosphoenix.filemanager
    //   crypto        WebCrypto (PBKDF2-SHA256, AES-256-GCM)
    //   config        the shared store ("backup:config"); on a device a file
    //                 only the service can read
    //
    // and the participants a device has that the simulator does not:
    //
    //   com.webos.service.systemservice backup/preBackup, backup/postRestore
    //       (luna-sysservice Src/BackupManager.cpp): the preferences listed
    //       in /etc/palm/sysservice-backupkeys.json, as one file
    //       (systemprefs_backup.db there, JSON here), merged back on restore
    //   com.palm.sysMgrDataBackup preBackup, postRestore (luna-sysmgr
    //       Src/base/BackupManager.cpp): the launcher's layout, which the
    //       shell owns; it tells the pages (applyHostStatus {launcherLayout})
    //       and gets it back with a "launcherLayout" host message
    //
    // db8's internal/preBackup and internal/postRestore are in its block.
    // The daily activity has an interval schedule, which the simulated
    // activity manager does not run (no background process); "scheduled"
    // can be called directly.
    (function backupService() {
        var SERVICE = "org.webosphoenix.service.backup";
        var SERVICE_DIR = "/usr/palm/services/" + SERVICE + "/";
        var REGISTRATIONS = ["com.palm.db.backupRegistration.json", "com.palm.sysMgrDataBackup.backupRegistration.json",
                             "com.webos.service.systemservice.backupRegistration.json"];
        var luna = nodeServiceLuna();
        var fm = "luna://org.webosphoenix.filemanager/";

        // ---- The participants the simulator stands in for ------------------------------

        var sys = runtime.services["com.webos.service.systemservice"];
        function backupKeys() {
            try { return JSON.parse(PalmSystem.getResource("/etc/palm/sysservice-backupkeys.json") || "[]"); }
            catch (e) { return []; }
        }
        sys["/backup/preBackup"] = function (p, reply) {
            var dir = String(p.tempDir || "/tmp").replace(/\/$/, "");
            var all = prefs(), out = {};
            backupKeys().forEach(function (k) { if (k in all) out[k] = all[k]; });
            var file = dir + "/systemprefs_backup.db";
            runtime.tmpFiles.write(file, toJson(out));
            reply(ok({ description: "Backup of LunaSysService, containing the systemprefs sqlite3 database", version: "1.0", files: [file] }));
        };
        sys["/backup/postRestore"] = function (p, reply) {
            if (typeof p.tempDir !== "string" || !Array.isArray(p.files)) return reply(fail(-1, "tempDir and files are required"));
            var merged = {};
            p.files.forEach(function (f) {
                var path = f.charAt(0) === "/" ? f : p.tempDir.replace(/\/$/, "") + "/" + f;
                if (path.indexOf("systemprefs_backup.db") < 0) return;
                var saved;
                try { saved = JSON.parse(runtime.tmpFiles.readText(path)); } catch (e) { return; }
                // Only the keys that are backed up, as PrefsDb::merge.
                backupKeys().forEach(function (k) { if (k in saved) merged[k] = saved[k]; });
            });
            if (Object.keys(merged).length) dispatch("luna://com.webos.service.systemservice/setPreferences", merged, function () {}, { cancelled: function () { return false; } });
            reply(ok());
        };

        register(["com.palm.sysMgrDataBackup"], {
            "/preBackup": function (p, reply) {
                var files = [], layout = store.get("shell:launcherLayout", "");
                if (layout) {
                    var file = String(p.tempDir || "/tmp").replace(/\/$/, "") + "/launcher-layout.json";
                    runtime.tmpFiles.write(file, layout);
                    files.push(file);
                }
                reply(ok({ description: "Backup of LunaSysMgr files for launcher, quicklaunch and dockmode", version: "1.0", files: files }));
            },
            "/postRestore": function (p, reply) {
                if (!Array.isArray(p.files)) return reply(fail(-1, "files is required"));
                p.files.forEach(function (f) {
                    if (!/launcher-layout\.json$/.test(f)) return;
                    var path = f.charAt(0) === "/" ? f : String(p.tempDir || p.dir).replace(/\/$/, "") + "/" + f;
                    var json = runtime.tmpFiles.readText(path);
                    store.set("shell:launcherLayout", json);
                    host.postToHost("launcherLayout", { json: json });
                });
                reply(ok());
            }
        });

        // ---- What service.js gives the service on a device -------------------------------

        var subtle = global.crypto && global.crypto.subtle;
        var webCrypto = {
            randomBytes: function (n) { return Promise.resolve(global.crypto.getRandomValues(new Uint8Array(n))); },
            deriveKey: function (passphrase, salt, iterations) {
                return subtle.importKey("raw", new TextEncoder().encode(String(passphrase)), "PBKDF2", false, ["deriveBits"]).then(function (k) {
                    return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations }, k, 256);
                }).then(function (bits) { return new Uint8Array(bits); });
            },
            encrypt: function (key, iv, plaintext, aad) {
                return subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]).then(function (k) {
                    return subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad }, k, plaintext);
                }).then(function (ct) { return new Uint8Array(ct); });
            },
            decrypt: function (key, iv, data, aad) {
                return subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]).then(function (k) {
                    return subtle.decrypt({ name: "AES-GCM", iv: iv, additionalData: aad }, k, data);
                }).then(function (pt) { return new Uint8Array(pt); });
            },
            exportKey: function (key) { return Promise.resolve(archiveLib().toBase64(key)); },
            importKey: function (text) { return Promise.resolve(archiveLib().fromBase64(text)); }
        };

        function fmCall(method, params) {
            return luna.call(fm + method, params).then(function (r) {
                if (r.returnValue === false) {
                    var e = new Error(r.errorText || method + " failed");
                    // The file manager's codes (its E table): 1 not found, 7 too large.
                    e.code = r.errorCode === 1 ? "NOT_FOUND" : r.errorCode === 7 ? "NO_SPACE" : "UNKNOWN_ERROR";
                    throw e;
                }
                return r;
            });
        }
        var usb = {
            list: function (dir) {
                return luna.call(fm + "list", { path: dir }).then(function (r) {
                    return r.returnValue === false ? [] : (r.entries || []).filter(function (f) {
                        return f.type === "file";
                    }).map(function (f) { return { name: f.name, size: f.size || 0, modified: f.mtime ? new Date(f.mtime).toISOString() : null }; });
                });
            },
            read: function (path) { return fmCall("read", { path: path, encoding: "utf8" }).then(function (r) { return r.data; }); },
            write: function (path, text) { return fmCall("write", { path: path, data: text, overwrite: true }); },
            remove: function (path) { return luna.call(fm + "remove", { path: path }); },
            mkdir: function (dir) {
                return luna.call(fm + "stat", { path: dir }).then(function (r) {
                    if (r.returnValue === false) return fmCall("mkdir", { path: dir });
                });
            }
        };

        var loadModule = nodeServiceLoader(SERVICE_DIR, "Backup service");
        function archiveLib() { return loadModule("lib/archive.js"); }
        var methods = null;
        function service() {
            if (!methods) {
                methods = loadModule("backupservice.js").createBackupService({
                    luna: luna,
                    request: proxiedRequest,
                    crypto: webCrypto,
                    config: {
                        load: function () { return store.get("backup:config", null); },
                        save: function (o) { store.set("backup:config", o); }
                    },
                    temp: {
                        make: function () { return "/tmp/phoenix-backup-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
                        read: function (path) { return runtime.tmpFiles.read(path); },
                        write: function (path, data) { runtime.tmpFiles.write(path, data); },
                        remove: function (dir) { runtime.tmpFiles.remove(dir); }
                    },
                    usb: usb,
                    participants: function () {
                        return REGISTRATIONS.map(function (name) {
                            try { return JSON.parse(PalmSystem.getResource("/etc/palm/backup/" + name) || "null"); }
                            catch (e) { return null; }
                        }).filter(Boolean);
                    },
                    log: function (m) { console.info("[backup] " + m); }
                });
            }
            return methods;
        }

        // ---- The service on the simulated bus ---------------------------------------------
        //
        // The service's state (idle, backing up, restoring) is this page's;
        // its settings and its last result are shared. A subscriber hears of
        // changes another page makes through the store.

        var names;
        try { names = loadModule("backupservice.js").METHODS; }
        catch (e) { return; }   // no rootfs behind the page (the runtime's unit tests)
        var serviceMethods = {};
        names.forEach(function (name) {
            serviceMethods["/" + name] = function (p, reply, ctx) {
                var m;
                try { m = service(); } catch (e) { return reply(fail("UNKNOWN_ERROR", String(e.message || e))); }
                var push = null;
                if (name === "getStatus" && p.subscribe) {
                    push = function (st) {
                        if (ctx.cancelled()) { m.unwatch(push); return; }
                        reply(st);
                    };
                }
                m[name](p, push).then(reply, function (e) { reply(fail("UNKNOWN_ERROR", String(e && e.message || e))); });
            };
        });
        register([SERVICE], serviceMethods);
        runtime.backup = { service: service };
    })();


    // ================================================================================
    // Installing apps (com.webos.appInstallService; legacy com.palm.appinstaller)
    // ================================================================================
    //
    // OSE's installer (appinstalld2; API reference "com.webos.appInstallService"):
    //
    //   install {id, ipkUrl, subscribe}   ipkUrl: an absolute path to the
    //       .ipk; subscribers get {id, statusValue, details: {state,
    //       packageId, progress, errorCode, reason}}: 11 "need to install",
    //       13 "installing", 30 "installed"; 24 "install failed"
    //   remove {id, subscribe}            31 "removed"; 25 "remove failed";
    //       -2 "No such id"
    //   status {subscribe}                {status: {apps: [details]}}, then
    //       each change
    //
    // Here the package is read in the page (lib/ipk.js of the Marketplace's
    // service) and its app's files go to the shell: phoenix-sim writes them
    // to its installed-apps folder (SimInstaller, "installApp" host message);
    // tools/serve-rootfs.py to its own (POST /__phoenix/installer). The app
    // list is read again everywhere (applyHostStatus {appsVersion};
    // launchPointChanges). Only the app's own folder is installed: packages
    // with services, maintainer scripts or files elsewhere are refused (the
    // Marketplace does not offer them either).
    //
    // The legacy installer (Files' .ipk sheet), installNoVerify {target}, is
    // the same with legacy status strings (STARTING, IPKG_INSTALL, SUCCESS,
    // FAILED_IPKG_INSTALL).
    (function appInstaller() {
        var PACKAGES_DIR = "/usr/palm/services/org.webosphoenix.service.packages/";
        var loadModule = nodeServiceLoader(PACKAGES_DIR, "Packages service");
        var luna = nodeServiceLuna();
        var ipkReader = null;
        var browserGzip = {
            gunzip: function (bytes) { return streamBytes(bytes, new DecompressionStream("gzip")); },
            gzip: function (bytes) { return streamBytes(bytes, new CompressionStream("gzip")); }
        };
        function streamBytes(bytes, transform) {
            var out = new Response(bytes).body.pipeThrough(transform);
            return new Response(out).arrayBuffer().then(function (b) { return new Uint8Array(b); });
        }
        function ipk() {
            if (!ipkReader) ipkReader = loadModule("lib/ipk.js").createIpk({ gzip: browserGzip });
            return ipkReader;
        }
        runtime.ipk = ipk;
        runtime.browserGzip = browserGzip;

        function b64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return btoa(s);
        }
        function unb64(text) {
            var s = atob(text), out = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
            return out;
        }

        // The package's bytes: a /tmp file (a download) or a file on the device.
        function readPackage(path) {
            try { return Promise.resolve(runtime.tmpFiles.read(path)); } catch (e) { /* not a /tmp file */ }
            return luna.call("luna://org.webosphoenix.filemanager/read", { path: path, encoding: "base64" }).then(function (r) {
                if (r.returnValue === false) throw Object.assign(new Error(r.errorText || "Cannot read " + path), { code: "NOT_FOUND" });
                return unb64(r.data);
            });
        }

        // ---- The shell's side ----------------------------------------------------------

        var pending = {}, lastAppsVersion = -1;
        var baseApply = runtime.applyHostStatus;
        runtime.applyHostStatus = function (st) {
            if (st && st.installerResult && pending[st.installerResult.requestId]) {
                var cb = pending[st.installerResult.requestId];
                delete pending[st.installerResult.requestId];
                cb(st.installerResult);
            }
            if (st && typeof st.appsVersion === "number" && st.appsVersion !== lastAppsVersion) {
                var first = lastAppsVersion < 0;
                lastAppsVersion = st.appsVersion;
                if (!first || st.appsVersion > 0) appsChanged();
            }
            baseApply(st);
        };
        function hostInstall(op, appId, files) {
            launchPoints();   // the list before, for launchPointChanges
            if (/^https?:$/.test(global.location.protocol)) {
                return fetch("/__phoenix/installer", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: toJson({ op: op, appId: appId, files: files || [] })
                }).then(function (res) { return res.json(); }).then(function (r) {
                    if (r.ok) appsChanged();
                    return r;
                });
            }
            return new Promise(function (resolve) {
                var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                var timer = setTimeout(function () {
                    delete pending[id];
                    resolve({ ok: false, error: "The shell did not answer" });
                }, 60000);
                pending[id] = function (r) { clearTimeout(timer); resolve(r); };
                host.postToHost(op === "install" ? "installApp" : "removeApp", { requestId: id, appId: appId, files: files || [] });
            });
        }

        // ---- Install and remove ---------------------------------------------------------

        var statuses = {}, statusWatchers = [];
        function report(id, statusValue, details, each) {
            var d = Object.assign({ packageId: id }, details || {});
            statuses[id] = d;
            var msg = ok({ id: id, statusValue: statusValue, details: d });
            if (each) each(msg);
            statusWatchers = statusWatchers.filter(function (w) { return w(msg) !== false; });
            if (/^(installed|install failed|removed|remove failed)$/.test(d.state)) delete statuses[id];
        }

        // -> Promise<{appId, version, skipped}>; rejects with an Error (code, message).
        // developer: Developer Mode is on and the caller asked for it: a
        // package with install scripts, services or files outside its app
        // installs its app; the rest is skipped here (the simulator cannot
        // run scripts or a 2011 service) and listed in `skipped`.
        function installPackage(id, path, each, developer) {
            report(id || "", 11, { state: "install needed", ipkUrl: path }, each);
            return readPackage(path).then(function (bytes) {
                return ipk().read(bytes);
            }).then(function (pkg) {
                var app = pkg.apps[0];
                if (!app) throw Object.assign(new Error("The package has no app"), { code: "NO_APP" });
                if (id && app.id !== id) throw Object.assign(new Error("The package is " + app.id + ", not " + id), { code: "WRONG_ID" });
                id = app.id;
                var outside = pkg.files.filter(function (f) { return f.path.indexOf(app.dir) !== 0; });
                var dev = !!developer && store.get("devMode", false);
                var skipped = [];
                if (pkg.scripts.length) {
                    if (!dev) throw Object.assign(new Error("Packages with install scripts need Developer Mode"), { code: "SCRIPTS" });
                    skipped.push("install scripts (" + pkg.scripts.join(", ") + ")");
                }
                if (pkg.apps.length > 1)
                    throw Object.assign(new Error("Only packages of one app are supported"), { code: "UNSUPPORTED" });
                if (outside.length || pkg.services.length) {
                    if (!dev) throw Object.assign(new Error("Only packages of one app are supported without Developer Mode (this one also has " +
                        (outside[0] ? outside[0].path : "services") + ")"), { code: "UNSUPPORTED" });
                    // services: the files under usr/palm/services/<id>/.
                    var serviceIds = {};
                    pkg.services.forEach(function (f) { serviceIds[String(f).split("/")[3]] = true; });
                    var ids = Object.keys(serviceIds);
                    if (ids.length) skipped.push("services (" + ids.join(", ") + ")");
                    var others = outside.filter(function (f) { return pkg.services.indexOf(f.path) < 0; });
                    if (others.length) skipped.push(others.length + " files outside the app");
                }
                report(id, 13, { state: "installing", ipkUrl: path }, each);
                var files = pkg.files.map(function (f) { return { path: f.path.slice(app.dir.length), data: b64(f.data) }; });
                return hostInstall("install", id, files).then(function (r) {
                    if (!r.ok) throw Object.assign(new Error(r.error || "Install failed"), { code: "HOST" });
                    report(id, 30, { state: "installed", installBasePath: "/media/cryptofs/apps", skipped: skipped }, each);
                    return { appId: id, version: app.appinfo.version || pkg.control.Version || "", skipped: skipped };
                });
            }).then(null, function (e) {
                report(id || "", 24, { state: "install failed", errorCode: -1, reason: e.message }, each);
                throw e;
            });
        }
        runtime.installPackage = installPackage;

        function installed(id) {
            return launchPoints().some(function (lp) { return lp.id === id && lp.removable; });
        }
        function removeApp(id, each) {
            if (!installed(id)) return Promise.reject(Object.assign(new Error("No such id"), { code: -2 }));
            report(id, 41, { state: "remove needed" }, each);
            return hostInstall("remove", id).then(function (r) {
                if (!r.ok) {
                    report(id, 25, { state: "remove failed", reason: r.error }, each);
                    throw Object.assign(new Error(r.error || "Remove failed"), { code: -7 });
                }
                report(id, 31, { state: "removed" }, each);
            });
        }
        runtime.removeApp = removeApp;

        register(["com.webos.appInstallService"], {
            "/install": function (p, reply, ctx) {
                if (!p.id) return reply(fail(-2, "id is empty"));
                if (!p.ipkUrl) return reply(fail(-2, "ipkUrl is empty"));
                if (typeof p.ipkUrl !== "string" || p.ipkUrl.charAt(0) !== "/") return reply(fail(-2, "invalid ipkUrl"));
                reply(ok({ subscribed: !!p.subscribe }));
                var each = p.subscribe ? function (m) { if (!ctx.cancelled()) reply(m); } : null;
                // developerMode (Phoenix): the Marketplace asks for it in Developer Mode.
                installPackage(p.id, p.ipkUrl, each, !!p.developerMode).then(null, function () { /* reported */ });
            },
            "/remove": function (p, reply, ctx) {
                if (!p.id) return reply(fail(-2, "id is empty"));
                if (!installed(p.id)) return reply(fail(-2, "No such id"));
                reply(ok({ subscribed: !!p.subscribe }));
                var each = p.subscribe ? function (m) { if (!ctx.cancelled()) reply(m); } : null;
                removeApp(p.id, each).then(null, function () { /* reported */ });
            },
            "/status": function (p, reply, ctx) {
                reply(ok({ subscribed: !!p.subscribe, status: { apps: Object.keys(statuses).map(function (k) { return statuses[k]; }) } }));
                if (p.subscribe) statusWatchers.push(function (m) {
                    if (ctx.cancelled()) return false;
                    reply(m);
                    return true;
                });
            }
        });

        // Legacy webOS (Files' .ipk sheet; luna-sysmgr ApplicationInstaller.cpp).
        var ticket = 0;
        function legacyInstall(p, reply, ctx) {
            var path = String(p.target || "").replace(/^file:\/\//, "");
            if (!path) return reply(fail(-1, "target is required"));
            // A missing target is an error reply (the file manager's code), as before.
            luna.call("luna://org.webosphoenix.filemanager/stat", { path: path }).then(function (st) {
                if (st.returnValue === false && !/^\/tmp\//.test(path))
                    return reply(fail(st.errorCode, "No such package: " + path));
                var t = ++ticket;
                var send = function (status, extra) {
                    if (!ctx.cancelled() || status === "STARTING") reply(ok(Object.assign({ ticket: t, status: status }, extra || {})));
                };
                send("STARTING");
                installPackage(null, path, function (m) {
                    if (m.details.state === "installing") send("IPKG_INSTALL");
                }).then(function (r) {
                    send("SUCCESS", { appId: r.appId });
                }, function (e) {
                    send("FAILED_IPKG_INSTALL", { details: { reason: e.message } });
                });
            });
        }
        register(["com.palm.appinstaller"], {
            "/installNoVerify": legacyInstall,
            "/install": legacyInstall,
            "/remove": function (p, reply) {
                removeApp(p.packageName || p.id).then(function () { reply(ok()); }, function (e) { reply(fail(-1, e.message)); });
            },
            "/isInstalled": function (p, reply) { reply(ok({ installed: launchPoints().some(function (lp) { return lp.id === (p.appId || p.packageName); }) })); }
        });
    })();


    // ================================================================================
    // Marketplace (org.webosphoenix.service.packages; apps/marketplace/service)
    // ================================================================================
    //
    // The device's own service (packagesservice.js and lib/, loaded from
    // /usr/palm/services/org.webosphoenix.service.packages/), given what
    // service.js gives it on a device: HTTP through the host's proxy (the
    // catalogs, web app manifests and icons, packages), WebCrypto for SHA-256
    // and SHA-512, gzip streams, /tmp in memory for the downloaded packages,
    // the default sources from /etc/palm/marketplace/sources.json, and its
    // state in the shared store ("marketplace:state"). It installs through
    // com.webos.appInstallService ("Installing apps" above).
    (function packagesService() {
        var SERVICE = "org.webosphoenix.service.packages";
        var loadModule = nodeServiceLoader("/usr/palm/services/" + SERVICE + "/", "Packages service");
        var subtle = global.crypto && global.crypto.subtle;
        function digest(alg) {
            return function (bytes) { return subtle.digest(alg, bytes).then(function (h) { return new Uint8Array(h); }); };
        }
        var methods = null;
        function service() {
            if (!methods) {
                methods = loadModule("packagesservice.js").createPackagesService({
                    luna: nodeServiceLuna(),
                    request: proxiedRequest,
                    requestBytes: proxiedRequestBytes,
                    crypto: { sha256: digest("SHA-256"), sha512: digest("SHA-512") },
                    gzip: runtime.browserGzip,
                    state: {
                        load: function () { return store.get("marketplace:state", null); },
                        save: function (o) { store.set("marketplace:state", o); }
                    },
                    temp: {
                        write: function (name, bytes) {
                            var path = "/tmp/marketplace/" + name;
                            runtime.tmpFiles.write(path, bytes);
                            return path;
                        },
                        remove: function (path) { runtime.tmpFiles.remove(path); }
                    },
                    defaultSources: function () {
                        try { return JSON.parse(PalmSystem.getResource("/etc/palm/marketplace/sources.json") || "{}").sources || []; }
                        catch (e) { return []; }
                    },
                    log: function (m) { console.info("[marketplace] " + m); }
                });
            }
            return methods;
        }

        var names;
        try { names = loadModule("packagesservice.js").METHODS; }
        catch (e) { return; }   // no rootfs behind the page (the runtime's unit tests)
        var serviceMethods = {};
        names.forEach(function (name) {
            serviceMethods["/" + name] = function (p, reply, ctx) {
                var m;
                try { m = service(); } catch (e) { return reply(fail("UNKNOWN_ERROR", String(e.message || e))); }
                if (name === "install" && p.subscribe) {
                    // Progress as it goes; the last reply says installed or failed.
                    reply(ok({ subscribed: true, id: p.id, state: "queued" }));
                    m.install(p, function (st) { if (!ctx.cancelled()) reply(st); });
                    return;
                }
                m[name](p).then(reply, function (e) { reply(fail("UNKNOWN_ERROR", String(e && e.message || e))); });
            };
        });
        register([SERVICE], serviceMethods);
    })();

    // ================================================================================
    // Ongoing activities (org.webosphoenix.ongoing; the shell's)
    // ================================================================================
    //
    // Work going on in the background, a download or an install, shown in
    // the notification area with its progress until it ends; a tap opens
    // the app. (Later they move to the Live Activities pane: docs/ROADMAP.md.)
    //
    //   set {id, appId?, title, body?, icon? (relative to the app), progress
    //        (0-100, -1: none), params? (the app's launch params on a tap)}
    //   clear {id}
    //
    // The shell keys them by id, so whichever page calls updates one item.
    register(["org.webosphoenix.ongoing"], {
        "/set": function (p, reply) {
            if (!p.id || !p.title) return reply(fail(-1, "id and title are required"));
            host.postToHost("ongoing", { id: String(p.id), appId: p.appId || PalmSystem.appIdentifier, title: String(p.title),
                body: p.body ? String(p.body) : "", icon: p.icon || "", params: p.params || null,
                progress: typeof p.progress === "number" ? p.progress : -1 });
            reply(ok());
        },
        "/clear": function (p, reply) {
            if (!p.id) return reply(fail(-1, "id is required"));
            host.postToHost("ongoing", { id: String(p.id), clear: true });
            reply(ok());
        }
    });

    // ================================================================================
    // System updates (com.palm.update; services/updates)
    // ================================================================================
    //
    // The device's own service (updatesservice.js, loaded from
    // /usr/palm/services/com.palm.update/) over a simulated RAUC: two slots
    // in the shared store ("updates:slots"), the running one's version is
    // what osInfo/query says (webos_release, webos_build_id). A bundle here is
    // the simulator's stand-in for a RAUC bundle: only its manifest, as text
    // ("[update]" compatible=phoenix-sim, version=, build=;
    // server/updates/bin/publish.php --simulator makes one). Installing writes
    // the version to the other slot; com.palm.power/shutdown/machineReboot
    // then starts the primary slot (phoenix-sim restarts itself; a browser
    // page reloads).
    //
    // The service's work runs in the page that asked (Settings); what it says
    // to GetStatus subscribers (luna-systemui's alerts) reaches every page
    // through the store ("updates:palm"), as one service process would.
    (function systemUpdates() {
        var DIR = "/usr/palm/services/com.palm.update/";
        var SLOTS = "updates:slots";
        var loadModule = nodeServiceLoader(DIR, "Updates service");

        function slots() {
            var st = store.get(SLOTS, null);
            if (!st) st = { compatible: "phoenix-sim", booted: "rootfs.0", primary: "rootfs.0",
                            slots: { "rootfs.0": { version: "0.1.0", build: 1 }, "rootfs.1": null } };
            return st;
        }
        function otherOf(st) { return st.booted === "rootfs.0" ? "rootfs.1" : "rootfs.0"; }
        runtime.updateSlots = {
            get: slots,
            booted: function () { var st = slots(); return st.slots[st.booted]; },
            // The restart: the bootloader starts the primary slot.
            boot: function () {
                var st = slots();
                if (st.slots[st.primary]) st.booted = st.primary;
                else st.primary = st.booted;
                store.set(SLOTS, st);
            },
            set: function (st) { store.set(SLOTS, st); }
        };

        function manifest(bytes) {
            var text = new TextDecoder().decode(bytes), m = {}, section = "";
            text.split("\n").forEach(function (line) {
                line = line.trim();
                var sec = /^\[(.+)\]$/.exec(line), kv = /^([a-z]+)=(.*)$/.exec(line);
                if (sec) section = sec[1];
                else if (kv && section === "update") m[kv[1]] = kv[2];
            });
            if (!m.compatible || !m.version || !/^\d+$/.test(m.build || ""))
                throw new Error("bundle is not a valid RAUC bundle");
            return { compatible: m.compatible, version: m.version, build: parseInt(m.build, 10) };
        }
        var rauc = {
            status: function () {
                var st = slots(), b = st.slots[st.booted];
                return Promise.resolve({ compatible: st.compatible, name: "webOS Phoenix", primary: st.primary, other: otherOf(st),
                                         booted: { slot: st.booted, version: b.version, build: b.build } });
            },
            info: function (file) {
                return new Promise(function (resolve) { resolve(manifest(runtime.tmpFiles.read(file))); });
            },
            install: function (file, onProgress) {
                return rauc.info(file).then(function (m) {
                    var st = slots();
                    if (m.compatible !== st.compatible) throw new Error("Compatible mismatch");
                    var steps = [0, 20, 40, 60, 80, 100];
                    return steps.reduce(function (p, pct) {
                        return p.then(function () {
                            onProgress(pct, pct < 100 ? "Copying image to " + otherOf(st) : "Installing done.");
                            return new Promise(function (r) { setTimeout(r, 150); });
                        });
                    }, Promise.resolve()).then(function () {
                        var st2 = slots();
                        st2.slots[otherOf(st2)] = { version: m.version, build: m.build };
                        st2.primary = otherOf(st2);
                        store.set(SLOTS, st2);
                    });
                });
            },
            markActive: function (slot) {
                var st = slots();
                st.primary = slot === "booted" ? st.booted : slot === "other" ? otherOf(st) : slot;
                store.set(SLOTS, st);
                return Promise.resolve();
            }
        };

        var subtle = global.crypto && global.crypto.subtle;
        function hex(buf) {
            return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
        }

        var methods = null, palmSubs = [], statusSubs = [], seq = 0;
        function service() {
            if (methods) return methods;
            methods = loadModule("updatesservice.js").createUpdatesService({
                rauc: rauc,
                request: proxiedRequest,
                download: function (url, file, onProgress) {
                    var cancelled = false;
                    var promise = proxiedRequestBytes({ method: "GET", url: url }).then(function (r) {
                        if (cancelled) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
                        if (r.status !== 200) throw new Error("the server answered " + r.status);
                        onProgress(r.bytes.length);
                        runtime.tmpFiles.write(file, r.bytes);
                        return subtle.digest("SHA-256", r.bytes).then(function (h) { return { size: r.bytes.length, sha256: hex(h) }; });
                    });
                    return { promise: promise, cancel: function () { cancelled = true; } };
                },
                files: {
                    path: function (name) { return "/tmp/updates/" + name; },
                    exists: function (file) { try { runtime.tmpFiles.read(file); return true; } catch (e) { return false; } },
                    remove: function (file) { try { runtime.tmpFiles.remove(file); } catch (e) { /* gone */ } }
                },
                power: function () {
                    var p = store.get("power", { percent: 76, charger: "none" });
                    return Promise.resolve({ percent: p.percent, charging: p.charger !== "none" });
                },
                luna: nodeServiceLuna(),
                // /etc/palm/updates.json; "updates:config" in the store
                // stands for an edited one (tools/test-updates.cjs).
                config: function () {
                    var c;
                    try { c = JSON.parse(PalmSystem.getResource(DIR + "etc/palm/updates.json") || "{}"); }
                    catch (e) { c = {}; }
                    return Object.assign(c, store.get("updates:config", {}));
                },
                state: {
                    load: function () { return store.get("updates:state", null); },
                    save: function (o) { store.set("updates:state", o); }
                },
                log: function (m) { console.info("[updates] " + m); }
            });
            // What this page's service says goes to every page's subscribers.
            methods.watchPalm(function (r) {
                store.set("updates:palm", { seq: Date.now() + "." + (++seq), reply: r });
                palmSubs.forEach(function (w) { w(r); });
            });
            methods.watch(function (st) { statusSubs.forEach(function (w) { w(st); }); });
            return methods;
        }
        global.addEventListener && global.addEventListener("storage", function (e) {
            if (e.key !== "phoenix:updates:palm" || !e.newValue) return;
            var ev;
            try { ev = JSON.parse(e.newValue); } catch (x) { return; }
            if (ev && ev.reply) palmSubs.forEach(function (w) { w(ev.reply); });
        });

        var names;
        try { names = loadModule("updatesservice.js").METHODS; }
        catch (e) { return; }   // no rootfs behind the page (the runtime's unit tests)
        var serviceMethods = {};
        names.forEach(function (name) {
            serviceMethods["/" + name] = function (p, reply, ctx) {
                var m;
                try { m = service(); } catch (e) { return reply(fail("UNKNOWN_ERROR", String(e.message || e))); }
                m[name](p).then(function (r) {
                    var subs = name === "GetStatus" ? palmSubs : name === "getStatus" ? statusSubs : null;
                    if (subs && p.subscribe && r.returnValue) {
                        r.subscribed = true;
                        var w = function (x) {
                            if (ctx.cancelled()) { subs.splice(subs.indexOf(w), 1); return; }
                            reply(x);
                        };
                        subs.push(w);
                    }
                    reply(r);
                });
            };
        });
        register(["com.palm.update"], serviceMethods);

        // The restart.
        var power = runtime.services["com.palm.power"];
        if (power) power["/shutdown/machineReboot"] = function (p, reply) {
            reply(ok());
            runtime.updateSlots.boot();
            setTimeout(function () {
                if (/^https?:$/.test(global.location.protocol)) global.location.reload();
                else host.postToHost("reboot", { reason: p.reason || "" });
            }, 0);
        };
    })();

    // ================================================================================
    // Share sheet and save picker (org.webosphoenix.share, org.webosphoenix.filepicker)
    // ================================================================================
    //
    // docs/SHARE-AND-FILES.md. One sheet and one picker for every app: the
    // system's own page (org.webosphoenix.sharesheet, apps/sharesheet) laid
    // over the calling app's card, as the original's file picker was
    // (luna-systemui's, in a CrossAppUI frame). Changing the page changes it
    // in every app.
    //
    //   org.webosphoenix.share/open {title?, text?, url?, files?: [{path,
    //       mimeType?}]} -> {action: "app" (appId), "photos" | "files" (path),
    //       "copy" or "cancel"}. Sharing to an app launches it with
    //       {share: {title, text, url, files}} (or the params a legacy app
    //       takes, below).
    //   org.webosphoenix.share/targets {types: [mime]} -> {targets: [{appId,
    //       title, icon, label}]}: the apps whose appinfo.json says they take
    //       all of these types ("phoenix": {"shareTargets": [{"types":
    //       ["image/*"], "label"?}]}), and the legacy apps below.
    //   org.webosphoenix.filepicker/save {name, from?: path, data?: base64,
    //       mimeType?, title?} -> {path} or {canceled: true}: the user picks a
    //       folder of /media/internal (the last one used first) and a name;
    //       the file is written there (copied from `from`, or from `data`).
    //
    // The page talks to the runtime of the page under it with postMessage.
    (function shareSheet() {
        var doc = global.document;
        if (!doc) return;
        var SHEET_APP = "org.webosphoenix.sharesheet";
        var SHEET_URL = "/usr/palm/applications/" + SHEET_APP + "/index.html";
        var MEDIA = "/media/internal";
        var CAMERA_DIR = MEDIA + "/DCIM/100PHNX";
        var LAST_FOLDER = "filepicker:lastFolder";

        // Legacy apps that cannot say it in their appinfo.json: what they take.
        var LEGACY_TARGETS = {
            "com.palm.app.email": { types: ["*/*"], label: "Email", params: function (s) {
                var text = [s.text, s.url].filter(Boolean).join("\n");
                var p = {};
                if (s.files && s.files.length) p.attachments = s.files.map(function (f) { return { fullPath: f.path, mimeType: f.mimeType || "" }; });
                if (s.title) p.summary = s.title;
                if (text) p.text = text;
                return p;
            } }
        };

        function callP(url, params) {
            return new Promise(function (resolve) {
                dispatch(url, params || {}, resolve, { cancelled: function () { return false; }, onCancel: null });
            });
        }
        function mimeMatches(pattern, type) {
            if (pattern === "*/*" || pattern === type) return true;
            return /\/\*$/.test(pattern) && type.indexOf(pattern.slice(0, -1)) === 0;
        }
        function shareTypes(s) {
            var t = (s.files || []).map(function (f) { return f.mimeType || "application/octet-stream"; });
            if (s.text) t.push("text/plain");
            if (s.url) t.push("text/uri-list");
            return t;
        }
        function targetsFor(types) {
            var out = [];
            launchPoints().forEach(function (lp) {
                if (lp.launchPointId !== lp.id + "_default") return;
                var decl = (lp.shareTargets || []).slice();
                if (LEGACY_TARGETS[lp.id]) decl.push(LEGACY_TARGETS[lp.id]);
                for (var i = 0; i < decl.length; ++i) {
                    var d = decl[i], pats = d.types || [];
                    var takes = types.length > 0 && types.every(function (t) { return pats.some(function (p) { return mimeMatches(p, t); }); });
                    if (takes) {
                        out.push({ appId: lp.id, title: lp.title, icon: lp.icon, label: d.label || lp.title });
                        break;
                    }
                }
            });
            out.sort(function (a, b) { return a.label.localeCompare(b.label); });
            return out;
        }
        function launchParams(appId, s) {
            var legacy = LEGACY_TARGETS[appId];
            var share = { title: s.title || "", text: s.text || "", url: s.url || "", files: s.files || [] };
            return legacy ? legacy.params(share) : { share: share };
        }

        // ---- The overlay -----------------------------------------------------------------

        var open = null;     // {frame, id, resolve, request}
        var seq = 0;
        function closeSheet(result) {
            if (!open) return;
            var o = open;
            open = null;
            global.removeEventListener("message", onMessage);
            if (o.frame.parentNode) o.frame.parentNode.removeChild(o.frame);
            try { if (o.focus && o.focus.focus) o.focus.focus(); } catch (e) { /* gone */ }
            o.resolve(result);
        }
        function onMessage(e) {
            var m = e.data;
            if (!open || !m || m.phoenixSheet !== open.id) return;
            if (m.type === "ready") open.frame.contentWindow.postMessage({ phoenixSheet: open.id, type: "request", request: open.request }, "*");
            else if (m.type === "leaving") open.frame.style.background = "rgba(0, 0, 0, 0)";
            else if (m.type === "done") closeSheet(m.result || { action: "cancel" });
        }
        function showSheet(kind, request) {
            if (open) closeSheet({ action: "cancel" });
            return new Promise(function (resolve) {
                var id = "sheet" + (++seq) + "_" + Date.now();
                var frame = doc.createElement("iframe");
                frame.setAttribute("data-phoenix-sheet", kind);
                frame.setAttribute("title", kind === "save" ? "Save to Files" : "Share");
                frame.src = SHEET_URL + "?launchParams=" + encodeURIComponent(toJson({ kind: kind, id: id }));
                var st = frame.style;
                st.position = "fixed"; st.left = "0"; st.top = "0"; st.width = "100%"; st.height = "100%";
                st.border = "0"; st.margin = "0"; st.padding = "0"; st.zIndex = "2147483647";
                // The dimming is this page's (the frame's own background): the
                // sheet's page has nothing see-through but its art, which
                // every web engine composites the same.
                st.background = "rgba(0, 0, 0, 0)";
                st.transition = "background-color 0.2s ease-out";
                frame.setAttribute("allowtransparency", "true");
                frame.addEventListener("load", function () { st.background = "rgba(0, 0, 0, 0.45)"; });
                open = { frame: frame, id: id, resolve: resolve, request: request, focus: doc.activeElement };
                global.addEventListener("message", onMessage);
                (doc.body || doc.documentElement).appendChild(frame);
                try { frame.focus(); } catch (e) { /* ignore */ }
            });
        }
        // The back gesture closes the sheet (or goes back inside it), not the app.
        var appBack = runtime.back;
        runtime.back = function () {
            if (open) {
                open.frame.contentWindow.postMessage({ phoenixSheet: open.id, type: "back" }, "*");
                return true;
            }
            return appBack.apply(this, arguments);
        };
        runtime.sheetOpen = function () { return !!open; };

        // ---- Writing a file -------------------------------------------------------------

        function writeTo(dest, req, overwrite) {
            var mf = runtime.mediaFiles;
            var before = overwrite ? callP("luna://org.webosphoenix.filemanager/remove", { path: dest }) : Promise.resolve();
            return before.then(function () {
                if (req.data !== undefined) {
                    if (!mf) throw new Error("No media store");
                    var bin = atob(String(req.data).replace(/^data:[^,]*,/, "")), bytes = new Uint8Array(bin.length);
                    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    return mf.write(dest, new Blob([bytes], { type: req.mimeType || "application/octet-stream" }));
                }
                return callP("luna://org.webosphoenix.filemanager/copy", { from: req.from, to: dest, overwrite: !!overwrite }).then(function (r) {
                    if (r.returnValue !== false) return;
                    // Not one of the user's files (a sample, a file of the
                    // system image): its bytes, from where the system serves it.
                    if (!mf || !global.fetch) throw new Error(r.errorText || "Could not copy");
                    return global.fetch(req.from).then(function (res) {
                        if (!res.ok) throw new Error(r.errorText || "Could not copy");
                        return res.blob();
                    }).then(function (blob) { return mf.write(dest, blob); });
                });
            }).then(function () {
                // Pictures and videos show up in Photos, everything in Files.
                return callP("luna://org.webosphoenix.filemanager/stat", { path: dest });
            }).then(function () {
                return callP("luna://com.webos.service.mediaindexer/requestMediaScan", { path: dest.replace(/\/[^\/]*$/, "") });
            });
        }

        function save(req) {
            return showSheet("save", { name: req.name || "Untitled", title: req.title || "Save to Files",
                                       folder: store.get(LAST_FOLDER, MEDIA + "/Documents") }).then(function (r) {
                if (!r || r.action !== "save" || !r.folder) return { canceled: true };
                var dest = r.folder.replace(/\/$/, "") + "/" + r.name;
                store.set(LAST_FOLDER, r.folder);
                return writeTo(dest, req, !!r.overwrite).then(function () { return { path: dest }; });
            });
        }

        function inPhotos(path) {
            return /^\/media\/internal\//.test(path) && !/\/\./.test(path) && /\.(jpe?g|png|gif|webp|bmp|heic|mp4|m4v|mov|webm)$/i.test(path);
        }

        register(["org.webosphoenix.share"], {
            "/open": function (p, reply) {
                var files = (p.files || []).filter(function (f) { return f && f.path; }).map(function (f) {
                    return { path: String(f.path), mimeType: f.mimeType || "" };
                });
                if (!files.length && !p.text && !p.url) return reply(fail(-1, "Nothing to share: files, text or url"));
                var s = { title: p.title || "", text: p.text || "", url: p.url || "", files: files };
                showSheet("share", { share: s, targets: targetsFor(shareTypes(s)) }).then(function (r) {
                    r = r || { action: "cancel" };
                    if (r.action === "app") {
                        host.postToHost("launch", { id: r.appId, params: launchParams(r.appId, s) });
                        return reply(ok({ action: "app", appId: r.appId }));
                    }
                    if (r.action === "photos") {
                        var f = s.files[0];
                        if (inPhotos(f.path) && f.path.indexOf(MEDIA + "/samples/") !== 0)
                            return reply(ok({ action: "photos", path: f.path, already: true }));
                        var dest = CAMERA_DIR + "/" + f.path.replace(/^.*\//, "");
                        return writeTo(dest, { from: f.path }, false).then(function () {
                            reply(ok({ action: "photos", path: dest }));
                        }, function (e) { reply(fail(-1, String(e && e.message || e))); });
                    }
                    if (r.action === "files") {
                        var src = s.files[0];
                        return save({ name: src.path.replace(/^.*\//, ""), from: src.path }).then(function (sv) {
                            reply(sv.canceled ? ok({ action: "cancel" }) : ok({ action: "files", path: sv.path }));
                        }, function (e) { reply(fail(-1, String(e && e.message || e))); });
                    }
                    reply(ok({ action: r.action || "cancel" }));
                });
            },
            "/targets": function (p, reply) {
                reply(ok({ targets: targetsFor(p.types || []) }));
            }
        });

        register(["org.webosphoenix.filepicker"], {
            "/save": function (p, reply) {
                if (!p.name) return reply(fail(-1, "name is required"));
                if (p.data === undefined && !p.from) return reply(fail(-1, "from (a path) or data (base64) is required"));
                save(p).then(function (r) { reply(ok(r)); }, function (e) { reply(fail(-1, String(e && e.message || e))); });
            }
        });
    })();

    // ================================================================================
    // Torch (org.webosports.service.torch; apps/flashlight)
    // ================================================================================
    //
    // org.webosports.service.torch is LuneOS's torchd
    // (github.com/webOS-ports/org.webosports.service.torch, Apache-2.0), which
    // Phoenix uses unchanged on a device: it opens nyx's NYX_DEVICE_LED
    // "Torch" module (LuneOS nyx-modules src/led_torch), i.e. the camera
    // flash LED through the kernel LED class (/sys/class/leds/*torch*/
    // brightness, or qcom's current + switch nodes, or MediaTek's
    // /dev/flashlight). Same requests and replies here:
    //
    //   getStatus {subscribe?} -> {available, on, brightness (0-100)}; with
    //       subscribe, again after every change from any page
    //   set {on} | {brightness: 0-100} -> the new status (brightness wins)
    //   toggle {} -> the new status
    //
    // The simulated LED lives in the shared store, so every page sees one
    // torch. __phoenixRuntime.torch.setAvailable(false) makes a device
    // without one (a TouchPad): getStatus says available: false and set
    // fails with torchd's "no torch on this device".
    (function torch() {
        var TORCH_KEY = "torch";
        function torchState() {
            var st = store.get(TORCH_KEY, null) || {};
            return { available: st.available !== false, brightness: Math.max(0, Math.min(100, st.brightness | 0)) };
        }
        function torchStatus(st) {
            return ok({ available: st.available, on: st.available && st.brightness > 0, brightness: st.available ? st.brightness : 0 });
        }
        var torchWatchers = [];
        function torchNotify() {
            var st = torchState();
            torchWatchers = torchWatchers.filter(function (w) { return !w.ctx.cancelled(); });
            torchWatchers.forEach(function (w) { w.reply(torchStatus(st)); });
        }
        function torchSet(brightness) {
            var st = torchState();
            st.brightness = brightness;
            store.set(TORCH_KEY, st);
            torchNotify();
            return st;
        }
        // A change made in another page (another app's card).
        global.addEventListener && global.addEventListener("storage", function (e) {
            if (e.key === "phoenix:" + TORCH_KEY) torchNotify();
        });

        register(["org.webosports.service.torch"], {
            "/getStatus": function (p, reply, ctx) {
                var r = torchStatus(torchState());
                if (p.subscribe) {
                    r.subscribed = true;
                    torchWatchers.push({ reply: reply, ctx: ctx });
                }
                reply(r);
            },
            // torchd's cb_set: brightness wins over on; out of range is an error.
            "/set": function (p, reply) {
                var b = -1;
                if (typeof p.brightness === "number") b = Math.round(p.brightness);
                else if (typeof p.on === "boolean") b = p.on ? 100 : 0;
                if (b < 0 || b > 100) return reply({ returnValue: false, errorText: "need \"on\": boolean, or \"brightness\": 0-100" });
                if (!torchState().available) return reply({ returnValue: false, errorText: "no torch on this device" });
                reply(torchStatus(torchSet(b)));
            },
            "/toggle": function (p, reply) {
                var st = torchState();
                if (!st.available) return reply({ returnValue: false, errorText: "no torch on this device" });
                reply(torchStatus(torchSet(st.brightness > 0 ? 0 : 100)));
            }
        });

        runtime.torch = {
            state: function () {
                var st = torchState();
                return { available: st.available, on: st.available && st.brightness > 0, brightness: st.brightness };
            },
            setAvailable: function (available) {
                var st = torchState();
                st.available = !!available;
                if (!available) st.brightness = 0;
                store.set(TORCH_KEY, st);
                torchNotify();
            }
        };
    })();

    // ================================================================================
    // Terminal (org.webosphoenix.pty; apps/terminal)
    // ================================================================================
    //
    // The Terminal's shells. On a device this is the C++ Luna service in
    // services/pty (docs/TERMINAL.md); here the same methods, replies and
    // error codes (PTY_ERRORS in apps/shared/luna/src/pty.ts) come from one of
    // three places, whichever the host offers in /usr/share/phoenix/host.json:
    //
    //   {"pty": "host"}         phoenix-sim: a real shell on this computer
    //                           (shell/sim/simpty.cpp). Requests go out as
    //                           "pty" host messages; replies come back
    //                           through __phoenixRuntime.ptyEvent({id, reply}).
    //   {"pty": "websocket", "url": "ws://127.0.0.1:.../__phoenix/pty?token=..."}
    //                           tools/serve-rootfs.py --terminal: a real shell
    //                           over a WebSocket per session (Python's pty).
    //   anything else           a tiny simulated shell, below (echo, ls of the
    //                           simulated filesystem, cd, pwd, clear, exit,
    //                           ...), so the app and its tests run anywhere
    //                           and always the same.
    //
    //   open {cols, rows, shell?, cwd?, subscribe: true}
    //        -> {subscribed: true, sessionId, pid, shell, shellPath, host?}
    //        -> {sessionId, output, encoding?: "latin1", bytes} ...
    //        -> {sessionId, exited: true, exitCode, signal}
    //        cancelling the subscription hangs the shell up
    //   write {sessionId, data}, resize {sessionId, cols, rows},
    //   ack {sessionId, bytes}, close {sessionId, signal?}, list {},
    //   getShells {} -> {shells: [{name, path, installed}], default},
    //   exec -> DEVMODE_REQUIRED (Developer Mode is a follow-up)
    //
    // Only org.webosphoenix.terminal may open a shell. (phoenix-sim checks
    // that again on its side, against the window the message came from.)
    (function terminalServices() {
        var APP_ID = "org.webosphoenix.terminal";
        var E = { BAD_PARAMS: -1, NOT_ALLOWED: 1, NO_SESSION: 2, SPAWN_FAILED: 3, NO_SHELL: 4, TOO_MANY: 5, DEVMODE_REQUIRED: 6 };
        var SHELLS = ["bash", "zsh", "fish", "sh"];
        var SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

        var hostInfo = null;
        function host_() {
            if (hostInfo === null) {
                try { hostInfo = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/host.json") || "{}") || {}; }
                catch (e) { hostInfo = {}; }
            }
            return hostInfo;
        }
        function mode() {
            var h = host_();
            if (h.pty === "host") return "host";
            if (h.pty === "websocket" && h.url && typeof global.WebSocket === "function") return "websocket";
            return "simulated";
        }

        var sessions = {};   // sessionId -> {reply, ctx, transport}
        var nextId = 1;

        function mayOpen() { return PalmSystem.appIdentifier === APP_ID; }

        // ---- phoenix-sim: SimPty over host messages -----------------------------------
        var hostWaiting = {};   // id -> reply, for one-shot host requests (shells)
        runtime.ptyEvent = function (msg) {
            if (!msg || !msg.id) return;
            var one = hostWaiting[msg.id];
            if (one) { delete hostWaiting[msg.id]; one(msg.reply); return; }
            var s = sessions[msg.id];
            if (s) s.deliver(msg.reply);
        };
        function hostTransport(id, p, s) {
            host.postToHost("pty", { op: "open", id: id, cols: p.cols, rows: p.rows, shell: p.shell || "", cwd: p.cwd || "" });
            return {
                write: function (data) { host.postToHost("pty", { op: "write", id: id, data: data }); },
                resize: function (c, r) { host.postToHost("pty", { op: "resize", id: id, cols: c, rows: r }); },
                ack: function (n) { host.postToHost("pty", { op: "ack", id: id, bytes: n }); },
                close: function (signal, cancel) { host.postToHost("pty", { op: "close", id: id, signal: signal || "SIGHUP", cancel: !!cancel }); }
            };
        }

        // ---- serve-rootfs.py --terminal: a WebSocket per session -------------------------
        function wsTransport(id, p, s) {
            var ws, queue = [], open = false, gone = false;
            function send(m) {
                var t = toJson(m);
                if (open) ws.send(t); else queue.push(t);
            }
            try { ws = new global.WebSocket(host_().url); }
            catch (e) {
                setTimeout(function () { s.deliver(fail(E.SPAWN_FAILED, "Cannot reach the dev server's terminal: " + e)); }, 0);
                return { write: function () {}, resize: function () {}, ack: function () {}, close: function () {} };
            }
            ws.onopen = function () {
                open = true;
                ws.send(toJson({ op: "open", cols: p.cols, rows: p.rows, shell: p.shell || "", cwd: p.cwd || "" }));
                queue.forEach(function (t) { ws.send(t); });
                queue = [];
            };
            ws.onmessage = function (ev) {
                var r;
                try { r = JSON.parse(ev.data); } catch (e) { return; }
                if (r.returnValue !== false) r.sessionId = id;
                s.deliver(r);
            };
            ws.onclose = function () {
                if (gone) return;
                gone = true;
                if (sessions[id]) s.deliver({ returnValue: true, sessionId: id, exited: true, exitCode: -1, signal: 1 });
            };
            return {
                write: function (data) { send({ op: "write", data: data }); },
                resize: function (c, r) { send({ op: "resize", cols: c, rows: r }); },
                ack: function (n) { send({ op: "ack", bytes: n }); },
                close: function (signal, cancel) {
                    send({ op: "close", signal: signal || "SIGHUP" });
                    if (cancel) { gone = true; try { ws.close(); } catch (e) { /* ignore */ } }
                }
            };
        }

        // ---- The simulated shell --------------------------------------------------------
        // A few commands on the simulated filesystem, with line editing
        // (Backspace, Ctrl-U, Ctrl-C, Ctrl-D, Ctrl-L, Up/Down for history).
        var HOME = "/media/internal";
        function fakeShell(id, p, s) {
            var cwd = HOME, line = "", history = [], hist = 0, esc = null, done = false, cols = p.cols || 80;
            function out(text) {
                if (done) return;
                text = String(text);
                s.deliver(ok({ sessionId: id, output: text, bytes: text.length }));
            }
            function tilde(path) { return path === HOME ? "~" : path.indexOf(HOME + "/") === 0 ? "~" + path.slice(HOME.length) : path; }
            function prompt() { out("\x1b[1;32muser@phoenix\x1b[0m:\x1b[1;34m" + tilde(cwd) + "\x1b[0m$ "); }
            function resolve(arg) {
                if (!arg || arg === "~") return HOME;
                if (arg.indexOf("~/") === 0) arg = HOME + arg.slice(1);
                var parts = (arg.charAt(0) === "/" ? arg : cwd + "/" + arg).split("/"), outp = [];
                parts.forEach(function (x) {
                    if (!x || x === ".") return;
                    if (x === "..") outp.pop(); else outp.push(x);
                });
                return "/" + outp.join("/");
            }
            function fm(method, params) {
                return new Promise(function (res) {
                    dispatch("luna://org.webosphoenix.filemanager/" + method, params, res,
                             { cancelled: function () { return false; }, onCancel: null });
                });
            }
            function unescape(t) {
                return t.replace(/\\(e|a|n|t|\\|033|x1b)/g, function (m, c) {
                    return { e: "\x1b", "033": "\x1b", x1b: "\x1b", a: "\x07", n: "\n", t: "\t", "\\": "\\" }[c];
                });
            }
            function words(text) {
                var w = [], m, re = /"([^"]*)"|'([^']*)'|(\S+)/g;
                while ((m = re.exec(text))) w.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
                return w;
            }
            var commands = {
                help: function () {
                    out("Phoenix simulated shell: there is no real shell here (phoenix-sim --no-host-shell,\r\n" +
                        "or a browser without tools/serve-rootfs.py --terminal). Commands:\r\n" +
                        "  echo [-e] TEXT   ls [-a] [DIR]   cd [DIR]   pwd   clear   seq N\r\n" +
                        "  uname [-a]   whoami   printenv   history   exit [CODE]\r\n");
                },
                echo: function (a, raw) {
                    var e = a[0] === "-e";
                    var text = raw.replace(/^echo\s*/, "").replace(/^-e\s*/, "");
                    var w = words(text).join(" ");
                    out((e ? unescape(w) : w).replace(/\n/g, "\r\n") + "\r\n");
                },
                pwd: function () { out(cwd + "\r\n"); },
                whoami: function () { out("user\r\n"); },
                uname: function (a) { out(a[0] === "-a" ? "Linux phoenix 6.6.0-phoenix-sim #1 SMP webOS Phoenix simulated shell\r\n" : "Linux\r\n"); },
                printenv: function () { out("HOME=" + HOME + "\r\nSHELL=/bin/fsh\r\nTERM=xterm-256color\r\nUSER=user\r\nCOLUMNS=" + cols + "\r\n"); },
                history: function () { history.forEach(function (h, i) { out("  " + (i + 1) + "  " + h + "\r\n"); }); },
                clear: function () { out("\x1b[H\x1b[2J\x1b[3J"); },
                seq: function (a) {
                    var n = Math.min(parseInt(a[0], 10) || 0, 10000), t = "";
                    for (var i = 1; i <= n; ++i) t += i + "\r\n";
                    out(t);
                },
                cd: function (a) {
                    var dir = resolve(a[0]);
                    return fm("stat", { path: dir }).then(function (r) {
                        if (!r.returnValue) out("fsh: cd: " + a[0] + ": No such file or directory\r\n");
                        else if (r.entry.type !== "directory") out("fsh: cd: " + a[0] + ": Not a directory\r\n");
                        else cwd = dir;
                    });
                },
                ls: function (a) {
                    var all = a.indexOf("-a") >= 0 || a.indexOf("-la") >= 0 || a.indexOf("-al") >= 0;
                    var args = a.filter(function (x) { return x.charAt(0) !== "-"; });
                    var dir = resolve(args[0]);
                    return fm("list", { path: dir }).then(function (r) {
                        if (!r.returnValue) return out("ls: cannot access '" + (args[0] || dir) + "': No such file or directory\r\n");
                        var names = r.entries.filter(function (e) { return all || e.name.charAt(0) !== "."; })
                            .sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
                        if (!names.length) return;
                        var width = names.reduce(function (m, e) { return Math.max(m, e.name.length); }, 0) + 2;
                        var per = Math.max(1, Math.floor(cols / width)), t = "";
                        names.forEach(function (e, i) {
                            var pad = new Array(width - e.name.length + 1).join(" ");
                            t += (e.type === "directory" ? "\x1b[1;34m" + e.name + "\x1b[0m" : e.name);
                            t += (i % per === per - 1 || i === names.length - 1) ? "\r\n" : pad;
                        });
                        out(t);
                    });
                },
                exit: function (a) { finish(parseInt(a[0], 10) || 0, 0); }
            };
            function run(text) {
                var a = words(text), cmd = a.shift();
                if (!cmd) return Promise.resolve();
                if (!commands[cmd]) { out("fsh: " + cmd + ": command not found\r\n"); return Promise.resolve(); }
                return Promise.resolve(commands[cmd](a, text));
            }
            function finish(code, signal) {
                if (done) return;
                s.deliver(ok({ sessionId: id, exited: true, exitCode: code, signal: signal }));
                done = true;
            }
            function redraw(text) {
                out("\r\x1b[K");
                prompt();
                out(text);
                line = text;
            }
            var busy = Promise.resolve();
            function key(ch) {
                if (esc !== null) {
                    esc += ch;
                    // ESC [ ... final byte, or ESC and one more character (Alt).
                    if (esc.length === 1 && ch !== "[" && ch !== "O") { esc = null; return; }
                    if (esc.length > 1 && /[@-~]/.test(ch)) {
                        var seq = esc;
                        esc = null;
                        if (seq === "[A" || seq === "OA") { if (hist > 0) redraw(history[--hist]); }
                        else if (seq === "[B" || seq === "OB") { hist = Math.min(history.length, hist + 1); redraw(history[hist] || ""); }
                    }
                    return;
                }
                if (ch === "\x1b") { esc = ""; return; }
                if (ch === "\r" || ch === "\n") {
                    out("\r\n");
                    var text = line.trim();
                    line = "";
                    if (text) { history.push(text); }
                    hist = history.length;
                    busy = busy.then(function () { return run(text); }).then(function () { if (!done) prompt(); });
                } else if (ch === "\x7f" || ch === "\b") {
                    if (line) { line = line.slice(0, -1); out("\b \b"); }
                } else if (ch === "\x03") {
                    out("^C\r\n");
                    line = "";
                    prompt();
                } else if (ch === "\x04") {
                    if (!line) { out("exit\r\n"); finish(0, 0); }
                } else if (ch === "\x0c") {
                    out("\x1b[H\x1b[2J");
                    prompt();
                    out(line);
                } else if (ch === "\x15") {
                    redraw("");
                } else if (ch === "\t" || ch < " ") {
                    out("\x07");
                } else {
                    line += ch;
                    out(ch);
                }
            }
            setTimeout(function () {
                s.deliver(ok({ subscribed: true, sessionId: id, pid: 4242, shell: "fsh", shellPath: "(simulated)", host: false, simulated: true }));
                out("Phoenix simulated shell. Type \x1b[1mhelp\x1b[0m for its few commands.\r\n");
                prompt();
            }, 0);
            return {
                write: function (data) { for (var i = 0; i < data.length; ++i) key(data.charAt(i)); },
                resize: function (c) { cols = c; },
                ack: function () {},
                close: function (signal) { finish(-1, SIGNALS[signal || "SIGHUP"] || 1); }
            };
        }

        function session(id) {
            return sessions[id] && sessions[id].owner === PalmSystem.appIdentifier ? sessions[id] : null;
        }

        register(["org.webosphoenix.pty"], {
            "/open": function (p, reply, ctx) {
                if (!mayOpen()) return reply(fail(E.NOT_ALLOWED, "Only the Terminal app may open a shell"));
                if (!p.subscribe) return reply(fail(E.BAD_PARAMS, "open needs subscribe: true (the output comes as replies)"));
                if (p.shell && SHELLS.indexOf(p.shell) < 0) return reply(fail(E.NO_SHELL, "Shell not installed: " + p.shell));
                if (Object.keys(sessions).length >= 16) return reply(fail(E.TOO_MANY, "Too many sessions"));
                var cols = Math.max(1, Math.min(999, p.cols | 0 || 80)), rows = Math.max(1, Math.min(999, p.rows | 0 || 24));
                var id = "pty" + (nextId++) + "-" + Math.random().toString(16).slice(2, 10);
                var m = mode();
                var s = sessions[id] = { owner: PalmSystem.appIdentifier, shell: p.shell || "bash", pid: 0, transport: null };
                s.deliver = function (r) {
                    if (!sessions[id] || ctx.cancelled()) return;
                    if (r.subscribed) s.pid = r.pid;
                    if (r.returnValue === false || r.exited) delete sessions[id];
                    if (r.subscribed && m !== "simulated") r.host = true;
                    reply(r);
                };
                var q = { cols: cols, rows: rows, shell: p.shell, cwd: p.cwd };
                s.transport = m === "host" ? hostTransport(id, q, s) : m === "websocket" ? wsTransport(id, q, s) : fakeShell(id, q, s);
                ctx.onCancel = function () {
                    if (!sessions[id]) return;
                    delete sessions[id];
                    s.transport.close("SIGHUP", true);
                };
            },
            "/write": function (p, reply) {
                var s = session(p.sessionId);
                if (!s) return reply(fail(E.NO_SESSION, "No such session: " + p.sessionId));
                if (typeof p.data !== "string") return reply(fail(E.BAD_PARAMS, "data must be a string"));
                s.transport.write(p.data);
                reply(ok());
            },
            "/resize": function (p, reply) {
                var s = session(p.sessionId);
                if (!s) return reply(fail(E.NO_SESSION, "No such session: " + p.sessionId));
                if (!(p.cols >= 1 && p.cols <= 999 && p.rows >= 1 && p.rows <= 999)) return reply(fail(E.BAD_PARAMS, "cols and rows must be 1 to 999"));
                s.transport.resize(p.cols | 0, p.rows | 0);
                reply(ok());
            },
            "/ack": function (p, reply) {
                var s = session(p.sessionId);
                if (!s) return reply(fail(E.NO_SESSION, "No such session: " + p.sessionId));
                if (!(p.bytes >= 0)) return reply(fail(E.BAD_PARAMS, "bytes must be a number"));
                s.transport.ack(p.bytes);
                reply(ok());
            },
            "/close": function (p, reply) {
                var s = session(p.sessionId);
                if (!s) return reply(fail(E.NO_SESSION, "No such session: " + p.sessionId));
                if (p.signal && !SIGNALS[p.signal]) return reply(fail(E.BAD_PARAMS, "signal must be SIGHUP, SIGTERM, SIGKILL or SIGINT"));
                s.transport.close(p.signal || "SIGHUP", false);
                reply(ok());
            },
            "/list": function (p, reply) {
                reply(ok({ sessions: Object.keys(sessions).filter(function (k) { return sessions[k].owner === PalmSystem.appIdentifier; })
                    .map(function (k) { return { sessionId: k, pid: sessions[k].pid, shell: sessions[k].shell }; }) }));
            },
            "/getShells": function (p, reply) {
                var m = mode();
                if (m === "host") {
                    var id = "shells" + (nextId++);
                    hostWaiting[id] = function (r) { r.mode = "host"; reply(r); };
                    host.postToHost("pty", { op: "shells", id: id });
                    return;
                }
                if (m === "websocket" && global.fetch) {
                    var url = host_().url.replace(/^ws/, "http").replace(/\/__phoenix\/pty\?/, "/__phoenix/pty/shells?");
                    global.fetch(url).then(function (r) { return r.json(); }).then(function (r) { r.mode = "websocket"; reply(r); },
                        function (e) { reply(fail(E.SPAWN_FAILED, String(e))); });
                    return;
                }
                // The simulated shell stands in for all of them.
                reply(ok({ default: "bash", mode: "simulated", shells: SHELLS.map(function (n) { return { name: n, path: "", installed: false }; }) }));
            },
            "/exec": function (p, reply) {
                reply(fail(E.DEVMODE_REQUIRED, "Developer Mode is not available yet: exec, sudo and SSH are a follow-up (docs/TERMINAL.md, T4)"));
            }
        });

        // A page that goes hangs its shells up, as the device service does
        // when its subscriptions are cancelled.
        if (global.addEventListener) {
            global.addEventListener("pagehide", function () {
                Object.keys(sessions).forEach(function (id) {
                    var s = sessions[id];
                    delete sessions[id];
                    try { s.transport.close("SIGHUP", true); } catch (e) { /* ignore */ }
                });
            });
        }

        runtime.pty = { mode: mode, errors: E, sessions: function () { return Object.keys(sessions); } };
    })();
    // ================================================================================
    // First use, emergency information, location and help (apps/firstuse,
    // apps/settings, apps/phone, apps/help)
    // ================================================================================
    //
    // System preferences (com.webos.service.systemservice get/setPreferences;
    // luna-sysservice's PrefsFactory stores any key):
    //   firstUseComplete   First Use has run (or was skipped). The shell starts
    //                      First Use at boot until it is set.
    //   emergencyInfo      the medical ID Settings > Emergency Info keeps and
    //                      the lock screen's emergency window shows: {name,
    //                      birthDate, bloodType, conditions, allergies,
    //                      medications, notes, organDonor, contacts: [{personId,
    //                      name, number, relation}], showWhenLocked}
    //   accessibility      Settings > Accessibility: {reduceMotion,
    //                      highContrast, monoAudio, captions}
    //
    // com.palm.systemmanager (legacy webOS, luna-sysmgr SystemService.cpp):
    //   getBootStatus {subscribe}  -> {finished, firstUse}: firstUse while the
    //                      shell runs First Use (its minimal UI), as the
    //                      shell last said (applyHostStatus {firstUse})
    //   subscribeToSystemUI {subscribe}  events for luna-systemui, which it
    //                      turns into popup alerts (data/SystemManagerService.js):
    //                      here only "registerForLocationServiceNotifications"
    //                      {appId}, its location permission alert
    //
    // com.webos.service.location (webOS OSE; also answered as the legacy
    // com.palm.location). Method and field names follow the OSE service as
    // LuneOS found it on devices (luneos-components' LunaService mock:
    // "Handler" with a capital H, the gps and network handlers) and the
    // legacy com.palm.location API:
    //   getAllLocationHandlers {subscribe}  -> {handlers: [{name, state}]}
    //   getState {Handler, subscribe}  -> {state}
    //   setState {Handler, state}      (errorCode 10 "Invalid input" without Handler)
    //   getCurrentPosition {Handler?, maximumAge?, responseTime?}
    //       -> {errorCode: 0, latitude, longitude, altitude, horizAccuracy,
    //           vertAccuracy, direction, velocity, speed, timestamp (s)}
    //   getLocationUpdates / startTracking {subscribe, minimumInterval (ms)}
    //   getReverseLocation {latitude, longitude} -> {address, locality, region,
    //       country, countryCode} (from a small built-in list of cities)
    //   errorCodes (the legacy API's): 1 timeout, 2 position unavailable,
    //       5 location services off, 6 permission denied
    //   Legacy luna-systemui's LocationAlert answers with com.palm.location
    //   acceptLocationRequest / acceptAlwaysLocationRequest /
    //   rejectLocationRequest / ignoreLocationRequest {appId | url}.
    //
    // org.webosphoenix.service.location (Phoenix): which apps may have the
    // position. OSE has no per-app location permission; on a device this
    // is a Phoenix service in front of com.webos.service.location.
    //   getPermissions {subscribe}  -> {permissions: [{appId, title, allowed, time, lastUsed}]}
    //   setPermission {appId, allowed}, removePermission {appId}
    //
    // An app with no answer yet asks the user through luna-systemui's own
    // location alert (above); with no system UI running (a desktop browser)
    // the simulator allows it and lists it in Settings. The system apps
    // (Just Type, the system UI, Settings, First Use) never ask.
    //
    // navigator.geolocation is answered from the same simulated service, so
    // web apps using the W3C API get the same position and permission.
    //
    // Help (apps/help): the Help app's topics are put into db8
    // (org.webosphoenix.helptopic:1, from its help-index.json) when Just Type,
    // the system UI or Help starts, so Just Type's content search finds them.
    (function systemSetup() {
        var sys = runtime.services["com.webos.service.systemservice"];
        var sm = runtime.services["com.palm.systemmanager"];
        var setPrefs = sys["/setPreferences"];

        defaultPrefs.firstUseComplete = false;
        defaultPrefs.emergencyInfo = {};
        defaultPrefs.accessibility = { reduceMotion: false, highContrast: false, monoAudio: false, captions: false };

        var nobody = { cancelled: function () { return false; } };
        function setPreferences(p) { setPrefs(p, function () {}, nobody); }

        // Every page's subscribers, re-run when this page or another changes the store.
        var watchers = [];
        var notifying = false, again = false;
        function changed() {
            // Watchers may change the store themselves: run again after, not inside.
            if (notifying) { again = true; return; }
            notifying = true;
            try {
                do {
                    again = false;
                    var list = watchers;
                    watchers = [];
                    var keep = list.filter(function (w) { return w(); });
                    watchers = keep.concat(watchers);
                } while (again);
            } finally {
                notifying = false;
            }
        }
        function watch(p, reply, ctx, compute) {
            var last = toJson(compute());
            var first = JSON.parse(last);
            if (p.subscribe) first.subscribed = true;
            reply(first);
            if (!p.subscribe) return;
            watchers.push(function () {
                if (ctx.cancelled()) return false;
                var now = toJson(compute());
                if (now !== last) {
                    last = now;
                    var r = JSON.parse(now);
                    r.subscribed = true;
                    reply(r);
                }
                return true;
            });
        }
        var WATCHED = ["phoenix:shell:firstUse", "phoenix:location:state", "phoenix:location:permissions",
                       "phoenix:systemui:events", "phoenix:location:ignored", "phoenix:settings:state"];
        try {
            global.addEventListener("storage", function (e) {
                if (WATCHED.indexOf(e.key) >= 0) changed();
            });
        } catch (e) { /* ignore */ }

        // ---- Accessibility: high contrast on every page -------------------------------

        function applyContrast() {
            var a = prefs().accessibility || {};
            var root = global.document && global.document.documentElement;
            if (!root || !root.classList) return true;
            root.classList.toggle("phoenix-high-contrast", !!a.highContrast);
            return true;
        }
        applyContrast();
        watchers.push(applyContrast);
        try {
            global.addEventListener("storage", function (e) { if (e.key === "phoenix:prefs") applyContrast(); });
        } catch (e) { /* ignore */ }
        var setPrefsNow = sys["/setPreferences"];
        sys["/setPreferences"] = function (p, reply, ctx) {
            setPrefsNow(p, reply, ctx);
            if ("accessibility" in p) applyContrast();
        };

        // ---- First use (getBootStatus) ------------------------------------------

        sm["/getBootStatus"] = function (p, reply, ctx) {
            watch(p, reply, ctx, function () { return ok({ finished: true, firstUse: !!store.get("shell:firstUse", false) }); });
        };
        var baseApply = runtime.applyHostStatus;
        runtime.applyHostStatus = function (st) {
            // The launcher's layout, as the shell keeps it: what
            // com.palm.sysMgrDataBackup backs up (see "Backup").
            if (st && typeof st.launcherLayout === "string")
                store.set("shell:launcherLayout", st.launcherLayout);
            if (st && "firstUse" in st && !!st.firstUse !== !!store.get("shell:firstUse", false)) {
                store.set("shell:firstUse", !!st.firstUse);
                changed();
            }
            baseApply(st);
        };

        // ---- System UI events (subscribeToSystemUI) ---------------------------------

        var LISTENING = "systemui:listening";
        function systemUiListening() {
            return Date.now() - store.get(LISTENING, 0) < 30000;
        }
        function postSystemUi(event, message) {
            var q = store.get("systemui:events", []).filter(function (e) { return Date.now() - e.time < 60000; });
            q.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), time: Date.now(), event: event, message: message });
            store.set("systemui:events", q);
            changed();
        }
        sm["/subscribeToSystemUI"] = function (p, reply, ctx) {
            reply(ok({ subscribed: !!p.subscribe }));
            if (!p.subscribe) return;
            var since = Date.now(), seen = {};
            var beat = function () { store.set(LISTENING, Date.now()); };
            beat();
            var timer = setInterval(beat, 10000);
            try {
                global.addEventListener("beforeunload", function () { store.set(LISTENING, 0); });
            } catch (e) { /* ignore */ }
            watchers.push(function () {
                if (ctx.cancelled()) {
                    clearInterval(timer);
                    return false;
                }
                store.get("systemui:events", []).forEach(function (e) {
                    if (e.time < since - 1000 || seen[e.id]) return;
                    seen[e.id] = true;
                    reply(ok({ event: e.event, message: e.message }));
                });
                return true;
            });
        };

        // publishToSystemUI {event, message}: another service's event for the
        // system UI (luna-sysmgr SystemService.cpp cbPublishToSystemUI), e.g.
        // the backup service's "subscribeToBackupStatus".
        sm["/publishToSystemUI"] = function (p, reply) {
            if (!p.event) return reply(fail(-1, "event is required"));
            postSystemUi(String(p.event), p.message === undefined ? {} : p.message);
            reply(ok());
        };

        // ---- Location ---------------------------------------------------------------

        // Palm's old headquarters, 950 W. Maude Ave., Sunnyvale.
        // Downtown San Jose: inside the demo map region Maps ships with
        // (apps/maps/public/regions/sample).
        var HOME = { latitude: 37.333700, longitude: -121.890700, altitude: 26 };
        var CITIES = [
            ["San Jose", "CA", "United States", "US", 37.3382, -121.8863],
            ["Sunnyvale", "CA", "United States", "US", 37.3688, -122.0363],
            ["San Francisco", "CA", "United States", "US", 37.7749, -122.4194],
            ["New York", "NY", "United States", "US", 40.7128, -74.0060],
            ["Seattle", "WA", "United States", "US", 47.6062, -122.3321],
            ["London", "England", "United Kingdom", "GB", 51.5074, -0.1278],
            ["Amsterdam", "North Holland", "Netherlands", "NL", 52.3676, 4.9041],
            ["Berlin", "Berlin", "Germany", "DE", 52.5200, 13.4050],
            ["Paris", "Ile-de-France", "France", "FR", 48.8566, 2.3522],
            ["Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.9780],
            ["Tokyo", "Tokyo", "Japan", "JP", 35.6762, 139.6503],
            ["Sydney", "NSW", "Australia", "AU", -33.8688, 151.2093]
        ];
        var TRUSTED = ["com.palm.launcher", "com.palm.systemui", "org.webosphoenix.settings", "org.webosphoenix.firstuse"];
        var LOC_ERR = { timeout: 1, unavailable: 2, off: 5, denied: 6 };

        function locState() {
            var s = store.get("location:state", null) || {};
            return {
                gps: s.gps !== false,
                network: s.network !== false,
                position: s.position || HOME,
                mock: !!s.mock,
                time: s.time || 0
            };
        }
        function saveLocState(s) {
            store.set("location:state", s);
            changed();
        }
        function handlers() {
            var s = locState();
            return [{ name: "gps", state: s.gps }, { name: "network", state: s.network }];
        }
        // Network positioning needs Wi-Fi (or a cell network, which the
        // simulator does not have).
        function networkUsable() {
            var st = store.get("settings:state", null);
            return !st || (!st.offlineMode && !!(st.wifi && st.wifi.enabled));
        }
        // The fix from the handlers that are on; null when none can give one.
        function fix(want) {
            var s = locState();
            var gps = s.gps && want !== "network";
            var net = s.network && want !== "gps" && networkUsable();
            if (!gps && !net) return null;
            var p = s.position, t = s.mock ? s.time || Date.now() : Date.now();
            // A few metres of wander, as a real fix has (not for a position
            // set with mock/setLocation, which tests drive exactly).
            var jitter = gps && !s.mock ? 0.00004 : 0;
            var num = function (v, d) { return typeof v === "number" ? v : d; };
            return {
                errorCode: 0,
                latitude: +(p.latitude + (Math.random() - 0.5) * jitter).toFixed(6),
                longitude: +(p.longitude + (Math.random() - 0.5) * jitter).toFixed(6),
                altitude: gps ? p.altitude || 0 : -1,
                horizAccuracy: num(p.horizAccuracy, gps ? 8 : 150),
                vertAccuracy: num(p.vertAccuracy, gps ? 12 : -1),
                direction: num(p.direction, -1),
                velocity: num(p.speed, -1),
                speed: num(p.speed, -1),
                heading: num(p.direction, -1),
                handler: gps ? "gps" : "network",
                // ms, as OSE's service; the legacy com.palm.location name
                // answers in seconds (below).
                timestamp: t
            };
        }
        function locationOff() {
            var s = locState();
            return !s.gps && !s.network;
        }

        function permissions() { return store.get("location:permissions", {}); }
        function savePermissions(all) {
            store.set("location:permissions", all);
            changed();
        }
        function appTitle(appId) {
            var lp = launchPoints().filter(function (a) { return a.id === appId && /_default$/.test(a.launchPointId); })[0]
                || launchPoints().filter(function (a) { return a.id === appId; })[0];
            return lp ? lp.title : appId;
        }
        function setPermission(appId, allowed) {
            var all = permissions();
            var cur = all[appId] || {};
            all[appId] = { appId: appId, title: cur.title || appTitle(appId), allowed: !!allowed,
                           time: Date.now(), lastUsed: cur.lastUsed || 0 };
            savePermissions(all);
        }
        function used(appId) {
            var all = permissions();
            if (!all[appId]) return;
            all[appId].lastUsed = Date.now();
            savePermissions(all);
        }

        // Is appId allowed? cb(true | false); asks the user when it has to.
        function checkPermission(appId, ctx, cb) {
            if (TRUSTED.indexOf(appId) >= 0) return cb(true);
            var p = permissions()[appId];
            if (p) return cb(!!p.allowed);
            if (!systemUiListening()) {
                console.info("[phoenix-runtime] no system UI to ask about location for " + appId + "; allowing");
                setPermission(appId, true);
                return cb(true);
            }
            var asked = Date.now();
            postSystemUi("registerForLocationServiceNotifications", { appId: appId });
            var done = false;
            var finish = function (v) {
                if (done) return;
                done = true;
                clearInterval(poll);
                cb(v);
            };
            var check = function () {
                if (done) return false;
                if (ctx.cancelled()) { finish(false); return false; }
                var now = permissions()[appId];
                if (now) { finish(!!now.allowed); return false; }
                var ignored = store.get("location:ignored", {})[appId] || 0;
                if (ignored >= asked) { finish(false); return false; }
                if (Date.now() - asked > 60000) { finish(false); return false; }
                return true;
            };
            // Answers from another page come as storage events; poll too, in case.
            watchers.push(check);
            var poll = setInterval(check, 300);
        }

        function positionReply(p, reply, ctx, appId) {
            if (locationOff())
                return reply(fail(LOC_ERR.off, "Location services are off"));
            checkPermission(appId, ctx, function (allowed) {
                if (!allowed) return reply(fail(LOC_ERR.denied, "Permission denied"));
                var f = fix(p.Handler || p.handlerType || p.handler);
                if (!f) return reply(fail(LOC_ERR.unavailable, "Position unavailable"));
                used(appId);
                // GPS takes a moment to answer; network lookups are quicker.
                setTimeout(function () { reply(ok(f)); }, f.handler === "gps" ? 250 : 80);
            });
        }

        function tracking(p, reply, ctx) {
            var appId = appIdFromLocation();
            if (!p.subscribe) return positionReply(p, reply, ctx, appId);
            checkPermission(appId, ctx, function (allowed) {
                if (!allowed) return reply(fail(LOC_ERR.denied, "Permission denied"));
                reply(ok({ subscribed: true }));
                var every = Math.max(1000, +p.minimumInterval || 1000);
                var lastErr = null;
                var tick = function () {
                    if (ctx.cancelled()) {
                        clearInterval(timer);
                        return;
                    }
                    var f = locationOff() ? null : fix(p.Handler || p.handlerType || p.handler);
                    var err = locationOff() ? LOC_ERR.off : f ? null : LOC_ERR.unavailable;
                    if (err) {
                        if (err !== lastErr) {
                            var r = fail(err, err === LOC_ERR.off ? "Location services are off" : "Position unavailable");
                            r.subscribed = true;
                            reply(r);
                        }
                        lastErr = err;
                        return;
                    }
                    lastErr = null;
                    var out = ok(f);
                    out.subscribed = true;
                    reply(out);
                };
                var timer = setInterval(tick, every);
                setTimeout(tick, 100);
                // A move (mock/setLocation) or a handler switched: at once.
                var lastKey = toJson(locState());
                watchers.push(function () {
                    if (ctx.cancelled()) return false;
                    var key = toJson(locState());
                    if (key !== lastKey) { lastKey = key; tick(); }
                    return true;
                });
                used(appId);
            });
        }

        function distanceKm(a, b, c, d) {
            var r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
            return Math.sqrt(x * x + y * y) * 6371;
        }
        function reverse(lat, lon) {
            var best = null, bestD = Infinity;
            CITIES.forEach(function (c) {
                var dd = distanceKm(lat, lon, c[4], c[5]);
                if (dd < bestD) { bestD = dd; best = c; }
            });
            if (!best || bestD > 60) return null;
            return { locality: best[0], region: best[1], country: best[2], countryCode: best[3],
                     address: best[0] + ", " + best[1] + ", " + best[2] };
        }

        function handlerName(p) { return p.Handler; }
        var location = {
            "/getAllLocationHandlers": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ handlers: handlers() }); });
            },
            "/getLocationHandlers": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ handlers: handlers().map(function (h) { return h.name; }) }); });
            },
            "/getState": function (p, reply, ctx) {
                var h = handlerName(p);
                if (h !== "gps" && h !== "network") return reply(fail(10, "Invalid input"));
                watch(p, reply, ctx, function () { return ok({ state: locState()[h] }); });
            },
            "/setState": function (p, reply) {
                var h = handlerName(p);
                if ((h !== "gps" && h !== "network") || typeof p.state !== "boolean") return reply(fail(10, "Invalid input"));
                var s = store.get("location:state", null) || {};
                s[h] = p.state;
                saveLocState(s);
                reply(ok());
            },
            "/getLocationUpdates": tracking,
            "/getGpsStatus": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ state: locState().gps }); });
            },
            "/getLocationHandlerDetails": function (p, reply) {
                var gps = p.Handler === "gps";
                if (!gps && p.Handler !== "network") return reply(fail(10, "Invalid input"));
                reply(ok({ accuracy: gps ? 1 : 3, powerRequirement: gps ? 1 : 3, requiresNetwork: !gps, requiresCell: false, monetaryCost: false }));
            },
            "/mock/enable": function (p, reply) { var s = store.get("location:state", null) || {}; s.mock = true; saveLocState(s); reply(ok()); },
            "/mock/disable": function (p, reply) { var s = store.get("location:state", null) || {}; s.mock = false; saveLocState(s); reply(ok()); },
            // Moves the simulated device (tests drive navigation with it).
            "/mock/setLocation": function (p, reply) {
                var loc = p.location || {};
                if (typeof loc.latitude !== "number" || typeof loc.longitude !== "number" || Math.abs(loc.latitude) > 90 || Math.abs(loc.longitude) > 180)
                    return reply(fail(10, "Invalid input"));
                var s = store.get("location:state", null) || {};
                var pos = {};
                for (var k in loc) pos[k] = loc[k];
                s.position = pos;
                s.mock = true;
                s.time = Date.now();
                saveLocState(s);
                reply(ok());
            },
            "/getReverseLocation": function (p, reply) {
                if (typeof p.latitude !== "number" || typeof p.longitude !== "number") return reply(fail(10, "Invalid input"));
                var a = reverse(p.latitude, p.longitude);
                reply(a ? ok(a) : fail(LOC_ERR.unavailable, "No address known for this position"));
            },
            // luna-systemui's LocationAlert (SystemManagerAlerts.js).
            "/acceptLocationRequest": function (p, reply) { setPermission(p.appId || p.url, true); reply(ok()); },
            "/acceptAlwaysLocationRequest": function (p, reply) { setPermission(p.appId || p.url, true); reply(ok()); },
            "/rejectLocationRequest": function (p, reply) { setPermission(p.appId || p.url, false); reply(ok()); },
            "/ignoreLocationRequest": function (p, reply) {
                var ig = store.get("location:ignored", {});
                ig[p.appId || p.url] = Date.now();
                store.set("location:ignored", ig);
                changed();
                reply(ok());
            },
            "*": function (p, reply) { reply(ok()); }
        };
        register(["com.webos.service.location"], location);
        // The legacy name (luna-systemui's alert, Mojo and Enyo apps): the
        // same, plus getCurrentPosition and startTracking, with timestamps in
        // seconds as that API had them.
        function inSeconds(fn) {
            return function (p, reply, ctx) {
                fn(p, function (r) {
                    if (r && typeof r.timestamp === "number") r.timestamp = Math.floor(r.timestamp / 1000);
                    reply(r);
                }, ctx);
            };
        }
        var legacy = {};
        Object.keys(location).forEach(function (k) { legacy[k] = location[k]; });
        legacy["/getCurrentPosition"] = inSeconds(function (p, reply, ctx) { positionReply(p, reply, ctx, appIdFromLocation()); });
        legacy["/getLocationUpdates"] = legacy["/startTracking"] = inSeconds(tracking);
        register(["com.palm.location"], legacy);

        register(["org.webosphoenix.service.location"], {
            "/getPermissions": function (p, reply, ctx) {
                watch(p, reply, ctx, function () {
                    var all = permissions();
                    // A title the answering page could not look up (the alert answers as its window closes).
                    return ok({ permissions: Object.keys(all).sort().map(function (k) {
                        var p = all[k];
                        if (!p.title || p.title === p.appId) p.title = appTitle(p.appId);
                        return p;
                    }) });
                });
            },
            "/setPermission": function (p, reply) {
                if (!p.appId || typeof p.allowed !== "boolean") return reply(fail(-1, "appId and allowed are required"));
                setPermission(p.appId, p.allowed);
                reply(ok());
            },
            "/removePermission": function (p, reply) {
                var all = permissions();
                delete all[p.appId];
                savePermissions(all);
                reply(ok());
            }
        });

        // For tests and the console.
        //   set(latitude, longitude, extra?) or set({latitude, longitude, ...})
        //       moves the device (mock/setLocation; extra: direction, speed,
        //       horizAccuracy, ...) and turns Location Services on if it was
        //       off; set(null) turns it off; set(undefined) goes back home.
        //   get()  the position, or null when Location Services is off.
        //   reset()  home, both handlers on, no permissions answered.
        function setPosition(latitude, longitude, extra) {
            var s = store.get("location:state", null) || {};
            if (latitude === undefined) {
                delete s.position;
                s.mock = false;
                s.gps = true;
                s.network = true;
                return saveLocState(s);
            }
            if (latitude === null) {
                s.gps = false;
                s.network = false;
                return saveLocState(s);
            }
            var pos = {};
            if (typeof latitude === "object") {
                for (var j in latitude) pos[j] = latitude[j];
            } else {
                pos.latitude = latitude;
                pos.longitude = longitude;
                for (var k in extra || {}) pos[k] = extra[k];
            }
            if (s.gps === false && s.network === false) {
                s.gps = true;
                s.network = true;
                saveLocState(s);
            }
            return callNow("luna://com.webos.service.location/mock/setLocation", { name: "gps", location: pos });
        }
        runtime.location = {
            set: setPosition,
            setPosition: function (pos) { return setPosition(pos); },
            get: function () { return locationOff() ? null : locState().position; },
            permissions: permissions,
            answer: function (appId, allow) { setPermission(appId, allow === true || allow === "allow"); },
            reset: function () {
                store.set("location:state", {});
                store.set("location:permissions", {});
                changed();
            }
        };

        // ---- navigator.geolocation (W3C) over the simulated service -----------------

        (function geolocation() {
            var nav = global.navigator;
            if (!nav) return;
            var watches = {}, nextWatch = 1;
            function toPosition(f) {
                return {
                    coords: {
                        latitude: f.latitude, longitude: f.longitude,
                        altitude: f.altitude >= 0 ? f.altitude : null,
                        accuracy: f.horizAccuracy,
                        altitudeAccuracy: f.vertAccuracy >= 0 ? f.vertAccuracy : null,
                        heading: null, speed: null
                    },
                    timestamp: f.timestamp
                };
            }
            function toError(r) {
                var code = r.errorCode === LOC_ERR.denied ? 1 : r.errorCode === LOC_ERR.timeout ? 3 : 2;
                return { code: code, message: r.errorText || "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
            }
            var geo = {
                getCurrentPosition: function (success, error) {
                    dispatch("luna://com.webos.service.location/getLocationUpdates", {}, function (r) {
                        if (r.returnValue) success(toPosition(r));
                        else if (error) error(toError(r));
                    }, { cancelled: function () { return false; }, onCancel: null });
                },
                watchPosition: function (success, error) {
                    var id = nextWatch++, stopped = false;
                    watches[id] = function () { stopped = true; };
                    dispatch("luna://com.webos.service.location/getLocationUpdates", { subscribe: true }, function (r) {
                        if (r.returnValue && typeof r.latitude === "number") success(toPosition(r));
                        else if (!r.returnValue && error) error(toError(r));
                    }, { cancelled: function () { return stopped; }, onCancel: null });
                    return id;
                },
                clearWatch: function (id) {
                    if (watches[id]) watches[id]();
                    delete watches[id];
                }
            };
            try {
                Object.defineProperty(nav, "geolocation", { configurable: true, get: function () { return geo; } });
            } catch (e) { /* read-only in this browser */ }
        })();

        // ---- Help topics for Just Type ------------------------------------------------

        (function helpIndex() {
            var INDEXERS = ["com.palm.launcher", "com.palm.systemui", "org.webosphoenix.help"];
            if (INDEXERS.indexOf(appIdFromLocation()) < 0) return;
            var KIND = "org.webosphoenix.helptopic:1";
            var idx = null;
            try { idx = JSON.parse(PalmSystem.getResource("/usr/palm/applications/org.webosphoenix.help/help-index.json") || "null"); }
            catch (e) { idx = null; }
            if (!idx || !idx.topics || store.get("helpIndexVersion", "") === idx.version) return;
            callNow("palm://com.palm.db/putKind", { id: KIND, owner: "org.webosphoenix.help",
                                                    indexes: [{ name: "searchText", props: [{ name: "searchText", tokenize: "all", collate: "primary" }] }] });
            callNow("palm://com.palm.db/del", { query: { from: KIND }, purge: true });
            callNow("palm://com.palm.db/put", { objects: idx.topics.map(function (t) {
                return { _kind: KIND, _id: "help-" + t.id, topicId: t.id, title: t.title, summary: t.summary,
                         category: t.category, searchText: t.searchText, version: idx.version };
            }) });
            store.set("helpIndexVersion", idx.version);
        })();
    })();
})(this);
