// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.trackers: unknown tracker alerts (docs/ACCESSORIES.md):
// an AirTag, another Find My accessory, a tracker of Google's, Samsung's or
// another network (the IETF's DULT format), a Tile, travelling with you
// while away from its owner. The scan (scanner.js) hears them
// (continuity.js classify); each sighting is kept with where the device
// was (com.webos.service.location getLocationUpdates, one fix at a time,
// at most every two minutes); trackerdetect.js decides when one has
// followed you; a notification then opens Settings > Bluetooth > Tracker
// Alerts on it. From there it can play its sound (lib/dult.js: the
// non-owner GATT service, through bluetooth2's gatt/*) and says how to
// disable it. Nothing leaves the device: no lookup of the tracker's owner
// or maker's servers (the DULT drafts' AccessoryInfo service is not used).
//
//   getStatus {subscribe} -> {enabled, bluetooth, location, scanning,
//       sensitivity ("low", "medium", "high"), thresholds: {minDuration,
//       minSightings, minDistance, realertAfter} (ms, m), scanMode
//       ("saver", "balanced", "performance"), scanWindows: {screenOn,
//       screenOff} (each null: the scan runs, or {window, every} in ms),
//       trackers: [{id, type, network, name, firstSeen, lastSeen,
//       sightings, duration, distance, alertedAt, ignored, points: [{t,
//       lat?, lon?}], canPlaySound}], sound: {id, state ("connecting",
//       "playing", "done", "failed"), error} | null}
//   setEnabled {enabled}, setSensitivity {sensitivity}, setScanMode
//       {mode}, playSound {id}, stopSound {id}, ignore {id, ignored?},
//       clear {}
//
// The sensitivity (trackerdetect.js SENSITIVITY) and the scan's mode
// (scanner.js MODES: the AirPods' card's scan too, which this service
// keeps because the scan with the screen off is the tracker alerts') are
// the user's choice (the owner, 15 October 2026), kept in the store.
//
// createTrackers({call, subscribe, scanner, store, notify(n), now?, timers?})
// STATUS: written against bluetooth2's and the location service's
// interfaces and trackers.test.ts; not yet run on a device or near a tracker.

"use strict";

var continuity = require("./lib/continuity");
var detect = require("./lib/trackerdetect");
var dult = require("./lib/dult");
var scanner = require("./scanner");

var BT = "luna://com.webos.service.bluetooth2";
var LOCATION = "luna://com.webos.service.location";
var SETTINGS = "org.webosphoenix.settings";
var FIX_EVERY = 2 * 60 * 1000;
// The alert's own sound (tools/make-feedback-sounds.py "tracker-alert":
// chirps and a ping, unlike every other alert), in the Settings app whose
// notification it is (SoundPolicy.js resolve: a path in the app).
var ALERT_SOUND = "sounds/tracker-alert.mp3";

function ok(extra) { return Object.assign({ returnValue: true }, extra || {}); }
function fail(text) { return { returnValue: false, errorCode: -1, errorText: text }; }

// The alert's words (Apple's: "AirTag Found Moving With You"; Google's:
// "Unknown tracker traveling with you").
function alertText(t) {
    var what = t.type === "airtag" ? "AirTag" : t.type === "airpods" ? "AirPods" : t.type === "tile" ? "Tile"
        : t.type === "smarttag" ? "SmartTag" : "tracker";
    return { title: "Unknown " + what + " found moving with you",
             body: "Its owner may be able to see where you are. Tap to find it or learn how to disable it." };
}

function createTrackers(opts) {
    var now = opts.now || function () { return Date.now(); };
    var timers = opts.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    var kept = ((opts.store && opts.store.load()) || {}).trackers || {};
    var detector = detect.createDetector({ now: now, sensitivity: kept.sensitivity });
    var watchers = [];
    var cancels = [];
    var bluetooth = false;
    var lastFix = null, fixAt = 0, fixing = false, locationOff = false;
    var sound = null;
    var gatt = null;   // {id, clientId, cancel: [...]}

    function store() { return (opts.store && opts.store.load()) || {}; }
    function saved() { return store().trackers || {}; }
    function save(changes) {
        if (!opts.store) return;
        var s = store();
        s.trackers = Object.assign({}, s.trackers || {}, changes || {}, { state: detector.state() });
        opts.store.save(s);
    }
    function enabled() { return saved().enabled !== false; }
    function scanMode() { return opts.scanner ? opts.scanner.mode() : saved().scanMode || "balanced"; }
    detector.load(saved().state);
    if (opts.scanner) {
        if (saved().scanMode) opts.scanner.setMode(saved().scanMode);
        opts.scanner.setBackground(enabled());
    }

    function status() {
        var list = detector.list().map(function (t) {
            // Only a separated tracker answers a non-owner (DULT §3.13.4);
            // Tile's and Samsung's own formats do not take DULT's commands.
            t.canPlaySound = t.type !== "tile" && t.type !== "smarttag";
            return t;
        });
        var T = detector.thresholds;
        return ok({ enabled: enabled(), bluetooth: bluetooth, location: !locationOff && !!lastFix,
                    scanning: !!(opts.scanner && opts.scanner.running()),
                    sensitivity: detector.sensitivity(),
                    thresholds: { minDuration: T.minDuration, minSightings: T.minSightings, minDistance: T.minDistance,
                                  realertAfter: T.realertAfter },
                    scanMode: scanMode(), scanWindows: opts.scanner ? opts.scanner.windows() : null,
                    trackers: list, sound: sound });
    }
    var firing = false;
    function fire() {
        if (firing) return;
        firing = true;
        Promise.resolve().then(function () {
            firing = false;
            var st = status();
            watchers.slice().forEach(function (w) { w(Object.assign({ subscribed: true }, st)); });
        });
    }

    cancels.push(opts.subscribe(BT + "/adapter/getStatus", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false || !Array.isArray(r.adapters)) return;
        var on = !!(r.adapters[0] && r.adapters[0].powered);
        if (on !== bluetooth) { bluetooth = on; fire(); }
    }));

    // One fix, kept two minutes: a tracker is seen many times a scan.
    function locate(then) {
        if (lastFix && now() - fixAt < FIX_EVERY) return then(lastFix);
        if (fixing) return then(lastFix && now() - fixAt < 10 * FIX_EVERY ? lastFix : null);
        fixing = true;
        var cancel = null, done = false;
        var finish = function (fix) {
            if (done) return;
            done = true;
            fixing = false;
            if (typeof cancel === "function") cancel();
            if (fix) { lastFix = fix; fixAt = now(); }
            then(fix);
        };
        cancel = opts.subscribe(LOCATION + "/getLocationUpdates", { subscribe: true, minimumInterval: 1000 }, function (r) {
            if (!r) return;
            if (r.returnValue === false || (r.errorCode && r.errorCode !== 0)) {
                locationOff = r.errorCode === 5 || /off|disabled/i.test(String(r.errorText || ""));
                return finish(null);
            }
            if (typeof r.latitude === "number" && typeof r.longitude === "number") {
                locationOff = false;
                finish({ lat: r.latitude, lon: r.longitude });
            }
        });
        timers.setTimeout(function () { finish(null); }, 30 * 1000);
    }

    function advert(dev) {
        if (!enabled()) return;
        var c = continuity.classify(dev);
        if (!c || c.kind !== "tracker" || c.separated === false) return;
        // AirPods advertise Find My when lost; separated they are a tracker like any.
        var id = String(dev.address || c.ident || "");
        if (!id) return;
        locate(function (fix) {
            var alerts = detector.sighting({ id: id, type: c.type, network: c.network, separated: c.separated, at: now(),
                                             location: fix, rssi: dev.rssi });
            alerts.forEach(function (t) {
                var text = alertText(t);
                if (opts.notify)
                    opts.notify({ appId: SETTINGS, title: text.title, body: text.body, soundClass: "alerts", soundFile: ALERT_SOUND,
                                  params: { page: "bluetooth", view: "tracker", id: t.id }, tag: "tracker-" + t.id });
            });
            save();
            fire();
        });
    }
    if (opts.scanner) opts.scanner.onAdvert(advert);

    // ---- Play sound: DULT's non-owner service over GATT --------------------------------
    function endGatt() {
        if (!gatt) return;
        (gatt.cancel || []).forEach(function (c) { if (typeof c === "function") c(); });
        if (gatt.clientId) opts.call(BT + "/gatt/disconnect", { clientId: gatt.clientId });
        gatt = null;
    }
    function setSound(s) { sound = s; fire(); }
    function playSound(id, respond) {
        endGatt();
        setSound({ id: id, state: "connecting", error: "" });
        var g = gatt = { id: id, clientId: "", cancel: [] };
        var failSound = function (text) {
            if (gatt !== g) return;
            endGatt();
            setSound({ id: id, state: "failed", error: text });
        };
        var timer = timers.setTimeout(function () { failSound("The tracker did not answer. Move closer and try again."); }, 20000);
        g.cancel.push(function () { timers.clearTimeout(timer); });
        g.cancel.push(opts.subscribe(BT + "/gatt/connect", { address: id, subscribe: true }, function (r) {
            if (gatt !== g) return;
            if (!r || r.returnValue === false) return failSound((r && r.errorText) || "The tracker could not be reached");
            if (!r.clientId || g.clientId) return;
            g.clientId = r.clientId;
            opts.call(BT + "/gatt/discoverServices", { address: id }).then(function () {
                if (gatt !== g) return;
                g.cancel.push(opts.subscribe(BT + "/gatt/monitorCharacteristic",
                    { clientId: g.clientId, service: dult.SERVICE, characteristic: dult.CHARACTERISTIC, subscribe: true }, function (m) {
                        if (gatt !== g || !m || !m.changed || !m.changed.value) return;
                        var ind = dult.parse(m.changed.value.bytes || []);
                        if (!ind) return;
                        if (ind.op === "commandResponse" && ind.command === dult.OP.soundStart) {
                            if (ind.status === "success") setSound({ id: id, state: "playing", error: "" });
                            else failSound(ind.status === "invalidState" ? "The tracker is with its owner or already ringing"
                                                                        : "The tracker cannot play a sound");
                        } else if (ind.op === "soundCompleted") {
                            endGatt();
                            setSound({ id: id, state: "done", error: "" });
                        }
                    }));
                return opts.call(BT + "/gatt/writeCharacteristicValue",
                    { clientId: g.clientId, service: dult.SERVICE, characteristic: dult.CHARACTERISTIC,
                      value: { bytes: dult.command(dult.OP.soundStart) } });
            }).then(function (w) {
                if (w && w.returnValue === false) failSound(w.errorText || "The tracker cannot play a sound");
            });
        }));
        respond(ok());
    }

    var service = {
        getStatus: function (p, caller, respond) {
            respond(Object.assign(p.subscribe ? { subscribed: true } : {}, status()));
            if (!p.subscribe) return undefined;
            watchers.push(respond);
            return function () { watchers = watchers.filter(function (w) { return w !== respond; }); };
        },
        setEnabled: function (p, caller, respond) {
            save({ enabled: p.enabled !== false });
            if (opts.scanner) opts.scanner.setBackground(p.enabled !== false);
            fire();
            respond(ok());
        },
        setSensitivity: function (p, caller, respond) {
            if (!detector.setSensitivity(String(p.sensitivity || ""))) return respond(fail("The sensitivity is low, medium or high"));
            save({ sensitivity: detector.sensitivity() });
            fire();
            respond(ok());
        },
        setScanMode: function (p, caller, respond) {
            var m = String(p.mode || "");
            if (!scanner.MODES[m]) return respond(fail("The scan's mode is saver, balanced or performance"));
            if (opts.scanner) opts.scanner.setMode(m);
            save({ scanMode: m });
            fire();
            respond(ok());
        },
        playSound: function (p, caller, respond) {
            var t = detector.get(String(p.id || ""));
            if (!t) return respond(fail("No such tracker"));
            if (t.type === "tile" || t.type === "smarttag") return respond(fail("This tracker cannot be rung from here"));
            if (!bluetooth) return respond(fail("Bluetooth is off"));
            playSound(t.id, respond);
        },
        stopSound: function (p, caller, respond) {
            if (!gatt || gatt.id !== String(p.id || "")) return respond(ok());
            opts.call(BT + "/gatt/writeCharacteristicValue",
                { clientId: gatt.clientId, service: dult.SERVICE, characteristic: dult.CHARACTERISTIC,
                  value: { bytes: dult.command(dult.OP.soundStop) } });
            respond(ok());
        },
        ignore: function (p, caller, respond) {
            if (!detector.get(String(p.id || ""))) return respond(fail("No such tracker"));
            detector.ignore(String(p.id), p.ignored !== false);
            save();
            fire();
            respond(ok());
        },
        clear: function (p, caller, respond) {
            detector.forget();
            save();
            fire();
            respond(ok());
        }
    };

    return {
        service: service, advert: advert, status: status, detector: detector,
        close: function () { endGatt(); cancels.forEach(function (c) { if (typeof c === "function") c(); }); }
    };
}

var METHODS = ["getStatus", "setEnabled", "setSensitivity", "setScanMode", "playSound", "stopSound", "ignore", "clear"];

module.exports = { createTrackers: createTrackers, METHODS: METHODS, alertText: alertText, ALERT_SOUND: ALERT_SOUND };
