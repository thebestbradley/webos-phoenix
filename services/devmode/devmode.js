// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.webos.service.devmode on a device: Developer Mode, as Settings, the
// shell and Phoenix's services ask it (the simulator's runtime answers the
// same API: runtime/phoenix-runtime.js "com.webos.service.devmode"):
//
//   getDevMode {subscribe}  -> {status: "enabled" | "disabled"}
//   setDevMode {status}     -> {status, restarting}: the flag changes and
//                              the device restarts (service.js), so every
//                              part of the system reads it once, at start
//
// The flag is OSE's own, /var/luna/preferences/devmode_enabled, the file
// OSE's com.palm.service.devmode reads and writes
// (com.palm.service.devmode devmode_service.js:20-27, 55-121 at 94b6921;
// its getDevMode answers {enabled}, setDevMode takes {enabled}), so the two
// services, OSE's boot script (devmode.sh) and novad (services/nova) and
// WebAppMgr's start script (phoenix-wam.sh) all read one file. As OSE's
// does, turning it on also writes dc0 beside it and turning it off removes
// dc0 to dc9 (devmode_service.js:81-91, 106-110).
// Written against injected dependencies (the tests use a temporary folder).
//
// deps: {dir (/var/luna/preferences), log?}

"use strict";

var fs = require("fs");
var path = require("path");

var SERVICE = "com.webos.service.devmode";
var DIR = "/var/luna/preferences";
var FLAG = "devmode_enabled";
var METHODS = ["getDevMode", "setDevMode"];

function createDevMode(deps) {
    var dir = deps.dir || DIR;
    var log = deps.log || function () {};
    var watchers = [];
    var flag = path.join(dir, FLAG);

    function on() { return fs.existsSync(flag); }
    function status() { return on() ? "enabled" : "disabled"; }
    function fail(code, text) { return { returnValue: false, errorCode: code, errorText: text }; }

    function set(enable) {
        if (enable) {
            fs.mkdirSync(dir, { recursive: true, mode: 493 });
            fs.writeFileSync(flag, "");
            fs.writeFileSync(path.join(dir, "dc0"), "");
        } else {
            fs.rmSync(flag, { force: true });
            for (var i = 0; i < 10; i++) fs.rmSync(path.join(dir, "dc" + i), { force: true });
        }
    }

    // Both forms in every answer: Phoenix's {status} and OSE's {enabled}, which
    // callers read (the hardware service, the apps' devMode.watch; strict mode S1:
    // a reader of `enabled` saw Developer Mode off on a device while it was on).
    function answer(r) { r.status = status(); r.enabled = on(); return r; }
    var methods = {
        getDevMode: function () {
            return Promise.resolve(answer({ returnValue: true }));
        },
        // {status: "enabled" | "disabled"} (Phoenix's), or OSE's {enabled}.
        setDevMode: function (p) {
            p = p || {};
            var want;
            if (p.status === "enabled" || p.status === "disabled") want = p.status === "enabled";
            else if (typeof p.enabled === "boolean") want = p.enabled;
            else return Promise.resolve(fail("BAD_PARAMS", "status: \"enabled\" or \"disabled\""));
            if (want === on()) return Promise.resolve(answer({ returnValue: true, restarting: false }));
            try { set(want); } catch (e) {
                log("setDevMode: " + e.message);
                return Promise.resolve(fail("WRITE_FAILED", "Could not change Developer Mode: " + e.message));
            }
            log("Developer Mode " + status() + "; restarting");
            watchers.slice().forEach(function (w) { try { w(answer({ returnValue: true })); } catch (e) { /* its own */ } });
            return Promise.resolve(answer({ returnValue: true, restarting: true }));
        }
    };
    return {
        methods: methods,
        status: status,
        // getDevMode's subscribers: cb({returnValue, status}) -> stop()
        watch: function (cb) {
            watchers.push(cb);
            return function () { watchers = watchers.filter(function (w) { return w !== cb; }); };
        }
    };
}

module.exports = { SERVICE: SERVICE, DIR: DIR, FLAG: FLAG, METHODS: METHODS, createDevMode: createDevMode };
