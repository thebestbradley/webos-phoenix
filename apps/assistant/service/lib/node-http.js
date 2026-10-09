// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The request() the assistant needs (the model providers, Open-Meteo), on
// Node's http and https modules (the device service, and the tests; OSE's
// Node.js may predate the global fetch). Redirects are not followed: the
// APIs it calls do not redirect. req.timeoutMs: the most this one request
// may take in all (the on-device model's deadline, assistant.js bounded);
// then it is closed, which llama-server takes as the end of the task.

"use strict";

var http = require("http");
var https = require("https");

function createRequest(options) {
    options = options || {};
    var timeout = options.timeoutMs || 120000;
    return function request(req) {
        return new Promise(function (resolve, reject) {
            var url = new URL(req.url);
            var mod = url.protocol === "https:" ? https : http;
            var body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body), "utf8");
            var headers = Object.assign({ "User-Agent": "webOS-Phoenix-Assistant/0.1" }, req.headers || {});
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
            if (req.timeoutMs > 0) {
                var all = setTimeout(function () { r.destroy(new Error("request timed out: " + req.method + " " + req.url)); }, req.timeoutMs);
                r.on("close", function () { clearTimeout(all); });
            }
            r.on("error", reject);
            if (body) r.write(body);
            r.end();
        });
    };
}

module.exports = { createRequest: createRequest };
