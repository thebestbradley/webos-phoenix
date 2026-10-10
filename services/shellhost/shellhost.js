// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.shellhost: the pages' line to the shell on a device, and
// the shell's to the pages (docs/DEVICE-AUDIT.md, "The shell's messages").
//
// In phoenix-sim the shell, the system UI and every app page are one
// process: a page tells the shell something with
// phoenixHost.postToHost(type, payload) (a console message the simulator
// reads), and the shell runs script in a page to tell it something
// (SimWindowSource._hostMessage, runScript). On a device each app is a
// WebAppMgr page in a process of its own and the shell is
// luna-surfacemanager, so both directions go over the bus, through this
// service:
//
//   post {type, payload}        a page (any app): a message for the shell.
//                               The shell hears {appId, type, payload},
//                               appId being the caller luna-service2 names
//                               (never a field of the payload: a page cannot
//                               speak for another app).
//   listen {subscribe: true}    the shell only (com.webos.surfacemanager):
//                               every post, as it comes; posts made while
//                               no shell listened (an app started before the
//                               shell, a shell restarting) are kept, up to
//                               KEEP of them for KEEP_MS, and come first.
//   events {subscribe: true}    a page (any app): what the shell sends to
//                               the caller's app, {type, payload}; nothing
//                               meant for another app.
//   send {appId, type, payload} the shell only: to every page of appId
//                               listening to events -> {delivered}.
//
// Why a service of its own rather than methods of luna-surfacemanager's
// own bus name (its QML Service can register methods, BaseLunaServiceAPI.qml
// does): a QML Service's subscription replies go to every subscriber of the
// method alike (qml-webos-bridge Service::pushSubscription), and what the
// shell sends one app (the text typed into Just Type, a paste) is not for
// the others. Here each app hears only its own.
//
// The same process serves org.webosphoenix.ongoing (the runtime's
// "Ongoing activities", which Node services call too: the hardware and
// update services' progress, the Marketplace's installs):
//
//   set {id, appId?, title, body?, icon?, progress, params?}, clear {id}
//                               an "ongoing" message for the shell, from
//                               the caller, as the runtime's page service
//                               posts it in phoenix-sim
//
// and org.webosphoenix.system (the runtime's, which the Assistant's service
// calls on a device: "what's playing", "pause"):
//
//   setNowPlaying {title, artist?, album?, playing, appId?}, getNowPlaying
//                               -> {nowPlaying: {..., appId, time} | null}
//   mediaKey {key}              a "mediaKey" message for the shell, which
//                               presses it (com.palm.display/phoenix/report
//                               {mediaKey}: phoenix-devices' /media events)
//   restartUi {}                not on a device yet (Luna Restart restarts
//                               luna-surfacemanager: OPEN-QUESTIONS)
//
// createShellHost({isShell(caller), now()}) -> {post, listen, events, send,
// ongoing: {set, clear}, system: {...}}
// each (params, caller, respond(reply)) -> cancel() | undefined; the
// service file binds them to webos-service (service.js).
// STATUS: written against webos-service's API and shellhost.test.ts; not
// yet run on a device.

"use strict";

var SERVICE = "org.webosphoenix.shellhost";
var SHELL_NAMES = ["com.webos.surfacemanager"];
var KEEP = 200;            // posts kept while no shell listens
var KEEP_MS = 120000;      // and for how long
var MAX_PAYLOAD = 2000000; // characters of JSON (a screenshot's PNG, a print job's page)
var TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function ok(extra) {
    var r = { returnValue: true };
    for (var k in extra) r[k] = extra[k];
    return r;
}

function fail(code, text) {
    return { returnValue: false, errorCode: code, errorText: text };
}

// The app a caller is: WebAppMgr's pages call as their app id; a process
// suffix (" 1234", "-1234" of a WebAppMgr instance) is not part of it.
function appIdOf(caller) {
    var s = String(caller || "").trim();
    s = s.split(" ")[0];
    return s;
}

function sizeOf(v) {
    try { return JSON.stringify(v === undefined ? {} : v).length; } catch (e) { return Infinity; }
}

function createShellHost(opts) {
    opts = opts || {};
    var isShell = opts.isShell || function (caller) { return SHELL_NAMES.indexOf(appIdOf(caller)) >= 0; };
    var now = opts.now || function () { return Date.now(); };
    var shells = [];        // [{respond}]
    var apps = {};          // appId -> [{respond}]
    var kept = [];          // [{at, message}]
    var serial = 0;

    function deliverToShells(message) {
        shells.slice().forEach(function (s) { s.respond(ok({ subscribed: true, message: message })); });
        return shells.length;
    }

    function post(p, caller, respond) {
        var appId = appIdOf(caller);
        if (!appId)
            return respond(fail(-1, "Unknown caller"));
        if (typeof p.type !== "string" || !TYPE.test(p.type))
            return respond(fail(-1, "type: a message type (letters, digits, _ . -)"));
        var payload = p.payload === undefined ? {} : p.payload;
        if (payload === null || typeof payload !== "object" || Array.isArray(payload))
            return respond(fail(-1, "payload: an object"));
        if (sizeOf(payload) > MAX_PAYLOAD)
            return respond(fail(-1, "payload too large"));
        var message = { id: ++serial, appId: appId, type: p.type, payload: payload, time: now() };
        var n = deliverToShells(message);
        if (n === 0) {
            var t = now();
            kept = kept.filter(function (k) { return t - k.at < KEEP_MS; });
            kept.push({ at: t, message: message });
            if (kept.length > KEEP)
                kept.shift();
        }
        respond(ok({ delivered: n > 0 }));
    }

    function listen(p, caller, respond) {
        if (!isShell(caller))
            return respond(fail(-1, "Only the shell listens"));
        if (!p.subscribe) {
            respond(ok({ listening: shells.length }));
            return;
        }
        var s = { respond: respond };
        shells.push(s);
        respond(ok({ subscribed: true }));
        var t = now();
        var waiting = kept.filter(function (k) { return t - k.at < KEEP_MS; });
        kept = [];
        waiting.forEach(function (k) { respond(ok({ subscribed: true, message: k.message })); });
        return function () { shells = shells.filter(function (x) { return x !== s; }); };
    }

    function events(p, caller, respond) {
        var appId = appIdOf(caller);
        if (!appId)
            return respond(fail(-1, "Unknown caller"));
        if (!p.subscribe)
            return respond(fail(-1, "subscribe: true"));
        var s = { respond: respond };
        (apps[appId] = apps[appId] || []).push(s);
        respond(ok({ subscribed: true }));
        return function () {
            apps[appId] = (apps[appId] || []).filter(function (x) { return x !== s; });
            if (!apps[appId].length) delete apps[appId];
        };
    }

    function send(p, caller, respond) {
        if (!isShell(caller))
            return respond(fail(-1, "Only the shell sends"));
        if (typeof p.appId !== "string" || !p.appId)
            return respond(fail(-1, "appId is required"));
        if (typeof p.type !== "string" || !TYPE.test(p.type))
            return respond(fail(-1, "type: a message type (letters, digits, _ . -)"));
        var payload = p.payload === undefined ? {} : p.payload;
        if (payload === null || typeof payload !== "object" || Array.isArray(payload))
            return respond(fail(-1, "payload: an object"));
        var list = (apps[p.appId] || []).slice();
        list.forEach(function (s) { s.respond(ok({ subscribed: true, event: { type: p.type, payload: payload } })); });
        respond(ok({ delivered: list.length }));
    }

    function listening(appId) { return (apps[appId] || []).length; }

    var ongoing = {
        set: function (p, caller, respond) {
            if (!p.id || !p.title) return respond(fail(-1, "id and title are required"));
            post({ type: "ongoing", payload: {
                id: String(p.id), appId: p.appId ? String(p.appId) : appIdOf(caller), title: String(p.title),
                body: p.body ? String(p.body) : "", icon: p.icon ? String(p.icon) : "",
                params: p.params && typeof p.params === "object" ? p.params : null,
                progress: typeof p.progress === "number" ? p.progress : -1 } }, caller, function (r) {
                respond(r.returnValue ? ok() : r);
            });
        },
        clear: function (p, caller, respond) {
            if (!p.id) return respond(fail(-1, "id is required"));
            post({ type: "ongoing", payload: { id: String(p.id), clear: true } }, caller, function (r) {
                respond(r.returnValue ? ok() : r);
            });
        }
    };

    var nowPlaying = null;
    var MEDIA_KEYS = ["play", "pause", "togglePausePlay", "stop", "next", "prev"];
    var system = {
        setNowPlaying: function (p, caller, respond) {
            if (typeof p.title !== "string") return respond(fail(-1, "title is required"));
            nowPlaying = { title: p.title, artist: String(p.artist || ""), album: String(p.album || ""), playing: !!p.playing,
                           appId: String(p.appId || appIdOf(caller)), time: now() };
            respond(ok());
        },
        getNowPlaying: function (p, caller, respond) { respond(ok({ nowPlaying: nowPlaying })); },
        mediaKey: function (p, caller, respond) {
            if (MEDIA_KEYS.indexOf(p.key) < 0) return respond(fail(-1, "key: play, pause, togglePausePlay, stop, next or prev"));
            post({ type: "mediaKey", payload: { key: p.key } }, caller, function (r) { respond(r.returnValue ? ok() : r); });
        },
        restartUi: function (p, caller, respond) {
            respond(fail(-1, "Restarting the system UI is not available on this device yet"));
        }
    };

    return { post: post, listen: listen, events: events, send: send, listening: listening, ongoing: ongoing, system: system };
}

var METHODS = ["post", "listen", "events", "send"];
var ONGOING = "org.webosphoenix.ongoing";
var ONGOING_METHODS = ["set", "clear"];
var SYSTEM = "org.webosphoenix.system";
var SYSTEM_METHODS = ["setNowPlaying", "getNowPlaying", "mediaKey", "restartUi"];

module.exports = { createShellHost: createShellHost, appIdOf: appIdOf, METHODS: METHODS, SERVICE: SERVICE,
                   ONGOING: ONGOING, ONGOING_METHODS: ONGOING_METHODS, SYSTEM: SYSTEM, SYSTEM_METHODS: SYSTEM_METHODS,
                   SHELL_NAMES: SHELL_NAMES, KEEP: KEEP, KEEP_MS: KEEP_MS };
