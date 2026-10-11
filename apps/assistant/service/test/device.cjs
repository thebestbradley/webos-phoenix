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

var NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
function at(d, h, m) { return new Date(2026, 9, d, h, m || 0, 0).getTime(); }

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
                  wifi: true, bluetooth: false, airplane: false, flashlight: false, launched: [] };
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
                var kind = p.query.from;
                return okr({ results: Array.from(db.values()).filter(function (o) { return o._kind === kind || (kind === "com.palm.email:1" && /email:1$/.test(o._kind)); }) });
            }
            if (m === "com.palm.db/put") return okr({ results: p.objects.map(function (o) { return { id: put(o), rev: 1 }; }) });
            if (m === "com.palm.db/merge") { p.objects.forEach(function (o) { db.set(o._id, Object.assign({}, db.get(o._id), o)); }); return okr(); }
            if (m === "com.palm.db/del") { p.ids.forEach(function (id) { db.delete(id); }); return okr(); }
            if (m === "com.palm.db/get") return okr({ results: p.ids.map(function (id) { return db.get(id); }).filter(Boolean) });
            if (m === "com.palm.db/reserveIds") return okr({ ids: Array.from({ length: p.count }, function () { return "res" + ++n; }) });
            if (m === "com.palm.activitymanager/create") { state.activities.set(p.activity.name, p.activity); return okr({ activityId: 1 }); }
            if (m === "com.palm.activitymanager/cancel") { state.activities.delete(p.activityName); return okr(); }
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
                return okr({ errorCode: 0, latitude: 37.37, longitude: -122.04, horizAccuracy: 8 });
            }
            // What OSE's service does not have (getCurrentPosition was the legacy com.palm.location's).
            if (m.indexOf("com.webos.service.location/") === 0) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "Unknown method" });
            if (m === "org.webosphoenix.filemanager/search")
                return okr({ entries: p.query === "budget" ? [{ name: "Budget 2026.pdf", path: "/media/internal/Documents/Budget 2026.pdf", type: "file", size: 52000, mtime: at(6, 12) }] : [] });
            if (m === "org.webosphoenix.tethering/setWifi") {
                if (p.enabled && !state.hotspotPass) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "The password has 8 to 63 characters" });
                state.hotspot = p.enabled; return okr();
            }
            if (m === "com.webos.service.vpn/getProfileList") return okr({ vpnProfiles: state.vpnProfiles.map(function (x) { return { vpnProfileName: x }; }) });
            if (m === "com.webos.service.vpn/connect") { state.vpn = p.vpnProfileName; return okr(); }
            if (m === "com.webos.service.vpn/disconnect") { state.vpn = ""; return okr(); }
            if (m === "org.webosphoenix.system/getNowPlaying") return okr({ nowPlaying: state.nowPlaying });
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
    function request(r) {
        if (opts.llmRequest && /^http:\/\/127\.0\.0\.1[:/]/.test(r.url)) return opts.llmRequest(r);
        requests.push(r.url);
        if (opts.offline) return Promise.reject(new Error("offline"));
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
                                                     secrets: { seal: function () { return Promise.resolve({}); }, unseal: function () { return Promise.resolve(""); } },
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
    return { svc: svc, db: db, luna: luna, of: of, calls: calls, called: called, state: state, ask: ask, askAll: askAll, confirm: confirm, choose: choose,
             requests: requests, storage: storage, thread: function () { return thread; }, newThread: function () { thread = ""; },
             setNow: function (t) { clock = t; } };
}

module.exports = { device: device, NOW: NOW, at: at };
