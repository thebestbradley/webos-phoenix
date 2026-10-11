// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// servers.json on a device (Node.js services only; the simulator reads the
// same files through runtime/phoenix-runtime.js "Platform servers"):
//
//   /etc/palm/phoenix/servers.json             the image's (meta-phoenix,
//                                              tools/servers-json.py)
//   /var/lib/phoenix/servers.override.json     Developer Mode's override,
//                                              written by
//                                              org.webosphoenix.service.account
//                                              setServers; used only while
//                                              Developer Mode is on
//
// require("@phoenix/platform/src/device").servers(lunaCall) -> Promise<resolved>

"use strict";

var fs = require("fs");
var index = require("./index");

var IMAGE = "/etc/palm/phoenix/servers.json";
var OVERRIDE = "/var/lib/phoenix/servers.override.json";

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

// lunaCall(uri, params) -> Promise<reply>: for Developer Mode's state
// (com.webos.service.devmode, OSE's).
function servers(lunaCall, log) {
    return index.load({
        image: function () { try { return fs.readFileSync(IMAGE, "utf8"); } catch (e) { return null; } },
        override: function () { return readJson(OVERRIDE); },
        devMode: function () {
            return lunaCall("luna://com.webos.service.devmode/getDevMode", {}).then(function (r) {
                return !!(r && r.status === "enabled");
            }, function () { return false; });
        },
        log: log
    });
}

function writeOverride(obj) {
    if (obj === null) {
        try { fs.unlinkSync(OVERRIDE); } catch (e) { /* none */ }
        return;
    }
    fs.mkdirSync(require("path").dirname(OVERRIDE), { recursive: true, mode: 493 });
    fs.writeFileSync(OVERRIDE + ".new", JSON.stringify(obj, null, 2) + "\n", { mode: 420 });
    fs.renameSync(OVERRIDE + ".new", OVERRIDE);
}

// HTTP for the API clients: {method, url, headers, body (text)} ->
// {status, headers, body (text), bytes}; 60 s without an answer fails,
// replies over 8 MB are refused, redirects are not followed (the API
// answers where it is asked).
function request(req) {
    var http = require("http"), https = require("https");
    return new Promise(function (resolve, reject) {
        var u = new URL(req.url);
        var mod = u.protocol === "https:" ? https : http;
        var headers = Object.assign({ "User-Agent": "webOS-Phoenix/0.1" }, req.headers || {});
        var body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body), "utf8");
        if (body) headers["Content-Length"] = String(body.length);
        var r = mod.request(u, { method: req.method || "GET", headers: headers }, function (res) {
            var chunks = [], size = 0;
            res.on("data", function (c) {
                size += c.length;
                if (size > 8 * 1024 * 1024) return r.destroy(new Error("the reply is too large"));
                chunks.push(c);
            });
            res.on("end", function () {
                var all = Buffer.concat(chunks);
                resolve({ status: res.statusCode, headers: res.headers, body: all.toString("utf8"), bytes: new Uint8Array(all) });
            });
            res.on("error", reject);
        });
        r.setTimeout(60000, function () { r.destroy(new Error("the connection timed out")); });
        r.on("error", reject);
        if (body) r.write(body);
        r.end();
    });
}

module.exports = { IMAGE: IMAGE, OVERRIDE: OVERRIDE, servers: servers, readOverride: function () { return readJson(OVERRIDE); },
                   writeOverride: writeOverride, request: request };
