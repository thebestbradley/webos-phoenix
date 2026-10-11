// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A small stand-in for the device the Assistant's service runs on, for
// tests and the evaluation (tools/eval-assistant.cjs) that go through the
// service (assistant.js -> lib/commands.js): a db8 that keeps what is put,
// the activity manager, audio, display, power, location, and the web
// services' answers. seed() adds records. NOW is Wednesday 7 October 2026,
// 10:00. test/device.ts wraps it for vitest (checking each reply).

"use strict";

var path = require("path");
var createAssistantService = require(path.join(__dirname, "..", "assistant.js")).createAssistantService;

var fs = require("fs");

var NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
function at(d, h, m) { return new Date(2026, 9, d, h, m || 0, 0).getTime(); }

// ---- Synergy, as the device has it ----------------------------------------------------------------
// The kinds that extend others, as db8 answers a query "from" a parent
// kind with its sub-kinds' objects too: the system's (runtime/phoenix-runtime.js
// installSystemKinds, the messaging service's) and every connector's in
// this tree (configuration/db/kinds), read as they are.
var APPS_DIR = path.join(__dirname, "..", "..", "..");
var EXTENDS = { "com.palm.smsmessage:1": "com.palm.message:1", "com.palm.mmsmessage:1": "com.palm.message:1", "com.palm.immessage:1": "com.palm.message:1",
                "com.palm.contact.palmprofile:1": "com.palm.contact:1", "com.palm.imap.account:1": "com.palm.mail.account:1",
                "com.palm.pop.account:1": "com.palm.mail.account:1", "com.palm.imap.folder:1": "com.palm.folder:1", "com.palm.pop.folder:1": "com.palm.folder:1",
                "com.palm.imap.email:1": "com.palm.email:1", "com.palm.pop.email:1": "com.palm.email:1" };
// The account templates (the connectors' public/accounts, the Phoenix
// Account's compat overlay, and mojomail's IMAP one), and the apps' share
// targets (appinfo.json "phoenix".shareTargets).
var TEMPLATES = {}, SHARE_APPS = [];
(function readTree() {
    function each(dir, depth, fn) {
        var names;
        try { names = fs.readdirSync(dir); } catch (e) { return; }
        names.forEach(function (n) {
            if (n === "node_modules" || n.charAt(0) === ".") return;
            var p = path.join(dir, n), st;
            try { st = fs.statSync(p); } catch (e) { return; }
            if (st.isDirectory() && depth > 0) each(p, depth - 1, fn);
            else if (st.isFile()) fn(p);
        });
    }
    function json(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }
    each(APPS_DIR, 6, function (p) {
        if (/[\/\\]configuration[\/\\]db[\/\\]kinds[\/\\][^\/\\]+$/.test(p)) {
            var k = json(p);
            if (k && k.id && k.extends && k.extends[0]) EXTENDS[k.id] = k.extends[0];
        } else if (/[\/\\]public[\/\\]accounts[\/\\][^\/\\]+[\/\\][^\/\\]+\.json$/.test(p)) {
            [].concat(json(p) || []).forEach(function (t) { if (t && t.templateId) TEMPLATES[t.templateId] = t; });
        } else if (/[\/\\]appinfo\.json$/.test(p)) {
            var a = json(p);
            if (a && a.id && a.phoenix && Array.isArray(a.phoenix.shareTargets)) SHARE_APPS.push({ id: a.id, title: a.title, shareTargets: a.phoenix.shareTargets });
        }
    });
    var profile = json(path.join(APPS_DIR, "..", "compat", "rootfs", "usr", "palm", "public", "accounts", "com.palm.palmprofile", "com.palm.palmprofile.json"));
    if (profile) TEMPLATES[profile.templateId] = profile;
    // app-services mojomail imap/files/usr/palm/public/accounts/com.palm.imap/com.palm.imap.json (the parts read here).
    TEMPLATES["com.palm.imap"] = { templateId: "com.palm.imap", loc_name: "IMAP", capabilityProviders: [{ capability: "MAIL", id: "com.palm.imap.mail",
        implementation: "palm://com.palm.imap/", subKind: "com.palm.imap.email:1" }] };
})();
function isa(kind, want, more) {
    for (var k = kind, i = 0; k && i < 8; k = (more && more[k]) || EXTENDS[k], ++i) if (k === want) return true;
    return false;
}
// listAccounts: the accounts annotated with their templates (Account.annotate).
function annotate(a, more) {
    var t = (more && more[a.templateId]) || TEMPLATES[a.templateId];
    if (!t) return null;
    var out = JSON.parse(JSON.stringify(t));
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    out.capabilityProviders = (a.capabilityProviders || (t.capabilityProviders || []).map(function (c) { return { id: c.id, capability: c.capability }; })).map(function (c) {
        var full = (t.capabilityProviders || []).filter(function (x) { return x.id === c.id; })[0] || {};
        return Object.assign({}, c, full);
    });
    return out;
}

// opts: {offline, locationAllowed (true | false | null: not asked yet),
//   seed(put), llm (the on-device model runner), llmRequest (its HTTP:
//   a real llama-server), apps: more launch points, settings: the
//   assistant's settings (followUps off unless given), deps: more deps}
function device(opts) {
    opts = opts || {};
    var n = 0;
    var db = new Map();
    function put(o) { var id = o._id || "db" + ++n; db.set(id, Object.assign({}, o, { _id: id })); return id; }
    // What the device starts with.
    put({ _id: "acct-profile", _kind: "com.palm.account:1", templateId: "com.palm.palmprofile" });
    put({ _id: "cal-local", _kind: "com.palm.calendar:1", accountId: "acct-profile", name: "Phoenix Account", isReadOnly: false, syncSource: "Local" });
    put({ _id: "cal-ro", _kind: "com.palm.calendar:1", accountId: "x", name: "Holidays", isReadOnly: true });
    put({ _id: "ev-standup", _kind: "com.palm.calendarevent:1", calendarId: "cal-local", subject: "Team stand-up", dtstart: at(5, 9, 30), dtend: at(5, 10), allDay: false,
          rrule: { freq: "WEEKLY", interval: 1, rules: [{ ruleType: "BYDAY", ruleValue: [1, 2, 3, 4, 5].map(function (day) { return { day: day }; }) }] } });
    put({ _id: "ev-dentist", _kind: "com.palm.calendarevent:1", calendarId: "cal-local", subject: "Dentist", location: "Downtown Dental", dtstart: at(9, 14), dtend: at(9, 15), allDay: false });
    put({ _id: "p-sam", _kind: "com.palm.person:1", name: { givenName: "Sam", familyName: "Delgado" }, phoneNumbers: [{ value: "(303) 555-0135", type: "type_mobile" }],
          emails: [{ value: "sam@example.com", type: "type_home" }] });
    put({ _id: "p-priya", _kind: "com.palm.person:1", name: { givenName: "Priya", familyName: "Nair" }, phoneNumbers: [{ value: "(415) 555-0123", type: "type_mobile" }], emails: [] });
    put({ _id: "list-inbox", _kind: "com.palm.tasklist:1", name: "Inbox", isDefault: true });
    put({ _id: "memo-1", _kind: "com.palm.note:1", text: "Wi-Fi at the cabin: network Lakeview", color: "yellow", position: "m" });
    put({ _id: "memo-2", _kind: "com.palm.note:1", text: "Books to read", color: "pink", position: "n" });
    put({ _id: "alarm-7", _kind: "com.palm.clock.alarm:1", key: "clockAlarm1", hour: 7, minute: 0, occurs: "weekdays", enabled: true, niceTime: "7:00 AM" });
    put({ _id: "alarm-630", _kind: "com.palm.clock.alarm:1", key: "clockAlarm2", hour: 18, minute: 30, occurs: "once", enabled: true, niceTime: "6:30 PM" });
    put({ _id: "mail-acct", _kind: "com.palm.mail.account:1", accountId: "acct-mail", email: "jordan@example.com", realName: "Jordan Avery" });
    put({ _id: "mail-1", _kind: "com.palm.email:1", subject: "Invoice 2231", from: { name: "Alex Rivera", addr: "alex@example.com" }, summary: "Your invoice", timestamp: NOW - 3600e3, flags: { read: false, visible: true },
          parts: [{ type: "body", mimeType: "text/html", content: "Hi,<br>Your invoice 2231 is attached.<br>Alex" }] });
    put({ _id: "mail-2", _kind: "com.palm.email:1", subject: "Lunch today?", from: { name: "Priya Nair", addr: "priya@example.net" }, summary: "Noon?", timestamp: NOW - 7200e3, flags: { read: true, visible: true } });
    put({ _id: "sms-1", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Running 5 min late", from: { addr: "3035550135" }, localTimestamp: NOW - 600e3, threadId: "t-sam",
          flags: { read: false, visible: true } });
    put({ _id: "sms-2", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Lunch at noon?", from: { addr: "4155550123" }, localTimestamp: NOW - 3600e3, threadId: "t-priya" });
    put({ _id: "call-1", _kind: "com.palm.phonecall:1", type: "missed", timestamp: NOW - 1800e3, duration: 0, from: { addr: "(303) 555-0135" }, to: [] });
    put({ _id: "call-2", _kind: "com.palm.phonecall:1", type: "outgoing", timestamp: NOW - 7200e3, duration: 60000, from: { addr: "" }, to: [{ addr: "(415) 555-0123", name: "Priya Nair" }] });
    put({ _id: "list-shop", _kind: "com.palm.tasklist:1", name: "Groceries" });
    put({ _id: "task-milk", _kind: "com.palm.task:1", summary: "Milk", listId: "list-shop", completed: false, createdTime: 1 });
    put({ _id: "task-eggs", _kind: "com.palm.task:1", summary: "Eggs", listId: "list-shop", completed: false, createdTime: 2 });
    put({ _id: "task-done", _kind: "com.palm.task:1", summary: "Bread", listId: "list-shop", completed: true, createdTime: 3 });
    put({ _id: "img-1", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/a.jpg", createdTime: at(6, 15) });
    put({ _id: "img-2", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/b.jpg", createdTime: at(6, 16) });
    put({ _id: "img-3", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/c.jpg", createdTime: at(1, 9) });

    if (opts.seed) opts.seed(put);
    var calls = [];
    var state = { volume: 50, muted: false, ringtones: 60, brightness: 70, activities: new Map(),
                  gps: true, network: true, locationAllowed: opts.locationAllowed === undefined ? true : opts.locationAllowed,
                  prefs: { rotationLock: false }, nowPlaying: null,
                  hotspot: false, hotspotPass: false, vpn: "", vpnProfiles: [],
                  wifi: true, bluetooth: false, airplane: false, flashlight: false, launched: [],
                  shared: [], copied: [], driveFiles: opts.driveFiles || {},
                  // The shell's notifications ({id, appId, app, title, body, time, ongoing}), the lock screen, its previews.
                  notifications: [], deviceLocked: false, previews: true,
                  // Where the device is (getLocationUpdates; tests move it).
                  position: { latitude: 37.37, longitude: -122.04 } };
    function okr(o) { return Promise.resolve(Object.assign({ returnValue: true }, o || {})); }
    var luna = {
        call: function (uri, p) {
            calls.push({ uri: uri, params: p });
            var m = uri.replace(/^luna:\/\//, "");
            if (m === "com.palm.applicationManager/listLaunchPoints")
                return okr({ launchPoints: [{ id: "com.palm.app.calendar", title: "Calendar" },
                                            { id: "org.webosphoenix.settings", title: "Sounds & Ringtones", params: { page: "sounds" } }].concat(opts.apps || []) });
            if (m === "com.palm.applicationManager/launch" || m === "com.palm.applicationManager/open") { state.launched.push(p); return okr(); }
            if (m === "com.palm.db/find") {
                var kind = p.query.from, where = p.query.where || [];
                return okr({ results: Array.from(db.values()).filter(function (o) {
                    if (!(isa(o._kind, kind, opts.kinds) || (kind === "com.palm.email:1" && /email:1$/.test(o._kind)))) return false;
                    return where.every(function (w) { return w.op !== "=" || o[w.prop] === w.val; });
                }) });
            }
            // Synergy: the accounts, the apps that take a post, a connector's share, the drives.
            if (m === "com.palm.service.accounts/listAccounts") {
                return okr({ results: Array.from(db.values()).filter(function (o) {
                    return o._kind === "com.palm.account:1" && !o.beingDeleted && (!p.templateId || o.templateId === p.templateId);
                }).map(function (a) { return annotate(a, opts.templates); }).filter(Boolean) });
            }
            if (m === "com.palm.applicationManager/listApps") return okr({ apps: (opts.apps || []).concat(opts.shareApps === false ? [] : SHARE_APPS) });
            if (/^[\w.]+\/share$/.test(m)) {
                state.shared.push({ service: m.replace(/\/share$/, ""), params: p });
                return okr({ posted: { url: "https://posts.example/" + state.shared.length } });
            }
            if (m === "org.webosphoenix.filemanager/copy") { state.copied.push(p); return okr({ path: p.to }); }
            if (m === "com.palm.db/put") return okr({ results: p.objects.map(function (o) { return { id: put(o), rev: 1 }; }) });
            if (m === "com.palm.db/merge") { p.objects.forEach(function (o) { db.set(o._id, Object.assign({}, db.get(o._id), o)); }); return okr(); }
            if (m === "com.palm.db/del") { p.ids.forEach(function (id) { db.delete(id); }); return okr(); }
            if (m === "com.palm.db/get") return okr({ results: p.ids.map(function (id) { return db.get(id); }).filter(Boolean) });
            if (m === "com.palm.db/reserveIds") return okr({ ids: Array.from({ length: p.count }, function () { return "res" + ++n; }) });
            if (m === "com.palm.activitymanager/create") { state.activities.set(p.activity.name, p.activity); return okr({ activityId: 1 }); }
            if (m === "com.palm.activitymanager/cancel") { state.activities.delete(p.activityName); return okr(); }
            // complete: done (gone), or {restart: true} with its new trigger, callback or schedule.
            if (m === "com.palm.activitymanager/complete") {
                var act = state.activities.get(p.activityName);
                if (act && p.restart) state.activities.set(p.activityName, Object.assign({}, act, p.trigger ? { trigger: p.trigger } : {}, p.callback ? { callback: p.callback } : {}, p.schedule ? { schedule: p.schedule } : {}));
                else state.activities.delete(p.activityName);
                return okr();
            }
            if (m === "com.webos.service.audio/master/getVolume") return okr({ volumeStatus: { volume: state.volume, muted: state.muted } });
            if (m === "com.webos.service.audio/master/setVolume") { state.volume = p.volume; return okr(); }
            if (m === "com.webos.service.audio/master/muteVolume") { state.muted = p.mute; return okr(); }
            if (m === "com.webos.service.audio/getInputVolume") return okr({ volume: state.ringtones });
            if (m === "com.webos.service.audio/setInputVolume") { state.ringtones = p.volume; return okr(); }
            if (m === "com.palm.display/control/getProperty") return okr({ maximumBrightness: state.brightness });
            if (m === "com.palm.display/control/setProperty") { state.brightness = p.maximumBrightness; return okr(); }
            if (m === "com.palm.power/com/palm/power/batteryStatusQuery") return okr({ percent: 76, percent_ui: 76 });
            if (m === "com.palm.power/com/palm/power/chargerStatusQuery") return okr({ Charging: true, Connected: true });
            // Location (OSE's methods, and Phoenix's per-app permissions in
            // front of them, as runtime/phoenix-runtime.js answers them).
            if (m === "org.webosphoenix.service.location/getPermissions")
                return okr({ permissions: state.locationAllowed === null ? [] : [{ appId: "org.webosphoenix.assistant", title: "Assistant", allowed: state.locationAllowed }] });
            if (m === "org.webosphoenix.service.location/setPermission") { state.locationAllowed = p.allowed; return okr(); }
            if (m === "com.webos.service.location/getAllLocationHandlers") return okr({ handlers: [{ name: "gps", state: state.gps }, { name: "network", state: state.network }] });
            if (m === "com.webos.service.location/setState") { state[p.Handler] = p.state; return okr(); }
            if (m === "com.webos.service.location/getLocationUpdates") {
                if (!state.gps && !state.network) return Promise.resolve({ returnValue: false, errorCode: 5, errorText: "Location services are off" });
                return okr({ errorCode: 0, latitude: state.position.latitude, longitude: state.position.longitude, horizAccuracy: 8 });
            }
            // What OSE's service does not have (getCurrentPosition was the legacy com.palm.location's).
            if (m.indexOf("com.webos.service.location/") === 0) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "Unknown method" });
            if (m === "org.webosphoenix.filemanager/search") {
                // A drive's files (/media/drives/<accountId>): state.driveFiles[accountId].
                var drive = /^\/media\/drives\/([^\/]+)/.exec(p.path || "");
                if (drive) return okr({ entries: (state.driveFiles[drive[1]] || []).filter(function (e) {
                    return String(p.query).toLowerCase().split(/\s+/).every(function (w) { return e.name.toLowerCase().indexOf(w) >= 0; });
                }) });
                return okr({ entries: p.query === "budget" ? [{ name: "Budget 2026.pdf", path: "/media/internal/Documents/Budget 2026.pdf", type: "file", size: 52000, mtime: at(6, 12) }] : [] });
            }
            if (m === "org.webosphoenix.tethering/setWifi") {
                if (p.enabled && !state.hotspotPass) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "The password has 8 to 63 characters" });
                state.hotspot = p.enabled; return okr();
            }
            if (m === "com.webos.service.vpn/getProfileList") return okr({ vpnProfiles: state.vpnProfiles.map(function (x) { return { vpnProfileName: x }; }) });
            if (m === "com.webos.service.vpn/connect") { state.vpn = p.vpnProfileName; return okr(); }
            if (m === "com.webos.service.vpn/disconnect") { state.vpn = ""; return okr(); }
            if (m === "org.webosphoenix.system/getNowPlaying") return okr({ nowPlaying: state.nowPlaying });
            // The shell's notification list (services/shellhost notificationsAnswer, as the runtime answers it).
            if (m === "org.webosphoenix.system/getNotifications") {
                var hidden = state.deviceLocked && !state.previews;
                var nl = state.notifications.slice().sort(function (a, b) { return b.time - a.time; }).map(function (x) {
                    return hidden ? { id: x.id, appId: x.appId, app: x.app, title: "", body: "", time: x.time, ongoing: !!x.ongoing } : x;
                });
                return okr({ notifications: nl, locked: state.deviceLocked, previews: state.previews, private: hidden });
            }
            if (m === "com.palm.telephony/voicemailQuery") return okr({ number: "(408) 555-0100", waiting: true, count: 2 });
            if (m === "com.webos.service.systemservice/deviceInfo/query") return okr({ storage_free: "5.8 GB", storage_size: "8 GB" });
            if (m === "org.webosphoenix.service.packages/search")
                return okr({ apps: p.query === "doom" ? [{ id: "com.example.doom", sourceId: "museum", title: "Doom", summary: "The classic", developer: { name: "id" }, installed: null }] : [] });
            if (m === "com.webos.service.systemservice/setPreferences") { Object.assign(state.prefs, p); return okr(); }
            if (m === "com.webos.service.systemservice/getPreferences") return okr(Object.assign({}, state.prefs));
            return okr();
        }
    };
    var data = new Map();
    var storage = {
        get: function (k) { return data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null; },
        set: function (k, v) { data.set(k, JSON.parse(JSON.stringify(v))); },
        remove: function (k) { data.delete(k); },
        keys: function (prefix) { return Array.from(data.keys()).filter(function (k) { return k.indexOf(prefix) === 0; }); }
    };
    var requests = [];
    var homeAssistant = require("./home-assistant.cjs").create();
    function request(r) {
        if (opts.llmRequest && /^http:\/\/127\.0\.0\.1[:/]/.test(r.url)) return opts.llmRequest(r);
        requests.push(r.url);
        if (opts.offline) return Promise.reject(new Error("offline"));
        // A test's own web: opts.http(url) -> {status, body} | null.
        var own = opts.http ? opts.http(r.url) : null;
        if (own) return Promise.resolve(own);
        // The user's Home Assistant (test/home-assistant.cjs).
        if (r.url.indexOf(homeAssistant.URL) === 0) return homeAssistant.request(r);
        if (r.url.indexOf("frankfurter") >= 0) return Promise.resolve({ status: 200, body: JSON.stringify({ amount: 20, base: "USD", date: "2026-10-07", rates: { EUR: 17.3 } }) });
        if (r.url.indexOf("api.open-meteo.com/v1/forecast") >= 0 && r.url.indexOf("hourly=") < 0)
            return Promise.resolve({ status: 200, body: JSON.stringify({ current: { temperature_2m: 64.4, weather_code: 2 },
                daily: { weather_code: [2, 61], temperature_2m_max: [70.2, 61.1], temperature_2m_min: [52.3, 50], precipitation_probability_max: [10, 80] } }) });
        if (r.url.indexOf("photon.komoot.io") >= 0) return Promise.resolve({ status: 200, body: JSON.stringify({ features: [{ geometry: { coordinates: [-121.93, 37.36] }, properties: { name: "San Jose Airport" } }] }) });
        if (r.url.indexOf("valhalla1.openstreetmap.de/route") >= 0) {
            var q = JSON.parse(decodeURIComponent(r.url.split("json=")[1]));
            return Promise.resolve({ status: 200, body: JSON.stringify({ trip: { summary: { time: q.costing === "auto" ? 1080 : 5400, length: 12.4 } } }) });
        }
        if (r.url.indexOf("hourly=") >= 0) {
            var times = Array.from({ length: 48 }, function (_, h) {
                var d = new Date(2026, 9, 7, h);
                function p2(x) { return String(x).padStart(2, "0"); }
                return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":00";
            });
            return Promise.resolve({ status: 200, body: JSON.stringify({ current: { temperature_2m: 64, weather_code: 2 }, daily: { temperature_2m_max: [70, 61], temperature_2m_min: [52, 50], weather_code: [2, 61] },
                hourly: { time: times, temperature_2m: times.map(function (_, h) { return 50 + (h % 24); }), weather_code: times.map(function (_, h) { return h % 24 >= 15 ? 61 : 2; }),
                          precipitation_probability: times.map(function (_, h) { return h % 24 >= 15 ? 70 : 5; }) } }) });
        }
        if (r.url.indexOf("geocoding") >= 0) return Promise.resolve({ status: 200, body: JSON.stringify({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris" }] }) });
        return Promise.resolve({ status: 404, body: "" });
    }
    var clock = NOW;
    // The commands alone: the questions after them have their own tests (followups.test.ts).
    data.set("assistant:settings", opts.settings || { followUps: false });
    var svc = createAssistantService(Object.assign({ luna: luna, storage: storage, request: request, now: function () { return clock; }, caller: function () { return "com.palm.systemui"; },
                                                     llm: opts.llm, localDeadlineMs: opts.llm ? 600000 : undefined,
                                                     // Sealed as {sealed}: what a test keeps sealed comes back (the Home Assistant token).
                                                     secrets: { seal: function (v) { return Promise.resolve({ sealed: v }); }, unseal: function (e) { return Promise.resolve(e && e.sealed || ""); } },
                                                     locale: function () { return "en-US"; } }, opts.deps || {}));
    var thread = "";
    // The last message of each answer (all of them: askAll).
    function check(r) {
        if (r.returnValue === false) throw new Error(r.errorText || "failed");
        return r;
    }
    function askAll(text, extra) {
        return svc.ask(Object.assign({ text: text }, thread ? { threadId: thread } : { newThread: true }, extra || {})).then(function (r) {
            check(r);
            thread = r.thread.id;
            return r.messages;
        });
    }
    function ask(text, extra) { return askAll(text, extra).then(function (list) { return list[list.length - 1]; }); }
    function confirm(m, accept) {
        return svc.confirm({ threadId: thread, messageId: m.id, accept: accept !== false }).then(function (r) { check(r); return r.messages[r.messages.length - 1]; });
    }
    function choose(m, choice) { return svc.choose({ threadId: thread, messageId: m.id, choice: choice }).then(check); }
    function of(kind) { return Array.from(db.values()).filter(function (o) { return o._kind === kind; }); }
    function called(part) { return calls.filter(function (c) { return c.uri.indexOf(part) >= 0; }); }
    return { svc: svc, db: db, put: put, luna: luna, of: of, calls: calls, called: called, state: state, ask: ask, askAll: askAll, confirm: confirm, choose: choose,
             requests: requests, storage: storage,
             // The stand-in Home Assistant, and connecting the Assistant to it.
             homeAssistant: homeAssistant, connectHome: function () { homeAssistant.connect(storage); }, thread: function () { return thread; }, newThread: function () { thread = ""; },
             setNow: function (t) { clock = t; } };
}

// For the tests with stand-ins of their own (permissions.test.ts): what Synergy is here.
module.exports = { device: device, NOW: NOW, at: at, isa: isa, annotate: annotate, SHARE_APPS: SHARE_APPS };
