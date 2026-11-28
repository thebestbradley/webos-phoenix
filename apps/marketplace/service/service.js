// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.service.packages Luna service on a device: registers
// the methods of packagesservice.js with webos-service (OSE's
// nodejs-module-webos-service). run-js-service starts it on demand
// (sysbus/); tools/install-rootfs.py installs it, its luna-service2 files and
// the default catalogs (etc/palm/marketplace/sources.json ->
// /etc/palm/marketplace/sources.json). Its state (sources, trusted keys,
// catalogs, what it installed) is /var/lib/phoenix/marketplace/state.json.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");
var Service = require("webos-service");
var packages = require("./packagesservice");
var http = require("./lib/node-http");
var platformDevice = require("@phoenix/platform/src/device");

var STATE = "/var/lib/phoenix/marketplace/state.json";
var TEMP = "/tmp/phoenix-marketplace";
var SOURCES = "/etc/palm/marketplace/sources.json";
// The connector packages the image came with (tools/install-rootfs.py puts
// them in /media/cryptofs/apps, the apps the user may remove).
var PREINSTALLED = "/etc/palm/marketplace/preinstalled.json";
var INSTALLED_APPS = "/media/cryptofs/apps/usr/palm/applications/";
// The account templates of the system image, as the accounts service reads
// them (app-services com.palm.service.accounts accounts.js TEMPLATE_ROOTS,
// its first root): every *.json in each folder.
var SYSTEM_TEMPLATES = "/usr/palm/public/accounts/";
// nova install's packages: novad (services/nova, root only) writes each here
// and names it in sideload {file}; read once, then removed.
var SIDELOAD = "/var/lib/phoenix/sideload";

var service = new Service(packages.SERVICE);

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

var methods = packages.createPackagesService({
    luna: {
        call: function (uri, params) {
            return new Promise(function (resolve) {
                service.call(uri, params, function (message) { resolve(message.payload); });
            });
        },
        subscribe: function (uri, params, onReply) {
            var sub = service.subscribe(uri, params);
            sub.on("response", function (message) { onReply(message.payload); });
            return function () { sub.cancel(); };
        }
    },
    request: http.request,
    requestBytes: http.requestBytes,
    crypto: {
        sha256: function (b) { return Promise.resolve(new Uint8Array(crypto.createHash("sha256").update(Buffer.from(b)).digest())); },
        sha512: function (b) { return Promise.resolve(new Uint8Array(crypto.createHash("sha512").update(Buffer.from(b)).digest())); },
        randomBytes: function (n) { return new Uint8Array(crypto.randomBytes(n)); }
    },
    gzip: {
        gzip: function (b) { return Promise.resolve(new Uint8Array(zlib.gzipSync(Buffer.from(b)))); },
        gunzip: function (b) { return Promise.resolve(new Uint8Array(zlib.gunzipSync(Buffer.from(b)))); }
    },
    state: {
        load: function () { return readJson(STATE); },
        save: function (obj) {
            fs.mkdirSync(path.dirname(STATE), { recursive: true, mode: 448 });
            fs.writeFileSync(STATE + ".new", JSON.stringify(obj), { mode: 384 });
            fs.renameSync(STATE + ".new", STATE);
        }
    },
    temp: {
        write: function (name, bytes) {
            fs.mkdirSync(TEMP, { recursive: true, mode: 448 });
            var file = path.join(TEMP, path.basename(name));
            fs.writeFileSync(file, Buffer.from(bytes), { mode: 420 });
            return file;
        },
        remove: function (file) { try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
    },
    sideload: {
        read: function (name, max) {
            var file = path.join(SIDELOAD, path.basename(name));
            var st = fs.lstatSync(file);
            if (!st.isFile()) throw new Error("not a file");
            if (st.size > max) throw new Error("The package is too big");
            return new Uint8Array(fs.readFileSync(file));
        },
        remove: function (name) { try { fs.unlinkSync(path.join(SIDELOAD, path.basename(name))); } catch (e) { /* gone */ } }
    },
    defaultSources: function () { return (readJson(SOURCES) || {}).sources || []; },
    // The Phoenix catalog and the revocation list: /etc/palm/phoenix/servers.json.
    servers: function () {
        return platformDevice.servers(function (uri, params) {
            return new Promise(function (resolve) { service.call(uri, params, function (m) { resolve(m.payload); }); });
        }, function (m) { console.log("[marketplace] " + m); });
    },
    preinstalled: function () {
        return ((readJson(PREINSTALLED) || {}).packages || []).map(function (p) {
            var info = readJson(INSTALLED_APPS + p.id + "/appinfo.json") || {};
            return { id: p.id, sourceId: p.sourceId || "phoenix", version: String(info.version || ""), title: info.title || p.id,
                     templates: p.templates || [] };
        });
    },
    firstParty: function () { return (readJson(PREINSTALLED) || {}).firstParty || []; },
    systemTemplates: function () {
        var out = [];
        var dirs = [];
        try { dirs = fs.readdirSync(SYSTEM_TEMPLATES); } catch (e) { return out; }
        dirs.forEach(function (dir) {
            var files = [];
            try { files = fs.readdirSync(SYSTEM_TEMPLATES + dir); } catch (e) { return; }
            files.filter(function (f) { return /\.json$/i.test(f); }).forEach(function (f) {
                var parsed = readJson(SYSTEM_TEMPLATES + dir + "/" + f);
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(function (t) {
                    if (!t || !t.templateId) return;
                    var v = t.validator && typeof t.validator === "object" ? t.validator : null;
                    out.push({ templateId: String(t.templateId), appId: v && v.customUI && v.customUI.appId ? String(v.customUI.appId) : null });
                });
            });
        });
        return out;
    },
    log: function (msg) { console.log("[marketplace] " + msg); }
});

packages.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        if (name === "install" && p.subscribe) {
            message.respond({ returnValue: true, subscribed: true, id: p.id, state: "queued" });
            methods.install(p, function (st) { message.respond(st); });
            return;
        }
        methods[name](p).then(function (reply) { message.respond(reply); });
    });
});
