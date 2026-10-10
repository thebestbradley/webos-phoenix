// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// HTTP on a device (Node's http and https): request() -> {status, headers,
// body} (text) and requestBytes() -> {status, headers, bytes}, which follows
// redirects (downloads). Like apps/shared/synckit/src/node-http.js.

"use strict";

var http = require("http");
var https = require("https");

function send(req, binary, redirects) {
    return new Promise(function (resolve, reject) {
        var url = new URL(req.url);
        var mod = url.protocol === "https:" ? https : http;
        var body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body), "utf8");
        var headers = Object.assign({ "User-Agent": "webOS-Phoenix-Marketplace/0.1" }, req.headers || {});
        if (body) headers["Content-Length"] = String(body.length);
        var r = mod.request(url, { method: req.method || "GET", headers: headers }, function (res) {
            if (binary && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
                res.resume();
                return resolve(send({ method: "GET", url: new URL(res.headers.location, url).href, headers: req.headers }, binary, redirects + 1));
            }
            var chunks = [];
            res.on("data", function (c) { chunks.push(c); });
            res.on("end", function () {
                var h = {};
                Object.keys(res.headers).forEach(function (k) { h[k.toLowerCase()] = String(res.headers[k]); });
                var data = Buffer.concat(chunks);
                resolve(binary ? { status: res.statusCode, headers: h, bytes: new Uint8Array(data) }
                               : { status: res.statusCode, headers: h, body: data.toString("utf8") });
            });
            res.on("error", reject);
        });
        r.setTimeout(120000, function () { r.destroy(new Error("request timed out: " + req.url)); });
        r.on("error", reject);
        if (body) r.write(body);
        r.end();
    });
}

module.exports = {
    request: function (req) { return send(req, false, 0); },
    requestBytes: function (req) { return send(req, true, 0); }
};
