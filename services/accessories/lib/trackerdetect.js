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
//   - seen for long enough (first to last sighting), often enough and
//     over a long enough way (the farthest two places it was seen), with
//     at most one alert per tracker in a while, by the sensitivity the
//     user chose (Settings > Bluetooth > Tracker Alerts; the owner, 15
//     October 2026; the IETF threat model, draft-ietf-dult-threat-model-05
//     §4.1.2, recommends letting the user set how often alerts come and the
//     detection radius, and §4.2.1.2 points to AirGuard's three levels).
//     Apple and Google do not publish their current values. SENSITIVITY
//     below; where each value comes from:
//       medium (the default): 30 minutes, 3 sightings, 400 m, one alert in
//         7 hours: AirGuard's published rule (Heinrich, Bittner & Hollick,
//         WiSec 2022, §4.1.2), a simplified form of iOS's (§3.4.1: 10
//         minutes and 840 m by default; §3.4.2, at a visit: 5 minutes and
//         420 m);
//       low (fewer alerts): 120 minutes, 4 sightings and one alert in 8
//         hours, AirGuard's own "low" level today (seemoo-lab/AirGuard,
//         Apache-2.0, RiskLevelEvaluator.kt: MINUTES_AT_LEAST_TRACKED_
//         BEFORE_ALARM_LOW, NUMBER_OF_LOCATIONS_BEFORE_ALARM_LOW,
//         HOURS_BETWEEN_NOTIFICATIONS_LOW; its locations taken as
//         sightings), and 840 m, iOS's default distance (AirGuard §3.4.1);
//       high (sooner): 10 minutes, iOS's default time (AirGuard §3.4.1); 2
//         sightings and one alert in 2 hours, AirGuard's "high" level
//         (the same file); 200 m is Phoenix's own choice, half of medium's.
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
var SENSITIVITY = {
    low: { minDuration: 120 * MIN, minSightings: 4, minDistance: 840, realertAfter: 8 * HOUR },
    medium: { minDuration: 30 * MIN, minSightings: 3, minDistance: 400, realertAfter: 7 * HOUR },
    high: { minDuration: 10 * MIN, minSightings: 2, minDistance: 200, realertAfter: 2 * HOUR }
};
var DEFAULTS = Object.assign({ sightingGap: 2 * MIN, keepFor: 7 * DAY, maxPoints: 200 }, SENSITIVITY.medium);

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

// createDetector({now?, thresholds?, sensitivity?}) -> {sighting(s) ->
// [trackers newly alerted], list() -> [tracker], get(id), ignore(id),
// forget(), state(), load(state), setSensitivity(level), sensitivity()}. A sighting: {id, type, network, separated (true, false or
// null: does not say), at (ms), location: {lat, lon} | null, rssi}.
function createDetector(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var level = SENSITIVITY[opts.sensitivity] ? opts.sensitivity : "medium";
    var T = Object.assign({}, DEFAULTS, SENSITIVITY[level], opts.thresholds || {});
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
        sensitivity: function () { return level; },
        // A new level applies to the next sighting (a tracker already
        // alerted keeps its alert time).
        setSensitivity: function (l) {
            if (!SENSITIVITY[l]) return false;
            level = l;
            Object.assign(T, SENSITIVITY[l]);
            return true;
        },
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

module.exports = { createDetector: createDetector, distance: distance, NAMES: NAMES, DEFAULTS: DEFAULTS, SENSITIVITY: SENSITIVITY };
