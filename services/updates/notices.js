// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System notices (docs/NOTICES.md, section 4): com.palm.update reads the
// platform's signed notices feed (servers.json "notices": its address and
// the pinned notices keys; @phoenix/platform notices.js checks it) and shows
// each notice once, at its severity, as the other services tell the user:
// com.webos.notification's createToast (the shell's banner, then a row in
// the notification area that a tap opens the notice's app from) and, for a
// critical notice, createAlert first (a popup alert, the luna-systemui alert
// style: on a device the stock NotificationView shows it, in the simulator
// the shell's ServiceAlert.qml).
//
//   info       a banner, then a dashboard row the user can swipe away
//   important  the same, kept (persistent) until it is dismissed
//   critical   a one-time popup alert, then the dashboard row
//
// When: the daily activity org.webosphoenix.notices.check, once after the
// service starts at boot (an activity that waits for the network), and
// whenever Settings > Updates checks for updates.
//
// What is kept, in the service's state ("notices"): the last sequence taken
// (a feed older than it is refused: ROLLBACK), the notices of the last feed,
// the ids already shown ("seen", never shown again) and the ids the user
// dismissed ("dismissed"; dismissNotice). Both survive a restart, so a
// notice shows once per device, not once per boot. A notice the user turned
// off with Settings > Screen & Lock > Phoenix announcements (the system
// preference phoenixAnnouncements, on by default) counts as seen and is not
// shown later.
//
// Methods (updatesservice.js registers them on com.palm.update):
//   checkNotices {$activity?}   reads the feed, shows what is new -> getNotices
//   getNotices {}               -> {configured, enabled, lastChecked, sequence,
//                                   error: {errorCode, errorText} | null,
//                                   notices: [notice + {seen, dismissed}]}: the
//                                   ones for this device now
//   dismissNotice {id}          the user is done with it: its row goes
//
// Errors: NOT_SET_UP (no notices feed in servers.json), UNTRUSTED (no notices
// key pinned: the feed is never read unsigned), CONNECTION_FAILED,
// BAD_SIGNATURE, BAD_FEED, EXPIRED, ROLLBACK, BAD_PARAMS.

"use strict";

var platform = require("@phoenix/platform");

var CHECK_ACTIVITY = "org.webosphoenix.notices.check";
var BOOT_ACTIVITY = "org.webosphoenix.notices.boot";
var SETTINGS = "org.webosphoenix.settings";
var PREF = "phoenixAnnouncements";
var KEEP_IDS = 200;   // seen and dismissed ids kept, newest first

function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

// deps:
//   service: the Luna service's name (the activities' callbacks)
//   servers() -> Promise<resolved servers.json> ("notices": {url, keys, site})
//   getBytes(url) -> Promise<{status, bytes}>
//   luna.call(uri, params) -> Promise<reply>
//   crypto.sha512(bytes) -> Promise<Uint8Array>
//   state.load() / state.save(obj): the service's whole state; this keeps
//       its own part, "notices", and leaves the rest as it is
//   device() -> Promise<{channel, compatible, build}> (the audience; the
//       locale comes from the system preferences)
//   now(), log(msg)
function createNotices(deps) {
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var running = null;     // the check under way: one at a time
    var toasts = {};        // id -> toastId of the row shown since the service started

    function load() {
        var all = deps.state.load() || {};
        var n = all.notices && typeof all.notices === "object" ? all.notices : {};
        return {
            sequence: typeof n.sequence === "number" ? n.sequence : null,
            items: Array.isArray(n.items) ? n.items : [],
            seen: n.seen && typeof n.seen === "object" ? n.seen : {},
            dismissed: n.dismissed && typeof n.dismissed === "object" ? n.dismissed : {},
            lastChecked: n.lastChecked || null,
            error: n.error || null
        };
    }
    // Written into the state as it is now (the update checks write theirs
    // in between), the oldest ids dropped past KEEP_IDS.
    function save(n) {
        n.seen = newest(n.seen);
        n.dismissed = newest(n.dismissed);
        var all = deps.state.load() || {};
        all.notices = n;
        deps.state.save(all);
    }
    function newest(map) {
        var ids = Object.keys(map);
        if (ids.length <= KEEP_IDS) return map;
        var out = {};
        ids.sort(function (a, b) { return String(map[b]).localeCompare(String(map[a])); }).slice(0, KEEP_IDS)
           .forEach(function (id) { out[id] = map[id]; });
        return out;
    }
    function errorOf(e) {
        return { errorCode: e && typeof e.code === "string" && /^[A-Z_]+$/.test(e.code) ? e.code : "UNKNOWN_ERROR",
                 errorText: (e && e.message) || String(e) };
    }

    function config() {
        return Promise.resolve(deps.servers()).then(function (sv) { return sv || {}; }, function (e) {
            log("notices: servers: " + e.message);
            return {};
        });
    }

    // The system preferences this needs: whether announcements are on (on
    // unless set false) and the locale ("en-US"), for the audience.
    function prefs() {
        return deps.luna.call("luna://com.webos.service.systemservice/getPreferences", { keys: [PREF, "locale"] }).then(function (r) {
            var l = r && r.locale;
            var locale = l && typeof l === "object" && typeof l.languageCode === "string" && l.languageCode
                ? l.languageCode + (typeof l.countryCode === "string" && l.countryCode ? "-" + l.countryCode : "")
                : typeof l === "string" ? l : null;
            return { enabled: !(r && r[PREF] === false), locale: locale };
        }, function () { return { enabled: true, locale: null }; });
    }
    function audience() {
        return Promise.all([Promise.resolve(deps.device()).then(null, function () { return {}; }), prefs()]).then(function (r) {
            var d = r[0] || {};
            return { device: { channel: d.channel, compatible: d.compatible, build: d.build, locale: r[1].locale }, enabled: r[1].enabled };
        });
    }

    // ---- Reading the feed ---------------------------------------------------------

    function fetchFeed(sv) {
        var c = sv.notices;
        if (!c || !c.url) return Promise.reject(err("NOT_SET_UP", "No notices feed is set up on this device (/etc/palm/phoenix/servers.json)"));
        if (!c.keys || !c.keys.length) return Promise.reject(err("UNTRUSTED", "No notices key is pinned on this device"));
        var unreachable = function (e) {
            throw e && e.code && e.code !== "CONNECTION_FAILED" ? e : err("CONNECTION_FAILED", "Cannot reach the notices feed (" + (e && e.message) + ")");
        };
        return Promise.resolve(deps.getBytes(c.url)).then(null, unreachable).then(function (res) {
            if (res.status === 404) return null;   // none published yet
            if (res.status !== 200) throw err("CONNECTION_FAILED", "The notices feed answered " + res.status);
            return Promise.resolve(deps.getBytes(c.url + ".sig")).then(null, unreachable).then(function (sr) {
                if (sr.status !== 200) throw err("BAD_SIGNATURE", "The notices feed is not signed");
                var st = load();
                return platform.notices.verify(res.bytes, platform.b64.fromUtf8(sr.bytes), c.keys, {
                    sha512: deps.crypto.sha512, now: now(), lastSequence: st.sequence === null ? undefined : st.sequence,
                    origins: platform.notices.originsOf(sv)
                });
            });
        });
    }

    function check() {
        if (running) return running;
        running = config().then(function (sv) {
            return fetchFeed(sv);
        }).then(function (doc) {
            var st = load();
            if (doc) {
                st.sequence = doc.sequence;
                st.items = doc.notices;
            } else {
                st.items = [];
            }
            st.lastChecked = now().toISOString();
            st.error = null;
            save(st);
            return show();
        }, function (e) {
            var st = load();
            st.lastChecked = now().toISOString();
            st.error = errorOf(e);
            save(st);
            log("notices: " + e.message);
            throw e;
        });
        var done = function () { running = null; };
        running.then(done, done);
        return running;
    }

    // ---- Showing --------------------------------------------------------------------

    // Each notice for this device that has not been shown: shown once. With
    // announcements off, only critical ones (docs/NOTICES.md section 6,
    // question 1, is the owner's to answer: whether critical notices can be
    // turned off too; until then they cannot, and each still shows once).
    function show() {
        return audience().then(function (a) {
            var st = load();
            var fresh = platform.notices.active(st.items, a.device, now()).filter(function (n) {
                return !st.seen[n.id] && !st.dismissed[n.id];
            });
            var at = now().toISOString();
            fresh.forEach(function (n) { st.seen[n.id] = at; });
            if (fresh.length) save(st);
            return fresh.filter(function (n) { return a.enabled || n.severity === "critical"; }).reduce(function (chain, n) {
                return chain.then(function () { return post(n); });
            }, Promise.resolve());
        });
    }

    // What a tap does: the notice's action (checked by notices.js: Settings >
    // Updates, an allowlisted app, a link on the platform's own origin in
    // the browser), or Settings for a notice without one.
    function launchOf(n) {
        return n.action ? { appId: n.action.appId, params: n.action.params } : { appId: SETTINGS, params: {} };
    }

    function post(n) {
        var go = launchOf(n);
        var alert = n.severity !== "critical" ? Promise.resolve() : deps.luna.call("luna://com.webos.notification/createAlert", {
            sourceId: deps.service, title: n.title, message: n.body || n.title,
            buttons: n.action
                ? [{ label: "Open", onclick: "luna://com.webos.applicationManager/launch", params: { id: go.appId, params: go.params } },
                   { label: "Close" }]
                : [{ label: "OK" }]
        }).then(null, function (e) { log("notices: alert: " + (e && e.message)); });
        return alert.then(function () {
            // OSE's createToast: the banner, and with onlyToast false the
            // row stays in the notification area (LsmWindowSource toast();
            // the runtime's createToast for another app); persistent keeps
            // an important or critical one until it is dismissed.
            return deps.luna.call("luna://com.webos.notification/createToast", {
                sourceId: deps.service,
                title: n.body ? n.title : "",
                message: n.body || n.title,
                onclick: { appId: go.appId, params: go.params },
                onlyToast: false,
                persistent: n.severity !== "info"
            });
        }).then(function (r) {
            if (r && r.toastId) toasts[n.id] = r.toastId;
        }, function (e) { log("notices: toast: " + (e && e.message)); });
    }

    function dismiss(id) {
        if (typeof id !== "string" || !id) return Promise.reject(err("BAD_PARAMS", "id: the notice's id"));
        var st = load();
        st.dismissed[id] = now().toISOString();
        if (!st.seen[id]) st.seen[id] = st.dismissed[id];
        save(st);
        var toastId = toasts[id];
        delete toasts[id];
        return (toastId ? deps.luna.call("luna://com.webos.notification/closeToast", { toastId: toastId }).then(null, function () {})
                        : Promise.resolve()).then(list);
    }

    function list() {
        return Promise.all([config(), audience()]).then(function (r) {
            var sv = r[0], a = r[1], st = load();
            return {
                returnValue: true,
                configured: !!(sv.notices && sv.notices.url && sv.notices.keys && sv.notices.keys.length),
                enabled: a.enabled, lastChecked: st.lastChecked, sequence: st.sequence, error: st.error,
                notices: platform.notices.active(st.items, a.device, now()).map(function (n) {
                    return Object.assign({}, n, { seen: !!st.seen[n.id], dismissed: !!st.dismissed[n.id] });
                })
            };
        });
    }

    // ---- When ----------------------------------------------------------------------

    function ensureSchedule() {
        return deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: CHECK_ACTIVITY, description: "Phoenix announcements check", type: { background: true, persist: true },
                        schedule: { interval: "24h" }, requirements: { internet: true },
                        callback: { method: "luna://" + deps.service + "/checkNotices", params: { daily: true } } }
        }).then(null, function () {});
    }
    // Once after boot, as soon as the network is up: an activity with no
    // schedule that waits for the internet (now, when it is already there).
    function atBoot() {
        return deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: BOOT_ACTIVITY, description: "Phoenix announcements check after boot", type: { background: true },
                        requirements: { internet: true },
                        callback: { method: "luna://" + deps.service + "/checkNotices", params: {} } }
        }).then(null, function () {});
    }

    // The activity's callback, or a call: check, say how it went. The
    // daily activity ({daily: true}) goes on; the one after boot ends.
    function checkNotices(p) {
        var activityId = p && p.$activity && p.$activity.activityId;
        var restart = !!(p && p.daily);
        var failed = null;
        return check().then(null, function (e) { failed = e; }).then(function () {
            return activityId ? deps.luna.call("luna://com.palm.activitymanager/complete", { activityId: activityId, restart: restart })
                .then(null, function () {}) : null;
        }).then(function () {
            if (failed) throw failed;
            return list();
        });
    }

    return { check: check, checkNotices: checkNotices, list: list, dismiss: dismiss, ensureSchedule: ensureSchedule, atBoot: atBoot,
             CHECK_ACTIVITY: CHECK_ACTIVITY, BOOT_ACTIVITY: BOOT_ACTIVITY };
}

module.exports = { createNotices: createNotices, CHECK_ACTIVITY: CHECK_ACTIVITY, BOOT_ACTIVITY: BOOT_ACTIVITY, PREF: PREF };
