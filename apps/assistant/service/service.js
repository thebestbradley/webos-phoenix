// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.assistant and org.webosphoenix.tts Luna services on a
// device: assistant.js's methods registered with webos-service (OSE's
// nodejs-module-webos-service, as apps/dav/service/service.js does), with
// lib/node-device.js for storage, the device key, llama.cpp's llama-server
// and espeak-ng. run-js-service starts it on demand
// (sysbus/org.webosphoenix.assistant.service); tools/install-rootfs.py
// installs it with its luna-service2 role and permission files.
//
// Where things live: conversations, settings and sealed keys in
// /var/lib/phoenix/assistant (the service's own, 0700); downloaded models
// in /media/internal/.phoenix/models (they are large); llama-server and
// espeak-ng from the image (meta-phoenix; see docs/AI-AND-MCP.md for the
// recipes still to write).

"use strict";

var Service = require("webos-service");
var assistant = require("./assistant");
var nodeHttp = require("./lib/node-http");
var device = require("./lib/node-device");

var DATA = "/var/lib/phoenix/assistant";
var service = new Service(assistant.SERVICE);
var tts = device.speech({});
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
    llm: device.llamaServer({ modelsDir: "/media/internal/.phoenix/models", log: function (m) { console.log("[assistant] " + m); },
                              onChange: function () { notify(); } }),
    tts: tts,
    caller: function () { return current ? current.sender || current.applicationID || "" : ""; },
    changed: function () { notify(); },
    log: function (m) { console.log("[assistant] " + m); }
});

// The caller of the request being answered (luna-service2 tells the app id).
var current = null;
var WATCHABLE = ["threads", "thread", "getSettings", "providers", "models", "commands"];
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
    tts.speak(String((m.payload || {}).text || ""), (m.payload || {}).lang).then(function () { m.respond({ returnValue: true }); },
        function (e) { m.respond({ returnValue: false, errorCode: 1, errorText: e.message }); });
});
ttsService.register("stop", function (m) { tts.stop(); m.respond({ returnValue: true }); });
ttsService.register("getStatus", function (m) {
    tts.status().then(function (s) { m.respond({ returnValue: true, available: s.available, engine: s.engine }); });
});
