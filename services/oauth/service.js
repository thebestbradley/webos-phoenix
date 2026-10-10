// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.oauth on a device (run-js-service), around
// oauthservice.js. Two pieces are placeholders until phase C3 and the key
// store (docs/SYNERGY-CONNECTORS.md 4.1, docs/SYNERGY-MODERN.md 4.5):
//
//   - the key store: a JSON file only this service can read
//     (/var/lib/phoenix/oauth/keys.json, mode 0600), not yet
//     org.webosphoenix.service.keystore behind com.palm.keymanager, and
//     not excluded from backups by itself (it is outside /media/internal,
//     which is what the backup service copies);
//   - the browser sheet: the shell's system browser sheet over the card
//     (the simulator has it: runtime/phoenix-runtime.js, "OAuth") is not
//     on devices yet, so authorize answers "UNSUPPORTED". The redirect
//     address a device will use is the loopback one of RFC 8252 7.3,
//     which the sheet watches rather than a listening socket.
//
// The caller is the sender luna-service2 names (message.sender).

"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var Service = require("webos-service");
var synckit = require("@phoenix/synckit");
var oauth = require("./oauthservice");

var DIR = "/var/lib/phoenix/oauth";
var FILE = path.join(DIR, "keys.json");

function readAll() {
    try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return {}; }
}
function writeAll(all) {
    fs.mkdirSync(DIR, { recursive: true, mode: 448 });
    var tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(all), { mode: 384 });
    fs.renameSync(tmp, FILE);
}

var service = new Service(oauth.SERVICE);
var methods = oauth.createOAuthService({
    request: synckit.createRequest({ userAgent: "webOS-Phoenix-OAuth/0.1" }),
    keystore: {
        get: function (id) { return Promise.resolve(readAll()[id]); },
        put: function (id, value) { var all = readAll(); all[id] = value; writeAll(all); return Promise.resolve(); },
        del: function (id) { var all = readAll(); delete all[id]; writeAll(all); return Promise.resolve(); }
    },
    sheet: function () {
        return Promise.reject(Object.assign(new Error("The sign-in sheet is not on devices yet (docs/SYNERGY-CONNECTORS.md, C3)"), { errorCode: "UNSUPPORTED" }));
    },
    crypto: {
        randomBytes: function (n) { return new Uint8Array(crypto.randomBytes(n)); },
        sha256: function (bytes) { return Promise.resolve(new Uint8Array(crypto.createHash("sha256").update(Buffer.from(bytes)).digest())); }
    },
    redirectUri: "http://127.0.0.1/oauth/callback",
    log: function (m) { console.log("[oauth] " + m); }
});

oauth.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        methods[name](message.payload || {}, message.sender).then(function (reply) { message.respond(reply); });
    });
});
