// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.hardware Luna service on a device: registers the
// methods of hardwareservice.js with webos-service (OSE's
// nodejs-module-webos-service). run-js-service starts it on demand
// (sysbus/); tools/install-rootfs.py installs it, its luna-service2 files and
// etc/palm/hardware/catalog.json (the driver catalog and its pinned key).
// It runs as root: it installs packages (opkg) and loads drivers (modprobe).
// Its state (the catalog it read, what it installed) is
// /var/lib/phoenix/hardware/state.json; the packages it installed are kept
// in /var/lib/phoenix/hardware/packages, to roll back to.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var hardware = require("./hardwareservice");
var node = require("./lib/node");
var sysfs = require("./lib/sysfs");

var STATE = "/var/lib/phoenix/hardware/state.json";
var PACKAGES = "/var/lib/phoenix/hardware/packages";
var CONFIG = "/etc/palm/hardware/catalog.json";

var service = new Service(hardware.SERVICE);
var scanner = sysfs.createScanner(node.createFs("/"), {
    names: node.createNames({ pci: ["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids"],
                              usb: ["/usr/share/hwdata/usb.ids", "/usr/share/misc/usb.ids"] })
});

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

var methods = hardware.createHardwareService({
    system: {
        scan: function () { return node.kernelLog().then(function (log) { return scanner.scan(log); }); },
        info: function () { return Promise.resolve({ arch: node.arch(), archs: node.opkgArchs(), kernel: require("os").release() }); },
        activate: node.createActivator({}),
        bootId: function () { try { return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch (e) { return ""; } }
    },
    opkg: node.createOpkg({}),
    request: node.request,
    requestBytes: node.requestBytes,
    crypto: {
        sha256: function (b) { return Promise.resolve(new Uint8Array(crypto.createHash("sha256").update(Buffer.from(b)).digest())); },
        sha512: function (b) { return Promise.resolve(new Uint8Array(crypto.createHash("sha512").update(Buffer.from(b)).digest())); }
    },
    files: {
        write: function (name, bytes) {
            fs.mkdirSync(PACKAGES, { recursive: true, mode: 448 });
            var file = path.join(PACKAGES, path.basename(name));
            fs.writeFileSync(file, Buffer.from(bytes), { mode: 384 });
            return file;
        },
        find: function (name) {
            var file = path.join(PACKAGES, path.basename(name));
            return fs.existsSync(file) ? file : null;
        },
        remove: function (file) { try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
    },
    state: {
        load: function () { return readJson(STATE); },
        save: function (obj) {
            fs.mkdirSync(path.dirname(STATE), { recursive: true, mode: 448 });
            fs.writeFileSync(STATE + ".new", JSON.stringify(obj), { mode: 384 });
            fs.renameSync(STATE + ".new", STATE);
        }
    },
    config: function () { return readJson(CONFIG) || {}; },
    luna: {
        call: function (uri, params) {
            return new Promise(function (resolve) {
                service.call(uri, params, function (message) { resolve(message.payload); });
            });
        }
    },
    log: function (msg) { console.log("[hardware] " + msg); }
});

hardware.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        if (name === "install" && p.subscribe) {
            message.respond({ returnValue: true, subscribed: true, driverId: p.driverId, state: "queued" });
            methods.install(p, function (st) { message.respond(st); });
            return;
        }
        methods[name](p).then(function (reply) {
            if (name === "list" && p.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                var stop = methods.watch(function (r) { message.respond(r); });
                message.on("cancel", function () { stop(); });
            }
            message.respond(reply);
        });
    });
});
