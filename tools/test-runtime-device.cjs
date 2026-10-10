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
// still does not take is phoenixBack. Then what goes to the shell on the
// bus (org.webosphoenix.shellhost: banners, sounds, the edit popup, ...)
// and comes back from it (paste, card activation, the app menu), the
// PalmSystem calls WebAppMgr drops (neva's injection defines them,
// WebAppMgr ignores them) put in place, the page's own features (Edit in
// the app menu, links that leave the app), and the share sheet served in
// the page with the rest on the bus.
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
    constructor(parent) {
        this.parent = parent || null;
        this.listeners = {};
        this.style = {};
        this.children = [];
        this.attrs = {};
        this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    }
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    closest(sel) {
        for (let t = this; t; t = t.parent)
            if (sel.indexOf("a[href]") >= 0 && t.tagName === "A" && t.href) return t;
        return null;
    }
    focus() {}
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
// opts.wamPalmSystem: WebAppMgr's own no-op methods on PalmSystem, as neva's
// injection defines them.
function page(appId, appinfo, launchParams, opts) {
    opts = opts || {};
    const props = [];
    const calls = [];
    const timers = [];
    const commands = [];
    const win = new Target(null);
    const doc = new Target(win);
    const body = new Target(doc);
    const head = new Target(doc);
    doc.body = body;
    doc.head = head;
    doc.activeElement = body;
    doc.documentElement = new Target(doc);
    doc.readyState = "complete";
    doc.createElement = (tag) => { const t = new Target(null); t.tagName = String(tag).toUpperCase(); return t; };
    doc.querySelector = () => null;
    doc.querySelectorAll = () => [];
    doc.getElementsByTagName = () => [];
    doc.getElementById = (id) => head.children.find((c) => c.id === id) || null;
    doc.execCommand = (cmd, ui, value) => { commands.push([cmd, value]); return false; };
    function NativeBridge() {
        this.call = (url, json) => { calls.push({ url, json: JSON.parse(json), bridge: this }); return 1; };
        this.cancel = () => { this.cancelled = true; };
    }
    const wam = {};
    if (opts.wamPalmSystem) {
        for (const name of ["setWindowOrientation", "enableFullScreenMode", "addBannerMessage", "removeBannerMessage",
                            "clearBannerMessages", "paste", "simulateMouseClick", "keyboardShow"])
            wam[name] = () => { wam.dropped = (wam.dropped || 0) + 1; return ""; };
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
        PalmSystem: Object.assign({ launchParams: JSON.stringify(launchParams || {}), identifier: appId + " 0" }, wam),
        webOSSystem: { window: { setProperty: (k, v) => props.push([k, v]) } },
        XMLHttpRequest: XHR,
        KeyboardEvent: FakeEvent, Event: FakeEvent, CustomEvent: FakeEvent,
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout: () => {},
        addEventListener: (t, fn) => win.addEventListener(t, fn),
        removeEventListener: (t, fn) => win.removeEventListener(t, fn),
        dispatchEvent: (e) => win.dispatchEvent(e),
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        getComputedStyle: () => ({ userSelect: "auto" }),
        TextEncoder, TextDecoder, URL, Promise, JSON, Object, Array, Date, Math, RegExp, String, Number, Boolean, Error
    };
    if (opts.parent) g.top = opts.parent;
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
    // The calls to url (without the scheme), and an answer to the last one.
    const strip = (u) => u.replace(/^(palm|luna):\/\//, "");
    function callsTo(url) { return calls.filter((c) => strip(c.url) === strip(url)); }
    function reply(url, obj) {
        const c = callsTo(url).pop();
        if (c && c.bridge.onservicecallback) c.bridge.onservicecallback(JSON.stringify(obj));
        return !!c;
    }
    // What this page posted to the shell.
    function posts(type) {
        return callsTo("luna://org.webosphoenix.shellhost/post").map((c) => c.json).filter((j) => !type || j.type === type);
    }
    // An event from the shell, as org.webosphoenix.shellhost/events sends it.
    function shellEvent(type, payload) {
        return reply("luna://org.webosphoenix.shellhost/events", { returnValue: true, subscribed: true, event: { type, payload: payload || {} } });
    }
    return { g, win, doc, body, head, props, calls, commands, wam, run, prop, callsTo, reply, posts, shellEvent };
}

// ---- The bridge: names and {returnToCaller} --------------------------------------

{
    const p = page("org.webosphoenix.assistant", { id: "org.webosphoenix.assistant" });
    check(p.g.__phoenixRuntime && p.g.__phoenixRuntime.onDevice === true, "the runtime sees WebAppMgr (onDevice)");
    const b = new p.g.PalmServiceBridge();
    const before = p.calls.length;
    b.call("palm://com.palm.applicationManager/launch",
           JSON.stringify({ id: "org.webosphoenix.photos", params: { photo: 3 }, returnToCaller: true }));
    const c = p.calls[before];
    check(c && c.url === "palm://com.palm.applicationManager/launch",
          "com.palm.applicationManager stays: Phoenix's legacy service on OSE (services/appmanager)");
    check(c && c.json.params.$caller === "org.webosphoenix.assistant" && c.json.params.photo === 3,
          "{returnToCaller}: the caller rides in params.$caller");
    check(c && c.json.returnToCaller === undefined, "returnToCaller itself is not passed on (SAM has no such key)");
    b.call("luna://com.webos.applicationManager/launch", JSON.stringify({ id: "org.webosphoenix.photos", params: {} }));
    check(p.calls[before + 1].json.params.$caller === undefined, "a launch without it carries no $caller");
    b.call("luna://com.webos.applicationManager/launch",
           JSON.stringify({ id: "org.webosphoenix.photos", params: {}, returnToCaller: true }));
    check(p.calls[before + 2].json.params.$caller === "org.webosphoenix.assistant", "the same through SAM's own name");
    b.call("luna://com.palm.systemservice/getPreferences", JSON.stringify({ keys: ["x"] }));
    check(p.calls[before + 3].url === "luna://com.webos.service.systemservice/getPreferences", "systemservice's OSE name");
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

// ---- What WebAppMgr drops: PalmSystem's methods it defines and ignores ------------------

{
    const p = page("com.palm.app.clock", { id: "com.palm.app.clock" }, {}, { wamPalmSystem: true });
    p.run();
    const ps = p.g.PalmSystem;
    ps.setWindowOrientation("left");
    ps.enableFullScreenMode(true);
    check(p.prop("phoenixOrientation") === "left" && p.prop("phoenixFullScreen") === "true",
          "WebAppMgr's own setWindowOrientation / enableFullScreenMode (no-ops) are replaced");
    ps.addBannerMessage("Alarm", "{}", "images/alarm.png", "alarm", "", 0);
    check(!p.wam.dropped, "nothing goes to WebAppMgr's dropped commands");
    check(p.g.PalmSystem.appIdentifier === "com.palm.app.clock", "PalmSystem.appIdentifier is the app (the runtime's name for it)");
}

// ---- The shell's line: org.webosphoenix.shellhost --------------------------------------

{
    const p = page("com.palm.app.email", { id: "com.palm.app.email" });
    p.run();
    const ev = p.callsTo("luna://org.webosphoenix.shellhost/events");
    check(ev.length === 1 && ev[0].json.subscribe === true, "the card's page listens to the shell's events");
    const framed = page("com.palm.app.email", { id: "com.palm.app.email" }, {}, { parent: {} });
    framed.run();
    check(framed.callsTo("luna://org.webosphoenix.shellhost/events").length === 0, "a frame in the card does not");

    p.g.phoenixHost.postToHost("notification", { title: "New mail" });
    const n = p.posts("notification");
    check(n.length === 1 && n[0].payload.title === "New mail", "phoenixHost.postToHost goes to shellhost/post {type, payload}");

    const ps = p.g.PalmSystem;
    const id = ps.addBannerMessage("2 new messages", "{\"folder\":\"inbox\"}", "images/notification-small.png", "notifications", "", 0);
    const b = p.posts("banner")[0];
    check(typeof id === "string" && b && b.payload.id === id && b.payload.appId === "com.palm.app.email"
          && b.payload.message === "2 new messages" && b.payload.params === "{\"folder\":\"inbox\"}"
          && b.payload.soundClass === "notifications",
          "addBannerMessage: a banner for the shell, its id returned");
    check(b.payload.icon === "/usr/palm/applications/com.palm.app.email/images/notification-small.png",
          "a banner's relative icon is the app's file");
    ps.removeBannerMessage(id);
    ps.clearBannerMessages();
    check(p.posts("removeBanner")[0].payload.id === id && p.posts("clearBanners").length === 1, "removeBannerMessage, clearBannerMessages");
    ps.playSoundNotification("alerts", "/usr/palm/sounds/alert.mp3", 2000);
    check(p.posts("sound")[0].payload.soundFile === "/usr/palm/sounds/alert.mp3", "playSoundNotification: a sound for the shell");
    check(ps.runTextIndexer("mail ada@example.com").indexOf("<a href=\"mailto:ada@example.com\">") >= 0,
          "PalmSystem.runTextIndexer (WebAppMgr has none)");

    // From the shell.
    let active = null;
    p.win.addEventListener("phoenixcardactivation", (e) => { active = e.detail.active; });
    p.shellEvent("cardActivation", { active: false });
    check(active === false, "the shell's cardActivation: a phoenixcardactivation event");
    let toggled = 0;
    p.g.enyo = { appMenu: { toggle: () => toggled++ } };
    p.shellEvent("openAppMenu", {});
    check(toggled === 1, "the shell's openAppMenu: Enyo's app menu");
    check(p.shellEvent("nosuchevent", {}) && true, "an event the page does not know is ignored");
}

// ---- Paste: the newest copy in the clipboard history -------------------------------------

{
    const p = page("com.palm.app.memos", { id: "com.palm.app.memos" });
    p.run();
    p.shellEvent("editAction", { action: "paste" });
    check(p.commands.length === 1 && p.commands[0][0] === "paste", "paste tries Chromium's own paste first");
    const h = p.callsTo("luna://org.webosphoenix.clipboard/history");
    check(h.length === 1 && h[0].json.limit === 1, "then asks the clipboard history for its newest copy");
    p.reply("luna://org.webosphoenix.clipboard/history", { returnValue: true, clips: [{ id: "c7", type: "text", text: "Hi" }] });
    const pc = p.callsTo("luna://org.webosphoenix.clipboard/paste");
    check(pc.length === 1 && pc[0].json.id === "c7", "and its text (paste {id})");
    p.reply("luna://org.webosphoenix.clipboard/paste", { returnValue: true, clip: { id: "c7", text: "Hello there" } });
    check(p.commands.length === 2 && p.commands[1][0] === "insertText" && p.commands[1][1] === "Hello there",
          "which goes into the field as typed text");
    p.g.PalmSystem.paste();
    check(p.callsTo("luna://org.webosphoenix.clipboard/history").length === 2, "PalmSystem.paste does the same");

    // A long press (Chromium's context menu) in a field: the shell's edit popup.
    p.g.innerWidth = 320;
    const field = new Target(p.body);
    field.tagName = "TEXTAREA";
    field.value = "";
    field.getBoundingClientRect = () => ({ left: 10, top: 40, width: 300, height: 30 });
    p.g.getSelection = () => ({ rangeCount: 0, toString: () => "" });
    let prevented = false;
    p.doc.dispatchEvent(Object.assign(new FakeEvent("contextmenu", {}), { target: field, clientX: 50, preventDefault() { prevented = true; } }));
    const m = p.posts("editMenu")[0];
    check(prevented && m && m.payload.x === 50 && m.payload.y === 40 && m.payload.height === 30 && m.payload.viewportWidth === 320
          && m.payload.canPaste === false && m.payload.appId === "com.palm.app.memos",
          "a long press in a field asks the shell for the edit popup (contextmenu -> editMenu, with the viewport's width)");
}

// ---- The page's own features ----------------------------------------------------------------

{
    const p = page("com.palm.app.contacts", { id: "com.palm.app.contacts" });
    p.run();
    const rt = p.g.__phoenixRuntime;
    check(typeof rt.editState === "function" && typeof rt.edit === "function" && typeof rt.shareContent === "function",
          "Edit and Share are the page's (runtime.edit, editState, shareContent)");
    function AppMenu() {}
    AppMenu.prototype.initComponents = function () {};
    p.g.enyo = {};
    p.g.enyo.AppMenu = AppMenu;
    check(AppMenu.prototype.__phoenixEditMenu === true, "Enyo 1.0's app menu gets Edit (and Share) as Enyo defines it");
    check(p.head.children.some((c) => c.id === "phoenix-backdrop-blur"), "the 2011 apps' popup blur style is in the page");

    // A link to another site opens in its app, through the legacy application manager.
    const a = new Target(p.body);
    a.tagName = "A";
    a.href = "https://www.example.org/news";
    let prevented = false;
    p.win.dispatchEvent(Object.assign(new FakeEvent("click", {}), { target: a, button: 0, preventDefault() { prevented = true; } }));
    const open = p.callsTo("luna://com.palm.applicationManager/open");
    check(prevented && open.length === 1 && open[0].json.target === "https://www.example.org/news",
          "a link that leaves the app: com.palm.applicationManager/open {target}");

    // Scene transitions: the shell snapshots the card.
    let settled = false;
    p.g.PalmSystem.prepareSceneTransition(false).then(() => { settled = true; });
    check(p.posts("sceneTransition")[0].payload.op === "prepare", "prepareSceneTransition: the shell is asked for a snapshot");
    p.shellEvent("sceneTransitionPrepared", {});
    setImmediate(() => check(settled, "the shell's sceneTransitionPrepared lets the page go on"));
}

// ---- Legacy names, and com.palm.power's timeouts ------------------------------------------

{
    const p = page("com.palm.app.calendar", { id: "com.palm.app.calendar" });
    p.run();
    const b = new p.g.PalmServiceBridge();
    b.call("palm://com.palm.activitymanager/create", JSON.stringify({ activity: { name: "x" } }));
    b.call("palm://com.palm.downloadmanager/download", JSON.stringify({ target: "http://x/y" }));
    check(p.callsTo("luna://com.webos.service.activitymanager/create").length === 1
          && p.callsTo("luna://com.webos.service.downloadmanager/download").length === 1,
          "com.palm.activitymanager and com.palm.downloadmanager: OSE's names");
    let answer = null;
    b.onservicecallback = (j) => { answer = JSON.parse(j); };
    b.call("palm://com.palm.power/timeout/set", JSON.stringify({ key: "rem", uri: "palm://com.palm.app.calendar/alarm", at: "10/11/2026 07:30:00" }));
    p.run();
    const c = p.callsTo("luna://com.webos.service.activitymanager/create").pop();
    check(c && c.json.activity.name === "timeout:rem" && c.json.activity.schedule.start === "2026-10-11 07:30:00Z"
          && c.json.activity.callback.method === "palm://com.palm.app.calendar/alarm",
          "com.palm.power timeout/set: an activity of the activity manager");
    p.reply("luna://com.webos.service.activitymanager/create", { returnValue: true, activityId: 7 });
    check(answer && answer.returnValue === true && answer.key === "rem", "and the legacy reply {key}");
    b.call("palm://com.palm.power/com/palm/power/batteryStatusQuery", "{}");
    p.run();
    check(p.callsTo("luna://com.palm.power/com/palm/power/batteryStatusQuery").length === 1, "the rest of com.palm.power is on the bus");
}

// ---- Just Type's page (com.palm.launcher) -------------------------------------------------

{
    const p = page("com.palm.launcher", { id: "com.palm.launcher" });
    p.run();
    let hidden = 0;
    p.g.PalmSystem.hide = () => { hidden++; };
    const log = [];
    let value = "";
    const node = { setSelectionRange: (a, b) => log.push(["sel", a, b]) };
    const field = { setValue: (v) => { value = v; }, getValue: () => value, $: { input: { hasNode: () => node } } };
    const jt = { $: { searchField: field }, forceFocus: () => log.push(["focus"]), onValueChange: (a, b, v) => log.push(["search", v]),
                 justTypeDeactivated: () => log.push(["off"]) };
    // The shell's start may come before Enyo has made the page.
    p.shellEvent("justType", { op: "start", text: "pa" });
    p.g.enyo = { $: { justTypeApp: { $: { justType: jt } } } };
    p.run();
    check(value === "pa" && log[0][0] === "focus" && log.some((l) => l[0] === "search" && l[1] === "pa"),
          "Just Type: the shell's start puts the text in the page's field (once the page is made)");
    p.shellEvent("justType", { op: "type", text: "lm" });
    check(value === "palm" && log.some((l) => l[0] === "sel" && l[1] === 4), "Just Type: more text goes at the end, the cursor after it");
    p.shellEvent("justType", { op: "stop" });
    check(log[log.length - 1][0] === "off" && hidden === 1, "Just Type: stop deactivates the page and hides its window");
    p.g.enyo.appMenu = { isOpen: true, close() { this.isOpen = false; } };
    p.shellEvent("justType", { op: "back" });
    check(p.posts("justTypeDismiss").length === 0 && !p.g.enyo.appMenu.isOpen, "Just Type: Back closes its app menu first");
    p.shellEvent("justType", { op: "back" });
    check(p.posts("justTypeDismiss").length === 1, "Just Type: then Back says the shell may close it");
}

// ---- The share sheet: served in the page, the rest on the bus ---------------------------------

const asyncChecks = (async () => {
    const p = page("org.webosphoenix.photos", { id: "org.webosphoenix.photos" });
    p.run();
    const b = new p.g.PalmServiceBridge();
    let answer = null;
    b.onservicecallback = (json) => { answer = JSON.parse(json); };
    b.call("luna://org.webosphoenix.share/targets", JSON.stringify({ types: ["image/png"] }));
    check(p.callsTo("luna://org.webosphoenix.share/targets").length === 0, "org.webosphoenix.share is answered in the page, not sent");
    p.run();
    const la = p.callsTo("luna://com.webos.applicationManager/listApps");
    check(la.length === 1 && la[0].json.properties.indexOf("phoenix") >= 0, "the apps that take a share: SAM's listApps with appinfo's phoenix");
    p.reply("luna://com.webos.applicationManager/listApps", { returnValue: true, apps: [
        { id: "org.webosphoenix.messaging", title: "Messaging", icon: "icon.png", folderPath: "/usr/palm/applications/org.webosphoenix.messaging",
          phoenix: { shareTargets: [{ types: ["image/*", "text/plain"] }] } },
        { id: "org.webosphoenix.music", title: "Music", phoenix: { shareTargets: [{ types: ["audio/*"] }] } },
        { id: "com.palm.app.email", title: "Email" }
    ] });
    await new Promise((r) => setImmediate(r));
    p.run();
    await new Promise((r) => setImmediate(r));
    check(answer && answer.returnValue === true && answer.targets.map((t) => t.appId).join() === "com.palm.app.email,org.webosphoenix.messaging",
          "share/targets: the apps that take pictures (Email's legacy entry too)");
    check(answer && answer.targets[1].icon === "/usr/palm/applications/org.webosphoenix.messaging/icon.png", "with their icons' paths");
})();

asyncChecks.then(() => setImmediate(() => {
    if (failures) {
        console.log(failures + " failed");
        process.exit(1);
    }
    console.log("all passed");
}), (e) => { console.error(e); process.exit(1); });
