// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// novad on a device: org.webosphoenix.nova's Luna methods (novaservice.js)
// and, while Developer Mode is on, the TLS server nova talks to
// (lib/proto.js), on port 6965:
//   - "USB debugging" (on by default): on the USB network link's address
//     (the CDC NCM gadget Developer Mode makes, docs/DEV-PUSH.md 6.2:
//     /etc/phoenix/nova.json "usbAddress", P3);
//   - "Push over network" (off by default): on every address, answering
//     only private ones (lib/proto.js isPrivate), and the USB link while
//     "USB debugging" is on (one listener, lib/listeners.js).
// It runs as root, long-running (novad.service, P3; not started on demand
// by the hub, as it listens): it mounts the developer overlay, writes into
// it and restarts what a bundle changes.
//
// /etc/phoenix/nova.json (P3, optional): {"usbAddress", "shellUnit",
// "wamUnit", "authorizedKeys"}: what the image's units and gadget are
// called, until local confirms them on the image (DEV-PUSH 4.5, 11).

"use strict";

var fs = require("fs");
var Service = require("webos-service");
var nova = require("./novaservice");
var proto = require("./lib/proto");
var createListeners = require("./lib/listeners").createListeners;
var system = require("./lib/system");

var CONFIG = (function () {
    try { return JSON.parse(fs.readFileSync("/etc/phoenix/nova.json", "utf8")); } catch (e) { return {}; }
})();
var USB_ADDRESS = CONFIG.usbAddress || "172.16.42.1";

var service = new Service(nova.SERVICE);

function lunaCall(uri, params) {
    return new Promise(function (resolve) {
        service.call(uri, params, function (message) { resolve(message.payload); });
    });
}

var core = nova.createNova({
    root: "/",
    run: system.run,
    luna: { call: lunaCall },
    config: CONFIG,
    notify: function (text) {
        lunaCall("luna://com.webos.notification/createToast", {
            sourceId: nova.SERVICE, message: text,
            onclick: { appId: "org.webosphoenix.settings", params: { page: "devmode" } }
        });
    },
    log: function (m) { console.log("[nova] " + m); }
});

// getStatus {subscribe}'s watchers by the subscription's token: webos-service tells a
// method's cancel callback (given at register) which message went; messages have no
// "cancel" event of their own (com.webos.service.devmode crashed on it, Revision 7 N16).
var watching = {};
function cancelled(message) {
    var stop = watching[message.uniqueToken];
    delete watching[message.uniqueToken];
    if (stop) stop();
}

nova.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var payload = message.payload || {};
        core.methods[name](payload).then(function (reply) {
            if (name === "getStatus" && payload.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                if (watching[message.uniqueToken]) watching[message.uniqueToken]();
                watching[message.uniqueToken] = core.watch(function (st) { message.respond(Object.assign({ returnValue: true }, st)); });
            }
            message.respond(reply);
        });
    }, name === "getStatus" ? cancelled : undefined);
});

// The listeners follow Developer Mode and the two switches: one at a time
// (lib/listeners.js).
var listeners = createListeners({
    open: function (name, host, allow) {
        return proto.createServer(core, {
            host: host, port: proto.PORT, allow: allow, name: "webOS Phoenix",
            luna: system.lunaSend, log: system.journal, connect: proto.connectLocal,
            onError: function (t) { console.log("[nova] " + t); }
        });
    },
    state: function () {
        var o = core.options();
        return { on: core.devMode(), usb: !!o.usb, network: !!o.network };
    },
    usbAddress: USB_ADDRESS,
    isPrivate: proto.isPrivate,
    log: function (m) { console.log("[nova] " + m); }
});
// The USB debugging link (docs/DEV-PUSH.md 6.2): the CDC NCM gadget, while
// Developer Mode and "USB debugging" are on (phoenix-devmode's
// phoenix-usb-debug; a device without a USB device controller says so).
var usbLink = null;
function followUsb() {
    var o = core.options();
    var want = core.devMode() && !!o.usb;
    if (want === usbLink) return;
    usbLink = want;
    system.run("/usr/sbin/phoenix-usb-debug", [want ? "up" : "down"]).then(function (r) {
        console.log("[nova] " + String(r.stdout || "").trim());
    }, function (e) {
        console.log("[nova] USB debugging link " + (want ? "up" : "down") + ": " + (e.stdout || e.message || e));
    });
}
function follow() { followUsb(); listeners.follow(); }
core.watch(follow);
follow();
// Developer Mode is a flag file another service writes (and turning it on
// or off restarts the device), so it is looked at once a minute as well.
setInterval(function () { follow(); }, 60000).unref();
