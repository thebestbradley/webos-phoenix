#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-runtime.js on a device (installDevice): runs the runtime in a page
// that looks like WebAppMgr's (PalmServiceBridge, PalmSystem with
// setWindowProperty, webOSSystem.window.setProperty) and checks what it tells
// the shell through window properties (shell/qml/Phoenix/Lsm/LsmCards.js has
// the list): the launch's $caller for {returnToCaller}, phoenixReturnTo,
// PalmSystem.setWindowOrientation / enableFullScreenMode /
// setWindowProperties, appinfo's requestedWindowOrientation, and Back: the
// webOS Back key (461) a page does not take goes on as Escape, and one it
// still does not take is phoenixBack.
//
//   node tools/test-runtime-device.cjs
//
// Plain Node (vm), no browser: the page's DOM is a small stand-in.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RUNTIME = fs.readFileSync(path.join(__dirname, "..", "runtime", "phoenix-runtime.js"), "utf8");

let failures = 0;
function check(cond, what) {
    if (cond) {
        console.log("ok   " + what);
    } else {
        failures++;
        console.log("FAIL " + what);
    }
}

class FakeEvent {
    constructor(type, init) {
        init = init || {};
        this.type = type;
        Object.assign(this, init);
        this.defaultPrevented = false;
        this.cancelable = init.cancelable !== false;
    }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}

class Target {
    constructor(parent) { this.parent = parent || null; this.listeners = {}; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
    }
    dispatchEvent(e) {
        for (let t = this; t; t = t.parent)
            for (const fn of (t.listeners[e.type] || []).slice())
                fn.call(t, e);
        return !e.defaultPrevented;
    }
}

// A page of app appId whose appinfo.json is appinfo, launched with params.
function page(appId, appinfo, launchParams) {
    const props = [];
    const calls = [];
    const timers = [];
    const win = new Target(null);
    const doc = new Target(win);
    const body = new Target(doc);
    doc.body = body;
    doc.activeElement = body;
    doc.documentElement = new Target(doc);
    doc.readyState = "complete";
    doc.createElement = () => new Target(null);
    doc.querySelector = () => null;
    doc.querySelectorAll = () => [];
    doc.getElementsByTagName = () => [];
    function NativeBridge() {
        this.call = (url, json) => { calls.push({ url, json: JSON.parse(json) }); return 1; };
        this.cancel = () => {};
    }
    class XHR {
        open(method, url) { this.url = url; }
        send() {
            const self = this;
            const want = "file:///usr/palm/applications/" + appId + "/appinfo.json";
            timers.push(() => {
                if (self.url === want && appinfo) {
                    self.status = 200;
                    self.responseText = JSON.stringify(appinfo);
                    if (self.onload) self.onload();
                } else if (self.onerror) {
                    self.onerror();
                }
            });
        }
    }
    const g = {
        window: null, document: doc, console,
        location: { pathname: "/usr/palm/applications/" + appId + "/index.html", search: "", href: "file:///usr/palm/applications/" + appId + "/index.html", protocol: "file:" },
        navigator: { userAgent: "WebAppManager" },
        PalmServiceBridge: NativeBridge,
        PalmSystem: { launchParams: JSON.stringify(launchParams || {}), identifier: appId + " 0" },
        webOSSystem: { window: { setProperty: (k, v) => props.push([k, v]) } },
        XMLHttpRequest: XHR,
        KeyboardEvent: FakeEvent, Event: FakeEvent, CustomEvent: FakeEvent,
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout: () => {},
        addEventListener: (t, fn) => win.addEventListener(t, fn),
        removeEventListener: (t, fn) => win.removeEventListener(t, fn),
        dispatchEvent: (e) => win.dispatchEvent(e),
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        TextEncoder, TextDecoder, Promise, JSON, Object, Array, Date, Math, RegExp, String, Number, Boolean, Error
    };
    g.window = g;
    g.self = g;
    g.globalThis = g;
    vm.createContext(g);
    vm.runInContext(RUNTIME, g, { filename: "phoenix-runtime.js" });
    function run() {
        while (timers.length)
            timers.shift()();
    }
    function prop(name) {
        let v;
        for (const [k, val] of props)
            if (k === name) v = val;
        return v;
    }
    return { g, win, doc, body, props, calls, run, prop };
}

// ---- The bridge: names and {returnToCaller} --------------------------------------

{
    const p = page("org.webosphoenix.assistant", { id: "org.webosphoenix.assistant" });
    check(p.g.__phoenixRuntime && p.g.__phoenixRuntime.onDevice === true, "the runtime sees WebAppMgr (onDevice)");
    const b = new p.g.PalmServiceBridge();
    b.call("palm://com.palm.applicationManager/launch",
           JSON.stringify({ id: "org.webosphoenix.photos", params: { photo: 3 }, returnToCaller: true }));
    const c = p.calls[0];
    check(c && c.url === "palm://com.webos.applicationManager/launch", "com.palm.applicationManager goes to OSE's name");
    check(c && c.json.params.$caller === "org.webosphoenix.assistant" && c.json.params.photo === 3,
          "{returnToCaller}: the caller rides in params.$caller");
    check(c && c.json.returnToCaller === undefined, "returnToCaller itself is not passed on (SAM has no such key)");
    b.call("luna://com.webos.applicationManager/launch", JSON.stringify({ id: "org.webosphoenix.photos", params: {} }));
    check(p.calls[1].json.params.$caller === undefined, "a launch without it carries no $caller");
    b.call("luna://com.palm.systemservice/getPreferences", JSON.stringify({ keys: ["x"] }));
    check(p.calls[2].url === "luna://com.webos.service.systemservice/getPreferences", "systemservice's OSE name");
}

// ---- Window properties ----------------------------------------------------------------

{
    const p = page("org.webosphoenix.photos", { id: "org.webosphoenix.photos", requestedWindowOrientation: "Landscape",
                                                disableBackHistoryAPI: true },
                   { $caller: "org.webosphoenix.assistant", photo: 3 });
    check(p.prop("phoenixReturnTo") === "org.webosphoenix.assistant", "phoenixReturnTo: the caller from the launch params");
    p.run();
    check(p.prop("phoenixOrientation") === "landscape", "appinfo requestedWindowOrientation as phoenixOrientation");
    const ps = p.g.PalmSystem;
    ps.setWindowOrientation("left");
    check(p.prop("phoenixOrientation") === "left", "PalmSystem.setWindowOrientation");
    ps.setWindowOrientation("sideways");
    check(p.prop("phoenixOrientation") === "free", "an orientation it does not know is free");
    ps.enableFullScreenMode(true);
    check(p.prop("phoenixFullScreen") === "true", "enableFullScreenMode(true)");
    ps.enableFullScreenMode(false);
    check(p.prop("phoenixFullScreen") === "false", "enableFullScreenMode(false)");
    ps.setWindowProperties({ statusBarColor: 0x1a2b3c, blockScreenTimeout: true });
    check(p.prop("phoenixStatusBarColor") === String(0x1a2b3c), "setWindowProperties {statusBarColor}");
    check(p.prop("phoenixBlockScreenTimeout") === "true", "setWindowProperties {blockScreenTimeout}");

    // Relaunched by another app, without a caller.
    ps.launchParams = JSON.stringify({ photo: 4 });
    p.doc.dispatchEvent(new FakeEvent("webOSRelaunch", {}));
    p.run();
    check(p.prop("phoenixReturnTo") === "", "a relaunch without $caller clears phoenixReturnTo");
}

// ---- Back --------------------------------------------------------------------------

{
    const p = page("com.palm.app.calculator", { id: "com.palm.app.calculator", disableBackHistoryAPI: true });
    p.run();
    let escapes = 0;
    let take = true;
    p.body.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            escapes++;
            if (take)
                e.preventDefault();
        }
    });
    p.body.dispatchEvent(new FakeEvent("keydown", { keyCode: 461, key: "GoBack", bubbles: true }));
    p.run();
    check(escapes === 1, "the Back key a page does not take goes on as Escape");
    check(p.prop("phoenixBack") === undefined, "Escape taken: nothing for the shell");
    take = false;
    p.body.dispatchEvent(new FakeEvent("keydown", { keyCode: 461, key: "GoBack", bubbles: true }));
    p.run();
    const first = p.prop("phoenixBack");
    check(typeof first === "string" && first !== "", "Back not taken at all: phoenixBack for the shell");
    p.body.dispatchEvent(new FakeEvent("keydown", { keyCode: 461, key: "GoBack", bubbles: true }));
    p.run();
    check(p.prop("phoenixBack") !== first, "each Back not taken is a new phoenixBack");
    // The page stops the key itself.
    const before = p.props.length;
    p.body.addEventListener("keydown", function stop(e) { if (e.keyCode === 461) e.preventDefault(); });
    p.body.dispatchEvent(new FakeEvent("keydown", { keyCode: 461, key: "GoBack", bubbles: true }));
    p.run();
    check(p.props.length === before, "a Back the page takes says nothing");
}

{
    // An app with WebAppMgr's history API (not disableBackHistoryAPI): the
    // key comes only while its history can go back, which WebAppMgr does.
    const p = page("com.example.enact", { id: "com.example.enact" });
    p.run();
    p.body.dispatchEvent(new FakeEvent("keydown", { keyCode: 461, key: "GoBack", bubbles: true }));
    p.run();
    check(p.prop("phoenixBack") === undefined, "history API apps: Back is WebAppMgr's");
}

// ---- The clipboard history: copies go to the service on the bus --------------------------

{
    const p = page("org.webosphoenix.passwords", { id: "org.webosphoenix.passwords" });
    p.run();
    const field = new Target(p.doc);
    field.tagName = "INPUT";
    field.value = "hello clipboard";
    field.selectionStart = 6;
    field.selectionEnd = 15;
    p.doc.activeElement = field;
    p.win.dispatchEvent(new FakeEvent("copy", {}));
    const add = p.calls.filter((c) => c.url === "luna://org.webosphoenix.clipboard/add");
    check(add.length === 1 && add[0].json.text === "clipboard" && !add[0].json.sensitive,
          "a copy goes to org.webosphoenix.clipboard/add with the selected text");
    p.g.__phoenixRuntime.clipboard.markSensitive("s3cret!", "password");
    p.g.__phoenixRuntime.recordCopy("s3cret!");
    const last = p.calls.filter((c) => c.url === "luna://org.webosphoenix.clipboard/add").pop();
    check(last.json.sensitive === true && last.json.kind === "password", "a copy an app marked a secret goes as sensitive");
    p.g.__phoenixRuntime.recordCopy("   ");
    check(p.calls.filter((c) => c.url === "luna://org.webosphoenix.clipboard/add").length === 2, "nothing for an empty copy");
}

if (failures) {
    console.log(failures + " failed");
    process.exit(1);
}
console.log("all passed");
