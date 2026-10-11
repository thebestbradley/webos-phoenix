// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.index on a device (run-js-service): indexservice.js
// on the bus, with device.js's files, model server and conditions.
//
// Where things live: the index and its settings in /var/lib/phoenix/index
// (the service's own, 0700; not on the USB drive, and no backup
// registration: it never leaves the device); the model in
// /media/internal/.phoenix/models/index (beside the Assistant's models).
//
// Keeping up: an activity per source the index reads from db8, whose
// trigger is a db8 watch for a revision after the last one indexed
// (incDel: deletions too) and whose callback is sync {source}, made again
// after each pass with the new revision (the contacts linker's
// autolinker.js:1735-1760 restartActivityUsingRevisionNumber), and a
// daily one with the charger required (sync {full: true}: files, and
// records db8 purged); none while the index is off. A pass keeps the
// service running (an activity of its own) until it ends.
//
// The caller is the one luna-service2 names: a page's app id, else the
// calling service's bus name.

"use strict";

var path = require("path");
var zlib = require("zlib");
var fs = require("fs");
var Service = require("webos-service");
var index = require("./indexservice");
var device = require("./device");
var sources = require("./lib/sources");

var DATA = "/var/lib/phoenix/index";
var MODELS = "/media/internal/.phoenix/models/index";
var AM = "luna://com.palm.activitymanager/";

var service = new Service(index.SERVICE);
var watchers = [];
function log(m) { console.log("[index] " + m); }
function call(uri, params) {
    return new Promise(function (resolve) { service.call(uri, params, function (m) { resolve(m.payload || {}); }); });
}
function notify() {
    watchers = watchers.filter(function (w) { return !w.cancelled; });
    watchers.forEach(function (w) { methods.getStatus({}).then(function (r) { if (!w.cancelled) w.message.respond(Object.assign({ subscribed: true }, r)); }); });
}
var nodeHttp = device.assistantLib("node-http.js");

var svc = index.createIndexService({
    luna: { call: call },
    storage: device.jsonStorage(path.join(DATA, "state")),
    files: device.fileStore(DATA),
    models: device.modelServer({ modelsDir: MODELS, pidFile: path.join(DATA, "llama-server.pid"), log: log, onChange: notify }),
    request: nodeHttp.createRequest({ timeoutMs: 120000 }),
    conditions: device.conditions(call),
    readText: function (p, max) {
        return new Promise(function (resolve) {
            fs.open(p, "r", function (e, fd) {
                if (e) return resolve(null);
                var buf = Buffer.alloc(max || 262144);
                fs.read(fd, buf, 0, buf.length, 0, function (e2, n) { fs.close(fd, function () {}); resolve(e2 ? null : buf.subarray(0, n).toString("utf8")); });
            });
        });
    },
    readBytes: function (p, max) {
        return new Promise(function (resolve) {
            fs.stat(p, function (e, st) {
                if (e || !st.isFile() || st.size > (max || Infinity)) return resolve(null);
                fs.readFile(p, function (e2, b) { resolve(e2 ? null : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); });
            });
        });
    },
    inflate: function (bytes) { return new Uint8Array(zlib.inflateSync(Buffer.from(bytes))); },
    maxAudioSeconds: 300,
    caller: function () { return ""; },
    changed: function () { notify(); arm(); },
    log: log
});
var methods = svc.methods;

// The activities that wake it, as the settings and revisions are now.
var armed = "";
function arm() {
    var s = svc.settings();
    var st = s.enabled ? sources.SOURCES.filter(function (x) { return s.sources[x.id] && x.kind; }) : [];
    Promise.all(st.map(function (x) { return svc.load(x.id).then(function (idx) { return { def: x, rev: idx.rev }; }); })).then(function (list) {
        var key = JSON.stringify([s.enabled, list.map(function (x) { return [x.def.id, x.rev]; })]);
        if (key === armed) return;
        armed = key;
        sources.SOURCES.forEach(function (x) {
            var mine = list.filter(function (y) { return y.def.id === x.id; })[0];
            var name = "org.webosphoenix.service.index.watch." + x.id;
            if (!mine) { call(AM + "cancel", { activityName: name }); return; }
            call(AM + "create", { start: true, replace: true, activity: {
                name: name, description: "Search your phone: " + x.title, type: { background: true, persist: true },
                trigger: { method: "palm://com.palm.db/watch", key: "fired",
                           params: { query: { from: x.kind, where: [{ prop: "_rev", op: ">", val: mine.rev }], incDel: true, limit: 1 }, subscribe: true } },
                callback: { method: "palm://" + index.SERVICE + "/sync", params: { source: x.id } } } });
        });
        var daily = "org.webosphoenix.service.index.daily";
        if (!s.enabled) { call(AM + "cancel", { activityName: daily }); return; }
        call(AM + "create", { start: true, replace: true, activity: {
            name: daily, description: "Search your phone: files, and what was purged", type: { background: true, persist: true },
            schedule: { interval: "1d" }, requirements: { charging: true },
            callback: { method: "palm://" + index.SERVICE + "/sync", params: { full: true } } } });
    });
}

// A pass keeps the service running until it ends.
var busy = 0, keepAlive = null;
function hold(p) {
    if (busy++ === 0 && !keepAlive) service.activityManager.create("indexing", function (a) { keepAlive = a; });
    return Promise.resolve(p).then(function (r) { release(); return r; }, function (e) { release(); throw e; });
}
// A pass a method started after answering (setSettings, rebuild): held too.
function holdWhileRunning() {
    if (keepAlive || !svc.running()) return;
    hold(new Promise(function (resolve) { (function check() { if (!svc.running()) return resolve(); setTimeout(check, 1000); })(); }));
}
function release() {
    if (--busy === 0 && keepAlive) { service.activityManager.complete(keepAlive, function () {}); keepAlive = null; }
}

index.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var params = Object.assign({}, message.payload || {});
        var caller = message.applicationID || message.senderServiceName || message.sender || "";
        var sub = name === "getStatus" && !!params.subscribe;
        delete params.subscribe;
        var run = methods[name](params, caller);
        if (name === "sync") run = hold(run);
        run.then(function (reply) {
            setTimeout(holdWhileRunning, 10);
            if (sub) {
                reply.subscribed = true;
                var w = { message: message, cancelled: false };
                watchers.push(w);
                if (message.on) message.on("cancel", function () { w.cancelled = true; });
            }
            message.respond(reply);
            arm();
        }, function (e) { message.respond({ returnValue: false, errorCode: -1, errorText: String(e && e.message || e) }); });
    });
});
arm();
