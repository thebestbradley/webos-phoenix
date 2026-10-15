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
// Power: scanning keeps the radio listening. While the screen is on (and
// Bluetooth is) the scan runs, so AirPods opened nearby show at once;
// with the screen off it runs in short windows (10 s every 3 minutes)
// when tracker alerts want it, as AirGuard's scans of 8 s every 15
// minutes and iOS's every 1 to 5 minutes (AirGuard §3.7, §4.1.1), and
// not at all otherwise. With Bluetooth off nothing scans.
//
// createScanner({subscribe, timers?: {setTimeout, clearTimeout, setInterval,
// clearInterval}}) -> {onAdvert(fn), setBluetooth(on), setScreen(on),
// setBackground(wanted), running(), scanNow(ms)}

"use strict";

var BT = "luna://com.webos.service.bluetooth2";
var WINDOW = 10 * 1000, EVERY = 3 * 60 * 1000;

function createScanner(opts) {
    var timers = opts.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval };
    var listeners = [];
    var bluetooth = false, screen = true, background = false;
    var cancel = null, burstUntil = 0, burstTimer = null, cycle = null;
    var now = opts.now || function () { return Date.now(); };

    function wanted() {
        if (!bluetooth) return false;
        return screen || now() < burstUntil;
    }
    function apply() {
        var want = wanted();
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
        // The background windows, while the screen is off.
        var cycling = bluetooth && !screen && background;
        if (cycling && !cycle) cycle = timers.setInterval(function () { burst(WINDOW); }, EVERY);
        else if (!cycling && cycle) { timers.clearInterval(cycle); cycle = null; }
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

module.exports = { createScanner: createScanner, WINDOW: WINDOW, EVERY: EVERY };
