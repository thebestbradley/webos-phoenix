// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.transcriber Luna service: registers the methods of
// transcriber.js with webos-service, the Node.js module OSE's JavaScript
// services use (webosose/nodejs-module-webos-service). run-js-service
// starts it on demand (sysbus/org.webosphoenix.transcriber.service); the
// role and permission files beside it follow OSE's luna-service2 ACG
// format and are installed by tools/install-rootfs.py.
//
// transcribe with subscribe: true answers every progress step, then the
// result; cancelling the subscription stops whisper-cli. An activity keeps
// the service alive while a transcription runs (webos-service otherwise
// exits a few seconds after the last request).

"use strict";

const Service = require("webos-service");
const { createTranscriber } = require("./transcriber");

const service = new Service("org.webosphoenix.transcriber");
const tr = createTranscriber();
const running = new Map();   // message.uniqueToken -> child processes

let busy = 0;
let keepAlive = null;
function hold() {
    if (busy++ === 0 && !keepAlive)
        service.activityManager.create("transcribing", (activity) => { keepAlive = activity; });
}
function release() {
    if (--busy === 0 && keepAlive) {
        service.activityManager.complete(keepAlive, () => {});
        keepAlive = null;
    }
}

service.register("transcribe", (message) => {
    const token = message.uniqueToken;
    const children = [];
    running.set(token, children);
    hold();
    const progress = (reply) => {
        if (message.isSubscription && running.has(token)) message.respond(Object.assign({ subscribed: true }, reply));
    };
    // A child started after a cancel (the job was queued) is stopped at once.
    const onChild = (child) => {
        if (running.has(token)) children.push(child);
        else try { child.kill("SIGTERM"); } catch (e) { /* gone */ }
    };
    tr.transcribe(message.payload, progress, onChild).then((reply) => {
        release();
        if (!running.delete(token) && message.isSubscription) return;   // cancelled
        message.respond(reply);
    });
}, (message) => {
    const children = running.get(message.uniqueToken);
    running.delete(message.uniqueToken);
    if (children) children.forEach((c) => { try { c.kill("SIGTERM"); } catch (e) { /* gone */ } });
});

service.register("getStatus", (message) => {
    tr.getStatus().then((reply) => message.respond(reply));
});
