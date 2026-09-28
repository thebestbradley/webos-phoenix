// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The request() the DAV client needs, on Node's http and https modules
// (the device service; OSE's Node.js may predate the global fetch). No
// redirects are followed here: davclient.js follows them itself.

"use strict";

var http = require("http");
var https = require("https");

function createRequest(options) {
    options = options || {};
    var timeout = options.timeoutMs || 60000;
    return function request(req) {
        return new Promise(function (resolve, reject) {
            var url = new URL(req.url);
            var mod = url.protocol === "https:" ? https : http;
            var body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body), "utf8");
            var headers = Object.assign({ "User-Agent": "webOS-Phoenix-DAV/0.1" }, req.headers || {});
            if (body) headers["Content-Length"] = String(body.length);
            var r = mod.request(url, { method: req.method, headers: headers }, function (res) {
                var chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    var h = {};
                    Object.keys(res.headers).forEach(function (k) { h[k.toLowerCase()] = String(res.headers[k]); });
                    resolve({ status: res.statusCode, headers: h, body: Buffer.concat(chunks).toString("utf8") });
                });
                res.on("error", reject);
            });
            r.setTimeout(timeout, function () { r.destroy(new Error("request timed out: " + req.method + " " + req.url)); });
            r.on("error", reject);
            if (body) r.write(body);
            r.end();
        });
    };
}

module.exports = { createRequest: createRequest };
