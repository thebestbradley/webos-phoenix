// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.update: system updates (docs/APP-RUNTIME.md, System updates;
// docs/HARDWARE.md, OTA with A/B updates; docs/PLATFORM-CLIENT.md, System
// updates).
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
// channel, <feed>/<compatible>/<channel>.json (server/updates writes them;
// the platform's release console in production; schema
// docs/platform-api/update-feed.schema.json). The feed's address, the
// channels offered and the keys come from /etc/palm/phoenix/servers.json
// ("updates", read through @phoenix/platform):
//
//   {"format": 1 | 2, "compatible": "...", "channel": "stable",
//    "release": {"name", "version", "build", "date", "notes": [...],
//                "url" (relative to the feed file), "size", "sha256",
//                "rollout"?: {"percent", "seed"}} | null,
//    and in format 2: "sequence" (never lower than one taken), "generated",
//    "expires", "revoked": [builds withdrawn after their release]}
//
// Format 2 is signed: <channel>.json.sig, base64 Ed25519 of the file's
// bytes, by the updates key servers.json pins ("key"), or by an online key
// the pinned offline root delegated to ("root": <feed>/key.json, scope
// "updates"; OPEN-QUESTIONS Q45). A device that pins either takes only a
// signed format 2 feed; one that pins neither (the simulator, a
// development image) takes either format unsigned and says so
// (status.verified false).
//
// The feed only says what there is. What gets installed is decided by the
// bundle: RAUC checks its signature against the keyring in the running
// system, then this service reads the bundle's manifest (rauc info, after
// that check) and uses it only when it is for this device ("compatible")
// and newer than the running system (its build number), so a feed cannot
// put an older system back. A signed feed adds what the bundle cannot say:
// that a release was withdrawn ("revoked", or release null) and that the
// feed is current ("expires", "sequence"), so a mirror cannot hold a
// device on an old offer for long.
//
// Staged rollout (Q56): a release with "rollout" is offered only to devices
// whose bucket (@phoenix/platform rollout.js: SHA-256 of the seed and this
// device's own random rollout id, which never leaves it) is below
// "percent"; the others are told they are up to date.
//
// After a restart into a new system the service marks the running slot
// good (rauc status mark-good, what meta-rauc's rauc-mark-good.service does
// at boot) when it first starts: luna-systemui subscribes to GetStatus once
// the System UI is up, so a system that does not get that far is never
// marked good and the bootloader's boot counter takes the device back.
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
//        channels (the ones servers.json offers), configured (an update
//        feed is set), verified (the last feed's signature was checked),
//        rollout: {percent, waiting} | null (a staged release this device
//        is not in yet), battery: {percent, charging} | null, minBattery,
//        deferred}
//   check {}                 reads the feed -> status
//   download {}              downloads (continuing a stopped download) and
//                            prepares the update (any network)
//   cancel {}                stops a download (what came is kept)
//   installNow {}            = InstallNow
//   setPreferences {autoDownload?, channel?}
//   scheduled {$activity}    the daily check (an activity): reads the feed,
//                            downloads over Wi-Fi when autoDownload is on
//   charging {$activity}     the charger is connected (an activity with
//                            requirements {charging: true}, after InstallLater)
//
// Errors (status.error.errorCode, or a failed reply): NOT_SET_UP (no update
// feed in servers.json), CONNECTION_FAILED, BAD_FEED, BAD_SIGNATURE,
// NO_DELEGATION, EXPIRED, ROLLBACK, NO_UPDATE, DOWNLOAD_FAILED, BAD_DOWNLOAD
// (size or SHA-256 not the feed's), BAD_BUNDLE (RAUC refused it),
// WRONG_DEVICE, NOT_NEWER, REVOKED (withdrawn after it was downloaded),
// INSTALL_FAILED, LOW_BATTERY, BUSY, BAD_PARAMS.
//
// Written against injected dependencies (createUpdatesService), so it runs
// unchanged on a device (service.js), in the simulator and in tests.

"use strict";

var platform = require("@phoenix/platform");

var SERVICE = "com.palm.update";
var METHODS = ["GetStatus", "InstallLater", "InstallNow", "AlertDisplayed",
               "getStatus", "check", "download", "cancel", "installNow", "setPreferences", "scheduled", "charging"];
var CHECK_ACTIVITY = "com.palm.update.check";
var CHARGE_ACTIVITY = "com.palm.update.install";
var CHANNELS = platform.servers.CHANNELS;   // stable, beta, dev (Q56)
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

// The feed, checked field by field -> {format, sequence, expires, revoked,
// release | null}. opts: {now: Date, lastSequence}
function parseFeedDocument(text, compatible, opts) {
    var f;
    try { f = JSON.parse(text); } catch (e) { throw err("BAD_FEED", "The update feed is not JSON"); }
    if (!f || (f.format !== 1 && f.format !== 2)) throw err("BAD_FEED", "The update feed's format is not 1 or 2");
    if (f.compatible !== compatible) throw err("BAD_FEED", "The update feed is for " + f.compatible + ", not " + compatible);
    var out = { format: f.format, sequence: null, expires: null, revoked: [], release: null };
    if (f.format === 2) {
        if (typeof f.sequence !== "number" || f.sequence !== Math.floor(f.sequence) || f.sequence < 1)
            throw err("BAD_FEED", "The update feed has no sequence");
        if (typeof f.expires !== "string" || isNaN(Date.parse(f.expires))) throw err("BAD_FEED", "The update feed has no expiry");
        var now = ((opts && opts.now) || new Date()).getTime();
        if (Date.parse(f.expires) < now) throw err("EXPIRED", "The update feed expired on " + f.expires);
        if (opts && typeof opts.lastSequence === "number" && f.sequence < opts.lastSequence)
            throw err("ROLLBACK", "The update feed is older than one already seen (" + f.sequence + " < " + opts.lastSequence + ")");
        out.sequence = f.sequence;
        out.expires = f.expires;
        out.revoked = Array.isArray(f.revoked) ? f.revoked.filter(function (b) { return typeof b === "number"; }) : [];
    }
    out.release = parseRelease(f.release);
    return out;
}

// The feed's release (format 1 or 2), checked field by field; the
// platform's CI runs it on every channel file it publishes (PLATFORM.md 11.2).
function parseFeed(text, compatible) {
    return parseFeedDocument(text, compatible, { now: new Date(0) }).release;
}

function parseRelease(r) {
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
        url: r.url, size: r.size, sha256: r.sha256,
        rollout: r.rollout && typeof r.rollout === "object" && typeof r.rollout.percent === "number"
            ? { percent: Math.max(0, Math.min(100, r.rollout.percent)), seed: typeof r.rollout.seed === "string" ? r.rollout.seed : "" }
            : null
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
//   rauc.markGood() -> Promise (the running slot started well; optional)
//   request({method, url}) -> Promise<{status, body}> (text)
//   requestBytes({method, url}) -> Promise<{status, bytes}> (a feed and its
//       signature are checked over the exact bytes; optional, without it
//       the text is encoded back to UTF-8)
//   download(url, file, onProgress(bytes), {resume: true}) -> {promise:
//       Promise<{size, sha256}>, cancel()}: with the file left from a
//       stopped download it continues with an HTTP range request
//   files.path(name) -> path; files.exists(path); files.remove(path)
//   crypto: {sha256(bytes), sha512(bytes) -> Promise<Uint8Array>,
//            randomBytes(n) -> Uint8Array}
//   power() -> Promise<{percent, charging} | null> (null: no battery)
//   luna.call(uri, params) -> Promise<reply> (also the ongoing activity
//       the download and the preparing are: org.webosphoenix.ongoing)
//   servers() -> Promise<the resolved servers.json> (@phoenix/platform
//       load(): its "updates" {url, channel, channels, key, root} or null)
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
    var cfg = null;          // servers.json's "updates", read at each check and status

    function config() {
        return Promise.resolve(deps.servers()).then(function (sv) {
            cfg = (sv && sv.updates) || null;
            return cfg;
        }, function (e) { log("servers: " + e.message); cfg = null; return null; });
    }
    function channelsOf(c) { return c && c.channels && c.channels.length ? c.channels : ["stable"]; }

    function load() {
        var s = deps.state.load() || {};
        if (typeof s.autoDownload !== "boolean") s.autoDownload = true;
        var offered = channelsOf(cfg);
        if (offered.indexOf(s.channel) < 0) s.channel = cfg && offered.indexOf(cfg.channel) >= 0 ? cfg.channel : offered[0];
        if (!s.feeds || typeof s.feeds !== "object") s.feeds = {};
        return s;
    }
    function save(s) { deps.state.save(s); }
    function rolloutId(s) {
        if (!s.rolloutId) {
            s.rolloutId = platform.rollout.newId(deps.crypto.randomBytes);
            save(s);
        }
        return s.rolloutId;
    }

    function feedUrl(c, compatible, channel) {
        if (!c || !c.url) throw err("NOT_SET_UP", "No update server is set up on this device (/etc/palm/phoenix/servers.json)");
        return c.url + encodeURIComponent(compatible) + "/" + channel + ".json";
    }
    function fullName(rel) { return rel.name + " " + rel.version; }

    // ---- Status ---------------------------------------------------------------------

    function status() {
        return config().then(function () {
            var s = load();
            return Promise.all([deps.rauc.status(), deps.power().then(null, function () { return null; })]).then(function (r) {
                var rs = r[0];
                var current = { name: rs.name || "webOS Phoenix", version: rs.booted.version, build: rs.booted.build };
                var available = s.available && s.available.build > current.build ? s.available : null;
                var ready = !!(available && s.prepared && s.prepared.build === available.build && s.prepared.slot === rs.other);
                var feed = s.feeds[rs.compatible + "/" + s.channel] || {};
                return {
                    returnValue: true, state: live.state || (ready ? "ready" : "idle"), current: current, available: available,
                    progress: live.progress, lastChecked: s.lastChecked || null, error: live.error,
                    autoDownload: s.autoDownload, channel: s.channel, channels: channelsOf(cfg), configured: !!(cfg && cfg.url),
                    verified: !!feed.verified, rollout: s.waiting || null,
                    battery: r[1], minBattery: MIN_BATTERY, deferred: !!s.deferred
                };
            });
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

    // After a restart: mark the running slot good, and say once that the
    // system was updated, or that the new system did not start and the
    // device went back.
    function startup() {
        if (started) return started;
        started = deps.rauc.status().then(function (rs) {
            var good = deps.rauc.markGood ? deps.rauc.markGood().then(null, function (e) { log("mark-good: " + e.message); }) : null;
            return Promise.resolve(good).then(function () { return rs; });
        }).then(function (rs) {
            var s = deps.state.load() || {};
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

    function getBytes(url) {
        if (deps.requestBytes) return Promise.resolve(deps.requestBytes({ method: "GET", url: url }));
        return Promise.resolve(deps.request({ method: "GET", url: url })).then(function (r) {
            return { status: r.status, bytes: platform.b64.utf8(r.body || "") };
        });
    }
    function getJson(url) {
        return getBytes(url).then(function (r) {
            if (r.status !== 200) throw err("BAD_FEED", "HTTP " + r.status + " from " + url);
            try { return JSON.parse(platform.b64.fromUtf8(r.bytes)); } catch (e) { throw err("BAD_FEED", url + " is not JSON"); }
        });
    }

    // The keys the feed must be signed with: the pinned key, or the online
    // keys the pinned root delegated to; null when nothing is pinned.
    function feedKeys(c) {
        if (!c.key && !c.root) return Promise.resolve(null);
        var keyJson = c.root ? getJson(c.url + "key.json") : Promise.resolve(null);
        return keyJson.then(function (kj) {
            return platform.signed.trustedKeys(kj, { key: c.key, root: c.root }, "updates", { sha512: deps.crypto.sha512, now: now() });
        });
    }

    function check() {
        return busy() || setLive("checking").then(function () {
            return Promise.all([deps.rauc.status(), config()]);
        }).then(function (r) {
            var rs = r[0], c = r[1];
            var s = load();
            var url = feedUrl(c, rs.compatible, s.channel);
            var feedKey = rs.compatible + "/" + s.channel;
            var last = s.feeds[feedKey] || {};
            var unreachable = function (e) {
                throw e && e.code && e.code !== "CONNECTION_FAILED" ? e : err("CONNECTION_FAILED", "Cannot reach the update server (" + (e && e.message) + ")");
            };
            return Promise.all([getBytes(url).then(null, unreachable), feedKeys(c)]).then(function (got) {
                var res = got[0], keys = got[1];
                if (res.status === 404) return { doc: null, verified: false };   // nothing for this device on this channel yet
                if (res.status !== 200) throw err("CONNECTION_FAILED", "The update server answered " + res.status);
                var verify = keys
                    ? getBytes(url + ".sig").then(function (sr) {
                        if (sr.status !== 200) throw err("BAD_SIGNATURE", "The update feed is not signed");
                        return platform.signed.verifyWithAny(res.bytes, platform.b64.fromUtf8(sr.bytes), keys, deps.crypto.sha512, "update feed");
                    }, unreachable).then(function () { return true; })
                    : Promise.resolve(false);
                return verify.then(function (verified) {
                    var doc = parseFeedDocument(platform.b64.fromUtf8(res.bytes), rs.compatible,
                                                { now: now(), lastSequence: typeof last.sequence === "number" ? last.sequence : undefined });
                    if (keys && doc.format !== 2) throw err("BAD_FEED", "This device takes only signed update feeds (format 2)");
                    return { doc: doc, verified: verified };
                });
            }).then(function (f) {
                var rel = f.doc && f.doc.release;
                if (rel) rel.url = new URL(rel.url, url).href;
                var newer = rel && rel.build > rs.booted.build ? rel : null;
                return (newer && newer.rollout && newer.rollout.percent < 100
                    ? platform.rollout.check(newer.rollout, rolloutId(load()), deps.crypto.sha256)
                    : Promise.resolve({ eligible: true })).then(function (ro) {
                    var s2 = load();
                    var was = s2.available;
                    s2.lastChecked = now().toISOString();
                    s2.feeds[feedKey] = { sequence: f.doc && f.doc.sequence !== null ? f.doc.sequence : last.sequence, verified: f.verified };
                    s2.available = newer && ro.eligible ? newer : null;
                    s2.waiting = newer && !ro.eligible ? { percent: ro.percent, waiting: true, version: newer.version } : null;
                    var revoked = f.doc ? f.doc.revoked : [];
                    if ((was && (!s2.available || s2.available.build !== was.build)) ||
                        (s2.prepared && revoked.indexOf(s2.prepared.build) >= 0)) {
                        // What was offered is not any more (withdrawn, revoked,
                        // or a newer one): forget it, and close its alerts.
                        forget(s2);
                        palm({ status: "CancelAlert" });
                    }
                    save(s2);
                    return setLive(null);
                });
            });
        }).then(null, function (e) {
            return setLive(null, null, errorOf(e)).then(function () { throw e; });
        });
    }

    function forget(s) {
        if (s.downloaded) deps.files.remove(s.downloaded.path);
        if (s.partial) deps.files.remove(s.partial.path);
        s.downloaded = null;
        s.partial = null;
        s.prepared = null;
        s.deferred = false;
        s.notified = null;
        deps.luna.call("luna://com.palm.activitymanager/cancel", { activityName: CHARGE_ACTIVITY }).then(null, function () {});
    }

    function download() {
        return config().then(function () {
            var s = load();
            var rel = s.available;
            if (!rel) throw err("NO_UPDATE", "There is no update to download");
            return busy() || status().then(function (st) {
                if (st.state === "ready") return st;
                if (s.downloaded && s.downloaded.build === rel.build && deps.files.exists(s.downloaded.path)) return prepare();
                var file = deps.files.path("phoenix-" + rel.build + ".raucb");
                // A download of this build that stopped: kept for the rest.
                if (s.partial && s.partial.build !== rel.build) { deps.files.remove(s.partial.path); s.partial = null; }
                s.partial = { build: rel.build, path: file };
                save(s);
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
                    }, { resume: true });
                    return job.promise;
                }).then(function (got) {
                    job = null;
                    var s2 = load();
                    s2.partial = null;
                    if (got.size !== rel.size || got.sha256 !== rel.sha256) {
                        deps.files.remove(file);
                        save(s2);
                        throw err("BAD_DOWNLOAD", "The download is not the update the server described");
                    }
                    s2.downloaded = { build: rel.build, path: file };
                    save(s2);
                    palm({ status: "Downloading", version: fullName(rel), percent: 100, networkAvailable: true, lowSpeed: false });
                    live.state = null;
                    return prepare();
                }, function (e) {
                    job = null;
                    // What came is kept (the next download continues it), unless
                    // the server sent something that was not the update.
                    if (e && e.code === "CANCELLED") return setLive(null);
                    if (e && e.code === "BAD_DOWNLOAD") {
                        deps.files.remove(file);
                        var s3 = load();
                        s3.partial = null;
                        save(s3);
                    }
                    throw e && e.code ? e : err("DOWNLOAD_FAILED", "The download stopped (" + (e && e.message) + ")");
                });
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
            return config().then(function (c) {
                var s = load();
                if (p.autoDownload !== undefined) {
                    if (typeof p.autoDownload !== "boolean") throw err("BAD_PARAMS", "autoDownload: true or false");
                    s.autoDownload = p.autoDownload;
                }
                if (p.channel !== undefined) {
                    var offered = channelsOf(c);
                    if (offered.indexOf(p.channel) < 0) throw err("BAD_PARAMS", "channel: " + offered.join(" or "));
                    if (live.state) throw err("BUSY", "Updates are busy (" + live.state + ")");
                    if (p.channel !== s.channel) {
                        s.channel = p.channel;
                        if (s.available) palm({ status: "CancelAlert" });
                        s.available = null;
                        s.waiting = null;
                        forget(s);
                    }
                }
                save(s);
                return changed();
            });
        }),
        scheduled: wrap(scheduled),
        charging: wrap(charging)
    };
}

module.exports = { SERVICE: SERVICE, METHODS: METHODS, CHANNELS: CHANNELS, MIN_BATTERY: MIN_BATTERY,
                   parseFeed: parseFeed, parseFeedDocument: parseFeedDocument, createUpdatesService: createUpdatesService };
