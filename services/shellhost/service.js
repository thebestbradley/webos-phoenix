// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.shellhost Luna service on a device (shellhost.js):
// the pages' messages for the shell (phoenix-runtime.js installDevice's
// phoenixHost.postToHost) and the shell's for the pages
// (LsmWindowSource.qml). run-js-service starts it when the shell subscribes
// at its start; it keeps itself running (webos-service's keep-alive
// activity: the posts kept for a shell that is not listening yet live here).
// STATUS: written against webos-service's API and shellhost.test.ts; not
// yet run on a device.

"use strict";

var Service = require("webos-service");
var sh = require("./shellhost");

var service = new Service(sh.SERVICE);
var host = sh.createShellHost({});

// The caller luna-service2 names: a WebAppMgr page's app id, else the
// calling service's bus name (luna-surfacemanager: com.webos.surfacemanager).
function callerOf(message) {
    return message.applicationID || message.senderServiceName || message.sender || "";
}

sh.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        var cancel = host[name](p, callerOf(message), function (r) { message.respond(r); });
        if (typeof cancel === "function") {
            if (message.isSubscription)
                message.on("cancel", cancel);
            else
                cancel();
        }
    });
});

service.activityManager.create("keepAlive", function () {});
