// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.gamepads, .usb, .tethering and .battery on a device
// (accessories.js), one process: over OSE's physical device manager
// (com.webos.service.pdm), the connman adapter's hotspot
// (com.webos.service.wifi/tethering), connmanctl for USB tethering, and the
// kernel's power supply class. The battery's history and the hotspot's
// settings are kept in /var/lib/phoenix/accessories/state.json. It keeps
// itself running (webos-service's keep-alive activity), sampling the
// battery every minute.
// STATUS: written against those services' sources and accessories.test.ts;
// not yet run on a device.

"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var acc = require("./accessories");

var DIR = "/var/lib/phoenix/accessories";
var FILE = path.join(DIR, "state.json");

var names = Object.keys(acc.SERVICES);
var services = {};
names.forEach(function (n) { services[n] = new Service(n); });
var bus = services[names[0]];

function call(uri, params) {
    return new Promise(function (resolve) {
        bus.call(uri, params, function (m) { resolve(m.payload || {}); });
    });
}

var accessories = acc.createAccessories({
    call: call,
    subscribe: function (uri, params, onReply) {
        var s = bus.subscribe(uri, params);
        s.on("response", function (m) { onReply(m.payload || {}); });
        return function () { s.cancel(); };
    },
    readFile: function (p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } },
    listDir: function (p) { try { return fs.readdirSync(p); } catch (e) { return []; } },
    run: function (cmd, args) {
        return new Promise(function (resolve) {
            childProcess.execFile(cmd, args, { timeout: 15000 }, function (err, stdout) {
                resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || "") });
            });
        });
    },
    statfs: function (p) {
        try {
            var s = fs.statfsSync(p);
            return { size: s.blocks * s.bsize, used: (s.blocks - s.bfree) * s.bsize };
        } catch (e) { return null; }
    },
    store: {
        load: function () { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return null; } },
        save: function (obj) {
            fs.mkdirSync(DIR, { recursive: true, mode: 448 });
            fs.writeFileSync(FILE + ".new", JSON.stringify(obj), { mode: 384 });
            fs.renameSync(FILE + ".new", FILE);
        }
    },
    notify: function (n) { call("luna://org.webosphoenix.shellhost/post", { type: "notification", payload: n }); },
    ongoing: function (o) {
        if (o.clear) call("luna://org.webosphoenix.ongoing/clear", { id: o.id });
        else call("luna://org.webosphoenix.ongoing/set", o);
    }
});

function callerOf(message) {
    return message.applicationID || message.senderServiceName || message.sender || "";
}

names.forEach(function (n) {
    acc.SERVICES[n].forEach(function (method) {
        services[n].register(method, function (message) {
            var cancel = accessories.services[n][method](message.payload || {}, callerOf(message), function (r) { message.respond(r); });
            if (typeof cancel === "function" && message.isSubscription)
                message.on("cancel", cancel);
        });
    });
});

accessories.sample();
setInterval(function () { accessories.sample(); }, 60000);
bus.activityManager.create("keepAlive", function () {});
