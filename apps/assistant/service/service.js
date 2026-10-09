// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.assistant and org.webosphoenix.tts Luna services on a
// device: assistant.js's methods registered with webos-service (OSE's
// nodejs-module-webos-service, as apps/dav/service/service.js does), with
// lib/node-device.js for storage, the device key, llama.cpp's llama-server
// and speech (Kitten TTS, else espeak-ng or Flite). run-js-service starts it on demand
// (sysbus/org.webosphoenix.assistant.service); tools/install-rootfs.py
// installs it with its luna-service2 role and permission files.
//
// Where things live: conversations, settings and sealed keys in
// /var/lib/phoenix/assistant (the service's own, 0700); downloaded models
// in /media/internal/.phoenix/models (they are large); llama-server and
// a speech program from the image (meta-phoenix's packagegroup-phoenix-assistant;
// docs/AI-AND-MCP.md, "What's installed where").

"use strict";

var Service = require("webos-service");
var assistant = require("./assistant");
var nodeHttp = require("./lib/node-http");
var device = require("./lib/node-device");

var DATA = "/var/lib/phoenix/assistant";
var service = new Service(assistant.SERVICE);
var region = require("./lib/region");
var tts = device.speech({ log: function (m) { console.log("[tts] " + m); } });
var watchers = [];

var methods = assistant.createAssistantService({
    luna: {
        call: function (uri, params) {
            return new Promise(function (resolve) {
                service.call(uri, params, function (message) { resolve(message.payload); });
            });
        }
    },
    request: nodeHttp.createRequest({ timeoutMs: 120000 }),
    storage: device.fileStorage(DATA + "/store"),
    secrets: device.fileSecrets(DATA + "/device.key"),
    llm: device.llamaServer({ modelsDir: "/media/internal/.phoenix/models", pidFile: DATA + "/llama-server.pid", log: function (m) { console.log("[assistant] " + m); },
                              onChange: function () { notify(); } }),
    tts: tts,
    // What the voice needs, and how to get what is missing (Settings > Assistant).
    voice: device.voiceStatus({ tts: tts, luna: { call: function (uri, params) {
        return new Promise(function (resolve) { service.call(uri, params, function (message) { resolve(message.payload); }); });
    } } }),
    caller: function () { return current ? current.sender || current.applicationID || "" : ""; },
    // A follow-up question later (lib/followups.js). OSE's notification
    // manager has no buttons: a toast that opens the Assistant on the
    // question (the shell's buttons are phoenix-sim's for now, docs/AI-AND-MCP.md).
    notify: function (n) {
        if (n.remove) return;
        service.call("luna://com.webos.notification/createToast",
                     { sourceId: assistant.SERVICE, message: n.title, onclick: { appId: n.appId, params: n.params || {} } }, function () {});
    },
    changed: function () { notify(); },
    // The device's units (Settings > Language & Region > Units; the region when "auto").
    units: function () { return region.deviceUnits(systemSettings); },
    log: function (m) { console.log("[assistant] " + m); }
});

// The settings the units follow, kept as they change.
var systemSettings = {};
service.subscribe("luna://com.webos.settingsservice/getSystemSettings", { keys: ["localeInfo", "measurementUnits"], subscribe: true })
    .on("response", function (message) { if (message.payload && message.payload.settings) systemSettings = message.payload.settings; });

// The caller of the request being answered (luna-service2 tells the app id).
var current = null;
var WATCHABLE = ["threads", "thread", "getSettings", "providers", "models", "commands", "followUps"];
function notify() {
    watchers = watchers.filter(function (w) { return !w.cancelled; });
    watchers.forEach(function (w) {
        methods[w.name](w.params).then(function (r) { if (!w.cancelled) w.message.respond(r); });
    });
}

assistant.METHODS.forEach(function (name) {
    service.register(name, function (message) {
        var params = Object.assign({}, message.payload || {});
        var sub = !!params.subscribe && WATCHABLE.indexOf(name) >= 0;
        delete params.subscribe;
        current = { sender: message.sender, applicationID: message.applicationID };
        methods[name](params).then(function (reply) {
            if (sub) {
                reply.subscribed = true;
                var w = { name: name, params: params, message: message, cancelled: false };
                watchers.push(w);
                message.on && message.on("cancel", function () { w.cancelled = true; });
            }
            message.respond(reply);
        });
    });
});

var ttsService = new Service("org.webosphoenix.tts");
ttsService.register("speak", function (m) {
    var p = m.payload || {};
    var voice = typeof p.voice === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(p.voice) ? p.voice : "";
    tts.speak(String(p.text || ""), p.lang, voice).then(function () { m.respond({ returnValue: true }); },
        function (e) { m.respond({ returnValue: false, errorCode: 1, errorText: e.message }); });
});
ttsService.register("stop", function (m) { tts.stop(); m.respond({ returnValue: true }); });
ttsService.register("getStatus", function (m) {
    tts.status().then(function (s) { m.respond({ returnValue: true, available: s.available, engine: s.engine, voices: s.voices || [] }); });
});
