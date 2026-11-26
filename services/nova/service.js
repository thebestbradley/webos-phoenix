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
//     only private ones (lib/proto.js isPrivate).
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

nova.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var payload = message.payload || {};
        core.methods[name](payload).then(function (reply) {
            if (name === "getStatus" && payload.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                var stop = core.watch(function (st) { message.respond(Object.assign({ returnValue: true }, st)); });
                message.on("cancel", function () { stop(); });
            }
            message.respond(reply);
        });
    });
});

// The listeners follow Developer Mode and the two switches.
var listeners = {};
function listen(name, host, allow) {
    if (listeners[name]) return;
    var s = proto.createServer(core, {
        host: host, port: proto.PORT, allow: allow, name: "webOS Phoenix",
        luna: system.lunaSend, log: system.journal, connect: proto.connectLocal,
        onError: function (t) { console.log("[nova] " + t); }
    });
    listeners[name] = s;
    s.listening.then(function () { console.log("[nova] listening on " + host + ":" + proto.PORT); },
                     function (e) { console.log("[nova] cannot listen on " + host + ": " + e.message); delete listeners[name]; });
}
function stop(name) {
    if (!listeners[name]) return;
    listeners[name].close();
    delete listeners[name];
}
function follow() {
    var on = core.devMode(), o = core.options();
    if (on && o.usb) listen("usb", USB_ADDRESS, null); else stop("usb");
    if (on && o.network) listen("network", "::", proto.isPrivate); else stop("network");
}
core.watch(follow);
follow();
// Developer Mode is a flag file another service writes (and turning it on
// or off restarts the device), so it is looked at once a minute as well.
setInterval(function () { follow(); }, 60000).unref();
