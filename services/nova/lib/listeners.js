// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Which TLS listener novad runs (docs/DEV-PUSH.md 6.2), from Developer Mode
// and its two switches. Only one at a time: on Linux a wildcard ("::",
// dual-stack) cannot bind the port while the USB address already has it
// (EADDRINUSE), so "Push over network" would never come up beside "USB
// debugging". So:
//   - network on: one listener on every address ("::", or 0.0.0.0
//     without IPv6). A connection that arrives
//     on the USB address is allowed while "USB debugging" is on (from any
//     computer at the other end of the cable, as the USB listener allows);
//     any other only from a private address (proto.isPrivate);
//   - network off, USB on: one listener on the USB address only;
//   - neither, or Developer Mode off: none.
// A change closes the old listener (its connections too) before the new
// one binds the port.
//
// createListeners({open(name, host, allow) -> {listening: Promise, close() -> Promise},
//                  state() -> {on, usb, network}, usbAddress, isPrivate, log?})
//   -> {follow() -> Promise (the change made), current() -> name | null}

"use strict";

var WILDCARDS = ["::", "0.0.0.0"];

function plain(addr) {
    return String(addr || "").replace(/^::ffff:/i, "").toLowerCase();
}

function createListeners(o) {
    var log = o.log || function () {};
    var cur = null;
    var chain = Promise.resolve();

    function wanted() {
        var s = o.state();
        if (!s.on) return null;
        if (s.network) return "network";
        return s.usb ? "usb" : null;
    }
    // The wildcard's check: it reads the switches each time, so turning
    // "USB debugging" off while the network listener runs takes effect at once.
    function allowFor(name) {
        if (name === "usb") return null;
        return function (remote, local) {
            if (plain(local) === plain(o.usbAddress)) {
                var s = o.state();
                return !!(s.on && s.usb);
            }
            return o.isPrivate(remote);
        };
    }
    // The first host that binds: "::" takes IPv4 too (dual-stack); a kernel
    // without IPv6 refuses it (EAFNOSUPPORT, EADDRNOTAVAIL), so then 0.0.0.0.
    function start(want, hosts) {
        var host = hosts[0];
        var listener = o.open(want, host, allowFor(want));
        var mine = { name: want, listener: listener };
        cur = mine;
        return listener.listening.then(function () {
            log("listening on " + host);
        }, function (e) {
            if (cur === mine) cur = null;
            if (hosts.length > 1 && (e.code === "EAFNOSUPPORT" || e.code === "EADDRNOTAVAIL")) {
                return Promise.resolve(listener.close()).then(function () { return start(want, hosts.slice(1)); });
            }
            log("cannot listen on " + host + ": " + e.message);
            // Tried again at the next change, or the next look.
        });
    }
    function follow() {
        chain = chain.then(function () {
            var want = wanted();
            if ((cur && cur.name) === want) return;
            var old = cur;
            cur = null;
            return Promise.resolve(old && old.listener.close()).then(function () {
                if (!want) return;
                return start(want, want === "usb" ? [o.usbAddress] : WILDCARDS);
            });
        }).then(null, function (e) { log("listeners: " + e.message); });
        return chain;
    }
    return { follow: follow, current: function () { return cur ? cur.name : null; } };
}

module.exports = { createListeners: createListeners };
