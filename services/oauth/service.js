// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.oauth on a device (run-js-service): device.js
// on the bus. What the bus gives it:
//
//   - the Sign In card (org.webosphoenix.signin, apps/signin), launched
//     and closed through the application manager (SAM's launch and
//     closeByAppId, group application.launcher); its life events
//     (getAppLifeEvents, application.operation, sam
//     src/bus/service/ApplicationManager.cpp:690-757: "close" and "stop")
//     say when the user closed it;
//   - the card's bar: the provider's host, for the shell, as a message
//     through org.webosphoenix.shellhost ("signInCard"; the shell hears
//     this service's name as the sender, so no page can draw that bar);
//   - the key store: /var/lib/phoenix/oauth, sealed (keystore.js);
//   - the loopback redirect on 127.0.0.1 (loopback.js), only while a
//     sign-in is pending.
//
// The caller is the one luna-service2 names: a WebAppMgr page's app id,
// else the calling service's bus name (as services/shellhost).

"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var http = require("http");
var Service = require("webos-service");
var synckit = require("@phoenix/synckit");
var oauth = require("./oauthservice");
var device = require("./device");

var DIR = "/var/lib/phoenix/oauth";
var SAM = "luna://com.webos.service.applicationmanager/";
// Who may erase the key store: the shell (Settings' and the key chord's
// Erase, SystemScreens.qml) and the system manager (a security policy's
// last try, services/systemmanager).
var ERASERS = ["com.webos.surfacemanager", "com.palm.systemmanager"];

var service = new Service(oauth.SERVICE);

function callerOf(message) {
    return message.applicationID || message.senderServiceName || message.sender || "";
}

function call(uri, params) {
    return new Promise(function (resolve) {
        service.call(uri, params, function (m) { resolve(m.payload || {}); });
    });
}

var lifeEvents = null;
var oauthDevice = device.createDeviceOAuth({
    request: synckit.createRequest({ userAgent: "webOS-Phoenix-OAuth/0.2" }),
    fs: fs, path: path, crypto: crypto, http: http, dir: DIR,
    launchCard: function (params) {
        // The card's closes, while this service runs (it runs while a
        // sign-in waits: the caller's request is open).
        if (!lifeEvents) {
            lifeEvents = service.subscribe(SAM + "getAppLifeEvents", { subscribe: true });
            lifeEvents.on("response", function (m) {
                var e = m.payload || {};
                if (e.appId === device.SIGNIN_APP && (e.event === "close" || e.event === "stop"))
                    oauthDevice.card.appClosed();
            });
        }
        return call(SAM + "launch", { id: device.SIGNIN_APP, params: params });
    },
    closeCard: function () { return call(SAM + "closeByAppId", { id: device.SIGNIN_APP }); },
    bar: function (info) {
        call("luna://org.webosphoenix.shellhost/post", { type: "signInCard", payload: info || { closed: true } });
    },
    mayWipe: function (caller) { return ERASERS.indexOf(caller) >= 0; },
    log: function (m) { console.log("[oauth] " + m); }
});

oauth.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        oauthDevice.methods[name](message.payload || {}, callerOf(message)).then(function (reply) { message.respond(reply); });
    });
});
