// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.service.backup Luna service on a device: registers
// the methods of backupservice.js with webos-service (OSE's
// nodejs-module-webos-service), as apps/dav/service/service.js does.
// run-js-service starts it on demand (sysbus/); tools/install-rootfs.py
// installs it, its luna-service2 files, and the backup registrations of db8
// and the shell (etc/palm/backup/ -> /etc/palm/backup/).
//
// Its settings (where backups go, the WebDAV password, the key derived from
// the backup passphrase) are kept in /var/lib/phoenix/backup/config.json,
// readable by this service only.

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var Service = require("webos-service");
var backupservice = require("./backupservice");
var nodeCrypto = require("./lib/node-crypto");
var request = require("./lib/node-http");

var CONFIG = "/var/lib/phoenix/backup/config.json";
var REGISTRATIONS = "/etc/palm/backup";

var service = new Service(backupservice.SERVICE);

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

var methods = backupservice.createBackupService({
    luna: {
        call: function (uri, params) {
            return new Promise(function (resolve) {
                service.call(uri, params, function (message) { resolve(message.payload); });
            });
        }
    },
    request: request,
    crypto: nodeCrypto,
    config: {
        load: function () { return readJson(CONFIG); },
        save: function (obj) {
            fs.mkdirSync(path.dirname(CONFIG), { recursive: true, mode: 448 });
            fs.writeFileSync(CONFIG + ".new", JSON.stringify(obj), { mode: 384 });
            fs.renameSync(CONFIG + ".new", CONFIG);
        }
    },
    temp: {
        make: function () { return fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-backup-")); },
        read: function (file) { return new Uint8Array(fs.readFileSync(file)); },
        write: function (file, data) { fs.writeFileSync(file, Buffer.from(data), { mode: 384 }); },
        remove: function (dir) { fs.rmSync(dir, { recursive: true, force: true }); }
    },
    usb: {
        list: function (dir) {
            var names;
            try { names = fs.readdirSync(dir); } catch (e) { return []; }
            return names.map(function (name) {
                var st = fs.statSync(path.join(dir, name));
                return st.isFile() ? { name: name, size: st.size, modified: st.mtime.toISOString() } : null;
            }).filter(Boolean);
        },
        read: function (file) {
            try { return fs.readFileSync(file, "utf8"); } catch (e) {
                throw Object.assign(new Error("The backup is not on the USB drive"), { code: "NOT_FOUND" });
            }
        },
        write: function (file, text) {
            fs.writeFileSync(file + ".part", text);
            fs.renameSync(file + ".part", file);
        },
        remove: function (file) { try { fs.unlinkSync(file); } catch (e) { /* gone already */ } },
        mkdir: function (dir) { fs.mkdirSync(dir, { recursive: true }); }
    },
    participants: function () {
        var names;
        try { names = fs.readdirSync(REGISTRATIONS); } catch (e) { return []; }
        return names.filter(function (n) { return /\.json$/.test(n); }).map(function (n) {
            return readJson(path.join(REGISTRATIONS, n));
        }).filter(Boolean);
    },
    log: function (msg) { console.log("[backup] " + msg); }
});

backupservice.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var payload = message.payload || {};
        var push = null;
        if (name === "getStatus" && payload.subscribe && message.isSubscription) {
            push = function (status) { message.respond(status); };
            message.on("cancel", function () { methods.unwatch(push); });
        }
        methods[name](payload, push).then(function (reply) { message.respond(reply); });
    });
});
