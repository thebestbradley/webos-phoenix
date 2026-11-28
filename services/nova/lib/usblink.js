// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The USB debugging link (docs/DEV-PUSH.md 6.2): the CDC NCM gadget, while
// Developer Mode and "USB debugging" are on (phoenix-devmode's
// phoenix-usb-debug; a device without a USB device controller says so).
//
// The state it holds is what the helper last did, not what was asked: a
// failed "up" (another gadget holds the controller, no controller yet) is
// tried again at the next follow(), the once-a-minute one included, so the
// link comes up once the controller is free. One run at a time; a change
// asked for while one runs is made when it ends. The same failure is
// logged once, not every minute.
//
// createUsbLink({want() -> bool, run(cmd, args) -> Promise({stdout}), log(text)})
//   -> {follow() -> Promise (the run made, or resolved at once), state() -> true | false | null}

"use strict";

var HELPER = "/usr/sbin/phoenix-usb-debug";

function createUsbLink(deps) {
    var done = null;        // true: up, false: down, null: not known (start, or the last run failed)
    var running = null;     // the Promise of the run in progress
    var again = false;      // follow() was called while it ran
    var lastFailure = null;

    function follow() {
        if (running) { again = true; return running; }
        var want = !!deps.want();
        if (want === done) return Promise.resolve();
        var verb = want ? "up" : "down";
        running = Promise.resolve().then(function () { return deps.run(HELPER, [verb]); }).then(function (r) {
            done = want;
            lastFailure = null;
            deps.log(String((r && r.stdout) || "").trim() || "USB debugging link " + verb);
        }, function (e) {
            done = null;
            var text = "USB debugging link " + verb + ": " + String((e && (e.stdout || e.message)) || e).trim();
            if (text !== lastFailure) deps.log(text);
            lastFailure = text;
        }).then(function () {
            running = null;
            if (again) { again = false; return follow(); }
        });
        return running;
    }

    return { follow: follow, state: function () { return done; } };
}

module.exports = { createUsbLink: createUsbLink, HELPER: HELPER };
