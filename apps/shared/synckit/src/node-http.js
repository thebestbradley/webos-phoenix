// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// request({method, url, headers, body}) -> Promise<{status, headers, body}>
// on Node's http and https modules: what the transports' HTTP clients
// (apps/dav's davclient.js, the connector kit's http.js) need on a device,
// whose Node.js may predate the global fetch. No redirects are followed
// here: the clients follow them themselves. body is a string (sent as
// UTF-8) or bytes (a Uint8Array or Buffer, sent as they are);
// {binary: true} answers bytes (a Uint8Array) instead of text.

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
            var body = req.body === undefined || req.body === null ? null
                : typeof req.body === "string" ? Buffer.from(req.body, "utf8") : Buffer.from(req.body);
            var headers = Object.assign({ "User-Agent": options.userAgent || "webOS-Phoenix-DAV/0.1" }, req.headers || {});
            if (body) headers["Content-Length"] = String(body.length);
            var r = mod.request(url, { method: req.method, headers: headers }, function (res) {
                var chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    var h = {};
                    Object.keys(res.headers).forEach(function (k) { h[k.toLowerCase()] = String(res.headers[k]); });
                    var all = Buffer.concat(chunks);
                    if (req.binary) resolve({ status: res.statusCode, headers: h, bytes: new Uint8Array(all) });
                    else resolve({ status: res.statusCode, headers: h, body: all.toString("utf8") });
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
