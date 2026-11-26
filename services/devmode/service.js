// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The com.webos.service.devmode Luna service on a device: registers the
// methods of devmode.js with webos-service (OSE's
// nodejs-module-webos-service); run-js-service starts it when it is first
// called (sysbus/). After setDevMode changes the flag it answers, then
// restarts the device (OSE's com.palm.service.devmode runs "reboot":
// devmode_service.js:129-143 at 94b6921), so novad, WebAppMgr, the shell
// and the overlay's boot step all start with the new setting.
// STATUS: written against webos-service's API and the tests; not yet run
// on a device.

"use strict";

var childProcess = require("child_process");
var Service = require("webos-service");
var dm = require("./devmode");

var service = new Service(dm.SERVICE);
var core = dm.createDevMode({ log: function (m) { console.log("[devmode] " + m); } });

// getDevMode {subscribe}'s watchers by the subscription's token. webos-service has no
// per-message "cancel" event (Revision 7: "message.on is not a function" killed the
// service on every subscribe, N16): a method's cancel callback, given at register, is told
// which message went, and a subscription is only kept for a method that has one.
var watching = {};
function cancelled(message) {
    var stop = watching[message.uniqueToken];
    delete watching[message.uniqueToken];
    if (stop) stop();
}

dm.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        core.methods[name](p).then(function (reply) {
            if (name === "getDevMode" && p.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                if (watching[message.uniqueToken]) watching[message.uniqueToken]();
                watching[message.uniqueToken] = core.watch(function (r) { message.respond(Object.assign({ subscribed: true }, r)); });
            }
            message.respond(reply);
            if (reply.restarting) {
                // A moment for the reply to reach the caller.
                setTimeout(function () {
                    childProcess.execFile("systemctl", ["reboot"], function (e) {
                        if (e) console.error("[devmode] systemctl reboot: " + e.message);
                    });
                }, 1000);
            }
        });
    }, name === "getDevMode" ? cancelled : undefined);
});
