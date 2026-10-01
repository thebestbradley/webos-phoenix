// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.update: system updates (docs/APP-RUNTIME.md, System updates;
// docs/HARDWARE.md, OTA with A/B updates).
//
// Palm's update daemon had this name, and the System UI Phoenix runs
// (luna-systemui, app/SysUpdateService.js and app/SysUpdateAlerts) still
// listens to it: GetStatus {subscribe} tells it when to show the "Update
// Available" alert, the "Download in progress" dashboard and the countdown
// alert, and the alerts answer with InstallLater, InstallNow and
// AlertDisplayed. This service keeps that API and adds Phoenix's own for
// Settings > Updates (the System Updates app, com.palm.app.updates).
//
// The system is installed with RAUC: two root slots, the update written to
// the one not running, then a restart into it (the bootloader goes back to
// the old slot if the new one does not start). So the long part, writing
// the slot, happens in the background while the device is in use, as the
// download does; the slot it writes stays inactive until the user says
// "Install now", which switches slots and restarts (about a minute: what
// the original alert's "will take about #{installTime} minutes. You cannot
// use your device during this time" now means).
//
// Where updates come from: a feed, one JSON file per device type and
// channel, <feed>/<compatible>/<channel>.json (server/updates writes them):
//
//   {"format": 1, "compatible": "...", "channel": "stable",
//    "release": {"name", "version", "build", "date", "notes": [...],
//                "url" (relative to the feed file), "size", "sha256"}}
//
// The feed only says what there is. What gets installed is decided by the
// bundle: RAUC checks its signature against the keyring in the running
// system, then this service reads the bundle's manifest (rauc info, after
// that check) and uses it only when it is for this device ("compatible")
// and newer than the running system (its build number), so a feed cannot
// put an older system back.
//
// Palm's methods (luna-systemui):
//   GetStatus {subscribe}    replies {status, ...} as things happen:
//       "Downloading" {version, percent, networkAvailable, lowSpeed}
//       "Available"   {version, installTime, minBattery}: ready to install
//       "Countdown"   {version, installTime, countdownTime, showLaterButton,
//                      minBattery}: installing at the next charge
//       "InsufficientCharge" {minBattery}; "CancelAlert" (no longer offered)
//   InstallLater {}          ask again at the next charge
//   InstallNow {}            switch slots and restart
//   AlertDisplayed {open}
//
// Phoenix's methods (Settings > Updates):
//   getStatus {subscribe?}   -> status, again after every change:
//       {state: "idle" | "checking" | "downloading" | "preparing" | "ready" |
//        "restarting", current: {name, version, build}, available: release
//        | null, progress (0-100, downloading and preparing), lastChecked,
//        error: {errorCode, errorText} | null, autoDownload, channel,
//        battery: {percent, charging} | null, minBattery, deferred}
//   check {}                 reads the feed -> status
//   download {}              downloads and prepares the update (any network)
//   cancel {}                stops a download
//   installNow {}            = InstallNow
//   setPreferences {autoDownload?, channel?}
//   scheduled {$activity}    the daily check (an activity): reads the feed,
//                            downloads over Wi-Fi when autoDownload is on
//   charging {$activity}     the charger is connected (an activity with
//                            requirements {charging: true}, after InstallLater)
//
// Errors (status.error.errorCode, or a failed reply): CONNECTION_FAILED,
// BAD_FEED, NO_UPDATE, DOWNLOAD_FAILED, BAD_DOWNLOAD (size or SHA-256 not
// the feed's), BAD_BUNDLE (RAUC refused it), WRONG_DEVICE, NOT_NEWER,
// INSTALL_FAILED, LOW_BATTERY, BUSY, BAD_PARAMS.
//
// Written against injected dependencies (createUpdatesService), so it runs
// unchanged on a device (service.js), in the simulator and in tests.

"use strict";

var SERVICE = "com.palm.update";
var METHODS = ["GetStatus", "InstallLater", "InstallNow", "AlertDisplayed",
               "getStatus", "check", "download", "cancel", "installNow", "setPreferences", "scheduled", "charging"];
var CHECK_ACTIVITY = "com.palm.update.check";
var CHARGE_ACTIVITY = "com.palm.update.install";
var CHANNELS = ["stable", "beta"];
var MIN_BATTERY = 20;      // the restart; the slot is already written
var INSTALL_MINUTES = 1;
var COUNTDOWN_MINUTES = 5;

function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}
function fail(code, text) {
    return { returnValue: false, errorCode: code, errorText: text };
}

// The feed's release, checked field by field.
function parseFeed(text, compatible) {
    var f;
    try { f = JSON.parse(text); } catch (e) { throw err("BAD_FEED", "The update feed is not JSON"); }
    if (!f || f.format !== 1) throw err("BAD_FEED", "The update feed's format is not 1");
    if (f.compatible !== compatible) throw err("BAD_FEED", "The update feed is for " + f.compatible + ", not " + compatible);
    var r = f.release;
    if (r === null || r === undefined) return null;
    if (typeof r !== "object" || typeof r.version !== "string" || !r.version ||
        typeof r.build !== "number" || r.build !== Math.floor(r.build) || r.build < 1 ||
        typeof r.url !== "string" || !r.url || typeof r.size !== "number" || r.size < 1 ||
        !/^[0-9a-f]{64}$/.test(String(r.sha256)))
        throw err("BAD_FEED", "The update feed's release is incomplete");
    return {
        name: typeof r.name === "string" && r.name ? r.name : "webOS Phoenix",
        version: r.version, build: r.build,
        date: typeof r.date === "string" ? r.date : "",
        notes: Array.isArray(r.notes) ? r.notes.filter(function (n) { return typeof n === "string"; }) : [],
        url: r.url, size: r.size, sha256: r.sha256
    };
}

// deps:
//   rauc.status() -> Promise<{compatible, name?, booted: {slot, version,
//       build}, primary (the slot the next start uses), other (the slot not
//       running)}>
//   rauc.info(file) -> Promise<{compatible, version, build}> (signature
//       checked; rejects with the reason when RAUC refuses the bundle)
//   rauc.install(file, onProgress(percent, message)) -> Promise (writes the
//       other slot, which RAUC then makes primary)
//   rauc.markActive(slot) -> Promise (the slot the next start uses)
//   request({method, url}) -> Promise<{status, body}> (text)
//   download(url, file, onProgress(bytes)) -> {promise: Promise<{size, sha256}>, cancel()}
//   files.path(name) -> path; files.exists(path); files.remove(path)
//   power() -> Promise<{percent, charging} | null> (null: no battery)
//   luna.call(uri, params) -> Promise<reply> (also the ongoing activity
//       the download and the preparing are: org.webosphoenix.ongoing)
//   config() -> {feed, channel?}            (/etc/palm/updates.json)
//   state.load() / state.save(obj)
//   now(), log(msg) (optional)
function createUpdatesService(deps) {
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var watchers = [];       // Phoenix's getStatus subscribers: fn(status)
    var palmWatchers = [];   // GetStatus subscribers: fn(reply)
    var live = { state: null, progress: null, error: null };
    var job = null;          // the download being made: {cancel}
    var started = null;

    function load() {
        var s = deps.state.load() || {};
        if (typeof s.autoDownload !== "boolean") s.autoDownload = true;
        if (CHANNELS.indexOf(s.channel) < 0) {
            var c = (deps.config() || {}).channel;
            s.channel = CHANNELS.indexOf(c) >= 0 ? c : "stable";
        }
        return s;
    }
    function save(s) { deps.state.save(s); }

    function feedUrl(compatible, channel) {
        var base = String((deps.config() || {}).feed || "");
        if (!/^https?:\/\//.test(base)) throw err("BAD_FEED", "No update feed is set (/etc/palm/updates.json)");
        if (base.charAt(base.length - 1) !== "/") base += "/";
        return base + encodeURIComponent(compatible) + "/" + channel + ".json";
    }
    function fullName(rel) { return rel.name + " " + rel.version; }

    // ---- Status ---------------------------------------------------------------------

    function status() {
        var s = load();
        return Promise.all([deps.rauc.status(), deps.power().then(null, function () { return null; })]).then(function (r) {
            var rs = r[0];
            var current = { name: rs.name || "webOS Phoenix", version: rs.booted.version, build: rs.booted.build };
            var available = s.available && s.available.build > current.build ? s.available : null;
            var ready = !!(available && s.prepared && s.prepared.build === available.build && s.prepared.slot === rs.other);
            return {
                returnValue: true, state: live.state || (ready ? "ready" : "idle"), current: current, available: available,
                progress: live.progress, lastChecked: s.lastChecked || null, error: live.error,
                autoDownload: s.autoDownload, channel: s.channel, battery: r[1], minBattery: MIN_BATTERY,
                deferred: !!s.deferred
            };
        });
    }
    function changed() {
        return status().then(function (st) {
            watchers.forEach(function (w) { w(st); });
            return st;
        });
    }
    // From a progress callback: nobody waits on it.
    function notify() {
        changed().then(null, function (e) { log("status: " + e.message); });
    }
    function setLive(state, progress, error) {
        live = { state: state, progress: progress === undefined ? null : progress, error: error || null };
        return changed();
    }
    function errorOf(e) {
        return { errorCode: e && typeof e.code === "string" && /^[A-Z_]+$/.test(e.code) ? e.code : "UNKNOWN_ERROR",
                 errorText: (e && e.message) || String(e) };
    }
    function palm(reply) {
        palmWatchers.forEach(function (w) { w(Object.assign({ returnValue: true }, reply)); });
    }
    function available(rel) {
        palm({ status: "Available", version: fullName(rel), installTime: INSTALL_MINUTES, minBattery: MIN_BATTERY });
    }
    // The download and the preparing are an ongoing activity in the
    // notification area (org.webosphoenix.ongoing; the shell's), with
    // their progress; tapping it opens Settings > Updates.
    var lastOngoing = "";
    function ongoing(title, pct) {
        var key = title === null ? "" : title + "|" + pct;
        if (key === lastOngoing) return;
        lastOngoing = key;
        var call = title === null
            ? deps.luna.call("luna://org.webosphoenix.ongoing/clear", { id: SERVICE })
            : deps.luna.call("luna://org.webosphoenix.ongoing/set", {
                id: SERVICE, appId: "org.webosphoenix.settings", icon: "icons/updates.png",
                title: title, body: pct + "%", progress: pct, params: { page: "updates" } });
        call.then(null, function () {});
    }

    function busy() {
        return live.state ? Promise.reject(err("BUSY", "Updates are busy (" + live.state + ")")) : null;
    }

    // After a restart: say once that the system was updated, or that the
    // new system did not start and the device went back.
    function startup() {
        if (started) return started;
        started = deps.rauc.status().then(function (rs) {
            var s = load();
            var note = null;
            if (s.restarting) {
                if (rs.booted.build >= s.restarting.build) {
                    note = "Updated to " + (rs.name || "webOS Phoenix") + " " + rs.booted.version;
                    s.available = null;
                } else {
                    note = "The update to " + s.restarting.version + " did not start. Your device went back to " + rs.booted.version + ".";
                }
                s.restarting = null;
                s.prepared = null;
                s.deferred = false;
                s.notified = null;
                save(s);
            }
            if (note) return deps.luna.call("luna://com.webos.notification/createToast", {
                message: note, onclick: { appId: "com.palm.app.updates", params: {} }
            }).then(null, function () {});
        }).then(null, function (e) { log("startup: " + e.message); });
        return started;
    }

    // ---- Check, download, prepare ------------------------------------------------------

    function check() {
        return busy() || setLive("checking").then(function () { return deps.rauc.status(); }).then(function (rs) {
            var s = load();
            var url = feedUrl(rs.compatible, s.channel);
            return deps.request({ method: "GET", url: url }).then(null, function (e) {
                throw err("CONNECTION_FAILED", "Cannot reach the update server (" + e.message + ")");
            }).then(function (res) {
                if (res.status === 404) return null;   // nothing for this device on this channel yet
                if (res.status !== 200) throw err("CONNECTION_FAILED", "The update server answered " + res.status);
                var rel = parseFeed(res.body, rs.compatible);
                if (rel) rel.url = new URL(rel.url, url).href;
                return rel;
            }).then(function (rel) {
                var s2 = load();
                var was = s2.available;
                s2.lastChecked = now().toISOString();
                s2.available = rel && rel.build > rs.booted.build ? rel : null;
                if (was && (!s2.available || s2.available.build !== was.build)) {
                    // What was offered is not any more: forget it, and close its alerts.
                    forget(s2);
                    palm({ status: "CancelAlert" });
                }
                save(s2);
                return setLive(null);
            });
        }).then(null, function (e) {
            return setLive(null, null, errorOf(e)).then(function () { throw e; });
        });
    }

    function forget(s) {
        if (s.downloaded) deps.files.remove(s.downloaded.path);
        s.downloaded = null;
        s.prepared = null;
        s.deferred = false;
        s.notified = null;
        deps.luna.call("luna://com.palm.activitymanager/cancel", { activityName: CHARGE_ACTIVITY }).then(null, function () {});
    }

    function download() {
        var s = load();
        var rel = s.available;
        if (!rel) return Promise.reject(err("NO_UPDATE", "There is no update to download"));
        return busy() || status().then(function (st) {
            if (st.state === "ready") return st;
            if (s.downloaded && s.downloaded.build === rel.build && deps.files.exists(s.downloaded.path)) return prepare();
            var file = deps.files.path("phoenix-" + rel.build + ".raucb");
            var last = -1;
            return setLive("downloading", 0).then(function () {
                job = deps.download(rel.url, file, function (bytes) {
                    var pct = Math.min(99, Math.floor(bytes * 100 / rel.size));
                    if (pct === last) return;
                    last = pct;
                    live.progress = pct;
                    notify();
                    ongoing("Downloading " + fullName(rel), pct);
                    if (pct % 10 === 0)
                        palm({ status: "Downloading", version: fullName(rel), percent: pct, networkAvailable: true, lowSpeed: false });
                });
                return job.promise;
            }).then(function (got) {
                job = null;
                if (got.size !== rel.size || got.sha256 !== rel.sha256) {
                    deps.files.remove(file);
                    throw err("BAD_DOWNLOAD", "The download is not the update the server described");
                }
                var s2 = load();
                s2.downloaded = { build: rel.build, path: file };
                save(s2);
                palm({ status: "Downloading", version: fullName(rel), percent: 100, networkAvailable: true, lowSpeed: false });
                live.state = null;
                return prepare();
            }, function (e) {
                job = null;
                deps.files.remove(file);
                if (e && e.code === "CANCELLED") return setLive(null);
                throw e && e.code ? e : err("DOWNLOAD_FAILED", "The download stopped (" + (e && e.message) + ")");
            });
        }).then(function (st) {
            ongoing(null);
            return st;
        }, function (e) {
            ongoing(null);
            return setLive(null, null, errorOf(e)).then(function () { throw e; });
        });
    }

    // A bundle refused for what it is will never do: it goes.
    function discard() {
        var s = load();
        if (s.downloaded) deps.files.remove(s.downloaded.path);
        s.downloaded = null;
        save(s);
    }

    // Write the downloaded bundle to the other slot, then keep the running
    // slot primary: nothing changes until the user installs.
    function prepare() {
        var s = load();
        var rel = s.available, file = s.downloaded.path;
        return Promise.all([deps.rauc.status(), deps.rauc.info(file).then(null, function (e) {
            throw err("BAD_BUNDLE", "The update was refused: " + e.message);
        })]).then(null, function (e) {
            discard(e);
            throw e;
        }).then(function (r) {
            var rs = r[0], info = r[1];
            var bad = info.compatible !== rs.compatible ? err("WRONG_DEVICE", "The update is for " + info.compatible + ", not this device")
                : !(info.build > rs.booted.build) ? err("NOT_NEWER", "The update (" + info.version + ") is not newer than this system")
                : info.build !== rel.build ? err("BAD_BUNDLE", "The update is build " + info.build + ", not " + rel.build) : null;
            if (bad) { discard(bad); throw bad; }
            ongoing("Preparing " + fullName(rel), 0);
            return setLive("preparing", 0).then(function () {
                return deps.rauc.install(file, function (pct) {
                    live.progress = Math.max(0, Math.min(100, pct | 0));
                    notify();
                    ongoing("Preparing " + fullName(rel), live.progress);
                }).then(null, function (e) { throw err("INSTALL_FAILED", "The update could not be written: " + e.message); });
            }).then(function () {
                return deps.rauc.markActive(rs.booted.slot);
            }).then(function () {
                var s2 = load();
                s2.prepared = { build: info.build, version: info.version, slot: rs.other };
                deps.files.remove(file);
                s2.downloaded = null;
                save(s2);
                return setLive(null);
            }).then(function (st) {
                if (!load().deferred) available(rel);
                return st;
            });
        });
    }

    // ---- Install -----------------------------------------------------------------------

    function installNow() {
        return status().then(function (st) {
            if (st.state !== "ready") throw err("NO_UPDATE", "There is no update ready to install");
            var b = st.battery;
            if (b && !b.charging && b.percent < MIN_BATTERY) {
                palm({ status: "InsufficientCharge", minBattery: MIN_BATTERY });
                throw err("LOW_BATTERY", "Charge the battery to " + MIN_BATTERY + "% or connect the charger to install the update");
            }
            var s = load();
            return deps.rauc.markActive(s.prepared.slot).then(function () {
                var s2 = load();
                s2.restarting = { build: s2.prepared.build, version: s2.prepared.version };
                save(s2);
                return setLive("restarting");
            }).then(function () {
                return deps.luna.call("luna://com.palm.power/shutdown/machineReboot", { reason: "System update" });
            }).then(function () { return { returnValue: true }; });
        });
    }

    // "Install later": ask again when the charger is next connected.
    function installLater() {
        var s = load();
        if (!s.available || !s.prepared) return Promise.resolve({ returnValue: true });
        s.deferred = true;
        save(s);
        return deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: CHARGE_ACTIVITY, description: "Install the system update at the next charge",
                        type: { background: true, persist: true }, requirements: { charging: true },
                        callback: { method: "luna://" + SERVICE + "/charging", params: {} } }
        }).then(null, function () {}).then(changed).then(function () { return { returnValue: true }; });
    }

    function charging(p) {
        var activityId = p && p.$activity && p.$activity.activityId;
        return status().then(function (st) {
            var s = load();
            if (st.state === "ready" && s.deferred) {
                palm({ status: "Countdown", version: fullName(st.available), installTime: INSTALL_MINUTES,
                       countdownTime: COUNTDOWN_MINUTES, showLaterButton: true, minBattery: MIN_BATTERY });
                s.deferred = false;
                save(s);
            }
            return activityId ? deps.luna.call("luna://com.palm.activitymanager/complete", { activityId: activityId })
                .then(null, function () {}) : null;
        }).then(changed);
    }

    // ---- The daily check ---------------------------------------------------------------

    function scheduled(p) {
        var activityId = p && p.$activity && p.$activity.activityId;
        return check().then(function () {
            var s = load();
            if (!s.available || !s.autoDownload) return null;
            return deps.luna.call("luna://com.palm.connectionmanager/getstatus", {}).then(function (c) {
                return !!(c && c.wifi && c.wifi.state === "connected");
            }, function () { return false; }).then(function (onWifi) {
                return onWifi ? download().then(null, function () {}) : null;
            });
        }).then(null, function (e) { log("scheduled: " + e.message); }).then(function () {
            return activityId ? deps.luna.call("luna://com.palm.activitymanager/complete", { activityId: activityId, restart: true })
                .then(null, function () {}) : null;
        }).then(status);
    }

    function ensureSchedule() {
        return deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: CHECK_ACTIVITY, description: "System update check", type: { background: true, persist: true },
                        schedule: { interval: "24h" }, requirements: { internet: true },
                        callback: { method: "luna://" + SERVICE + "/scheduled", params: {} } }
        }).then(null, function () {});
    }

    function wrap(fn) {
        return function (p) {
            return startup().then(function () { return fn(p || {}); }).then(null, function (e) {
                var o = errorOf(e);
                return fail(o.errorCode, o.errorText);
            });
        };
    }

    return {
        // Palm's GetStatus: the first reply, then onReply(reply) for what
        // happens (watchPalm). An update that is ready is said again.
        GetStatus: wrap(function () {
            ensureSchedule();
            return status().then(function (st) {
                var out = { returnValue: true };
                if (st.state === "ready" && !st.deferred) {
                    out.status = "Available";
                    out.version = fullName(st.available);
                    out.installTime = INSTALL_MINUTES;
                    out.minBattery = MIN_BATTERY;
                }
                return out;
            });
        }),
        watchPalm: function (onReply) {
            palmWatchers.push(onReply);
            return function () { palmWatchers = palmWatchers.filter(function (w) { return w !== onReply; }); };
        },
        InstallLater: wrap(installLater),
        InstallNow: wrap(installNow),
        AlertDisplayed: wrap(function () { return { returnValue: true }; }),

        getStatus: wrap(function () { ensureSchedule(); return status(); }),
        // onChange(status) after every change -> stop(). (getStatus {subscribe})
        watch: function (onChange) {
            watchers.push(onChange);
            return function () { watchers = watchers.filter(function (w) { return w !== onChange; }); };
        },
        check: wrap(check),
        download: wrap(download),
        cancel: wrap(function () {
            if (job) job.cancel();
            return status();
        }),
        installNow: wrap(installNow),
        setPreferences: wrap(function (p) {
            var s = load();
            if (p.autoDownload !== undefined) {
                if (typeof p.autoDownload !== "boolean") throw err("BAD_PARAMS", "autoDownload: true or false");
                s.autoDownload = p.autoDownload;
            }
            if (p.channel !== undefined) {
                if (CHANNELS.indexOf(p.channel) < 0) throw err("BAD_PARAMS", "channel: " + CHANNELS.join(" or "));
                if (live.state) throw err("BUSY", "Updates are busy (" + live.state + ")");
                if (p.channel !== s.channel) {
                    s.channel = p.channel;
                    if (s.available) palm({ status: "CancelAlert" });
                    s.available = null;
                    forget(s);
                }
            }
            save(s);
            return changed();
        }),
        scheduled: wrap(scheduled),
        charging: wrap(charging)
    };
}

module.exports = { SERVICE: SERVICE, METHODS: METHODS, CHANNELS: CHANNELS, MIN_BATTERY: MIN_BATTERY,
                   parseFeed: parseFeed, createUpdatesService: createUpdatesService };
