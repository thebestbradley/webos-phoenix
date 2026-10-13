// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A script of an app's own in a page view it shows (WebAppWindow.qml's
// native views, the runtime's BrowserAdapter "setPageBridge"), and messages
// both ways between it and the app. Pure functions, so the window and the
// tests (tst_pagebridge.qml) share them.
//
// BrowserAdapter had nothing like it; it is what Android's WebView gives
// an app for its own web views (addJavascriptInterface, evaluateJavascript)
// and iOS's WKWebView (WKUserScript, WKScriptMessageHandler), which Home
// Assistant's companion apps build their external bus and external
// authentication on (developers.home-assistant.io/docs/frontend/
// external-bus, .../external-authentication): Phoenix's Home app does the
// same through this (phoenix-default-apps apps/homeassistant).
//
// The rules:
//   - the script runs in the page's own world (the page's scripts see what
//     it defines: window.externalApp), as the page starts
//     (DocumentCreation), in the top frame only, and only on pages of the
//     one origin the app named (the server it shows), whatever the view
//     goes to afterwards;
//   - its messages ride on the page's console, as the link script's
//     (Links.js) do, each with a secret the runtime made for this view
//     (nonce), which the script keeps in a closure: a frame of another
//     site in the page, or a page of another origin the view goes to,
//     cannot speak for it;
//   - the shell passes a message on, either way, only while the view shows
//     a page of that origin; what the app sends must be JSON (it becomes a
//     literal in the page, never code).

.pragma library

var PREFIX = "__phoenix_bridge__";

// scheme://host[:port] of an http(s) address, lower case, without a
// default port (URL.origin's), or "" for anything else.
function originOf(url) {
    var m = /^(https?):\/\/(?:[^\/?#@]*@)?([^\/?#]+)/i.exec(String(url || ""));
    if (!m)
        return "";
    var scheme = m[1].toLowerCase(), host = m[2].toLowerCase();
    if ((scheme === "http" && /:80$/.test(host)) || (scheme === "https" && /:443$/.test(host)))
        host = host.replace(/:\d+$/, "");
    return scheme + "://" + host;
}

// An origin as the app must name it: exactly what originOf gives.
function validOrigin(origin) {
    return typeof origin === "string" && origin !== "" && originOf(origin) === origin && /^https?:\/\/[^\/?#@\s]+$/.test(origin);
}

// A secret long enough not to be guessed (the runtime's, from crypto).
function validNonce(nonce) {
    return typeof nonce === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(nonce);
}

// The app's script, wrapped to keep the rules above. It runs as a function
// of `bridge`: bridge.post(value) sends a JSON value to the app,
// bridge.onMessage(fn) hears the app's.
function wrap(script, origin, nonce) {
    return "(function () {\n" +
        "'use strict';\n" +
        "if (window.top !== window || location.origin !== " + JSON.stringify(origin) + ") return;\n" +
        "var log = console.log.bind(console), stringify = JSON.stringify, tag = " + JSON.stringify(PREFIX + nonce + ":") + ";\n" +
        "var receiver = null;\n" +
        "var bridge = Object.freeze({\n" +
        "  post: function (m) { log(tag + stringify(m)); },\n" +
        "  onMessage: function (fn) { receiver = typeof fn === 'function' ? fn : null; }\n" +
        "});\n" +
        "Object.defineProperty(window, '__phoenixPageBridge', { value: Object.freeze({\n" +
        "  receive: function (m) { if (receiver) receiver(m); }\n" +
        "}) });\n" +
        "(function (bridge) {\n" + String(script) + "\n}).call(window, bridge);\n" +
        "})();";
}

// A console message that is a bridge's (any view's: kept out of the log).
function isBridgeMessage(text) {
    return String(text).indexOf(PREFIX) === 0;
}

// The JSON a message of this view's script carries, or null (not this
// view's, or not JSON).
function message(text, nonce) {
    text = String(text);
    var tag = PREFIX + nonce + ":";
    if (!validNonce(nonce) || text.indexOf(tag) !== 0)
        return null;
    var json = text.substring(tag.length);
    try {
        JSON.parse(json);
    } catch (e) {
        return null;
    }
    return json;
}

// The snippet that hands the app's message (JSON text) to the page's
// script, or "" when it is not JSON.
function deliverScript(json) {
    var literal;
    try {
        literal = JSON.stringify(JSON.parse(String(json)));
    } catch (e) {
        return "";
    }
    if (literal === undefined)
        return "";
    return "window.__phoenixPageBridge && window.__phoenixPageBridge.receive(" + literal + ")";
}
