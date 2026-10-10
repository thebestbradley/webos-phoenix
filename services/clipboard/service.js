// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.clipboard Luna service on a device: the runtime's
// clipboard history (host.js) on the bus, for the pages (their copies,
// runtime/phoenix-runtime.js installDevice), the Clipboard app, Settings >
// Clipboard and the keyboard's clip strip. run-js-service starts it on
// demand (sysbus/); tools/install-rootfs.py installs it, and with it
// phoenix-runtime.js, which it runs (/usr/share/phoenix/runtime).
// Its store is /var/lib/phoenix/clipboard/store.json (0600).
// STATUS: written against the runtime and host.test.ts; not yet run on a device.

"use strict";

var Service = require("webos-service");
var host = require("./host");

var service = new Service("org.webosphoenix.clipboard");
var clipboard = host.createHost({
    runtimePath: "/usr/share/phoenix/runtime/phoenix-runtime.js",
    storeFile: "/var/lib/phoenix/clipboard/store.json",
    busCall: function (uri, params, cb) {
        service.call(uri, params, function (m) { cb(m.payload); });
    }
});

host.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        // The app that called (WebAppMgr's pages: their app id), else the
        // service's own name.
        var sender = message.applicationID || message.sender || "";
        var cancel = clipboard.call(name, p, sender, function (r) { message.respond(r); }, message.isSubscription);
        if (p.subscribe && message.isSubscription)
            message.on("cancel", cancel);
    });
});

// "Clear when locked" (Settings > Clipboard) follows the lock screen.
service.subscribe("luna://com.palm.systemmanager/getLockStatus", { subscribe: true })
    .on("response", function (m) {
        if (m.payload && typeof m.payload.locked === "boolean")
            clipboard.lockChanged(m.payload.locked);
    });

// The store is written as it changes; a stop writes what is pending.
process.on("SIGTERM", function () { clipboard.flush(); process.exit(0); });
