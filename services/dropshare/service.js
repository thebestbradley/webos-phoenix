// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.dropshare Luna service on a device (dropshare.js):
// DropShare's web server, its pages the DropShare app's web/ folder. The
// ongoing activity and the "in Downloads" notification go to the shell
// (org.webosphoenix.ongoing, org.webosphoenix.shellhost); whether it is on
// is the system preference dropShareEnabled. run-js-service starts it when
// the DropShare card calls it; a session ends when the card goes (its
// subscription is cancelled).
// STATUS: written against simdropshare.cpp's protocol and
// dropshare.test.ts; not yet run on a device.

"use strict";

var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var ds = require("./dropshare");

var service = new Service(ds.SERVICE);
var WEB = "/usr/palm/applications/" + ds.APP + "/web";

function call(uri, params) {
    return new Promise(function (resolve) {
        service.call(uri, params, function (m) { resolve(m.payload || {}); });
    });
}

var dropShare = ds.createDropShare({
    pages: function (name) {
        try { return fs.readFileSync(path.join(WEB, path.basename(name))); } catch (e) { return null; }
    },
    enabled: function () {
        return call("luna://com.webos.service.systemservice/getPreferences", { keys: ["dropShareEnabled"] }).then(function (r) {
            return r.dropShareEnabled === true;
        });
    },
    ongoing: function (o) {
        if (o.clear) call("luna://org.webosphoenix.ongoing/clear", { id: o.id });
        else call("luna://org.webosphoenix.ongoing/set", o);
    },
    notify: function (n) { call("luna://org.webosphoenix.shellhost/post", { type: "notification", payload: n }); }
});

ds.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var cancel = dropShare.methods[name](message.payload || {}, function (r) { message.respond(r); });
        if (typeof cancel === "function") {
            if (message.isSubscription)
                message.on("cancel", cancel);
        }
    });
});

process.on("SIGTERM", function () { dropShare.close(); process.exit(0); });
