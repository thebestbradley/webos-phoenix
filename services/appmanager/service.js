// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The com.palm.applicationManager Luna service on webOS OSE
// (appmanager.js): the legacy application manager's API over SAM
// (com.webos.applicationManager). run-js-service starts it when an app
// first calls it (sysbus/). The handlers apps add and the exhibitions the
// user turned on are kept in /var/lib/phoenix/appmanager/handlers.json.
// STATUS: written against SAM's source and appmanager.test.ts; not yet run
// on a device.

"use strict";

var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var am = require("./appmanager");

var DIR = "/var/lib/phoenix/appmanager";
var FILE = path.join(DIR, "handlers.json");

var service = new Service(am.SERVICE);

function samCall(method, params) {
    return new Promise(function (resolve) {
        service.call("luna://" + am.SAM + "/" + method, params, function (m) { resolve(m.payload); });
    });
}

var manager = am.createAppManager({
    sam: samCall,
    readFile: function (p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } },
    registry: {
        load: function () { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return null; } },
        save: function (obj) {
            fs.mkdirSync(DIR, { recursive: true, mode: 493 });
            fs.writeFileSync(FILE + ".new", JSON.stringify(obj), { mode: 420 });
            fs.renameSync(FILE + ".new", FILE);
        }
    }
});

am.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        manager.methods[name](p).then(function (reply) {
            if (name === "listDockModeLaunchPoints" && p.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                var stop = manager.watchDockMode(function (r) { message.respond(Object.assign({ subscribed: true }, r)); });
                message.on("cancel", stop);
            }
            message.respond(reply);
        }, function (e) {
            message.respond({ returnValue: false, errorCode: -1, errorText: String(e && e.message || e) });
        });
    });
});

// launchPointChanges {subscribe}: each launch point added, removed or
// changed, as SAM's listLaunchPoints subscription tells it ({change,
// launchPoint fields}); the app list is read again then.
service.register("launchPointChanges", function (message) {
    var p = message.payload || {};
    if (!p.subscribe || !message.isSubscription) {
        message.respond({ returnValue: true, subscribed: false });
        return;
    }
    message.respond({ returnValue: true, subscribed: true });
    var sub = service.subscribe("luna://" + am.SAM + "/listLaunchPoints", { subscribe: true });
    sub.on("response", function (m) {
        var r = m.payload || {};
        if (typeof r.change !== "string") return;
        manager.forgetApps();
        var out = { returnValue: true, subscribed: true, change: r.change };
        var lp = r.launchPoint && typeof r.launchPoint === "object" ? r.launchPoint : r;
        for (var k in lp) if (k !== "returnValue" && k !== "subscribed" && k !== "change") out[k] = lp[k];
        message.respond(out);
    });
    message.on("cancel", function () { sub.cancel(); });
});
