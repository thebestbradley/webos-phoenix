// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The decision model for the evaluation (tools/eval-assistant.cjs
// --decider tools/decider-laya.cjs): apps/assistant/service/lib/decider-laya.js
// asking a Laya over HTTP (tools/laya-server.py, LAYA_URL, default
// http://127.0.0.1:8093). LAYA_THRESHOLD: the confidence it acts on (0.9).

"use strict";

var path = require("path");
var http = require("http");
var lib = require(path.join(__dirname, "..", "apps", "assistant", "service", "lib", "decider-laya.js"));

var URL_ = new URL(process.env.LAYA_URL || "http://127.0.0.1:8093/predict");
var calls = 0, ms = 0;

function predict(state, questions) {
    var body = JSON.stringify({ state: state, questions: questions });
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
        var req = http.request({ hostname: URL_.hostname, port: URL_.port, path: URL_.pathname, method: "POST",
                                 headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, function (res) {
            var chunks = [];
            res.on("data", function (c) { chunks.push(c); });
            res.on("end", function () {
                calls++; ms += Date.now() - t0;
                try {
                    var r = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    if (r.error) reject(new Error(r.error)); else resolve(r);
                } catch (e) { reject(e); }
            });
        });
        req.on("error", reject);
        req.end(body);
    });
}

var decider = lib.createLayaDecider({ predict: predict, threshold: Number(process.env.LAYA_THRESHOLD) || 0.9 });
decider.stats = function () { return { calls: calls, meanMs: Math.round(ms / (calls || 1)) }; };
module.exports = decider;
