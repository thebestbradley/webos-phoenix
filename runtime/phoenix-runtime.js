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

    // ---- The text indexer (PalmSystem.runTextIndexer) ------------------------------
    (function () {
        // One pass over a stretch of text (no tags): the first kind that
        // matches at a place wins, e-mail addresses before web addresses
        // (ada@example.com is not a site) and both before phone numbers.
        var EMAIL = "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}";
        // (The text is HTML: an escaped "<", ">" or quote ends an address.)
        var URLCHAR = "(?:(?!&(?:lt|gt|quot|#39|apos);)[^\\s<>\"'])";
        var WEB = "(?:https?|ftp|rtsp):\\/\\/" + URLCHAR + "+";
        var BARE = "www\\.[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?:[/?#]" + URLCHAR + "*)?";
        // North American and international forms: 555-0100, (408) 555-1212,
        // 408.555.1212, +1 408 555 1212, +44 20 7946 0958, 4085551212; not
        // dates (2010-11-12) or plain counts.
        var PHONE = "(?:\\+\\d{1,3}[\\s.-]?)?(?:\\(\\d{2,4}\\)\\s?|\\d{2,4}[\\s.-])?\\d{3,4}[\\s.-]\\d{4}|\\+?\\d{10,13}";
        var RE = new RegExp("(" + EMAIL + ")|(" + WEB + ")|(" + BARE + ")|((?:^|(?<=[^\\w+]))(?:" + PHONE + ")(?![\\w]))", "g");
        // Punctuation that ends a sentence, not the address.
        function trimEnd(s) {
            var m = /[.,;:!?)\]}'"]+$/.exec(s);
            if (!m) return [s, ""];
            // A ")" the address opened stays (wikipedia.org/wiki/Foo_(bar)).
            var cut = m[0];
            if (cut.charAt(0) === ")" && s.slice(0, -cut.length).indexOf("(") >= 0) cut = cut.slice(1);
            return [s.slice(0, s.length - cut.length), cut];
        }
        function linkText(text, o) {
            return text.replace(RE, function (all, email, web, bare, phone) {
                if (email !== undefined) {
                    if (o.emailAddress === false) return all;
                    return '<a href="mailto:' + email + '">' + email + "</a>";
                }
                if (web !== undefined || bare !== undefined) {
                    if (web !== undefined ? o.webLink === false : o.schemalessWebLink === false) return all;
                    var t = trimEnd(all);
                    var href = web !== undefined ? t[0] : "http://" + t[0];
                    return '<a href="' + href.replace(/"/g, "&quot;") + '">' + t[0] + "</a>" + t[1];
                }
                if (o.phoneNumber === false) return all;
                if (all.replace(/\D/g, "").length < 7) return all;
                var digits = all.replace(/[^\d+]/g, "");
                return '<a href="tel:' + digits + '">' + all + "</a>";
            });
        }
        runtime.textIndexer = function (html, options) {
            if (typeof html !== "string" || html === "") return html === undefined || html === null ? "" : String(html);
            var o = options && typeof options === "object" ? options : {};
            // Tags pass; text inside an <a> (a link already) too.
            var parts = html.split(/(<[^>]*>)/), inLink = 0, out = "";
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i];
                if (i % 2 === 1) {
                    if (/^<a[\s>]/i.test(part)) inLink++;
                    else if (/^<\/a\s*>/i.test(part) && inLink > 0) inLink--;
                    out += part;
                } else {
                    out += inLink ? part : linkText(part, o);
                }
            }
            return out;
        };
    })();

    // ---- Host messaging --------------------------------------------------------

    var host = global.phoenixHost = global.phoenixHost || {
        postToHost: function (type, payload) {
            try {
                console.info("__phoenix__" + toJson({ type: type, payload: payload || {} }));
            } catch (e) { /* ignore */ }
        }
    };

    // A JSON answer from the host at a path of its own (phoenix-sim's
    // /__phoenix/proxy?req=..., /__phoenix/proxy/progress?id=...). With
    // XMLHttpRequest: before Qt 6.6 Chromium refuses fetch() on a custom
    // scheme such as phoenix: (QWebEngineUrlScheme::FetchApiAllowed is 6.6),
    // and XHR is how the apps' own pages read files there anyway.
    function hostGetJson(path) {
        return new Promise(function (resolve, reject) {
            var x = new global.XMLHttpRequest();
            x.open("GET", path, true);
            x.onload = function () {
                try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
            };
            x.onerror = function () { reject(new Error("The host did not answer " + path.replace(/\?.*$/, ""))); };
            x.send();
        });
    }

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
        // A system page an app shows in a frame of its own page (Enyo's
        // CrossAppUI: luna-systemui's file picker) runs as that app, as the
        // frames of an app's card did on webOS.
        try {
            var up = global.parent;
            if (up && up !== global && up.PalmSystem && up.PalmSystem.appIdentifier)
                return up.PalmSystem.appIdentifier;
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
                this.setRaw(key, toJson(value));
            },
            // The stored JSON text itself (null when there is none).
            raw: function (key) {
                try {
                    var v = ls ? ls.getItem("phoenix:" + key) : mem[key];
                    return v === undefined ? null : v;
                } catch (e) {
                    return null;
                }
            },
            setRaw: function (key, text) {
                if (ls) ls.setItem("phoenix:" + key, text);
                else mem[key] = text;
            },
            remove: function (key) {
                if (ls) ls.removeItem("phoenix:" + key);
                else delete mem[key];
            },
            // The keys that start with prefix.
            keys: function (prefix) {
                var out = [], k, i;
                if (ls) {
                    for (i = 0; i < ls.length; ++i) {
                        k = ls.key(i);
                        if (k && k.indexOf("phoenix:" + prefix) === 0) out.push(k.slice(8));
                    }
                } else {
                    for (k in mem) if (k.indexOf(prefix) === 0) out.push(k);
                }
                return out;
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
        installDevice();
        return;
    }

    // ---- On a device: WebAppMgr's PalmSystem, and what the shell needs ------------
    //
    // WebAppMgr has the bus and PalmSystem; what Phoenix's shell needs from a
    // page beyond them goes as window properties on the page's surface
    // (WebAppMgr's setWindowProperty, wam src/platform/webengine/
    // palm_system_blink.cc:100-108, a string each), which LsmWindowSource
    // reads (shell/qml/Phoenix/Lsm/LsmCards.js has the list):
    //   - PalmSystem.setWindowOrientation, enableFullScreenMode and
    //     setWindowProperties {blockScreenTimeout, statusBarColor}, which
    //     WebAppMgr does not have (its windowOrientation is always "free",
    //     palm_system_webos.h:42-43), and appinfo.json's
    //     requestedWindowOrientation, which it reads but does not use
    //     (application_description.cc:160): phoenixOrientation,
    //     phoenixFullScreen, phoenixBlockScreenTimeout, phoenixStatusBarColor.
    //   - {returnToCaller} on a launch: the caller rides in the params as
    //     $caller (as off the device, /launch below); the app it opens says
    //     whom to go back to (phoenixReturnTo), at its start and on each
    //     relaunch (WebAppMgr's webOSRelaunch event).
    //   - Back: the webOS Back key (keyCode 461) reaches the page; Mojo,
    //     Enyo 1.0 and @phoenix/ui know Back as Escape (with keyIdentifier
    //     U+1200001), so a 461 the page does not take goes on as that (as
    //     runtime.back does off the device), and one it still does not take
    //     is said to the shell (phoenixBack, a new value each time), which
    //     minimizes the card or returns to the caller, as LunaSysMgr did with
    //     a Back WebAppMgr handed back (SystemUiController.cpp:941-954).
    //     tools/install-rootfs.py marks the image's apps
    //     disableBackHistoryAPI, so WebAppMgr gives them every Back.
    // tools/test-runtime-device.cjs drives this with a fake WebAppMgr.
    // STATUS: written against WebAppMgr's source; not yet run on a device.
    // Which name WebAppMgr's page API gives setWindowProperty is taken from
    // the first of webOSSystem.window.setProperty, webOSSystem.setWindowProperty,
    // PalmSystem.window.setProperty and PalmSystem.setWindowProperty there is.
    function installDevice() {
        var NativeBridge = global.PalmServiceBridge;
        var me = appIdFromLocation();
        var notCallers = ["com.palm.systemui", "com.palm.launcher", "com.webos.phoenix.unknown"];
        // A launch with {returnToCaller: true}: params.$caller, as off the device.
        function deviceJson(url, json) {
            if (!/^(palm|luna):\/\/com\.webos\.applicationManager\/launch$/.test(url))
                return json;
            var p;
            try { p = JSON.parse(json); } catch (e) { return json; }
            if (!p || p.returnToCaller !== true)
                return json;
            delete p.returnToCaller;
            if (me && notCallers.indexOf(me) < 0 && me !== p.id) {
                var params = {};
                for (var k in p.params || {}) params[k] = p.params[k];
                params.$caller = me;
                p.params = params;
            }
            return toJson(p);
        }
        global.PalmServiceBridge = function () {
            var b = new NativeBridge();
            var self = this;
            b.onservicecallback = function (json) {
                if (self.onservicecallback) self.onservicecallback(json);
            };
            this.call = function (url, json) {
                var u = aliasUrl(url);
                return b.call(u, deviceJson(u, json));
            };
            this.cancel = function () { return b.cancel(); };
        };

        function setWindowProperty(name, value) {
            var v = String(value);
            var ws = global.webOSSystem, ps = global.PalmSystem;
            var tries = [
                [ws && ws.window, "setProperty"], [ws, "setWindowProperty"],
                [ps && ps.window, "setProperty"], [ps, "setWindowProperty"]
            ];
            for (var i = 0; i < tries.length; ++i) {
                var o = tries[i][0], f = tries[i][1];
                if (o && typeof o[f] === "function") {
                    try { o[f](name, v); return true; } catch (e) { return false; }
                }
            }
            return false;
        }
        runtime.setWindowProperty = setWindowProperty;

        var orientations = ["free", "up", "down", "left", "right", "landscape", "portrait"];
        function orientation(o) {
            o = String(o || "").toLowerCase();
            return orientations.indexOf(o) >= 0 ? o : "free";
        }
        var ps = global.PalmSystem;
        function shim(name, fn) {
            if (ps && typeof ps[name] !== "function") {
                try { ps[name] = fn; } catch (e) { /* not extensible */ }
            }
        }
        shim("setWindowOrientation", function (o) { setWindowProperty("phoenixOrientation", orientation(o)); });
        shim("enableFullScreenMode", function (on) { setWindowProperty("phoenixFullScreen", on ? "true" : "false"); });
        shim("setWindowProperties", function (props) {
            if (!props || typeof props !== "object") return;
            if ("blockScreenTimeout" in props)
                setWindowProperty("phoenixBlockScreenTimeout", props.blockScreenTimeout ? "true" : "false");
            if (typeof props.statusBarColor === "number" && isFinite(props.statusBarColor))
                setWindowProperty("phoenixStatusBarColor", String(props.statusBarColor & 0xFFFFFF));
        });

        // appinfo.json: the orientation the window starts in, and whether the
        // app takes Back itself.
        var takesBack = false;
        try {
            var x = new global.XMLHttpRequest();
            x.open("GET", "file:///usr/palm/applications/" + me + "/appinfo.json", true);
            x.onload = function () {
                var info = null;
                try { info = JSON.parse(x.responseText); } catch (e) { return; }
                if (!info) return;
                takesBack = info.disableBackHistoryAPI === true;
                if (info.requestedWindowOrientation)
                    setWindowProperty("phoenixOrientation", orientation(info.requestedWindowOrientation));
            };
            x.send();
        } catch (e) { /* no appinfo: not an app */ }

        function launchParams() {
            try { return JSON.parse((ps && ps.launchParams) || "{}") || {}; } catch (e) { return {}; }
        }
        function tellCaller() {
            var lp = launchParams();
            setWindowProperty("phoenixReturnTo", lp && typeof lp.$caller === "string" ? lp.$caller : "");
        }
        tellCaller();
        if (global.document)
            global.document.addEventListener("webOSRelaunch", function () { global.setTimeout(tellCaller, 0); });

        function legacyBack() {
            var target = (global.document && (global.document.activeElement || global.document.body)) || global.document;
            var handled = false;
            ["keydown", "keyup"].forEach(function (type) {
                var e = new global.KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true });
                try {
                    Object.defineProperty(e, "keyCode", { get: function () { return 27; } });
                    Object.defineProperty(e, "keyIdentifier", { get: function () { return "U+1200001"; } });
                } catch (x) { /* ignore */ }
                target.dispatchEvent(e);
                if (e.defaultPrevented) handled = true;
            });
            return handled;
        }
        var backs = 0;
        runtime.deviceBack = function (e) {
            if (!takesBack || e.defaultPrevented || legacyBack())
                return true;
            setWindowProperty("phoenixBack", Date.now() + "-" + (++backs));
            return false;
        };
        global.addEventListener("keydown", function (e) {
            if (e.keyCode !== 461 && e.key !== "GoBack" && e.key !== "BrowserBack")
                return;
            // After the page's own handlers (they may stop it).
            global.setTimeout(function () { runtime.deviceBack(e); }, 0);
        }, false);

        // The clipboard history: this page's copies go to the history's
        // service on the bus (services/clipboard runs this runtime's
        // org.webosphoenix.clipboard there), as off the device they go to
        // the runtime's own: copy and cut events, navigator.clipboard
        // writes, and what an app marks as a secret first
        // (runtime.clipboard.markSensitive: @phoenix/secrets' SecretClipboard).
        // Copy in a password field (the simulator's passwordCopy) is not
        // here yet.
        var marks = [];
        function takeMark(text) {
            var now = Date.now();
            marks = marks.filter(function (m) { return now - m.at < 5000; });
            for (var i = 0; i < marks.length; ++i)
                if (marks[i].text === text)
                    return marks.splice(i, 1)[0];
            return null;
        }
        function recordCopy(text) {
            if (!text || !String(text).trim()) return;
            var mark = takeMark(String(text));
            var item = { text: String(text) };
            if (mark) {
                item.sensitive = true;
                if (mark.kind) item.kind = mark.kind;
            }
            var b = new NativeBridge();
            b.onservicecallback = function () {};
            b.call("luna://org.webosphoenix.clipboard/add", toJson(item));
        }
        runtime.recordCopy = recordCopy;
        function selectedText() {
            var el = global.document && global.document.activeElement;
            var tag = el && el.tagName ? el.tagName.toLowerCase() : "";
            if ((tag === "input" || tag === "textarea") && typeof el.selectionStart === "number")
                return String(el.value || "").substring(el.selectionStart, el.selectionEnd);
            var sel = global.getSelection && global.getSelection();
            return sel ? String(sel) : "";
        }
        global.addEventListener("copy", function () { recordCopy(selectedText()); });
        global.addEventListener("cut", function () { recordCopy(selectedText()); });
        var nc = global.navigator && global.navigator.clipboard;
        if (nc && typeof nc.writeText === "function") {
            var writeText = nc.writeText.bind(nc);
            try {
                nc.writeText = function (text) {
                    var r = writeText(text);
                    Promise.resolve(r).then(function () { recordCopy(text); }, function () {});
                    return r;
                };
            } catch (e) { /* read-only: not recorded */ }
        }
        runtime.clipboard = {
            markSensitive: function (text, kind) {
                if (typeof text === "string" && text) marks.push({ text: text, kind: kind ? String(kind) : "", at: Date.now() });
            }
        };
    }

    // ================================================================================
    // Everything below runs only off-device.
    // ================================================================================

    // ---- PalmSystem -----------------------------------------------------------------

    var launchParams = queryParam("launchParams") || "{}";
    var activated = true;

    var bannerSerial = 0;   // addBannerMessage ids, unique within the app
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
        // Read again on each use: the screen is the shell's (applyHostStatus
        // {screen}), which the adaptive simulator changes as its window is
        // resized, as a turn changes the window (the page's own screen is
        // the computer's monitor).
        get deviceInfo() {
            var shellScreen = store.get("screen", null);
            return toJson({
                modelName: "Phoenix Simulator",
                modelNameAscii: "Phoenix Simulator",
                platformVersion: "3.0.5",
                platformVersionMajor: 3,
                platformVersionMinor: 0,
                platformVersionDot: 5,
                carrierName: "Phoenix",
                serialNumber: "PHOENIX0001",
                screenWidth: shellScreen ? shellScreen.width : global.screen ? global.screen.width : 320,
                screenHeight: shellScreen ? shellScreen.height : global.screen ? global.screen.height : 480,
                minimumCardWidth: 320,
                minimumCardHeight: 188,
                maximumCardWidth: 320,
                maximumCardHeight: 452,
                keyboardAvailable: true,
                keyboardSlider: false,
                keyboardType: "QWERTY",
                wifiAvailable: true,
                bluetoothAvailable: true,
                coreNaviButton: false,
                // Exhibitions on the Touchstone (DeviceInfo.cpp:315).
                dockModeEnabled: true
            });
        },
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
        // screen on while the card is in front (a video, a flashlight);
        // statusBarColor (0xRRGGBB) tints the tablet's status bar while the
        // card is maximized (IpcClientHost.cpp:294-296). setSubtleLightbar
        // and fastAccelerometer have nothing to act on.
        setWindowProperties: function (props) {
            if (!props || typeof props !== "object")
                return;
            var out = { appId: PalmSystem.appIdentifier };
            if ("blockScreenTimeout" in props)
                out.blockScreenTimeout = !!props.blockScreenTimeout;
            if (typeof props.statusBarColor === "number" && isFinite(props.statusBarColor))
                out.statusBarColor = props.statusBarColor & 0xFFFFFF;
            if (Object.keys(out).length > 1)
                host.postToHost("windowProperties", out);
        },
        enableFullScreenMode: function (on) { host.postToHost("fullScreen", { appId: PalmSystem.appIdentifier, on: !!on }); },
        // Enyo's enyo.keyboard.setResizesWindow(false): the card keeps its
        // size when the keyboard comes, the keyboard over its bottom, and the
        // page hears Mojo.positiveSpaceChanged(width, height) instead
        // (IpcClientHost.cpp:303-305, CardWindowManagerStates.cpp:85-98).
        allowResizeOnPositiveSpaceChange: function (allow) {
            host.postToHost("windowProperties", { appId: PalmSystem.appIdentifier, allowResizeOnPositiveSpaceChange: allow !== false });
        },
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
        // Puts this window (frameName "": the app's own document) on paper
        // for a print job of com.palm.printmgr (PrintDialog's frameToPrint):
        // in phoenix-sim the shell renders the window ("print" host
        // message); elsewhere its text is printed. See "Printing" below.
        printFrame: function (frameName, jobID) {
            if (!jobID || !runtime.print) return;
            var doc = global.document;
            runtime.print.render(jobID, global.location.protocol === "phoenix:"
                ? { title: doc.title, host: { type: "print", id: "" } }
                : { title: doc.title, text: doc.body ? doc.body.innerText : "" });
        },
        // The TouchPad launcher's glow on a tapped icon (Just Type).
        applyLaunchFeedback: function () {},
        simulateMouseClick: function () {},
        useSimulatedMouseClicks: function () {},
        // Links in text an app shows (enyo.string.runTextIndexer: Memos'
        // notes, Calendar's subjects and notes, Email's subject): web
        // addresses (http://..., www....), e-mail addresses and phone
        // numbers become <a href> links (http, mailto:, tel:), which open in
        // their apps. The text is HTML: tags and existing links stay as
        // they are. options {webLink, schemalessWebLink, emailAddress,
        // phoneNumber}: false leaves that kind alone (WebAppMgr's
        // PalmSystem::runTextIndexer, Palm::WebGlobal::runTextIndexerOnHtml;
        // enyo-1.0 dom/util.js:310-334). Emoticons stay text.
        runTextIndexer: function (text, options) { return runtime.textIndexer(text, options); },
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
            var id = "b" + (++bannerSerial) + "-" + Date.now();
            host.postToHost("banner", { id: id, appId: PalmSystem.appIdentifier, message: msg, params: params, icon: icon,
                                        soundClass: soundClass ? String(soundClass) : "", soundFile: soundFile ? String(soundFile) : "",
                                        duration: duration | 0 });
            return id;
        },
        removeBannerMessage: function (id) { host.postToHost("removeBanner", { id: id }); },
        clearBannerMessages: function () { host.postToHost("clearBanners", {}); },
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
        getLocalizedString: function (s) { return s; },

        // Scene transitions: see "Scene transitions" below.
        prepareSceneTransition: function (isPop) { return runtime.sceneTransition.prepare(isPop); },
        runSceneTransition: function (type, isPop) { runtime.sceneTransition.run(type, isPop); },
        cancelSceneTransition: function () { runtime.sceneTransition.cancel(); }
    };

    global.PalmSystem = PalmSystem;

    // ---- Scene transitions --------------------------------------------------------
    // Mojo's ZoomFadeTransition (palmInitFramework506.js, the
    // Mojo.Controller.Transition.ZoomFadeTransition calls) had the card do
    // the scene change: PalmSystem.prepareSceneTransition(isPop) as a push or
    // pop begins made LunaSysMgr snapshot the card, the app then built the
    // new scene, and runSceneTransition(type, isPop) ("zoom-fade" or
    // "cross-fade") animated from the snapshot to the live page
    // (CardTransition.cpp); cancelSceneTransition() if it never ran. The
    // shell does the same with the "sceneTransition" host message.
    //
    // A host message cannot block the page while the shell takes its
    // snapshot, so prepare also returns a promise that settles once the
    // shell has it (sceneTransitionPrepared), or after a while without a
    // shell: pages that can wait for it change the scene after that (the
    // apps' sceneTransition() in @phoenix/luna); Mojo ignores the return.
    runtime.sceneTransition = (function () {
        var waiting = [];
        var prepared = false;
        function settle() {
            var list = waiting;
            waiting = [];
            list.forEach(function (f) { f(); });
        }
        return {
            // How long a page waits for the shell's snapshot: only
            // phoenix-sim's pages (phoenix:) have a shell to take one.
            timeoutMs: global.location && global.location.protocol === "phoenix:" ? 250 : 0,
            prepare: function (isPop) {
                prepared = true;
                host.postToHost("sceneTransition", { op: "prepare", isPop: !!isPop });
                var self = this;
                return new Promise(function (resolve) {
                    waiting.push(resolve);
                    global.setTimeout(function () {
                        var i = waiting.indexOf(resolve);
                        if (i >= 0) {
                            waiting.splice(i, 1);
                            resolve();
                        }
                    }, self.timeoutMs);
                });
            },
            run: function (type, isPop) {
                if (!prepared)
                    return;
                prepared = false;
                type = String(type || "zoom-fade");
                if (type !== "zoom-fade" && type !== "cross-fade") {
                    // CardTransition's constructor: anything else is
                    // invalid and nothing is drawn.
                    this.cancel();
                    return;
                }
                host.postToHost("sceneTransition", { op: "run", transition: type, isPop: !!isPop });
            },
            cancel: function () {
                prepared = false;
                settle();
                host.postToHost("sceneTransition", { op: "cancel" });
            },
            // The shell has its snapshot.
            prepared: function () { settle(); }
        };
    })();
    runtime.sceneTransitionPrepared = function () { runtime.sceneTransition.prepared(); };

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
    // (a dashboard that takes taps on the lock screen), a dashboard's
    // persistent (no swipe dismisses it: SysUpdateService.js's update
    // dashboard) and webosDragMode "manual" (it takes its own drags:
    // enyo.Dashboard), and a popup alert's
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
                     + (attrs.persistent ? "&phoenixPersistent=1" : "")
                     + (attrs.webosDragMode === "manual" || attrs.webosDragMode === true ? "&phoenixDragMode=manual" : "")
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
    function sendUnsent() {
        Object.keys(unsent).forEach(function (k) {
            var u = unsent[k];
            if (!u) return;
            clearTimeout(u.timer);
            u.run();
        });
    }
    try {
        global.addEventListener("pagehide", function () {
            unloading = true;
            sendUnsent();
        }, true);
        global.addEventListener("pageshow", function () { unloading = false; });
    } catch (e) { /* ignore */ }
    // window.close(): phoenix-sim takes a closed alert or dashboard window
    // away without a pagehide, so what the page asked for just before
    // (luna-systemui's USB warning: enterMSM, then close()) goes out first.
    try {
        var nativeClose = global.close;
        if (typeof nativeClose === "function") {
            global.close = function () {
                unloading = true;
                sendUnsent();
                return nativeClose.apply(global, arguments);
            };
        }
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
    //
    // Every page (the shell's system UI and launcher, Just Type, each app)
    // has its own copy of this db8 on the one shared store, as the processes
    // of a device share the one db8 daemon. So the store keeps each object
    // and each kind under a key of its own, and a page writes only those it
    // changed:
    //
    //   db8:<name>                {rev, nextId, nextSubId, write}
    //   db8:<name>/kind/<id>      a kind
    //   db8:<name>/obj/<_id>      an object
    //
    // (The whole database used to be the one value "db8:<name>", read,
    // changed and written back by each page. A browser's localStorage
    // is not a transaction: each page reads from its own copy, which hears
    // of other pages' writes a moment later, longer when the page is busy.
    // A page that wrote then put back its older copy of everything, and
    // what other pages had stored in the meantime was lost: on a loaded
    // machine the Tasks app's Inbox, which it creates on first start while
    // the system UI and launcher are still filling in the sample data.)
    // Two pages that change the same object at the same moment still leave
    // the last one's, as db8 does. Watches in a page fire for other pages'
    // changes too: every write changes db8:<name> ("write" names the page
    // and its write), whose "storage" event reaches the other pages after
    // the objects' own.
    var PAGE_TAG = Math.random().toString(36).slice(2, 6), db8Writes = 0;
    // name -> {load, save}, for the runtime's own changes to the kinds.
    var db8Stores = {};
    function makeDb(name) {
        var key = "db8:" + name;
        var OBJ = key + "/obj/", KIND = key + "/kind/";
        var watchers = [];

        // The single value of earlier versions, split into keys once. Objects
        // another page has already stored under their own key stay as they are.
        function migrate(old) {
            [[OBJ, old.objects], [KIND, old.kinds]].forEach(function (part) {
                Object.keys(part[1] || {}).forEach(function (id) {
                    if (store.raw(part[0] + id) === null) store.setRaw(part[0] + id, toJson(part[1][id]));
                });
            });
            var meta = { rev: old.rev || 1, nextId: old.nextId || 1, nextSubId: old.nextSubId, write: PAGE_TAG + ":" + (++db8Writes) };
            store.set(key, meta);
            return meta;
        }

        // {objects, kinds, rev, nextId, nextSubId}, as stored now. db.stored
        // (not enumerable) holds the JSON each key had, for save.
        function load() {
            var meta = store.get(key, null) || {};
            if (meta.objects) meta = migrate(meta);
            var db = { objects: {}, kinds: {}, rev: meta.rev || 1, nextId: meta.nextId || 1, nextSubId: meta.nextSubId };
            var stored = {};
            store.keys(key + "/").forEach(function (k) {
                var isObj = k.indexOf(OBJ) === 0;
                if (!isObj && k.indexOf(KIND) !== 0) return;
                var text = store.raw(k), v;
                if (text === null) return;
                try { v = JSON.parse(text); } catch (e) { return; }
                stored[k] = text;
                (isObj ? db.objects : db.kinds)[k.slice((isObj ? OBJ : KIND).length)] = v;
                // Revisions go on from the newest this page has seen.
                if (isObj && v && v._rev > db.rev) db.rev = v._rev;
            });
            stored[key] = toJson({ rev: db.rev, nextId: db.nextId, nextSubId: db.nextSubId });
            Object.defineProperty(db, "stored", { value: stored });
            return db;
        }

        // Writes the objects and kinds that changed (and removes those that
        // went), then the revision counters if anything did.
        function save(db) {
            var stored = db.stored || {}, changed = false, now = {};
            [[OBJ, db.objects], [KIND, db.kinds]].forEach(function (part) {
                Object.keys(part[1]).forEach(function (id) {
                    var k = part[0] + id, text = toJson(part[1][id]);
                    now[k] = true;
                    if (stored[k] === text) return;
                    store.setRaw(k, text);
                    stored[k] = text;
                    changed = true;
                });
            });
            Object.keys(stored).forEach(function (k) {
                if (k === key || now[k]) return;
                store.remove(k);
                delete stored[k];
                changed = true;
            });
            var counters = toJson({ rev: db.rev, nextId: db.nextId, nextSubId: db.nextSubId });
            if (changed || stored[key] !== counters) {
                store.set(key, { rev: db.rev, nextId: db.nextId, nextSubId: db.nextSubId, write: PAGE_TAG + ":" + (++db8Writes) });
                stored[key] = counters;
            }
        }

        // The page's tag keeps two pages that count from the same nextId
        // from making the same _id.
        function newId(db) {
            return (name === "com.palm.tempdb" ? "t" : "") + "++" + (db.nextId++).toString(36) + Date.now().toString(36) + PAGE_TAG;
        }
        db8Stores[name] = { load: load, save: save };

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
            // Every db8 object is deleted or not: _del is false until it is
            // (Email's change processor asks for _del = false, and found
            // nothing: its messages were never sorted).
            if (c.prop === "_del" && v === undefined) v = false;
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
            // Kinds may extend others (e.g. "com.palm.contact.palmprofile:1" extends "com.palm.person:1"),
            // through any number of levels ("com.palm.immessage.xmpp:1" extends "com.palm.immessage:1",
            // which extends "com.palm.message:1"); a kind seen twice ends the walk.
            var id = obj._kind, seen = {};
            while (id && !seen[id]) {
                seen[id] = true;
                var k = db.kinds[id];
                if (!k || !k.extends || !k.extends.length) return false;
                if (k.extends.indexOf(kind) >= 0) return true;
                id = k.extends[0];
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

        // Another page wrote (see above), or the store was cleared.
        try {
            global.addEventListener("storage", function (e) {
                if (e.key === null || e.key === "phoenix:" + key) notify();
            });
        } catch (x) { /* no window events */ }

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
        // The computer's zone; its UTC aliases are the zone list's Etc/UTC
        // (a container's "UTC" matched no zone: First Use's Time zone
        // picker showed nothing).
        // Its city is the zone's last part (Settings > Date & Time showed
        // "Etc/UTC" or "America/Chicago" as the city).
        timeZone: (function (z) {
            z = /^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu)$/.test(z) ? "Etc/UTC" : z;
            return { ZoneID: z, City: z.split("/").pop().replace(/_/g, " "), Country: "" };
        })(PalmSystem.TZ),
        useNetworkTime: true,
        wallpaper: { wallpaperName: "", wallpaperFile: "" },
        // Dock mode's own wallpaper (Preferences.cpp "dockwallpaper"), behind
        // the exhibitions; none: dock mode is black, the Time exhibition on
        // its clock_bg.png.
        dockwallpaper: { wallpaperName: "", wallpaperFile: "" },
        // Sounds in dock mode (conf/defaultPreferences.txt): "systemsettings"
        // follows Sounds & Ringtones; "mute" (Phoenix) keeps notifications
        // and alerts quiet while an exhibition shows (calls still ring).
        dockModeSoundPref: "systemsettings",
        // Settings > Exhibition (Phoenix): exhibitions on the Touchstone at
        // all; startAfter, seconds on the charger with the screen on before
        // the exhibition starts (0: when the screen would turn off, as
        // DisplayOnPuck waited); night mode, the screen at its night
        // brightness (Settings.cpp:184 DockModeNightBrightness) from
        // nightStart to nightEnd ("HH:MM").
        exhibition: { enabled: true, startAfter: 0, nightMode: false, nightStart: "22:00", nightEnd: "07:00" },
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
        // Settings > Screen & Lock > Show previews (Phoenix; the community's
        // private notification patches): off, the lock screen hides who
        // sent what ("New Message").
        lockScreenPreviews: true,
        // Settings > Sounds & Ringtones > Repeat alerts (Phoenix; the
        // community's Notification Repeat patches): a notification's sound
        // again every `minutes` until it is seen, for every app but those
        // set false in `apps`.
        notificationRepeat: { enabled: false, minutes: 2, apps: {} },
        blinkNotifications: true,
        // Screen & Lock: seconds until the screen turns off (Phoenix's key
        // for the original's com.palm.display timeout), and how long it
        // stays locked before the PIN or password is asked for ("Lock
        // after"; 0: as soon as the screen is off).
        screenTimeout: 60,
        lockTimeout: 0,
        // The backlight follows the light sensor (LunaSysMgr's Preferences
        // "enableALS", Preferences.cpp:83, :709-714; DisplayManager::
        // getDisplayBrightness, :2065-2082).
        enableALS: true,
        // Screen & Lock > Advanced gestures: LunaSysMgr's key. A long swipe
        // across the gesture area switches apps (phones). On by default in
        // Phoenix (the owner's choice; LunaSysMgr shipped it off): a choice
        // the user saved is kept, only the default changed.
        sysUiEnableNextPrevGestures: true,
        // Settings > Apps > Opening a running app (Phoenix): what opening an
        // app that already has a card does. "front" brings its card to the
        // front as it is (the original's card, keeping its state); "refresh"
        // also relaunches it, as LunaSysMgr relaunched a running app on
        // every launch (Mojo's handleLaunch, Enyo's windowParamsChange), so
        // it reloads its data; "new" opens another card of it.
        appRelaunch: "front",
        // Settings > Text Assist > Hardware keyboard: the shell's shortcut
        // scheme, "ipad" or "desktop" (Phoenix).
        keyboardShortcuts: "ipad",
        // Text Assist (conf/defaultPreferences.txt x_palm_textinput): the
        // original's checks, and Phoenix's list of the user's shortcuts
        // (Settings > Text Assist > Shortcuts), [{shortcut, text}], which
        // the keyboard's space bar puts in while shortcutChecking is not "off".
        x_palm_textinput: { spellChecking: "autoCorrect", grammarChecking: "autoCorrect", shortcutChecking: "autoCorrect", shortcuts: [] },
        // Settings > Advanced (docs/M6-PLAN.md F4, the community's Tweaks).
        // LunaCE's own keys where it had the option (its Tweaks files in
        // webOS CE 3.1.0, AddToImage/LunaCE-Tweaks/*.json), off as there:
        // card view wraps from the last card to the first
        // (abh_features.json), a tap on a side card maximizes it
        // (maximize-edges.json), the tap ripple (tap-ripple.json, on); the
        // wave launcher (wave-launcher.json) is on by default in Phoenix
        // (the owner's choice; LunaCE shipped it off).
        infiniteCardCyclingEnabled: false,
        sysUiEnableMaximizeEdges: false,
        sysUiEnableWaveLauncher: true,
        showReticleAnimation: true,
        // Phoenix's: the shell's animations "normal" or "fast" (the Faster
        // Card Animations patches); how far a swipe goes before it counts,
        // "low", "normal" or "high" (Buttah); a vibration on every tap
        // (Haptic Feedback Manager); the launcher's grid, "normal" or
        // "dense" (the icon grid patches); the battery's percentage in the
        // status bar (Battery Percent and Icon); the keyboard's number row;
        // the keyboard's look, "auto" (the phone's black keys on a phone,
        // the TouchPad's on a tablet), "black" or "touchpad".
        animationSpeed: "normal",
        gestureSensitivity: "normal",
        hapticFeedback: false,
        launcherGridDensity: "normal",
        showBatteryPercent: false,
        keyboardNumberRow: false,
        keyboardStyle: "auto",
        // Phoenix's start-up animation: "phoenix" (the bird's story,
        // BootStory.qml) or "classic" (the original logo's glow).
        startupAnimation: "phoenix",
        // The keyboard button (with a hardware keyboard, the button that
        // brings the on-screen keyboard up; Settings > Text Assist >
        // Keyboard button, or its hold menu's Hide): shown; the edge it was
        // dragged to and its height there (0 top, 1 bottom); whether the
        // banner saying where to turn it back on was shown.
        keyboardButton: true,
        keyboardButtonSide: "right",
        keyboardButtonY: 1,
        keyboardButtonHintShown: false,
        // Email's new-mail dashboard goes through the new emails one at a
        // time, with their times and a delete button (the community's
        // Uber Cycling Email Dashboard; compat overlay of the Email app).
        emailDashboardCycling: false,
        // The browser's Preferences (Phoenix; docs/M6-PLAN.md F4): its page
        // views' requests to the content blocker's hosts fail; the user
        // agent they send, "mobile" (webOS's) or "desktop".
        browserContentBlocker: false,
        browserUserAgent: "mobile",
        // Settings > Wi-Fi > Proxy (Phoenix): {type: "none" | "http" |
        // "socks", host, port}, the system's proxy for every page.
        networkProxy: { type: "none", host: "", port: 0 },
        // DropShare (Phoenix): files to and from other devices on the
        // network, off until the user allows it (Settings > DropShare).
        dropShareEnabled: false,
        firstUse: false
    };

    // Settings > Sounds & Ringtones > Repeat alerts, checked.
    function notificationRepeat(r) {
        r = r && typeof r === "object" ? r : {};
        var apps = {};
        if (r.apps && typeof r.apps === "object")
            for (var a in r.apps) apps[a] = r.apps[a] !== false;
        return { enabled: !!r.enabled, minutes: typeof r.minutes === "number" && r.minutes > 0 ? r.minutes : 2, apps: apps };
    }

    // Settings > Apps > Opening a running app, as the shell takes it.
    function appRelaunch(v) {
        return v === "refresh" || v === "new" ? v : "front";
    }

    // Settings > Advanced, as the shell takes them (hostStatus tweaks).
    function tweaks(p) {
        var pick = function (v, allowed, d) { return allowed.indexOf(v) >= 0 ? v : d; };
        return {
            infiniteCardCycling: !!p.infiniteCardCyclingEnabled,
            maximizeEdges: !!p.sysUiEnableMaximizeEdges,
            waveLauncher: p.sysUiEnableWaveLauncher !== false,
            tapRipple: p.showReticleAnimation !== false,
            animationSpeed: pick(p.animationSpeed, ["normal", "fast"], "normal"),
            gestureSensitivity: pick(p.gestureSensitivity, ["low", "normal", "high"], "normal"),
            haptics: !!p.hapticFeedback,
            gridDensity: pick(p.launcherGridDensity, ["normal", "dense"], "normal"),
            batteryPercent: !!p.showBatteryPercent,
            numberRow: !!p.keyboardNumberRow,
            keyboardStyle: pick(p.keyboardStyle, ["auto", "black", "touchpad"], "auto"),
            startupAnimation: pick(p.startupAnimation, ["phoenix", "classic"], "phoenix"),
            keyboardButton: p.keyboardButton !== false,
            keyboardButtonSide: pick(p.keyboardButtonSide, ["left", "right"], "right"),
            keyboardButtonY: typeof p.keyboardButtonY === "number" && p.keyboardButtonY >= 0 && p.keyboardButtonY <= 1 ? p.keyboardButtonY : 1,
            keyboardButtonHintShown: !!p.keyboardButtonHintShown
        };
    }
    // The page views' settings and the system proxy, as the shell takes
    // them (hostStatus browser, proxy; phoenix-sim's simBrowser).
    function browserSettings(p) {
        return { contentBlocker: !!p.browserContentBlocker, userAgent: p.browserUserAgent === "desktop" ? "desktop" : "mobile" };
    }
    function networkProxy(x) {
        x = x && typeof x === "object" ? x : {};
        var type = x.type === "http" || x.type === "socks" ? x.type : "none";
        var port = Math.round(Number(x.port));
        var host = String(x.host || "").trim();
        if (type !== "none" && (!host || !(port > 0 && port < 65536))) type = "none";
        return type === "none" ? { type: "none", host: "", port: 0 } : { type: type, host: host, port: port };
    }
    runtime.networkProxy = networkProxy;
    var TWEAK_KEYS = ["infiniteCardCyclingEnabled", "sysUiEnableMaximizeEdges", "sysUiEnableWaveLauncher", "showReticleAnimation",
                      "animationSpeed", "gestureSensitivity", "hapticFeedback", "launcherGridDensity", "showBatteryPercent",
                      "keyboardNumberRow", "keyboardStyle", "startupAnimation",
                      "keyboardButton", "keyboardButtonSide", "keyboardButtonY",
                      "keyboardButtonHintShown"];

    // Settings > Accessibility's keyboard options, as the shell takes them.
    function keyboardAccess(a) {
        var ms = function (v) { return typeof v === "number" && v > 0 ? Math.round(v) : 0; };
        return {
            stickyKeys: !!a.stickyKeys,
            slowKeys: ms(a.slowKeys),
            bounceKeys: ms(a.bounceKeys),
            customRepeat: typeof a.keyRepeatDelay === "number",
            repeatDelay: typeof a.keyRepeatDelay === "number" ? Math.max(0, Math.round(a.keyRepeatDelay)) : 500,
            repeatInterval: ms(a.keyRepeatInterval) || 50
        };
    }

    function prefs() {
        var p = store.get("prefs", {});
        var out = {};
        for (var k in defaultPrefs) out[k] = defaultPrefs[k];
        for (k in p) out[k] = p[k];
        return out;
    }

    // Settings > Accessibility > Reduce motion and Settings > Advanced >
    // Animation speed, for the page's own animations: @phoenix/ui reads
    // data-phoenix-motion on the root element ("reduce", "fast" or "normal";
    // motion.ts), as the shell's Theme.motion() does the same settings.
    function applyMotion() {
        try {
            var root = global.document && global.document.documentElement;
            if (!root) return;
            var p = prefs();
            root.setAttribute("data-phoenix-motion", p.accessibility && p.accessibility.reduceMotion ? "reduce"
                                                     : p.animationSpeed === "fast" ? "fast" : "normal");
        } catch (e) { /* no document */ }
    }
    applyMotion();

    var prefWatchers = [];
    // Another page (another card, Settings) changed the preferences: this
    // page's getPreferences subscribers hear the keys that changed, as on
    // the bus (luna-sysservice tells every subscriber).
    var prefsSeen = JSON.stringify(store.get("prefs", {}));
    try {
        global.addEventListener("storage", function (e) {
            if (e.key !== "phoenix:prefs") return;
            var before = {}, after = store.get("prefs", {}), changed = {}, any = false, k;
            try { before = JSON.parse(prefsSeen) || {}; } catch (err) { before = {}; }
            prefsSeen = JSON.stringify(after);
            for (k in after)
                if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) { changed[k] = after[k]; any = true; }
            if (any) prefWatchers.forEach(function (w) { w(changed); });
            if ("accessibility" in changed || "animationSpeed" in changed) applyMotion();
        });
    } catch (e) { /* no window */ }

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
            prefsSeen = JSON.stringify(saved);
            reply(ok());
            if ("accessibility" in p || "animationSpeed" in p) applyMotion();
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
    // {appsVersion}): read the list again and tell launchPointChanges
    // (ApplicationManager::postLaunchPointChange: the launch point's record
    // and change "added" | "removed" | "updated") and whoever else listens
    // (runtime.onAppsChanged(fn(before, after, info))). info: {appId, cause}
    // when an app was removed, for notifyOnChange.
    var appsChangedListeners = [];
    runtime.onAppsChanged = function (fn) { appsChangedListeners.push(fn); };
    function appsChanged(info) {
        var before = launchPoints();
        launchPointCache = null;
        var after = launchPoints(), was = {}, now = {};
        before.forEach(function (lp) { was[lp.launchPointId] = lp; });
        after.forEach(function (lp) { now[lp.launchPointId] = lp; });
        var changes = [];
        after.forEach(function (lp) {
            var old = was[lp.launchPointId];
            if (!old) changes.push(Object.assign({ change: "added" }, lp));
            else if (old.icon !== lp.icon || old.title !== lp.title || old.version !== lp.version)
                changes.push(Object.assign({ change: "updated" }, lp));
        });
        before.forEach(function (lp) {
            if (!now[lp.launchPointId]) changes.push(Object.assign({ change: "removed" }, lp));
        });
        changes.forEach(function (c) {
            launchPointWatchers = launchPointWatchers.filter(function (w) { return w(c) !== false; });
        });
        appsChangedListeners.forEach(function (fn) {
            try { fn(before, after, info || null); } catch (e) { console.error("[phoenix-runtime] apps changed", e); }
        });
    }
    runtime.appsChanged = appsChanged;

    function visibleLaunchPoints() {
        return launchPoints().filter(function (lp) { return !lp.hidden && developerShown(lp); });
    }

    // ---- Developer apps (docs/APP-RUNTIME.md "Developer apps") --------------------------
    //
    // appinfo.json "phoenix": {"developer": true} (the record's developer
    // "devmode"): the app or launch point is left out of listLaunchPoints
    // and searchApps (the launcher, Just Type, the Assistant) unless
    // Developer Mode is on. "unlock": unless Developer Mode was revealed
    // (the devModeUnlocked system preference: Just Type's Konami code) or
    // is on; Settings' Developer Mode launch point. Each change of either
    // tells launchPointChanges the launch points that came and went, in
    // every page (the storage event), as an install would.
    function developerShown(lp) {
        if (!lp.developer || store.get("devMode", false)) return true;
        return lp.developer === "unlock" && !!prefs().devModeUnlocked;
    }
    var developerSeen = null;   // launchPointId -> shown, for the developer ones
    function developerGateChanged() {
        var before = developerSeen, now = {}, changes = [];
        launchPoints().forEach(function (lp) {
            if (!lp.developer || lp.hidden) return;
            now[lp.launchPointId] = developerShown(lp);
            if (before && now[lp.launchPointId] !== !!before[lp.launchPointId])
                changes.push(Object.assign({ change: now[lp.launchPointId] ? "added" : "removed" }, lp));
        });
        developerSeen = now;
        changes.forEach(function (c) {
            launchPointWatchers = launchPointWatchers.filter(function (w) { return w(c) !== false; });
        });
    }
    runtime.developerGateChanged = developerGateChanged;
    try {
        global.addEventListener("storage", function (e) {
            if (e.key === "phoenix:devMode" || e.key === "phoenix:prefs") developerGateChanged();
        });
    } catch (e) { /* no window */ }
    // Just Type's Konami code: luna-applauncher shows "Developer Mode
    // Enabler" (com.palm.app.devmodeswitcher) when the search field holds
    // exactly "upupdowndownleftrightleftrightbastart" or "webos20090606"
    // (app/LaunchPointSearch.js:30-36, 137-139), and launches it when tapped
    // or on Enter (:194-214, 226-231). Phoenix has no switcher app: its
    // launch reveals Settings' Developer Mode (devModeUnlocked, for good)
    // and opens it there (APP_ALIASES).
    var DEVMODE_SWITCHER = "com.palm.app.devmodeswitcher";
    function revealDeveloperMode(id) {
        if (id !== DEVMODE_SWITCHER || prefs().devModeUnlocked === true) return;
        dispatch("palm://com.palm.systemservice/setPreferences", { devModeUnlocked: true }, function () {},
                 { cancelled: function () { return false; } });
    }

    var resourceHandlers = null;
    function redirectList() {
        if (!resourceHandlers) {
            try { resourceHandlers = JSON.parse(PalmSystem.getResource("/usr/palm/command-resource-handlers.json") || "{}").redirects || []; }
            catch (e) { resourceHandlers = []; }
        }
        return resourceHandlers;
    }
    // The app for a web address or scheme (the redirect handlers below:
    // the active one of the first pattern that matches).
    function resourceHandler(target) {
        return runtime.redirectHandlerFor(target);
    }
    // An installed web app's scope as its redirect pattern: http or https,
    // the site with or without "www." or "m.", and the scope's path (the
    // shell's Links.scopePattern, shell/qml/Phoenix/Sim/Links.js, keeps the
    // site's own links in its card by the same pattern).
    function sitePattern(scope) {
        var esc = function (x) { return x.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); };
        var m = /^https?:\/\/(?:www\.|m\.)?([^\/?#]+)(.*)$/i.exec(String(scope || ""));
        if (!m) return "";
        var path = m[2] || "/";
        if (path.charAt(0) !== "/") path = "/" + path;
        var tail = path.charAt(path.length - 1) === "/" ? esc(path.slice(0, -1)) + "(?:[/?#]|$)" : esc(path);
        return "^https?://(?:www\\.|m\\.)?" + esc(m[1]) + "(?::\\d+)?" + tail;
    }
    runtime.sitePattern = sitePattern;

    // The handler registry apps add to (addResourceHandler,
    // addRedirectHandler), and the handlers made active
    // (swapResourceHandler, swapRedirectHandler), in the shared store, as
    // MimeSystem kept its table in a file (saveMimeTableToActiveFile).
    // Indexes of handlers added at run time start at 1000.
    var HANDLER_REGISTRY = "appManager:handlers";
    runtime.handlerRegistry = function () {
        var r = store.get(HANDLER_REGISTRY, null) || {};
        r.resources = r.resources || [];
        r.redirects = r.redirects || [];
        r.activeResource = r.activeResource || {};
        r.activeRedirect = r.activeRedirect || {};
        r.next = r.next || 1000;
        return r;
    };
    runtime.saveHandlerRegistry = function (r) { store.set(HANDLER_REGISTRY, r); };

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
        "com.palm.app.textassist": { id: "org.webosphoenix.settings", params: { page: "textassist" } },
        // Just Type's preferences (luna-applauncher AppLauncher.js
        // launchPreferences, from Just Type's app menu).
        "com.palm.app.searchpreferences": { id: "org.webosphoenix.settings", params: { page: "justtype" } },
        // The Certificate Manager (Device Info's menu, Email's "Open
        // Certificate Manager", ApplicationManagerService.cpp:3822).
        "com.palm.app.certificate": { id: "org.webosphoenix.settings", params: { page: "certificates" } },
        // Help: Enyo 1.0's HelpMenu (every original app's "Help", Just
        // Type's too) opens com.palm.app.help with {target:
        // "http://help.palm.com/<area>/index.html"}; Phoenix's Help opens the
        // matching topic (HELP_TOPICS), else its list.
        "com.palm.app.help": "org.webosphoenix.help",
        // Photos & Videos, the default exhibition (conf/default-exhibition-apps.json),
        // the Agenda exhibition, and Exhibition preferences, a Settings page now.
        "com.palm.app.photos": "org.webosphoenix.photos",
        "com.palm.app.agendaview": "org.webosphoenix.agenda",
        "com.palm.app.exhibitionpreferences": { id: "org.webosphoenix.settings", params: { page: "exhibition" } },
        // The Developer Mode Enabler (Just Type's Konami code; revealDeveloperMode).
        "com.palm.app.devmodeswitcher": { id: "org.webosphoenix.settings", params: { page: "devmode" } },
        // The App Catalog, the Marketplace now. "Find More..." at the end of
        // the accounts library's "Add an Account" list opens it with
        // {common: {sceneType: "search", params: {type: "connector",
        // connectorInfo: {searchBarTitle, searchBarIcon, types}}}}
        // (enyo-1.0 lib/accounts/source/add-account.js:85-92,
        // entry-first-launch.js:265-271); the Marketplace gets those params
        // as they are and opens Connections.
        "com.palm.app.enyo-findapps": "org.webosphoenix.marketplace"
    };
    var HELP_TOPICS = { universalsearch: "justtype", accountsmgr: "accounts", phone: "phone", messaging: "messaging",
                        camera: "camera", photos: "photos", music: "music", launcher: "launcher", notifications: "notifications" };
    function appId(id) {
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
    runtime.appAliases = APP_ALIASES;

    // Exhibition (dock mode) apps: the ones that can be (appinfo.json
    // "exhibitionMode" / "dockMode", from the app list) and the ones the user
    // turned on, in the order dock mode's menu lists them after Time
    // (DockModePositionManager's exhibitionApps; default Photos, as
    // conf/default-exhibition-apps.json). At most dockModeMaxApps
    // (Settings.cpp:183). The shell hears the list in systemStatus
    // {exhibitionApps}.
    var DOCK_MODE_MAX_APPS = 3;
    var DEFAULT_EXHIBITION_APPS = ["org.webosphoenix.photos"];
    var dockModeWatchers = [];
    function exhibitionApps() {
        var list = store.get("exhibitionApps", null);
        return Array.isArray(list) ? list : DEFAULT_EXHIBITION_APPS.slice();
    }
    function setExhibitionApps(list) {
        store.set("exhibitionApps", list);
        dockModeWatchers = dockModeWatchers.filter(function (w) { return w() !== false; });
        if (runtime.hostStatus) host.postToHost("systemStatus", runtime.hostStatus());
    }
    function dockModeLaunchPoints() {
        var on = exhibitionApps();
        return launchPoints().filter(function (lp) {
            return lp.exhibitionMode === true && /_default$/.test(lp.launchPointId);
        }).map(function (lp) {
            var r = {}, k;
            for (k in lp) r[k] = lp[k];
            r.appId = lp.id;
            r.exhibitionModeTitle = lp.exhibitionModeTitle || lp.title;
            r.enabled = on.indexOf(lp.id) >= 0;
            return r;
        });
    }
    // Those turned on, in order (the shell shows the ones it has as
    // exhibitions: an app removed since drops out there).
    runtime.exhibitionApps = exhibitionApps;

    // The process id of the app a launch or open has just started (the
    // host started it from the "launch" message before it reads this
    // request): the one /running lists and /close takes
    // (ApplicationManagerService.cpp's launch replies {processId} from
    // WebAppMgr). "" when the host keeps no processes (no shell, or one
    // that cannot answer: the launch is answered all the same, and soon).
    function launchedProcessId(id, params) {
        if (!runtime.hostOp) return Promise.resolve("");
        var asked = Promise.resolve().then(function () {
            return runtime.hostOp("processId", { appId: id, params: params || {} });
        }).then(function (r) {
            return r && r.ok && typeof r.processId === "string" ? r.processId : "";
        }, function () { return ""; });
        var late = new Promise(function (resolve) { setTimeout(function () { resolve(""); }, 2000); });
        return Promise.race([asked, late]);
    }
    runtime.launchedProcessId = launchedProcessId;
    function launchedReply(reply, id, params, extra) {
        launchedProcessId(id, params).then(function (pid) {
            reply(ok(Object.assign(pid ? { processId: pid } : {}, extra || {})));
        });
    }
    runtime.launchedReply = launchedReply;

    register(["com.palm.applicationManager", "com.webos.applicationManager"], {
        // {newCard: true} (Phoenix): another card of the app in a stack of
        // its own, even while one runs (the shell's appRelaunch "new" for
        // this launch; one-card apps such as the phone keep theirs).
        // {behind: true} (Phoenix): the app opens (or hears its new params)
        // without its card coming to the front: the Assistant's "I've opened
        // them in Photos too", while the conversation stays in front.
        // {returnToCaller: true} (Phoenix): Back at the opened app's first
        // view returns to the app that opened it (runtime.back below): the
        // caller rides in the params as $caller.
        "/launch": function (p, reply) {
            revealDeveloperMode(p.id);
            var params = aliasParams(p.id, p.params);
            var caller = appIdFromLocation();
            if (p.returnToCaller === true && caller && ["com.palm.systemui", "com.palm.launcher", "com.webos.phoenix.unknown"].indexOf(caller) < 0 && caller !== appId(p.id))
                params = Object.assign({}, params || {}, { $caller: caller });
            host.postToHost("launch", Object.assign({ id: appId(p.id), params: params },
                                                    p.newCard === true ? { newCard: true } : {},
                                                    p.behind === true ? { behind: true } : {}));
            launchedReply(reply, appId(p.id), params);
        },
        // As on webOS: {id, params} launches the app; {target} goes to the
        // app that handles it (command-resource-handlers.json: mailto: to
        // Email...), web pages to the browser or the web app whose site it
        // is. A target nothing handles fails, "No handler for <target>"
        // (ApplicationManagerService.cpp:1438-1446), and the shell says so.
        // $from (the shell's, for a link in a card that has no runtime of
        // its own): the card the app is opened from.
        "/open": function (p, reply) {
            revealDeveloperMode(p.id);
            var handler = appId(p.id) || (p.target && resourceHandler(p.target));
            var from = typeof p.$from === "string" ? { from: p.$from } : {};
            if (handler) {
                var launchParams = p.id ? aliasParams(p.id, p.params) : { target: p.target };
                host.postToHost("launch", Object.assign({ id: handler, params: launchParams }, from));
                return launchedReply(reply, handler, launchParams);
            }
            host.postToHost("open", Object.assign({ target: p.target, params: p.params || {} }, from));
            reply({ returnValue: false, errorCode: -1, errorText: "No handler for " + (p.target || p.id || "") });
        },
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
            if (!developerSeen) developerGateChanged();
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
        // ---- Exhibition (dock mode) apps (ApplicationManagerService.cpp:2486-2985) ----
        // Every app whose appinfo.json says "exhibitionMode" (or "dockMode")
        // true, each with exhibitionModeTitle and whether the user turned it
        // on ("enabled"); the built-in Time exhibition is the shell's own and
        // always there, so it is not listed.
        "/listDockModeLaunchPoints": function (p, reply, ctx) {
            var send = function () { reply(ok({ launchPoints: dockModeLaunchPoints(), maxApps: DOCK_MODE_MAX_APPS })); };
            send();
            // Phoenix: {subscribe: true} hears every change of the list.
            if (p.subscribe) dockModeWatchers.push(function () {
                if (ctx.cancelled()) return false;
                send();
                return true;
            });
        },
        // {appId}: shown in dock mode's menu from now on, after the others.
        "/addDockModeLaunchPoint": function (p, reply) {
            var id = appId(String(p.appId || "")), list = exhibitionApps();
            if (!dockModeLaunchPoints().some(function (lp) { return lp.id === id; }))
                return reply(fail(-1, "Not an exhibition app: " + id));
            if (list.indexOf(id) < 0 && list.length >= DOCK_MODE_MAX_APPS)
                return reply(fail(-2, "At most " + DOCK_MODE_MAX_APPS + " exhibition apps can be on"));
            setExhibitionApps(list.filter(function (a) { return a !== id; }).concat([id]));
            reply(ok());
        },
        "/removeDockModeLaunchPoint": function (p, reply) {
            var id = appId(String(p.appId || ""));
            setExhibitionApps(exhibitionApps().filter(function (a) { return a !== id; }));
            reply(ok());
        },
        // Phoenix: {appIds}: the exhibitions that are on, in the menu's order
        // (Settings > Exhibition reorders them).
        "/setDockModeLaunchPoints": function (p, reply) {
            var ids = (Array.isArray(p.appIds) ? p.appIds : []).map(function (a) { return appId(String(a)); });
            var known = dockModeLaunchPoints().map(function (lp) { return lp.id; });
            var bad = ids.filter(function (a) { return known.indexOf(a) < 0; });
            if (bad.length) return reply(fail(-1, "Not an exhibition app: " + bad[0]));
            if (ids.length > DOCK_MODE_MAX_APPS) return reply(fail(-2, "At most " + DOCK_MODE_MAX_APPS + " exhibition apps can be on"));
            setExhibitionApps(ids.filter(function (a, i) { return ids.indexOf(a) === i; }));
            reply(ok());
        },
        "/getHandlerForMimeType": function (p, reply) { reply(fail(-1, "no handler")); },
        "/listAllHandlersForMime": function (p, reply) { reply(ok({ resources: [] })); }
    });

    // ---- Application manager: launch points apps add, processes, dock mode ----------------
    // (luna-sysmgr Src/base/application/ApplicationManagerService.cpp; the
    // host does what needs it through runtime.hostOp, "Installing apps".)
    (function appManagerMore() {
        var am = runtime.services["com.palm.applicationManager"];
        function app(id) {
            return launchPoints().filter(function (lp) { return /_default$/.test(lp.launchPointId) && lp.id === id; })[0] || null;
        }
        function hostOp(op, payload) {
            return runtime.hostOp ? runtime.hostOp(op, payload) : Promise.resolve({ ok: false, error: "No host" });
        }

        // addLaunchPoint {id, title, icon, params, removable, appmenu}: a
        // launcher icon of the app's own, starting it with these launch
        // params (the browser's Share > Add to Launcher). It goes on the
        // launcher's Favorites page. -> {launchPointId} (eight digits, as
        // LunaSysMgr's). The icon is a path; a relative one is the app's.
        am["/addLaunchPoint"] = function (p, reply) {
            var id = typeof p.id === "string" ? p.id : "";
            if (!id || typeof p.title !== "string" || !p.title) return reply(fail(-1, "Invalid arguments"));
            if (!app(id)) return reply(fail(-1, "Unable to find id: " + id));
            var params = p.params;
            if (typeof params === "string") {
                try { params = params ? JSON.parse(params) : {}; } catch (e) { return reply(fail(-1, "Invalid arguments")); }
            }
            if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params)))
                return reply(fail(-1, "Invalid arguments"));
            hostOp("addLaunchPoint", { appId: id, launchPoint: {
                id: id, title: p.title, appmenu: p.appmenu || p.appMenu || p.title,
                icon: typeof p.icon === "string" ? p.icon : "", params: params || {}, removable: p.removable !== false } }).then(function (r) {
                if (!r.ok || !r.launchPointId) return reply(fail(-1, r.error || "Failed to save launch point"));
                reply(ok({ launchPointId: r.launchPointId }));
            });
        };
        // removeLaunchPoint {launchPointId}: one an app added (never an
        // app's own default one).
        am["/removeLaunchPoint"] = function (p, reply) {
            if (typeof p.launchPointId !== "string" || !p.launchPointId) return reply(fail(-1, "Must provide a launchPointId"));
            hostOp("removeLaunchPoint", { launchPointId: p.launchPointId }).then(function (r) {
                reply(r.ok ? ok() : fail(-1, r.error || "launch point [" + p.launchPointId + "] not found"));
            });
        };
        // The apps running, with their process ids ({running: [{id,
        // processid}]}; system and headless ones too).
        am["/running"] = function (p, reply) {
            hostOp("running", {}).then(function (r) {
                reply(r.ok ? ok({ running: r.running || [] }) : fail(-1, r.error || "Not available"));
            });
        };
        // close {processId}: closes the app (its cards and its headless
        // page), keep-alive or not. True whenever the call is well formed,
        // as on webOS.
        am["/close"] = function (p, reply) {
            if (typeof p.processId !== "string" || !p.processId) return reply(fail(-1, "Must provide a valid processId to close"));
            hostOp("close", { processId: p.processId }).then(function () { reply(ok()); });
        };
        // install {target}: a package file, as com.palm.appinstaller's
        // install (LunaSysMgr downloaded web addresses first; here only
        // files on the device).
        am["/install"] = function (p, reply) {
            var target = String(p.target || "").replace(/^file:\/\//, "");
            if (!target || !/\.ipk$/i.test(target)) return reply(fail(-1, "Not a valid install target"));
            var l = runtime.legacyInstall;
            if (!l) return reply(fail(-1, "Installing apps is not available"));
            var first = true;
            l({ target: target }, function (r) {
                if (!first) return;
                first = false;
                reply(r.returnValue === false ? fail(-1, "Not a valid install target") : ok());
            }, { cancelled: function () { return !first; }, onCancel: null });
        };
        // rescan: read the installed apps again.
        am["/rescan"] = function (p, reply) {
            hostOp("rescan", {}).then(function (r) { reply(r.ok ? ok() : fail(-1, r.error || "Rescan failed")); });
        };
        // getSizeOfApps {appIds, includeDbSize} -> {<appId>: bytes, ...}
        // (subscribed false, as the original). Apps keep their data in the
        // shared store here, so includeDbSize adds nothing.
        am["/getSizeOfApps"] = function (p, reply) {
            if (!Array.isArray(p.appIds)) return reply({ subscribed: false, returnValue: false, errorCode: "Missing appIds parameter" });
            var r = { subscribed: false, returnValue: true };
            p.appIds.forEach(function (id) {
                var a = app(String(id));
                r[String(id)] = a ? Number(a.appSize || a.size || 0) : 0;
            });
            reply(r);
        };
        // The apps being installed, as launch points (listPendingLaunchPoints).
        am["/listPendingLaunchPoints"] = function (p, reply) {
            var pending = runtime.pendingInstalls ? runtime.pendingInstalls() : {};
            reply(ok({ launchPoints: Object.keys(pending).map(function (id) {
                var st = pending[id];
                return { id: id, appId: id, launchPointId: id + "_default", title: st.title || id, icon: st.icon || "",
                         progress: st.progress || 0, state: st.state, removable: true };
            }) }));
        };

        // Exhibition launch points: listDockModeLaunchPoints and the others
        // are with the application manager's own methods above.
        // LunaSysMgr's own dock list was empty (dockLaunchPoints, ApplicationManager.cpp:785-789).
        am["/listDockPoints"] = function (p, reply) { reply(ok({ dockPoints: [] })); };

        // ---- Redirect handlers: apps for web addresses and schemes -----------------------
        // From /usr/palm/command-resource-handlers.json and http(s) to the
        // browser (tag "system-default"), the installed web apps' sites
        // (their manifest's scope, "siteScope" in the app list; tag "user"
        // like those apps add, and gone with the app), and those apps add
        // (addRedirectHandler; tag "user"), kept in the shared store as
        // MimeSystem saved its table. The first for a pattern is active
        // until swapRedirectHandler picks another; each has an index.
        // A scheme form is a whole scheme ("^mailto:", "^https?:"); the
        // others are web addresses ("^https?://maps\.google\.").
        function schemeForm(pattern) { return /^\^[a-z][a-z0-9+.-]*\??:$/i.test(pattern); }
        function urlHandlers() {
            var reg = runtime.handlerRegistry(), out = [], i = 0;
            redirectList().forEach(function (h) {
                out.push({ url: h.url, appId: h.appId, index: ++i, tag: "system-default", schemeForm: h.schemeForm !== undefined ? !!h.schemeForm : schemeForm(h.url) });
            });
            out.push({ url: "^https?:", appId: "com.palm.app.browser", index: ++i, tag: "system-default", schemeForm: true });
            launchPoints().filter(function (lp) { return lp.siteScope && /_default$/.test(lp.launchPointId); })
                .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })
                .forEach(function (lp, k) {
                    var pattern = sitePattern(lp.siteScope);
                    if (pattern) out.push({ url: pattern, appId: lp.id, index: 2000 + k, tag: "user", schemeForm: false });
                });
            reg.redirects.forEach(function (h) { out.push(Object.assign({ tag: "user" }, h)); });
            return out;
        }
        // The handlers whose pattern matches, a group per pattern: web
        // addresses before whole schemes, as the original looked for a
        // redirect handler first and a scheme ("command") handler last
        // (ApplicationManagerService.cpp:1320 and :1428, MimeSystem.cpp:
        // getActiveHandlerForRedirect with disallowSchemeForms), so a site's
        // own app wins over the browser.
        function urlMatches(url) {
            var reg = runtime.handlerRegistry(), groups = {}, order = [];
            urlHandlers().forEach(function (h) {
                var re;
                try { re = new RegExp(h.url, "i"); } catch (e) { return; }
                if (!re.test(url)) return;
                if (!groups[h.url]) { groups[h.url] = []; order.push(h.url); }
                groups[h.url].push(h);
            });
            order = order.filter(function (u) { return !groups[u][0].schemeForm; })
                .concat(order.filter(function (u) { return groups[u][0].schemeForm; }));
            return order.map(function (pattern) {
                var list = groups[pattern], active = reg.activeRedirect[pattern];
                var a = list.filter(function (h) { return h.index === active; })[0] || list[0];
                return { pattern: pattern, active: a, alternates: list.filter(function (h) { return h !== a; }) };
            });
        }
        function withName(h) {
            var a = app(h.appId);
            return Object.assign({}, h, { appName: a ? a.title : h.appId });
        }
        runtime.redirectHandlerFor = function (url) {
            var m = urlMatches(String(url || ""))[0];
            return m ? m.active.appId : null;
        };
        am["/addRedirectHandler"] = function (p, reply) {
            if (typeof p.appId !== "string" || !p.appId) return reply({ subscribed: false, returnValue: false, errorCode: "Missing appId parameter" });
            if (typeof p.urlPattern !== "string" || !p.urlPattern) return reply({ subscribed: false, returnValue: false, errorCode: "Missing urlPattern parameter" });
            if (p.schemeForm !== undefined && typeof p.schemeForm !== "boolean")
                return reply({ subscribed: false, returnValue: false, errorCode: "schemeForm parameter incorrectly specified (should be a boolean value)" });
            try { new RegExp(p.urlPattern); } catch (e) { return reply({ subscribed: false, returnValue: false, errorCode: "adding handler failed" }); }
            if (!app(p.appId)) return reply({ subscribed: false, returnValue: false, errorCode: "adding handler failed" });
            var reg = runtime.handlerRegistry();
            if (!reg.redirects.some(function (h) { return h.appId === p.appId && h.url === p.urlPattern; })) {
                reg.redirects.push({ url: p.urlPattern, appId: p.appId, schemeForm: !!p.schemeForm, index: reg.next++ });
                runtime.saveHandlerRegistry(reg);
            }
            reply({ subscribed: false, returnValue: true });
        };
        am["/swapRedirectHandler"] = function (p, reply) {
            var pattern = String(p.url || ""), index = Number(p.index);
            var h = urlHandlers().filter(function (x) { return x.url === pattern && x.index === index; })[0];
            if (!h) return reply({ subscribed: false, returnValue: false, errorCode: "swap failed (incorrect index for url, perhaps?)" });
            var reg = runtime.handlerRegistry();
            reg.activeRedirect[pattern] = index;
            runtime.saveHandlerRegistry(reg);
            reply({ subscribed: false, returnValue: true });
        };
        am["/listAllHandlersForUrl"] = function (p, reply) {
            var url = String(p.url || ""), m = urlMatches(url)[0];
            if (!m) return reply({ subscribed: false, url: url, returnValue: false, errorCode: "No handlers found for " + url });
            var r = { activeHandler: withName(m.active) };
            if (m.alternates.length) r.alternates = m.alternates.map(withName);
            reply({ subscribed: false, url: url, returnValue: true, redirectHandlers: r });
        };
        am["/listAllHandlersForUrlPattern"] = function (p, reply) {
            var pattern = String(p.urlPattern || p.url || "");
            var list = urlHandlers().filter(function (h) { return h.url === pattern; });
            if (!list.length) return reply({ subscribed: false, returnValue: false, errorCode: "No handlers found for " + pattern });
            var reg = runtime.handlerRegistry(), active = list.filter(function (h) { return h.index === reg.activeRedirect[pattern]; })[0] || list[0];
            var r = { activeHandler: withName(active) };
            var alt = list.filter(function (h) { return h !== active; });
            if (alt.length) r.alternates = alt.map(withName);
            reply({ subscribed: false, urlPattern: pattern, returnValue: true, redirectHandlers: r });
        };
        am["/listRedirectHandlers"] = function (p, reply) {
            reply(ok({ redirectHandlers: urlHandlers().map(withName) }));
        };
    })();

    // ---- Just Type (com.palm.universalsearch) ---------------------------------------------
    // Modelled on openwebos/luna-universalsearchmgr: web search engines from
    // its UniversalSearchList.json, and the "action" (New Memo, New Event...)
    // and "dbsearch" (content search) providers the installed apps declare
    // in their appinfo.json "universalSearch" field. Preferences persist.
    // The Just Type preferences (Settings > Just Type, in place of
    // com.palm.app.searchpreferences) change them with its methods
    // (UniversalSearchService.cpp:75-92):
    //   updateSearchItem {category, id, enabled, setDefault?}
    //   updateAllSearchItems {category, enabled}
    //   reorderSearchItem {category, id, toIndex}: toIndex is the item's new
    //       place in its category's list (the original counted it in the
    //       list below the default engine, SearchItemsManager.cpp:766-775;
    //       Settings shows every engine in one list)
    //   get/getAll/setSearchPreference {key, value}: defaultSearchEngine,
    //       defaultSearch (the default engine's row in Just Type),
    //       ContactSearch, AppSearch, GAL (strings "true" / "false")
    // getUniversalSearchList lists each category in the user's order.

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
    // Phoenix's engines beyond the original's list (docs/M6-PLAN.md F4 item
    // 7): the "optional" engines (luna-universalsearchmgr's
    // OptionalSearchList, the engines beyond UniversalSearchList.json), so
    // the shipped list Just Type shows stays as it was. Any of them, or the
    // user's custom engine, can be the default engine, which the browser
    // and Just Type share; the default then joins the end of Just Type's
    // list, which shows only engines from it.
    var US_OPTIONAL = [
        { id: "duckduckgo", displayName: "DuckDuckGo", url: "https://duckduckgo.com/?q=#{searchTerms}",
          suggestURL: "https://duckduckgo.com/ac/?q=#{searchTerms}&type=list", icon: "web" },
        { id: "bing", displayName: "Bing", url: "https://www.bing.com/search?q=#{searchTerms}",
          suggestURL: "https://api.bing.com/osjson.aspx?query=#{searchTerms}", icon: "web" },
        { id: "startpage", displayName: "Startpage", url: "https://www.startpage.com/do/search?q=#{searchTerms}", icon: "web" }
    ];
    var US_DEFAULT_PREFS = { defaultSearchEngine: "google", defaultSearch: "true", ContactSearch: "true", AppSearch: "true", GAL: "false" };
    var usWatchers = [];

    function usState() {
        var st = store.get("universalsearch", null) || {};
        st.prefs = st.prefs || {};
        st.enabled = st.enabled || {};
        st.order = st.order || {};
        return st;
    }
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
        return usOrdered(kind, out);
    }
    // An engine of the user's own (Settings > Just Type > Custom engine;
    // Phoenix's setCustomSearchEngine {displayName, url}): its address has
    // #{searchTerms} (or %s) where the words go.
    var US_WEB_ICON = "/usr/share/phoenix/runtime/search-icons/search-icon-web.svg";
    function usCustom() {
        var c = usState().custom;
        return c && c.url ? { id: "custom", displayName: c.displayName || "Custom", url: c.url, icon: "web" } : null;
    }
    function usEngine(e) {
        var x = { category: "search", type: "web", iconFilePath: US_ICONS + "search-icon-" + e.id + ".png" }, k;
        for (k in e) x[k] = e[k];
        // Engines whose own art Phoenix does not ship: a magnifier.
        if (e.icon === "web") x.iconFilePath = US_WEB_ICON;
        delete x.icon;
        return x;
    }
    function usOptional() {
        var all = US_OPTIONAL.slice(), custom = usCustom();
        if (custom) all.push(custom);
        return all.map(function (e) { var x = usEngine(e); x.enabled = true; return x; });
    }
    function usEngines() {
        var list = usOrdered("search", US_ENGINES.map(function (e) {
            var x = usEngine(e);
            x.enabled = usEnabled("search:" + e.id, e.enabled);
            return x;
        }));
        var def = usPrefs().defaultSearchEngine;
        if (!list.some(function (x) { return x.id === def; }))
            usOptional().forEach(function (x) { if (x.id === def) list.push(x); });
        return list;
    }
    // The items of a category in the user's order (reorderSearchItem); new
    // ones keep their place after those.
    function usOrdered(category, items) {
        var order = usState().order[category] || [];
        return items.map(function (x, i) { return { x: x, i: i, o: order.indexOf(x.id) }; }).sort(function (a, b) {
            if (a.o >= 0 && b.o >= 0) return a.o - b.o;
            if (a.o >= 0 || b.o >= 0) return a.o >= 0 ? -1 : 1;
            return a.i - b.i;
        }).map(function (e) { return e.x; });
    }
    function usItems(category) {
        return category === "search" ? usEngines().concat(usOptional().filter(function (o) {
            return !US_ENGINES.some(function (e) { return e.id === o.id; }) && o.id !== usPrefs().defaultSearchEngine;
        })) : category === "action" ? usProviders("action")
             : category === "dbsearch" ? usProviders("dbsearch") : null;
    }
    function usList() {
        return ok({
            UniversalSearchList: usEngines(),
            OptionalSearchList: usOptional(),
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
        // {id, category: "search" | "action" | "dbsearch", enabled, setDefault}
        "/updateSearchItem": function (p, reply) {
            var category = p.category || "search", items = usItems(category);
            if (!items) return reply(fail(-1, "Invalid category"));
            if (!items.some(function (x) { return x.id === p.id; })) return reply(fail(-1, "Unable to update item"));
            var st = usState();
            if (p.enabled !== undefined) st.enabled[category + ":" + p.id] = !!p.enabled;
            // The default engine (SearchItemsManager::updateSearchItem).
            if (p.setDefault && category === "search") st.prefs.defaultSearchEngine = String(p.id);
            usSave(st);
            reply(ok());
        },
        // Phoenix: {displayName, url} sets the custom engine, {url: ""}
        // removes it (the default goes back to Google if it was the one).
        "/setCustomSearchEngine": function (p, reply) {
            var url = String(p.url || "").trim(), st = usState();
            if (!url) {
                delete st.custom;
                if (usPrefs().defaultSearchEngine === "custom") st.prefs.defaultSearchEngine = "google";
                usSave(st);
                return reply(ok());
            }
            url = url.replace(/%s/g, "#{searchTerms}");
            if (!/^https?:\/\/[^\s]+$/i.test(url) || url.indexOf("#{searchTerms}") < 0)
                return reply(fail(-1, "The address must start with http:// or https:// and have %s where the words go"));
            st.custom = { displayName: String(p.displayName || "").trim() || "Custom", url: url };
            usSave(st);
            reply(ok());
        },
        // {category, enabled}: every item of the category on or off.
        "/updateAllSearchItems": function (p, reply) {
            var category = p.category || "search", items = usItems(category);
            if (!items) return reply(fail(-1, "Invalid category"));
            var st = usState();
            items.forEach(function (x) { st.enabled[category + ":" + x.id] = !!p.enabled; });
            usSave(st);
            reply(ok());
        },
        // {category, id, toIndex}
        "/reorderSearchItem": function (p, reply) {
            var category = p.category || "search", items = usItems(category);
            if (!items) return reply(fail(-1, "Invalid category"));
            var ids = items.map(function (x) { return x.id; });
            var from = ids.indexOf(p.id), to = Number(p.toIndex);
            if (from < 0 || !(to >= 0)) return reply(fail(-1, "Unable to reorder item"));
            ids.splice(from, 1);
            ids.splice(Math.min(to, ids.length), 0, p.id);
            var st = usState();
            st.order[category] = ids;
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

    // BrowserServer's own calls (the browser's Preferences: Clear Cookies,
    // Clear Cache, isis-browser Browser.js): phoenix-sim clears the page
    // views' profile (simBrowser). The iframe engine has none of its own.
    register(["com.palm.browserServer"], {
        "/clearCookies": function (p, reply) { host.postToHost("browserData", { op: "clearCookies" }); reply(ok()); },
        "/clearCache": function (p, reply) { host.postToHost("browserData", { op: "clearCache" }); reply(ok()); },
        "*": function (p, reply) { reply(ok()); }
    });

    var WEBVIEW_TYPE = "application/x-palm-browser";
    var nativeWebViews = global.location && global.location.protocol === "phoenix:";
    var webViews = {};      // id -> adapter
    var nextWebView = 1;
    // Ids unique across pages, so the shell finds the view a picture is of.
    var webViewPrefix = "wv" + Math.random().toString(36).slice(2, 8) + "-";

    function WebViewAdapter(node) {
        this.node = node;
        this.id = webViewPrefix + (nextWebView++);
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
        // A picture request (saveViewToFile and friends), answered at once.
        picture: function (req) {
            if (!nativeWebViews) return false;
            try {
                var x = new XMLHttpRequest();
                x.open("GET", "/__phoenix/snapshot?req=" + encodeURIComponent(toJson(req)), false);
                x.send();
                var r = JSON.parse(x.responseText || "{}");
                if (r.returnValue === false) console.warn("[phoenix-runtime] " + req.op + ": " + r.errorText);
                return r.returnValue !== false;
            } catch (e) {
                console.warn("[phoenix-runtime] " + req.op + ": " + e.message);
                return false;
            }
        },
        connect: function () {
            var self = this;
            if (this.connected) return;
            this.connected = true;
            if (nativeWebViews) {
                this.post("create", { "private": !!this.privateMode });
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
            var n = this.node, b = n.getBoundingClientRect();
            var r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
            // Shown: laid out and not hidden. Not offsetParent, which is null
            // for position: fixed, as the app menu is.
            function shown(e) {
                if (!e.getClientRects().length) return false;
                var cs = global.getComputedStyle(e);
                return cs.visibility !== "hidden" && cs.display !== "none";
            }
            var popup = Array.prototype.some.call(global.document.querySelectorAll(".enyo-popup"), function (e) {
                return shown(e) && e.getBoundingClientRect().height > 0;
            });
            // A drawer flown in from a side (enyo.Toaster, class enyo-toaster:
            // the browser's bookmarks, history and downloads) covers part of
            // the page: the view keeps to the part it leaves, since nothing in
            // the page can draw over a native view.
            Array.prototype.forEach.call(global.document.querySelectorAll(".enyo-toaster"), function (e) {
                if (!shown(e)) return;
                var t = e.getBoundingClientRect();
                if (t.width === 0 || t.height === 0 || t.right <= r.left || t.left >= r.right || t.bottom <= r.top || t.top >= r.bottom) return;
                if (t.top <= r.top && t.bottom >= r.bottom) {
                    if (t.left > r.left) r.right = Math.min(r.right, t.left);
                    else r.left = Math.max(r.left, t.right);
                } else if (t.top > r.top) r.bottom = Math.min(r.bottom, t.top);
                else r.top = Math.max(r.top, t.bottom);
            });
            r.width = Math.max(0, r.right - r.left);
            r.height = Math.max(0, r.bottom - r.top);
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
            this.frameLinks(doc);
            this.frameReport();
            this.listener("loadProgressChanged", 100);
            this.listener("loadStopped");
            this.listener("documentLoadFinished");
        },
        // The redirects for the links of the iframe's page (same-origin
        // pages only: the others' links cannot be seen from here).
        redirectFor: function (url) {
            var list = this.redirects || [];
            for (var i = 0; i < list.length; i++) {
                var re;
                try { re = new RegExp(list[i].regex, "i"); } catch (e) { continue; }
                if (re.test(url)) return list[i].enable ? list[i].cookie : null;
            }
            return null;
        },
        frameLinks: function (doc) {
            var self = this;
            if (!doc || !doc.addEventListener || doc.__phoenixRedirects) return;
            doc.__phoenixRedirects = true;
            doc.addEventListener("click", function (e) {
                if (e.defaultPrevented || e.button !== 0) return;
                var a = e.target && e.target.closest && e.target.closest("a[href]");
                if (!a) return;
                var cookie = self.redirectFor(a.href);
                if (cookie === null) return;
                e.preventDefault();
                self.listener("urlRedirected", a.href, cookie);
            }, false);
        },
        frameReport: function () {
            this.listener("urlTitleChanged", this.url, this.title || this.url, this.back.length > 0, this.forward.length > 0);
        },
        // Find on Page in the iframe's page (same-origin only): the next
        // match with window.find, counted in the page's text.
        frameFind: function (text, backward) {
            var w = null, doc = null;
            try { w = this.frame && this.frame.contentWindow; doc = this.frame && this.frame.contentDocument; } catch (e) { w = null; }
            if (!w || !doc) return this.findResult(0, 0);
            var clear = function () { try { w.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } };
            if (text !== this.findText) { this.findText = text; this.findIndex = 0; clear(); }
            if (!text) return this.findResult(0, 0);
            var body = String(doc.body ? doc.body.innerText : "").toLowerCase(), t = text.toLowerCase(), n = 0, i = -1;
            while ((i = body.indexOf(t, i + 1)) >= 0) n++;
            var found = n > 0 && w.find(text, false, !!backward, true);
            this.findIndex = !found ? 0 : backward ? (this.findIndex <= 1 ? n : this.findIndex - 1)
                                                   : (this.findIndex >= n ? 1 : this.findIndex + 1);
            this.findResult(this.findIndex, n);
        },
        // The count goes to the page as a "phoenixfindresult" event on the
        // object ({active, total}); BrowserAdapter had no such callback.
        findResult: function (active, total) {
            var E = global.CustomEvent;
            if (E) this.node.dispatchEvent(new E("phoenixfindresult", { bubbles: true, detail: { active: active, total: total } }));
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
            // (text, backward): Phoenix adds the direction (the find bar's
            // prev and next) and the count of matches (findResult).
            findInPage: function (text, backward) {
                if (nativeWebViews) this.post("find", { text: text || "", backward: !!backward });
                else this.frameFind(text || "", backward);
            },
            // Phoenix: the browser's Private Browsing card. The native view
            // starts again in the private profile, at the page it showed;
            // the iframe engine has only the one profile of the page.
            setPrivateBrowsing: function (on) {
                on = !!on;
                if (on === !!this.privateMode) return;
                this.privateMode = on;
                if (nativeWebViews && this.connected && !this.destroyed) this.post("private", { on: on, url: this.url || "" });
            },
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
            // (regex, enable, cookie, type): links the page follows that
            // match an enabled redirect are not loaded; the page hears
            // urlRedirected(url, cookie) instead (BrowserAdapter.cpp
            // js_addUrlRedirect :1945-1981, msgUrlRedirected :4760-4767).
            // The browser's are the system's handlers (enyo WebView
            // addSystemRedirects: mailto:, tel:...; it opens them with
            // applicationManager open), Email's every link of a message
            // but its own file: ones (MessageDisplay.js:906-909). In order;
            // the first that matches decides, and adding a regex again
            // changes it (Enyo turns the old ones off that way).
            addUrlRedirect: function (regex, enable, cookie, type) {
                regex = String(regex || "");
                if (!regex) return;
                try { new RegExp(regex); } catch (e) { throw new Error("addUrlRedirect: Can't compile RE '" + regex + "'"); }
                var list = this.redirects = this.redirects || [];
                var r = list.filter(function (x) { return x.regex === regex; })[0];
                if (!r) list.push(r = { regex: regex });
                r.enable = !!enable;
                r.cookie = cookie === undefined || cookie === null ? "" : String(cookie);
                r.type = type | 0;
                if (nativeWebViews) this.post("redirects", { list: list });
            },
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
            // Pictures of the page (BrowserServer's): the browser's bookmark
            // thumbnail and the icon of a launcher shortcut. phoenix-sim
            // makes them (/__phoenix/snapshot); they return at once, as the
            // plugin's calls did, and the files are there when the page
            // shows them. In a desktop browser the page is an <iframe>
            // nothing can take a picture of, and there are none.
            saveViewToFile: function (path, left, top, width, height) {
                this.picture({ op: "save", view: this.id, path: path, rect: [left || 0, top || 0, width, height] });
            },
            generateIconFromFile: function (src, path, left, top, right, bottom) {
                this.picture({ op: "icon", src: src, path: path, rect: [left || 0, top || 0, (right || 0) - (left || 0), (bottom || 0) - (top || 0)] });
            },
            resizeImage: function (src, path, width, height) {
                this.picture({ op: "resize", src: src, path: path, width: width, height: height });
            },
            deleteImage: function (path) { this.picture({ op: "delete", path: path }); },
            // (frameName, jobID, width, height, dpi, landscape, reverse): the
            // page shown here, for a com.palm.printmgr job (the browser's and
            // Email's Print). The native view renders it with Chromium; the
            // iframe engine prints the page's text (all it can read of a
            // same-origin page).
            printFrame: function (frameName, jobID) {
                if (!jobID || !runtime.print) return;
                if (nativeWebViews)
                    return runtime.print.render(jobID, { title: this.title, host: { type: "webView", id: this.id } });
                var doc = null;
                try { doc = this.frame && this.frame.contentDocument; } catch (e) { doc = null; }
                runtime.print.render(jobID, { title: (doc && doc.title) || this.title || this.url,
                                              text: doc && doc.body ? doc.body.innerText : this.url });
            }
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
        if (name === "phoenixFindResult") return a.findResult && a.findResult((args || [])[0] || 0, (args || [])[1] || 0);
        if (name === "urlTitleChanged") { a.url = args[0]; a.title = args[1]; }
        a.listener.apply(a, [name].concat(args || []));
    };

    // A page view nobody sees, showing some HTML: what Email prints its
    // message from (the message itself is a div of its window). In
    // phoenix-sim only; loaded(id) once the page has loaded, then the view
    // can be printed by its id and must be destroyed.
    runtime.offscreenWebView = nativeWebViews ? function (html, loaded) {
        var a = { id: "wv" + (nextWebView++), fired: false };
        a.listener = function (name) {
            if (name === "documentLoadFinished" && !a.fired) { a.fired = true; loaded(a.id); }
        };
        webViews[a.id] = a;
        host.postToHost("webView", { id: a.id, op: "create" });
        // Letter width at 96 dpi; the PDF is laid out for its paper anyway.
        host.postToHost("webView", { id: a.id, op: "geometry", x: 0, y: 0, width: 816, height: 1056, visible: false });
        host.postToHost("webView", { id: a.id, op: "html", url: "", html: html });
        return {
            destroy: function () {
                if (!webViews[a.id]) return;
                delete webViews[a.id];
                host.postToHost("webView", { id: a.id, op: "destroy" });
            }
        };
    } : null;

    // ---- Links in an app's page -----------------------------------------------------------
    // A link the user follows in an app's page to another site or to
    // another scheme (mailto:, tel:, sms:...) does not load in the app's
    // card: the application manager opens it, open {target}, in the app
    // for it (the browser, Email, Phone, the web app whose site it is), as
    // WebAppMgr handed such a URL over (WebAppManager::mimeHandoffUrl,
    // webappmanager Src/webbase/WebAppManager.cpp:1747-1773). target=_blank
    // the same. Links to the app's own pages, and clicks the page handles
    // itself (preventDefault), are the page's. phoenix-sim's window also
    // catches what gets past this (WebAppWindow.qml, Links.js).
    runtime.linkLeavesApp = function (href) {
        href = String(href || "");
        if (!href || /^(javascript|about|data|blob):/i.test(href)) return false;
        if (!/^https?:/i.test(href)) return !/^(phoenix|file):/i.test(href);
        try { return new URL(href).origin !== global.location.origin; } catch (e) { return false; }
    };
    try {
        if (global.document && global.addEventListener) global.addEventListener("click", function (e) {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            var a = e.target && e.target.closest && e.target.closest("a[href]");
            if (!a || a.hasAttribute("download") || !runtime.linkLeavesApp(a.href)) return;
            e.preventDefault();
            dispatch("luna://com.palm.applicationManager/open", { target: a.href }, function () {},
                     { cancelled: function () { return false; }, onCancel: null });
        }, false);
    } catch (e) { /* ignore */ }

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

    // charger: "none", "wall" (a wall charger on the USB port), "pc", or
    // "inductive", the Touchstone (puckId: its serial number). The first two
    // charge over USB, as on the Pre (luna-systemui PowerdService.js); on the
    // Touchstone powerd said DockConnected with DockPower and DockSerialNo
    // (DisplayManager::usbDockCallback, :967-1060).
    function powerState() { return store.get("power", { percent: 76, charger: "none" }); }
    function batteryPayload(st) {
        // temperature: the simulator's (Ctrl+Shift+T), 31 °C until it says.
        return { percent: st.percent, percent_ui: st.percent, temperature_C: typeof st.temperature === "number" ? st.temperature : 31,
                 current_mA: st.charger !== "none" ? 800 : -250, capacity_mAh: 1150, voltage_mV: 3900 };
    }
    function chargerPayload(st) {
        var on = st.charger !== "none", dock = st.charger === "inductive";
        return { Charging: on, Connected: on, USBConnected: on && !dock, USBName: on && !dock ? st.charger : "",
                 DockConnected: dock, DockPower: dock, DockSerialNo: dock ? (st.puckId || "NULL") : "",
                 type: st.charger };
    }
    // {percent, charger}: change the battery and tell the listeners.
    runtime.setPower = function (changes) {
        var st = powerState(), k;
        for (k in changes) st[k] = changes[k];
        store.set("power", st);
        if (runtime.recordBattery) runtime.recordBattery(st);
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
        "/com/palm/power/activityEnd": function (p, reply) { reply(ok()); },
        // Off (the power menu's Shut Down; shutdown/machineOff): phoenix-sim
        // plays the shutdown sound and goes dark until Power is pressed. A
        // page in a browser has nothing to turn off.
        "/shutdown/machineOff": function (p, reply) {
            reply(ok());
            if (!/^https?:$/.test(global.location.protocol))
                host.postToHost("shutdown", { reason: p.reason || "" });
        }
    });

    // The power menu's Luna Restart (the community's Advanced Reset Options,
    // in webOS CE 3.1.0's power menu): the system UI starts again, the apps
    // closing, the device staying up. Phoenix's own service: LunaSysMgr had
    // none (the patch restarted it from a shell script); on a device the
    // shell is restarted by systemd.
    register(["org.webosphoenix.system"], {
        "/restartUi": function (p, reply) {
            reply(ok());
            if (!/^https?:$/.test(global.location.protocol))
                host.postToHost("restartUi", {});
        },
        // mediaKey {key}: a media key pressed (the Assistant's "pause",
        // "next song"): the shell sends it to every page as the hardware
        // key's com.palm.keys /media events, down then up, and the player
        // holding the audio focus acts (@phoenix/luna mediakeys.ts).
        // What plays, as the player last said (@phoenix/luna postNowPlaying:
        // Music, Podcasts): setNowPlaying {title, artist?, album?, playing,
        // appId?}; getNowPlaying -> {nowPlaying: {..., appId, time} | null}.
        // The Assistant's "what's playing" reads it.
        "/setNowPlaying": function (p, reply) {
            if (typeof p.title !== "string") return reply(fail(-1, "title is required"));
            store.set("media:nowPlaying", { title: p.title, artist: String(p.artist || ""), album: String(p.album || ""), playing: !!p.playing,
                                            appId: String(p.appId || appIdFromLocation()), time: Date.now() });
            reply(ok());
        },
        "/getNowPlaying": function (p, reply) { reply(ok({ nowPlaying: store.get("media:nowPlaying", null) })); },
        "/mediaKey": function (p, reply) {
            if (["play", "pause", "togglePausePlay", "stop", "next", "prev"].indexOf(p.key) < 0)
                return reply(fail(-1, "key: play, pause, togglePausePlay, stop, next or prev"));
            reply(ok());
            host.postToHost("mediaKey", { key: p.key });
        }
    });

    // com.palm.display, com.palm.keys, com.palm.vibrate: see "LunaSysMgr's
    // device services" below.

    // com.palm.service.accounts: see "Accounts" below.

    register(["com.palm.activitymanager"], {
        "*": function (p, reply) { reply(ok({ activityId: Date.now() })); }
    });

    // Services that apps poke but whose absence should not break them.
    register(["com.palm.audio", "com.palm.lunabus",
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
        // Headless apps (Calendar) ask to stay loaded when their windows
        // close: the shell keeps the app's page running when its last card
        // closes (as the apps LunaSysMgr kept alive, luna.conf [KeepAlive]).
        if (!PalmSystem.keepAlive) PalmSystem.keepAlive = function (on) {
            host.postToHost("keepAlive", { on: on === undefined ? true : !!on });
        };
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
    // com.palm.account:1 objects in db8, templates are JSON files (below),
    // and listAccounts/getAccountInfo "annotate" accounts with their
    // template. Credentials are kept per account in localStorage. This block
    // serves the templates released with Open webOS (com.palm.*: the HP webOS
    // profile and the email templates), which have no transport here: a new
    // account is not validated against a server. The others (CardDAV and
    // CalDAV, the Subscribed Calendar, Jabber, connectors whose service
    // runs here) go through the block "CardDAV and CalDAV" (Synergy
    // transport), which calls their callbacks.
    //
    // Templates are found as the service finds them: every *.json in each
    // folder of /usr/palm/public/accounts and of the installed apps' accounts
    // folder (accounts.js getTemplatePaths, lines 26-66), the first of each
    // templateId kept (addTemplate, lines 92-96). A page cannot list a
    // folder, so here they are:
    //   - /usr/palm/public/accounts/<dir>/<dir>.json for each folder
    //     runtime/rootfs.json mounts there (BUILTIN_TEMPLATES if it cannot
    //     be read), and the runtime's own (the simulated Jabber account);
    //   - for each app the user installed, the templates its package had in
    //     the app's public/accounts/<dir>/ (the connector layout,
    //     docs/SYNERGY-CONNECTORS.md 3.1), which installPackage records
    //     (runtime.recordAccountTemplates); else, for an app installed some
    //     other way, public/accounts/<appId>/<appId>.json.
    // The list is read again when apps are installed or removed, as the
    // service reloads on appsChanged (handlers/apps-changed.js), and a
    // changed list is signalled in tempdb as updateAppTemplateList does
    // (accounts.js lines 142-190): the accounts library watches it
    // (get-templates.js line 28), so an open "Add an Account" list shows a
    // connector installed meanwhile.
    (function accountsService() {
        var PUBLIC_ACCOUNTS = "/usr/palm/public/accounts/";
        var BUILTIN_TEMPLATES = [
            "/usr/palm/public/accounts/com.palm.palmprofile/com.palm.palmprofile.json",
            "/usr/palm/public/accounts/com.palm.othermail/com.palm.othermail.json",
            "/usr/palm/public/accounts/com.palm.imap/com.palm.imap.json",
            "/usr/palm/public/accounts/com.palm.pop/com.palm.pop.json",
            "/usr/palm/public/accounts/com.webosphoenix.dav/com.webosphoenix.dav.json",
            "/usr/palm/public/accounts/com.webosphoenix.webcal/com.webosphoenix.webcal.json"
        ];
        var RUNTIME_TEMPLATES = ["/usr/share/phoenix/runtime/accounts/com.webosphoenix.xmpp/com.webosphoenix.xmpp.json"];
        var PACKAGED = "accountTemplateFiles";   // store: {appId: [paths in the app]}
        var ACCOUNT_KIND = "com.palm.account:1";
        var SIGNAL_KIND = "com.palm.signaling:1";
        var templateCache = null;

        function builtinFiles() {
            var mounts;
            try { mounts = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/runtime/rootfs.json")).mounts; }
            catch (e) { return BUILTIN_TEMPLATES; }
            var out = [];
            Object.keys(mounts || {}).sort().forEach(function (prefix) {
                if (prefix.indexOf(PUBLIC_ACCOUNTS) !== 0) return;
                var dir = prefix.slice(PUBLIC_ACCOUNTS.length).replace(/\/$/, "");
                if (dir && dir.indexOf("/") < 0) out.push(PUBLIC_ACCOUNTS + dir + "/" + dir + ".json");
            });
            return out;
        }

        // The apps the user installed, and the template files in each.
        function installedFiles() {
            var packaged = store.get(PACKAGED, {}), seen = {}, out = [];
            launchPoints().forEach(function (lp) {
                if (!lp.removable || lp.dynamic || seen[lp.id]) return;
                seen[lp.id] = true;
                var base = "/usr/palm/applications/" + lp.id + "/";
                (packaged[lp.id] || ["public/accounts/" + lp.id + "/" + lp.id + ".json"]).forEach(function (rel) {
                    out.push(base + rel);
                });
            });
            return out;
        }

        // An installed app's template files (paths in the app), or null
        // when it is removed.
        runtime.recordAccountTemplates = function (appId, paths) {
            var all = store.get(PACKAGED, {});
            if (paths && paths.length) all[appId] = paths; else delete all[appId];
            store.set(PACKAGED, all);
        };

        function absolutize(dir, icons) {
            if (!icons) return;
            Object.keys(icons).forEach(function (k) {
                if (icons[k].charAt(0) !== "/") icons[k] = dir + icons[k];
            });
        }

        // Every template, sorted by name.
        function allTemplates() {
            if (templateCache) return clone(templateCache);
            var list = [], ids = {};
            builtinFiles().concat(RUNTIME_TEMPLATES, installedFiles()).forEach(function (file) {
                var text = PalmSystem.getResource(file);
                if (!text) return;
                var dir = file.slice(0, file.lastIndexOf("/") + 1), parsed;
                try { parsed = JSON.parse(text); } catch (e) { console.warn("[phoenix-runtime] bad account template " + file); return; }
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(function (t) {
                    if (!t || !t.templateId || ids[t.templateId]) return;
                    ids[t.templateId] = true;
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
        runtime.accountTemplates = allTemplates;

        // A template the transport block serves: one whose capabilities are
        // implemented by a service on the simulated bus. The original
        // release's (com.palm.*) stay here: their mail services are stand-ins
        // (block "Email transports").
        function hasTransport(t) {
            if (/^com\.palm\./.test(t.templateId)) return false;
            return (t.capabilityProviders || []).some(function (cp) {
                var m = /^(?:palm|luna):\/\/([^\/]+)/.exec(cp.implementation || "");
                return !!(m && runtime.services[m[1]]);
            });
        }
        runtime.accountTemplateHasTransport = hasTransport;

        function templates() {
            return allTemplates().filter(function (t) { return !hasTransport(t); });
        }

        runtime.onAppsChanged(function () {
            templateCache = null;
            var ids = allTemplates().map(function (t) { return t.templateId; }).sort().toString();
            var was = (callNow("palm://com.palm.tempdb/find", { query: { from: SIGNAL_KIND,
                where: [{ prop: "appId", op: "=", val: "com.palm.accounts.templates" }] } }).results || [])[0];
            if (was && was.templates === ids) return;
            callNow("palm://com.palm.tempdb/del", { query: { from: SIGNAL_KIND,
                where: [{ prop: "appId", op: "=", val: "com.palm.accounts.templates" }] } });
            callNow("palm://com.palm.tempdb/put", { objects: [{ _kind: SIGNAL_KIND, appId: "com.palm.accounts.templates", templates: ids }] });
        });

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
        var VERSION = 3;
        if (store.get("db8SystemKinds", 0) >= VERSION)
            return;
        var kinds = {
            // webOS 3's media indexer (luna-systemui's file picker finds
            // pictures and videos of an album "from" the parent kind:
            // AlbumGridView.js:49, VideoAlbumList.js:47).
            "com.palm.media.types:1": {},
            "com.palm.media.image.file:1": { extends: ["com.palm.media.types:1"] },
            "com.palm.media.video.file:1": { extends: ["com.palm.media.types:1"] },
            "com.palm.media.audio.file:1": { extends: ["com.palm.media.types:1"] },
            "com.palm.media.image.album:1": {},
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
        var db = db8Stores["com.palm.db"].load();
        ["com.palm.person:1", "com.palm.contact.palmprofile:1", "com.palm.calendar:1", "com.palm.calendarevent:1",
         "com.palm.task:1", "com.palm.tasklist:1", "com.palm.note:1", "com.palm.smsmessage:1", "com.palm.chatthread:1",
         "com.palm.phonecall:1", "com.palm.clock.alarm:1", "com.palm.clock.prefs:1", "com.palm.app.contacts.prefs:1",
         "com.palm.app.email.prefs:1", "org.webosphoenix.voicememo:1", "org.webosphoenix.maps.place:1"].forEach(function (id) {
            var k = db.kinds[id] || { extends: [], indexes: [], revSets: [] };
            k.sync = true;
            db.kinds[id] = k;
        });
        db8Stores["com.palm.db"].save(db);
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
                var style = s.getPropertyValue("border-top-style");
                // No image of the rule's own ("border: none" leaves it
                // "initial").
                if (!img || img === "initial" || img === "inherit" || img === "unset")
                    continue;
                // A rule's own line style stays, but not "none" beside an
                // image: the old WebKit drew a border image whatever the
                // style (BorderData::borderLeftWidth gave the width whenever
                // an image was set), and "border: 12px" (Contacts' edit
                // buttons) reads as style "none" in the CSSOM.
                if (img === "none" ? style : style && style !== "none" && style !== "initial")
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

    // Enyo 1.0's list selectors (Clock's "Occurs  Daily", Contacts' MOBILE /
    // HOME type labels): FlexLayout gives a flexed child width 0, "exactly
    // the left over space" (base/layout/FlexLayout.js:75-79), and in a list
    // selector sized to its content that left Chromium nothing for the
    // label: the selector was its arrow alone, the label hanging out of it
    // under the arrow and off the row. Sized to its label, the content
    // still takes any space the selector is given, and so does the item in
    // it: an item flexed inside in turn (Calendar's calendar picker: its
    // colour and name, width 0 with a flex) otherwise showed nothing.
    (function () {
        var doc = global.document;
        if (!doc || !doc.createElement) return;
        function add() {
            if (doc.getElementById("phoenix-enyo-listselector") || !doc.head) return;
            var st = doc.createElement("style");
            st.id = "phoenix-enyo-listselector";
            st.textContent = ".enyo-listselector > .enyo-hflexbox { width: auto !important; }" +
                " .enyo-listselector > .enyo-hflexbox > :first-child { -webkit-box-flex: 1; }";
            doc.head.appendChild(st);
        }
        if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", add);
        else add();
    })();

    // ---- HiDPI art named from script (the original apps) --------------------------
    //
    // The shell zooms a web view by its density, which the page sees as its
    // devicePixelRatio. The original apps' and frameworks' stylesheets ask
    // for their art's @2x and @3x variants with image sets (their overlay
    // copies, written by tools/hidpi-art.py); a picture a page names from
    // script (an <img>'s src, an inline background: Enyo's Image and
    // IconButton kinds, the apps' own templates) gets them here.
    // hidpi-art.json beside this file lists the art that has variants, by
    // device directory, name@2x.png / name@3x.png beside it, and the apps'
    // icons' bigger sizes (icon-256x256.png: 4 times the icon), which Just
    // Type and Settings show (docs/spec/hidpi-art.md). An <img> gets a srcset, an inline background
    // or border image an image set; both keep the 1x art's size. A page's
    // own srcset or image set is left alone. So do the pages an app shows in
    // its frames without a runtime of their own (luna-systemui's file
    // picker, which Enyo's FilePicker opens in the app's card).
    (function hidpiArt() {
        if (!global.document || typeof MutationObserver !== "function" || typeof URL !== "function" ||
            typeof WeakMap !== "function" || typeof WeakSet !== "function")
            return;
        var IMAGE = /^([^?#]*\/)([^\/?#]+?)(\.(?:png|jpg|gif))([?#].*)?$/i;
        var list;   // undefined until first needed; null when unavailable
        function art() {
            if (list === undefined) {
                list = null;
                try {
                    var req = new XMLHttpRequest();
                    req.open("GET", "/usr/share/phoenix/runtime/hidpi-art.json", false);
                    req.send(null);
                    if ((req.status === 200 || req.status === 0) && req.responseText)
                        list = JSON.parse(req.responseText).art || null;
                } catch (e) { list = null; }
            }
            return list;
        }
        // [[factor, url]] of an absolute URL's variants, or null.
        function variants(url) {
            var m = IMAGE.exec(url);
            if (!m || m[4] || /@[\d.]+x$/.test(m[2]))
                return null;
            var dir;
            try { dir = decodeURIComponent(new URL(m[1]).pathname); } catch (e) { return null; }
            var all = art();
            var ks = all && all[dir] && all[dir][decodeURIComponent(m[2] + m[3])];
            // name@kx beside it, or [k, file]: an app icon's bigger sizes.
            return ks ? ks.map(function (k) {
                return typeof k === "number" ? [k, m[1] + m[2] + "@" + k + "x" + m[3]] : [k[0], m[1] + encodeURIComponent(k[1])];
            }) : null;
        }
        function absolute(url, node) {
            try { return new URL(url, node.ownerDocument.baseURI).href; } catch (e) { return null; }
        }

        var given = new WeakMap();   // img -> the srcset set here
        function fixImg(img) {
            watch(img.ownerDocument);
            var mine = given.get(img);
            var current = img.getAttribute("srcset");
            if (current !== null && current !== mine)
                return;   // the page's own
            var src = img.getAttribute("src");
            var abs = src && absolute(src, img);
            var v = abs && variants(abs);
            if (!v) {
                if (mine !== undefined) {
                    img.removeAttribute("srcset");
                    given.delete(img);
                }
                return;
            }
            var set = [abs + " 1x"].concat(v.map(function (e) { return e[1] + " " + e[0] + "x"; })).join(", ");
            if (set !== current) {
                given.set(img, set);
                img.setAttribute("srcset", set);
            }
        }

        var PROPS = ["background-image", "border-image-source"];
        var URL_FN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
        function fixStyle(el) {
            var st = el.style;
            if (!st)
                return;
            PROPS.forEach(function (prop) {
                var value = st.getPropertyValue(prop);
                if (!value || value.indexOf("url(") < 0 || value.indexOf("image-set(") >= 0)
                    return;
                var changed = false;
                var out = value.replace(URL_FN, function (all, q, url) {
                    var abs = absolute(url, el);
                    var v = abs && variants(abs);
                    if (!v)
                        return all;
                    changed = true;
                    return "-webkit-image-set(" + ["url(\"" + abs + "\") 1x"].concat(v.map(function (e) {
                        return "url(\"" + e[1] + "\") " + e[0] + "x";
                    })).join(", ") + ")";
                });
                if (changed)
                    st.setProperty(prop, out, st.getPropertyPriority(prop));
            });
        }

        // A same-origin frame's window, as soon as the frame is in the page:
        // its first (empty) document's window is the one the page it loads
        // from this origin gets, so what is set up here is there before
        // that page's scripts run; again when it loads, for a frame that
        // navigates elsewhere.
        var frames = new WeakSet();
        function fixFrame(frame) {
            try { install(frame.contentWindow); } catch (e) { /* another origin */ }
            if (frames.has(frame))
                return;
            frames.add(frame);
            frame.addEventListener("load", function () {
                try {
                    install(frame.contentWindow);
                    if (frame.contentDocument && frame.contentDocument.documentElement)
                        scan(frame.contentDocument.documentElement);
                } catch (e) { /* another origin */ }
            });
        }

        function fix(el) {
            if (el.tagName === "IMG")
                fixImg(el);
            else if (el.tagName === "IFRAME")
                fixFrame(el);
            if (el.hasAttribute("style"))
                fixStyle(el);
        }
        function scan(node) {
            if (!node || node.nodeType !== 1)
                return;
            fix(node);
            var els = node.querySelectorAll("img[src], [style], iframe");
            for (var i = 0; i < els.length; ++i)
                fix(els[i]);
        }

        // The page's own markup, inline styles (which load when they are
        // drawn) and frames as they change.
        var watched = new WeakSet();
        function watch(d) {
            if (!d || watched.has(d))
                return;
            watched.add(d);
            new MutationObserver(function (records) {
                records.forEach(function (r) {
                    if (r.type === "childList")
                        Array.prototype.forEach.call(r.addedNodes, scan);
                    else if (r.attributeName === "src" && r.target.tagName === "IMG")
                        fixImg(r.target);
                    else if (r.attributeName === "style")
                        fixStyle(r.target);
                });
            }).observe(d, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style"] });
        }

        // An <img> starts loading as soon as its src is set, attached or not
        // (Enyo renders with innerHTML, often before the node is in the
        // page): its srcset is set then, before the load starts, so the 1x
        // picture is never fetched.
        function after(proto, name, then) {
            var d = proto && Object.getOwnPropertyDescriptor(proto, name);
            if (!d || !d.configurable)
                return;
            if (d.set) {
                var set = d.set;
                d.set = function (v) { set.call(this, v); then(this); };
            } else if (typeof d.value === "function") {
                var fn = d.value;
                d.value = function () { var r = fn.apply(this, arguments); then(this, arguments); return r; };
            } else {
                return;
            }
            Object.defineProperty(proto, name, d);
        }
        function install(win) {
            if (!win || win.__phoenixHidpiArt)
                return;
            Object.defineProperty(win, "__phoenixHidpiArt", { value: true });
            if (win.Element && win.HTMLImageElement) {
                var E = win.Element.prototype;
                after(E, "innerHTML", scan);
                after(E, "outerHTML", function (el) { scan(el.parentNode); });
                after(E, "insertAdjacentHTML", function (el) { scan(el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : el); });
                after(win.HTMLImageElement.prototype, "src", fixImg);
                after(E, "setAttribute", function (el, args) {
                    if (el.tagName === "IMG" && String(args[0]).toLowerCase() === "src")
                        fixImg(el);
                });
            }
            watch(win.document);
        }
        install(global);
        runtime.hidpiArt = { variants: variants };
    })();

    // ---- Pictures the media store holds, named by their path -----------------------
    //
    // On webOS a page showed a picture of the USB drive or of the file
    // cache by its path (<img src="/media/internal/DCIM/...">, an inline
    // background-image url(...)): luna-systemui's file picker its grid
    // (AlbumGridView.js:105-113, ImageFullView.js:52), Contacts the photo it
    // made (Edit.js:616). Here the user's files (the camera's, a cropped
    // contact photo) are in the media store and the Files block's own
    // store, which the server does not serve: such a reference gets the
    // file's URL instead (a blob: URL), when there is one. The demo media
    // under /media/internal/samples/ are served and stay as they are.
    (function storedPictures() {
        var doc = global.document;
        if (!doc || typeof MutationObserver !== "function" || typeof URL !== "function" || typeof WeakMap !== "function")
            return;
        var LOCAL = /^\/(?:media\/internal|var\/file-cache)\/(?!samples\/)/;
        function localPath(url, node) {
            try {
                var u = new URL(url, node.ownerDocument.baseURI);
                var p = decodeURIComponent(u.pathname);
                return u.origin === global.location.origin && LOCAL.test(p) ? p : null;
            } catch (e) { return null; }
        }
        // The file's URL, or null when the store has no such file.
        function urlOf(path) {
            var fm = runtime.fileManager, mf = runtime.mediaFiles;
            var first = fm ? fm.url(path) : Promise.resolve(path);
            return first.then(function (u) {
                if (u !== path) return u;
                return mf ? mf.url(path) : path;
            }).then(function (u) { return u === path ? null : u; }, function () { return null; });
        }
        var done = new WeakMap();   // element -> the value given here
        function fixImg(img) {
            var src = img.getAttribute("src");
            if (!src || done.get(img) === src) return;
            var path = localPath(src, img);
            if (!path) return;
            urlOf(path).then(function (u) {
                if (!u || img.getAttribute("src") !== src) return;
                done.set(img, u);
                img.setAttribute("src", u);
            });
        }
        var URL_FN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
        function fixStyle(el) {
            var st = el.style, value = st && st.getPropertyValue("background-image");
            if (!value || value.indexOf("url(") < 0 || done.get(el) === value) return;
            var paths = [];
            value.replace(URL_FN, function (all, q, url) { var p = localPath(url, el); if (p) paths.push([url, p]); return all; });
            if (!paths.length) return;
            Promise.all(paths.map(function (x) { return urlOf(x[1]); })).then(function (urls) {
                if (st.getPropertyValue("background-image") !== value) return;
                var out = value;
                paths.forEach(function (x, i) { if (urls[i]) out = out.split(x[0]).join(urls[i]); });
                if (out === value) return;
                done.set(el, out);
                st.setProperty("background-image", out, st.getPropertyPriority("background-image"));
            });
        }
        function scan(node) {
            if (!node || node.nodeType !== 1) return;
            if (node.tagName === "IMG") fixImg(node);
            if (node.hasAttribute("style")) fixStyle(node);
            var els = node.querySelectorAll("img[src], [style]");
            for (var i = 0; i < els.length; ++i) {
                if (els[i].tagName === "IMG") fixImg(els[i]);
                if (els[i].hasAttribute("style")) fixStyle(els[i]);
            }
        }
        new MutationObserver(function (records) {
            records.forEach(function (r) {
                if (r.type === "childList") Array.prototype.forEach.call(r.addedNodes, scan);
                else if (r.attributeName === "src" && r.target.tagName === "IMG") fixImg(r.target);
                else if (r.attributeName === "style") fixStyle(r.target);
            });
        }).observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style"] });
    })();

    // Back gesture: the shell calls this; Mojo/Enyo 1.0 apps treat Escape
    // (and keyIdentifier U+1200001 on devices) as "back".
    // An app opened by another one to show something ({returnToCaller}:
    // launch params $caller, e.g. Photos from the Assistant's thumbnail): a
    // Back it does not handle itself (no preventDefault, as webOS apps said
    // they took the gesture) brings the caller's card, the one beside it in
    // the stack it joined, back to the front, and this card goes behind it,
    // still open (the owner: the opened app stays, as a card in the stack,
    // to come back to). As LunaSysMgr's back at an app's root went to card
    // view, this goes back to where the user was.
    // Returns whether the app took it: false (nothing stopped the key, no
    // caller to go back to) and the shell minimizes the card to card view,
    // as WebAppMgr handed an unhandled Back back to LunaSysMgr
    // (WindowedWebApp.cpp:823-832, View_Host_ReturnedKeyEvent) and
    // SystemUiController::slotKeyEventRejected minimized the active card
    // (SystemUiController.cpp:941-954).
    runtime.back = function () {
        var target = global.document.activeElement || global.document.body || global.document;
        var handled = false;
        ["keydown", "keyup"].forEach(function (type) {
            var e = new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true });
            try {
                Object.defineProperty(e, "keyCode", { get: function () { return 27; } });
                Object.defineProperty(e, "keyIdentifier", { get: function () { return "U+1200001"; } });
            } catch (x) { /* ignore */ }
            target.dispatchEvent(e);
            if (e.defaultPrevented) handled = true;
        });
        if (!handled) {
            var lp = {};
            try { lp = JSON.parse(PalmSystem.launchParams || "{}") || {}; } catch (x) { lp = {}; }
            // An app whose launch page opens its card (Calendar's index.html
            // opens app/calendar.html): the launch, and its $caller, went to
            // the page that opened this one.
            if (!(lp && lp.$caller)) {
                try {
                    var op = global.opener && global.opener.PalmSystem;
                    if (op) lp = JSON.parse(op.launchParams || "{}") || {};
                } catch (x) { /* another origin, or closed */ }
            }
            if (lp && typeof lp.$caller === "string" && lp.$caller) {
                // {returnTo: true}: the caller's card as it is, in front, this
                // one going behind it (the shell's cardReturnRequested).
                host.postToHost("launch", { id: lp.$caller, params: {}, returnTo: true });
                return true;
            }
        }
        return handled;
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
        watchRemoval(editable(el) ? el : null);
    }

    // Chromium moves the focus to the body without a focusout when the
    // focused element leaves the page (a view that goes away under Back
    // while its field is focused), and keeps it on a field whose view is
    // hidden (display: none; Memos' editor under Back); WebKit told the
    // IMEController the focus had gone and the keyboard hid. Watch the page
    // while a field has the focus: a field gone, the focus is followed; a
    // field hidden loses the focus.
    var removalWatch = null;
    function watchRemoval(el) {
        if (removalWatch) {
            removalWatch.observer.disconnect();
            if (removalWatch.sizes) removalWatch.sizes.disconnect();
            removalWatch = null;
        }
        if (!el || typeof global.MutationObserver !== "function" || !global.document.documentElement)
            return;
        var observer = new global.MutationObserver(function () {
            if (!el.isConnected || global.document.activeElement !== el)
                followFocus();
        });
        observer.observe(global.document.documentElement, { childList: true, subtree: true });
        // A box that goes to nothing: hidden (or removed, handled above).
        var sizes = null;
        if (typeof global.ResizeObserver === "function") {
            sizes = new global.ResizeObserver(function () {
                if (el.isConnected && global.document.activeElement === el && el.getClientRects().length === 0)
                    el.blur();
            });
            sizes.observe(el);
        }
        removalWatch = { observer: observer, sizes: sizes, el: el };
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
    // The positive space of a window that keeps its size (it called
    // allowResizeOnPositiveSpaceChange(false)): Enyo moves its popups and
    // scrolls the focused field into view (palm/system/keyboard.js:224).
    runtime.positiveSpaceChanged = function (width, height) {
        var mojo = global.Mojo;
        if (mojo && typeof mojo.positiveSpaceChanged === "function") {
            try { mojo.positiveSpaceChanged(width, height); } catch (e) { console.error("[phoenix-runtime] positiveSpaceChanged failed", e); }
        }
    };
    runtime.keyboardShown = function (shown) {
        var mojo = global.Mojo;
        if (mojo && typeof mojo.keyboardShown === "function") {
            try { mojo.keyboardShown(!!shown); } catch (e) { console.error("[phoenix-runtime] keyboardShown failed", e); }
        }
    };

    // The window shrank for the keyboard: the focused field scrolls into
    // view, as Enyo's keyboard did for its apps on every resize
    // (enyo-1.0 palm/system/keyboard.js:39-48, 104-106: a 100 ms job that
    // scrolls the focused scroller to the caret); Mojo's scenes did the
    // same. Enyo's and Mojo's apps still do it themselves; for the others
    // (Phoenix's React apps) a field low on the page went under the
    // keyboard and stayed there.
    if (global.addEventListener) {
        var revealTimer = 0;
        global.addEventListener("resize", function () {
            clearTimeout(revealTimer);
            revealTimer = setTimeout(function () {
                if (global.enyo || global.Mojo)
                    return;
                var el = global.document && global.document.activeElement;
                if (editable(el) && typeof el.scrollIntoView === "function")
                    el.scrollIntoView({ block: "nearest" });
            }, 100);
        });
    }

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

    // ---- Share: what the app menu's Share shares --------------------------------------
    //
    // Every app menu has Share after Edit (a Phoenix addition: webOS had no
    // system share; docs/SHARE-AND-FILES.md). It shares what the app says
    // it is showing, __phoenixRuntime.setShareContent(function () {return
    // {title, text, url, files}}) (Memos: the memo; the browser: the page),
    // or else the text selected on the page; nothing, and Share is dimmed.
    // Phoenix's React apps say it with AppMenu's `share`.
    var shareProvider = null;
    runtime.setShareContent = function (fn) { shareProvider = typeof fn === "function" ? fn : null; };
    runtime.shareContent = function () {
        var c = null;
        try { c = shareProvider ? shareProvider() : null; } catch (e) { c = null; }
        if (c && (c.text || c.url || (c.files && c.files.length))) return c;
        var text = selectedText().replace(/^\s+|\s+$/g, "");
        return text ? { text: text } : null;
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
            // A password field's copy (see "Clipboard history").
            if (runtime.clipboard && runtime.clipboard.passwordCopy(action))
                return true;
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
            // Share right after Edit (runtime.shareContent), its own item.
            if (this.$.phoenixShare)
                return;
            var share = this.createComponent({ name: "phoenixShare", caption: "Share", onclick: "phoenixShareClick" }, { owner: this });
            at = this.controls ? this.controls.indexOf(share) : -1;
            var editAt = this.controls ? this.controls.indexOf(edit) : -1;
            if (at > editAt + 1 && editAt >= 0) {
                this.controls.splice(at, 1);
                this.controls.splice(editAt + 1, 0, share);
            }
            if (this.$.client && this.$.client.children) {
                var kids = this.$.client.children, ci = kids.indexOf(share), ei = kids.indexOf(edit);
                if (ci > ei + 1 && ei >= 0) {
                    kids.splice(ci, 1);
                    kids.splice(ei + 1, 0, share);
                }
            }
        };
        // Share is dimmed when there is nothing to share, read as the menu opens.
        var prepareOpen = proto.prepareOpen;
        proto.prepareOpen = function () {
            var r = prepareOpen.apply(this, arguments);
            if (r && this.$.phoenixShare && this.$.phoenixShare.setDisabled)
                this.$.phoenixShare.setDisabled(!runtime.shareContent());
            return r;
        };
        proto.phoenixShareClick = function () {
            var c = runtime.shareContent();
            this.close();
            if (c && runtime.share)
                runtime.share(c);
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
        var ROTATION_LOCK_ORIENTATIONS = ["up", "down", "left", "right"];

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
                // The networks in range for the system menu's Wi-Fi drawer,
                // the same as Settings > Wi-Fi lists (the shell had a list of
                // its own): ssid, bars, security ("" open), known (a profile
                // is kept), state "" | "connecting" | "ipConfigured".
                wifiNetworks: !s.wifi.enabled ? [] : AIR.map(function (a) {
                    return { ssid: a.ssid, bars: bars(a.signalLevel), security: a.security[0] || "",
                             known: s.wifi.profiles.some(function (x) { return x.ssid === a.ssid; }),
                             state: s.wifi.connected === a.ssid ? "ipConfigured" : connecting === a.ssid ? "connecting" : "" };
                }),
                bluetoothOn: !!s.bluetooth.powered,
                // How many devices are paired: none, and the system menu
                // turning Bluetooth on opens its preferences to pair one (the
                // original asked the Bluetooth app's "numofprofiles",
                // StatusBarServicesConnector.cpp:2573-2632).
                bluetoothPairedCount: s.bluetooth.paired.length,
                airplaneMode: !!s.offlineMode,
                brightness: s.settings.picture.backlight,
                // The rotation lock, and the orientation it holds: the
                // preference keeps it, as LunaSysMgr's rotationLock kept the
                // orientation (Preferences.cpp:196-201, read at boot by
                // WindowServer::bootupFinished). true: locked, the shell
                // picks how the UI is turned now.
                rotationLocked: !!p.rotationLock,
                rotationLockOrientation: ROTATION_LOCK_ORIENTATIONS.indexOf(p.rotationLock) >= 0 ? p.rotationLock : "",
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
                // The keyboards installed (Settings > Text Assist >
                // Keyboards, GAPS V7), in order, and the one in use (the
                // globe key switches).
                installedKeyboards: installedKeyboards(p),
                // Settings > Text Assist > Hardware Keyboard (GAPS V8 (5)):
                // the layout and the modifier keys remapped.
                hardwareKeyboard: hardwareKeyboardPrefs(p.hardwareKeyboard),
                keyboardId: keyboardIdInUse(p),
                ringtone: (p.ringtone && p.ringtone.fullPath) || "",
                // Phone preferences: unconditional call forwarding on (the
                // status bar's call-forward icon, StatusBarInfo::setCallForward).
                callForwarding: runtime.callForwarding ? runtime.callForwarding() : false,
                alerttone: (p.alerttone && p.alerttone.fullPath) || "",
                notificationtone: (p.notificationtone && p.notificationtone.fullPath) || "",
                showAlertsWhenLocked: p.showAlertsWhenLocked !== false,
                lockScreenPreviews: p.lockScreenPreviews !== false,
                notificationRepeat: notificationRepeat(p.notificationRepeat),
                // What the volume keys adjust, as audiod's scenarios
                // (NativeAlertManager::actOnChanged): the shell's volume
                // indicator draws the phone, ringtone or music picture.
                audioScenario: audioScenario(),
                screenTimeout: typeof p.screenTimeout === "number" ? p.screenTimeout : 60,
                lockTimeout: typeof p.lockTimeout === "number" ? p.lockTimeout : 0,
                // The backlight follows the light sensor (enableALS), and
                // stays on while a USB charger is in (com.palm.display
                // setProperty onWhenConnected).
                automaticBrightness: p.enableALS !== false,
                displayOnWhenConnected: runtime.devices ? runtime.devices.onWhenConnected() : false,
                advancedGestures: p.sysUiEnableNextPrevGestures !== false,
                appRelaunch: appRelaunch(p.appRelaunch),
                keyboardShortcuts: p.keyboardShortcuts === "desktop" ? "desktop" : "ipad",
                // Settings > Accessibility: the shell's animations.
                reduceMotion: !!(p.accessibility && p.accessibility.reduceMotion),
                // ... and the hardware keyboard's sticky, slow and bounce
                // keys and key repeat (the shell's KeyboardAccess).
                keyboardAccess: keyboardAccess(p.accessibility || {}),
                // Settings > Advanced (tweaks above).
                tweaks: tweaks(p),
                // The browser's page views and the system proxy (simBrowser).
                browser: browserSettings(p),
                proxy: networkProxy(p.networkProxy),
                wallpaperFile: (p.wallpaper && p.wallpaper.wallpaperFile) || "",
                // Dock mode (Settings > Exhibition): its wallpaper, the
                // exhibitions that are on (after the built-in Time), its
                // sounds and when it starts; night mode.
                dockWallpaperFile: (p.dockwallpaper && p.dockwallpaper.wallpaperFile) || "",
                exhibitionApps: runtime.exhibitionApps ? runtime.exhibitionApps() : [],
                // Developer Mode (com.webos.service.devmode) and whether its
                // pane was revealed (Just Type's Konami code): the shell
                // shows the developer apps and Settings' launch point by them.
                devMode: !!store.get("devMode", false),
                devModeUnlocked: p.devModeUnlocked === true,
                dockModeSound: p.dockModeSoundPref === "mute" ? "mute" : "systemsettings",
                exhibition: exhibitionPrefs(p),
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

        // Settings > Exhibition, with the defaults filled in and the times
        // checked ("HH:MM").
        function exhibitionPrefs(p) {
            var e = p.exhibition && typeof p.exhibition === "object" ? p.exhibition : {};
            var time = function (v, d) { return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v) ? v : d; };
            return { enabled: e.enabled !== false, startAfter: typeof e.startAfter === "number" && e.startAfter > 0 ? e.startAfter : 0,
                     nightMode: !!e.nightMode, nightStart: time(e.nightStart, "22:00"), nightEnd: time(e.nightEnd, "07:00") };
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
        // Phoenix (GAPS V7; the owner, 29 September 2026): whole keyboards
        // side by side, as iOS has: "classic" (the Pre's and TouchPad's,
        // V1), "phoenix" (Phoenix's own look over the same keys and Text
        // Assist), "ose" (OSE's own Maliit keyboard: on a device). In the
        // user's order (x_palm_virtualkeyboard_prefs installed); the one in
        // use is x_palm_virtualkeyboard_settings keyboardId.
        var KEYBOARD_IDS = ["classic", "phoenix", "ose"];
        // The hardware keyboard: {layout: "auto" | "qwertz" | "azerty",
        // remap: {capslock, control, alt, meta: a key's new part}}.
        var HW_LAYOUTS = ["auto", "qwertz", "azerty"];
        var HW_REMAP_KEYS = ["capslock", "control", "alt", "meta"];
        var HW_REMAP_TARGETS = ["capslock", "control", "alt", "meta", "escape", "keyboard", "none"];
        function hardwareKeyboardPrefs(h) {
            h = h && typeof h === "object" ? h : {};
            var remap = {};
            HW_REMAP_KEYS.forEach(function (k) {
                var t = h.remap && h.remap[k];
                if (HW_REMAP_TARGETS.indexOf(t) >= 0 && t !== k)
                    remap[k] = t;
            });
            return { layout: HW_LAYOUTS.indexOf(h.layout) >= 0 ? h.layout : "auto", remap: remap };
        }
        runtime.hardwareKeyboardPrefs = hardwareKeyboardPrefs;
        function installedKeyboards(p) {
            var list = (Array.isArray(keyboardPrefs(p).installed) ? keyboardPrefs(p).installed : [])
                .filter(function (id, i, all) { return KEYBOARD_IDS.indexOf(id) >= 0 && all.indexOf(id) === i; });
            return list.length ? list : ["classic"];
        }
        function keyboardSettings(p) {
            var st = p.x_palm_virtualkeyboard_settings;
            if (typeof st === "string") { try { st = JSON.parse(st); } catch (e) { st = null; } }
            return st && typeof st === "object" ? st : {};
        }
        function keyboardIdInUse(p) {
            var id = keyboardSettings(p).keyboardId, list = installedKeyboards(p);
            return list.indexOf(id) >= 0 ? id : list[0];
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
            var ti = p.x_palm_textinput && typeof p.x_palm_textinput === "object" ? p.x_palm_textinput : {};
            // The user's shortcuts, typed (lower case) -> text.
            var shortcuts = {};
            (Array.isArray(ti.shortcuts) ? ti.shortcuts : []).forEach(function (s) {
                if (s && typeof s.shortcut === "string" && s.shortcut && typeof s.text === "string" && s.text)
                    shortcuts[s.shortcut.toLowerCase()] = s.text;
            });
            return { suggestions: kb.WordSuggestions !== false, autoCorrect: kb.AutoCorrect !== false,
                     swipe: kb.SwipeTyping !== false, spaces2period: kb.spaces2period !== false,
                     emojiSuggestions: kb.EmojiSuggestions !== false,
                     forgetWords: typeof kb.ForgetWords === "number" ? kb.ForgetWords : 0,
                     shortcuts: shortcuts, shortcutsOn: ti.shortcutChecking !== "off",
                     userWords: dictionaryWords(ti), removedWords: removedWords(ti) };
        }
        // Settings > Text Assist > Personal Dictionary (Phoenix): the words the
        // user added (x_palm_textinput.userWords), never corrected and
        // suggested, and the learned words deleted there, lower case -> when
        // (removedWords; the keyboard drops each once).
        var DICTIONARY_WORD = /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F']*$/;
        function dictionaryWords(ti) {
            return (Array.isArray(ti.userWords) ? ti.userWords : []).filter(function (w) {
                return typeof w === "string" && w.length <= 48 && DICTIONARY_WORD.test(w);
            });
        }
        function removedWords(ti) {
            var out = {}, r = ti.removedWords && typeof ti.removedWords === "object" ? ti.removedWords : {};
            Object.keys(r).forEach(function (w) { if (typeof r[w] === "number" && r[w] > 0) out[w.toLowerCase()] = r[w]; });
            return out;
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
                if (e.key === "phoenix:" + KEY || e.key === "phoenix:prefs" || e.key === "phoenix:deviceLocked" || e.key === "phoenix:dockMode") changed();
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
                // The device's zone is always one of them: one taken from
                // the computer may not be in the list (Europe/Vienna, say).
                var cur = (prefs().timeZone || {}).ZoneID;
                var list = ZONES.slice();
                if (cur && !ZONES.some(function (z) { return z[0] === cur; }))
                    list.push([cur, cur.split("/").pop().replace(/_/g, " "), "", ""]);
                reply(ok({ timeZone: list.map(function (z) {
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
            // The airplaneMode preference turns the radios off and on, as
            // LunaSysMgr did when it changed (Preferences
            // signalAirplaneModeChanged -> StatusBarServicesConnector::
            // setAirplaneMode): luna-systemui's power menu sets it.
            if ("airplaneMode" in p) {
                var st = load();
                if (!!st.offlineMode !== !!p.airplaneMode) {
                    setOffline(st, !!p.airplaneMode);
                    save(st);
                }
            }
            if (["rotationLock", "wallpaper", "timeFormat", "showAlertsWhenLocked", "lockScreenPreviews", "notificationRepeat", "screenTimeout", "lockTimeout", "enableALS", "sysUiEnableNextPrevGestures", "appRelaunch", "keyboardShortcuts", "systemSounds", "ringtone", "alerttone",
                 "notificationtone", "x_palm_virtualkeyboard_prefs", "x_palm_virtualkeyboard_settings", "x_palm_textinput", "accessibility", "hardwareKeyboard",
                 "dockwallpaper", "dockModeSoundPref", "exhibition", "browserContentBlocker", "browserUserAgent",
                 "networkProxy", "devModeUnlocked"].concat(TWEAK_KEYS).some(function (k) { return k in p; })) {
                if ("devModeUnlocked" in p && runtime.developerGateChanged) runtime.developerGateChanged();
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
        //
        // luna-sysmgr's Security.cpp and EASPolicyManager.cpp, ported:
        //   getDeviceLockMode {subscribe} -> {lockMode: "none" | "pin" | "password",
        //       policyState: "none" | "active" | "pending", retriesLeft}
        //   getSecurityPolicy {} -> {policy: {password: {enabled, minLength,
        //       maxRetries, alphaNumeric, allowSimplePassword?}, inactivityInSeconds,
        //       id, status: {enforced, retriesLeft}}}, or returnValue false
        //       without a policy (SystemService.cpp:2295-2400)
        //   setDevicePasscode {lockMode, passCode, oldPasscode}: Phoenix asks for
        //       the old passcode when one is set, except while a security
        //       policy is pending: the lock screen then sets the one the policy
        //       asks for, as LockWindow did (LockWindow.cpp:1427-1530). Against
        //       a policy that requires a passcode, the original's checks and
        //       errors (Security::validatePasscode, Security.cpp:466-512;
        //       errorCode -1 to -9); without one, Phoenix's (4 digits or
        //       characters at least).
        //   matchDevicePasscode {passCode} -> {succeeded}, and when it is not
        //       {lockedOut, retriesLeft} (Security::matchPasscode, :325-385).
        //       Phoenix answers returnValue true with succeeded; the original
        //       answered returnValue false for a wrong passcode.
        //
        // The security policy (EAS: an Exchange account asks the device for a
        // passcode) is what the accounts put in db8 as com.palm.securitypolicy:1
        // objects, with EAS's field names (devicePasswordEnabled,
        // minDevicePasswordLength, maxDevicePasswordFailedAttempts,
        // alphanumericDevicePasswordRequired, allowSimpleDevicePassword,
        // maxInactivityTimeDeviceLock), merged into the strictest of them
        // (EASPolicyManager.cpp:300-384, EASPolicy::merge :968-1012).
        // phoenix-sim --security-policy puts one there. A policy that asks for
        // a passcode the device does not have (or one too weak for it) is
        // "pending" until one is set, then "active": each wrong passcode then
        // costs one of its maxRetries, and the last wipes the device
        // (com.palm.storage/erase/Wipe). Without a policy, three wrong
        // passcodes in a row hold the next try off for 15 s
        // (Security.cpp:43-44, s_defaultMaxRetries, s_deviceLockOutDuration).

        function hash(s) {
            // Not a secure hash: the simulator only needs to avoid storing the
            // passcode itself. A device implementation must use a real KDF.
            var h = 5381;
            for (var i = 0; i < s.length; ++i) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
            return "djb2:" + (h >>> 0).toString(16);
        }
        var DEFAULT_RETRIES = 3, LOCKOUT_MS = 15000;
        var POLICY_KIND = "com.palm.securitypolicy:1";
        function dbSecurity(method, params) {
            var out, db = runtime.services["com.palm.db"];
            db[method](params, function (r) { if (out === undefined) out = r; }, { cancelled: function () { return true; } });
            return out || {};
        }
        if (dbSecurity("/find", { query: { from: POLICY_KIND } }).returnValue === false)
            dbSecurity("/putKind", { id: POLICY_KIND, owner: "com.palm.systemmanager" });

        // EASPolicy::fromNewJSON (:867-938) for each, merged into an
        // aggregate that starts as EASPolicy(true) (EASPolicyManager.h:40-46).
        // maxInactivityInSeconds (:943-956): down to 30 s steps under a
        // minute, minute steps under 9999 s, else 0.
        function maxInactivity(sec) {
            if (sec < 60) return sec - sec % 30;
            if (sec < 9999) return sec - sec % 60;
            return 0;
        }
        function aggregatePolicy() {
            var docs = (dbSecurity("/find", { query: { from: POLICY_KIND } }).results || []).filter(function (d) { return !d._del; });
            if (!docs.length) return null;
            var a = { passwordRequired: false, maxRetries: 0, minLength: 1, alphaNumeric: false, allowSimple: true,
                      inactivity: 9998, id: "" };
            docs.forEach(function (d) {
                var n = { passwordRequired: !!d.devicePasswordEnabled, alphaNumeric: !!d.alphanumericDevicePasswordRequired,
                          minLength: d.minDevicePasswordLength !== undefined ? d.minDevicePasswordLength | 0 : 1,
                          maxRetries: d.maxDevicePasswordFailedAttempts !== undefined ? d.maxDevicePasswordFailedAttempts | 0 : 1,
                          inactivity: d.maxInactivityTimeDeviceLock !== undefined ? d.maxInactivityTimeDeviceLock | 0 : 0,
                          allowSimple: d.allowSimpleDevicePassword !== undefined ? !!d.allowSimpleDevicePassword : true };
                if (!a.passwordRequired && n.passwordRequired) {
                    a.passwordRequired = true;
                    a.maxRetries = n.maxRetries;
                    a.minLength = n.minLength;
                    a.alphaNumeric = n.alphaNumeric;
                    a.allowSimple = n.allowSimple;
                    a.inactivity = maxInactivity(n.inactivity);
                } else if (a.passwordRequired && n.passwordRequired) {
                    if (n.inactivity < a.inactivity) a.inactivity = maxInactivity(n.inactivity);
                    if (n.maxRetries > 1 && (!(a.maxRetries > 1) || n.maxRetries < a.maxRetries)) a.maxRetries = n.maxRetries;
                    if (n.alphaNumeric) a.alphaNumeric = true;
                    if (!n.allowSimple) a.allowSimple = false;
                    if (n.minLength > 1 && n.minLength > a.minLength) a.minLength = n.minLength;
                }
                if (!a.id && d._id) a.id = String(d._id);
            });
            return a;
        }
        // EASPolicy::validMaxRetries / validMinLength (EASPolicyManager.h:70-71).
        function validMaxRetries(a) { return !!a && a.passwordRequired && a.maxRetries > 1; }
        function validMinLength(a) { return !!a && a.passwordRequired && a.minLength > 1; }

        // Security::validateStrength (:540-590): no run of repeated or
        // consecutive characters longer than half the passcode.
        function strength(pass) {
            var max = Math.floor(pass.length / 2), j = 0;
            for (var i = 0; i < pass.length - 1; i++) {
                var cur = pass.charCodeAt(i), next = pass.charCodeAt(i + 1), dir = next - cur;
                if (dir > -2 && dir < 2) {
                    var n = 2;
                    cur = next;
                    for (j = i + 2; j < pass.length; j++) {
                        next = pass.charCodeAt(j);
                        if (next - cur !== dir) break;
                        if (++n > max) return dir === 0 ? -8 : -9;
                        cur = next;
                    }
                    i = j - 1;
                }
            }
            return 0;
        }
        // What a policy needs to know of a passcode, kept when it is set: on
        // a device Security::passcodeSatisfiesPolicy (:400-418) decrypts the
        // passcode itself; the simulator keeps only its hash.
        function traits(mode, pass) {
            return { mode: mode, length: pass.length, letters: /[A-Za-zÀ-￿]/.test(pass), digits: /[0-9]/.test(pass),
                     digitsOnly: /^[0-9]*$/.test(pass), strength: strength(pass) };
        }
        // Security::validatePasscode (:466-512), on those.
        function validate(a, t) {
            if (!a || !a.passwordRequired) return 0;
            if (t.mode === "none" || !t.length) return -1;
            if (validMinLength(a) && t.length < a.minLength) return -2;
            if (a.alphaNumeric) {
                if (t.mode !== "password") return -3;
                if (!t.letters || !t.digits) return -4;
            } else if (t.mode === "pin" && !t.digitsOnly) {
                return -5;
            }
            return a.allowSimple ? 0 : t.strength || 0;
        }
        // Security::setPasscode's texts (:180-205).
        function passcodeError(code, mode) {
            return { "-1": "Passcode is empty", "-2": "Passcode not minimum length", "-3": "Alphanumeric characters required",
                     "-4": "Alphanumeric characters required", "-5": "Pin invalid",
                     "-8": mode === "pin" ? "No repeating numbers (3333)" : "No repeating characters (aaaa)",
                     "-9": mode === "pin" ? "No sequential numbers (1234)" : "No sequential characters (abcd)" }[String(code)]
                || "Passcode general failure";
        }

        // The lock, with the policy brought up to date: a new or changed
        // policy is enforced at once when the passcode satisfies it
        // (EASPolicyManager::notifyPolicyChanged, :692-700), and its retries
        // start again when it allows another number (:358-372).
        function lockState(s) {
            var l = s.lock, a = aggregatePolicy();
            if (l.numRetries === undefined) l.numRetries = DEFAULT_RETRIES;
            var sig = a ? toJson(a) : "";
            if (sig !== (l.policy ? l.policy.sig : "")) {
                var old = l.policy;
                if (!a) {
                    l.policy = null;
                    l.numRetries = DEFAULT_RETRIES;   // Security::slotPolicyChanged (:387-397)
                } else {
                    var enforced = validate(a, l.traits || traits(l.lockMode, "")) === 0;
                    l.policy = { sig: sig, enforced: enforced, maxRetries: a.maxRetries,
                                 retriesLeft: old && old.maxRetries === a.maxRetries ? old.retriesLeft : a.maxRetries };
                    if (!validMaxRetries(a) && enforced) l.numRetries = 0;
                }
                save(s);
            }
            return { a: a, l: l, pending: !!(a && !l.policy.enforced) };
        }
        function policyState(st) { return !st.a ? "none" : st.pending ? "pending" : "active"; }
        // EASPolicyManager::retriesLeft (:741-746).
        function easRetriesLeft(st) {
            return validMaxRetries(st.a) && !st.pending ? st.l.policy.retriesLeft : 0;
        }

        var stub = runtime.services["com.palm.systemmanager"] || { "*": function (p, reply) { reply(ok()); } };
        register(["com.palm.systemmanager"], {
            // takeScreenShot {file} (SystemService.cpp cbTakeScreenShot): the
            // shell captures the screen as the key combination does, into
            // the screen captures (Photos); Phoenix names the file itself.
            "/takeScreenShot": function (p, reply) {
                if (typeof p.file !== "string") return reply(fail(-1, "file is required"));
                reply(ok());
                host.postToHost("takeScreenshot", { file: p.file });
            },
            // The lock screen is up, as the shell last said (SystemService
            // getLockStatus); subscribe to hear it lock and unlock. The phone
            // app answers a ringing call when the user unlocks.
            "/getLockStatus": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ locked: !!store.get("deviceLocked", false) }); });
            },
            // Dock mode (an exhibition on the Touchstone) is up, as the shell
            // last said (SystemService.cpp:1913-1990 getDockModeStatus
            // {enabled}); subscribe to hear it start and end.
            "/getDockModeStatus": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ enabled: !!store.get("dockMode", false) }); });
            },
            // How the UI and the device are turned, as the shell last said
            // ({ orientation: { ui, device } }); subscribe to follow them.
            // ime.visible: the virtual keyboard is up, as the shell last said.
            "/getSystemStatus": function (p, reply, ctx) {
                watch(p, reply, ctx, function () {
                    var o = store.get("orientation", null) || {};
                    // gestureArea (Phoenix): the shell says whether there is one.
                    // learnedWords (Phoenix): what the keyboard learned that
                    // its word list lacks, as the shell last said.
                    return ok({ ime: { visible: !!store.get("imeVisible", false) }, orientation: { ui: o.ui || "up", device: o.device || "up" },
                                gestureArea: !!store.get("gestureArea", false), learnedWords: store.get("learnedWords", []) });
                });
            },
            "/getDeviceLockMode": function (p, reply, ctx) {
                watch(p, reply, ctx, function () {
                    var st = lockState(load());
                    return ok({ lockMode: st.l.lockMode, policyState: policyState(st), retriesLeft: easRetriesLeft(st) });
                });
            },
            "/getSecurityPolicy": function (p, reply) {
                var st = lockState(load()), a = st.a;
                if (!a) return reply({ returnValue: false });
                var password = { enabled: a.passwordRequired, minLength: a.minLength, maxRetries: a.maxRetries, alphaNumeric: a.alphaNumeric };
                if (a.passwordRequired && !a.alphaNumeric) password.allowSimplePassword = a.allowSimple;
                reply(ok({ policy: { password: password, inactivityInSeconds: a.inactivity, id: a.id,
                                     status: { enforced: !st.pending, retriesLeft: st.l.policy.retriesLeft } } }));
            },
            "/setDevicePasscode": function (p, reply) {
                var s = load(), st = lockState(s), mode = p.lockMode, pass = typeof p.passCode === "string" ? p.passCode : "";
                if (st.l.lockMode !== "none" && !st.pending && hash(p.oldPasscode || "") !== st.l.hash)
                    return reply(fail(-1, "Incorrect passcode"));
                if (["none", "pin", "password"].indexOf(mode) < 0) return reply(fail(-1, "Invalid lock mode"));
                var t = traits(mode, mode === "none" ? "" : pass);
                if (st.a && st.a.passwordRequired) {
                    var code = validate(st.a, t);
                    if (code < 0) return reply(fail(code, passcodeError(code, mode)));
                } else {
                    if (mode === "pin" && !/^[0-9]{4,}$/.test(pass)) return reply(fail(-1, "A PIN needs at least 4 digits"));
                    if (mode === "password" && pass.length < 4) return reply(fail(-1, "Passwords need at least 4 characters"));
                }
                s.lock.lockMode = mode;
                s.lock.hash = mode === "none" ? "" : hash(pass);
                s.lock.traits = t;
                // EASPolicyManager::passwordEnforced (:728-738).
                if (st.pending && mode !== "none") {
                    s.lock.policy.enforced = true;
                    s.lock.policy.retriesLeft = st.a.maxRetries;
                }
                save(s);
                reply(ok());
            },
            "/matchDevicePasscode": function (p, reply) {
                var s = load(), st = lockState(s), l = s.lock, now = Date.now();
                var counted = validMaxRetries(st.a) && !st.pending;
                if ((!st.a || st.pending) && l.numRetries === 0) {
                    if (now - (l.lastFailure || 0) < LOCKOUT_MS)
                        return reply(ok({ succeeded: false, lockedOut: true, retriesLeft: 0 }));
                    l.numRetries = DEFAULT_RETRIES;
                }
                var good = l.lockMode === "none" || hash(p.passCode || "") === l.hash;
                var wipe = false;
                if (!good) {
                    if (l.numRetries > 0) l.numRetries--;
                    if (counted) {
                        if (l.policy.retriesLeft > 0) l.policy.retriesLeft--;
                        l.numRetries = l.policy.retriesLeft;
                        wipe = l.numRetries === 0;
                    }
                    l.lastFailure = now;
                } else if (st.a && !st.pending) {
                    if (counted) l.policy.retriesLeft = st.a.maxRetries;
                    l.numRetries = counted ? st.a.maxRetries : 0;
                } else {
                    l.numRetries = DEFAULT_RETRIES;
                }
                save(s);
                reply(good ? ok({ succeeded: true }) : ok({ succeeded: false, lockedOut: false, retriesLeft: l.numRetries }));
                // Boom (Security::eraseDevice, :420-432).
                if (wipe)
                    dispatch("palm://com.palm.storage/erase/Wipe", {}, function () {}, { cancelled: function () { return false; } });
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
                // The developer apps come and go (launchPointChanges, and
                // the shell's launcher: systemStatus devMode).
                if (runtime.developerGateChanged) runtime.developerGateChanged();
                if (runtime.hostStatus) host.postToHost("systemStatus", runtime.hostStatus());
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
                fullErase().then(function () {
                    reply(ok());
                    restartErased();
                }, function (e) { reply(fail(-1, "Could not erase the files: " + e)); });
            }
        });
        function fullErase() {
            eraseStore(false);
            var media = runtime.mediaFiles;
            return media ? media.clear() : Promise.resolve();
        }
        // The device restarts into First Use. phoenix-sim also removes its
        // data folder and settings (SimProcess::eraseAndRestart); a page in a
        // browser has nothing more to erase.
        function restartErased() {
            if (!/^https?:$/.test(global.location.protocol))
                host.postToHost("erase", {});
        }

        // ---- com.palm.storage: erase and USB drive mode (storaged) -------------------
        //
        // The legacy storage daemon's methods LunaSysMgr and luna-systemui call:
        //   erase/EraseAll {}   Full Erase (WindowServerLuna::slotFullEraseDevice,
        //                       the Full Erase key chord): the apps' data and the
        //                       USB drive's files, then the device restarts
        //   erase/Wipe {}       the same, when a security policy's last try
        //                       failed (Security::eraseDevice)
        //   diskmode/hostIsConnected {} -> {result, hostIsConnected}: a cable
        //                       from a computer is in (luna-systemui
        //                       StoragedService.js, StoragedAlerts.js)
        //   diskmode/enterMSM {"user-confirmed", enterIMasq}: USB drive mode
        // and its /storaged signals (com.palm.bus/signal/addmatch): MSMAvail
        // {mode-avail}, MSMProgress {stage, enterIMasq}, MSMEntry {new-mode,
        // enterIMasq}, MSMFscking {}, PartitionAvail {fscked | reformatted}.
        // The simulator's storaged is phoenix-sim's (SimStorage.qml, F12 and
        // Shift+F12): a page asks it with an "enterMSM" host message, and it
        // signals every page through runtime.storagedSignal and the shell
        // directly. The cable's state reaches the pages as host status
        // ({usbHost: true | false}).
        register(["com.palm.storage"], {
            "/erase/EraseAll": function (p, reply) {
                fullErase().then(function () {
                    reply(ok());
                    restartErased();
                }, function (e) { reply(fail(-1, "Could not erase: " + e)); });
            },
            "/erase/Wipe": function (p, reply) {
                fullErase().then(function () {
                    reply(ok());
                    restartErased();
                }, function (e) { reply(fail(-1, "Could not erase: " + e)); });
            },
            // The page may ask before phoenix-sim has told it about the
            // cable (luna-systemui asks as it starts, and the host's status
            // comes once the page has loaded): the answer waits for it, 3 s
            // at most. A page in a browser has no host to wait for.
            "/diskmode/hostIsConnected": function (p, reply) {
                var answer = function () { reply(ok({ result: true, hostIsConnected: !!store.get("usbHost", false) })); };
                if (usbKnown)
                    return answer();
                usbWaiting.push(answer);
                setTimeout(function () {
                    var i = usbWaiting.indexOf(answer);
                    if (i >= 0) { usbWaiting.splice(i, 1); answer(); }
                }, 3000);
            },
            "/diskmode/enterMSM": function (p, reply) {
                if (!store.get("usbHost", false)) return reply(fail(-1, "No computer is connected"));
                reply(ok());
                host.postToHost("enterMSM", { enterIMasq: !!p.enterIMasq });
            },
            "*": function (p, reply) { reply(ok()); }
        });
        runtime.storagedSignal = function (method, payload) {
            signal("/storaged", method, payload || {});
        };
        // The display's signals (com.palm.display's /com/palm/display):
        // powerKeyPressed {showDialog: true} when Power is held 3 s with the
        // screen on (DisplayManager::power, DisplayManager.cpp:3085-3099),
        // which luna-systemui answers with its power menu (PowerdService.js
        // powerOffHandleNotifications).
        runtime.displaySignal = function (method, payload) {
            signal("/com/palm/display", method, payload || {});
        };
        var usbKnown = /^https?:$/.test(global.location.protocol), usbWaiting = [];
        function usbHostKnown() {
            usbKnown = true;
            usbWaiting.splice(0).forEach(function (answer) { answer(); });
        }

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
        // The shell sends each change to every page, but only one page, the
        // writer (opts.writer; the system UI page in phoenix-sim), stores it
        // in settings:state, and only when it changes something there. The
        // state is one object that each page reads from its own process's
        // copy of localStorage and writes back whole: when every page wrote
        // it back on every push (the keyboard going down as a dialog
        // closed), an older copy could land after a setting the user had
        // just saved and undo it (a new PIN lost on the next start).
        // Without opts (a page on its own, the browser tests) it writes.
        runtime.applyHostStatus = function (st, opts) {
            if (!st) return;
            var writer = !opts || opts.writer !== false;
            // Blocks below that follow the shell's own status (the
            // accessories, the battery's use): hook(status, writer).
            (runtime.hostStatusHooks || []).forEach(function (h) {
                try { h(st, writer); } catch (e) { console.warn("[phoenix-runtime] status hook: " + (e && e.message || e)); }
            });
            var s = writer ? load() : null, before = writer ? toJson(s) : "";
            if (writer) {
                if ("airplaneMode" in st) setOffline(s, !!st.airplaneMode);
                if ("wifiEnabled" in st && !!st.wifiEnabled !== !!s.wifi.enabled) setWifi(s, !!st.wifiEnabled);
                // A network picked in the system menu's Wi-Fi drawer: a known
                // or open one joins at once (a secured one it has no key for
                // opens Settings > Wi-Fi instead), once this state is saved.
                if (st.wifiConnect && s.wifi.enabled && airFor(st.wifiConnect)) {
                    var join = st.wifiConnect;
                    setTimeout(function () { wifi["/connect"]({ ssid: join }, function () {}); }, 0);
                }
                if ("bluetoothOn" in st) s.bluetooth.powered = !!st.bluetoothOn;
                if ("brightness" in st) s.settings.picture.backlight = Math.round(st.brightness);
                if ("muted" in st) s.audio.muted = !!st.muted;
                // The system menu's volume slider: the master volume.
                if ("volume" in st) s.audio.volume = Math.max(0, Math.min(100, Math.round(st.volume)));
                vpnFromShell(s, st);
            }
            // The shell's lock screen (com.palm.systemmanager getLockStatus).
            if ("deviceLocked" in st && !!st.deviceLocked !== !!store.get("deviceLocked", false)) {
                store.set("deviceLocked", !!st.deviceLocked);
                changed();
            }
            // Dock mode (getDockModeStatus).
            if ("dockMode" in st && !!st.dockMode !== !!store.get("dockMode", false)) {
                store.set("dockMode", !!st.dockMode);
                changed();
            }
            // How the UI and the device are turned (getSystemStatus).
            if (st.orientation && toJson(st.orientation) !== toJson(store.get("orientation", null))) {
                store.set("orientation", { ui: st.orientation.ui, device: st.orientation.device });
                changed();
            }
            // The screen, upright, in legacy pixels (PalmSystem.deviceInfo):
            // the adaptive simulator's window resized.
            if (st.screen && toJson(st.screen) !== toJson(store.get("screen", null))) {
                store.set("screen", { width: st.screen.width, height: st.screen.height });
                changed();
            }
            // The device has a gesture area (getSystemStatus gestureArea).
            if ("gestureArea" in st && !!st.gestureArea !== !!store.get("gestureArea", false)) {
                store.set("gestureArea", !!st.gestureArea);
                changed();
            }
            // A cable from a computer is in (com.palm.storage diskmode/hostIsConnected).
            if ("usbHost" in st) {
                store.set("usbHost", !!st.usbHost);
                usbHostKnown();
            }
            // The virtual keyboard is up ({ ime: { visible } }, getSystemStatus).
            if (st.ime && !!st.ime.visible !== !!store.get("imeVisible", false)) {
                store.set("imeVisible", !!st.ime.visible);
                changed();
            }
            // The words the keyboard learned that its list lacks (Settings >
            // Text Assist > Personal Dictionary; getSystemStatus learnedWords).
            if (Array.isArray(st.learnedWords) && toJson(st.learnedWords) !== toJson(store.get("learnedWords", []))) {
                store.set("learnedWords", st.learnedWords.filter(function (w) { return typeof w === "string"; }));
                changed();
            }
            if (!writer) {
                changed();
                return;
            }
            suppressHost = true;
            try {
                // The keyboard's language key chose another keyboard.
                // ... or the globe key another whole keyboard (V7). Both
                // are kept in x_palm_virtualkeyboard_settings.
                var kbSettings = null;
                if (st.keyboard && keyboardCombo(st.keyboard))
                    kbSettings = keyboardCombo(st.keyboard);
                if (typeof st.keyboardId === "string" && installedKeyboards(prefs()).indexOf(st.keyboardId) >= 0
                        && st.keyboardId !== keyboardIdInUse(prefs()))
                    kbSettings = kbSettings || keyboardCombo(keyboardSettings(prefs())) || keyboardInUse(prefs());
                if (kbSettings) {
                    var nextId = typeof st.keyboardId === "string" && installedKeyboards(prefs()).indexOf(st.keyboardId) >= 0
                        ? st.keyboardId : keyboardIdInUse(prefs());
                    sys["/setPreferences"]({ x_palm_virtualkeyboard_settings: JSON.stringify({ layout: kbSettings.layout, language: kbSettings.language,
                                                                                             keyboardId: nextId }) },
                                           function () {}, { cancelled: function () { return false; } });
                }
                // The keyboard's "Add" (after backspace put back a corrected
                // word): into the personal dictionary.
                if (typeof st.dictionaryWordAdded === "string" && DICTIONARY_WORD.test(st.dictionaryWordAdded)) {
                    var ti = prefs().x_palm_textinput && typeof prefs().x_palm_textinput === "object" ? prefs().x_palm_textinput : {};
                    var w = st.dictionaryWordAdded, words = dictionaryWords(ti);
                    if (!words.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) {
                        var next = {};
                        Object.keys(ti).forEach(function (k) { next[k] = ti[k]; });
                        next.userWords = words.concat([w]);
                        sys["/setPreferences"]({ x_palm_textinput: next }, function () {}, { cancelled: function () { return false; } });
                    }
                }
                if ("rotationLocked" in st) {
                    // Locked to the orientation the shell says, else just on.
                    var lock = !st.rotationLocked ? false
                             : ROTATION_LOCK_ORIENTATIONS.indexOf(st.rotationLockOrientation) >= 0 ? st.rotationLockOrientation : true;
                    var was = prefs().rotationLock;
                    if (lock !== was && !(lock === true && ROTATION_LOCK_ORIENTATIONS.indexOf(was) >= 0))
                        sys["/setPreferences"]({ rotationLock: lock }, function () {}, { cancelled: function () { return false; } });
                }
                if (toJson(s) !== before) save(s);
                else changed();
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

        // Focus navigation with a hardware keyboard (GAPS V8 (3)) in what
        // Chromium's Tab does not reach well: an app's own app menu (Phoenix's
        // @phoenix/ui AppMenu, Enyo 1.0's enyo.AppMenu) and the buttons of a
        // popup alert's page (luna-systemui's NotificationButtons; the shell
        // passes the keys on, Shell._dialogKey). The arrows (and Tab) move a
        // ring over the items, Enter or Space presses the one ringed, as the
        // shell's own dialogs do (ActionButton.keyFocused).
        var KEYNAV_MENU = ".pui-appmenu [role=menuitem], .enyo-appmenu .enyo-menuitem";
        var KEYNAV_BUTTONS = ".enyo-notification-button, .enyo-notification-button-affirmative, "
            + ".enyo-notification-button-negative, .enyo-notification-button-alternate, .enyo-button, button, [role=button]";
        function keyNavItems(selector) {
            var doc = global.document;
            return Array.prototype.slice.call(doc.querySelectorAll(selector)).filter(function (el, i, all) {
                if (all.indexOf(el) !== i || el.getAttribute("aria-disabled") === "true" || el.disabled) return false;
                // Enyo 1.0's dimmed item: its own row is "enyo-item-disabled"
                // (Item.js disabledChanged -> stateChanged).
                var row = el.firstElementChild;
                if (/-disabled\b/.test(el.className) || (row && /-disabled\b/.test(row.className))) return false;
                // Shown: laid out, and not inside a closed drawer.
                var r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && global.getComputedStyle(el).visibility !== "hidden";
            });
        }
        function keyNavStyle() {
            var doc = global.document;
            if (doc.getElementById("phoenix-keyfocus-style")) return;
            var st = doc.createElement("style");
            st.id = "phoenix-keyfocus-style";
            st.textContent = ".phoenix-keyfocus { outline: 3px solid rgb(75, 151, 222) !important; outline-offset: -3px; }";
            (doc.head || doc.documentElement).appendChild(st);
        }
        // key: "next", "previous", "press"; scope: "menu", "buttons" or ""
        // (the menu when one is open, else the buttons). True when handled.
        runtime.keyNav = function (key, scope) {
            var items = scope === "buttons" ? [] : keyNavItems(KEYNAV_MENU);
            if (!items.length && scope !== "menu") items = keyNavItems(KEYNAV_BUTTONS);
            if (!items.length) return false;
            var doc = global.document;
            var cur = doc.querySelector(".phoenix-keyfocus");
            var i = items.indexOf(cur);
            if (key === "press") {
                var el = i >= 0 ? items[i] : null;
                if (!el) return false;
                // (The ring stays while the item does: Edit opens its drawer
                // and Down goes on into it.)
                // A finger's press: Mojo and Enyo widgets act on these.
                ["mousedown", "mouseup"].forEach(function (t) {
                    el.dispatchEvent(new global.MouseEvent(t, { bubbles: true, cancelable: true, view: global }));
                });
                el.click();
                return true;
            }
            keyNavStyle();
            if (cur) cur.classList.remove("phoenix-keyfocus");
            i = i < 0 ? (key === "previous" ? items.length - 1 : 0) : (i + (key === "previous" ? -1 : 1) + items.length) % items.length;
            items[i].classList.add("phoenix-keyfocus");
            if (items[i].scrollIntoView) items[i].scrollIntoView({ block: "nearest" });
            return true;
        };
        // In the app's own page: the arrows and Enter while its menu is open.
        if (global.document && global.document.addEventListener) {
            global.document.addEventListener("keydown", function (e) {
                if (e.ctrlKey || e.altKey || e.metaKey || !keyNavItems(KEYNAV_MENU).length) return;
                var k = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey) ? "next"
                      : e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? "previous"
                      : (e.key === "Enter" || e.key === " ") && global.document.querySelector(".phoenix-keyfocus") ? "press" : "";
                if (k && runtime.keyNav(k, "menu")) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, true);
        }

        // The shell launched an app that is already running, with new launch
        // params: update PalmSystem.launchParams, then tell the app. Enyo 1.0
        // and Mojo apps are told through Mojo.relaunch(), as LunaSysMgr did
        // (enyo-1.0 palm/system/windows/events.js: windowParamsChange,
        // applicationRelaunch); OSE apps through the "webOSRelaunch" document
        // event (detail = params), as WebAppMgr does.
        // refresh (Settings > Apps > Opening a running app: Refresh): the
        // user opened the app again and wants its data fresh; Phoenix's
        // apps also hear "phoenixRefresh" (@phoenix/luna's Refreshed starts
        // the app's root again on it).
        runtime.relaunch = function (params, refresh) {
            PalmSystem.launchParams = toJson(params || {});
            var event = function (name, detail) {
                var e;
                try { e = new CustomEvent(name, { detail: detail }); }
                catch (x) { e = global.document.createEvent("CustomEvent"); e.initCustomEvent(name, false, false, detail); }
                global.document.dispatchEvent(e);
            };
            if (global.Mojo && typeof global.Mojo.relaunch === "function")
                global.Mojo.relaunch();
            else
                event("webOSRelaunch", params || {});
            if (refresh)
                event("phoenixRefresh", params || {});
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
    //     The legacy phone preferences' calls (com.palm.app.phone
    //     shared/phoneprefs/controls/CallsPref.js, NetworkPref.js,
    //     VoicemailNumberPref.js; LunaSysMgr's StatusBarServicesConnector
    //     subscribes to forwardQuery for the status bar's icon):
    //       forwardQuery {condition, bearer, subscribe} -> {extended: {condition,
    //           status: [{bearer, activated, number}]}}
    //       forwardRegister {number ("" to stop), condition, bearer, time}
    //       clirQuery -> {extended: {restricted}}, clirSet {restrict}
    //       callWaitingQuery -> {extended: {enabled}}, callWaitingSet {enable}
    //       voicemailNumberQuery {subscribe} -> {extended: {number}},
    //           voicemailNumberSet {number}
    //       roamModeQuery -> {extended: {mode: "automatic" | "carrieronly"}},
    //           roamModeSet {mode}
    //       ratQuery -> {extended: {mode: "automatic" | "umts" | "gsm"}}, ratSet {mode}
    //     The supplementary services (forwarding, caller ID, waiting) need
    //     the network: errorCode 102 in airplane mode, as the phone app's
    //     messages say. Only unconditional forwarding is kept; while it is on,
    //     a simulated incoming call is forwarded and does not ring.
    //   com.palm.wan                          the data connection (legacy wand):
    //       getstatus {subscribe} -> {disablewan: "on" | "off" (Data Usage
    //       off / on), roamguard: "enable" | "disable" (data roaming off /
    //       on; "disable" also as the original's "neverblock"), state}
    //       set {disablewan?, roamguard?} (NetworkPref.js toggleWAN,
    //       toggleDataRoaming). The original read roamguard from
    //       com.palm.preferences appProperties; here getstatus says it.
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
    // arrive as "storage" events. db8 watches also fire across windows (see
    // makeDb), so Messaging updates when a text arrives through another page.
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
                     voicemail: { number: "(408) 555-0100", waiting: true, count: 2 },
                     // The phone preferences (network-side settings).
                     forward: { activated: false, number: "" }, clirRestricted: false, callWaiting: true,
                     roamMode: "automatic", rat: "automatic" };
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
            // Forwarded by the network: the phone never rings.
            if (s.forward && s.forward.activated && !offline())
                return 0;
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
            "/sendSmsFromDb": function (p, reply) { sendOutbox(); reply(ok()); },

            // ---- The phone preferences ---------------------------------------------
            "/forwardQuery": function (p, reply, ctx) {
                var answer = function () {
                    if (offline()) return fail(102, "No network");
                    var f = load().forward;
                    return ok({ extended: { condition: "unconditional",
                                            status: [{ bearer: "defaultbearer", activated: !!f.activated, number: f.number || "" }] } });
                };
                reply(answer());
                if (p.subscribe) listen(ctx, function () { if (!ctx.cancelled()) reply(answer()); });
            },
            "/forwardRegister": function (p, reply) {
                if (offline()) return reply(fail(102, "No network"));
                if (p.condition && p.condition !== "unconditional") return reply(fail(-1, "Only unconditional forwarding is supported"));
                var number = String(p.number || "").replace(/[^0-9+*#]/g, "");
                var s = load();
                s.forward = number ? { activated: true, number: String(p.number) } : { activated: false, number: s.forward.number || "" };
                save(s);
                reply(ok());
            },
            "/clirQuery": function (p, reply) {
                reply(offline() ? fail(102, "No network") : ok({ extended: { restricted: !!load().clirRestricted, permanent: false } }));
            },
            "/clirSet": function (p, reply) {
                if (offline()) return reply(fail(102, "No network"));
                var s = load(); s.clirRestricted = !!p.restrict; save(s); reply(ok());
            },
            "/callWaitingQuery": function (p, reply) {
                reply(offline() ? fail(102, "No network") : ok({ extended: { enabled: load().callWaiting !== false } }));
            },
            "/callWaitingSet": function (p, reply) {
                if (offline()) return reply(fail(102, "No network"));
                var s = load(); s.callWaiting = !!p.enable; save(s); reply(ok());
            },
            "/voicemailNumberQuery": function (p, reply, ctx) {
                var v = function () { return ok({ extended: { number: load().voicemail.number } }); };
                reply(v());
                if (p.subscribe) listen(ctx, function () { if (!ctx.cancelled()) reply(v()); });
            },
            "/voicemailNumberSet": function (p, reply) {
                var s = load(); s.voicemail.number = String(p.number || ""); save(s); reply(ok());
            },
            "/roamModeQuery": function (p, reply) { reply(ok({ extended: { mode: load().roamMode } })); },
            "/roamModeSet": function (p, reply) {
                if (["automatic", "carrieronly", "homeonly"].indexOf(p.mode) < 0) return reply(fail(-1, "Invalid mode"));
                var s = load(); s.roamMode = p.mode; save(s); reply(ok());
            },
            "/ratQuery": function (p, reply) { reply(ok({ extended: { mode: load().rat } })); },
            "/ratSet": function (p, reply) {
                if (["automatic", "umts", "gsm"].indexOf(p.mode) < 0) return reply(fail(-1, "Invalid mode"));
                var s = load(); s.rat = p.mode; save(s); reply(ok());
            }
        };
        register(["com.palm.telephony"], telephony);

        try {
            global.addEventListener("storage", function (e) { if (e.key === "phoenix:" + KEY) changed(); });
        } catch (x) { /* no window events */ }

        runtime.simulateIncomingCall = function (opts) { return incoming(opts); };
        // The status bar's call forwarding icon (runtime.hostStatus).
        // Off with the radio, as LunaSysMgr hid it (StatusBarServicesConnector.cpp:962).
        runtime.callForwarding = function () { var f = load().forward; return !!(f && f.activated) && !offline(); };

        // com.palm.wan: Data Usage and Data Roaming (NetworkPref.js).
        var WAN_KEY = "wan:state";
        var wanWatchers = [];
        function wan() {
            var w = store.get(WAN_KEY, null) || {};
            return { disablewan: w.disablewan === "on" ? "on" : "off", roamguard: w.roamguard === "disable" ? "disable" : "enable" };
        }
        function wanStatus() {
            var w = wan();
            return ok({ disablewan: w.disablewan, roamguard: w.roamguard,
                        state: w.disablewan === "on" || offline() ? "disconnected" : "connected" });
        }
        register(["com.palm.wan"], {
            "/getstatus": function (p, reply, ctx) {
                reply(wanStatus());
                if (p.subscribe) wanWatchers.push(function () { if (ctx.cancelled()) return false; reply(wanStatus()); return true; });
            },
            "/set": function (p, reply) {
                var w = wan();
                if (p.disablewan !== undefined) {
                    if (p.disablewan !== "on" && p.disablewan !== "off") return reply(fail(-1, "disablewan is \"on\" or \"off\""));
                    w.disablewan = p.disablewan;
                }
                if (p.roamguard !== undefined) {
                    if (["enable", "disable", "neverblock"].indexOf(p.roamguard) < 0) return reply(fail(-1, "Invalid roamguard"));
                    w.roamguard = p.roamguard === "enable" ? "enable" : "disable";
                }
                store.set(WAN_KEY, w);
                wanWatchers = wanWatchers.filter(function (fn) { return fn(); });
                reply(ok());
            }
        });
        runtime.simulateRemoteHangup = function () {
            var s = load();
            var c = s.calls.filter(function (x) { return x.state === "active"; })[0] || s.calls.filter(live)[0];
            if (!c) return false;
            end(s, c, "remote");
            save(s);
            return true;
        };

        // ---- db8 helpers ---------------------------------------------------------------
        //
        // (db8 watches fire for changes other pages make: see makeDb.)

        var dbSvc = runtime.services["com.palm.db"];
        function dbCall(method, params) {
            var out;
            dbSvc[method](params, function (r) { if (out === undefined) out = r; }, { cancelled: function () { return true; } });
            return out || {};
        }
        // Presence lives in tempdb, as on webOS (com.palm.imbuddystatus:1).
        var tempdbSvc = runtime.services["com.palm.tempdb"];
        function tempdbCall(method, params) {
            var out;
            tempdbSvc[method](params, function (r) { if (out === undefined) out = r; }, { cancelled: function () { return true; } });
            return out || {};
        }
        var MMS_KIND = "com.palm.mmsmessage:1";
        var IM_KIND = "com.palm.immessage:1";
        var IM_BUDDY_KIND = "com.palm.imbuddystatus:1";
        var IM_LOGIN_KIND = "com.palm.imloginstate:1";

        // The kinds MMS and IM add (their own version, so a store seeded
        // before them gets them too; seeding again puts them back).
        messagingKinds();
        function messagingKinds() {
            var VERSION = 1;
            if (store.get("messaging:kinds", 0) >= VERSION) return;
            [["com.palm.message:1", []], ["com.palm.smsmessage:1", ["com.palm.message:1"]],
             [MMS_KIND, ["com.palm.message:1"]], [IM_KIND, ["com.palm.message:1"]],
             ["com.palm.immessage.xmpp:1", [IM_KIND]], ["com.palm.chatthread:1", []],
             [IM_LOGIN_KIND, []]].forEach(function (k) {
                dbCall("/putKind", { id: k[0], owner: "org.webosphoenix.simulator", extends: k[1] });
            });
            tempdbCall("/putKind", { id: IM_BUDDY_KIND, owner: "org.webosphoenix.simulator" });
            store.set("messaging:kinds", VERSION);
        }

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
        // A person's own message tone (docs/M6-PLAN.md F4; the community's
        // "SMS Tone per Contact" patches): Contacts keeps it beside the
        // person, in org.webosphoenix.contacttone:1 {personId, messageTone:
        // {name, location}} (the contacts framework's person, saved whole,
        // would drop a field of its own). "" for none: the notification tone.
        var CONTACT_TONE_KIND = "org.webosphoenix.contacttone:1";
        runtime.contactToneKind = CONTACT_TONE_KIND;
        function messageToneFor(person) {
            if (!person || !person._id) return "";
            var t = (dbCall("/find", { query: { from: CONTACT_TONE_KIND, where: [{ prop: "personId", op: "=", val: person._id }] } }).results || [])[0];
            return t && t.messageTone && t.messageTone.location ? String(t.messageTone.location) : "";
        }
        // The notification for a text from person: its own tone, if it has one.
        function textNotification(fields, person) {
            var tone = messageToneFor(person);
            fields.soundClass = "notifications";
            if (tone) fields.soundFile = tone;
            return fields;
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

        // Texts (SMS, MMS) go by phone number; instant messages by the
        // buddy's address on an IM service ("type_jabber", ...), which is
        // not a phone number, and keep to their own conversations.
        function isIm(service) { return /^type_/.test(String(service || "")); }
        // The person an IM buddy is (the transport links its roster to the
        // address book, as the contacts linker did: imbuddystatus personId).
        function personForIm(addr, service) {
            var b = (tempdbCall("/find", { query: { from: IM_BUDDY_KIND } }).results || []).filter(function (x) {
                return x.serviceName === service && String(x.username).toLowerCase() === String(addr).toLowerCase();
            })[0];
            return b && b.personId ? (dbCall("/get", { ids: [b.personId] }).results || [])[0] || null : null;
        }
        // What a conversation's last line says of a picture message.
        function summaryOf(msg) {
            var pics = (msg.parts || []).filter(function (p) { return /^image\//.test(p.mimeType || ""); }).length;
            if (!pics && !(msg.parts || []).length) return msg.messageText;
            var what = pics ? (pics === 1 ? "Picture" : pics + " pictures") : "Attachment";
            return msg.messageText ? what + ": " + msg.messageText : what;
        }

        // Find or create msg's chat thread, update it (summary, timestamp,
        // unread count) and store msg with conversations = [thread id].
        function assign(msg) {
            var incomingMsg = msg.folder === "inbox";
            var addr = incomingMsg ? (msg.from && msg.from.addr) : (msg.to && msg.to[0] && msg.to[0].addr);
            var im = isIm(msg.serviceName);
            var person = addr ? (im ? personForIm(addr, msg.serviceName) : personFor(addr)) : null;
            var thread = null;
            if (msg.conversations && msg.conversations.length)
                thread = (dbCall("/get", { ids: [msg.conversations[0]] }).results || [])[0] || null;
            if (!thread) {
                var threads = dbCall("/find", { query: { from: "com.palm.chatthread:1" } }).results || [];
                for (var i = 0; i < threads.length && !thread; ++i) {
                    var t = threads[i];
                    if (im !== isIm(t.replyService)) continue;
                    if (im ? t.replyService === msg.serviceName && String(t.replyAddress).toLowerCase() === String(addr).toLowerCase()
                              && (!t.username || !msg.username || t.username === msg.username)
                           : (person && t.personId === person._id) || (!person && t.replyAddress && sameNumber(t.replyAddress, addr)))
                        thread = t;
                }
            }
            thread = thread || { _kind: "com.palm.chatthread:1", unreadCount: 0, flags: {} };
            thread.displayName = (person && personName(person)) || thread.displayName ||
                (!incomingMsg && msg.to[0].name) || (incomingMsg && msg.from.name) || addr;
            if (person) thread.personId = person._id;
            thread.normalizedAddress = im ? String(addr).toLowerCase() : digits(addr);
            thread.replyAddress = addr;
            thread.replyService = msg.serviceName || "sms";
            // The IM account the conversation is on (the immessage's username).
            if (im && msg.username) thread.username = msg.username;
            thread.summary = summaryOf(msg);
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
        // A picture message (MMS, mmsd under oFono) takes longer.
        function sendOutbox() {
            [["com.palm.smsmessage:1", 600], [MMS_KIND, 1500]].forEach(function (k) {
                var pending = dbCall("/find", { query: { from: k[0], where: [
                    { prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] } }).results || [];
                pending.forEach(function (m) {
                    dbCall("/merge", { objects: [{ _id: m._id, status: "sending" }] });
                    setTimeout(function () {
                        dbCall("/merge", { objects: [{ _id: m._id, status: offline() ? "failed" : "successful" }] });
                    }, k[1]);
                });
            });
        }

        function callP(url, params) {
            return new Promise(function (resolve) {
                dispatch(url, params || {}, resolve, { cancelled: function () { return false; }, onCancel: null });
            });
        }
        // A picture message keeps its own copies of its pictures, as the MMS
        // store does (/media/internal/.mms, which Files and Photos leave out):
        // the message stays whole when the original goes. parts:
        // [{path, mimeType, name?}] -> the same with the copies' paths.
        var MMS_DIR = "/media/internal/.mms";
        var partSeq = 0;
        function keepParts(parts) {
            // The folder first (an error when it is there already is fine).
            return callP("luna://org.webosphoenix.filemanager/mkdir", { path: MMS_DIR }).then(function () {
                return copyParts(parts);
            });
        }
        function copyParts(parts) {
            return Promise.all((parts || []).map(function (part) {
                var name = String(part.name || part.path || "part").replace(/^.*\//, "");
                var dest = MMS_DIR + "/" + Date.now().toString(36) + "-" + (++partSeq) + "-" + name;
                return callP("luna://org.webosphoenix.filemanager/copy", { from: part.path, to: dest }).then(function (r) {
                    var out = { mimeType: part.mimeType || "", name: name, path: r.returnValue === false ? part.path : dest };
                    if (r.returnValue === false) console.warn("[phoenix-runtime] MMS: kept the picture where it is: " + r.errorText);
                    return out;
                });
            }));
        }

        // The IM transports deliver outgoing instant messages
        // (org.webosphoenix.service.xmpp, block "Instant messaging" below).
        var imTransports = {};
        runtime.registerImTransport = function (service, send) { imTransports[service] = send; };

        register(["org.webosports.service.messaging"], {
            "/putMessage": function (p, reply) {
                var msg = p.message;
                if (!msg || !msg._kind || (!msg.to && !msg.from))
                    return reply(fail(-1, "Requiring valid message argument with _kind member already set."));
                msg = JSON.parse(toJson(msg));
                var mms = msg._kind === MMS_KIND;
                (mms && msg.parts && msg.parts.length ? keepParts(msg.parts) : Promise.resolve(msg.parts)).then(function (parts) {
                    if (parts) msg.parts = parts;
                    var r = assign(msg);
                    reply(ok({ threadids: [r.threadId] }));
                    var outgoing = msg.folder === "outbox" && msg.status === "pending";
                    if (outgoing && (msg._kind === "com.palm.smsmessage:1" || mms))
                        setTimeout(sendOutbox, 250);
                    else if (outgoing && isIm(msg.serviceName) && imTransports[msg.serviceName])
                        setTimeout(function () { imTransports[msg.serviceName](r.messageId); }, 150);
                });
            }
        });
        runtime.messaging = { assign: assign, isIm: isIm, personName: personName, tempdbCall: tempdbCall, dbCall: dbCall,
                              IM_BUDDY_KIND: IM_BUDDY_KIND, IM_LOGIN_KIND: IM_LOGIN_KIND };

        // A picture message arrives (phoenix-sim Shift+F5): its pictures in
        // the MMS store, then as a text: a thread, unread, a notification.
        runtime.simulateIncomingMms = function (opts) {
            opts = opts || {};
            var from = opts.from || "(408) 555-0142";
            var text = opts.text === undefined ? "Look where we are!" : opts.text;
            var image = opts.image || "/media/internal/samples/photos/harbor-dusk.jpg";
            return keepParts([{ path: image, mimeType: opts.mimeType || "image/jpeg" }]).then(function (parts) {
                var now = Date.now();
                var r = assign({
                    _kind: MMS_KIND, folder: "inbox", status: "successful", serviceName: "mms",
                    messageText: text, parts: parts, localTimestamp: now, timestamp: now, simId: 0,
                    from: { addr: from }, flags: { read: false, visible: true }
                });
                var person = personFor(from);
                host.postToHost("notification", textNotification({ appId: MESSAGING_APP, title: person ? personName(person) : from,
                                                  body: text ? "Picture: " + text : "Picture message",
                                                  params: { threadId: r.threadId } }, person));
                return r.threadId;
            });
        };

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
            host.postToHost("notification", textNotification({ appId: MESSAGING_APP, title: person ? personName(person) : from, body: text,
                                              params: { threadId: r.threadId } }, person));
            return r.threadId;
        };

        // ---- Demo data (simulator only; fictional people, 555 numbers) ---------------

        // Version 2: the conversations have fixed ids. Version 1 filed them
        // with new ids, and on a new profile each page that started at once
        // seeded them again (six copies of each); those copies go.
        var SEED_VERSION = 2;
        var DEMO_TEXTS = ["Did you see the Pre 3 is back?", "Running Phoenix on it right now", "Cards! I missed cards.",
                          "Landing at 6. Dinner?", "Yes! The usual place", "Can you send me the build notes?",
                          "Sure, give me a minute", "Thanks, got them. The new dial pad looks great"];
        // Version 1's demo threads: every message in them one of its texts
        // (one the user wrote keeps the thread). Not the fixed-id ones.
        function dropVersion1DemoThreads() {
            var threads = dbCall("/find", { query: { from: "com.palm.chatthread:1" } }).results || [];
            threads.forEach(function (t) {
                if (String(t._id).indexOf("phoenix-demo-") === 0) return;
                var msgs = (dbCall("/find", { query: { from: "com.palm.smsmessage:1" } }).results || []).filter(function (m) {
                    return (m.conversations || []).indexOf(t._id) >= 0;
                });
                if (!msgs.length || msgs.some(function (m) { return DEMO_TEXTS.indexOf(m.messageText) < 0; })) return;
                dbCall("/del", { ids: msgs.map(function (m) { return m._id; }).concat([t._id]) });
            });
        }
        runtime.seedPhoneDemoData = function (force) {
            var seeded = store.get("telephony:seeded", 0);
            if (!force && seeded === SEED_VERSION) return false;
            if (seeded === 1) dropVersion1DemoThreads();
            // The people come from the sample contacts; a forced reseed restores them too.
            if (force && runtime.loadSampleData) runtime.loadSampleData(true);
            [["com.palm.person:1", []], ["com.palm.message:1", []], ["com.palm.smsmessage:1", ["com.palm.message:1"]],
             ["com.palm.chatthread:1", []], ["com.palm.phonecall:1", []]].forEach(function (k) {
                dbCall("/putKind", { id: k[0], owner: "org.webosphoenix.simulator", extends: k[1] });
            });
            store.set("messaging:kinds", 0);
            messagingKinds();
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
                // Fixed ids, as the calls above have: every page loads this
                // runtime, and on a new profile several start at once, each
                // finding the store not yet seeded (localStorage is shared
                // but the pages run in their own processes). Seeding again
                // then writes the same thread and messages, not more.
                var threadId = "phoenix-demo-thread-" + (conv[0] + 1);
                var msgs = conv[1].map(function (m, i) {
                    var t = now - m[0] * min;
                    var last = i === conv[1].length - 1;
                    var o = m[1] ? { _kind: "com.palm.smsmessage:1", folder: "inbox", status: "successful", serviceName: "sms",
                                     messageText: m[2], localTimestamp: t, timestamp: t, from: { addr: number },
                                     flags: { read: !(last && conv[0] === 1), visible: true } }
                                 : { _kind: "com.palm.smsmessage:1", folder: "outbox", status: "successful", serviceName: "sms",
                                     messageText: m[2], localTimestamp: t, timestamp: t, to: [{ addr: number, name: personName(p) }],
                                     flags: { read: true, visible: true } };
                    o._id = threadId + "-msg-" + (i + 1);
                    o.conversations = [threadId];
                    return o;
                });
                var last = msgs[msgs.length - 1];
                // The thread as assign() files one (its fields), whole.
                dbCall("/put", { objects: [{
                    _id: threadId, _kind: "com.palm.chatthread:1", displayName: personName(p), personId: p._id,
                    normalizedAddress: digits(number), replyAddress: number, replyService: "sms",
                    summary: summaryOf(last), timestamp: last.localTimestamp, flags: { visible: true },
                    unreadCount: msgs.filter(function (o) { return o.folder === "inbox" && !o.flags.read; }).length
                }] });
                dbCall("/put", { objects: msgs });
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
    // Instant messaging (simulated XMPP: org.webosphoenix.service.xmpp)
    // ================================================================================
    //
    // An IM transport as webOS's Synergy ones were (libpurple's AIM and
    // Google Talk), shaped like the XMPP transport Phoenix plans
    // (docs/SYNERGY-MODERN.md: template com.webosphoenix.xmpp, MESSAGING
    // with capabilitySubtype "IM", serviceName "type_jabber"), against a
    // simulated server, chat.example, whose people are fictional and linked
    // to the sample contacts.
    //
    //   The account: Accounts > Add Account > Jabber (XMPP), with any
    //   address on chat.example (you@chat.example) and a password; the
    //   template (runtime/accounts/com.webosphoenix.xmpp/) goes through the
    //   accounts block of "CardDAV and CalDAV", which calls this service's
    //   checkCredentials, onCreate, onEnabled and onDelete as Synergy did.
    //   Signed in, the account's state is a com.palm.imloginstate:1 (db8:
    //   accountId, username, serviceName, state "online" | "offline",
    //   availability 0 available, 2 busy, 4 offline, customMessage) and its
    //   roster com.palm.imbuddystatus:1 objects (tempdb: accountId, username
    //   (the buddy's address), serviceName, displayName, personId,
    //   availability, personAvailability, status, group), which Messaging's
    //   Buddies and Contacts' presence read, as on webOS.
    //   Messages are com.palm.immessage.xmpp:1 (extends com.palm.immessage:1,
    //   extends com.palm.message:1: folder, status, serviceName, username =
    //   the account's address, from / to, messageText), put through
    //   putMessage like texts and threaded per buddy; the outbox goes out
    //   here (successful, or failed while signed out or in airplane mode).
    //   A buddy who is available or busy answers after a moment (the
    //   simulated server); an offline one does not.
    //
    //   setPresence {accountId, availability, customMessage?} (Phoenix): your
    //   own status; 4 signs out (the roster goes offline), else signs in.
    //
    // Simulator helpers (phoenix-sim Ctrl+F5, the tests):
    //   __phoenixRuntime.simulateIncomingIm({from?, text?}) -> thread id
    //   __phoenixRuntime.xmpp.setBuddyPresence(jid, availability, status?)
    (function instantMessaging() {
        var M = runtime.messaging;
        if (!M) return;
        var SERVICE = "org.webosphoenix.service.xmpp";
        var TEMPLATE = "com.webosphoenix.xmpp";
        var IM_SERVICE = "type_jabber";
        var MSG_KIND = "com.palm.immessage.xmpp:1";
        var SERVER = "chat.example";
        var MESSAGING_APP = runtime.messagingAppId;
        var AVAILABLE = 0, BUSY = 2, OFFLINE = 4;

        // The simulated server's people, and how they answer.
        var ROSTER = [
            { jid: "ada.palmer@" + SERVER, given: "Ada", family: "Palmer", availability: AVAILABLE, status: "Flashing a Pre 3",
              replies: ["Ha, yes!", "Cards forever.", "Send me a picture when it boots?", "On my way."] },
            { jid: "marcus.reyes@" + SERVER, given: "Marcus", family: "Reyes", availability: BUSY, status: "In a meeting until 3",
              replies: ["In a meeting, will reply after.", "Can't talk now, later?"] },
            { jid: "lena.okafor@" + SERVER, given: "Lena", family: "Okafor", availability: AVAILABLE, status: "",
              replies: ["Hi! Just landed.", "Sounds good.", "See you there."] },
            { jid: "theo.lindqvist@" + SERVER, given: "Theo", family: "Lindqvist", availability: OFFLINE, status: "", replies: [] }
        ];
        function rosterEntry(jid) {
            return ROSTER.filter(function (b) { return b.jid === String(jid).toLowerCase(); })[0] || null;
        }

        function db(method, params) { return M.dbCall(method, params); }
        function tdb(method, params) { return M.tempdbCall(method, params); }
        function account(id) { return (db("/get", { ids: [id] }).results || [])[0] || null; }
        function loginState(accountId) {
            return (db("/find", { query: { from: M.IM_LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: accountId }] } }).results || [])[0] || null;
        }
        function signedInAccounts() {
            return (db("/find", { query: { from: M.IM_LOGIN_KIND } }).results || []).filter(function (s) {
                return s.serviceName === IM_SERVICE && s.state === "online";
            });
        }
        function personByName(given, family) {
            return (db("/find", { query: { from: "com.palm.person:1" } }).results || []).filter(function (p) {
                return p.name && p.name.givenName === given && p.name.familyName === family;
            })[0] || null;
        }

        // Presence (the buddies' and your own) as stored for the apps.
        // The server's view of the buddies' presence, per account
        // ("xmpp:presence:<account>": jid -> {availability, status}); a buddy
        // not in it has the roster's.
        function buddyPresence(accountId, b) {
            return store.get("xmpp:presence:" + accountId, {})[b.jid] || { availability: b.availability, status: b.status };
        }
        function writeRoster(accountId, signedIn) {
            tdb("/del", { purge: true, query: { from: M.IM_BUDDY_KIND, where: [{ prop: "accountId", op: "=", val: accountId }] } });
            if (!signedIn) return;
            tdb("/put", { objects: ROSTER.map(function (b) {
                var person = personByName(b.given, b.family), pr = buddyPresence(accountId, b);
                var o = { _kind: M.IM_BUDDY_KIND, accountId: accountId, serviceName: IM_SERVICE, username: b.jid,
                          displayName: b.given + " " + b.family, availability: pr.availability, personAvailability: pr.availability,
                          status: pr.status || "", group: "Buddies" };
                if (person) o.personId = person._id;
                return o;
            }) });
        }
        function setLogin(acc, availability, customMessage) {
            var cur = loginState(acc._id);
            var online = availability !== OFFLINE;
            var o = { _kind: M.IM_LOGIN_KIND, accountId: acc._id, serviceName: IM_SERVICE, username: acc.username,
                      state: online ? "online" : "offline", availability: availability,
                      customMessage: customMessage !== undefined ? customMessage : cur && cur.customMessage || "" };
            if (cur) { o._id = cur._id; db("/merge", { objects: [o] }); }
            else db("/put", { objects: [o] });
            writeRoster(acc._id, online);
        }

        // ---- Messages ----------------------------------------------------------------------

        function deliver(acc, jid, text) {
            var b = rosterEntry(jid);
            var now = Date.now();
            var r = M.assign({ _kind: MSG_KIND, folder: "inbox", status: "successful", serviceName: IM_SERVICE,
                               username: acc.username, messageText: text, localTimestamp: now, timestamp: now,
                               from: { addr: jid, name: b ? b.given + " " + b.family : jid }, flags: { read: false, visible: true } });
            host.postToHost("notification", { appId: MESSAGING_APP, title: b ? b.given + " " + b.family : jid, body: text,
                                              params: { threadId: r.threadId }, soundClass: "notifications" });
            return r.threadId;
        }
        var replySeq = {};
        function send(messageId) {
            var m = (db("/get", { ids: [messageId] }).results || [])[0];
            if (!m || m.status !== "pending") return;
            var login = (db("/find", { query: { from: M.IM_LOGIN_KIND, where: [{ prop: "username", op: "=", val: m.username }] } }).results || [])[0];
            var st = store.get("settings:state", null);
            var ok_ = login && login.state === "online" && !(st && st.offlineMode);
            db("/merge", { objects: [{ _id: m._id, status: "sending" }] });
            setTimeout(function () {
                db("/merge", { objects: [{ _id: m._id, status: ok_ ? "successful" : "failed" }] });
                if (!ok_) return;
                var jid = m.to && m.to[0] && m.to[0].addr, b = rosterEntry(jid);
                var acc = account(login.accountId);
                if (!b || !acc || !b.replies.length) return;
                var pr = buddyPresence(acc._id, b);
                if (pr.availability === OFFLINE) return;
                var n = replySeq[b.jid] = (replySeq[b.jid] || 0) + 1;
                setTimeout(function () {
                    var still = loginState(acc._id);
                    if (still && still.state === "online") deliver(acc, b.jid, b.replies[(n - 1) % b.replies.length]);
                }, 1800);
            }, 400);
        }
        runtime.registerImTransport(IM_SERVICE, send);

        // ---- The transport's service (Synergy callbacks) -------------------------------------

        register([SERVICE], {
            // Any address on the simulated server with a password signs in.
            "/checkCredentials": function (p, reply) {
                var user = String(p.username || "").trim().toLowerCase();
                if (!/^[^@\s]+@[^@\s]+$/.test(user))
                    return reply({ returnValue: false, errorCode: "401_UNAUTHORIZED", errorText: "Enter your address, like you@" + SERVER });
                if (user.split("@")[1] !== SERVER)
                    return reply({ returnValue: false, errorCode: "HOST_NOT_FOUND", errorText: "Only the simulated server, " + SERVER + ", is reachable here" });
                if (!p.password)
                    return reply({ returnValue: false, errorCode: "401_UNAUTHORIZED", errorText: "Enter your password" });
                reply(ok({ credentials: { common: { password: String(p.password) } }, config: { server: SERVER } }));
            },
            "/onCreate": function (p, reply) { reply(ok()); },
            "/onEnabled": function (p, reply) {
                var acc = account(p.accountId);
                if (!acc) return reply(fail(-1, "No such account: " + p.accountId));
                setLogin(acc, p.enabled ? AVAILABLE : OFFLINE);
                reply(ok());
            },
            // The account goes: its state, roster, messages and conversations.
            "/onDelete": function (p, reply) {
                var acc = account(p.accountId) || { _id: p.accountId, username: "" };
                writeRoster(acc._id, false);
                db("/del", { query: { from: M.IM_LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: acc._id }] } });
                var threads = (db("/find", { query: { from: "com.palm.chatthread:1" } }).results || []).filter(function (t) {
                    return t.replyService === IM_SERVICE && (!acc.username || t.username === acc.username);
                });
                threads.forEach(function (t) {
                    db("/del", { query: { from: "com.palm.message:1", where: [{ prop: "conversations", op: "=", val: t._id }] } });
                    db("/del", { ids: [t._id] });
                });
                reply(ok());
            },
            "/setPresence": function (p, reply) {
                var acc = account(p.accountId);
                if (!acc) return reply(fail(-1, "No such account: " + p.accountId));
                var a = Number(p.availability);
                if ([AVAILABLE, BUSY, OFFLINE].indexOf(a) < 0) return reply(fail(-1, "availability: 0, 2 or 4"));
                setLogin(acc, a, p.customMessage);
                reply(ok());
            }
        });

        // ---- Helpers for the simulator and the tests ----------------------------------------

        runtime.simulateIncomingIm = function (opts) {
            opts = opts || {};
            var login = signedInAccounts()[0];
            if (!login) return null;
            var acc = account(login.accountId);
            return acc ? deliver(acc, opts.from || ROSTER[0].jid, opts.text || "Are you on Phoenix yet?") : null;
        };
        runtime.xmpp = {
            server: SERVER,
            roster: function () { return ROSTER.map(function (b) { return { jid: b.jid, name: b.given + " " + b.family }; }); },
            setBuddyPresence: function (jid, availability, status) {
                var b = rosterEntry(jid);
                if (!b) return false;
                signedInAccounts().forEach(function (login) {
                    var mine = store.get("xmpp:presence:" + login.accountId, {});
                    mine[b.jid] = { availability: availability, status: status || "" };
                    store.set("xmpp:presence:" + login.accountId, mine);
                    writeRoster(login.accountId, true);
                });
                return true;
            }
        };
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
                    // A transaction can abort without a request failing (out
                    // of quota when it commits, the connection closing): it
                    // fires neither complete nor error, and the caller would
                    // wait for ever.
                    t.onabort = function () { reject(t.error || new Error("The media store transaction was aborted")); };
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
            // A path with no stored file is not remembered: it may be one
            // another page is still writing (a screen capture being saved).
            url: function (path) {
                if (urlCache[path]) return Promise.resolve(urlCache[path]);
                return files.read(path).then(function (blob) {
                    if (!blob || !global.URL || !URL.createObjectURL) return path;
                    return (urlCache[path] = URL.createObjectURL(blob));
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

        // webOS 3's indexer also kept albums (com.palm.media.image.album:1,
        // a folder of pictures or videos: {name, path, total: {images,
        // videos}, appGridThumbnails, modifiedTime, sortKey, searchKey}) and
        // gave each picture and video its album's albumId, the thumbnail it
        // had cached (appGridThumbnail {path}, appCacheComplete) and its
        // mediaType; audio files said whether they were ringtones
        // (isRingtone). luna-systemui's file picker lists them by those
        // (ImageAlbumList.js:104-113, AlbumGridView.js:124, VideoAlbumList.js:100,
        // AudioPicker.js:119). The thumbnail here is the picture itself.
        var ALBUM_KIND = "com.palm.media.image.album:1";
        var RINGTONE_DIRS = [MEDIA_ROOT + "/ringtones/", "/usr/palm/sounds/"];
        // Album names as webOS 3's indexer gave them to its own folders
        // (ImageAlbumList.js:62-71 translates these); others: the folder's name.
        function albumName(dir) {
            if (dir === MEDIA_ROOT + "/DCIM/100PHNX" || /^\/media\/internal\/DCIM(\/|$)/.test(dir)) return "Photo roll";
            if (dir === MEDIA_ROOT + "/screencaptures") return "Screen captures";
            if (dir === MEDIA_ROOT + "/samples/photos") return "Sample Photos";
            if (dir === MEDIA_ROOT + "/samples/videos") return "Sample Videos";
            if (dir === MEDIA_ROOT + "/Downloads") return "Downloads";
            if (dir === MEDIA_ROOT + "/wallpapers") return "Wallpapers";
            return dir.replace(/^.*\//, "") || "Photos";
        }
        function searchKeyOf(s) { return String(s || "").toLowerCase(); }

        function legacyObject(item) {
            var t = Date.parse(item.last_modified_date) || Date.now();
            var o = { _id: "phoenix-media:" + item.file_path, _kind: LEGACY_KINDS[item.type], path: item.file_path,
                      size: item.file_size, mimeType: item.mime, createdTime: t, modifiedTime: t, title: item.title,
                      mediaType: item.type, searchKey: searchKeyOf(item.title) };
            if (item.type === "image" || item.type === "video") {
                o.width = item.width || 0;
                o.height = item.height || 0;
                o.albumPath = item.file_path.replace(/\/[^\/]*$/, "");
                o.albumId = "phoenix-album:" + o.albumPath;
                o.appCacheComplete = true;
                o.capturedOnDevice = /^\/media\/internal\/DCIM\//.test(item.file_path);
                if (item.type === "image") o.appGridThumbnail = { path: item.file_path };
                if (item.type === "video") o.duration = item.duration || 0;
            }
            if (item.type === "audio") {
                o.artist = item.artist || "";
                o.album = item.album || "";
                o.genre = item.genre || "";
                o.duration = item.duration || 0;
                o.track = { position: item.track || 0, total: item.total_tracks || 0 };
                o.thumbnails = item.thumbnail ? [{ data: item.thumbnail, type: "embedded" }] : [];
                o.isRingtone = RINGTONE_DIRS.some(function (d) { return item.file_path.indexOf(d) === 0; });
            }
            return o;
        }

        function albumObjects(idx) {
            var albums = {};
            ["image", "video"].forEach(function (type) {
                (idx[type] || []).forEach(function (item) {
                    var dir = item.file_path.replace(/\/[^\/]*$/, "");
                    var a = albums[dir] || (albums[dir] = { _id: "phoenix-album:" + dir, _kind: ALBUM_KIND, path: dir,
                                                            name: albumName(dir), total: { images: 0, videos: 0 },
                                                            appGridThumbnails: [], modifiedTime: 0 });
                    a.total[type === "image" ? "images" : "videos"]++;
                    var t = Math.floor((Date.parse(item.last_modified_date) || 0) / 1000);
                    if (t > a.modifiedTime) a.modifiedTime = t;
                    if (type === "image" && a.appGridThumbnails.length < 3) a.appGridThumbnails.push({ path: item.file_path });
                });
            });
            return Object.keys(albums).map(function (dir) {
                var a = albums[dir];
                // The camera's album first, as the indexer sorted it.
                a.sortKey = (a.name === "Photo roll" ? "0" : "1") + a.name.toLowerCase();
                a.searchKey = searchKeyOf(a.name);
                return a;
            });
        }

        // The ringtones (the system's and the user's), which are not all
        // in the media index (the system's are not on the USB drive).
        function ringtoneObjects(idx) {
            var have = {};
            (idx.audio || []).forEach(function (it) { have[it.file_path] = true; });
            var r = callNow("luna://com.webos.service.systemservice/ringtone/listRingtones", {});
            return ((r && r.ringtones) || []).filter(function (t) { return !have[t.fullPath]; }).map(function (t) {
                return { _id: "phoenix-media:" + t.fullPath, _kind: LEGACY_KINDS.audio, path: t.fullPath, title: t.name,
                         mimeType: MIME[extOf(t.fullPath)] || "", size: 0, isRingtone: true, mediaType: "audio",
                         searchKey: searchKeyOf(t.name), artist: "", album: "", genre: "", duration: 0, thumbnails: [] };
            });
        }

        var LEGACY_VERSION = 2;   // what the mirror holds (2: albums, ringtones)
        function mirrorLegacy(idx) {
            var db = runtime.services["com.palm.db"];
            if (!db) return;
            var noop = function () {};
            var ctx = { cancelled: function () { return true; } };
            Object.keys(LEGACY_KINDS).forEach(function (type) {
                db["/del"]({ query: { from: LEGACY_KINDS[type] }, purge: true }, noop, ctx);
                var objs = (idx[type] || []).map(legacyObject);
                if (type === "audio") objs = objs.concat(ringtoneObjects(idx));
                if (objs.length) db["/put"]({ objects: objs }, noop, ctx);
            });
            db["/del"]({ query: { from: ALBUM_KIND }, purge: true }, noop, ctx);
            var albums = albumObjects(idx);
            if (albums.length) db["/put"]({ objects: albums }, noop, ctx);
            store.set("media:legacyMirror", LEGACY_VERSION);
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
                // Not hidden folders' files (a message's pictures, /.mms).
                var fresh = paths.filter(function (p) { return !known[p] && typeOf(p) && !/\/\./.test(p); });
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

        // A picture made small, as a data: URL (the simulator's only: the
        // shell cannot read IndexedDB, as wallpaperUrl above; on a device it
        // loads "file://" + path). The Assistant's view shows the photos it
        // found with it.
        //   phoenix/thumbnail {path, size?: px (default 160)} -> {url}
        function thumbnail(p, reply) {
            if (!isMediaPath(p.path)) return reply(fail(-1, "path: a file under " + MEDIA_ROOT));
            var size = Math.max(16, Math.min(512, Number(p.size) || 160));
            files.read(p.path).then(function (blob) { return blob || readUrl(p.path); }).then(function (blob) {
                if (!blob) return reply(fail(-1, "No such file: " + p.path));
                var u = URL.createObjectURL(blob), img = new Image();
                img.onload = function () {
                    var k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
                    var c = document.createElement("canvas");
                    c.width = Math.max(1, Math.round(img.naturalWidth * k));
                    c.height = Math.max(1, Math.round(img.naturalHeight * k));
                    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                    URL.revokeObjectURL(u);
                    reply(ok({ url: c.toDataURL("image/jpeg", 0.85) }));
                };
                img.onerror = function () { URL.revokeObjectURL(u); reply(fail(-1, "Not a picture: " + p.path)); };
                img.src = u;
            }, function (e) { reply(fail(-1, String(e && e.message || e))); });
        }

        register(["com.webos.service.mediaindexer"], {
            "/phoenix/thumbnail": thumbnail,
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

        // ---- com.palm.image and com.palm.filecache (legacy) ---------------------------------
        //
        // The Contacts framework turns the picture the file picker cropped
        // into a contact's photo with them (loadable-frameworks contacts
        // ContactPhoto.js:208-266, 270-346, Contact.js:518-591):
        //   com.palm.image/convert {src, dest, destType, focusX, focusY,
        //       scale, cropW, cropH}: the picture scaled by `scale`, then a
        //       cropW x cropH window around the focus point (focusX, focusY:
        //       0-1 of its width and height), kept inside the picture;
        //       without a crop, the whole picture scaled.
        //   com.palm.image/ezResize {src, dest, destType, destSizeW,
        //       destSizeH}: the picture made to fit that size, its shape kept.
        //   com.palm.image/imageInfo {src} -> {width, height, type}
        // Written to the media store at dest, which pages show by its path
        // (storedPictures below). A cache object (com.palm.filecache
        // InsertCacheObject {typeName, fileName, size, subscribe} ->
        // {pathName}) is a path under /var/file-cache/<typeName>/ for the
        // caller to write; ExpireCacheObject {pathName} deletes it.
        function sourceBlob(path) {
            return files.read(path).then(function (blob) {
                if (blob) return blob;
                var fm = runtime.fileManager;
                return (fm ? fm.url(path) : Promise.resolve(path)).then(readUrl);
            });
        }
        function loadPicture(path) {
            return sourceBlob(path).then(function (blob) {
                if (!blob) throw new Error("No such file: " + path);
                return new Promise(function (resolve, reject) {
                    var u = URL.createObjectURL(blob), img = new Image();
                    img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
                    img.onerror = function () { URL.revokeObjectURL(u); reject(new Error("Not a picture: " + path)); };
                    img.src = u;
                });
            });
        }
        function pictureType(p, dest) {
            var t = String(p.destType || extOf(dest) || "jpg").toLowerCase();
            return t === "png" ? "image/png" : t === "webp" ? "image/webp" : "image/jpeg";
        }
        // Into the Files block's store when it fits (a contact's photo:
        // palmGetResource reads it there), else the media store.
        function writePicture(canvas, p) {
            var type = pictureType(p, p.dest);
            var fm = runtime.fileManager;
            if (fm && fm.store && fm.store(p.dest, canvas.toDataURL(type, 0.9).replace(/^data:[^,]*,/, "")))
                return Promise.resolve();
            return new Promise(function (resolve) { canvas.toBlob(resolve, type, 0.9); }).then(function (blob) {
                if (!blob) throw new Error("Could not encode " + p.dest);
                return files.write(p.dest, blob);
            });
        }
        function imageMethod(draw) {
            return function (p, reply) {
                if (!p.src || !p.dest) return reply(fail(-1, "src and dest are required"));
                if (!global.document) return reply(fail(-1, "No canvas here"));
                loadPicture(p.src).then(function (img) {
                    var c = global.document.createElement("canvas");
                    draw(img, img.naturalWidth, img.naturalHeight, c, p);
                    return writePicture(c, p);
                }).then(function () { reply(ok({})); },
                        function (e) { reply(fail(-1, String(e && e.message || e))); });
            };
        }
        register(["com.palm.image", "com.palm.image2"], {
            "/convert": imageMethod(function (img, w, h, c, p) {
                var k = Number(p.scale) > 0 ? Number(p.scale) : 1;
                var cw = Math.round(Number(p.cropW) || w * k), ch = Math.round(Number(p.cropH) || h * k);
                // The crop is always the size asked: a picture scaled smaller
                // than it (a crop view wider than the picture) is scaled up
                // to fill it.
                k = Math.max(k, cw / w, ch / h);
                var sw = w * k, sh = h * k;
                var fx = p.focusX === undefined ? 0.5 : Number(p.focusX), fy = p.focusY === undefined ? 0.5 : Number(p.focusY);
                var left = Math.max(0, Math.min(sw - cw, fx * sw - cw / 2));
                var top = Math.max(0, Math.min(sh - ch, fy * sh - ch / 2));
                c.width = Math.max(1, cw);
                c.height = Math.max(1, ch);
                c.getContext("2d").drawImage(img, left / k, top / k, cw / k, ch / k, 0, 0, c.width, c.height);
            }),
            "/ezResize": imageMethod(function (img, w, h, c, p) {
                var k = Math.min((Number(p.destSizeW) || w) / w, (Number(p.destSizeH) || h) / h);
                c.width = Math.max(1, Math.round(w * k));
                c.height = Math.max(1, Math.round(h * k));
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            }),
            "/imageInfo": function (p, reply) {
                loadPicture(p.src || "").then(function (img) {
                    reply(ok({ width: img.naturalWidth, height: img.naturalHeight, type: (MIME[extOf(p.src)] || "").replace(/^image\//, "") }));
                }, function (e) { reply(fail(-1, String(e && e.message || e))); });
            }
        });

        var cacheSeq = 0;
        register(["com.palm.filecache"], {
            "/InsertCacheObject": function (p, reply) {
                if (!p.typeName) return reply(fail(-1, "typeName is required"));
                var name = String(p.fileName || "object").replace(/[\/\\]/g, "_");
                var path = "/var/file-cache/" + p.typeName + "/" + Date.now().toString(36) + (++cacheSeq) + "/" + name;
                // The subscription is the caller's hold on the object
                // (it is not removed while it lasts): nothing more comes.
                reply(ok({ pathName: path, subscribed: !!p.subscribe }));
            },
            "/ExpireCacheObject": function (p, reply) {
                if (!p.pathName) return reply(fail(-1, "pathName is required"));
                files.remove(p.pathName).then(function () { reply(ok({})); }, function () { reply(ok({})); });
            },
            "/DefineType": function (p, reply) { reply(ok({})); },
            "/GetCacheStatus": function (p, reply) { reply(ok({ numTypes: 0, size: 0, numObjs: 0 })); }
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

        // The ringtones changed (systemservice addRingtone, deleteRingtone).
        runtime.refreshLegacyMedia = function () { mirrorLegacy(loadIndex()); };

        // A profile whose legacy kinds were mirrored before they had albums
        // and ringtones (or never: a legacy page may be the first to ask):
        // once the services below (the ringtones') are there.
        setTimeout(function () {
            try {
                if (store.get("media:legacyMirror", 0) < LEGACY_VERSION) mirrorLegacy(loadIndex());
            } catch (e) { console.error("[phoenix-runtime] legacy media kinds", e); }
        }, 0);

        // ---- Screen captures (Phoenix; docs/SCREENSHOTS.md SC1-SC2) -----------------------
        //
        // The shell grabs the screen and hands the picture to one page:
        // runtime.saveScreenshot({data: base64 PNG, app: the app in front's
        // title, capture: the shell's id for it}). It is saved where the original saved them,
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
                // capture: the shell's id for it, so its thumbnail opens
                // this file and no other. Tagged with its file, so deleting
                // it takes the notification back (captureRemoved below).
                var params = { path: path };
                if (p.capture) params.capture = String(p.capture);
                host.postToHost("notification", { appId: SCREENSHOT_APP, title: "Screen captured",
                                                  body: path.slice(CAPTURE_DIR.length + 1).replace(/\.png$/, ""),
                                                  params: params, tag: "capture:" + path });
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
            // Dock mode's wallpaper (the dockwallpaper preference) the same way.
            if (type === "systemStatus" && payload && isMediaPath(payload.dockWallpaperFile)) {
                var dc = store.get(DOCK_WALLPAPER_KEY, null);
                if (dc && dc.file === payload.dockWallpaperFile) payload.dockWallpaperUrl = dc.url;
            }
            return basePost.call(host, type, payload);
        };

        var DOCK_WALLPAPER_KEY = "media:dockwallpaper";
        var sysSvc = runtime.services["com.webos.service.systemservice"];
        if (sysSvc) {
            var baseSetPrefs = sysSvc["/setPreferences"];
            sysSvc["/setPreferences"] = function (p, reply, ctx) {
                var file = p.wallpaper && p.wallpaper.wallpaperFile;
                var dockFile = p.dockwallpaper && p.dockwallpaper.wallpaperFile;
                if (!isMediaPath(file) && !isMediaPath(dockFile)) return baseSetPrefs(p, reply, ctx);
                // Read the picture first so the systemStatus that setPreferences
                // sends already carries it.
                Promise.all([isMediaPath(file) ? wallpaperData(file) : null,
                             isMediaPath(dockFile) ? wallpaperData(dockFile) : null]).then(function (urls) {
                    if (urls[0]) store.set(WALLPAPER_KEY, { file: file, url: urls[0] });
                    if (urls[1]) store.set(DOCK_WALLPAPER_KEY, { file: dockFile, url: urls[1] });
                    baseSetPrefs(p, reply, ctx);
                });
            };
        }

        // A media wallpaper chosen earlier: tell the shell again, now with its picture.
        var wp = prefs().wallpaper, dwp = prefs().dockwallpaper;
        if (((wp && isMediaPath(wp.wallpaperFile)) || (dwp && isMediaPath(dwp.wallpaperFile))) && runtime.hostStatus)
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
    //   search {query, path?, limit?}        -> {entries}: names with every word of
    //                                           query under path (/media/internal), newest first
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
            addFactoryRingtones(v);
            return v;
        }

        // The ringtones a device came with on its USB drive
        // (shell/assets/sounds/phoenix/ringtones, mounted at
        // /media/internal/ringtones): Phoenix's Flurry.mp3, the Clock's
        // default alarm (com.palm.app.clock utility/alarm.js:368,
        // alarmdbmanager.js:100), whose original was never released. Added
        // once, also to a drive seeded before it shipped; deleting it sticks.
        var FACTORY_RINGTONES = ["Flurry.mp3"];
        function addFactoryRingtones(v) {
            if (v.factoryRingtones) return false;
            var sm = Date.parse("2026-09-01T08:00:00Z");
            FACTORY_RINGTONES.forEach(function (n) {
                var p = MEDIA_ROOT + "/ringtones/" + n;
                if (v.nodes[p]) return;
                for (var d = parentOf(p); !v.nodes[d]; d = parentOf(d))
                    v.nodes[d] = { t: "d", m: sm, mode: 493, ro: false };
                v.nodes[p] = { t: "f", m: sm, mode: 420, ro: false, ref: p, size: -1 };
            });
            v.factoryRingtones = true;
            return true;
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
            } else {
                var added = addSampleFiles(v, readSampleIndex());
                if (addFactoryRingtones(v)) added = true;
                if (added) save(v);
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
            "/search": function (p, reply) {
                var root = norm(p.path || MEDIA_ROOT);
                var words = String(p.query || "").toLowerCase().split(/\s+/).filter(Boolean);
                if (!root) return reply(fail(E.BAD_PARAMS, "path must be an absolute path"));
                if (!words.length) return reply(fail(E.BAD_PARAMS, "query is required"));
                var limit = Math.max(1, Math.min(200, Number(p.limit) || 50));
                syncMedia().then(function () {
                    var v = load();
                    var hits = Object.keys(v.nodes).filter(function (k) {
                        if (k === root || k.indexOf(root === "/" ? "/" : root + "/") !== 0) return false;
                        var rel = k.slice(root.length);
                        if (/\/\./.test(rel)) return false;
                        var name = k.replace(/^.*\//, "").toLowerCase();
                        return words.every(function (w) { return name.indexOf(w) >= 0; });
                    });
                    return fillSizes(hits).then(function () {
                        var v2 = load();
                        var out = hits.filter(function (k) { return v2.nodes[k]; }).map(function (k) { return entry(v2, k); })
                            .sort(function (a, b) { return b.mtime - a.mtime; }).slice(0, limit);
                        reply(ok({ entries: out }));
                    });
                }).then(null, ioError(reply));
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
        // Every resource handler, each with its index: the apps' appinfo.json
        // types, the built-in ones (HANDLERS), then those added at run time
        // (addResourceHandler: {appId, mime, extension, shouldDownload}).
        function resourceTable() {
            var out = [], i = 0;
            registeredTypes().forEach(function (r) {
                out.push({ appId: r.appId, title: r.title, mime: r.mime, extension: r.extension, stream: r.stream, index: ++i, tag: "system-default" });
            });
            HANDLERS.forEach(function (h) {
                out.push({ appId: h.appId, title: h.title, mime: h.prefix, prefix: true, extension: "", index: ++i, tag: "system-default" });
            });
            runtime.handlerRegistry().resources.forEach(function (r) {
                var a = launchPoints().filter(function (lp) { return /_default$/.test(lp.launchPointId) && lp.id === r.appId; })[0];
                if (a) out.push({ appId: r.appId, title: a.title, mime: r.mime, extension: r.extension || "", stream: !r.shouldDownload,
                                  shouldDownload: !!r.shouldDownload, index: r.index, tag: "user" });
            });
            return out;
        }
        // The handlers for a type (and extension), the active one first
        // (swapResourceHandler), one per app.
        function handlersFor(mime, ext) {
            mime = String(mime || "").toLowerCase();
            ext = String(ext || "").toLowerCase();
            var seen = {}, out = [];
            resourceTable().forEach(function (r) {
                var hit = r.prefix ? mime.indexOf(r.mime) === 0 : (typeMatches(r.mime, mime) || (ext && r.extension === ext));
                if (!hit || seen[r.appId]) return;
                seen[r.appId] = true;
                out.push({ appId: r.appId, title: r.title, mime: mime, index: r.index, tag: r.tag, stream: !!r.stream });
            });
            var active = runtime.handlerRegistry().activeResource[mime];
            var a = out.filter(function (h) { return h.index === active; })[0];
            if (a) out = [a].concat(out.filter(function (h) { return h !== a; }));
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
            // ---- The resource handler registry (MimeSystem) --------------------------
            // listAllHandlersForMime also answers as LunaSysMgr did:
            // resourceHandlers {activeHandler, alternates}.
            function asResource(h, mime) {
                var a = launchPoints().filter(function (lp) { return /_default$/.test(lp.launchPointId) && lp.id === h.appId; })[0];
                return { mime: mime, extension: "", appId: h.appId, streamable: !!h.stream, index: h.index, tag: h.tag || "system-default",
                         appName: a ? a.title : h.title || h.appId };
            }
            am["/listAllHandlersForMime"] = function (p, reply) {
                var mime = String(p.mime || p.mimeType || "").toLowerCase();
                var list = handlersFor(mime);
                var r = ok({ subscribed: false, mime: p.mime, resources: list });
                if (list.length) {
                    r.resourceHandlers = { activeHandler: asResource(list[0], mime) };
                    if (list.length > 1) r.resourceHandlers.alternates = list.slice(1).map(function (h) { return asResource(h, mime); });
                }
                reply(r);
            };
            // mimeTypeForExtension {extension} -> {mimeType, extension}.
            am["/mimeTypeForExtension"] = function (p, reply) {
                var ext = String(p.extension || "").replace(/^\./, "").toLowerCase();
                var mime = MIME[ext] || (resourceTable().filter(function (r) { return r.extension === ext && r.mime; })[0] || {}).mime;
                reply(mime ? { subscribed: false, returnValue: true, mimeType: mime, extension: ext }
                           : { subscribed: false, returnValue: false, errorCode: "No mime mapped to this extension" });
            };
            // getHandlerForExtension {extension} -> {mimeType, appId, download}.
            am["/getHandlerForExtension"] = function (p, reply) {
                var ext = String(p.extension || "").replace(/^\./, "").toLowerCase();
                var mime = MIME[ext] || (resourceTable().filter(function (r) { return r.extension === ext && r.mime; })[0] || {}).mime;
                if (!mime) return reply({ subscribed: false, returnValue: false, errorCode: "No mime type mapped to extension " + ext });
                var h = handlersFor(mime, ext)[0];
                reply(h ? { subscribed: false, returnValue: true, mimeType: mime, appId: h.appId, download: !h.stream }
                        : { subscribed: false, returnValue: false, errorCode: "No handler found for extension " + ext });
            };
            // getHandlerForUrl {url}: a scheme or web address to its
            // redirect handler, else a file to the app for its type.
            am["/getHandlerForUrl"] = function (p, reply) {
                var url = String(p.url || "");
                var path = url.replace(/^file:\/\//, "").replace(/[?#].*$/, "");
                var ext = extOf(path);
                var typed = ext && (!/^https?:/i.test(url) || registeredTypes().some(function (r) { return r.extension === ext; }));
                if (typed) {
                    var mime = MIME[ext] || "application/octet-stream", h = handlersFor(mime, ext)[0];
                    if (h) return reply({ subscribed: false, returnValue: true, mimeType: mime, appId: h.appId, download: !/^https?:/i.test(url) || !h.stream });
                }
                var app = runtime.redirectHandlerFor(url);
                reply(app ? { subscribed: false, returnValue: true, appId: app, download: false }
                          : { subscribed: false, returnValue: false, errorCode: "No handler found for url [" + url + "]" });
            };
            // addResourceHandler {appId, shouldDownload, mimeType | extension}.
            am["/addResourceHandler"] = function (p, reply) {
                function no(text) { reply({ subscribed: false, returnValue: false, errorCode: text }); }
                if (typeof p.appId !== "string" || !p.appId) return no("Missing appId parameter");
                var mime = String(p.mimeType || "").toLowerCase(), ext = String(p.extension || "").replace(/^\./, "").toLowerCase();
                if (!mime && !ext) return no("Neither extension or mime type provided");
                if (!mime) {
                    mime = MIME[ext] || "";
                    if (!mime) return no("Cannot find mime type for extension [" + ext + "]");
                }
                if (!launchPoints().some(function (lp) { return lp.id === p.appId; })) return no("adding handler failed");
                var reg = runtime.handlerRegistry();
                if (!reg.resources.some(function (r) { return r.appId === p.appId && r.mime === mime && (r.extension || "") === ext; })) {
                    reg.resources.push({ appId: p.appId, mime: mime, extension: ext, shouldDownload: !!p.shouldDownload, index: reg.next++ });
                    runtime.saveHandlerRegistry(reg);
                }
                reply({ subscribed: false, returnValue: true });
            };
            // swapResourceHandler {mimeType, index}: that handler is active.
            am["/swapResourceHandler"] = function (p, reply) {
                var mime = String(p.mimeType || "").toLowerCase(), index = Number(p.index);
                if (!handlersFor(mime).some(function (h) { return h.index === index; }))
                    return reply({ subscribed: false, returnValue: false, errorCode: "swap failed (incorrect index for mime type, perhaps?)" });
                var reg = runtime.handlerRegistry();
                reg.activeResource[mime] = index;
                runtime.saveHandlerRegistry(reg);
                reply({ subscribed: false, returnValue: true });
            };
            // removeHandlersForAppId {appId}: the handlers it added go.
            am["/removeHandlersForAppId"] = function (p, reply) {
                if (typeof p.appId !== "string" || !p.appId) return reply({ subscribed: false, returnValue: false, errorCode: "Missing appId parameter" });
                var reg = runtime.handlerRegistry();
                reg.resources = reg.resources.filter(function (r) { return r.appId !== p.appId; });
                reg.redirects = reg.redirects.filter(function (r) { return r.appId !== p.appId; });
                runtime.saveHandlerRegistry(reg);
                reply({ subscribed: false, returnValue: true });
            };
            // LunaSysMgr registered listResourceHandlers but never answered
            // it; Phoenix lists them.
            am["/listResourceHandlers"] = function (p, reply) {
                reply(ok({ resourceHandlers: resourceTable().map(function (r) { return asResource(r, r.mime); }) }));
            };
            am["/listExtensionMap"] = function (p, reply) {
                var map = {};
                Object.keys(MIME).forEach(function (e) { map[e] = MIME[e]; });
                resourceTable().forEach(function (r) { if (r.extension && r.mime && !map[r.extension]) map[r.extension] = r.mime; });
                reply(ok({ extensionMap: map }));
            };

            // open {target}: a file goes to the app that handles its type
            // (the browser's finished downloads, "Open by Type" in Files).
            var baseOpen = am["/open"];
            am["/open"] = function (p, reply, ctx) {
                var app = !p.id && p.target && handlerForTarget(p.target);
                if (app) {
                    host.postToHost("launch", Object.assign({ id: app, params: { target: p.target } },
                                                            typeof p.$from === "string" ? { from: p.$from } : {}));
                    return runtime.launchedReply(reply, app, { target: p.target }, { appId: app });
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
            /** Write a file (base64), making its folders, as a service of the
                system writes one (com.palm.image's pictures). False when it
                does not fit in this store. */
            store: function (path, b64) {
                var p = norm(path), v = load();
                if (!p) return false;
                var size = Math.floor(String(b64).length * 3 / 4);
                if (size > INLINE_LIMIT) return false;
                for (var d = parentOf(p), missing = []; !v.nodes[d] && d !== "/"; d = parentOf(d)) missing.unshift(d);
                missing.forEach(function (dir) { v.nodes[dir] = { t: "d", m: Date.now(), mode: 493 }; });
                var old = v.nodes[p];
                if (old && old.t === "d") return false;
                if (old && old.media && runtime.mediaFiles) runtime.mediaFiles.remove(p);
                v.nodes[p] = { t: "f", m: Date.now(), mode: old ? old.mode : 420, data: b64, enc: "base64", size: fromB64(b64).length };
                touch(v, parentOf(p));
                return save(v);
            },
            errors: E
        };
        // palmGetResource reads a file of the device: those this store holds
        // in itself are read here (the Contacts framework checks that the
        // photo it made is there, PersonPhotos.js:390-402). Their bytes as
        // a string, one character a byte, as the device's read gave them.
        // (Not while this store is being read: making it reads the demo
        // media's index with getResource.)
        var readResource = PalmSystem.getResource, reading = false;
        PalmSystem.getResource = function (path, flags) {
            var r = readResource(path, flags);
            if (r !== undefined || typeof path !== "string" || reading) return r;
            var p = norm(path.replace(/^file:\/\//, "")), n;
            reading = true;
            try { n = p && load().nodes[p]; } catch (e) { n = null; } finally { reading = false; }
            if (!n || n.t !== "f" || n.data === undefined) return r;
            var text = n.enc === "base64" ? global.atob(n.data) : n.data;
            return asResource(text, flags);
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
        // ringtone/addRingtone {filePath}: a copy in /media/internal/ringtones
        // (luna-sysservice's RingtoneManager); deleteRingtone {filePath}
        // removes one of those. luna-systemui's file picker calls both
        // (RingtonePicker.js:40-43, 64, 112: its "add ringtone" button and
        // a swipe on a ringtone).
        var noCancel = { cancelled: function () { return false; }, onCancel: null };
        function ringtonesChanged(reply) {
            if (runtime.refreshLegacyMedia) runtime.refreshLegacyMedia();
            reply(ok({}));
        }
        runtime.services["com.webos.service.systemservice"]["/ringtone/addRingtone"] = function (p, reply) {
            var from = norm(p.filePath || "");
            if (!from) return reply(fail(-1, "filePath is required"));
            var to = MEDIA_ROOT + "/ringtones/" + nameOf(from);
            if (from === to) return ringtonesChanged(reply);
            dispatch("luna://org.webosphoenix.filemanager/copy", { from: from, to: to, overwrite: true }, function (r) {
                if (r.returnValue === false) return reply(r);
                ringtonesChanged(reply);
            }, noCancel);
        };
        runtime.services["com.webos.service.systemservice"]["/ringtone/deleteRingtone"] = function (p, reply) {
            var path = norm(p.filePath || "");
            if (!path || path.indexOf(MEDIA_ROOT + "/ringtones/") !== 0)
                return reply(fail(-1, "Not one of the user's ringtones: " + p.filePath));
            dispatch("luna://org.webosphoenix.filemanager/remove", { path: path }, function (r) {
                if (r.returnValue === false) return reply(r);
                ringtonesChanged(reply);
            }, noCancel);
        };
    })();

    // ================================================================================
    // Certificate manager (com.palm.certificatemanager; Settings > Certificate Manager)
    // ================================================================================
    //
    // The legacy webOS certificate store, which com.palm.app.certificate
    // (Device Info's "Certificate Manager...") managed and others read: Enyo
    // 1.0's Wi-Fi setup lists the user's certificates for networks that ask
    // for one (lib/wifi/wifi.js: listcertificates -> userCertificateStore
    // [{certificateId, certificateFilename, commonname, organization}]), the
    // browser shows a site's certificate (isis-browser CertificateDetail.js:
    // getcertificatedetails {certificateFilename} -> subject / issuer
    // {commonname, organization, organizationalunit, country, state,
    // location, altname}, startdate, expiredate, serialNumber, version,
    // signature.algorithm, publicKey.algorithm). Phoenix adds what the
    // Settings pane needs, in the same style:
    //
    //   listcertificates {}  -> {certificates: [summary], userCertificateStore:
    //       [the imported ones]}; summary: {certificateId, certificateFilename,
    //       commonname, organization, issuer, startdate, expiredate (ms),
    //       trusted, system, isCA}
    //   getcertificatedetails {certificateId | certificateFilename} -> the
    //       details above, plus fingerprints {sha256, sha1}, publicKey.bits /
    //       curve, isCA, trusted, system
    //   addcertificate {certificateFilename}: a .pem / .crt (PEM, one or more
    //       certificates) or .cer / .der (DER) on the device, read with
    //       org.webosphoenix.filemanager -> {certificateIds}
    //   setcertificatetrust {certificateId, trusted}
    //   removecertificate {certificateId}
    //   errors: -1 bad parameters, -2 not a certificate, -3 already
    //   installed, -4 no such certificate, -5 the file cannot be read
    //
    // The system's root certificates are a few real CAs' (runtime/certs, as
    // published in the Mozilla CA list); the user may distrust or remove them
    // (and restore them: restorecertificates). What is imported, and every
    // change, is kept in the runtime's store, so it lasts. X.509 is read here
    // (DER, enough of RFC 5280 to show a certificate); signatures are not
    // checked: the store only says which certificates the device trusts.
    (function certificateManager() {
        var KEY = "certificates";
        var SYSTEM_CERTS = ["isrg-root-x1", "isrg-root-x2", "digicert-global-root-g2", "gts-root-r1",
                            "amazon-root-ca-1", "usertrust-rsa-certification-authority"];
        var SYSTEM_DIR = "/usr/share/phoenix/runtime/certs/";
        var E = { BAD_PARAMS: -1, NOT_CERT: -2, EXISTS: -3, NOT_FOUND: -4, READ: -5 };

        // ---- DER and X.509 --------------------------------------------------------------

        function b64Bytes(s) {
            var bin = global.atob(String(s).replace(/[^A-Za-z0-9+\/=]/g, ""));
            var out = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
            return out;
        }
        function bytesB64(b) {
            var s = "";
            for (var i = 0; i < b.length; ++i) s += String.fromCharCode(b[i]);
            return global.btoa(s);
        }
        // The certificates in a file: PEM blocks, else the file as DER.
        function certsIn(bytes) {
            var text = "";
            for (var i = 0; i < Math.min(bytes.length, 4 * 1024 * 1024); ++i) text += String.fromCharCode(bytes[i]);
            var re = /-----BEGIN (?:X509 |TRUSTED )?CERTIFICATE-----([\s\S]*?)-----END (?:X509 |TRUSTED )?CERTIFICATE-----/g;
            var out = [], m;
            while ((m = re.exec(text))) out.push(b64Bytes(m[1]));
            if (!out.length && bytes[0] === 0x30) out.push(bytes);
            return out;
        }
        // One TLV at pos: {tag, start (of the value), end}.
        function tlv(b, pos) {
            if (pos + 2 > b.length) throw new Error("truncated");
            var tag = b[pos], len = b[pos + 1], p = pos + 2;
            if (len & 0x80) {
                var n = len & 0x7f;
                if (n < 1 || n > 4) throw new Error("bad length");
                len = 0;
                for (var i = 0; i < n; ++i) len = len * 256 + b[p++];
            }
            if (p + len > b.length) throw new Error("truncated");
            return { tag: tag, start: p, end: p + len };
        }
        function children(b, t) {
            var out = [];
            for (var p = t.start; p < t.end;) { var c = tlv(b, p); out.push(c); p = c.end; }
            return out;
        }
        function oid(b, t) {
            var parts = [], v = 0;
            for (var i = t.start; i < t.end; ++i) {
                v = v * 128 + (b[i] & 0x7f);
                if (!(b[i] & 0x80)) {
                    if (!parts.length) parts.push(v < 80 ? Math.floor(v / 40) : 2, v < 80 ? v % 40 : v - 80);
                    else parts.push(v);
                    v = 0;
                }
            }
            return parts.join(".");
        }
        function str(b, t) {
            var s = "", i;
            if (t.tag === 0x1e) {                       // BMPString
                for (i = t.start; i + 1 < t.end; i += 2) s += String.fromCharCode(b[i] * 256 + b[i + 1]);
                return s;
            }
            for (i = t.start; i < t.end; ++i) s += String.fromCharCode(b[i]);
            if (t.tag === 0x0c) {                       // UTF8String
                try { return decodeURIComponent(global.escape(s)); } catch (e) { return s; }
            }
            return s;
        }
        function hex(b, start, end, sep) {
            var out = [];
            for (var i = start; i < end; ++i) out.push((b[i] < 16 ? "0" : "") + b[i].toString(16).toUpperCase());
            return out.join(sep || "");
        }
        function time(b, t) {
            var s = str(b, t);
            var m = t.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s);
            if (!m) return 0;
            var y = +m[1];
            if (t.tag === 0x17) y += y >= 50 ? 1900 : 2000;
            return Date.UTC(y, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
        }
        var NAME_KEYS = { "2.5.4.3": "commonname", "2.5.4.6": "country", "2.5.4.7": "location", "2.5.4.8": "state",
                          "2.5.4.10": "organization", "2.5.4.11": "organizationalunit", "1.2.840.113549.1.9.1": "email" };
        function name(b, t) {
            var out = {};
            children(b, t).forEach(function (set) {
                children(b, set).forEach(function (atv) {
                    var kv = children(b, atv), k = NAME_KEYS[oid(b, kv[0])];
                    if (k && !(k in out)) out[k] = str(b, kv[1]);
                });
            });
            return out;
        }
        var ALGS = { "1.2.840.113549.1.1.1": "RSA", "1.2.840.113549.1.1.4": "MD5 with RSA", "1.2.840.113549.1.1.5": "SHA-1 with RSA",
                     "1.2.840.113549.1.1.11": "SHA-256 with RSA", "1.2.840.113549.1.1.12": "SHA-384 with RSA",
                     "1.2.840.113549.1.1.13": "SHA-512 with RSA", "1.2.840.113549.1.1.10": "RSA-PSS",
                     "1.2.840.10045.2.1": "Elliptic curve", "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
                     "1.2.840.10045.4.3.3": "ECDSA with SHA-384", "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
                     "1.3.101.112": "Ed25519", "1.3.101.113": "Ed448" };
        var CURVES = { "1.2.840.10045.3.1.7": "P-256", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521" };
        function alg(b, t) {
            var id = oid(b, children(b, t)[0]);
            return ALGS[id] || id;
        }

        // The parts of a certificate the store and Settings show.
        function parse(der) {
            var b = der;
            var cert = tlv(b, 0);
            if (cert.tag !== 0x30 || cert.end !== b.length) throw new Error("not a certificate");
            var top = children(b, cert);
            var tbs = children(b, top[0]), i = 0, version = 1;
            if (tbs[0].tag === 0xa0) { version = b[children(b, tbs[0])[0].start] + 1; i = 1; }
            var serial = tbs[i], sigAlg = tbs[i + 1], issuer = tbs[i + 2], validity = children(b, tbs[i + 3]);
            var subject = tbs[i + 4], spki = children(b, tbs[i + 5]);
            var out = {
                version: version,
                serialNumber: hex(b, serial.start + (b[serial.start] === 0 && serial.end - serial.start > 1 ? 1 : 0), serial.end, ":"),
                signature: { algorithm: alg(b, sigAlg) },
                issuer: name(b, issuer),
                subject: name(b, subject),
                startdate: time(b, validity[0]),
                expiredate: time(b, validity[1]),
                publicKey: { algorithm: alg(b, spki[0]) },
                isCA: false
            };
            var keyAlg = children(b, spki[0]);
            if (keyAlg[1] && keyAlg[1].tag === 0x06) out.publicKey.curve = CURVES[oid(b, keyAlg[1])] || oid(b, keyAlg[1]);
            if (out.publicKey.algorithm === "RSA") {
                // BIT STRING: unused-bits byte, then RSAPublicKey {modulus, exponent}.
                var rsa = children(b, tlv(b, spki[1].start + 1))[0];
                var m0 = rsa.start;
                while (m0 < rsa.end && b[m0] === 0) m0++;
                out.publicKey.bits = (rsa.end - m0) * 8 - (b[m0] ? Math.clz32(b[m0]) - 24 : 0);
            } else if (out.publicKey.curve) {
                out.publicKey.bits = { "P-256": 256, "P-384": 384, "P-521": 521 }[out.publicKey.curve];
            }
            tbs.slice(i + 6).forEach(function (t) {
                if (t.tag !== 0xa3) return;
                children(b, children(b, t)[0]).forEach(function (ext) {
                    var parts = children(b, ext), id = oid(b, parts[0]), value = parts[parts.length - 1];
                    var inner = tlv(b, value.start);
                    if (id === "2.5.29.17") {           // subjectAltName
                        out.subject.altname = children(b, inner).filter(function (g) {
                            return g.tag === 0x81 || g.tag === 0x82 || g.tag === 0x86 || g.tag === 0x87;
                        }).map(function (g) {
                            if (g.tag !== 0x87) return str(b, g);
                            var ip = [];
                            for (var k = g.start; k < g.end; ++k) ip.push(b[k]);
                            return ip.length === 4 ? ip.join(".") : hex(b, g.start, g.end, ":");
                        });
                    } else if (id === "2.5.29.19") {    // basicConstraints
                        var bc = children(b, inner);
                        out.isCA = !!(bc[0] && bc[0].tag === 0x01 && b[bc[0].start]);
                    }
                });
            });
            return out;
        }

        // SHA-256 and SHA-1 of the DER (the fingerprints Settings shows).
        function sha(bytes, one) {
            var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
                     0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
                     0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
                     0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
                     0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
                     0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
                     0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
                     0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
            var n = bytes.length, len = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(len), i, j;
            m.set(bytes);
            m[n] = 0x80;
            var bits = n * 8;
            for (i = 0; i < 8; ++i) m[len - 1 - i] = i < 4 ? (bits >>> (8 * i)) & 0xff : Math.floor(bits / 0x100000000 / Math.pow(256, i - 4)) & 0xff;
            var h = one ? [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
                        : [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
            var w = new Array(80);
            function rotr(x, k) { return (x >>> k) | (x << (32 - k)); }
            for (var off = 0; off < len; off += 64) {
                for (i = 0; i < 16; ++i)
                    w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
                var a = h.slice();
                if (one) {
                    for (i = 16; i < 80; ++i) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
                    for (i = 0; i < 80; ++i) {
                        var f = i < 20 ? (a[1] & a[2]) | (~a[1] & a[3]) : i < 40 || i >= 60 ? a[1] ^ a[2] ^ a[3] : (a[1] & a[2]) | (a[1] & a[3]) | (a[2] & a[3]);
                        var k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
                        var t1 = (((a[0] << 5) | (a[0] >>> 27)) + f + a[4] + k + w[i]) | 0;
                        a = [t1, a[0], (a[1] << 30) | (a[1] >>> 2), a[2], a[3]];
                    }
                } else {
                    for (i = 16; i < 64; ++i) {
                        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
                    }
                    for (i = 0; i < 64; ++i) {
                        var S1 = rotr(a[4], 6) ^ rotr(a[4], 11) ^ rotr(a[4], 25);
                        var ch = (a[4] & a[5]) ^ (~a[4] & a[6]);
                        var u1 = (a[7] + S1 + ch + K[i] + w[i]) | 0;
                        var S0 = rotr(a[0], 2) ^ rotr(a[0], 13) ^ rotr(a[0], 22);
                        var maj = (a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]);
                        var u2 = (S0 + maj) | 0;
                        a = [(u1 + u2) | 0, a[0], a[1], a[2], (a[3] + u1) | 0, a[4], a[5], a[6]];
                    }
                }
                for (j = 0; j < h.length; ++j) h[j] = (h[j] + a[j]) | 0;
            }
            var out = new Uint8Array(h.length * 4);
            for (j = 0; j < h.length; ++j) { out[4 * j] = h[j] >>> 24; out[4 * j + 1] = (h[j] >>> 16) & 0xff; out[4 * j + 2] = (h[j] >>> 8) & 0xff; out[4 * j + 3] = h[j] & 0xff; }
            return hex(out, 0, out.length, ":");
        }

        // ---- The store ------------------------------------------------------------------

        // user: [{certificateId, der (base64), trusted, added}]; system:
        // {id: {trusted?, removed?}}.
        function load() {
            var st = store.get(KEY, null) || {};
            return { user: st.user || [], system: st.system || {}, nextId: st.nextId || 1 };
        }
        var systemCerts = null;
        function systemList() {
            if (!systemCerts) {
                systemCerts = [];
                SYSTEM_CERTS.forEach(function (id) {
                    var text = PalmSystem.getResource(SYSTEM_DIR + id + ".pem");
                    if (!text) return;
                    var bytes = new Uint8Array(text.length);
                    for (var i = 0; i < text.length; ++i) bytes[i] = text.charCodeAt(i) & 0xff;
                    var der = certsIn(bytes)[0];
                    if (der) systemCerts.push({ certificateId: id, der: der, system: true });
                });
            }
            return systemCerts;
        }
        // Every certificate: {certificateId, der (bytes), trusted, system}.
        function all(st) {
            st = st || load();
            var out = [];
            systemList().forEach(function (c) {
                var o = st.system[c.certificateId] || {};
                if (!o.removed) out.push({ certificateId: c.certificateId, der: c.der, trusted: o.trusted !== false, system: true });
            });
            st.user.forEach(function (c) {
                out.push({ certificateId: c.certificateId, der: b64Bytes(c.der), trusted: c.trusted !== false, system: false });
            });
            return out;
        }
        function filename(c) {
            return c.system ? SYSTEM_DIR + c.certificateId + ".pem" : "/var/palm/data/certificates/" + c.certificateId + ".pem";
        }
        var parsed = {};
        function info(c) {
            var k = c.certificateId + ":" + c.der.length;
            if (!parsed[k]) parsed[k] = parse(c.der);
            return parsed[k];
        }
        function displayName(n) { return n.commonname || n.organization || n.organizationalunit || ""; }
        function summary(c) {
            var p = info(c);
            return { certificateId: c.certificateId, certificateFilename: filename(c),
                     commonname: p.subject.commonname || "", organization: p.subject.organization || "",
                     issuer: displayName(p.issuer), startdate: p.startdate, expiredate: p.expiredate,
                     trusted: c.trusted, system: c.system, isCA: p.isCA };
        }
        function find(p) {
            return all().filter(function (c) {
                return (p.certificateId !== undefined && String(c.certificateId) === String(p.certificateId))
                    || (p.certificateFilename && filename(c) === p.certificateFilename);
            })[0] || null;
        }
        function sameDer(a, b) {
            if (a.length !== b.length) return false;
            for (var i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
            return true;
        }
        var watchers = [];
        function save(st) {
            store.set(KEY, st);
            watchers = watchers.filter(function (w) { return w(); });
        }
        function listReply() {
            var list = all().map(summary).sort(function (a, b) {
                return (a.commonname || a.organization).toLowerCase() < (b.commonname || b.organization).toLowerCase() ? -1 : 1;
            });
            return ok({ certificates: list, userCertificateStore: list.filter(function (c) { return !c.system; }) });
        }

        register(["com.palm.certificatemanager"], {
            // {subscribe}: again after each change (Phoenix).
            "/listcertificates": function (p, reply, ctx) {
                reply(listReply());
                if (p.subscribe) watchers.push(function () { if (ctx.cancelled()) return false; reply(listReply()); return true; });
            },
            "/getcertificatedetails": function (p, reply) {
                if (p.certificateId === undefined && !p.certificateFilename) return reply(fail(E.BAD_PARAMS, "certificateId or certificateFilename is required"));
                var c = find(p);
                if (!c) return reply(fail(E.NOT_FOUND, "No such certificate"));
                var d = info(c), r = ok({}), k;
                for (k in d) r[k] = d[k];
                r.certificateId = c.certificateId;
                r.certificateFilename = filename(c);
                r.trusted = c.trusted;
                r.system = c.system;
                r.fingerprints = { sha256: sha(c.der, false), sha1: sha(c.der, true) };
                r.pem = "-----BEGIN CERTIFICATE-----\n" + bytesB64(c.der).replace(/(.{64})/g, "$1\n").replace(/\n$/, "") + "\n-----END CERTIFICATE-----\n";
                reply(r);
            },
            "/addcertificate": function (p, reply) {
                var path = p.certificateFilename;
                if (typeof path !== "string" || path.charAt(0) !== "/") return reply(fail(E.BAD_PARAMS, "certificateFilename must be an absolute path"));
                dispatch("palm://org.webosphoenix.filemanager/read", { path: path, encoding: "base64", maxBytes: 1024 * 1024 }, function (r) {
                    if (!r || !r.returnValue) return reply(fail(E.READ, (r && r.errorText) || "Cannot read " + path));
                    var ders = certsIn(b64Bytes(r.data)), good = [];
                    ders.forEach(function (der) { try { parse(der); good.push(der); } catch (e) { /* not one */ } });
                    if (!good.length) return reply(fail(E.NOT_CERT, "There is no certificate in " + path.replace(/^.*\//, "")));
                    var st = load(), have = all(st), ids = [];
                    good.forEach(function (der) {
                        if (have.some(function (c) { return sameDer(c.der, der); })) return;
                        var id = "user-" + st.nextId++;
                        st.user.push({ certificateId: id, der: bytesB64(der), trusted: true, added: Date.now() });
                        have.push({ certificateId: id, der: der });
                        ids.push(id);
                    });
                    if (!ids.length) return reply(fail(E.EXISTS, "This certificate is installed already"));
                    save(st);
                    reply(ok({ certificateIds: ids }));
                }, { cancelled: function () { return false; }, onCancel: null });
            },
            "/setcertificatetrust": function (p, reply) {
                var c = find(p);
                if (!c || p.certificateId === undefined) return reply(fail(E.NOT_FOUND, "No such certificate"));
                var st = load();
                if (c.system) {
                    var o = st.system[c.certificateId] || {};
                    o.trusted = !!p.trusted;
                    st.system[c.certificateId] = o;
                } else {
                    st.user.forEach(function (u) { if (u.certificateId === c.certificateId) u.trusted = !!p.trusted; });
                }
                save(st);
                reply(ok());
            },
            "/removecertificate": function (p, reply) {
                var c = find(p);
                if (!c || p.certificateId === undefined) return reply(fail(E.NOT_FOUND, "No such certificate"));
                var st = load();
                if (c.system) st.system[c.certificateId] = { removed: true };
                else st.user = st.user.filter(function (u) { return u.certificateId !== c.certificateId; });
                save(st);
                reply(ok());
            },
            // The system's certificates back as shipped (Phoenix).
            "/restorecertificates": function (p, reply) {
                var st = load();
                st.system = {};
                save(st);
                reply(ok());
            }
        });
        runtime.certificates = { parse: function (der) { return parse(der); }, sha256: function (b) { return sha(b, false); },
                                 sha1: function (b) { return sha(b, true); }, certsIn: certsIn };
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
    //       {ticket}; getAllHistory (items oldest first, with the legacy
    //       state, fileExistsOnFilesys and recordString); clearHistory.
    //       Files land under /media/internal in the media block's store, so
    //       Files, the media indexer and the apps see them. The default
    //       folder is /media/internal/Downloads, the Downloads folder Files
    //       shows (legacy webOS used /media/internal/downloads; Linux names
    //       are case-sensitive, so there is one folder; a device image will
    //       have to set the service's default to it). The amounts come from the host's proxy
    //       while the body comes (progressOf), and each download is an
    //       ongoing activity in the notification area until it ends; a tap
    //       opens its app's list of downloads (the browser's drawer).
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
        var DOWNLOAD_DIR = MEDIA_ROOT + "/Downloads";
        var HISTORY_KEY = "downloads:history";
        var FOCUS_KEY = "audiofocus";

        // ---- HTTP -----------------------------------------------------------------------

        function b64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; i += 0x8000)
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return global.btoa(s);
        }
        // req.progress: an id the host's proxy reports the body's progress
        // under (progressOf below); the download manager's.
        function request(req) {
            var r = { method: req.method || "GET", url: req.url, headers: req.headers || {}, body: req.body,
                      binary: !!req.binary, follow: req.follow !== false };
            if (req.progress) r.progress = String(req.progress);
            var viaHost = /^https?:$/.test(global.location.protocol)
                ? fetch("/__phoenix/proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: toJson(r) })
                    .then(function (res) { return res.json(); })
                : global.location.protocol === "phoenix:"
                ? hostGetJson("/__phoenix/proxy?req=" + encodeURIComponent(toJson(r)))
                : null;
            if (viaHost) {
                return viaHost.then(function (x) {
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
        // How far the proxy has come with a request made with {progress: id}:
        // {received, total} (total -1: not known), or null (over, unknown, or
        // no proxy: a page fetching directly cannot tell).
        function progressOf(id) {
            var proto = global.location.protocol;
            var path = "/__phoenix/proxy/progress?id=" + encodeURIComponent(id);
            var answer = /^https?:$/.test(proto) ? fetch(path).then(function (res) { return res.json(); })
                : proto === "phoenix:" ? hostGetJson(path) : null;
            if (!answer) return Promise.resolve(null);
            return answer.then(function (x) {
                return x && typeof x.received === "number" ? { received: x.received, total: typeof x.total === "number" ? x.total : -1 } : null;
            }, function () { return null; });
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

        function sizeText(n) {
            if (n < 1024) return n + " B";
            if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
            return (n / (1024 * 1024)).toFixed(1) + " MB";
        }
        // Where a tap on a download's ongoing activity goes: the app's own
        // list of downloads where it has one (the browser's Downloads drawer,
        // the launch params its "finished downloading" banner uses).
        var DOWNLOAD_LISTS = { "com.palm.app.browser": { toasterOpen: "downloads" } };
        // A download in the notification area while it runs
        // (org.webosphoenix.ongoing, "Ongoing activities" below): the file's
        // name, how much has come, and the progress when the size is known.
        function showOngoing(rec) {
            var known = rec.amountTotal > 0;
            host.postToHost("ongoing", {
                id: "download-" + rec.ticket, appId: rec.owner || PalmSystem.appIdentifier, title: rec.destFile,
                body: known ? "Downloading " + sizeText(rec.amountReceived) + " of " + sizeText(rec.amountTotal)
                            : rec.amountReceived > 0 ? "Downloading " + sizeText(rec.amountReceived) : "Downloading",
                icon: "", params: DOWNLOAD_LISTS[rec.owner] || null,
                progress: known ? Math.min(100, Math.floor(rec.amountReceived * 100 / rec.amountTotal)) : -1
            });
        }
        function clearOngoing(rec) { host.postToHost("ongoing", { id: "download-" + rec.ticket, clear: true }); }

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
            var job = running[ticket] = { aborted: false, progressId: "dl-" + Date.now().toString(36) + "-" + ticket };
            remember(rec);
            reply(ok({ ticket: ticket, url: url, target: path, subscribed: !!p.subscribe }));
            var send = function (x) { if (!ctx.cancelled()) reply(ok(x)); };
            showOngoing(rec);
            // The host's proxy says how much has come while the body comes;
            // the subscriber and the notification area get it as the real
            // service reports it, {ticket, amountReceived, amountTotal}.
            var polling = true;
            (function poll() {
                if (!polling) return;
                progressOf(job.progressId).then(function (pr) {
                    if (!polling) return;
                    if (pr && (pr.received !== rec.amountReceived || (pr.total > 0 && pr.total !== rec.amountTotal))) {
                        rec.amountReceived = pr.received;
                        if (pr.total > 0) rec.amountTotal = pr.total;
                        send({ ticket: ticket, url: url, amountReceived: rec.amountReceived, amountTotal: rec.amountTotal });
                        showOngoing(rec);
                    }
                    setTimeout(poll, 250);
                });
            })();
            request({ url: url, binary: true, follow: true, progress: job.progressId }).then(function (res) {
                polling = false;
                if (job.aborted) throw { aborted: true };
                if (res.status < 200 || res.status > 299) throw { status: res.status };
                var bytes = fromB64(res.bodyBase64 || "");
                var total = bytes.length;
                rec.amountTotal = total;
                rec.mimetype = rec.mimetype || (res.headers && res.headers["content-type"] || "").split(";")[0];
                var blob = new Blob([bytes], { type: rec.mimetype || "" });
                if (!runtime.mediaFiles) throw { status: -1 };
                return runtime.mediaFiles.write(path, blob).then(function () { return total; });
            }).then(function (total) {
                if (job.aborted) throw { aborted: true };
                rec.amountReceived = total;
                rec.completed = true;
                rec.completionStatusCode = 200;
                remember(rec);
                delete running[ticket];
                clearOngoing(rec);
                send({ ticket: ticket, url: url, amountReceived: total, amountTotal: total });
                send({ ticket: ticket, url: url, target: path, destPath: rec.destPath, destFile: name, mimetype: rec.mimetype,
                       amountReceived: total, amountTotal: total, completed: true, completionStatusCode: 200,
                       interrupted: false, aborted: false });
            }, function (e) {
                polling = false;
                var aborted = !!(e && e.aborted);
                rec.completed = true;
                rec.aborted = aborted;
                rec.interrupted = !aborted;
                rec.completionStatusCode = e && e.status ? e.status : -1;
                remember(rec);
                delete running[ticket];
                clearOngoing(rec);
                send({ ticket: ticket, url: url, target: path, destPath: rec.destPath, destFile: name, completed: true,
                       completionStatusCode: rec.completionStatusCode, interrupted: !aborted, aborted: aborted });
            });
        }

        // getAllHistory's items as the legacy service kept them (Isis reads
        // state, fileExistsOnFilesys and the record, recordString, to list the
        // finished downloads again), with the record's fields beside them.
        function historyItem(h) {
            var item = {}, k;
            for (k in h) item[k] = h[k];
            item.state = !h.completed ? "running" : h.completionStatusCode === 200 && !h.aborted && !h.interrupted ? "completed"
                : h.aborted ? "cancelled" : "failed";
            item.recordString = toJson(h);
            return item;
        }

        var dm = {
            "/download": download,
            "/cancelDownload": function (p, reply) {
                var r = running[p.ticket];
                if (!r) return reply(fail(-1, "No such download: " + p.ticket));
                r.aborted = true;
                reply(ok({ ticket: p.ticket }));
            },
            // Oldest first, as the legacy service sorted them by ticket.
            "/getAllHistory": function (p, reply) {
                var owner = p.owner;
                var mine = history().filter(function (h) { return !owner || h.owner === owner; });
                var mf = runtime.mediaFiles;
                Promise.all(mine.map(function (h) {
                    if (!h.completed || !mf) return Promise.resolve(false);
                    return mf.read(h.target).then(function (b) { return !!b; }, function () { return false; });
                })).then(function (exists) {
                    reply(ok({ items: mine.map(function (h, i) {
                        var item = historyItem(h);
                        item.fileExistsOnFilesys = exists[i];
                        return item;
                    }).reverse() }));
                });
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

    // A screen capture deleted (the preview's Delete, Photos: mediafiles/
    // remove; Files: filemanager/remove, a capture or a folder holding
    // some): its "Screen captured" notification goes too (tag "capture:"
    // + its file, runtime.saveScreenshot), as it would open nothing.
    (function () {
        var CAPTURES = "/media/internal/screencaptures";
        function captureRemoved(path) {
            path = String(path || "").replace(/\/+$/, "");
            if (!path || (path.indexOf(CAPTURES + "/") !== 0 && CAPTURES.indexOf(path) !== 0)) return;
            host.postToHost("notification", { appId: "org.webosphoenix.screenshot", remove: true,
                                              tag: "capture:" + path, tagPrefix: "capture:" + path + "/" });
        }
        runtime.captureRemoved = captureRemoved;
        ["org.webosphoenix.service.mediafiles", "org.webosphoenix.filemanager"].forEach(function (name) {
            var svc = runtime.services[name];
            if (!svc || !svc["/remove"]) return;
            var base = svc["/remove"];
            svc["/remove"] = function (p, reply, ctx) {
                base(p, function (r) {
                    if (r && r.returnValue) captureRemoved(p.path);
                    reply(r);
                }, ctx);
            };
        });
    })();

    // ================================================================================
    // Dictation for the apps (org.webosphoenix.dictation; Voice Dial)
    // ================================================================================
    //
    // The shell's microphone and transcriber, the keyboard's dictation (shell/
    // native/dictation.cpp: it records, writes a 16 kHz WAV and runs
    // org.webosphoenix.transcriber's whisper.cpp on it), lent to an app that
    // listens without a text field. A Phoenix service; the original Voice
    // Dial called com.palm.pmvoicecommand, which was never released.
    //
    //   start {prompt?, autoStop?, subscribe: true}
    //       -> {subscribed: true, state: "listening"}, {state: "transcribing"},
    //          then {state: "done", text}, or an error (DICTATION_ERRORS in
    //          apps/shared/luna/src/dictation.ts). prompt: words to expect,
    //          e.g. the contacts' names (whisper's initial prompt); autoStop:
    //          end by itself when the speaker is done. Cancelling the
    //          subscription stops listening without a transcript.
    //   stop {}      the speaker is done: transcribe what was heard
    //   getStatus {} -> {available}
    //
    // One microphone: one recording at a time, for one window; the keyboard
    // and other windows get NOT_AVAILABLE / IN_USE meanwhile.
    //
    // The shell does the work when /usr/share/phoenix/host.json says
    // {"dictation": true} (phoenix-sim; a device's shell): "dictation" host
    // messages ({op: "start" | "stop" | "cancel", prompt, autoStop}) go out,
    // and the states come back through __phoenixRuntime.dictationEvent({state,
    // text?, errorText?}). Anywhere else (a browser) there is no microphone
    // to lend: start fails with NOT_AVAILABLE.
    (function dictationServices() {
        var E = { BAD_PARAMS: -1, NOT_AVAILABLE: 1, IN_USE: 2, NOTHING_HEARD: 3, FAILED: 4 };
        var hostInfo = null;
        function available() {
            if (hostInfo === null) {
                try { hostInfo = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/host.json") || "{}") || {}; }
                catch (e) { hostInfo = {}; }
            }
            return hostInfo.dictation === true;
        }
        var current = null;           // {reply, ctx} of the listening start call
        function finish(r) {
            var c = current;
            current = null;
            if (c && !c.ctx.cancelled()) c.reply(r);
        }
        runtime.dictationEvent = function (ev) {
            if (!current || !ev) return;
            if (ev.state === "listening" || ev.state === "transcribing") {
                if (!current.ctx.cancelled()) current.reply(ok({ subscribed: true, state: ev.state }));
            } else if (ev.state === "done") {
                var text = String(ev.text || "").trim();
                finish(text ? ok({ state: "done", text: text }) : fail(E.NOTHING_HEARD, "Nothing was heard."));
            } else if (ev.state === "error") {
                var why = String(ev.errorText || "Dictation failed.");
                finish(fail(/^Nothing was heard/.test(why) ? E.NOTHING_HEARD
                            : /in use/.test(why) ? E.IN_USE
                            : /not available|no microphone|not installed/i.test(why) ? E.NOT_AVAILABLE : E.FAILED, why));
            }
        };
        register(["org.webosphoenix.dictation"], {
            "/start": function (p, reply, ctx) {
                if (p.prompt !== undefined && (typeof p.prompt !== "string" || p.prompt.length > 1000))
                    return reply(fail(E.BAD_PARAMS, "prompt must be text of up to 1000 characters"));
                if (!available())
                    return reply(fail(E.NOT_AVAILABLE, "Dictation needs the Phoenix shell's microphone."));
                if (current) return reply(fail(E.IN_USE, "This app is already listening."));
                current = { reply: reply, ctx: ctx };
                var mine = current;
                ctx.onCancel = function () {
                    if (current !== mine) return;
                    current = null;
                    host.postToHost("dictation", { op: "cancel" });
                };
                host.postToHost("dictation", { op: "start", prompt: p.prompt || "", autoStop: !!p.autoStop });
            },
            "/stop": function (p, reply) {
                if (!current) return reply(fail(E.BAD_PARAMS, "Not listening."));
                host.postToHost("dictation", { op: "stop" });
                reply(ok());
            },
            "/getStatus": function (p, reply) { reply(ok({ available: available() })); }
        });
        // A page that goes away stops listening.
        global.addEventListener("pagehide", function () {
            if (current) { current = null; host.postToHost("dictation", { op: "cancel" }); }
        });
        runtime.dictation = { errors: E };
    })();

    // ================================================================================
    // The simulator's own (org.webosphoenix.simulator)
    // ================================================================================
    //
    // What phoenix-sim does on this computer for the apps; only there
    // (/usr/share/phoenix/host.json {"marketplaceCatalog": true}): on a
    // device, or in a browser, the methods answer NOT_AVAILABLE and the
    // apps leave out what they would offer.
    //
    //   marketplaceCatalog {subscribe} -> {state: "stopped" | "starting" |
    //       "running" | "failed", url, error, settingUp}: the Marketplace's
    //       catalog service (server/marketplace) on this computer, which
    //       the simulator's Marketplace reads (phoenix-sim's SimMarketplace;
    //       its Services menu starts and stops it too).
    //   startMarketplaceCatalog -> the same, once it runs; fails with its
    //       reason (FAILED) when it does not start. Only the Marketplace
    //       may ask (the shell checks which app's window asks).
    //
    // The shell passes the state to every page (applyHostStatus
    // {marketplaceCatalog}); "simulator" host messages ({op}) ask it.
    (function simulatorServices() {
        var E = { NOT_AVAILABLE: 1, FAILED: 2 };
        var hostInfo = null;
        function available() {
            if (hostInfo === null) {
                try { hostInfo = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/host.json") || "{}") || {}; }
                catch (e) { hostInfo = {}; }
            }
            return hostInfo.marketplaceCatalog === true;
        }
        var catalog = { state: "stopped", url: "http://127.0.0.1:8088/", error: "", settingUp: false };
        var watching = [];   // {reply, ctx} of marketplaceCatalog subscribers
        var starting = [];   // {reply, ctx} of startMarketplaceCatalog calls waiting
        function status() {
            return ok({ state: catalog.state, url: catalog.url, error: catalog.error, settingUp: catalog.settingUp });
        }
        function settle() {
            if (catalog.state !== "running" && catalog.state !== "failed" && catalog.state !== "stopped") return;
            var waiting = starting;
            starting = [];
            waiting.forEach(function (w) {
                if (w.ctx.cancelled()) return;
                w.reply(catalog.state === "running" ? status()
                    : fail(E.FAILED, catalog.error || "The catalog service did not start."));
            });
        }
        function changed() {
            watching = watching.filter(function (w) { return !w.ctx.cancelled(); });
            watching.forEach(function (w) { w.reply(status()); });
        }
        runtime.hostStatusHooks = runtime.hostStatusHooks || [];
        runtime.hostStatusHooks.push(function (st) {
            var c = st && st.marketplaceCatalog;
            if (!c || typeof c !== "object" || typeof c.state !== "string") return;
            catalog = { state: c.state, url: String(c.url || catalog.url), error: String(c.error || ""), settingUp: !!c.settingUp };
            changed();
            settle();
        });
        register(["org.webosphoenix.simulator"], {
            "/marketplaceCatalog": function (p, reply, ctx) {
                if (!available()) return reply(fail(E.NOT_AVAILABLE, "Only in the simulator."));
                reply(status());
                if (p.subscribe) watching.push({ reply: reply, ctx: ctx });
            },
            "/startMarketplaceCatalog": function (p, reply, ctx) {
                if (!available()) return reply(fail(E.NOT_AVAILABLE, "Only in the simulator."));
                if (catalog.state === "running") return reply(status());
                starting.push({ reply: reply, ctx: ctx });
                // The shell answers with the state (applyHostStatus), the
                // final one once it runs or fails.
                catalog.state = "starting";
                catalog.error = "";
                changed();
                host.postToHost("simulator", { op: "startMarketplaceCatalog" });
            }
        });
    })();

    // ================================================================================
    // Voice Dial (com.palm.sysapp.voicedial)
    // ================================================================================
    //
    // luna-sysmgr's Voice Dial launcher icon only called
    // palm://com.palm.pmvoicecommand/startVoiceCommand {source: "appicon"}
    // (ApplicationManager.cpp slotBuiltInAppEntryPoint_VoiceDial), a service
    // that was never released. Phoenix Voice Dial (apps/voicedial,
    // org.webosphoenix.voicedial) answers to that id and that call.
    (function voiceDial() {
        var VOICE_DIAL = "org.webosphoenix.voicedial";
        runtime.appAliases["com.palm.sysapp.voicedial"] = VOICE_DIAL;
        register(["com.palm.pmvoicecommand"], {
            "/startVoiceCommand": function (p, reply) {
                host.postToHost("launch", { id: VOICE_DIAL, params: { source: p.source || "service" } });
                reply(ok());
            }
        });
    })();

    // ---- Node.js device services in the page --------------------------------------
    //
    // Some Phoenix services are Node.js modules a device runs with
    // run-js-service (apps/dav/service, apps/settings/service). The simulator
    // runs the same code in the page: nodeServiceLoader(dir, label) is a
    // require() for its CommonJS modules (relative requires only), read
    // from the virtual rootfs; nodeServiceLuna() is its luna.call(uri,
    // params) -> Promise<reply> on the simulated bus (nodeServiceLuna(id):
    // the calls are the service's, ctx.caller id, as luna-service2 tells a
    // service who calls on a device; the location permission is asked of
    // the caller, not of the page the service happens to run in); proxiedRequest is its
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

    function nodeServiceLuna(caller) {
        return {
            // A subscription: onReply for each reply until cancel().
            subscribe: function (uri, params, onReply) {
                var stopped = false;
                dispatch(uri, clone(params || {}), function (r) {
                    if (!stopped) setTimeout(function () { if (!stopped) onReply(r); }, 0);
                }, { cancelled: function () { return stopped; }, onCancel: null, caller: caller });
                return function () { stopped = true; };
            },
            call: function (uri, params) {
                return new Promise(function (resolve) {
                    var done = false;
                    dispatch(uri, clone(params || {}), function (r) {
                        if (done) return;
                        done = true;
                        setTimeout(function () { resolve(r); }, 0);
                    }, { cancelled: function () { return done; }, onCancel: null, caller: caller });
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
                .then(function (res) { return res.json(); })
            : global.location.protocol === "phoenix:"
            ? hostGetJson("/__phoenix/proxy?req=" + encodeURIComponent(toJson(req)))
            : null;
        if (viaHost) {
            return viaHost.then(function (r) {
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
    // the system, only for accounts of templates whose service is on the
    // simulated bus (templates(), found by the block "Accounts"):
    //   - com.palm.service.accounts lists the templates, creates, modifies
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

        // The templates this block serves (runtime.accountTemplateHasTransport,
        // block "Accounts"): CardDAV and CalDAV, the Subscribed Calendar (a
        // public .ics, one way: lib/webcal.js), the simulated Jabber (XMPP)
        // account (block "Instant messaging"), and any other whose service
        // is on the simulated bus.
        function templates() {
            return runtime.accountTemplates().filter(runtime.accountTemplateHasTransport);
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
        runtime.applyHostStatus = function (st, opts) {
            if (st && st.installerResult && pending[st.installerResult.requestId]) {
                var cb = pending[st.installerResult.requestId];
                delete pending[st.installerResult.requestId];
                cb(st.installerResult);
            }
            if (st && typeof st.appsVersion === "number" && st.appsVersion !== lastAppsVersion) {
                var first = lastAppsVersion < 0;
                lastAppsVersion = st.appsVersion;
                if (!first || st.appsVersion > 0) appsChanged(st.appsCause || null);
            }
            // What the shell knows is being installed, from every page.
            if (st && st.installs && typeof st.installs === "object") {
                installs = st.installs;
                installWatchers = installWatchers.filter(function (w) { return w() !== false; });
            }
            baseApply(st, opts);
        };
        // One request to the host, answered with {ok, error, ...}: install
        // and remove (an app's files), and the application manager's work
        // that needs the host: addLaunchPoint, removeLaunchPoint, rescan,
        // running, close, capacity (free space). phoenix-sim's
        // SimWindowSource answers through applyHostStatus {installerResult};
        // tools/serve-rootfs.py at POST /__phoenix/installer.
        var CHANGES_APPS = { install: true, remove: true, addLaunchPoint: true, removeLaunchPoint: true, rescan: true };
        function hostOp(op, payload) {
            if (CHANGES_APPS[op]) launchPoints();   // the list before, for launchPointChanges
            var body = Object.assign({ op: op }, payload || {});
            if (/^https?:$/.test(global.location.protocol)) {
                return fetch("/__phoenix/installer", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: toJson(body)
                }).then(function (res) { return res.json(); }).then(function (r) {
                    if (r.ok && CHANGES_APPS[op]) appsChanged(r.cause ? { cause: r.cause, appId: body.appId } : null);
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
                body.requestId = id;
                if (op === "install" || op === "remove")
                    host.postToHost(op === "install" ? "installApp" : "removeApp", body);
                else
                    host.postToHost("appManagerOp", body);
            });
        }
        runtime.hostOp = hostOp;
        function hostInstall(op, appId, files, cause) {
            return hostOp(op, { appId: appId, files: files || [], cause: cause || "" });
        }

        // ---- Installs as they go, for the launcher -----------------------------------
        // The launcher shows an app being installed as a faded icon with a
        // progress strip, and one that failed with a warning badge
        // (LunaSysMgr: ApplicationDescription Status_Installing /
        // Status_Failed, AppMonitor's install status decorators). Whoever
        // installs tells the shell ("installStatus" host message):
        // {appId, state: "installing" | "failed" | "installed", progress
        // (0-100), title, icon, reason, retry: {uri, params} (how to try
        // again), open: {id, params} (what a tap opens meanwhile)}. The
        // shell tells every page what is pending (applyHostStatus
        // {installs}), for installProgressQuery.
        var installs = {};
        runtime.installStatus = function (appId, st) {
            if (!appId) return;
            var was = installs[appId] || {}, now = Object.assign({}, was, { appId: appId });
            for (var k in st) if (st[k] !== undefined) now[k] = st[k];
            // Several report the same install (the Marketplace, then the
            // installer): progress only goes forward.
            if (now.state === "installing" && was.state === "installing" && (was.progress || 0) > (st.progress || 0))
                now.progress = was.progress;
            if (now.state === "installed") delete installs[appId];
            else installs[appId] = now;
            host.postToHost("installStatus", now);
        };
        runtime.pendingInstalls = function () { return installs; };

        // ---- Install and remove ---------------------------------------------------------

        var statuses = {}, statusWatchers = [], installWatchers = [];
        // launcher: what the launcher's pending icon shows ({progress,
        // title, icon, retry}); null for removals.
        function report(id, statusValue, details, each, launcher) {
            var d = Object.assign({ packageId: id }, details || {});
            statuses[id] = d;
            var msg = ok({ id: id, statusValue: statusValue, details: d });
            if (each) each(msg);
            statusWatchers = statusWatchers.filter(function (w) { return w(msg) !== false; });
            if (/^(installed|install failed|removed|remove failed)$/.test(d.state)) delete statuses[id];
            if (launcher && id) {
                var st = d.state === "installed" ? { state: "installed", progress: 100 }
                       : d.state === "install failed" ? { state: "failed", reason: d.reason || "" }
                       : { state: "installing", progress: d.state === "installing" ? 50 : 0 };
                for (var k in launcher) if (launcher[k] !== undefined && launcher[k] !== null) st[k] = launcher[k];
                runtime.installStatus(id, st);
            }
        }

        // The app's title and icon from its package, for the pending icon.
        function packageLooks(pkg, app) {
            var info = app.appinfo || {}, out = { title: info.title || app.id };
            var iconPath = app.dir + (info.icon || "icon.png");
            var f = pkg.files.filter(function (x) { return x.path === iconPath; })[0];
            if (f && f.data && f.data.length < 512 * 1024)
                out.icon = "data:image/png;base64," + b64(f.data);
            return out;
        }

        // -> Promise<{appId, version, skipped}>; rejects with an Error (code, message).
        // developer: Developer Mode is on and the caller asked for it: a
        // package with install scripts, services or files outside its app
        // installs its app; the rest is skipped here (the simulator cannot
        // run scripts or a 2011 service) and listed in `skipped`.
        // retry: how the launcher's failed icon tries again ({uri, params});
        // by default the same install, unless the package was only in this
        // page's memory (/tmp).
        function installPackage(id, path, each, developer, retry) {
            if (retry === undefined)
                retry = /^\/tmp\//.test(path) ? null
                      : { uri: "luna://com.webos.appInstallService/install", params: { id: id || "", ipkUrl: path, developerMode: !!developer } };
            var looks = { retry: retry };
            report(id || "", 11, { state: "install needed", ipkUrl: path }, each, id ? looks : null);
            return readPackage(path).then(function (bytes) {
                return ipk().read(bytes);
            }).then(function (pkg) {
                var app = pkg.apps[0];
                if (!app) throw Object.assign(new Error("The package has no app"), { code: "NO_APP" });
                if (id && app.id !== id) throw Object.assign(new Error("The package is " + app.id + ", not " + id), { code: "WRONG_ID" });
                id = app.id;
                looks = Object.assign(packageLooks(pkg, app), { retry: retry && retry.params && retry.params.id === "" ?
                    { uri: retry.uri, params: Object.assign({}, retry.params, { id: id }) } : retry });
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
                report(id, 13, { state: "installing", ipkUrl: path }, each, looks);
                var files = pkg.files.map(function (f) { return { path: f.path.slice(app.dir.length), data: b64(f.data) }; });
                // Its account templates, for the accounts service (block "Accounts").
                runtime.recordAccountTemplates(id, files.map(function (f) { return f.path; }).filter(function (rel) {
                    return /^public\/accounts\/[^\/]+\/[^\/]+\.json$/i.test(rel);
                }));
                return hostInstall("install", id, files).then(function (r) {
                    if (!r.ok) throw Object.assign(new Error(r.error || "Install failed"), { code: "HOST" });
                    report(id, 30, { state: "installed", installBasePath: "/media/cryptofs/apps", skipped: skipped }, each, {});
                    return { appId: id, version: app.appinfo.version || pkg.control.Version || "", skipped: skipped };
                });
            }).then(null, function (e) {
                report(id || "", 24, { state: "install failed", errorCode: -1, reason: e.message }, each, id ? looks : null);
                throw e;
            });
        }
        runtime.installPackage = installPackage;

        function installed(id) {
            return launchPoints().some(function (lp) { return lp.id === id && lp.removable; });
        }
        // cause: why, for notifyOnChange ("USER", the default; "REVOKED").
        function removeApp(id, each, cause) {
            if (!installed(id)) return Promise.reject(Object.assign(new Error("No such id"), { code: -2 }));
            report(id, 41, { state: "remove needed" }, each);
            return hostInstall("remove", id, [], cause || "USER").then(function (r) {
                if (!r.ok) {
                    report(id, 25, { state: "remove failed", reason: r.error }, each);
                    throw Object.assign(new Error(r.error || "Remove failed"), { code: -7 });
                }
                runtime.recordAccountTemplates(id, null);
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
                }, false, /^\/tmp\//.test(path) ? null : { uri: "luna://com.palm.appinstaller/installNoVerify", params: { target: path } }).then(function (r) {
                    send("SUCCESS", { appId: r.appId });
                }, function (e) {
                    send("FAILED_IPKG_INSTALL", { details: { reason: e.message } });
                });
            });
        }
        runtime.legacyInstall = legacyInstall;

        // ---- notifyOnChange: apps installed and removed -------------------------------
        // {appId} (or none: every app, "*"), as ApplicationInstaller's
        // subscriptions (cbNotifyOnChange, notifyAppInstalled,
        // notifyAppRemoved: {appId, version, statusChange: "INSTALLED" |
        // "REMOVED", cause: "USER" | "REVOKED" | "UNKNOWN"}; system apps,
        // com.palm.sysapp.*, are not told).
        var changeWatchers = [];
        runtime.onAppsChanged(function (before, after, info) {
            var was = {}, now = {};
            before.forEach(function (lp) { if (/_default$/.test(lp.launchPointId)) was[lp.id] = lp; });
            after.forEach(function (lp) { if (/_default$/.test(lp.launchPointId)) now[lp.id] = lp; });
            var changes = [];
            Object.keys(now).forEach(function (id) {
                if (!was[id] || (was[id].version || "") !== (now[id].version || ""))
                    changes.push({ appId: id, version: now[id].version || "", statusChange: "INSTALLED" });
            });
            Object.keys(was).forEach(function (id) {
                if (!now[id] && id.indexOf("com.palm.sysapp") !== 0)
                    changes.push({ appId: id, version: was[id].version || "", statusChange: "REMOVED",
                                   cause: info && info.appId === id && info.cause ? info.cause : "USER" });
            });
            changes.forEach(function (c) {
                changeWatchers = changeWatchers.filter(function (w) { return w(c) !== false; });
            });
        });

        // ---- Sizes and capacity -------------------------------------------------------
        function kb(bytes) { return Math.ceil((Number(bytes) || 0) / 1024); }
        function userApps() {
            return launchPoints().filter(function (lp) { return /_default$/.test(lp.launchPointId) && lp.removable; });
        }

        // queryInstallCapacity result bits (ApplicationInstaller.cpp:844-845,
        // the App Catalog's codes); an unpacked size not given is twice the
        // package's (INSTALLER_DEFV__MIN_FREE_MULT, :75).
        var DOWNLOAD_SPACE_INSUFFICIENT = 1, INSTALL_SPACE_INSUFFICIENT = 2, MIN_FREE_MULT = 2;

        // revoke: the apps a trusted Marketplace catalog withdrew. LunaSysMgr
        // checked the signature over the app ids, one after the other,
        // with Palm's revocation certificate (cbRevoke, :3386-3505); Phoenix
        // checks it with the Ed25519 keys of the catalogs the device trusts.
        function trustedKeys() {
            var keys = [], st = store.get("marketplace:state", null) || {};
            (st.sources || []).forEach(function (s) { if (s.key && s.enabled !== false) keys.push(s.key); });
            try {
                (JSON.parse(PalmSystem.getResource("/etc/palm/marketplace/sources.json") || "{}").sources || []).forEach(function (s) {
                    if (s.key && keys.indexOf(s.key) < 0) keys.push(s.key);
                });
            } catch (e) { /* none */ }
            return keys;
        }
        function verifyRevocation(appIds, signatureB64) {
            var ed = loadModule("lib/ed25519.js");
            var sig, msg = new TextEncoder().encode(appIds.join(""));
            try { sig = unb64(String(signatureB64 || "")); } catch (e) { return Promise.resolve(false); }
            var sha512 = function (bytes) { return global.crypto.subtle.digest("SHA-512", bytes); };
            return trustedKeys().reduce(function (chain, k) {
                return chain.then(function (good) {
                    if (good) return true;
                    var key;
                    try { key = unb64(k); } catch (e) { return false; }
                    return ed.verify(sig, msg, key, sha512);
                });
            }, Promise.resolve(false));
        }

        register(["com.palm.appinstaller"], {
            "/installNoVerify": legacyInstall,
            "/install": legacyInstall,
            "/remove": function (p, reply) {
                removeApp(p.packageName || p.id).then(function () { reply(ok()); }, function (e) { reply(fail(-1, e.message)); });
            },
            "/isInstalled": function (p, reply) { reply(ok({ installed: launchPoints().some(function (lp) { return lp.id === (p.appId || p.packageName); }) })); },
            "/notifyOnChange": function (p, reply, ctx) {
                var id = typeof p.appId === "string" && p.appId ? p.appId : "*";
                reply(ok({ subscribed: true, appId: id }));
                launchPoints();   // what there is now, to tell changes from
                changeWatchers.push(function (c) {
                    if (ctx.cancelled()) return false;
                    if (id === "*" || id === c.appId) reply(c);
                    return true;
                });
            },
            // An install as it goes: {appId} -> {appId, state ("installing"
            // | "failed"), progress (0-100), title, reason}; {subscribe:
            // true}: each change, until it is installed (state "none",
            // progress 100) or fails. LunaSysMgr registered the method but
            // never answered it (lunasvcInstallProgressQuery returned
            // false); Phoenix answers from the launcher's pending icons.
            "/installProgressQuery": function (p, reply, ctx) {
                var id = p.appId || p.id || p.packageName;
                if (!id) return reply(fail("appinstaller_error", "missing appId"));
                function now() {
                    var st = installs[id];
                    return st ? ok({ appId: id, state: st.state, progress: st.progress || 0, title: st.title || "", reason: st.reason || "" })
                              : ok({ appId: id, state: "none", progress: launchPoints().some(function (lp) { return lp.id === id; }) ? 100 : 0 });
                }
                var first = now();
                if (first.state === "none")
                    return reply(Object.assign(first, { returnValue: false, errorText: "No install of " + id + " in progress" }));
                reply(Object.assign(first, { subscribed: !!p.subscribe }));
                if (!p.subscribe) return;
                var last = toJson(now());
                installWatchers.push(function () {
                    if (ctx.cancelled()) return false;
                    var r = now(), text = toJson(r);
                    if (text !== last) { last = text; reply(r); }
                    return r.state === "installing";
                });
            },
            // {appId | packageId, size, uncompressedSize} in KB ->
            // {result (0, or DOWNLOAD 1 | INSTALL 2 space insufficient),
            // spaceNeededInKB} (lunasvcQueryInstallCapacity: the package
            // and its unpacked files on one filesystem, less what an
            // installed copy frees).
            "/queryInstallCapacity": function (p, reply) {
                var id = p.appId || p.packageId;
                if (!id) return reply({ returnValue: false, errorCode: "appinstaller_error", errorText: "missing appId or packageId parameter" });
                if (p.size === undefined || p.size === null || p.size === "") return reply({ returnValue: false, errorCode: "appinstaller_error", errorText: "missing size parameter" });
                var size = Number(p.size), unpacked = Number(p.uncompressedSize) || 0;
                if (!(size >= 0)) return reply({ returnValue: false, errorCode: "appinstaller_error", errorText: "bad size parameter" });
                if (!unpacked) unpacked = size * MIN_FREE_MULT;
                hostOp("capacity", {}).then(function (r) {
                    if (!r.ok || typeof r.freeKB !== "number" || r.freeKB < 0)
                        return reply({ returnValue: false, errorCode: "appinstaller_error", errorText: r.error || "free space unknown" });
                    var have = userApps().filter(function (lp) { return lp.id === id; })[0];
                    var freed = have ? Math.min(kb(have.appSize || have.size), unpacked) : 0;
                    var needed = Math.max(0, size + unpacked - freed), result = 0;
                    if (size > r.freeKB) result |= DOWNLOAD_SPACE_INSUFFICIENT;
                    if (needed > r.freeKB) result |= INSTALL_SPACE_INSUFFICIENT;
                    reply(ok({ result: result, spaceNeededInKB: String(needed) }));
                });
            },
            // {apps: [{appName (the app id), size (KB)}], totalSize (KB)}.
            "/getUserInstalledAppSizes": function (p, reply) {
                var apps = userApps().map(function (lp) { return { appName: lp.id, size: kb(lp.appSize || lp.size) }; });
                reply(ok({ apps: apps, totalSize: apps.reduce(function (t, a) { return t + a.size; }, 0) }));
            },
            // {item: '{"payload": {"signature": base64, "appId": [ids]}}'}
            // (item is JSON text, as the pubsub message carried it; an
            // object is taken too).
            "/revoke": function (p, reply) {
                var item = p.item, payload;
                if (item === undefined) return reply({ returnValue: false, errorCode: "missing item key" });
                if (typeof item === "string") {
                    try { item = JSON.parse(item); } catch (e) { return reply({ returnValue: false, errorCode: "item payload parse error" }); }
                }
                payload = item && item.payload;
                if (!payload) return reply({ returnValue: false, errorCode: "payload key missing" });
                if (typeof payload.signature !== "string") return reply({ returnValue: false, errorCode: "missing signature key" });
                if (!Array.isArray(payload.appId))
                    return reply({ returnValue: false, errorCode: payload.appId === undefined ? "missing appId key" : "appId key does not represent a json array object" });
                var ids = payload.appId.map(String);
                verifyRevocation(ids, payload.signature).then(function (good) {
                    if (!good) return reply({ returnValue: false, errorCode: "verify failed" });
                    reply(ok());
                    ids.reduce(function (chain, id) {
                        return chain.then(function () {
                            return installed(id) ? removeApp(id, null, "REVOKED").then(null, function () {}) : null;
                        });
                    }, Promise.resolve());
                });
            }
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
                    log: function (m) { console.info("[marketplace] " + m); },
                    // The launcher's pending icon: a tap opens the app's page
                    // in the Marketplace meanwhile; a failed one tries the
                    // Marketplace's install again.
                    pending: function (st) {
                        var params = { sourceId: st.sourceId, id: st.catalogId };
                        if (!runtime.installStatus) return;
                        runtime.installStatus(st.appId, {
                            state: st.state === "failed" || st.state === "installed" ? st.state : "installing",
                            progress: typeof st.progress === "number" ? st.progress : 0,
                            title: st.title || undefined, icon: st.icon || undefined, reason: st.errorText || "",
                            retry: { uri: "luna://" + SERVICE + "/install", params: params },
                            open: { id: "org.webosphoenix.marketplace", params: params }
                        });
                    }
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
    // Hardware and drivers (org.webosphoenix.hardware; services/hardware)
    // ================================================================================
    //
    // The device's own service (hardwareservice.js, loaded from
    // /usr/palm/services/org.webosphoenix.hardware/), given a simulated
    // device: the hardware below, opkg (packages read with the Marketplace's
    // .ipk reader, what they hold recorded in the store), and a kernel that
    // loads firmware and modules when the driver is reloaded. The driver
    // catalog is the sample one (server/drivers/sample), signed with a key
    // only the simulator trusts (/usr/share/phoenix/hardware/sample/
    // catalog-sim.json, in place of /etc/palm/hardware/catalog.json;
    // "hardware:config" in the store stands for an edited one).
    // tools/test-hardware.cjs sets "hardware:sim" {fail: {opkg: text}} to
    // make opkg fail.
    (function hardwareService() {
        var SERVICE = "org.webosphoenix.hardware";
        var SAMPLE = "/usr/share/phoenix/hardware/sample/";
        var PACKAGES = "/var/lib/phoenix/hardware/packages/";
        var loadModule = nodeServiceLoader("/usr/palm/services/" + SERVICE + "/", "Hardware service");
        var subtle = global.crypto && global.crypto.subtle;
        function digest(alg) {
            return function (bytes) { return subtle.digest(alg, bytes).then(function (h) { return new Uint8Array(h); }); };
        }
        function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
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

        // The simulated device: a PC-like tablet whose image has its drivers
        // and redistributable firmware, as Phoenix's images do: a Wi-Fi card,
        // a Realtek dongle (the catalog has newer firmware for it), an NVIDIA
        // card; the gaps the Hardware app fills: a dongle whose driver is not
        // in the 6.6 kernel (RTL8812AU, an out-of-tree driver), and a USB
        // gadget nothing knows. firmware / module: what the driver needs
        // before it binds.
        var DEVICES = [
            { id: "pci:0000:02:00.0", bus: "pci", name: "AR9462 Wireless Network Adapter", vendor: "Qualcomm Atheros", category: "wifi",
              modaliases: ["pci:v0000168Cd00000034sv0000105Bsd0000E052bc02sc80i00"], driver: "ath9k" },
            { id: "usb:1-2", bus: "usb", name: "RTL8821CU USB Wi-Fi Adapter", vendor: "Realtek", category: "wifi",
              modaliases: ["usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00"], driver: "rtw88_8821cu", firmware: ["rtw88/rtw8821c_fw.bin"] },
            { id: "usb:1-3", bus: "usb", name: "RTL8812AU USB Wi-Fi Adapter", vendor: "Realtek", category: "wifi",
              modaliases: ["usb:v0BDAp8812d0000dc00dsc00dp00icFFiscFFipFFin00"], driver: "88XXau", module: "88XXau" },
            { id: "pci:0000:01:00.0", bus: "pci", name: "TU117 [GeForce GTX 1650]", vendor: "NVIDIA", category: "graphics",
              modaliases: ["pci:v000010DEd00001F82sv00001043sd000087B4bc03sc00i00"], driver: "nouveau" },
            { id: "pci:0000:00:1f.3", bus: "pci", name: "Cannon Lake PCH cAVS", vendor: "Intel", category: "audio",
              modaliases: ["pci:v00008086d0000A348sv000017AAsd00003FF6bc04sc03i80"], driver: "snd_hda_intel" },
            { id: "pci:0000:03:00.0", bus: "pci", name: "NVMe SSD Controller 980", vendor: "Samsung", category: "storage",
              modaliases: ["pci:v0000144Dd0000A809sv0000144Dsd0000A801bc01sc08i02"], driver: "nvme" },
            { id: "usb:1-5", bus: "usb", name: "HD Pro Webcam C920", vendor: "Logitech", category: "camera",
              modaliases: ["usb:v046Dp082Dd0011dcEFdsc02dp01ic0Eisc01ip00in00"], driver: "uvcvideo" },
            { id: "i2c:i2c-GDIX1001:00", bus: "acpi", name: "Touchscreen (GDIX1001)", vendor: "Goodix", category: "input",
              modaliases: ["acpi:GDIX1001:"], driver: "Goodix-TS" },
            { id: "i2c:i2c-BOSC0200:00", bus: "acpi", name: "Accelerometer (BMC150)", vendor: "Bosch", category: "sensors",
              modaliases: ["acpi:BOSC0200:"], driver: "bmc150_accel_i2c" },
            { id: "usb:1-4", bus: "usb", name: "USB device (1209:0001)", vendor: "", category: "other",
              modaliases: ["usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00"], driver: null }
        ];
        // What the image has (the firmware as meta-phoenix's
        // packagegroup-phoenix-firmware installs it).
        var BASE_PACKAGES = { "kernel-6.6.23-phoenix": "6.6.23-r0", "kernel-module-rtw88-8821cu-6.6.23-phoenix": "6.6.23-r0", "busybox": "1.36.1-r0",
                              "linux-firmware-rtl8821": "20240909-r0", "linux-firmware-rtl8822": "20240909-r0", "linux-firmware-rtl-license": "20240909-r0",
                              "linux-firmware-nvidia-gpu": "20240909-r0", "linux-firmware-nvidia-license": "20240909-r0" };
        var IMAGE_FIRMWARE = ["rtw88/rtw8821c_fw.bin", "rtw88/rtw8822b_fw.bin", "rtw88/rtw8822c_fw.bin"];

        function sim() {
            var s = store.get("hardware:sim", null) || {};
            s.packages = s.packages || {};
            s.loaded = s.loaded || { firmware: IMAGE_FIRMWARE.slice(), modules: [] };
            return s;
        }
        function files() { return store.get("hardware:files", null) || {}; }

        var opkg = {
            list: function () {
                var s = sim(), out = [];
                Object.keys(BASE_PACKAGES).forEach(function (n) { out.push({ name: n, version: BASE_PACKAGES[n] }); });
                Object.keys(s.packages).forEach(function (n) { out.push({ name: n, version: s.packages[n].version }); });
                return Promise.resolve(out);
            },
            install: function (paths) {
                return wait(500).then(function () {
                    var s = sim();
                    if (s.fail && s.fail.opkg) return { ok: false, error: s.fail.opkg };
                    var all = files();
                    return paths.reduce(function (chain, path) {
                        return chain.then(function () {
                            var name = path.slice(PACKAGES.length);
                            if (!all[name]) throw new Error("No such file: " + path);
                            return runtime.ipk().read(unb64(all[name])).then(function (pkg) {
                                var s2 = sim();
                                s2.packages[pkg.control.Package] = { version: pkg.control.Version, files: pkg.files.map(function (f) { return f.path; }) };
                                store.set("hardware:sim", s2);
                            });
                        });
                    }, Promise.resolve()).then(function () { return { ok: true }; }, function (e) { return { ok: false, error: e.message }; });
                });
            },
            remove: function (names) {
                return wait(300).then(function () {
                    var s = sim();
                    names.forEach(function (n) { delete s.packages[n]; });
                    store.set("hardware:sim", s);
                    return { ok: true };
                });
            }
        };

        // The kernel: a driver probing again (a reload) loads what is in
        // /lib/firmware and /lib/modules then.
        function activate(step) {
            if (step.after === "reboot" || step.after === "none") return Promise.resolve();
            return wait(600).then(function () {
                var s = sim(), fw = IMAGE_FIRMWARE.slice(), mods = [];
                Object.keys(s.packages).forEach(function (n) {
                    s.packages[n].files.forEach(function (f) {
                        var m = /^lib\/firmware\/(?:updates\/)?(.+?)(\.xz|\.zst)?$/.exec(f);
                        if (m) fw.push(m[1]);
                        var k = /^lib\/modules\/[^/]+\/.*\/([^/]+)\.ko(\.xz|\.zst)?$/.exec(f);
                        if (k) mods.push(k[1]);
                    });
                });
                s.loaded = { firmware: fw, modules: mods };
                store.set("hardware:sim", s);
            });
        }

        function scan() {
            var s = sim();
            return Promise.resolve(DEVICES.map(function (d) {
                var missing = (d.firmware || []).filter(function (f) { return s.loaded.firmware.indexOf(f) < 0; });
                var bound = missing.length ? null : d.module && s.loaded.modules.indexOf(d.module) < 0 ? null : d.driver;
                return { id: d.id, bus: d.bus, name: d.name, vendor: d.vendor, category: d.category, modaliases: d.modaliases.slice(),
                         driver: bound, firmwareMissing: missing };
            }));
        }

        // file:// (the sample catalog in the rootfs) or the web.
        function rootfsBytes(path) {
            return new Promise(function (resolve) {
                var x = new global.XMLHttpRequest();
                x.open("GET", path, true);
                x.responseType = "arraybuffer";
                x.onload = function () {
                    var ok = (x.status === 200 || x.status === 0) && x.response && x.response.byteLength > 0;
                    resolve({ status: ok ? 200 : 404, bytes: ok ? new Uint8Array(x.response) : new Uint8Array(0) });
                };
                x.onerror = function () { resolve({ status: 404, bytes: new Uint8Array(0) }); };
                x.send();
            });
        }
        function fileUrl(u) { var m = /^file:\/\/(\/.*)$/.exec(u); return m ? m[1] : null; }

        var methods = null, watchers = [];
        function service() {
            if (methods) return methods;
            methods = loadModule("hardwareservice.js").createHardwareService({
                system: {
                    scan: scan,
                    info: function () { return Promise.resolve({ arch: "x86_64", kernel: "6.6.23-phoenix" }); },
                    activate: activate,
                    // Restarts counted by com.palm.power/shutdown/machineReboot.
                    bootId: function () { return "boot-" + store.get("boot:count", 0); }
                },
                opkg: opkg,
                request: function (req) {
                    var path = fileUrl(req.url);
                    if (!path) return proxiedRequest(req);
                    var text = PalmSystem.getResource(path);
                    return Promise.resolve(text ? { status: 200, body: text } : { status: 404, body: "" });
                },
                requestBytes: function (req) {
                    var path = fileUrl(req.url);
                    return (path ? rootfsBytes(path) : proxiedRequestBytes(req)).then(function (r) { return wait(300).then(function () { return r; }); });
                },
                crypto: { sha256: digest("SHA-256"), sha512: digest("SHA-512") },
                files: {
                    write: function (name, bytes) {
                        var all = files();
                        all[name] = b64(bytes);
                        store.set("hardware:files", all);
                        return PACKAGES + name;
                    },
                    find: function (name) { return files()[name] ? PACKAGES + name : null; },
                    remove: function (path) {
                        var all = files();
                        delete all[path.slice(PACKAGES.length)];
                        store.set("hardware:files", all);
                    }
                },
                state: {
                    load: function () { return store.get("hardware:state", null); },
                    save: function (o) { store.set("hardware:state", o); }
                },
                config: function () {
                    var c;
                    try { c = JSON.parse(PalmSystem.getResource(SAMPLE + "catalog-sim.json") || "{}"); }
                    catch (e) { c = {}; }
                    return Object.assign(c, store.get("hardware:config", {}));
                },
                // /usr/share/phoenix/firmware/licences.json and the licence files.
                imageFirmware: {
                    list: function () {
                        try { return JSON.parse(PalmSystem.getResource(SAMPLE + "firmware-in-image.json") || "{}").packages || []; }
                        catch (e) { return []; }
                    },
                    text: function (path) { return PalmSystem.getResource(SAMPLE + "licences/" + path.split("/").pop()) || null; }
                },
                luna: nodeServiceLuna(),
                log: function (m) { console.info("[hardware] " + m); }
            });
            methods.watch(function (r) { watchers.slice().forEach(function (w) { w(r); }); });
            return methods;
        }

        var names;
        try { names = loadModule("hardwareservice.js").METHODS; }
        catch (e) { return; }   // no rootfs behind the page (the runtime's unit tests)
        var serviceMethods = {};
        names.forEach(function (name) {
            serviceMethods["/" + name] = function (p, reply, ctx) {
                var m;
                try { m = service(); } catch (e) { return reply(fail("UNKNOWN_ERROR", String(e.message || e))); }
                if (name === "install" && p.subscribe) {
                    reply(ok({ subscribed: true, driverId: p.driverId, state: "queued" }));
                    m.install(p, function (st) { if (!ctx.cancelled()) reply(st); });
                    return;
                }
                m[name](p).then(function (r) {
                    if (name === "list" && p.subscribe && r.returnValue) {
                        r.subscribed = true;
                        var w = function (x) {
                            if (ctx.cancelled()) { watchers.splice(watchers.indexOf(w), 1); return; }
                            reply(x);
                        };
                        watchers.push(w);
                    }
                    reply(r);
                }, function (e) { reply(fail("UNKNOWN_ERROR", String(e && e.message || e))); });
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
    // Printing (com.palm.printmgr; Print Manager)
    // ================================================================================
    //
    // Enyo 1.0's print dialog (lib/printdialog: PrintDialog, the browser's
    // and Email's Print) speaks to the print manager, com.palm.printmgr.
    // Its calls, as PrintJob.js, DocumentPrintJob.js, ImagePrintJob.js,
    // PrinterSelector.js, PrinterOptions.js and PrinterAdder.js make them:
    //
    //   printers/list {subscribe}     {eventType: "Add" | "Rmv", printerID,
    //                                  printerName, printerAddress} per printer
    //   printers/getCurrent, printers/setCurrent {printerID}
    //   printers/getCapabilities {printerID} -> {mediaSize[], mediaType[],
    //                                  printQuality[], canDuplex, hasColor}
    //   printers/add {printerID, printerName, printerAddress}
    //   jobs/open {printerID, description, appName} -> {jobID}
    //   jobs/editPrintParams {jobID, numCopies, mediaSize, color, duplex,
    //                         topInset, leftInset, rightInset, bottomInset (in)}
    //   jobs/getFinalParamsAndArea {jobID} -> {width, height, pixelUnits,
    //                         renderInReverseOrder, ...}: the printable area
    //                         in dots at pixelUnits dots per inch
    //   jobs/getStatus {subscribe} -> {jobID, printerState: "DONE",
    //                         jobStatus: "Success" | "Cancelled" | "Error"}
    //   jobs/getRenderStatus {subscribe} -> {jobID, currentPage, totalPages,
    //                         renderResultCode (0 done, -502 cancelled)}
    //   jobs/addFile {jobID, pathName, currentPage, totalPages} (images)
    //   jobs/close {jobID}, jobs/cancel {jobID}
    //
    // Errors use the print manager's codes (PrintManagerError.js).
    //
    // The printer is "Save as PDF": the job becomes a PDF in
    // /media/internal/Documents, which Files, PDF View and the Print
    // Manager open. A document job is rendered by the page view or window
    // that prints: in phoenix-sim by Chromium (QtWebEngine's printToPdf,
    // WebAppWindow.qml, the "print" host message; the PDF comes back
    // through __phoenixRuntime.print.rendered), elsewhere (a desktop
    // browser, the tests) as the page's text. Image jobs (jobs/addFile) are
    // put on pages here, one picture a page. Network printers would need
    // CUPS / IPP Everywhere on a device; the simulator has none, so adding
    // one answers PM_ERR_PRINTER_NO_RESPONSE_MANUAL.
    //
    // Phoenix additions for the Print Manager app (com.palm.app.printmanager,
    // which is org.webosphoenix.printmanager): jobs/list {subscribe} ->
    // {jobs: [{jobID, description, appName, printerID, printerName, state
    // ("Printing", "Done", "Cancelled", "Failed"), pages, file, created,
    // finished, errorText}]} newest first; jobs/remove {jobID} (a finished
    // one). A job prints as an ongoing activity, as the Print Manager's
    // status dashboard did; its headless launch by PrintJob opens no card.
    //
    // __phoenixRuntime.print: render(jobID, how) (a page view or window),
    // renderHtml(jobID, {title, html}) (some HTML, Email's message),
    // rendered(jobID, base64 | null, info), pdf (the PDF writer), jobs().
    (function printing() {
        var SERVICE = "com.palm.printmgr";
        var PRINT_MANAGER = "org.webosphoenix.printmanager";
        var JOBS_KEY = "print:jobs", CURRENT_KEY = "print:current";
        var PDF_PRINTER = { printerID: "phoenix-save-as-pdf", printerName: "Save as PDF", printerAddress: "/media/internal/Documents" };
        var OUT_DIR = "/media/internal/Documents";
        var DPI = 300;
        // Points (1/72 in) per paper size; PrintDialog's names.
        var PAPER = { US_Letter: [612, 792], US_Legal: [612, 1008], ISO_A4: [595, 842],
                      Photo_4x6: [288, 432], Photo_5x7: [360, 504], Photo_5x7_MainTray: [360, 504], Photo_L: [252, 360], HAGAKI: [283, 420] };
        var E = { NO_RESPONSE_MANUAL: -203, BAD_JOB: -601, RENDER: -301, CANCEL_REQUESTED: -502 };
        runtime.appAliases["com.palm.app.printmanager"] = PRINT_MANAGER;

        // ---- Jobs (shared by every page, so the Print Manager sees them) ----------------

        function jobs() { return store.get(JOBS_KEY, []); }
        function saveJob(j) {
            var all = jobs().filter(function (x) { return x.jobID !== j.jobID; });
            all.unshift(j);
            store.set(JOBS_KEY, all.slice(0, 100));
            changed();
        }
        function findJob(id) { return jobs().filter(function (x) { return x.jobID === id; })[0] || null; }
        var listeners = [];
        function changed() { listeners.slice().forEach(function (f) { try { f(); } catch (e) { /* a page gone */ } }); }
        function listen(ctx, f) {
            listeners.push(f);
            var prev = ctx.onCancel;
            ctx.onCancel = function () { listeners = listeners.filter(function (x) { return x !== f; }); if (prev) prev(); };
        }
        try {
            global.addEventListener("storage", function (e) { if (e.key === "phoenix:" + JOBS_KEY) changed(); });
        } catch (x) { /* no window events */ }

        // This page's open jobs: what is not shared (the rendered bytes, the
        // pictures added, the subscriptions of the app printing).
        var open = {};
        function local(id) { alive(); return open[id] || (open[id] = { files: [], status: [], render: [] }); }

        // A job lives in the page that prints it. While that page has jobs it
        // says so every few seconds ("print:alive:<page>"); a job still
        // printing whose page has gone quiet (the card closed, the app
        // crashed) has failed, and a page going away cancels its own.
        var PAGE = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        var ALIVE_EVERY = 4000, QUIET_AFTER = 12000, aliveTimer = null;
        function alive() {
            store.set("print:alive:" + PAGE, Date.now());
            if (!aliveTimer) aliveTimer = setInterval(function () {
                if (Object.keys(open).length) return store.set("print:alive:" + PAGE, Date.now());
                clearInterval(aliveTimer);
                aliveTimer = null;
                try { global.localStorage.removeItem("phoenix:print:alive:" + PAGE); } catch (e) { /* no storage */ }
            }, ALIVE_EVERY);
        }
        function reap() {
            jobs().forEach(function (j) {
                if (j.state !== "Printing" || j.page === PAGE) return;
                if (store.get("print:alive:" + j.page, 0) < Date.now() - QUIET_AFTER)
                    finish(j, "Failed", { errorText: "The app printing it closed" });
            });
        }
        try {
            global.addEventListener("pagehide", function () {
                Object.keys(open).forEach(function (id) {
                    var j = findJob(id);
                    if (j && j.state === "Printing") finish(j, "Cancelled");
                });
                try { global.localStorage.removeItem("phoenix:print:alive:" + PAGE); } catch (e) { /* no storage */ }
            });
        } catch (x) { /* no window events */ }
        function tell(list, x) { list.slice().forEach(function (f) { f(x); }); }
        function subscribeTo(list, ctx, f) {
            list.push(f);
            var prev = ctx.onCancel;
            ctx.onCancel = function () { var i = list.indexOf(f); if (i >= 0) list.splice(i, 1); if (prev) prev(); };
        }
        var statusSubs = [], renderSubs = [];

        function printers() { return [PDF_PRINTER]; }
        function printerById(id) { return printers().filter(function (p) { return p.printerID === id; })[0] || null; }

        function showOngoing(j) {
            host.postToHost("ongoing", { id: "print-" + j.jobID, appId: PRINT_MANAGER, title: "Printing " + (j.description || j.appName || "a document"),
                body: j.pages ? j.pages + (j.pages === 1 ? " page" : " pages") + " to " + j.printerName : "Preparing to print to " + j.printerName,
                progress: j.state === "Printing" && j.pages ? 100 : -1, params: { jobID: j.jobID } });
        }
        function finish(j, state, extra) {
            j.state = state;
            j.finished = Date.now();
            for (var k in extra || {}) j[k] = extra[k];
            saveJob(j);
            host.postToHost("ongoing", { id: "print-" + j.jobID, clear: true });
            tell(statusSubs, { jobID: j.jobID, printerState: "DONE",
                               jobStatus: state === "Done" ? "Success" : state === "Cancelled" ? "Cancelled" : "Error" });
            if (state === "Done")
                host.postToHost("notification", { appId: PRINT_MANAGER, title: "Saved as PDF", body: nameOf(j.file),
                                                  params: { jobID: j.jobID } });
        }
        function nameOf(p) { return String(p || "").replace(/^.*\//, ""); }

        // A free name in the Documents folder: "<title>.pdf", then "<title> (2).pdf".
        function freePath(title) {
            var base = String(title || "Document").replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Document";
            var mf = runtime.mediaFiles;
            function attempt(n) {
                var p = OUT_DIR + "/" + base + (n > 1 ? " (" + n + ")" : "") + ".pdf";
                if (!mf) return Promise.resolve(p);
                return mf.read(p).then(function (b) { return b ? attempt(n + 1) : p; }, function () { return p; });
            }
            return attempt(1);
        }

        function writePdf(j, bytes) {
            if (!runtime.mediaFiles) return Promise.reject(new Error("No place to save the PDF"));
            return freePath(j.description).then(function (path) {
                return runtime.mediaFiles.write(path, new Blob([bytes], { type: "application/pdf" })).then(function () { return path; });
            });
        }

        // ---- A small PDF writer ---------------------------------------------------------
        //
        // pages: [{width, height (points), items: [{image: {jpeg: Uint8Array,
        // width, height (pixels)}, x, y, w, h} | {text, x, y, size}]}].
        // Text is Helvetica in WinAnsi (other characters become "?"); y is
        // from the top of the page.
        function pdf(pages) {
            var chunks = [], offsets = [], length = 0;
            function add(x) {
                var b = typeof x === "string" ? latin1(x) : x;
                chunks.push(b);
                length += b.length;
            }
            function latin1(s) {
                var b = new Uint8Array(s.length);
                for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); b[i] = c < 256 ? c : 63; }
                return b;
            }
            function obj(n, body) { offsets[n] = length; add(n + " 0 obj\n"); body(); add("\nendobj\n"); }
            function esc(s) { return String(s).replace(/[\\()]/g, "\\$&").replace(/[\r\n\t]/g, " "); }
            // 1 catalog, 2 pages, 3 font; then per page: page, content, images.
            var next = 4, kids = [], plan = pages.map(function (pg) {
                var p = { page: next++, content: next++, images: [] };
                pg.items.forEach(function (it) { if (it.image) p.images.push(next++); });
                kids.push(p.page + " 0 R");
                return p;
            });
            add("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
            obj(1, function () { add("<< /Type /Catalog /Pages 2 0 R >>"); });
            obj(2, function () { add("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages.length + " >>"); });
            obj(3, function () { add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); });
            pages.forEach(function (pg, i) {
                var p = plan[i], ops = [], xobj = [], img = 0;
                pg.items.forEach(function (it) {
                    if (it.image) {
                        var name = "Im" + (img + 1);
                        xobj.push("/" + name + " " + p.images[img] + " 0 R");
                        ops.push("q " + it.w.toFixed(2) + " 0 0 " + it.h.toFixed(2) + " " + it.x.toFixed(2) + " " +
                                 (pg.height - it.y - it.h).toFixed(2) + " cm /" + name + " Do Q");
                        img++;
                    } else if (it.text !== undefined) {
                        ops.push("BT /F1 " + it.size + " Tf " + it.x.toFixed(2) + " " + (pg.height - it.y - it.size).toFixed(2) +
                                 " Td (" + esc(it.text) + ") Tj ET");
                    }
                });
                obj(p.page, function () {
                    add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pg.width + " " + pg.height + "] /Contents " + p.content +
                        " 0 R /Resources << /Font << /F1 3 0 R >> /XObject << " + xobj.join(" ") + " >> >> >>");
                });
                var content = ops.join("\n");
                obj(p.content, function () { add("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"); });
                img = 0;
                pg.items.forEach(function (it) {
                    if (!it.image) return;
                    obj(p.images[img++], function () {
                        add("<< /Type /XObject /Subtype /Image /Width " + it.image.width + " /Height " + it.image.height +
                            " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + it.image.jpeg.length + " >>\nstream\n");
                        add(it.image.jpeg);
                        add("\nendstream");
                    });
                });
            });
            var xref = length, count = next;
            var x = "xref\n0 " + count + "\n0000000000 65535 f \n";
            for (var n = 1; n < count; n++) x += ("0000000000" + offsets[n]).slice(-10) + " 00000 n \n";
            add(x + "trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
            var out = new Uint8Array(length), at = 0;
            chunks.forEach(function (c) { out.set(c, at); at += c.length; });
            return out;
        }
        // Pages of a PDF (Chromium's): its page objects.
        function pageCount(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            var m = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
            return m ? m.length : 1;
        }

        function paperOf(j) {
            var size = PAPER[j.params.mediaSize] || PAPER.US_Letter;
            return j.params.landscape ? [size[1], size[0]] : size.slice();
        }
        function insetsOf(j) {
            var p = j.params;
            return { top: (p.topInset || 0) * 72, left: (p.leftInset || 0) * 72, right: (p.rightInset || 0) * 72, bottom: (p.bottomInset || 0) * 72 };
        }

        // A page's text on pages (what a desktop browser can print of it).
        function textPages(j, title, text) {
            var paper = paperOf(j), m = insetsOf(j), size = 11, lead = 14;
            var cols = Math.max(20, Math.floor((paper[0] - m.left - m.right) / (size * 0.5)));
            var rows = Math.max(5, Math.floor((paper[1] - m.top - m.bottom) / lead));
            var lines = [];
            (title ? [title, ""] : []).concat(String(text || "").split(/\r?\n/)).forEach(function (para) {
                para = para.replace(/\s+/g, " ").trim();
                if (!para) { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); return; }
                while (para.length > cols) {
                    var cut = para.lastIndexOf(" ", cols);
                    if (cut <= 0) cut = cols;
                    lines.push(para.slice(0, cut));
                    para = para.slice(cut).trim();
                }
                lines.push(para);
            });
            var pages = [];
            for (var i = 0; i < Math.max(1, lines.length); i += rows) {
                pages.push({ width: paper[0], height: paper[1], items: lines.slice(i, i + rows).map(function (l, k) {
                    return { text: l, x: m.left, y: m.top + k * lead, size: size };
                }) });
            }
            return pdf(pages);
        }

        // A picture as JPEG bytes and its size (through a canvas, so PNG,
        // GIF and WebP print too).
        function jpegOf(path) {
            var url = runtime.fileManager ? runtime.fileManager.url(path) : Promise.resolve(path);
            return url.then(function (u) {
                return new Promise(function (resolve, reject) {
                    var im = new global.Image();
                    im.onload = function () {
                        var c = global.document.createElement("canvas");
                        c.width = im.naturalWidth;
                        c.height = im.naturalHeight;
                        var g = c.getContext("2d");
                        g.fillStyle = "#fff";
                        g.fillRect(0, 0, c.width, c.height);
                        g.drawImage(im, 0, 0);
                        c.toBlob(function (b) {
                            if (!b) return reject(new Error("Could not read " + path));
                            b.arrayBuffer().then(function (buf) {
                                resolve({ jpeg: new Uint8Array(buf), width: c.width, height: c.height });
                            }, reject);
                        }, "image/jpeg", 0.92);
                    };
                    im.onerror = function () { reject(new Error("Could not read " + path)); };
                    im.src = u;
                });
            });
        }
        function imagePages(j, paths) {
            return Promise.all(paths.map(jpegOf)).then(function (images) {
                var m = j.params.borderless ? { top: 0, left: 0, right: 0, bottom: 0 } : insetsOf(j);
                return pdf(images.map(function (im) {
                    var paper = PAPER[j.params.mediaSize] || PAPER.US_Letter;
                    // autoRotate: a landscape picture on a page turned to it.
                    if (j.params.autoRotate !== false && (im.width > im.height) !== (paper[0] > paper[1])) paper = [paper[1], paper[0]];
                    var bw = paper[0] - m.left - m.right, bh = paper[1] - m.top - m.bottom;
                    var s = Math.min(bw / im.width, bh / im.height);
                    var w = im.width * s, h = im.height * s;
                    return { width: paper[0], height: paper[1],
                             items: [{ image: im, x: m.left + (bw - w) / 2, y: m.top + (bh - h) / 2, w: w, h: h }] };
                }));
            });
        }

        // ---- Rendering a document job -----------------------------------------------------

        // A page view (the browser's, Email's) or the app's own window asks
        // to be put on paper. jobs: jobID -> what to do once rendered.
        function render(jobID, how) {
            var j = findJob(jobID);
            if (!j || j.state !== "Printing") return false;
            var L = local(jobID);
            L.title = how.title || "";
            if (!j.description && how.title) { j.description = how.title; saveJob(j); showOngoing(j); }
            var paper = PAPER[j.params.mediaSize] || PAPER.US_Letter;
            var size = paper === PAPER.ISO_A4 ? "A4" : paper === PAPER.US_Legal ? "Legal" : "Letter";
            if (how.host) {
                host.postToHost(how.host.type, { op: "print", id: how.host.id, jobID: jobID, pageSize: size, landscape: !!j.params.landscape });
            } else {
                setTimeout(function () { rendered(jobID, null, { text: how.text, title: how.title }); }, 0);
            }
            return true;
        }
        // A page's HTML put on paper (Email's message, which is a part of its
        // window): in phoenix-sim rendered by Chromium in a page view nobody
        // sees, elsewhere its text.
        function renderHtml(jobID, how) {
            var j = findJob(jobID);
            if (!j || j.state !== "Printing") return false;
            if (!runtime.offscreenWebView) {
                var div = global.document.createElement("div");
                div.innerHTML = String(how.html || "");
                return render(jobID, { title: how.title, text: div.innerText || div.textContent || "" });
            }
            var view = runtime.offscreenWebView(String(how.html || ""), function (id) {
                render(jobID, { title: how.title, host: { type: "webView", id: id } });
            });
            local(jobID).cleanup = view.destroy;
            return true;
        }

        // The rendering is back: a PDF (base64) from the host, or null to
        // print the text instead.
        function rendered(jobID, b64, info) {
            var j = findJob(jobID);
            if (!j) return;
            var L = local(jobID);
            if (L.cleanup) { L.cleanup(); delete L.cleanup; }
            if (j.state !== "Printing") {
                tell(renderSubs, { jobID: jobID, renderResultCode: E.CANCEL_REQUESTED });
                return;
            }
            var bytes;
            try {
                if (b64) {
                    var bin = global.atob(b64);
                    bytes = new Uint8Array(bin.length);
                    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                } else if (info && info.error) {
                    throw new Error(info.error);
                } else {
                    bytes = textPages(j, info && info.title || L.title, info && info.text || "");
                }
            } catch (e) {
                tell(renderSubs, { jobID: jobID, renderResultCode: E.RENDER });
                finish(j, "Failed", { errorText: String(e && e.message || e) });
                return;
            }
            L.pdf = bytes;
            j.pages = pageCount(bytes);
            saveJob(j);
            showOngoing(j);
            for (var n = 1; n <= j.pages; n++) tell(renderSubs, { jobID: jobID, currentPage: n, totalPages: j.pages });
            tell(renderSubs, { jobID: jobID, currentPage: j.pages, totalPages: j.pages, renderResultCode: 0 });
        }

        // ---- The service --------------------------------------------------------------------

        var jobSeq = Date.now() % 100000;
        function newJobId() { return "job" + Date.now().toString(36) + (++jobSeq).toString(36); }
        function needJob(p, reply) {
            var j = findJob(p.jobID);
            if (!j) reply(fail(E.BAD_JOB, "No such print job: " + p.jobID));
            return j;
        }
        function publicJob(j) {
            return { jobID: j.jobID, description: j.description, appName: j.appName, printerID: j.printerID, printerName: j.printerName,
                     state: j.state, pages: j.pages || 0, file: j.file || "", created: j.created, finished: j.finished || 0,
                     errorText: j.errorText || "" };
        }

        var methods = {
            "/printers/list": function (p, reply, ctx) {
                reply(ok({ subscribed: !!p.subscribe }));
                printers().forEach(function (pr) {
                    setTimeout(function () {
                        if (!ctx.cancelled()) reply(ok({ eventType: "Add", printerID: pr.printerID, printerName: pr.printerName, printerAddress: pr.printerAddress }));
                    }, 0);
                });
            },
            "/printers/getCurrent": function (p, reply) {
                var pr = printerById(store.get(CURRENT_KEY, PDF_PRINTER.printerID)) || PDF_PRINTER;
                reply(ok({ printerID: pr.printerID, printerName: pr.printerName, printerAddress: pr.printerAddress }));
            },
            "/printers/setCurrent": function (p, reply) {
                if (!printerById(p.printerID)) return reply(fail(-1, "No such printer: " + p.printerID));
                store.set(CURRENT_KEY, p.printerID);
                reply(ok());
            },
            "/printers/getCapabilities": function (p, reply) {
                if (!printerById(p.printerID)) return reply(fail(-1, "No such printer: " + p.printerID));
                reply(ok({ printerID: p.printerID, mediaSize: ["US_Letter", "ISO_A4", "US_Legal", "Photo_4x6", "Photo_5x7"],
                           mediaType: ["Plain", "Photo"], printQuality: ["Normal", "Best"], canDuplex: false, hasColor: true }));
            },
            "/printers/add": function (p, reply) {
                reply(fail(E.NO_RESPONSE_MANUAL, "There are no network printers in the simulator (on a device: CUPS, IPP Everywhere)"));
            },
            "/jobs/open": function (p, reply) {
                var pr = printerById(p.printerID);
                if (!pr) return reply(fail(-1, "No such printer: " + p.printerID));
                var j = { jobID: newJobId(), printerID: pr.printerID, printerName: pr.printerName, appName: String(p.appName || ""),
                          appId: PalmSystem.appIdentifier || "", page: PAGE, description: String(p.description || ""), state: "Printing",
                          params: {}, created: Date.now(), pages: 0 };
                saveJob(j);
                local(j.jobID);
                showOngoing(j);
                reply(ok({ jobID: j.jobID, subscribed: !!p.subscribe }));
            },
            "/jobs/editPrintParams": function (p, reply) {
                var j = needJob(p, reply);
                if (!j) return;
                for (var k in p) if (k !== "jobID") j.params[k] = p[k];
                saveJob(j);
                reply(ok({ jobID: j.jobID }));
            },
            "/jobs/getFinalParamsAndArea": function (p, reply) {
                var j = needJob(p, reply);
                if (!j) return;
                var paper = paperOf(j), m = insetsOf(j);
                reply(ok({ jobID: j.jobID, width: Math.round((paper[0] - m.left - m.right) / 72 * DPI),
                           height: Math.round((paper[1] - m.top - m.bottom) / 72 * DPI), pixelUnits: DPI,
                           renderInReverseOrder: false, mediaSize: j.params.mediaSize || "US_Letter",
                           numCopies: j.params.numCopies || 1, color: j.params.color || "Color" }));
            },
            "/jobs/getStatus": function (p, reply, ctx) {
                reply(ok({ subscribed: !!p.subscribe }));
                if (p.subscribe) subscribeTo(statusSubs, ctx, function (x) { if (!ctx.cancelled()) reply(ok(x)); });
            },
            "/jobs/getRenderStatus": function (p, reply, ctx) {
                reply(ok({ subscribed: !!p.subscribe }));
                if (p.subscribe) subscribeTo(renderSubs, ctx, function (x) { if (!ctx.cancelled()) reply(ok(x)); });
            },
            "/jobs/addFile": function (p, reply) {
                var j = needJob(p, reply);
                if (!j) return;
                if (!p.pathName) return reply(fail(-1, "pathName is required"));
                local(j.jobID).files.push(String(p.pathName));
                reply(ok({ jobID: j.jobID }));
            },
            "/jobs/close": function (p, reply) {
                var j = needJob(p, reply);
                if (!j) return;
                if (j.state !== "Printing") return reply(ok({ jobID: j.jobID }));
                var L = local(j.jobID);
                var bytes = L.pdf ? Promise.resolve(L.pdf) : L.files.length ? imagePages(j, L.files) : null;
                if (!bytes) {
                    finish(j, "Failed", { errorText: "Nothing was printed" });
                    return reply(ok({ jobID: j.jobID }));
                }
                bytes.then(function (b) {
                    if (!L.pdf) j.pages = pageCount(b);
                    return writePdf(j, b);
                }).then(function (path) {
                    finish(j, "Done", { file: path });
                    delete open[j.jobID];
                    reply(ok({ jobID: j.jobID }));
                }, function (e) {
                    finish(j, "Failed", { errorText: String(e && e.message || e) });
                    reply(fail(E.RENDER, String(e && e.message || e)));
                });
            },
            "/jobs/cancel": function (p, reply) {
                var j = needJob(p, reply);
                if (!j) return;
                if (j.state === "Printing") finish(j, "Cancelled");
                delete open[j.jobID];
                reply(ok({ jobID: j.jobID }));
            },
            "/jobs/list": function (p, reply, ctx) {
                var send = function () { if (!ctx.cancelled()) reply(ok({ jobs: jobs().map(publicJob), subscribed: !!p.subscribe })); };
                reap();
                send();
                if (p.subscribe) {
                    listen(ctx, send);
                    // A page printing may go quiet while the list is open.
                    var t = setInterval(function () { if (ctx.cancelled()) clearInterval(t); else reap(); }, QUIET_AFTER / 2);
                    var prev = ctx.onCancel;
                    ctx.onCancel = function () { clearInterval(t); if (prev) prev(); };
                }
            },
            "/jobs/remove": function (p, reply) {
                var j = needJob(p, reply);
                if (!j) return;
                if (j.state === "Printing") return reply(fail(-1, "The job is still printing; cancel it first"));
                store.set(JOBS_KEY, jobs().filter(function (x) { return x.jobID !== j.jobID; }));
                changed();
                reply(ok());
            }
        };
        register([SERVICE], methods);

        // A job cancelled elsewhere (the Print Manager) stops here too.
        listeners.push(function () {
            Object.keys(open).forEach(function (id) {
                var j = findJob(id);
                if (!j || j.state === "Cancelled") {
                    tell(statusSubs, { jobID: id, printerState: "DONE", jobStatus: "Cancelled" });
                    tell(renderSubs, { jobID: id, renderResultCode: E.CANCEL_REQUESTED });
                    delete open[id];
                }
            });
        });

        // PrintJob launches the Print Manager headless for its status
        // dashboard; here the job's ongoing activity is that dashboard.
        var am = runtime.services["com.palm.applicationManager"];
        if (am) {
            var baseOpen = am["/open"];
            am["/open"] = function (p, reply, ctx) {
                // (No process runs for it: no processId.)
                if (p.id === "com.palm.app.printmanager" && p.params && p.params.runHeadless)
                    return reply(ok({ appId: PRINT_MANAGER }));
                baseOpen(p, reply, ctx);
            };
        }

        runtime.print = { render: render, renderHtml: renderHtml, rendered: rendered, pdf: pdf, jobs: jobs };
    })();

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
    // server/updates/bin/updates.php simulator makes one, or the catalog
    // server's admin API: POST /api/admin/updates?compatible=phoenix-sim).
    // The feed is the catalog server's (/etc/palm/updates.json:
    // http://127.0.0.1:8088/updates/, server/marketplace). Installing writes
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
            store.set("boot:count", (store.get("boot:count", 0) || 0) + 1);
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
    //   org.webosphoenix.filepicker/pick {kinds?: ["image" | "video" |
    //       "audio" | "document" | "file"] (default ["image"]), multiple?,
    //       cropWidth?, cropHeight?, extensions?, title?} -> {files:
    //       [{fullPath, mimeType, name, size?, cropInfo?, croppedPath?}]} or
    //       {canceled: true}: the user picks (SF2): pictures album by album,
    //       videos, music, documents, or any file folder by folder; with
    //       several kinds, the kind first, as the original. A crop size
    //       (one picture) shows the crop view: cropInfo as Enyo's
    //       CroppableImage gave it, and croppedPath the crop at that size.
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
        // What the picker picks: the original's kinds (FilePickerApp.js:39-45,
        // ringtones aside), and "file", any file of the USB drive by folder.
        var PICK_KINDS = ["image", "video", "audio", "document", "file"];

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
        // The sheet's messages are the runtime's alone: taken first (this
        // listener is added before the page's scripts run) and kept from
        // the page's own listeners. Enyo 1's (windows/manager.js:156-158,
        // CrossAppUI.js:110, Dashboard.js:137) read every message's data
        // as a string and threw on these objects.
        global.addEventListener("message", function (e) {
            var m = e.data;
            // Only the messages of a sheet this page opened (the sheet's own
            // page runs this runtime too, and its messages are its page's).
            if (!m || typeof m !== "object" || !open || m.phoenixSheet !== open.id)
                return;
            e.stopImmediatePropagation();
            onMessage(e);
        }, true);
        function showSheet(kind, request) {
            if (open) closeSheet({ action: "cancel" });
            return new Promise(function (resolve) {
                var id = "sheet" + (++seq) + "_" + Date.now();
                var frame = doc.createElement("iframe");
                frame.setAttribute("data-phoenix-sheet", kind);
                frame.setAttribute("title", kind === "save" ? "Save to Files" : kind === "pick" ? request.title || "Choose a File" : "Share");
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

        // The app menu's Share (and anything else in the page): the sheet.
        runtime.share = function (content) {
            return callP("luna://org.webosphoenix.share/open", content || {});
        };

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
                        // Every file shared (Files shares several), one by
                        // one; those Photos has already stay where they are.
                        var saved = [], already = true;
                        var chain = s.files.reduce(function (prev, f) {
                            return prev.then(function () {
                                if (inPhotos(f.path) && f.path.indexOf(MEDIA + "/samples/") !== 0) { saved.push(f.path); return; }
                                already = false;
                                var dest = CAMERA_DIR + "/" + f.path.replace(/^.*\//, "");
                                return writeTo(dest, { from: f.path }, false).then(function () { saved.push(dest); });
                            });
                        }, Promise.resolve());
                        return chain.then(function () {
                            var res = { action: "photos", path: saved[0], paths: saved };
                            if (already) res.already = true;
                            reply(ok(res));
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
            // SF2, with the original picker's parameters (enyo.FilePicker
            // published: fileType, extensions, allowMultiSelect, cropWidth,
            // cropHeight; luna-systemui FilePickerApp.js:39-45 its kinds).
            "/pick": function (p, reply) {
                var kinds = (p.kinds && p.kinds.length ? p.kinds : ["image"]).map(String);
                var bad = kinds.filter(function (k) { return PICK_KINDS.indexOf(k) < 0; });
                if (bad.length) return reply(fail(-1, "Unknown kinds " + bad.join(", ") + ": " + PICK_KINDS.join(", ")));
                var multiple = !!(p.multiple || p.allowMultiSelect);
                var cw = Number(p.cropWidth) || 0, ch = Number(p.cropHeight) || 0;
                // A crop size is for one picture (ImagePicker.js:56-60 crops
                // only what a tap picks): either side alone makes a square.
                var crop = (cw > 0 || ch > 0) && kinds.indexOf("image") >= 0 && !multiple
                    ? { width: Math.round(cw || ch), height: Math.round(ch || cw) } : null;
                var exts = (p.extensions || []).map(function (e) { return String(e).replace(/^\./, "").toLowerCase(); });
                var title = p.title || (kinds.length === 1 && kinds[0] === "image" ? (multiple ? "Choose Pictures" : "Choose a Picture")
                                                                                   : (multiple ? "Choose Files" : "Choose a File"));
                showSheet("pick", { title: title, kinds: kinds, multiple: multiple, crop: crop, extensions: exts }).then(function (r) {
                    if (!r || r.action !== "pick" || !r.files || !r.files.length) return reply(ok({ canceled: true }));
                    var files = r.files.map(function (f) {
                        var o = { fullPath: f.path, mimeType: f.mimeType || "", name: f.path.replace(/^.*\//, "") };
                        if (f.size !== undefined) o.size = f.size;
                        if (f.cropInfo) o.cropInfo = f.cropInfo;
                        return o;
                    });
                    var first = files[0];
                    if (!crop || !first.cropInfo) return reply(ok({ files: files }));
                    // The crop made, at the size asked, as the apps of the
                    // time made it with com.palm.image/convert (ContactPhoto.js:240-251).
                    var dest = "/var/file-cache/filepicker/" + Date.now().toString(36) + "/" +
                        first.name.replace(/\.[^.]*$/, "") + ".jpg";
                    callP("luna://com.palm.image/convert", {
                        src: first.fullPath, dest: dest, destType: "jpg", focusX: first.cropInfo.focusX, focusY: first.cropInfo.focusY,
                        scale: crop.width / first.cropInfo.suggestedXsize, cropW: crop.width, cropH: crop.height
                    }).then(function (c) {
                        if (c.returnValue !== false) first.croppedPath = dest;
                        reply(ok({ files: files }));
                    });
                });
            },
            "/save": function (p, reply) {
                if (!p.name) return reply(fail(-1, "name is required"));
                if (p.data === undefined && !p.from) return reply(fail(-1, "from (a path) or data (base64) is required"));
                save(p).then(function (r) { reply(ok(r)); }, function (e) { reply(fail(-1, String(e && e.message || e))); });
            }
        });
    })();

    // ================================================================================
    // DropShare (org.webosphoenix.dropshare; apps/dropshare)
    // ================================================================================
    //
    // docs/M6-PLAN.md F4 item 8, docs/APP-RUNTIME.md "DropShare": Phoenix's
    // own take on the webOS Archive's LuneDrop, as an extension of Touch to
    // Share. The device serves a page on the local network, with a one-time
    // token in its address, which any phone or computer opens (the QR code
    // the DropShare app shows); there they upload files to the device, or
    // download the ones it offers. phoenix-sim runs the server
    // (shell/sim/simdropshare.h) and this block drives it through
    // /__phoenix/dropshare; a device runs it as a service. Off until the
    // user allows it (system preference dropShareEnabled; Settings >
    // DropShare).
    //
    //   receive {subscribe}  -> {url, state, files: [{name, size, received,
    //       done, saved (the path in Downloads)}]} as it changes: files
    //       uploaded land in /media/internal/Downloads (a second of a name
    //       is numbered), with an ongoing activity while they come and a
    //       notification once in (a tap opens Files at Downloads).
    //   send {files: [{path, mimeType?}], subscribe} -> {url, state, files:
    //       [{name, size, downloads}]}: the other device downloads them.
    //   stop {}  ends the session; so does the subscriber going away.
    //   states: waiting, transferring, done, timeout (ten minutes without a
    //   request), stopped, failed.
    (function dropShare() {
        var SERVICE = "org.webosphoenix.dropshare", APP = "org.webosphoenix.dropshare";
        var DOWNLOADS = "/media/internal/Downloads";
        var session = null;     // {mode, url, reply, ctx, timer, saved: {id: path}, taking: {}, files}

        function nativeCall(req) {
            try {
                var x = new XMLHttpRequest();
                x.open("GET", "/__phoenix/dropshare?req=" + encodeURIComponent(toJson(req)), false);
                x.send();
                var r = JSON.parse(x.responseText || "null");
                return r && typeof r === "object" ? r : null;
            } catch (e) {
                return null;
            }
        }
        function callP(url, params) {
            return new Promise(function (resolve) {
                dispatch(url, params || {}, resolve, { cancelled: function () { return false; }, onCancel: null });
            });
        }
        function enabled() {
            var r = callNow("luna://com.webos.service.systemservice/getPreferences", { keys: ["dropShareEnabled"] });
            return !!(r && r.dropShareEnabled);
        }
        function sizeOf(n) {
            if (n < 1024) return n + " B";
            if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
            return (n / (1024 * 1024)).toFixed(1) + " MB";
        }
        // A free name in Downloads: "photo (2).jpg" after "photo.jpg".
        function freePath(name) {
            var dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
            var tryN = function (n) {
                var path = DOWNLOADS + "/" + (n === 1 ? name : base + " (" + n + ")" + ext);
                return callP("luna://org.webosphoenix.filemanager/stat", { path: path }).then(function (r) {
                    return r.returnValue === false ? path : tryN(n + 1);
                });
            };
            return tryN(1);
        }
        function readBytes(id) {
            return new Promise(function (resolve, reject) {
                var x = new XMLHttpRequest();
                x.open("GET", "/__phoenix/dropshare/file?id=" + id, true);
                x.responseType = "blob";
                x.onload = function () { resolve(x.response); };
                x.onerror = function () { reject(new Error("The file could not be read")); };
                x.send();
            });
        }
        // A file uploaded: into Downloads, where Files (and Photos, for a
        // picture) find it.
        function take(s, f) {
            s.taking[f.id] = true;
            readBytes(f.id).then(function (blob) {
                if (!runtime.mediaFiles) throw new Error("No media store");
                return freePath(f.name).then(function (path) {
                    var typed = blob.type || !f.type ? blob : blob.slice(0, blob.size, f.type);
                    return runtime.mediaFiles.write(path, typed).then(function () { return path; });
                });
            }).then(function (path) {
                s.saved[f.id] = path;
                nativeCall({ op: "take", id: f.id });
                return callP("luna://com.webos.service.mediaindexer/requestMediaScan", { path: DOWNLOADS });
            }, function (e) {
                console.warn("[phoenix-runtime] DropShare: " + (e && e.message || e));
                s.failed = (s.failed || 0) + 1;
            }).then(function () { delete s.taking[f.id]; report(s); });
        }
        function view(s, st) {
            var files = (st.files || s.files || []).map(function (f) {
                return { id: f.id, name: f.name, type: f.type, size: f.size, received: f.received, done: !!f.done,
                         downloads: f.downloads || 0, saved: s.saved[f.id] || "" };
            });
            if (s.mode === "send" && !files.length) files = s.lastFiles || [];
            else s.lastFiles = files;
            // Done sending means every file went (the server forgets them then).
            if (s.mode === "send" && st.state === "done")
                files = files.map(function (f) { var x = {}, k; for (k in f) x[k] = f[k]; x.downloads = Math.max(1, f.downloads); return x; });
            return ok({ mode: s.mode, url: s.ended ? "" : s.url, state: st.state || "stopped", files: files });
        }
        function report(s) {
            var st = s.last || {};
            var v = view(s, st);
            if (s.reply && !(s.ctx && s.ctx.cancelled())) s.reply(v);
            ongoing(s, v);
        }
        function ongoing(s, v) {
            if (s.mode !== "receive") return;
            var coming = v.files.filter(function (f) { return !f.saved; });
            if (v.state === "transferring" && coming.length) {
                var f = coming[0];
                host.postToHost("ongoing", { id: "dropshare", appId: APP, title: "DropShare",
                    body: "Receiving " + f.name + (f.size ? " (" + sizeOf(f.received || 0) + " of " + sizeOf(f.size) + ")" : ""),
                    icon: "", params: null, progress: f.size ? Math.min(100, Math.floor((f.received || 0) * 100 / f.size)) : -1 });
                s.showing = true;
            } else if (s.showing) {
                host.postToHost("ongoing", { id: "dropshare", clear: true });
                s.showing = false;
            }
            // All in: one notification, a tap opens Files at Downloads.
            var saved = v.files.filter(function (x) { return x.saved; });
            if (!coming.length && saved.length > (s.notified || 0) && (v.state === "done" || v.state === "timeout" || v.state === "stopped" || v.state === "waiting")) {
                var n = saved.length - (s.notified || 0);
                s.notified = saved.length;
                host.postToHost("notification", { appId: "org.webosphoenix.files", title: "DropShare",
                    body: n === 1 ? saved[saved.length - 1].name + " is in Downloads" : n + " files are in Downloads",
                    params: { path: DOWNLOADS }, soundClass: "notifications" });
            }
        }
        function poll(s) {
            if (session !== s) return;
            if (s.ctx && s.ctx.cancelled()) return end(s, true);
            var st = nativeCall({ op: "status" });
            if (!st) return;
            s.last = st;
            if (s.mode === "receive")
                (st.files || []).forEach(function (f) {
                    if (f.done && !f.taken && !s.saved[f.id] && !s.taking[f.id]) take(s, f);
                });
            var key = toJson(st) + toJson(s.saved);
            if (key !== s.key) { s.key = key; report(s); }
            var over = st.state !== "waiting" && st.state !== "transferring";
            if (over && !Object.keys(s.taking).length && (s.mode !== "receive" || (st.files || []).every(function (f) { return !f.done || s.saved[f.id] || f.taken; }))) {
                s.ended = true;
                report(s);
                session = null;
                return;
            }
            s.timer = setTimeout(function () { poll(s); }, 400);
        }
        function end(s, quietly) {
            if (session === s) session = null;
            clearTimeout(s.timer);
            nativeCall({ op: "stop" });
            if (s.showing) host.postToHost("ongoing", { id: "dropshare", clear: true });
            if (!quietly) { s.ended = true; s.last = { state: "stopped", files: (s.last && s.last.files) || [] }; report(s); }
        }
        function begin(mode, p, reply, ctx, start) {
            if (!enabled()) return reply(fail(-1, "DropShare is off. Turn it on in Settings > DropShare."));
            if (session) end(session, true);
            Promise.resolve(start()).then(function (r) {
                if (!r || r.returnValue === false)
                    return reply(fail(-1, (r && r.errorText) || "DropShare needs the simulator or a device: this page has no server"));
                var s = session = { mode: mode, url: r.url, reply: p.subscribe ? reply : null, ctx: ctx, saved: {}, taking: {},
                                    files: r.files || [] };
                s.last = { state: "waiting", files: s.files };
                if (!p.subscribe) reply(view(s, s.last));
                else report(s);
                poll(s);
            }, function (e) { reply(fail(-1, String(e && e.message || e))); });
        }
        // The bytes of a file to send, from wherever the system keeps it.
        function bytesOf(path) {
            var mf = runtime.mediaFiles;
            return Promise.resolve(mf ? mf.read(path) : null).then(function (blob) {
                if (blob) return blob;
                return fetch(path).then(function (r) { if (!r.ok) throw new Error("Cannot read " + path); return r.blob(); });
            });
        }
        // A file to send, handed to the server in parts (base64 in the
        // request: the scheme handler cannot read a large request body).
        var PART = 192 * 1024;
        function nativeAsync(req) {
            return new Promise(function (resolve) {
                var x = new XMLHttpRequest();
                x.open("GET", "/__phoenix/dropshare?req=" + encodeURIComponent(toJson(req)), true);
                x.onload = function () { var r = null; try { r = JSON.parse(x.responseText); } catch (e) { r = null; } resolve(r); };
                x.onerror = function () { resolve(null); };
                x.send();
            });
        }
        function base64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; i += 0x8000)
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return btoa(s);
        }
        function offer(f) {
            var name = String(f.path).replace(/^.*\//, "");
            return bytesOf(f.path).then(function (blob) {
                return new Promise(function (resolve, reject) {
                    var r = new FileReader();
                    r.onload = function () { resolve({ blob: blob, bytes: new Uint8Array(r.result) }); };
                    r.onerror = function () { reject(new Error("Cannot read " + f.path)); };
                    r.readAsArrayBuffer(blob);
                });
            }).then(function (b) {
                var type = f.mimeType || b.blob.type || "";
                return nativeAsync({ op: "offerBegin", name: name, type: type, size: b.bytes.length }).then(function (r) {
                    if (!r || !r.returnValue) throw new Error((r && r.errorText) || "DropShare needs the simulator or a device: this page has no server");
                    var id = r.id, at = 0;
                    var next = function () {
                        if (at >= b.bytes.length) return nativeAsync({ op: "offerEnd", id: id });
                        var part = b.bytes.subarray(at, at + PART);
                        at += part.length;
                        return nativeAsync({ op: "offerPart", id: id, data: base64(part) }).then(function (p) {
                            if (!p || !p.returnValue) throw new Error("The file could not be handed over");
                            return next();
                        });
                    };
                    return next().then(function (e) {
                        if (!e || !e.returnValue) throw new Error("The file could not be handed over");
                        return { id: id, name: name, type: type, size: b.bytes.length, downloads: 0 };
                    });
                });
            });
        }

        // The page going (its card closed) ends its session: nobody shows
        // the address any more. (Ten minutes without use end it anyway.)
        // A synchronous request is refused while a page goes: a keepalive
        // fetch takes the stop to the server.
        if (global.addEventListener)
            global.addEventListener("pagehide", function () {
                if (!session) return;
                var s = session;
                session = null;
                clearTimeout(s.timer);
                try { global.fetch("/__phoenix/dropshare?req=" + encodeURIComponent(toJson({ op: "stop" })), { keepalive: true }); }
                catch (e) { /* the server's ten minutes end it */ }
            });

        register([SERVICE], {
            "/receive": function (p, reply, ctx) {
                begin("receive", p, reply, ctx, function () { return nativeCall({ op: "start", mode: "receive" }); });
            },
            "/send": function (p, reply, ctx) {
                var files = (p.files || []).filter(function (f) { return f && f.path; });
                if (!files.length) return reply(fail(-1, "files: [{path}] is required"));
                begin("send", p, reply, ctx, function () {
                    // One after another, in order, then the session.
                    var offered = [];
                    return files.reduce(function (chain, f) {
                        return chain.then(function () { return offer(f).then(function (o) { offered.push(o); }); });
                    }, Promise.resolve()).then(function () {
                        var r = nativeCall({ op: "start", mode: "send" });
                        if (r && r.returnValue) r.files = offered;
                        return r;
                    });
                });
            },
            "/stop": function (p, reply) {
                if (session) end(session, false);
                else nativeCall({ op: "stop" });
                reply(ok());
            },
            "/getStatus": function (p, reply) {
                reply(session ? view(session, session.last || {}) : ok({ state: "off", url: "", files: [] }));
            }
        });
    })();

    // ================================================================================
    // Accessories, tethering and the battery's use (docs/M6-PLAN.md F4 items 8-9)
    // ================================================================================
    //
    // Phoenix's services for Settings > Game Controllers, USB, Hotspot &
    // Tethering and Battery. In the simulator the hardware is phoenix-sim's
    // (its Simulate menu: a game controller, a USB drive in the device's
    // port; the app in front, for the battery's use), which reaches the
    // pages as shell status (hostStatusHooks). On a device each is a small
    // service on the system's own: see docs/APP-RUNTIME.md "Accessories".
    //
    //   org.webosphoenix.gamepads/list {subscribe} -> {gamepads: [{index,
    //       id, name, connection, mapping, buttons: [pressed indexes], axes}]}:
    //       the controllers the Gamepad API sees (Chromium's own, from the
    //       computer's) and the simulator's. Web apps get the simulator's
    //       through navigator.getGamepads() and gamepadconnected /
    //       gamepaddisconnected events too.
    //   org.webosphoenix.usb/listDrives {subscribe} -> {drives: [{id, label,
    //       vendor, size, used, fs, mounted, path, safeToRemove}]};
    //       unmount {id} (safe removal), mount {id}.
    //   org.webosphoenix.tethering/getStatus {subscribe} -> {available,
    //       wifi: {enabled, ssid, passphrase, security, clients}, usb:
    //       {enabled, connected}}; setWifi {enabled?, ssid?, passphrase?,
    //       security? ("wpa2" | "open")}; setUsb {enabled}.
    //   org.webosphoenix.battery/usage {subscribe} -> {percent, charging,
    //       history: [{t, percent}] (the last 24 hours), screenOnMs, apps:
    //       [{appId, title, ms, share}] (estimates from the time each app
    //       was in front with the screen on), since}.
    (function accessories() {
        runtime.hostStatusHooks = runtime.hostStatusHooks || [];
        var hooks = runtime.hostStatusHooks;
        function watchers() {
            var list = [];
            return {
                add: function (p, reply, ctx, build) {
                    reply(build());
                    if (p.subscribe) list.push({ reply: reply, ctx: ctx, build: build });
                },
                fire: function () {
                    list = list.filter(function (w) { return !w.ctx.cancelled(); });
                    list.forEach(function (w) { w.reply(w.build()); });
                }
            };
        }

        // ---- Game controllers ---------------------------------------------------------
        var simPads = [];
        var padWatch = watchers();
        var nav = global.navigator;
        var nativeGetGamepads = nav && typeof nav.getGamepads === "function" ? nav.getGamepads.bind(nav) : null;
        function gamepadObject(p, slot) {
            var buttons = [];
            for (var i = 0; i < 17; i++) {
                var on = (p.buttons || []).indexOf(i) >= 0;
                buttons.push({ pressed: on, touched: on, value: on ? 1 : 0 });
            }
            return { id: p.id, index: slot, connected: true, mapping: p.mapping || "standard", timestamp: p.at || 0,
                     axes: (p.axes || [0, 0, 0, 0]).slice(), buttons: buttons, vibrationActuator: null, phoenixSimulated: true };
        }
        function allPads() {
            var real = [];
            try { real = nativeGetGamepads ? Array.prototype.slice.call(nativeGetGamepads()) : []; } catch (e) { real = []; }
            var out = real.slice();
            while (out.length < 4) out.push(null);
            simPads.forEach(function (p) {
                var slot = out.indexOf(null);
                if (slot < 0) { slot = out.length; out.push(null); }
                out[slot] = gamepadObject(p, slot);
            });
            return out;
        }
        if (nav) {
            try {
                Object.defineProperty(nav, "getGamepads", { configurable: true, value: function () { return allPads(); } });
            } catch (e) { /* the page keeps Chromium's */ }
        }
        function padEvent(type, pad) {
            if (!global.dispatchEvent) return;
            var e;
            try { e = new Event(type); } catch (x) { return; }
            e.gamepad = pad;
            global.dispatchEvent(e);
        }
        hooks.push(function (st) {
            if (!("gamepads" in st)) return;
            var before = simPads.map(function (p) { return p.id; });
            simPads = (st.gamepads || []).map(function (p) { var x = {}, k; for (k in p) x[k] = p[k]; x.at = Date.now(); return x; });
            var now = simPads.map(function (p) { return p.id; });
            var pads = allPads();
            now.forEach(function (id) {
                if (before.indexOf(id) < 0) padEvent("gamepadconnected", pads.filter(function (g) { return g && g.id === id; })[0]);
            });
            before.forEach(function (id) {
                if (now.indexOf(id) < 0) padEvent("gamepaddisconnected", { id: id, connected: false });
            });
            padWatch.fire();
        });
        function padList() {
            var sims = {};
            simPads.forEach(function (p) { sims[p.id] = p; });
            return ok({ gamepads: allPads().filter(Boolean).map(function (g) {
                var sim = sims[g.id];
                var name = sim ? sim.name : String(g.id).replace(/\s*\(.*$/, "") || "Game controller";
                return { index: g.index, id: g.id, name: name, connection: sim ? sim.connection : "",
                         mapping: g.mapping, axes: Array.prototype.slice.call(g.axes || []),
                         buttons: Array.prototype.map.call(g.buttons || [], function (b, i) { return b.pressed ? i : -1; })
                             .filter(function (i) { return i >= 0; }) };
            }) });
        }
        if (global.addEventListener) {
            global.addEventListener("gamepadconnected", function (e) { if (!(e.gamepad && e.gamepad.phoenixSimulated)) padWatch.fire(); });
            global.addEventListener("gamepaddisconnected", function () { padWatch.fire(); });
        }
        register(["org.webosphoenix.gamepads"], {
            "/list": function (p, reply, ctx) { padWatch.add(p, reply, ctx, padList); }
        });

        // ---- USB drives (host mode, OTG) ----------------------------------------------
        var drives = [];
        var usbWatch = watchers();
        function driveState() { return store.get("usbDriveState", {}); }
        function driveList() {
            var stt = driveState();
            return ok({ drives: drives.map(function (d) {
                var x = {}, k;
                for (k in d) x[k] = d[k];
                var mounted = !(stt[d.id] && stt[d.id].unmounted);
                x.mounted = mounted;
                x.safeToRemove = !mounted;
                x.path = mounted ? "/media/usb/" + (d.label || d.id) : "";
                return x;
            }) });
        }
        hooks.push(function (st, writer) {
            if (!("usbDrives" in st)) return;
            var before = drives.map(function (d) { return d.id; });
            drives = (st.usbDrives || []).slice();
            var now = drives.map(function (d) { return d.id; });
            // A drive put in again is mounted again.
            var stt = driveState(), dirty = false;
            Object.keys(stt).forEach(function (id) { if (now.indexOf(id) < 0) { delete stt[id]; dirty = true; } });
            if (dirty && writer) store.set("usbDriveState", stt);
            // A drive put in: the notification (one page tells it).
            if (writer) drives.forEach(function (d) {
                if (before.indexOf(d.id) < 0)
                    host.postToHost("notification", { appId: "org.webosphoenix.settings", title: (d.label || "USB drive") + " connected",
                        body: "Tap to see it or remove it safely", params: { page: "usb" } });
            });
            usbWatch.fire();
        });
        function setMounted(id, mounted, reply) {
            if (!drives.some(function (d) { return d.id === id; })) return reply(fail(-1, "No such drive: " + id));
            var stt = driveState();
            stt[id] = { unmounted: !mounted };
            store.set("usbDriveState", stt);
            usbWatch.fire();
            reply(ok(driveList()));
        }
        register(["org.webosphoenix.usb"], {
            "/listDrives": function (p, reply, ctx) { usbWatch.add(p, reply, ctx, driveList); },
            // Safe removal: the drive's file systems are written out and let go.
            "/unmount": function (p, reply) { setMounted(String(p.id || ""), false, reply); },
            "/mount": function (p, reply) { setMounted(String(p.id || ""), true, reply); }
        });

        // ---- Hotspot and tethering ------------------------------------------------------
        var tetherWatch = watchers();
        var formFactor = "";
        function tetherState() {
            var t = store.get("tethering", {});
            return { wifi: { enabled: !!(t.wifi && t.wifi.enabled), ssid: (t.wifi && t.wifi.ssid) || "Phoenix Hotspot",
                             passphrase: (t.wifi && t.wifi.passphrase) || "", security: (t.wifi && t.wifi.security) === "open" ? "open" : "wpa2" },
                     usb: { enabled: !!(t.usb && t.usb.enabled) } };
        }
        function tetherStatus() {
            var t = tetherState();
            t.available = formFactor !== "tablet";
            t.wifi.clients = t.wifi.enabled ? [] : [];
            t.usb.connected = !!store.get("usbHost", false);
            return ok(t);
        }
        function tetherOngoing(t) {
            var on = [];
            if (t.wifi.enabled) on.push("Wi-Fi hotspot “" + t.wifi.ssid + "”");
            if (t.usb.enabled) on.push("USB tethering");
            if (on.length)
                host.postToHost("ongoing", { id: "tethering", appId: "org.webosphoenix.settings", title: "Sharing your mobile data",
                    body: on.join(" and ") + " on", icon: "", params: { page: "hotspot" }, progress: -1 });
            else host.postToHost("ongoing", { id: "tethering", clear: true });
        }
        hooks.push(function (st) {
            if ("formFactor" in st) { formFactor = String(st.formFactor || ""); tetherWatch.fire(); }
            if ("usbHost" in st) tetherWatch.fire();
        });
        function saveTether(t) {
            store.set("tethering", { wifi: { enabled: t.wifi.enabled, ssid: t.wifi.ssid, passphrase: t.wifi.passphrase, security: t.wifi.security },
                                     usb: { enabled: t.usb.enabled } });
            tetherOngoing(t);
            tetherWatch.fire();
        }
        register(["org.webosphoenix.tethering"], {
            "/getStatus": function (p, reply, ctx) { tetherWatch.add(p, reply, ctx, tetherStatus); },
            "/setWifi": function (p, reply) {
                if (formFactor === "tablet") return reply(fail(-1, "This device has no mobile data to share"));
                var t = tetherState();
                if (p.ssid !== undefined) {
                    var ssid = String(p.ssid).trim();
                    if (!ssid || ssid.length > 32) return reply(fail(-1, "The network name has 1 to 32 characters"));
                    t.wifi.ssid = ssid;
                }
                if (p.security !== undefined) t.wifi.security = p.security === "open" ? "open" : "wpa2";
                if (p.passphrase !== undefined) t.wifi.passphrase = String(p.passphrase);
                if (t.wifi.security === "wpa2" && (p.enabled || t.wifi.enabled) && !(t.wifi.passphrase.length >= 8 && t.wifi.passphrase.length <= 63))
                    return reply(fail(-1, "The password has 8 to 63 characters"));
                if (p.enabled !== undefined) t.wifi.enabled = !!p.enabled;
                saveTether(t);
                reply(tetherStatus());
            },
            "/setUsb": function (p, reply) {
                if (formFactor === "tablet") return reply(fail(-1, "This device has no mobile data to share"));
                var t = tetherState();
                t.usb.enabled = !!p.enabled;
                saveTether(t);
                reply(tetherStatus());
            }
        });

        // ---- The battery's use ---------------------------------------------------------
        // The level over time (each change powerd reports) and how long each
        // app was in front with the screen on (the shell's usageTick), kept
        // for a day. The estimate gives each app its share of the screen-on
        // time: the screen is most of a phone's drain.
        var DAY = 24 * 3600 * 1000;
        var batteryWatch = watchers();
        runtime.recordBattery = function (st) {
            var h = store.get("batteryHistory", []), now = Date.now();
            var last = h[h.length - 1];
            if (last && last.percent === st.percent && !!last.charging === (st.charger !== "none")) return;
            h.push({ t: now, percent: st.percent, charging: st.charger !== "none" });
            store.set("batteryHistory", h.filter(function (x) { return now - x.t <= DAY; }));
            batteryWatch.fire();
        };
        hooks.push(function (st, writer) {
            if (!st.usageTick || !writer) return;
            var u = store.get("batteryUsage", { since: Date.now(), screenOnMs: 0, apps: {}, log: [] });
            var tick = st.usageTick, now = tick.at || Date.now();
            u.log = (u.log || []).concat([{ t: now, appId: tick.appId || "", ms: tick.ms }]).filter(function (x) { return now - x.t <= DAY; });
            store.set("batteryUsage", u);
            batteryWatch.fire();
        });
        // A card's app is an app or one of its launch points (Settings' panes).
        function appTitle(id) {
            var lp = launchPoints().filter(function (l) { return l.launchPointId === id || l.id === id; })[0];
            return lp ? lp.title : id;
        }
        // SIMULATOR-ONLY DEMO DATA, as runtime/sample-data.js: the first
        // time the pane is asked, a day of the device's use so far (charged
        // overnight, then down to the battery's level now; the apps a
        // morning uses), so the charts have something to show. Never on a
        // device, where the system keeps the real thing.
        function seedDemo() {
            if (store.get("batteryDemo", false)) return;
            store.set("batteryDemo", true);
            var now = Date.now(), H = 3600 * 1000, level = powerState().percent;
            var h = [];
            for (var i = 0; i <= 4; i++) h.push({ t: now - (22 - i) * H, percent: Math.round(30 + i * 17.5), charging: true });
            for (i = 0; i <= 17; i++) h.push({ t: now - (17 - i) * H - 30 * 60 * 1000, percent: Math.round(100 - (100 - level) * i / 17), charging: false });
            store.set("batteryHistory", h.concat(store.get("batteryHistory", [])).sort(function (a, b) { return a.t - b.t; }));
            var u = store.get("batteryUsage", { log: [] });
            var demo = [["com.palm.app.email", 42], ["org.webosphoenix.messaging", 35], ["com.palm.app.browser", 28],
                        ["org.webosphoenix.phone", 12], ["", 15], ["org.webosphoenix.music", 9]];
            u.log = demo.map(function (d, n) { return { t: now - (12 - n) * H, appId: d[0], ms: d[1] * 60 * 1000 }; }).concat(u.log || []);
            store.set("batteryUsage", u);
        }
        function usage() {
            seedDemo();
            var now = Date.now(), p = powerState();
            var u = store.get("batteryUsage", { log: [] });
            var by = {}, screen = 0;
            (u.log || []).forEach(function (x) {
                if (now - x.t > DAY) return;
                screen += x.ms;
                var id = x.appId || "";
                by[id] = (by[id] || 0) + x.ms;
            });
            var apps = Object.keys(by).map(function (id) {
                return { appId: id, title: id ? appTitle(id) : "Card view and launcher", ms: by[id], share: screen ? by[id] / screen : 0 };
            }).sort(function (a, b) { return b.ms - a.ms; });
            var h = store.get("batteryHistory", []).filter(function (x) { return now - x.t <= DAY; });
            if (!h.length || h[h.length - 1].percent !== p.percent) h = h.concat([{ t: now, percent: p.percent, charging: p.charger !== "none" }]);
            return ok({ percent: p.percent, charging: p.charger !== "none", temperature: typeof p.temperature === "number" ? p.temperature : 31,
                        history: h, screenOnMs: screen, apps: apps });
        }
        register(["org.webosphoenix.battery"], {
            "/usage": function (p, reply, ctx) { batteryWatch.add(p, reply, ctx, usage); }
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
    // Sealing (encryption at rest for the clipboard history and the Assistant's keys)
    // ================================================================================
    //
    // webCryptoSealer(dbName, keyId, fallbackKey, label) -> {seal(text) ->
    // Promise<{iv, data}>, unseal({iv, data}) -> Promise<text>}: AES-GCM with
    // one 256-bit key for every page, created once and kept in IndexedDB
    // (database dbName, store "keys", id keyId) as a non-extractable
    // CryptoKey: pages can use it but no script can read it out (IndexedDB
    // "add" refuses a second key, so two pages starting together end up
    // with the same one). Where there is no IndexedDB (the unit tests) the
    // raw key is kept in the store under fallbackKey.
    function webCryptoSealer(dbName, keyId, fallbackKey, label) {
        function subtle() {
            var c = global.crypto && global.crypto.subtle ? global.crypto : (typeof crypto !== "undefined" ? crypto : null);
            return c && c.subtle ? c.subtle : null;
        }
        function randomBytes(n) {
            var a = new Uint8Array(n);
            (global.crypto || crypto).getRandomValues(a);
            return a;
        }
        function b64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; ++i) s += String.fromCharCode(bytes[i]);
            return global.btoa(s);
        }
        function unb64(text) {
            var s = global.atob(text), a = new Uint8Array(s.length);
            for (var i = 0; i < s.length; ++i) a[i] = s.charCodeAt(i);
            return a;
        }
        var keyPromise = null;
        function idbKey() {
            return new Promise(function (resolve, reject) {
                var open = global.indexedDB.open(dbName, 1);
                open.onupgradeneeded = function () { open.result.createObjectStore("keys"); };
                open.onerror = function () { reject(open.error); };
                open.onsuccess = function () {
                    var db = open.result;
                    var get = db.transaction("keys", "readonly").objectStore("keys").get(keyId);
                    get.onerror = function () { reject(get.error); };
                    get.onsuccess = function () {
                        if (get.result) return resolve(get.result);
                        subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (k) {
                            var tx = db.transaction("keys", "readwrite");
                            var add = tx.objectStore("keys").add(k, keyId);
                            add.onerror = function (e) {
                                // Another page made it first: use that one.
                                e.preventDefault();
                                var again = db.transaction("keys", "readonly").objectStore("keys").get(keyId);
                                again.onsuccess = function () { again.result ? resolve(again.result) : reject(new Error("no " + label + " key")); };
                                again.onerror = function () { reject(again.error); };
                            };
                            add.onsuccess = function () { resolve(k); };
                        }, reject);
                    };
                };
            });
        }
        function storeKey() {
            var raw = store.get(fallbackKey, null);
            if (raw) return subtle().importKey("raw", unb64(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
            var bytes = randomBytes(32);
            store.set(fallbackKey, b64(bytes));
            return subtle().importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
        }
        function key() {
            if (!subtle()) return Promise.reject(new Error("WebCrypto is not available"));
            if (!keyPromise) {
                keyPromise = (global.indexedDB ? idbKey().catch(function (e) {
                    console.warn("[phoenix-runtime] " + label + ": no IndexedDB key store", e && e.message);
                    return storeKey();
                }) : storeKey());
                keyPromise.catch(function () { keyPromise = null; });
            }
            return keyPromise;
        }
        return {
            seal: function (text) {
                return key().then(function (k) {
                    var iv = randomBytes(12);
                    return subtle().encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(text)).then(function (ct) {
                        return { iv: b64(iv), data: b64(new Uint8Array(ct)) };
                    });
                });
            },
            unseal: function (enc) {
                return key().then(function (k) {
                    return subtle().decrypt({ name: "AES-GCM", iv: unb64(enc.iv) }, k, unb64(enc.data));
                }).then(function (pt) { return new TextDecoder().decode(pt); });
            }
        };
    }

    // ================================================================================
    // Clipboard history (org.webosphoenix.clipboard; the keyboard's clip strip,
    // apps/clipboard, Settings > Clipboard)
    // ================================================================================
    //
    // Phoenix's own service (docs/M6-PLAN.md F2; webOS had no clipboard
    // history): every copy in every app is recorded with the app it came
    // from, so the keyboard's clip strip, the Clipboard app and Settings share
    // one history, as Paste does on macOS.
    //
    //   history {category?, query?, limit?, subscribe?} -> {clips, categories, settings}
    //       newest first; category "recent" (all, the default), "pinned" or a
    //       category id; with subscribe, again after every change in any page.
    //       A sensitive clip comes masked: {sensitive: true, kind, length}, no text.
    //   subscribe {...}: history with subscribe
    //   add {text | image, title?, source?, sensitive?} -> {clip} or {skipped: why}
    //   pin {id}, unpin {id}, setCategory {id, category ("" for none)}
    //   update {id, text} (a text clip edited in the Clipboard app)
    //   delete {id | ids}, clear {all?} (all: pinned and saved clips too)
    //   paste {id} -> {clip} with its text (the keyboard: a sensitive clip only
    //       for the system UI, which pastes it into a password field)
    //   reveal {id, passCode} -> {text}: a sensitive clip after the device
    //       passcode (com.palm.systemmanager matchDevicePasscode)
    //   addCategory {name} -> {category}, renameCategory {id, name},
    //   deleteCategory {id} (its clips stay, in no category),
    //   reorderCategories {ids}
    //   getSettings {subscribe?} -> {settings}, setSettings {...some keys} -> {settings}
    //
    // Clip: {id, type: "text" | "link" | "image", text?, title?, image? (a
    // data: URL or a path), source (app id), time, pinned, category,
    // sensitive, kind?}. A clip in a category or pinned is "saved": it
    // neither expires nor counts against the history's size.
    //
    // Storage: each clip under its own key (clipboard:clip:<id>), so pages
    // copying at once in their own processes never write over each other's
    // clips (PR 7: a page writing back its whole copy of a shared blob undid
    // other pages' changes). Settings and the category list are one key each,
    // written only when the user changes them. Expiry and the size limit are
    // applied by whichever page reads or adds; deleting is safe from any page.
    //
    // Sensitive clips (a copy from a password field, a copy an app marks
    // with __phoenixRuntime.clipboard.markSensitive (@phoenix/secrets'
    // SecretClipboard: Passwords, Authenticator), or text that looks like a
    // one-time code, an otpauth:// link, a TOTP secret or a password) are
    // kept AES-GCM encrypted with a key the runtime keeps in IndexedDB as a
    // non-extractable CryptoKey (in the store, where there is no IndexedDB:
    // the unit tests). Threat model: docs/SECURITY-APPS.md "Clipboard history".
    (function clipboardHistory() {
        var SERVICE = "org.webosphoenix.clipboard";
        var CLIP = "clipboard:clip:";
        var SETTINGS_KEY = "clipboard:settings";
        var CATS_KEY = "clipboard:categories";
        var KEEP = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, forever: 0 };
        var SIZES = [25, 50, 100, 200, 500];
        var DEFAULTS = {
            enabled: true,          // the whole feature: off records nothing and hides the keyboard key
            keyboardKey: true,      // the clipboard key on the keyboard
            maxItems: 100,          // history (not saved clips)
            keepFor: "week",        // hour, day, week, month, forever
            clearOnLock: false,     // clear the history when the screen locks
            sensitive: "mask",      // "mask": recorded encrypted and masked; "skip": not recorded
            detectSecrets: true,    // treat codes and password-like text as sensitive
            excludedApps: []        // app ids whose copies are not recorded
        };
        var MAX_TEXT = 100000;      // characters
        var MAX_IMAGE = 750000;     // data: URL characters (localStorage is shared and small)
        var SYSTEM_UI = "com.palm.systemui";
        var APP = "org.webosphoenix.clipboard";

        function randomBytes(n) {
            var a = new Uint8Array(n);
            (global.crypto || crypto).getRandomValues(a);
            return a;
        }
        function b64(bytes) {
            var s = "";
            for (var i = 0; i < bytes.length; ++i) s += String.fromCharCode(bytes[i]);
            return global.btoa(s);
        }

        // ---- Settings ----------------------------------------------------------------
        function settings() {
            var s = store.get(SETTINGS_KEY, null) || {};
            var out = {};
            for (var k in DEFAULTS) out[k] = k in s ? s[k] : DEFAULTS[k];
            if (!(out.keepFor in KEEP)) out.keepFor = DEFAULTS.keepFor;
            out.maxItems = Math.max(1, Math.min(1000, Math.round(Number(out.maxItems) || DEFAULTS.maxItems)));
            if (out.sensitive !== "skip") out.sensitive = "mask";
            out.excludedApps = Array.isArray(out.excludedApps) ? out.excludedApps.filter(function (a) { return typeof a === "string"; }) : [];
            ["enabled", "keyboardKey", "clearOnLock", "detectSecrets"].forEach(function (b) { out[b] = !!out[b]; });
            return out;
        }

        // ---- Categories -------------------------------------------------------------------
        function categories() {
            var c = store.get(CATS_KEY, null);
            return Array.isArray(c) ? c.filter(function (x) { return x && typeof x.id === "string"; }) : [];
        }

        // ---- Clips --------------------------------------------------------------------------
        function newId() {
            return Date.now().toString(36) + "-" + b64(randomBytes(6)).replace(/[+\/=]/g, "x");
        }
        function readClip(id) {
            var c = store.get(CLIP + id, null);
            return c && c.id === id ? c : null;
        }
        function writeClip(c) {
            try {
                store.set(CLIP + c.id, c);
                return true;
            } catch (e) {
                // Full: drop the oldest history and try once more.
                console.warn("[phoenix-runtime] clipboard: storage full", e && e.message);
                prune(Math.floor(settings().maxItems / 2));
                try { store.set(CLIP + c.id, c); return true; } catch (e2) { return false; }
            }
        }
        function saved(c) { return !!c.pinned || !!c.category; }
        // A copy's time, always after the newest clip's: two copies in the
        // same millisecond would otherwise tie, and "newest first" could
        // put them either way round.
        function nextTime() {
            var now = Date.now(), newest = allClips()[0];
            return newest && newest.time >= now ? newest.time + 1 : now;
        }
        function allClips() {
            var out = [];
            store.keys(CLIP).forEach(function (k) {
                var c = store.get(k, null);
                if (c && c.id) out.push(c);
            });
            out.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
            return out;
        }
        // Expiry and the size limit, for the history only.
        function prune(limit) {
            var s = settings(), now = Date.now(), keep = KEEP[s.keepFor], max = limit !== undefined ? limit : s.maxItems;
            var n = 0, gone = 0;
            allClips().forEach(function (c) {
                if (saved(c)) return;
                if ((keep && now - (c.time || 0) > keep) || ++n > max) {
                    store.remove(CLIP + c.id);
                    gone++;
                }
            });
            return gone;
        }
        // What pages and the shell get: a sensitive clip without its text.
        function shown(c) {
            var o = { id: c.id, type: c.type, source: c.source || "", time: c.time || 0, pinned: !!c.pinned,
                      category: c.category || "", sensitive: !!c.sensitive };
            if (c.title) o.title = c.title;
            if (c.sensitive) {
                o.kind = c.kind || "secret";
                o.length = c.length || 0;
            } else if (c.type === "image") {
                o.image = c.image;
            } else {
                o.text = c.text;
            }
            return o;
        }

        // ---- Sensitive text -----------------------------------------------------------------
        // What a text looks like: "otpauth", "otp" (a one-time code), "totp"
        // (a base32 TOTP key), "password", or "" (nothing secret). A secret an
        // app marked that looks like none of them is a "secret".
        function sensitiveKind(text) {
            var t = String(text || "").trim();
            if (!t || t.length > 256) return "";
            if (/^otpauth(-migration)?:\/\//i.test(t)) return "otpauth";
            if (/^\d{3}[ -]?\d{3}$|^\d{7,8}$/.test(t)) return "otp";
            if (/\s/.test(t)) return "";
            var compact = t.replace(/=+$/, "");
            if (compact.length >= 16 && compact.length <= 128 && /^[A-Z2-7]+$/.test(compact)) return "totp";
            if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^www\./i.test(t) || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(t)) return "";
            if (t.length < 8 || t.length > 64) return "";
            var classes = (/[a-z]/.test(t) ? 1 : 0) + (/[A-Z]/.test(t) ? 1 : 0) + (/[0-9]/.test(t) ? 1 : 0) + (/[^A-Za-z0-9]/.test(t) ? 1 : 0);
            // A word with a capital and a number at the end ("Seattle2024")
            // is a password as often as not; three kinds of characters with
            // a symbol, or all four, are taken as one.
            if (classes === 4 || (classes === 3 && /[^A-Za-z0-9]/.test(t))) return "password";
            return "";
        }
        function linkOf(text) {
            var t = String(text || "").trim();
            return /^(https?|ftp):\/\/[^\s]+$/i.test(t) || /^www\.[^\s]+\.[^\s]+$/i.test(t) ? t : "";
        }

        // Text an app said is a secret (SecretClipboard), for the copy that follows.
        var marked = [];
        function takeMark(text) {
            var now = Date.now();
            marked = marked.filter(function (m) { return now - m.at < 5000; });
            for (var i = 0; i < marked.length; ++i)
                if (marked[i].text === text)
                    return marked.splice(i, 1)[0];
            return null;
        }

        // ---- The key -------------------------------------------------------------------------
        // One AES-GCM key for every page, non-extractable ("Sealing" above).
        var sealer = webCryptoSealer("phoenix-clipboard", "clips", "clipboard:key", "clipboard");
        function seal(text) { return sealer.seal(text); }
        function unseal(enc) { return sealer.unseal(enc); }
        // A clip's text, decrypted if need be.
        function textOf(c) {
            if (!c.sensitive) return Promise.resolve(c.type === "image" ? "" : c.text || "");
            if (!c.enc) return Promise.reject(new Error("no data"));
            return unseal(c.enc);
        }

        // ---- Recording --------------------------------------------------------------------
        // item: {text} or {image}, title?, source?, sensitive? (true: the app or
        // a password field said so). Resolves {clip} or {skipped}.
        function record(item) {
            var s = settings();
            var source = String(item.source || PalmSystem.appIdentifier || "");
            if (!s.enabled) return Promise.resolve({ skipped: "off" });
            if (s.excludedApps.indexOf(source) >= 0) return Promise.resolve({ skipped: "excluded" });
            var c = { id: newId(), time: nextTime(), source: source, pinned: false, category: "", sensitive: false };
            if (item.image) {
                var img = String(item.image);
                if (img.length > MAX_IMAGE) return Promise.resolve({ skipped: "too large" });
                c.type = "image";
                c.image = img;
                if (item.title) c.title = String(item.title).slice(0, 200);
            } else {
                var text = String(item.text === undefined || item.text === null ? "" : item.text);
                if (!text.trim()) return Promise.resolve({ skipped: "empty" });
                if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
                var looks = sensitiveKind(text);
                var mark = takeMark(text);
                var secret = !!item.sensitive || !!mark || (s.detectSecrets && !!looks);
                if (secret && s.sensitive === "skip") return Promise.resolve({ skipped: "sensitive" });
                c.type = !secret && linkOf(text) ? "link" : "text";
                if (c.type === "link" && item.title) c.title = String(item.title).slice(0, 200);
                if (secret) {
                    c.sensitive = true;
                    // A password field's text is a password, whatever it looks like.
                    c.kind = item.password ? "password" : (mark && mark.kind) || (item.kind ? String(item.kind) : "") || looks || "secret";
                    c.length = text.length;
                }
                c.text = text;
            }
            return dedupe(c).then(function (same) {
                if (same) {
                    // Copied again: it moves to the front.
                    same.time = c.time;
                    same.source = c.source;
                    if (c.title && !same.title) same.title = c.title;
                    writeClip(same);
                    changed();
                    return { clip: shown(same) };
                }
                var done = c.sensitive ? seal(c.text).then(function (enc) { delete c.text; c.enc = enc; return c; }) : Promise.resolve(c);
                return done.then(function (clip) {
                    if (!writeClip(clip)) return { skipped: "storage full" };
                    prune();
                    changed();
                    return { clip: shown(clip) };
                });
            });
        }
        // The clip already holding this content, among the latest.
        function dedupe(c) {
            var recent = allClips().filter(function (x) { return x.type === c.type || (c.type !== "image" && x.type !== "image"); }).slice(0, 50);
            var i = 0;
            function next() {
                if (i >= recent.length) return Promise.resolve(null);
                var x = recent[i++];
                if (x.sensitive !== c.sensitive) return next();
                if (c.type === "image") return x.image === c.image ? Promise.resolve(x) : next();
                return textOf(x).then(function (t) { return t === c.text ? x : next(); }, next);
            }
            return next();
        }

        // ---- Subscribers -----------------------------------------------------------------------
        var watchers = [], notifyTimer = null;
        function changed() {
            if (notifyTimer) return;
            notifyTimer = setTimeout(function () {
                notifyTimer = null;
                watchers = watchers.filter(function (w) { return !w.ctx.cancelled(); });
                watchers.forEach(function (w) { w.send(); });
            }, 0);
        }
        global.addEventListener && global.addEventListener("storage", function (e) {
            if (e.key === null || String(e.key).indexOf("phoenix:clipboard:") === 0) changed();
        });
        function watch(p, reply, ctx, make) {
            var send = function () { reply(make()); };
            var first = make();
            if (p.subscribe) {
                first.subscribed = true;
                watchers.push({ ctx: ctx, send: send });
            }
            reply(first);
        }

        function history(p) {
            prune();
            var cat = p.category || "recent";
            var q = String(p.query || "").toLowerCase();
            var list = allClips().filter(function (c) {
                if (cat === "pinned" && !c.pinned) return false;
                if (cat !== "recent" && cat !== "pinned" && c.category !== cat) return false;
                if (!q) return true;
                if (c.sensitive) return false;
                return String(c.text || "").toLowerCase().indexOf(q) >= 0 || String(c.title || "").toLowerCase().indexOf(q) >= 0
                    || String(c.source || "").toLowerCase().indexOf(q) >= 0;
            });
            if (p.limit > 0) list = list.slice(0, p.limit);
            return ok({ clips: list.map(shown), categories: categories(), settings: settings() });
        }

        function withClip(p, reply, fn) {
            var c = p && typeof p.id === "string" ? readClip(p.id) : null;
            if (!c) return reply(fail(-2, "No such clip: " + (p && p.id)));
            fn(c);
        }
        function caller() { return PalmSystem.appIdentifier; }

        var methods = {
            "/history": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return history(p); });
            },
            "/add": function (p, reply) {
                if (typeof p.text !== "string" && typeof p.image !== "string")
                    return reply(fail(-1, "need \"text\" or \"image\""));
                record({ text: p.text, image: p.image, title: p.title, source: p.source || caller(), sensitive: !!p.sensitive,
                         password: p.kind === "password", kind: p.kind })
                    .then(function (r) { reply(ok(r)); }, function (e) { reply(fail(-1, String(e && e.message || e))); });
            },
            "/pin": function (p, reply) {
                withClip(p, reply, function (c) { c.pinned = true; writeClip(c); changed(); reply(ok({ clip: shown(c) })); });
            },
            "/unpin": function (p, reply) {
                withClip(p, reply, function (c) { c.pinned = false; writeClip(c); changed(); reply(ok({ clip: shown(c) })); });
            },
            "/setCategory": function (p, reply) {
                var cat = String(p.category || "");
                if (cat && !categories().some(function (x) { return x.id === cat; }))
                    return reply(fail(-2, "No such category: " + cat));
                withClip(p, reply, function (c) { c.category = cat; writeClip(c); changed(); reply(ok({ clip: shown(c) })); });
            },
            "/update": function (p, reply) {
                if (typeof p.text !== "string" || !p.text.trim()) return reply(fail(-1, "need \"text\""));
                withClip(p, reply, function (c) {
                    if (c.type === "image" || c.sensitive) return reply(fail(-1, "Only text clips can be edited"));
                    c.text = p.text.slice(0, MAX_TEXT);
                    c.type = linkOf(c.text) ? "link" : "text";
                    if (c.type !== "link") delete c.title;
                    writeClip(c);
                    changed();
                    reply(ok({ clip: shown(c) }));
                });
            },
            "/delete": function (p, reply) {
                var ids = Array.isArray(p.ids) ? p.ids : typeof p.id === "string" ? [p.id] : [];
                ids.forEach(function (id) { store.remove(CLIP + id); });
                changed();
                reply(ok({ deleted: ids.length }));
            },
            "/clear": function (p, reply) {
                var n = 0;
                allClips().forEach(function (c) {
                    if (p.all || !saved(c)) { store.remove(CLIP + c.id); n++; }
                });
                changed();
                reply(ok({ deleted: n }));
            },
            "/paste": function (p, reply) {
                withClip(p, reply, function (c) {
                    if (c.sensitive && caller() !== SYSTEM_UI)
                        return reply(fail(-3, "A sensitive clip needs the device passcode (reveal)"));
                    textOf(c).then(function (t) {
                        var o = shown(c);
                        if (c.type !== "image") o.text = t;
                        reply(ok({ clip: o }));
                    }, function () { reply(fail(-4, "This clip can no longer be read")); });
                });
            },
            "/reveal": function (p, reply, ctx) {
                withClip(p, reply, function (c) {
                    dispatch("luna://com.palm.systemmanager/matchDevicePasscode", { passCode: String(p.passCode || "") }, function (r) {
                        if (!r || !r.succeeded)
                            return reply(fail(-5, "The passcode is not right"));
                        textOf(c).then(function (t) { reply(ok({ text: t })); },
                                       function () { reply(fail(-4, "This clip can no longer be read")); });
                    }, ctx);
                });
            },
            "/addCategory": function (p, reply) {
                var name = String(p.name || "").trim().slice(0, 40);
                if (!name) return reply(fail(-1, "need \"name\""));
                var cats = categories();
                var cat = { id: "c" + newId(), name: name };
                cats.push(cat);
                store.set(CATS_KEY, cats);
                changed();
                reply(ok({ category: cat, categories: cats }));
            },
            "/renameCategory": function (p, reply) {
                var name = String(p.name || "").trim().slice(0, 40);
                if (!name) return reply(fail(-1, "need \"name\""));
                var cats = categories(), cat = cats.filter(function (x) { return x.id === p.id; })[0];
                if (!cat) return reply(fail(-2, "No such category: " + p.id));
                cat.name = name;
                store.set(CATS_KEY, cats);
                changed();
                reply(ok({ category: cat, categories: cats }));
            },
            "/deleteCategory": function (p, reply) {
                var cats = categories(), left = cats.filter(function (x) { return x.id !== p.id; });
                if (left.length === cats.length) return reply(fail(-2, "No such category: " + p.id));
                store.set(CATS_KEY, left);
                allClips().forEach(function (c) {
                    if (c.category === p.id) { c.category = ""; writeClip(c); }
                });
                changed();
                reply(ok({ categories: left }));
            },
            "/reorderCategories": function (p, reply) {
                var cats = categories(), ids = Array.isArray(p.ids) ? p.ids : [];
                var byId = {};
                cats.forEach(function (c) { byId[c.id] = c; });
                var out = ids.filter(function (id) { return byId[id]; }).map(function (id) { var c = byId[id]; delete byId[id]; return c; });
                cats.forEach(function (c) { if (byId[c.id]) out.push(c); });
                store.set(CATS_KEY, out);
                changed();
                reply(ok({ categories: out }));
            },
            "/getSettings": function (p, reply, ctx) {
                watch(p, reply, ctx, function () { return ok({ settings: settings() }); });
            },
            "/setSettings": function (p, reply) {
                var cur = store.get(SETTINGS_KEY, null) || {};
                var bad = "";
                Object.keys(p).forEach(function (k) {
                    if (k === "subscribe" || !(k in DEFAULTS)) return;
                    var v = p[k];
                    if (k === "keepFor" && !(v in KEEP)) bad = "keepFor: one of " + Object.keys(KEEP).join(", ");
                    else if (k === "maxItems" && !(v >= 1 && v <= 1000)) bad = "maxItems: 1-1000";
                    else if (k === "sensitive" && v !== "mask" && v !== "skip") bad = "sensitive: \"mask\" or \"skip\"";
                    else if (k === "excludedApps" && !Array.isArray(v)) bad = "excludedApps: a list of app ids";
                    else cur[k] = v;
                });
                if (bad) return reply(fail(-1, bad));
                store.set(SETTINGS_KEY, cur);
                var s = settings();
                if (!s.enabled) {
                    // Off: the history goes (saved clips stay).
                    allClips().forEach(function (c) { if (!saved(c)) store.remove(CLIP + c.id); });
                }
                prune();
                changed();
                reply(ok({ settings: s }));
            }
        };
        methods["/subscribe"] = function (p, reply, ctx) {
            var q = {};
            for (var k in p) q[k] = p[k];
            q.subscribe = true;
            methods["/history"](q, reply, ctx);
        };
        register([SERVICE], methods);

        // ---- Copies in this page ------------------------------------------------------------
        // Every copy and cut: the page's selection, or what the page put on
        // the clipboard itself (clipboardData, read after its own handlers,
        // as this listener is on the window and bubbles last).
        function onCopy(e) {
            var data = e.clipboardData;
            var text = "", image = "", title = "";
            var target = e.target && e.target.nodeType === 1 ? e.target : null;
            var password = !!(target && target.tagName === "INPUT" && String(target.type).toLowerCase() === "password");
            if (e.defaultPrevented && data) {
                text = data.getData("text/plain") || data.getData("text/uri-list") || "";
            } else {
                text = selectedText();
                if (!text) {
                    // A picture alone (no text selected).
                    var sel = global.getSelection && global.getSelection();
                    var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
                    var frag = range ? range.cloneContents() : null;
                    var img = frag && frag.querySelector ? frag.querySelector("img") : null;
                    if (img && img.getAttribute("src")) {
                        image = new URL(img.getAttribute("src"), global.location.href).href;
                        title = img.getAttribute("alt") || "";
                    }
                }
            }
            if (!text && !image) return;
            if (text && linkOf(text)) title = linkTitle(text);
            record({ text: text, image: image, title: title, sensitive: password, password: password })
                .catch(function (err) { console.warn("[phoenix-runtime] clipboard: not recorded", err && err.message); });
        }
        // A link's title: the link's own text where it was copied from, or
        // the page's title for its own address.
        function linkTitle(url) {
            var sel = global.getSelection && global.getSelection();
            var node = sel && sel.anchorNode;
            var a = node && (node.nodeType === 1 ? node : node.parentElement);
            a = a && a.closest ? a.closest("a[href]") : null;
            if (a && a.textContent.trim() && a.textContent.trim() !== url) return a.textContent.trim();
            if (global.location && url === global.location.href) return global.document.title || "";
            return "";
        }
        if (global.addEventListener) {
            global.addEventListener("copy", onCopy);
            global.addEventListener("cut", onCopy);
        }

        // navigator.clipboard writes (SecretClipboard, the apps' Copy
        // buttons) fire no copy event: recorded here.
        var clip = global.navigator && global.navigator.clipboard;
        if (clip && typeof clip.writeText === "function") {
            var writeText = clip.writeText.bind(clip);
            try {
                clip.writeText = function (text) {
                    var r = writeText(text);
                    Promise.resolve(r).then(function () {
                        if (text) record({ text: String(text) }).catch(function () {});
                    }, function () {});
                    return r;
                };
            } catch (e) { /* read-only: copies through it go unrecorded */ }
        }
        if (clip && typeof clip.write === "function") {
            var write = clip.write.bind(clip);
            try {
                clip.write = function (items) {
                    var r = write(items);
                    Promise.resolve(r).then(function () { recordItems(items); }, function () {});
                    return r;
                };
            } catch (e) { /* as above */ }
        }
        function recordItems(items) {
            (items || []).forEach(function (it) {
                var types = it && it.types ? Array.prototype.slice.call(it.types) : [];
                var img = types.filter(function (t) { return /^image\//.test(t); })[0];
                if (img) {
                    it.getType(img).then(function (blob) {
                        var fr = new global.FileReader();
                        fr.onload = function () { record({ image: String(fr.result) }).catch(function () {}); };
                        fr.readAsDataURL(blob);
                    });
                } else if (types.indexOf("text/plain") >= 0) {
                    it.getType("text/plain").then(function (blob) { return blob.text(); })
                        .then(function (t) { record({ text: t }).catch(function () {}); });
                }
            });
        }

        // Copy and Cut in a password field. Chromium refuses both there (and
        // fires no copy event); webOS let the user copy a password, so the
        // runtime copies the selection itself and records it as sensitive.
        function passwordField() {
            var el = editTarget();
            return el && el.tagName === "INPUT" && String(el.type).toLowerCase() === "password" ? el : null;
        }
        function passwordCopy(action) {
            var el = passwordField();
            if (!el || el.selectionStart === el.selectionEnd) return false;
            var text = el.value.substring(el.selectionStart, el.selectionEnd);
            runtime.clipboard.markSensitive(text, "password");
            var put = clip && typeof clip.writeText === "function"
                ? Promise.resolve(clip.writeText(text)) : Promise.reject(new Error("no clipboard"));
            put.catch(function () {
                // execCommand("copy") on a hidden text area.
                var ta = global.document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                global.document.body.appendChild(ta);
                ta.select();
                global.document.execCommand("copy");
                ta.remove();
                el.focus();
            });
            if (action === "cut")
                global.document.execCommand("insertText", false, "");
            return true;
        }
        if (global.document) {
            global.document.addEventListener("keydown", function (e) {
                var k = String(e.key || "").toLowerCase();
                if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "c" || k === "x") && passwordCopy(k === "c" ? "copy" : "cut"))
                    e.preventDefault();
            }, true);
        }

        // The screen locked: the history goes, when the user asked for that
        // (Settings > Clipboard). Only on the change, which one page sees
        // first (applyHostStatus stores deviceLocked); deleting twice is harmless.
        var baseApply = runtime.applyHostStatus;
        runtime.applyHostStatus = function (st, opts) {
            var was = !!store.get("deviceLocked", false);
            var r = baseApply.apply(this, arguments);
            if (st && st.deviceLocked && !was && settings().clearOnLock) {
                allClips().forEach(function (c) { if (!saved(c)) store.remove(CLIP + c.id); });
                changed();
            }
            return r;
        };

        runtime.clipboard = {
            record: record,
            // The next copy of this text is a secret (@phoenix/secrets SecretClipboard).
            // kind: "password", "otp", ... ("" to tell from the text).
            markSensitive: function (text, kind) {
                if (typeof text === "string" && text) marked.push({ text: text, kind: kind ? String(kind) : "", at: Date.now() });
            },
            sensitiveKind: sensitiveKind,
            passwordCopy: passwordCopy,
            // A picture from the keyboard's clip strip, into the focused
            // rich text (contenteditable); a plain field takes none.
            insertImage: function (src) {
                var el = editTarget();
                if (!el || !el.isContentEditable || !src) return false;
                return global.document.execCommand("insertImage", false, String(src));
            },
            settings: settings,
            // For tests: the stored record (sensitive ones encrypted).
            raw: readClip,
            prune: prune
        };
    })();

    // ================================================================================
    // The Assistant (org.webosphoenix.assistant, org.webosphoenix.tts;
    // the shell's assistant view, apps/assistant, Settings > Assistant)
    // ================================================================================
    //
    // docs/M6-PLAN.md F3. Nothing here reimplements the assistant: this block
    // runs the device's own service code, apps/assistant/service
    // (assistant.js and lib/: the grammar, the router, the providers; the
    // requests and replies are documented there), in the page, loaded from
    // /usr/palm/services/org.webosphoenix.assistant/ ("Node.js device
    // services in the page" above), and gives it:
    //
    //   - luna calls on the simulated bus;
    //   - HTTP through the host's proxy (proxiedRequest): the model providers
    //     and Open-Meteo do not allow cross-origin requests from pages, and
    //     the proxy runs in phoenix-sim's own process (Qt Network), so a
    //     provider's key goes from the service to the provider and nowhere
    //     else (docs/APP-RUNTIME.md "Assistant");
    //   - storage: the shared store, one key per thread, message and
    //     provider ("assistant:..."), so the shell's view and the app writing
    //     at once never write over each other (PR 7);
    //   - secrets: API keys sealed with AES-GCM under a non-extractable key in
    //     IndexedDB ("Sealing" above); the service unseals one only to call
    //     its provider, and gives pages no more than its last four characters;
    //   - the on-device model and speech: the shell's, when
    //     /usr/share/phoenix/host.json says {"assistant": true} (phoenix-sim:
    //     shell/native/localmodels.cpp runs llama.cpp's llama-server and
    //     downloads models, shell/native/speech.cpp speaks). "assistant" host
    //     messages ({op, requestId, ...}) go out and the answers come back
    //     through __phoenixRuntime.assistantHostEvent({requestId, ...}).
    //     Without the shell (a browser, the tests): no on-device model, and
    //     speech through the page's speechSynthesis where it has voices.
    //
    // Who may call: ask, choose and confirm only the system UI, the
    // Assistant app and Settings (a request can spend the user's cloud
    // tokens); providers and allowCloudControl only Settings (assistant.js).
    //
    // Subscriptions: threads, thread, getSettings, providers, models and
    // commands with {subscribe: true} answer again after every change in any
    // page (the store's storage events, "assistant:" keys).
    //
    // org.webosphoenix.tts: speak {text, lang?, voice?}, stop {}, getStatus {}
    // -> {available, engine, voices}: the same speech for any app (voices:
    // Kitten TTS's, Settings > Assistant > Voice).
    //
    // __phoenixRuntime.assistant: service() (the methods), hostEvent, for tests.
    (function assistantService() {
        var SERVICE = "org.webosphoenix.assistant";
        var DIR = "/usr/palm/services/" + SERVICE + "/";
        var loadModule = nodeServiceLoader(DIR, "Assistant service");
        var sealer = webCryptoSealer("phoenix-assistant", "providerKeys", "assistant:sealKey", "assistant");

        var hostInfo = null;
        function hostHas() {
            if (hostInfo === null) {
                try { hostInfo = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/host.json") || "{}") || {}; }
                catch (e) { hostInfo = {}; }
            }
            return hostInfo.assistant === true;
        }

        // ---- The host (the shell's on-device model and speech) -----------------------------
        var pending = {}, nextRequest = 1;
        function hostAsk(op, payload, timeoutMs) {
            return new Promise(function (resolve, reject) {
                var id = "a" + (nextRequest++) + "-" + Date.now().toString(36);
                var timer = setTimeout(function () {
                    delete pending[id];
                    reject(new Error("the shell did not answer"));
                }, timeoutMs || 5000);
                pending[id] = function (ev) {
                    clearTimeout(timer);
                    delete pending[id];
                    if (ev.error) reject(new Error(ev.error));
                    else resolve(ev);
                };
                host.postToHost("assistant", Object.assign({ op: op, requestId: id }, payload || {}));
            });
        }
        runtime.assistantHostEvent = function (ev) {
            if (!ev) return;
            if (ev.requestId && pending[ev.requestId]) pending[ev.requestId](ev);
            if (ev.changed) changed("models");
        };

        var NO_LLM = "Install llama.cpp's llama-server (scripts/mac-setup.sh or brew install llama.cpp on a Mac, " +
                     "scripts/linux-setup.sh on Linux) and start phoenix-sim with it on the PATH, or with --llama-server <path>.";
        var llm = {
            status: function () {
                if (!hostHas()) return Promise.resolve({ available: false, installed: [], ramBytes: 0, howToInstall: NO_LLM });
                return hostAsk("status", {}).then(function (st) {
                    if (!st.available) st.howToInstall = NO_LLM;
                    return st;
                }, function () { return { available: false, installed: [], ramBytes: 0, howToInstall: NO_LLM }; });
            },
            download: function (m) {
                if (!hostHas()) return Promise.reject(new Error("Models can only be downloaded in the Phoenix shell."));
                return hostAsk("download", { id: m.id, url: m.url, sha256: m.sha256, size: m.size, file: m.file, sources: m.sources });
            },
            cancel: function (id) { return hostHas() ? hostAsk("cancel", { id: id }) : Promise.resolve(); },
            remove: function (m) { return hostHas() ? hostAsk("remove", { id: m.id, file: m.file }) : Promise.resolve(); },
            // The server for this model: started if need be (loading a model takes a while).
            ensure: function (m) {
                if (!hostHas()) return Promise.reject(new Error("no on-device model here"));
                return hostAsk("ensure", { id: m.id, file: m.file }, 180000).then(function (ev) { return { baseUrl: ev.baseUrl }; });
            }
        };

        // ---- Speech ------------------------------------------------------------------------
        function pageVoices() {
            var ss = global.speechSynthesis;
            try { return ss && ss.getVoices ? ss.getVoices() : []; } catch (e) { return []; }
        }
        var tts = {
            // rate: how fast (1 normal; Settings > Assistant > Speaking speed).
            speak: function (text, lang, voice, rate) {
                if (!text) return Promise.resolve();
                rate = typeof rate === "number" && rate >= 0.5 && rate <= 2 ? rate : 1;
                if (hostHas()) return hostAsk("speak", { text: String(text).slice(0, 2000), lang: lang || "en", voice: voice || "", rate: rate });
                var ss = global.speechSynthesis;
                if (ss && pageVoices().length && global.SpeechSynthesisUtterance) {
                    var u = new global.SpeechSynthesisUtterance(String(text));
                    u.lang = lang || "en";
                    u.rate = rate;
                    ss.cancel();
                    ss.speak(u);
                    return Promise.resolve();
                }
                return Promise.reject(new Error("No text-to-speech here"));
            },
            stop: function () {
                if (hostHas()) return hostAsk("stopSpeaking", {}).catch(function () {});
                if (global.speechSynthesis) global.speechSynthesis.cancel();
                return Promise.resolve();
            },
            status: function () {
                if (hostHas()) return hostAsk("speechStatus", {}).catch(function () { return { available: false, engine: "", voices: [] }; });
                return Promise.resolve({ available: pageVoices().length > 0, engine: pageVoices().length ? "speechSynthesis" : "" });
            }
        };

        // ---- What the voice needs (voice) --------------------------------------------------
        // phoenix-sim says in host.json what it found when it started
        // ({"voice": {"recognition" | "wakeWord" | "speech": {available,
        // engine, howToInstall}}}, shell/sim/main.cpp); speech is asked of
        // the shell now. Without the shell: nothing to say.
        function voiceParts() {
            if (!hostHas() || !hostInfo.voice) return [];
            var part = function (id) {
                var x = hostInfo.voice[id] || {};
                return { id: id, available: !!x.available, engine: x.engine || "", howToInstall: x.howToInstall || "" };
            };
            return tts.status().then(function (st) {
                var sp = part("speech");
                sp.available = !!st.available;
                sp.engine = st.engine || "";
                return [part("recognition"), part("wakeWord"), sp];
            });
        }

        // ---- Subscriptions -------------------------------------------------------------------
        var watchers = [], notifyTimer = null;
        function changed() {
            if (notifyTimer) return;
            notifyTimer = setTimeout(function () {
                notifyTimer = null;
                watchers = watchers.filter(function (w) { return !w.ctx.cancelled(); });
                watchers.forEach(function (w) { w.send(); });
            }, 0);
        }
        if (global.addEventListener) {
            global.addEventListener("storage", function (e) {
                if (e.key === null || String(e.key).indexOf("phoenix:assistant:") === 0) changed();
            });
        }

        var methods = null;
        function service() {
            if (!methods) {
                var lib = loadModule("assistant.js");
                methods = lib.createAssistantService({
                    // Its calls are the Assistant's (the location permission
                    // Settings > Location Services lists for it), wherever it runs.
                    luna: nodeServiceLuna(SERVICE),
                    request: proxiedRequest,
                    storage: {
                        get: function (k) { return store.get(k, null); },
                        set: function (k, v) { store.set(k, v); },
                        remove: function (k) { store.remove(k); },
                        keys: function (prefix) { return store.keys(prefix); }
                    },
                    secrets: sealer,
                    llm: llm,
                    tts: tts,
                    voice: voiceParts,
                    caller: function () { return PalmSystem.appIdentifier; },
                    locale: function () { return (global.navigator && global.navigator.language) || "en-US"; },
                    // The device's units (Settings > Language & Region >
                    // Units, the region when "auto"), as every app reads them.
                    units: function () {
                        var st = store.get("settings:state", null);
                        return loadModule("lib/region.js").deviceUnits(st && st.settings && st.settings[""], global.navigator && global.navigator.language);
                    },
                    // A follow-up question later (lib/followups.js): the
                    // Assistant's notification, with its answers as buttons
                    // ({actions}), or {tag, remove} to take it back.
                    notify: function (n) { host.postToHost("notification", n); },
                    changed: changed,
                    log: function (m) { console.info("[assistant] " + m); }
                });
                methods.__lib = lib;
            }
            return methods;
        }

        var WATCHABLE = { threads: 1, thread: 1, getSettings: 1, providers: 1, models: 1, commands: 1, followUps: 1 };
        var serviceMethods = {};
        ["ask", "choose", "confirm", "threads", "thread", "newThread", "setCurrent", "deleteThread", "clearHistory",
         "getSettings", "setSettings", "commands", "providers", "setProvider", "removeProvider", "testProvider", "listModels",
         "models", "downloadModel", "cancelDownload", "removeModel", "selectModel", "speak", "stopSpeaking", "sessionPhrase", "vocabulary",
         "followUps", "answerFollowUp", "followUpOpen", "followUpLeave", "followUpWake", "resetFollowUps", "markRead",
         "connect", "retry", "voice"].forEach(function (name) {
            serviceMethods["/" + name] = function (p, reply, ctx) {
                var m;
                try { m = service(); } catch (e) { return reply(fail(-1, String(e.message || e))); }
                var params = clone(p || {});
                var watch = !!params.subscribe && WATCHABLE[name];
                delete params.subscribe;
                var answer = function (first) {
                    return m[name](params).then(function (r) {
                        if (watch && r.returnValue !== false && first) r.subscribed = true;
                        if (!ctx.cancelled()) reply(r);
                        return r;
                    }, function (e) { reply(fail(-1, String(e && e.message || e))); });
                };
                answer(true).then(function (r) {
                    if (watch && r && r.returnValue !== false) watchers.push({ ctx: ctx, send: function () { answer(false); } });
                });
            };
        });
        register([SERVICE], serviceMethods);

        register(["org.webosphoenix.tts"], {
            "/speak": function (p, reply) {
                if (typeof p.text !== "string" || !p.text.trim()) return reply(fail(-1, "need \"text\""));
                var voice = typeof p.voice === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(p.voice) ? p.voice : "";
                tts.speak(p.text, p.lang, voice, p.rate).then(function () { reply(ok({})); }, function (e) { reply(fail(1, e.message)); });
            },
            "/stop": function (p, reply) { tts.stop().then(function () { reply(ok({})); }); },
            "/getStatus": function (p, reply) {
                tts.status().then(function (s) { reply(ok({ available: !!s.available, engine: s.engine || "", voices: s.voices || [] })); });
            }
        });

        // The simulator's and the tests' fast-forward for follow-up questions
        // (sim.qml "Assistant Follow-ups Now"): the clock moved on to the next
        // time one is due, again until one is shown as a notification (past
        // the quiet hours, Do Not Disturb and calls) or none waits. Resolves
        // the last wake's {queued, delivered, dropped, postponed, at}.
        // {all: true}: on until every question waiting has been shown once
        // (those queued a moment apart are due a moment apart), the counts
        // summed; what the tests need, whatever the hour (an hour on from
        // 01:00 is in the quiet hours and sends them together at 08:00; one
        // on from 11:00 sends one at a time).
        function fastForward(opts) {
            var o = typeof opts === "number" ? { limit: opts } : (opts || {});
            var m = service(), n = o.limit || 8, sum = null;
            function add(r) {
                if (!sum) { sum = r; return; }
                ["queued", "delivered", "dropped", "postponed"].forEach(function (k) { sum[k] = (sum[k] || 0) + (r[k] || 0); });
                sum.at = r.at;
            }
            function step(last) {
                return m.followUps({}).then(function (q) {
                    var waiting = (q.followUps || []).filter(function (f) { return !o.all || f.state !== "delivered"; });
                    if (!waiting.length || n-- <= 0 || (!o.all && last && last.delivered)) return (o.all ? sum : last) || { delivered: 0 };
                    var at = Math.max(Date.now(), Math.min.apply(null, waiting.map(function (f) { return f.nextAt; })));
                    return m.followUpWake({ at: at }).then(function (r) { r.at = at; add(Object.assign({}, r)); return step(r); });
                });
            }
            return step(null);
        }

        runtime.assistant = { service: service, llm: llm, tts: tts, hostHas: hostHas, fastForward: fastForward };
    })();

    // ================================================================================
    // LunaSysMgr's device services: com.palm.display, com.palm.keys,
    // com.palm.vibrate, com.palm.ambientLightSensor
    // ================================================================================
    //
    // The services luna-sysmgr itself registered for the apps (README.md:24-128),
    // with its requests, replies and events:
    //
    //   com.palm.display          DisplayManager.cpp (status :2296-2357,
    //                             setState :1225-1308, getProperty :1633-1712,
    //                             setProperty :1796-1990, events :1453-1534)
    //   com.palm.keys             InputManager.cpp (:86-116, :333-428, :640-1178)
    //   com.palm.vibrate          HapticsController.cpp (:117-307);
    //                             named effects HapticsControllerCastle.cpp:78-97
    //   com.palm.ambientLightSensor  AmbientLightSensor.cpp (:420-570)
    //
    // The shell owns what they report: the display's state (Display.qml), the
    // keys and switches, the motor and the light sensor (DeviceServices.qml).
    // In phoenix-sim each page has its own copy of these services; the shell
    // tells every page what changed through __phoenixRuntime.devices.hostEvent
    // ({display, holds, switches, key, light, powerKey}) and the pages ask
    // the shell with host messages:
    //
    //   "displayState" {state}            setState: on, dimmed, off, unlock, dock, undock
    //   "displayHolds" {requestBlock, powerKeyBlock, proximity, alsDisabled, clients}
    //                                     what this page holds (subscriptions
    //                                     that last until cancelled; the shell
    //                                     adds every page's up and drops a
    //                                     page's when it goes)
    //   "vibrate" {id, on, period?, duration?, name?}
    //
    // The rest (timeout, maximumBrightness, onWhenConnected) are the
    // system's preferences: screenTimeout, picture.backlight and
    // display:onWhenConnected, which reach the shell as systemStatus.
    // On a device the same services come from services/devices (phoenix-devices)
    // on the bus, and this block is not used (docs/HARDWARE.md).
    (function deviceServices() {
        var DISPLAY_KEY = "devices:display", SWITCHES_KEY = "devices:switches", LIGHT_KEY = "devices:light";
        var PROPS_KEY = "display:props";

        // What the shell last said, kept in the shared store for pages that
        // load later. Until it has said anything: the display on, the
        // ringer on (up), no headset (up), the slider closed (down, as
        // InputManager::getKeyState reported on the emulator, :779-781).
        function displayState() {
            var d = store.get(DISPLAY_KEY, null) || {};
            return {
                state: d.state === "dimmed" || d.state === "off" ? d.state : "on",
                timeout: typeof d.timeout === "number" ? d.timeout : screenTimeout(),
                blockDisplay: !!d.blockDisplay,
                active: d.active !== false,
                dockMode: !!d.dockMode,
                holds: d.holds || { requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 }
            };
        }
        function switches() {
            var s = store.get(SWITCHES_KEY, null) || {};
            return { ringer: s.ringer || "up", slider: s.slider || "down", headset: s.headset || "up",
                     "headset-mic": s["headset-mic"] || "up", power: s.power || "up" };
        }
        function light() {
            var l = store.get(LIGHT_KEY, null) || {};
            return { current: typeof l.current === "number" ? l.current : 300,
                     average: typeof l.average === "number" ? l.average : (typeof l.current === "number" ? l.current : 300),
                     region: typeof l.region === "number" ? l.region : 3 };
        }
        function screenTimeout() {
            var t = prefs().screenTimeout;
            return typeof t === "number" && t > 0 ? t : 60;
        }
        function displayProps() { return store.get(PROPS_KEY, null) || { onWhenConnected: false }; }
        function maximumBrightness() {
            var st = store.get("settings:state", null);
            var b = st && st.settings && st.settings.picture ? st.settings.picture.backlight : 70;
            return typeof b === "number" ? b : 70;
        }

        // ---- com.palm.display ------------------------------------------------------

        var displaySubs = [];   // {reply, ctx, isPublic}
        var powerKeySubs = [];  // {reply, ctx}: setProperty {powerKeyBlock}
        var mine = { requestBlock: [], powerKeyBlock: [], proximity: [], alsDisabled: 0 };

        function live(list) { return list.filter(function (s) { return !s.ctx.cancelled(); }); }

        // DisplayManager::notifySubscribers (:1453-1534): every event on the
        // private bus (/control/status), the display's own on the public one
        // (/status) too.
        function notifyDisplay(event, extra) {
            var isPublic = event === "displayOn" || event === "displayDimmed" || event === "displayOff";
            var r = ok({ event: event });
            for (var k in extra) r[k] = extra[k];
            displaySubs = live(displaySubs);
            displaySubs.forEach(function (s) {
                if (!s.isPublic || isPublic) s.reply(r);
            });
        }

        // The shell's display changed: the events luna-sysmgr sent.
        function displayFromShell(d) {
            var before = displayState();
            var after = {
                state: d.state === "dim" || d.state === "dimmed" ? "dimmed" : d.state === "off" ? "off" : "on",
                timeout: typeof d.timeout === "number" ? d.timeout : before.timeout,
                blockDisplay: "blockDisplay" in d ? !!d.blockDisplay : before.blockDisplay,
                active: "active" in d ? !!d.active : before.active,
                dockMode: "dockMode" in d ? !!d.dockMode : before.dockMode,
                holds: before.holds
            };
            store.set(DISPLAY_KEY, after);
            if (after.state !== before.state || (after.state === "on" && after.dockMode !== before.dockMode)) {
                if (after.state === "on")
                    notifyDisplay("displayOn", after.dockMode ? { dockMode: true } : null);
                else
                    notifyDisplay(after.state === "dimmed" ? "displayDimmed" : "displayOff");
            }
            if (after.timeout !== before.timeout)
                notifyDisplay("changedTimeout", { timeout: after.timeout });
            if (after.blockDisplay !== before.blockDisplay)
                notifyDisplay(after.blockDisplay ? "blockedDisplay" : "unblockedDisplay");
            if (after.active !== before.active)
                notifyDisplay(after.active ? "displayActive" : "displayInactive");
        }

        function holdsFromShell(h) {
            var d = displayState();
            d.holds = { requestBlock: h.requestBlock | 0, powerKeyBlock: h.powerKeyBlock | 0,
                        proximity: h.proximity | 0, alsDisabled: h.alsDisabled | 0 };
            store.set(DISPLAY_KEY, d);
        }

        // What this page holds, for the shell (it adds every page's up).
        function reportHolds() {
            ["requestBlock", "powerKeyBlock", "proximity"].forEach(function (k) { mine[k] = live(mine[k]); });
            host.postToHost("displayHolds", {
                requestBlock: mine.requestBlock.length, powerKeyBlock: mine.powerKeyBlock.length,
                proximity: mine.proximity.length, alsDisabled: mine.alsDisabled,
                clients: mine.requestBlock.map(function (s) { return s.client; })
            });
        }
        // A hold lasts as long as its call (LSSubscriptionAdd; the cancel
        // function pops it, DisplayManager::cancelSubscription :1379-1450).
        function hold(kind, ctx, client) {
            var h = { ctx: ctx, client: client };
            mine[kind].push(h);
            var prev = ctx.onCancel;
            ctx.onCancel = function () {
                if (prev) prev();
                mine[kind] = mine[kind].filter(function (x) { return x !== h; });
                reportHolds();
            };
            reportHolds();
        }

        // controlStatus (:2296-2357): the public bus gets less.
        function status(isPublic) {
            return function (p, reply, ctx) {
                var d = displayState(), subscribed = p.subscribe === true;
                var r = isPublic ? ok({ event: "request", state: d.state, subscribed: subscribed })
                                 : ok({ event: "request", state: d.state, timeout: d.timeout,
                                        blockDisplay: d.blockDisplay ? "true" : "false", active: d.active, subscribed: subscribed });
                reply(r);
                if (subscribed) displaySubs.push({ reply: reply, ctx: ctx, isPublic: isPublic });
            };
        }

        var STATES = ["on", "dimmed", "off", "unlock", "dock", "undock"];

        register(["com.palm.display"], {
            "/status": status(true),
            "/control/status": status(false),
            // controlSetState (:1225-1308): the shell's display does it.
            "/control/setState": function (p, reply) {
                if (typeof p.state !== "string" || STATES.indexOf(p.state) < 0)
                    return reply({ returnValue: false, errorText: "call failed" });
                host.postToHost("displayState", { state: p.state });
                reply(ok());
            },
            // controlGetProperty (:1633-1712): the properties it knows; none
            // known is a failure.
            "/control/getProperty": function (p, reply) {
                if (!Array.isArray(p.properties))
                    return reply(fail(1, "failed to get property"));
                var d = displayState(), r = ok(), any = false;
                p.properties.forEach(function (name) {
                    var v;
                    if (name === "requestBlock") v = d.blockDisplay;
                    else if (name === "powerKeyBlock") v = d.holds.powerKeyBlock > 0;
                    else if (name === "timeout") v = d.timeout;
                    else if (name === "maximumBrightness") v = maximumBrightness();
                    else if (name === "onWhenConnected") v = !!displayProps().onWhenConnected;
                    else if (name === "proximityEnabled") v = d.holds.proximity > 0;
                    else return;
                    r[name] = v;
                    any = true;
                });
                reply(any ? r : fail(1, "failed to get property"));
            },
            // controlSetProperty (:1796-1990), in its order; an error stops
            // there, what came before it stays done.
            "/control/setProperty": function (p, reply, ctx) {
                function needsClient(key) {
                    if (typeof p.client === "string" && p.client) return false;
                    reply(fail(22, "'" + key + "' needs 'client' string"));
                    return true;
                }
                if (p.requestBlock === true) {
                    if (needsClient("requestBlock")) return;
                    hold("requestBlock", ctx, p.client);
                }
                if (p.powerKeyBlock === true) {
                    if (needsClient("powerKeyBlock")) return;
                    hold("powerKeyBlock", ctx, p.client);
                    powerKeySubs.push({ reply: reply, ctx: ctx });
                }
                if (typeof p.timeout === "number" && p.timeout !== -1) {
                    // DisplayManager::setTimeout (:1550-1563): 0 or less is
                    // the default, 120 s. Phoenix keeps it as the system
                    // preference screenTimeout ("Turn off after").
                    var t = p.timeout > 0 ? Math.round(p.timeout) : 120;
                    dispatch("palm://com.palm.systemservice/setPreferences", { screenTimeout: t }, function () {},
                             { cancelled: function () { return true; }, onCancel: null });
                }
                if ("onWhenConnected" in p) {
                    var props = displayProps();
                    props.onWhenConnected = !!p.onWhenConnected;
                    store.set(PROPS_KEY, props);
                    if (runtime.hostStatus) host.postToHost("systemStatus", runtime.hostStatus());
                }
                if (typeof p.maximumBrightness === "number") {
                    // setMaximumBrightness (:2150-2190): 1-100. It is the
                    // brightness the user sets (Screen & Lock, the system
                    // menu): picture.backlight.
                    var b = Math.max(1, Math.min(100, Math.round(p.maximumBrightness)));
                    dispatch("luna://com.webos.settingsservice/setSystemSettings", { category: "picture", settings: { backlight: b } },
                             function () {}, { cancelled: function () { return true; }, onCancel: null });
                }
                if (p.proximityEnabled === true) {
                    if (needsClient("proximityEnabled")) return;
                    hold("proximity", ctx, p.client);
                }
                reply(ok());
            }
        });

        // ---- com.palm.keys ----------------------------------------------------------

        var keySubs = [];   // {category, reply, ctx}

        // processSubscription (:333-370): these categories only take subscriptions.
        function keySubscription(category) {
            return function (p, reply, ctx) {
                if (p.subscribe !== true)
                    return reply({ errorCode: -1, errorText: "We were expecting a subscribe type message, but we did not recieve one.",
                                   returnValue: false, subscribed: false });
                reply({ returnValue: true, subscribed: true });
                keySubs.push({ category: category, reply: reply, ctx: ctx });
            };
        }

        register(["com.palm.keys"], {
            "/audio/status": keySubscription("/audio"),
            "/media/status": keySubscription("/media"),
            "/headset/status": keySubscription("/headset"),
            // switchesStatusCallback (:640-650): a subscription, or {get: name}
            // for one switch's state (processKeyState, :371-428).
            "/switches/status": function (p, reply, ctx) {
                if (p.subscribe === true)
                    return keySubscription("/switches")(p, reply, ctx);
                if (typeof p.get !== "string")
                    return reply({ returnValue: false });
                var s = switches();
                reply({ key: p.get, state: s[p.get] || "unknown", returnValue: true });
            }
        });

        // A key went down or up, or a switch changed (handleEvent, :1123-1177;
        // postKeyToSubscribers, :1086-1121): {key, state} to the category's
        // subscribers.
        function keyFromShell(k) {
            if (k.category === "/switches" || k.category === "/headset") {
                if (k.key in switches() && (k.state === "up" || k.state === "down")) {
                    var s = switches();
                    s[k.key] = k.state;
                    store.set(SWITCHES_KEY, s);
                }
            }
            keySubs = live(keySubs);
            keySubs.forEach(function (s) {
                if (s.category === k.category) s.reply({ key: k.key, state: k.state });
            });
        }

        // ---- com.palm.vibrate --------------------------------------------------------

        var nextVibration = 1;
        // The named effects HapticsControllerCastle knew (:85-97).
        var EFFECTS = ["ringtone", "alert", "notification", "tapdown", "tapup"];
        function vibration(params, reply, ctx, untilCancelled) {
            var id = (PalmSystem.appIdentifier || "app") + ":" + (nextVibration++);
            var msg = { id: id, on: true, appId: PalmSystem.appIdentifier || "" };
            for (var k in params) msg[k] = params[k];
            host.postToHost("vibrate", msg);
            if (untilCancelled) {
                var prev = ctx.onCancel;
                ctx.onCancel = function () {
                    if (prev) prev();
                    host.postToHost("vibrate", { id: id, on: false });
                };
            }
            reply(ok());
        }
        register(["com.palm.vibrate"], {
            // cbVibrate (:117-181): a period is needed; no duration, until
            // the call is cancelled.
            "/vibrate": function (p, reply, ctx) {
                if (typeof p.period !== "number")
                    return reply({ returnValue: false, errorText: "Invalid arguments" });
                var duration = typeof p.duration === "number" ? p.duration : 0;
                vibration({ period: p.period, duration: duration }, reply, ctx, duration === 0);
            },
            // cbVibrateNamedEffect (:236-307): continous, until cancelled.
            "/vibrateNamedEffect": function (p, reply, ctx) {
                if (typeof p.name !== "string")
                    return reply({ returnValue: false, errorText: "Invalid arguments" });
                if (EFFECTS.indexOf(p.name) < 0)
                    return reply({ returnValue: false, errorText: "Unable to vibrate" });
                vibration({ name: p.name, continous: p.continous === true }, reply, ctx, p.continous === true);
            }
        });

        // ---- com.palm.ambientLightSensor ------------------------------------------------

        var alsSubs = [];
        register(["com.palm.ambientLightSensor"], {
            // controlStatus (:518-570): the reading now; subscribed, every
            // reading after it ({current, region}, updateAls :398-411);
            // disableALS with subscribe holds the sensor's region at
            // "undefined" (0) while the subscription lasts.
            "/control/status": function (p, reply, ctx) {
                var subscribed = p.subscribe === true;
                if (subscribed && p.disableALS === true) {
                    mine.alsDisabled++;
                    var prev = ctx.onCancel;
                    ctx.onCancel = function () {
                        if (prev) prev();
                        mine.alsDisabled = Math.max(0, mine.alsDisabled - 1);
                        reportHolds();
                    };
                    reportHolds();
                }
                var l = light(), d = displayState();
                reply(ok({ current: l.current, average: l.average, disabled: d.holds.alsDisabled > 0 || mine.alsDisabled > 0,
                           subscribed: subscribed }));
                if (subscribed) alsSubs.push({ reply: reply, ctx: ctx });
            }
        });
        function lightFromShell(l) {
            store.set(LIGHT_KEY, { current: l.current, average: typeof l.average === "number" ? l.average : l.current, region: l.region });
            alsSubs = live(alsSubs);
            alsSubs.forEach(function (s) { s.reply(ok({ current: l.current, region: l.region })); });
        }

        // ---- The ringer switch, for the Clock (com.palm.audio system/status) --------
        // The original Clock asks audiod whether the ringer is on before an
        // alarm sounds (utility/keymanager.js:113-120: response["ringer
        // switch"], true while the ringer is on).
        var audioSvc = runtime.services["com.palm.audio"] || {};
        audioSvc["/system/status"] = function (p, reply) {
            reply(ok({ "ringer switch": switches().ringer === "up" }));
        };
        register(["com.palm.audio"], audioSvc);

        // ---- The shell's side ---------------------------------------------------------

        runtime.devices = {
            // {display: {state, timeout, blockDisplay, active, dockMode},
            //  holds: {requestBlock, powerKeyBlock, proximity, alsDisabled},
            //  key: {category, key, state}, light: {current, average, region},
            //  powerKey: "released"}
            hostEvent: function (ev) {
                if (!ev) return;
                if (ev.holds) holdsFromShell(ev.holds);
                if (ev.display) displayFromShell(ev.display);
                if (ev.switches) {
                    var s = switches();
                    for (var k in ev.switches) if (k in s) s[k] = ev.switches[k];
                    store.set(SWITCHES_KEY, s);
                }
                if (ev.key) keyFromShell(ev.key);
                if (ev.light) lightFromShell(ev.light);
                // The Power key while blocked (DisplayManager :2463-2476):
                // its subscribers hear it, nothing else does.
                if (ev.powerKey) {
                    powerKeySubs = live(powerKeySubs);
                    powerKeySubs.forEach(function (s) { s.reply({ powerKey: ev.powerKey }); });
                }
            },
            display: displayState,
            switches: switches,
            light: light,
            onWhenConnected: function () { return !!displayProps().onWhenConnected; }
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
    //                      highContrast, monoAudio, captions; the hardware
    //                      keyboard's stickyKeys, slowKeys (ms, 0 off),
    //                      bounceKeys (ms, 0 off), keyRepeatDelay /
    //                      keyRepeatInterval (ms; no delay: the keyboard's
    //                      own repeat)}
    //
    // com.palm.systemmanager (legacy webOS, luna-sysmgr SystemService.cpp):
    //   getBootStatus {subscribe}  -> {finished, firstUse}: firstUse while the
    //                      shell runs First Use (its minimal UI), as the
    //                      shell last said (applyHostStatus {firstUse})
    //   launchModalApp {subscribe, callerId, launchId, params}  launchId as a
    //                      modal card over the maximized caller's card:
    //                      {launchResult, modalId}, then launched or
    //                      {errorText, errorCode}, then {dismissResult}
    //   dismissModalApp {subscribe, modalId}  takes it away
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
        runtime.applyHostStatus = function (st, opts) {
            // The launcher's layout, as the shell keeps it: what
            // com.palm.sysMgrDataBackup backs up (see "Backup").
            if (st && typeof st.launcherLayout === "string")
                store.set("shell:launcherLayout", st.launcherLayout);
            if (st && "firstUse" in st && !!st.firstUse !== !!store.get("shell:firstUse", false)) {
                store.set("shell:firstUse", !!st.firstUse);
                changed();
            }
            // The debugging overlays, as the shell last said (getDebugOverlays).
            if (st && st.debugOverlays && toJson(st.debugOverlays) !== toJson(store.get("shell:debugOverlays", null))) {
                store.set("shell:debugOverlays", st.debugOverlays);
                changed();
            }
            baseApply(st, opts);
        };

        // ---- Debugging overlays, progress animations, turbo mode ------------------------
        //
        // luna-sysmgr SystemService.cpp:3605-3720, 2585-2690, 5305-5380:
        //   enableFpsCounter {enable?, reset?, dump?}  the frame rate counter at
        //       the bottom left (WindowServer.cpp:134-218, 1376-1409); reset
        //       and dump work on its history, which the shell keeps
        //   enableTouchPlot {collection?, trails?, crosshairs?}  the touch
        //       plot over everything (visual/TouchPlot.cpp)
        //       Both answer returnValue false when no key they know was given.
        //   runProgressAnimation {type: "msm" | "fsck" | other, state: "start" |
        //       "stop"}  the full-screen progress animation (ProgressAnimation.cpp;
        //       any other type is the boot logo's)
        //   subscribeTurboMode {subscribe}  the CPU boost is on while anyone
        //       is subscribed (HostBase::turboModeSubscription); Phoenix adds
        //       turboMode (true while subscribed) to the reply
        // and, Phoenix:
        //   getDebugOverlays {subscribe} -> {fpsCounter, touchPlot: {collection,
        //       trails, crosshairs}}: what the shell shows (Settings >
        //       Developer Mode's switches)
        // The shell does the drawing: the requests go to it as "debugOverlay"
        // and "progressAnimation" host messages; it reports its overlays back
        // as host status ({debugOverlays}).
        function debugOverlays() {
            var d = store.get("shell:debugOverlays", null) || {};
            var t = d.touchPlot || {};
            return { fpsCounter: !!d.fpsCounter, touchPlot: { collection: !!t.collection, trails: !!t.trails, crosshairs: !!t.crosshairs } };
        }
        sm["/enableFpsCounter"] = function (p, reply) {
            var req = {};
            if (typeof p.enable === "boolean") req.enable = p.enable;
            if (typeof p.reset === "number" && Math.floor(p.reset) === p.reset) req.reset = p.reset;
            if ("dump" in p) req.dump = true;
            if (!Object.keys(req).length) return reply({ returnValue: false });
            host.postToHost("debugOverlay", { fpsCounter: req });
            reply(ok());
        };
        sm["/enableTouchPlot"] = function (p, reply) {
            var req = {};
            ["collection", "trails", "crosshairs"].forEach(function (k) { if (typeof p[k] === "boolean") req[k] = p[k]; });
            if (!Object.keys(req).length) return reply({ returnValue: false });
            host.postToHost("debugOverlay", { touchPlot: req });
            reply(ok());
        };
        sm["/getDebugOverlays"] = function (p, reply, ctx) {
            watch(p, reply, ctx, function () { return ok(debugOverlays()); });
        };
        sm["/runProgressAnimation"] = function (p, reply) {
            if (typeof p.type !== "string" || typeof p.state !== "string") return reply({ returnValue: false });
            if (p.state !== "start" && p.state !== "stop") return reply({ returnValue: false });
            host.postToHost("progressAnimation", { type: p.type, state: p.state });
            reply(ok());
        };

        // ---- Touch to Share -----------------------------------------------------
        // The tap2share service (com.palm.stservice, not released) told the
        // system manager a phone was in range (the glow) and that an app's
        // data had gone (its card thrown): SystemService.cpp:5143-5296. In
        // phoenix-sim the shell plays a nearby phone (Shift+F7, Ctrl+F7) and
        // shareData here hands the app's data to it.
        sm["/touchToShareDeviceInRange"] = function (p, reply) {
            if (typeof p.inRange !== "boolean") return reply(fail(-1, "inRange (boolean) is required"));
            host.postToHost("touchToShare", { op: "inRange", inRange: p.inRange });
            reply(ok());
        };
        sm["/touchToShareAppUrlTransferred"] = function (p, reply) {
            if (typeof p.appid !== "string") return reply(fail(-1, "appid (string) is required"));
            host.postToHost("touchToShare", { op: "transferred", appId: p.appid });
            reply(ok());
        };
        // Modal cards (SystemService.cpp:4200-4600 launchModalApp,
        // 4030-4190 dismissModalApp): the calling app, maximized, launches
        // another as a 320 x 480 card over its own; on the subscription it
        // hears that the launch began ({launchResult, modalId}), then that
        // it was launched or why not ({errorText, errorCode}), then why the
        // modal card went ({dismissResult}). The shell decides
        // (CardView.addModal) and answers through modalStatus.
        var modalCalls = {}, modalCount = 0;
        sm["/launchModalApp"] = function (p, reply, ctx) {
            if (!p.subscribe) return reply(fail(-1, "Missing parameter: subscribe"));
            if (typeof p.callerId !== "string" || !p.callerId) return reply(fail(1, "Missing parameter: callerId"));
            if (typeof p.launchId !== "string" || !p.launchId) return reply(fail(1, "Missing parameter: launchId"));
            var modalId = "MODAL_WINDOW_" + p.callerId + "_" + p.launchId + "_" + (++modalCount);
            modalCalls[modalId] = { launch: reply, dismiss: null };
            reply(ok({ launchResult: "Modal window launch initiated", modalId: modalId, subscribed: true }));
            host.postToHost("launchModal", { modalId: modalId, callerId: p.callerId, launchId: p.launchId,
                                             params: p.params && typeof p.params === "object" ? p.params : null });
        };
        sm["/dismissModalApp"] = function (p, reply) {
            if (!p.subscribe) return reply(fail(-1, "Missing parameter: subscribe"));
            var m = typeof p.modalId === "string" ? modalCalls[p.modalId] : null;
            if (!m) return reply(fail(-1, "No modal window is active"));
            m.dismiss = reply;
            reply(ok({ dismissResult: "Initiating removal of active modal window", subscribed: true }));
            host.postToHost("dismissModal", { modalId: p.modalId });
        };
        // The shell: how the modal card modalId went.
        runtime.modalStatus = function (modalId, r) {
            var m = modalCalls[modalId];
            if (!m) return;
            m.launch(r);
            if (r && r.dismissResult !== undefined && m.dismiss) m.dismiss(r);
            if (!(r && r.returnValue === true && r.launchResult !== undefined)) delete modalCalls[modalId];
        };
        // An app answering {sendDataToShare} (the Isis browser:
        // {data: {target: url, type: "rawdata", mimetype: "text/html"}}).
        register(["com.palm.stservice"], {
            "/shareData": function (p, reply) {
                if (!p.data || typeof p.data !== "object") return reply(fail(-1, "data (object) is required"));
                host.postToHost("touchToShare", { op: "shareData", data: p.data });
                reply(ok());
            }
        });
        var turboSubscriptions = 0;
        sm["/subscribeTurboMode"] = function (p, reply, ctx) {
            if (!p.subscribe) return reply(ok({ subscribed: false, turboMode: turboSubscriptions > 0 }));
            turboSubscriptions++;
            var prev = ctx.onCancel;
            ctx.onCancel = function () {
                turboSubscriptions--;
                if (prev) prev();
            };
            reply(ok({ subscribed: true, turboMode: true }));
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
        // The shell, in the system UI's page: appId has closed (its last
        // card, nothing of it left running). The location alert raised for it
        // goes with it: an alert stands for its app, as one an app opens
        // itself closes with it (WebAppMgr closes all of an app's windows).
        // Unanswered, the app is asked again next time.
        runtime.appClosed = function (appId) {
            var w = null;
            var ew = global.enyo && global.enyo.windows;
            try { w = ew && ew.fetchWindow ? ew.fetchWindow("LocationAlert") : null; } catch (e) { w = null; }
            if (!w || w.closed) return false;
            var params = null;
            try { params = w.enyo && w.enyo.windowParams; } catch (e) { params = null; }
            if (!params || params.appId !== appId) return false;
            w.close();
            return true;
        };
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

        // Who asks: a service's own id (nodeServiceLuna), else the page's app.
        function callerOf(ctx) { return (ctx && ctx.caller) || appIdFromLocation(); }
        function tracking(p, reply, ctx) {
            var appId = callerOf(ctx);
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
        // Not OSE's (the legacy com.palm.location's, below): luna-service2's
        // answer to a method a service does not have, not "*"'s silent
        // success without a position (the Assistant asked this, 9 October 2026).
        location["/getCurrentPosition"] = function (p, reply) {
            reply(fail(-1, "Unknown method \"getCurrentPosition\" for category \"/\""));
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
        legacy["/getCurrentPosition"] = inSeconds(function (p, reply, ctx) { positionReply(p, reply, ctx, callerOf(ctx)); });
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
