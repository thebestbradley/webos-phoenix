// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The com.palm.systemmanager Luna service on a device: registers the
// methods of systemmanager.js with webos-service (OSE's
// nodejs-module-webos-service). run-js-service starts it (sysbus/; the
// shell subscribes to it at start, and an app's call starts it too);
// tools/install-rootfs.py installs it with its luna-service2 files.
// Its state (the passcode's scrypt hash and the lock's counters) is
// /var/lib/phoenix/systemmanager/lock.json (0600); the shell's start-up
// preferences /var/lib/phoenix/systemmanager/startup.json (0644: the shell
// reads it).
// STATUS: written against webos-service's API and the runtime's tests; not
// yet run on a device.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var sm = require("./systemmanager");

var DIR = "/var/lib/phoenix/systemmanager";
var STATE = path.join(DIR, "lock.json");
var STARTUP = path.join(DIR, "startup.json");
// The shell's bus name (luna-surfacemanager), the only one that may report
// its state (the ACG grants /phoenix/report to it alone too: sysbus/).
var SHELL_NAMES = ["com.webos.surfacemanager"];
// The Phoenix keyboard's: maliit-server's bus name, com.webos.service.ime
// (with a display's number), as its plugin's QML calls
// (Phoenix/Keyboard/KeyboardBus.qml: com.webos.service.ime.phoenixKeyboard).
var KEYBOARD_PREFIX = "com.webos.service.ime";

var service = new Service(sm.SERVICE);

function writeAtomic(file, text, mode) {
    fs.mkdirSync(DIR, { recursive: true, mode: 493 });
    fs.writeFileSync(file + ".new", text, { mode: mode });
    fs.renameSync(file + ".new", file);
}

var kdf = sm.scryptKdf(crypto);

var manager = sm.createSystemManager({
    state: {
        load: function () { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { return null; } },
        save: function (obj) { writeAtomic(STATE, JSON.stringify(obj), 384); }
    },
    policies: function () {
        return new Promise(function (resolve) {
            service.call("luna://com.palm.db/find", { query: { from: sm.POLICY_KIND } }, function (m) {
                var r = m.payload || {};
                resolve(r.returnValue && Array.isArray(r.results) ? r.results : []);
            });
        });
    },
    kdf: kdf,
    now: function () { return Date.now(); },
    // Security::eraseDevice (Security.cpp:420-432): the storage service's
    // erase, as the simulator's runtime asks it.
    wipe: function () {
        console.error("[systemmanager] the security policy's last try failed: erasing the device");
        service.call("luna://com.palm.storage/erase/Wipe", {}, function (m) {
            if (!m.payload || m.payload.returnValue !== true)
                console.error("[systemmanager] com.palm.storage/erase/Wipe failed: " + JSON.stringify(m.payload));
        });
    },
    startup: { write: function (obj) { writeAtomic(STARTUP, JSON.stringify(obj), 420); } },
    isShell: function (sender) { return SHELL_NAMES.indexOf(String(sender || "")) >= 0; },
    isKeyboard: function (sender) { return String(sender || "").indexOf(KEYBOARD_PREFIX) === 0; }
});

sm.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        var sender = message.senderServiceName || message.sender || "";
        manager.methods[name](p, sender).then(function (reply) {
            if (p.subscribe && message.isSubscription && reply.returnValue) {
                var stop = manager.watch(name, function (r) { message.respond(Object.assign({ subscribed: true }, r)); });
                if (stop) {
                    reply.subscribed = true;
                    message.on("cancel", function () { stop(); });
                }
            }
            message.respond(reply);
        });
    });
});

// The shell's start-up preferences follow the system service's.
service.subscribe("luna://com.webos.service.systemservice/getPreferences", { keys: sm.STARTUP_KEYS, subscribe: true })
    .on("response", function (m) { manager.preferences(m.payload); });
// Kept running (webos-service's keep-alive activity, never completed): the
// shell's state lives here, and the preferences are followed.
service.activityManager.create("keepAlive", function () {});
