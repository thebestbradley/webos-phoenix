// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The com.palm.update Luna service on a device: registers
// the methods of updatesservice.js with webos-service (OSE's
// nodejs-module-webos-service). run-js-service starts it on demand
// (sysbus/); tools/install-rootfs.py installs it, its luna-service2 files and
// etc/palm/updates.json (the feed). It runs as root: it calls RAUC's command
// line (rauc status / info / install / status mark-active), which talks to
// the RAUC daemon.
//
// The running system's version is /etc/os-release (VERSION_ID, BUILD_ID: the
// build number the image was made with); RAUC says which slot is running
// and which one starts next. Downloads go to /var/lib/phoenix/updates on the
// data partition, so an update can be installed later, offline.

"use strict";

var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var updates = require("./updatesservice");
var node = require("./lib/node");

var STATE = "/var/lib/phoenix/updates/state.json";
var DOWNLOADS = "/var/lib/phoenix/updates";
var CONFIG = "/etc/palm/updates.json";

var service = new Service(updates.SERVICE);

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

var methods = updates.createUpdatesService({
    rauc: node.createRauc(),
    request: node.request,
    download: node.download,
    files: {
        path: function (name) { return path.join(DOWNLOADS, path.basename(name)); },
        exists: function (file) { try { return fs.statSync(file).isFile(); } catch (e) { return false; } },
        remove: function (file) { try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
    },
    power: function () { return node.power(); },
    luna: {
        call: function (uri, params) {
            return new Promise(function (resolve) {
                service.call(uri, params, function (message) { resolve(message.payload); });
            });
        }
    },
    config: function () { return readJson(CONFIG) || {}; },
    state: {
        load: function () { return readJson(STATE); },
        save: function (obj) {
            fs.mkdirSync(path.dirname(STATE), { recursive: true, mode: 448 });
            fs.writeFileSync(STATE + ".new", JSON.stringify(obj), { mode: 384 });
            fs.renameSync(STATE + ".new", STATE);
        }
    },
    log: function (msg) { console.log("[updates] " + msg); }
});

updates.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var payload = message.payload || {};
        methods[name](payload).then(function (reply) {
            // GetStatus (luna-systemui) and getStatus (Settings) with subscribe:
            // every change after the first reply.
            var watch = name === "GetStatus" ? methods.watchPalm : name === "getStatus" ? methods.watch : null;
            if (watch && payload.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                var stop = watch(function (r) { message.respond(r); });
                message.on("cancel", function () { stop(); });
            }
            message.respond(reply);
        });
    });
});
