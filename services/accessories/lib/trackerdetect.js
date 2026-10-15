// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Is a tracker travelling with you? Each sighting of a tracker that is away
// from its owner (continuity.js classify: an AirTag or Find My accessory in
// its separated state, a DULT tracker with its near-owner bit clear, a Find
// Hub tracker in unwanted tracking protection mode; Tile and Samsung tags,
// which do not say) is kept with where the device was then, and a tracker
// is reported once it has stayed with the device long enough, often enough
// and far enough:
//
//   - seen for at least 30 minutes (first to last sighting), at least 3
//     times, over at least 400 m (the farthest two places it was seen),
//     and at most one alert per tracker in 7 hours: AirGuard's published
//     rule (Heinrich, Bittner & Hollick, WiSec 2022, §4.1.2), a simplified
//     form of iOS's (§3.4.1: 10 minutes and 840 m by default; §3.4.2, at a
//     visit: 5 minutes and 420 m). Apple and Google do not publish their
//     current values; the IETF threat model (draft-ietf-dult-threat-model
//     §4.1.2) recommends letting the user choose the sensitivity, which
//     Phoenix leaves for later (docs/ACCESSORIES.md).
//   - A tracker is known by its address: separated trackers keep one
//     address for 24 hours (draft-ietf-dult-accessory-protocol-00 §3.5.1;
//     Find My accessories change key once a day, AirGuard §4.1.2; Find Hub
//     trackers in protection mode, once in 24 hours, Google's FMDN
//     specification), so the same tracker is the same address for a day.
//   - Without a location (Location Services off) a tracker is listed but
//     never alerted: time alone cannot tell a tracker that follows you from
//     one lying where you are (a neighbour's, a colleague's).
//
// Everything stays on the device: nothing is looked up or sent anywhere.

"use strict";

var MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
var DEFAULTS = { minDuration: 30 * MIN, minSightings: 3, minDistance: 400, realertAfter: 7 * HOUR,
                 sightingGap: 2 * MIN, keepFor: 7 * DAY, maxPoints: 200 };

// Metres between two {lat, lon} (haversine, a sphere of 6371 km).
function distance(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function spread(points) {
    var best = 0;
    for (var i = 0; i < points.length; ++i)
        for (var j = i + 1; j < points.length; ++j)
            best = Math.max(best, distance(points[i], points[j]));
    return best;
}

var NAMES = { airtag: "AirTag", findmy: "Find My accessory", airpods: "AirPods", dult: "Tracker", findhub: "Find Hub tracker",
              tile: "Tile tracker", smarttag: "Samsung SmartTag" };

// createDetector({now?, thresholds?}) -> {sighting(s) -> [trackers newly
// alerted], list() -> [tracker], get(id), ignore(id), forget(), state(),
// load(state)}. A sighting: {id, type, network, separated (true, false or
// null: does not say), at (ms), location: {lat, lon} | null, rssi}.
function createDetector(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var T = Object.assign({}, DEFAULTS, opts.thresholds || {});
    var trackers = {};

    function prune() {
        var t = now();
        Object.keys(trackers).forEach(function (id) {
            if (t - trackers[id].lastSeen > T.keepFor) delete trackers[id];
        });
    }

    function summary(r) {
        var pts = r.points.filter(function (p) { return p.lat !== undefined; });
        return { id: r.id, type: r.type, network: r.network, name: NAMES[r.type] || "Tracker", firstSeen: r.firstSeen,
                 lastSeen: r.lastSeen, sightings: r.sightings, duration: r.lastSeen - r.firstSeen,
                 distance: Math.round(spread(pts)), alertedAt: r.alertedAt || 0, ignored: !!r.ignored,
                 separated: r.separated, points: r.points.slice() };
    }

    // Does it qualify now? (Not ignored, not alerted within realertAfter.)
    function qualifies(r) {
        if (r.ignored || r.separated === false) return false;
        if (r.alertedAt && now() - r.alertedAt < T.realertAfter) return false;
        var pts = r.points.filter(function (p) { return p.lat !== undefined; });
        if (pts.length < 2) return false;
        return r.lastSeen - r.firstSeen >= T.minDuration && r.sightings >= T.minSightings && spread(pts) >= T.minDistance;
    }

    return {
        thresholds: T,
        sighting: function (s) {
            if (!s || !s.id) return [];
            // Near its owner it is not following anyone (and it changes
            // address every 15 minutes there: DULT §3.5.1).
            if (s.separated === false) return [];
            var at = s.at || now();
            var r = trackers[s.id];
            if (!r) r = trackers[s.id] = { id: s.id, type: s.type || "dult", network: s.network || "", separated: s.separated,
                                           firstSeen: at, lastSeen: at, sightings: 0, points: [], alertedAt: 0, ignored: false };
            // One sighting per scan: adverts closer together than
            // sightingGap count once (a scan hears a tracker many times).
            var last = r.points[r.points.length - 1];
            if (!last || at - last.t >= T.sightingGap) {
                r.sightings++;
                var p = { t: at };
                if (s.location && isFinite(s.location.lat) && isFinite(s.location.lon)) { p.lat = s.location.lat; p.lon = s.location.lon; }
                r.points.push(p);
                if (r.points.length > T.maxPoints) r.points.splice(1, 1);
            }
            r.lastSeen = Math.max(r.lastSeen, at);
            r.separated = s.separated;
            prune();
            if (!qualifies(r)) return [];
            r.alertedAt = now();
            return [summary(r)];
        },
        list: function () {
            prune();
            return Object.keys(trackers).map(function (id) { return summary(trackers[id]); })
                .sort(function (a, b) { return b.lastSeen - a.lastSeen; });
        },
        get: function (id) { return trackers[id] ? summary(trackers[id]) : null; },
        ignore: function (id, on) { if (trackers[id]) trackers[id].ignored = on !== false; },
        forget: function () { trackers = {}; },
        state: function () { return JSON.parse(JSON.stringify(trackers)); },
        load: function (s) { trackers = s && typeof s === "object" ? JSON.parse(JSON.stringify(s)) : {}; prune(); }
    };
}

module.exports = { createDetector: createDetector, distance: distance, NAMES: NAMES, DEFAULTS: DEFAULTS };
