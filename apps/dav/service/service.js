// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.service.dav Luna service on a device: registers the
// methods of davservice.js with webos-service (OSE's
// nodejs-module-webos-service, as apps/files/service/service.js does).
// run-js-service starts it on demand (sysbus/org.webosphoenix.service.dav.service);
// tools/install-rootfs.py installs it with its luna-service2 role and
// permission files.
//
// It needs com.palm.service.accounts (credentials, account info), db8
// (com.palm.db, com.palm.tempdb) and the activity manager. Contact photos
// are written as files the Contacts app can show (the legacy transports
// used the filecache service for these).

"use strict";

var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var davservice = require("./davservice");
var nodeHttp = require("./lib/node-http");

var PHOTO_DIR = "/media/internal/.phoenix/dav-photos";

var service = new Service(davservice.SERVICE);

function savePhoto(key, dataUrl) {
    return new Promise(function (resolve) {
        var m = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl);
        if (!m) return resolve(dataUrl);
        var file = path.join(PHOTO_DIR, String(key).replace(/[^A-Za-z0-9._-]/g, "_") + "." + (m[1] === "jpeg" ? "jpg" : m[1]));
        fs.mkdir(PHOTO_DIR, { recursive: true }, function () {
            fs.writeFile(file, Buffer.from(m[2], "base64"), function (err) { resolve(err ? dataUrl : file); });
        });
    });
}

var methods = davservice.createDavService({
    luna: {
        call: function (uri, params) {
            return new Promise(function (resolve) {
                service.call(uri, params, function (message) { resolve(message.payload); });
            });
        }
    },
    request: nodeHttp.createRequest(),
    savePhoto: savePhoto,
    log: function (msg) { console.log("[dav] " + msg); }
});

davservice.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        methods[name](message.payload || {}).then(function (reply) { message.respond(reply); });
    });
});
