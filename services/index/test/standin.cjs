// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.index for the Assistant's tests and evaluation
// (apps/assistant/service/test/device.cjs): the real service over that
// device's bus and db8, with the fake embedder (fake-embedder.cjs), its
// model downloaded, files and settings in memory. on: whether the user
// turned it on. Each search is preceded by a pass, as the device's
// background indexing would have kept it up to date.
//
//   standIn(luna, {on, answers, seed: [records]}) -> {call(method, params) -> Promise<reply>, svc}

"use strict";

var path = require("path");
var createIndexService = require(path.join(__dirname, "..", "indexservice.js")).createIndexService;
var modelLib = require(path.join(__dirname, "..", "lib", "model.js"));
var fake = require("./fake-embedder.cjs");

function standIn(luna, opts) {
    opts = opts || {};
    var kept = new Map(), stored = new Map();
    if (opts.on) stored.set("index:settings", JSON.stringify({ enabled: true, answers: opts.answers !== false }));
    var svc = createIndexService({
        luna: luna, embedder: fake.createFakeEmbedder(), minScore: 0.5, margin: 1,
        storage: { get: function (k) { return stored.has(k) ? JSON.parse(stored.get(k)) : null; }, set: function (k, v) { stored.set(k, JSON.stringify(v)); }, remove: function (k) { stored.delete(k); } },
        files: { read: function (n) { return Promise.resolve(kept.get(n) || null); }, write: function (n, b) { kept.set(n, b.slice()); return Promise.resolve(); },
                 remove: function (n) { kept.delete(n); return Promise.resolve(); } },
        models: { status: function () { return Promise.resolve({ available: true, installed: [{ id: modelLib.TEXT.id }] }); },
                  ensure: function () { return Promise.resolve({ baseUrl: "http://127.0.0.1:1/v1" }); } },
        conditions: function () { return Promise.resolve({ charging: true, battery: 90 }); },
        setTimeout: function (fn) { return setTimeout(fn, 0); }
    });
    // The records a case is about, added to the device's world.
    var seeded = opts.seed && opts.seed.length ? luna.call("luna://com.palm.db/put", { objects: opts.seed }) : Promise.resolve();
    return {
        svc: svc,
        call: function (method, params) {
            var m = svc.methods[method];
            if (!m) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "Unknown method " + method });
            var before = seeded.then(function () { return method === "search" ? svc.pass({}) : null; });
            return before.then(function () { return m(params || {}); });
        }
    };
}

module.exports = { standIn: standIn };
