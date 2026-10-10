// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// request({method, url, headers, body}) -> {status, headers, body} on Node's
// http and https modules, for lib/webdav.js on a device. Bodies are text
// (a backup file is JSON). Like apps/shared/synckit/src/node-http.js.

"use strict";

var http = require("http");
var https = require("https");

module.exports = function request(req) {
    return new Promise(function (resolve, reject) {
        var url = new URL(req.url);
        var mod = url.protocol === "https:" ? https : http;
        var body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body), "utf8");
        var headers = Object.assign({ "User-Agent": "webOS-Phoenix-Backup/0.1" }, req.headers || {});
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
        r.setTimeout(120000, function () { r.destroy(new Error("request timed out: " + req.method + " " + req.url)); });
        r.on("error", reject);
        if (body) r.write(body);
        r.end();
    });
};
