// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.account on a device (run-js-service), around
// accountservice.js. Its tokens and the backup password are in a JSON file
// only this service reads (/var/lib/phoenix/account/keys.json, mode 0600;
// the key store service is to come, as for org.webosphoenix.service.oauth),
// the rest of its state in /var/lib/phoenix/account/state.json. The
// servers: /etc/palm/phoenix/servers.json, with Developer Mode's override
// (/var/lib/phoenix/servers.override.json), which this service writes. The
// device's own Ed25519 key (POST /v1/devices "publicKey") is made once and
// kept beside the tokens. The caller is the sender luna-service2 names.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var account = require("./accountservice");
var platformDevice = require("@phoenix/platform/src/device");

var DIR = "/var/lib/phoenix/account";
var KEYS = path.join(DIR, "keys.json");
var STATE = path.join(DIR, "state.json");

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}
function writeJson(file, obj) {
    fs.mkdirSync(DIR, { recursive: true, mode: 448 });
    fs.writeFileSync(file + ".new", JSON.stringify(obj), { mode: 384 });
    fs.renameSync(file + ".new", file);
}
function osRelease() {
    var out = {};
    try {
        fs.readFileSync("/etc/os-release", "utf8").split("\n").forEach(function (line) {
            var m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
            if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
        });
    } catch (e) { /* none */ }
    return out;
}
function digest(alg) {
    return function (b) { return Promise.resolve(new Uint8Array(crypto.createHash(alg).update(Buffer.from(b)).digest())); };
}

var service = new Service(account.SERVICE);
function lunaCall(uri, params) {
    return new Promise(function (resolve) {
        service.call(uri, params, function (message) { resolve(message.payload); });
    });
}

var keystore = {
    get: function (id) { return Promise.resolve((readJson(KEYS) || {})[id]); },
    put: function (id, value) { var all = readJson(KEYS) || {}; all[id] = value; writeJson(KEYS, all); return Promise.resolve(); },
    del: function (id) { var all = readJson(KEYS) || {}; delete all[id]; writeJson(KEYS, all); return Promise.resolve(); }
};

var methods = account.createAccountService({
    request: platformDevice.request,
    requestBytes: platformDevice.request,
    luna: { call: lunaCall },
    keystore: keystore,
    state: { load: function () { return readJson(STATE); }, save: function (o) { writeJson(STATE, o); } },
    servers: function () { return platformDevice.servers(lunaCall, function (m) { console.log("[account] " + m); }); },
    override: { read: platformDevice.readOverride, write: platformDevice.writeOverride },
    crypto: {
        sha256: digest("sha256"), sha512: digest("sha512"),
        randomBytes: function (n) { return new Uint8Array(crypto.randomBytes(n)); },
        deviceKey: function () {
            return keystore.get("device:key").then(function (k) {
                if (k && k.publicKey) return k.publicKey;
                var pair = crypto.generateKeyPairSync("ed25519");
                var pub = Buffer.from(pair.publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
                var rec = { publicKey: pub, privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }) };
                return keystore.put("device:key", rec).then(function () { return pub; });
            });
        }
    },
    device: function () {
        var os = osRelease();
        var machine = (function () { try { return fs.readFileSync("/proc/device-tree/model", "utf8").replace(/\0/g, "").trim(); } catch (e) { return ""; } })();
        var compatible = "";
        try { compatible = (fs.readFileSync("/etc/rauc/system.conf", "utf8").match(/^compatible\s*=\s*(.+)$/m) || [])[1] || ""; } catch (e) { /* no RAUC */ }
        return Promise.resolve({ name: machine || "Phoenix device", model: machine, compatible: compatible.trim(),
                                 osVersion: os.VERSION_ID || "", build: parseInt(os.BUILD_ID, 10) || 0 });
    },
    log: function (m) { console.log("[account] " + m); }
});

account.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var p = message.payload || {};
        methods[name](p, message.sender).then(function (reply) {
            if (name === "getStatus" && p.subscribe && message.isSubscription && reply.returnValue) {
                reply.subscribed = true;
                var stop = methods.watch(function (r) { message.respond(r); });
                message.on("cancel", function () { stop(); });
            }
            message.respond(reply);
        });
    });
});
