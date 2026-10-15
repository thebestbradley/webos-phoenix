// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The LE scan AirPods' cards and tracker alerts listen to, through OSE's
// Bluetooth service (com.webos.service.bluetooth2): le/startScan
// {subscribe: true} reports each advertising device as it is heard
// ({device: {address, rssi, name, scanRecord, manufacturerData}},
// BluetoothManagerAdapter::notifySubscriberLeDevicesChangedbyScanId); the
// scan lasts as long as the subscription, and cancelling it stops it. No
// filter: AirPods and Find My trackers are Apple's manufacturer data, the
// other trackers service data (continuity.js), and bluetooth2 takes one
// filter of each kind per scan.
//
// Power: scanning keeps the radio listening. How much is the user's choice
// (Settings > Bluetooth > Scanning; the owner, 15 October 2026), one of
// three modes (MODES; docs/ACCESSORIES.md, "Power"):
//
//   balanced (the default): with the screen on the scan runs, so AirPods
//     opened nearby show at once; with the screen off, 10 s every 3
//     minutes, as iOS scans every 1 to 5 minutes (AirGuard, WiSec 2022,
//     §3.7, §4.1.1).
//   saver: with the screen on, 10 s in every 30 s (Phoenix's own: an
//     opened case shows within about 20 s); with the screen off, 20 s every
//     15 minutes, AirGuard's own background scan today (seemoo-lab/
//     AirGuard, Apache-2.0: WorkerConstants.MIN_MINUTES_TO_NEXT_BT_SCAN,
//     BackgroundBluetoothScanner.getScanDuration).
//   performance: with the screen on the scan runs; with the screen off,
//     10 s every minute, iOS's shortest interval (AirGuard §3.7). Not a
//     scan that never stops: the tracker rule counts a tracker at most
//     once in 2 minutes (trackerdetect.js sightingGap), and with the
//     screen off nothing shows the AirPods' card, so a longer scan would
//     only spend the battery.
//
// With the screen off the scan runs only while tracker alerts want it
// (setBackground); with Bluetooth off nothing scans.
//
// createScanner({subscribe, timers?: {setTimeout, clearTimeout, setInterval,
// clearInterval}, mode?}) -> {onAdvert(fn), setBluetooth(on), setScreen(on),
// setBackground(wanted), setMode(mode), mode(), windows(mode?), running(),
// scanNow(ms)}

"use strict";

var BT = "luna://com.webos.service.bluetooth2";
var S = 1000, MIN = 60 * S;
// Each mode: the screen on and off; null is a scan that runs, else
// {window, every}: a window of `window` ms every `every` ms.
var MODES = {
    saver: { screenOn: { window: 10 * S, every: 30 * S }, screenOff: { window: 20 * S, every: 15 * MIN } },
    balanced: { screenOn: null, screenOff: { window: 10 * S, every: 3 * MIN } },
    performance: { screenOn: null, screenOff: { window: 10 * S, every: 1 * MIN } }
};
var WINDOW = MODES.balanced.screenOff.window, EVERY = MODES.balanced.screenOff.every;

function createScanner(opts) {
    var timers = opts.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval };
    var listeners = [];
    var bluetooth = false, screen = true, background = false;
    var mode = MODES[opts.mode] ? opts.mode : "balanced";
    var cancel = null, burstUntil = 0, burstTimer = null, cycle = null, cycleKey = "";
    var now = opts.now || function () { return Date.now(); };

    // What the scan should do now: "off", "on" (it runs) or {window, every}.
    function plan() {
        if (!bluetooth) return "off";
        if (screen) return MODES[mode].screenOn || "on";
        return background ? MODES[mode].screenOff : "off";
    }
    function apply() {
        var p = plan();
        var want = p === "on" || (p !== "off" && now() < burstUntil);
        if (want && !cancel) {
            cancel = opts.subscribe(BT + "/le/startScan", { subscribe: true }, function (r) {
                if (!r || r.returnValue === false || !r.device) return;
                listeners.forEach(function (fn) { fn(r.device); });
            });
        } else if (!want && cancel) {
            var c = cancel;
            cancel = null;
            if (typeof c === "function") c();
        }
        // The windows: while the screen is off (the first after a whole
        // gap), or with the screen on in saver (the first at once).
        var key = typeof p === "object" ? (screen ? "on:" : "off:") + p.window + "/" + p.every : "";
        if (key !== cycleKey) {
            if (cycle) timers.clearInterval(cycle);
            cycle = null;
            cycleKey = key;
            if (key) {
                cycle = timers.setInterval(function () { burst(p.window); }, p.every);
                if (screen) burst(p.window);
            }
        }
    }
    function burst(ms) {
        burstUntil = now() + ms;
        if (burstTimer) timers.clearTimeout(burstTimer);
        burstTimer = timers.setTimeout(function () { burstTimer = null; apply(); }, ms + 50);
        apply();
    }
    return {
        onAdvert: function (fn) { listeners.push(fn); },
        setBluetooth: function (on) { bluetooth = !!on; apply(); },
        setScreen: function (on) { screen = !!on; apply(); },
        setBackground: function (on) { background = !!on; apply(); },
        setMode: function (m) {
            if (!MODES[m]) return false;
            mode = m;
            apply();
            return true;
        },
        mode: function () { return mode; },
        // A mode's windows, for the status: {screenOn, screenOff}, each null
        // (the scan runs) or {window, every} in ms.
        windows: function (m) { return JSON.parse(JSON.stringify(MODES[m || mode])); },
        scanNow: function (ms) { burst(ms || WINDOW); },
        running: function () { return !!cancel; },
        close: function () {
            if (cycle) timers.clearInterval(cycle);
            if (burstTimer) timers.clearTimeout(burstTimer);
            if (typeof cancel === "function") cancel();
            cancel = null;
        }
    };
}

module.exports = { createScanner: createScanner, MODES: MODES, WINDOW: WINDOW, EVERY: EVERY };
