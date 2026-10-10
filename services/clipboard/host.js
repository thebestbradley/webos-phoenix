// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The clipboard history's service half on a device: phoenix-runtime.js's own
// org.webosphoenix.clipboard (runtime/phoenix-runtime.js "Clipboard
// history"), the one implementation, run in a page of its own (a Node vm
// context standing in for a browser page), with:
//   - its store (the runtime's localStorage) in one file, 0600, written after
//     each change (the clips, the settings, the categories, the sealing key);
//   - Node's WebCrypto for the sensitive clips' AES-GCM. With no IndexedDB
//     the sealing key is kept in the store (as the runtime does in its unit
//     tests): on a device that is the service's own 0600 file, readable by
//     root only, instead of a non-extractable key in a browser profile
//     (docs/SECURITY-APPS.md, "Clipboard history" on a device);
//   - the device passcode (reveal) checked by the device's
//     com.palm.systemmanager (services/systemmanager), not the runtime's
//     simulated one;
//   - each call made as the app that sent it: the runtime takes the caller
//     from PalmSystem.appIdentifier (the system UI alone may paste a
//     sensitive clip without the passcode), which call() sets for the call.
//     On a device the system UI is two bus names: the shell
//     (luna-surfacemanager, com.webos.surfacemanager) and its keyboard, the
//     Phoenix keyboard in maliit-server (GAPS V5: its clip strip pastes a
//     password into a password field; Phoenix/Keyboard/KeyboardBus.qml), so
//     they call as "com.palm.systemui", as the system UI does in phoenix-sim.
// The pages' half (recording copies) is the runtime's on a device
// (installDevice), which sends them here with /add.
//
// createHost({runtimePath, storeFile, busCall(uri, params, cb)}) ->
//   {call(method, params, sender, respond, isSubscription) -> cancel()}
// STATUS: written against the runtime and its tests (host.test.ts); not yet
// run on a device.

"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var nodeCrypto = require("crypto");

function fileStorage(file) {
    var data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch (e) { data = {}; }
    var timer = null;
    function flush() {
        timer = null;
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 448 });
        fs.writeFileSync(file + ".new", JSON.stringify(data), { mode: 384 });
        fs.renameSync(file + ".new", file);
    }
    function later() {
        if (!timer)
            timer = setTimeout(flush, 0);
    }
    var api = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function (k, v) { data[String(k)] = String(v); later(); },
        removeItem: function (k) { delete data[k]; later(); },
        key: function (i) { return Object.keys(data)[i] || null; },
        clear: function () { data = {}; later(); },
        flush: function () { if (timer) { clearTimeout(timer); flush(); } }
    };
    Object.defineProperty(api, "length", { get: function () { return Object.keys(data).length; } });
    return api;
}

// A minimal page: what the runtime touches as it loads and as the
// clipboard service runs (no rendering, no copy events: the pages have those).
function target() {
    var listeners = {};
    return {
        addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener: function (t, fn) { listeners[t] = (listeners[t] || []).filter(function (f) { return f !== fn; }); },
        dispatchEvent: function (e) { (listeners[e.type] || []).slice().forEach(function (fn) { fn(e); }); return true; }
    };
}
function element() {
    var e = target();
    e.style = {};
    e.dataset = {};
    e.children = [];
    e.setAttribute = function () {};
    e.getAttribute = function () { return null; };
    e.appendChild = function (c) { return c; };
    e.removeChild = function (c) { return c; };
    e.querySelector = function () { return null; };
    e.querySelectorAll = function () { return []; };
    e.classList = { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} };
    return e;
}

// The bus names that are the system UI (above).
var SYSTEM_UI_SENDERS = ["com.webos.surfacemanager", "com.webos.service.ime.phoenixKeyboard"];

function createHost(opts) {
    var storage = fileStorage(opts.storeFile);
    var doc = target();
    doc.documentElement = element();
    doc.head = element();
    doc.body = element();
    doc.readyState = "complete";
    doc.title = "";
    doc.createElement = function () { return element(); };
    doc.createTextNode = function () { return element(); };
    doc.getElementById = function () { return null; };
    doc.getElementsByTagName = function () { return []; };
    doc.querySelector = function () { return null; };
    doc.querySelectorAll = function () { return []; };
    var win = target();
    var g = {
        document: doc,
        console: console,
        location: { pathname: "/usr/palm/services/org.webosphoenix.clipboard/", search: "", hash: "", href: "file:///usr/palm/services/org.webosphoenix.clipboard/",
                    protocol: "file:", host: "", hostname: "", origin: "file://" },
        navigator: { userAgent: "Phoenix clipboard service", language: "en-US", languages: ["en-US"] },
        localStorage: storage,
        sessionStorage: fileStorage("/dev/null/none"),
        crypto: nodeCrypto.webcrypto,
        btoa: function (s) { return Buffer.from(String(s), "binary").toString("base64"); },
        atob: function (s) { return Buffer.from(String(s), "base64").toString("binary"); },
        TextEncoder: TextEncoder, TextDecoder: TextDecoder,
        setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
        queueMicrotask: queueMicrotask,
        addEventListener: win.addEventListener, removeEventListener: win.removeEventListener, dispatchEvent: win.dispatchEvent,
        Event: function (type) { this.type = type; },
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
        getComputedStyle: function () { return {}; },
        matchMedia: function () { return { matches: false, addListener: function () {}, addEventListener: function () {} }; },
        requestAnimationFrame: function (fn) { return setTimeout(fn, 16); },
        XMLHttpRequest: function () {
            this.open = function () {};
            this.send = function () { var self = this; setTimeout(function () { if (self.onerror) self.onerror(); }, 0); };
            this.setRequestHeader = function () {};
        }
    };
    g.window = g;
    g.self = g;
    g.globalThis = g;
    // No shell to tell (the runtime posts the simulator's host messages).
    g.phoenixHost = { postToHost: function () {} };
    vm.createContext(g);
    vm.runInContext(fs.readFileSync(opts.runtimePath, "utf8"), g, { filename: opts.runtimePath });
    var runtime = g.__phoenixRuntime;
    if (!runtime || !runtime.services["org.webosphoenix.clipboard"])
        throw new Error("phoenix-runtime.js has no clipboard service");

    // The device passcode: the device's com.palm.systemmanager.
    var sm = runtime.services["com.palm.systemmanager"];
    sm["/matchDevicePasscode"] = function (p, reply) {
        opts.busCall("luna://com.palm.systemmanager/matchDevicePasscode", { passCode: String(p.passCode || "") }, function (r) {
            reply(r && typeof r === "object" ? r : { returnValue: false });
        });
    };

    var systemUi = opts.systemUiSenders || SYSTEM_UI_SENDERS;
    function call(method, params, sender, respond, isSubscription) {
        var cancelled = false;
        var ctx = { cancelled: function () { return cancelled; }, onCancel: null };
        var ps = g.PalmSystem;
        var was = ps.appIdentifier;
        // The caller, as the runtime sees it (the app id, without WebAppMgr's
        // " <process>" suffix).
        var id = String(sender || "").split(" ")[0];
        ps.appIdentifier = systemUi.indexOf(id) >= 0 ? "com.palm.systemui" : id;
        try {
            runtime.dispatch("luna://org.webosphoenix.clipboard/" + String(method).replace(/^\/+/, ""),
                             JSON.parse(JSON.stringify(params || {})),
                             function (r) { if (!cancelled) respond(JSON.parse(JSON.stringify(r))); }, ctx);
        } finally {
            ps.appIdentifier = was;
        }
        return function () {
            cancelled = true;
            if (typeof ctx.onCancel === "function")
                ctx.onCancel();
        };
    }

    // The screen locked or unlocked (com.palm.systemmanager getLockStatus):
    // the history goes on locking when Settings > Clipboard says so (the
    // runtime's applyHostStatus hook, as the shell's status reaches a page).
    function lockChanged(locked) {
        runtime.applyHostStatus({ deviceLocked: !!locked });
    }

    return { call: call, lockChanged: lockChanged, flush: storage.flush, runtime: runtime };
}

var METHODS = ["history", "subscribe", "add", "pin", "unpin", "setCategory", "update", "delete", "clear", "paste", "reveal",
               "addCategory", "renameCategory", "deleteCategory", "reorderCategories", "getSettings", "setSettings"];

module.exports = { createHost: createHost, METHODS: METHODS };
