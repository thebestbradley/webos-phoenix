// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the Phoenix Assistant can do: the commands the grammar recognises,
// which the on-device model (and a cloud model, when the user allows it)
// choose among as tools. Each does what the apps themselves do, with the
// same Luna calls and the same db8 records, so what the assistant makes
// shows in the app at once:
//
//   call         Phone {number, dial: true} (apps/phone)
//   text         org.webosports.service.messaging putMessage, an SMS in the
//                outbox (@phoenix/luna messaging.sendSms); without words,
//                Messaging's compose {to, name}
//   readMessages the last message received (com.palm.smsmessage:1, inbox)
//   email        com.palm.smtp sendMail {accountId, email}, as the Email app
//                sends (com.palm.app.email data/mail.js:139-145); without a
//                body, Email's compose {recipients, summary}
//                (compose/source/Composition.js:428-490)
//   searchEmail  com.palm.email:1 by its words, or the unread ones
//   event        a com.palm.calendarevent:1 in the first calendar that can
//                take one, shaped as the Calendar app saves it
//                (com.palm.app.calendar app/shared/CalendarEvent.js:258-268;
//                rrule as app/edit/RepeatView.js writes it)
//   agenda       com.palm.calendarevent:1, repeats expanded (lib/dates.js)
//   timer        an activity (com.palm.activitymanager) whose callback opens
//                the Assistant app with {timerDone}; it rings there.
//                timerStatus, timerCancel: the timers the assistant started
//   stopwatch    kept by the assistant (webOS's Clock had none)
//   alarm        the Clock's own alarm: a com.palm.clock.alarm:1 record and
//                the activity the Clock schedules for it (com.palm.app.clock
//                utility/alarmdbmanager.js:91-104, utility/activitymanager.js:58-82);
//                repeats "daily", "weekdays", "weekends" (main/alarmedit.js:36-40)
//   alarmList, alarmManage  the Clock's alarms listed, turned off, deleted
//   reminder     a task in Tasks (com.palm.task:1) with its reminder activity
//                (@phoenix/luna tasks.save / scheduleReminder)
//   task         a task in a list of Tasks (com.palm.tasklist:1, made if new)
//   note         a memo (com.palm.note:1), placed first on the Memos wall as
//                the Memos app places a new one (com.palm.app.notes
//                app/agents/GridAgent.js:91-97, app/models/Memo.js:98-180)
//   findNotes    com.palm.note:1 by its words
//   contactAdd   a local contact and its person (com.palm.contact.palmprofile:1,
//                com.palm.person:1), as the contacts linker builds them
//   contactInfo  a contact's number, email, address or birthday
//   toggle       Wi-Fi (com.webos.service.wifi setstate), Bluetooth
//                (bluetooth2 adapter/setState), airplane mode
//                (connectionmanager setstate offlineMode), the flashlight
//                (org.webosports.service.torch set), the ringer (the ringtone
//                stream's volume to 0 and back: a phone with no ringer
//                switch), Do Not Disturb (the ringer off: webOS's mute switch)
//   media        play, pause, next, previous: the media keys
//                (org.webosphoenix.system mediaKey, the same events as
//                com.palm.keys /media; the player with the audio focus acts)
//   volume       com.webos.service.audio master/getVolume, setVolume, muteVolume
//   brightness   com.palm.display control/setProperty {maximumBrightness}
//                (luna-sysmgr DisplayManager.cpp setMaximumBrightness)
//   screenshot   com.palm.systemmanager takeScreenShot (luna-sysmgr
//                SystemService.cpp cbTakeScreenShot)
//   lock         com.palm.display control/setState {state: "off"}: the
//                screen goes off and locks, as the power key does
//   battery      com.palm.power batteryStatusQuery, chargerStatusQuery
//   settings     Settings {page}
//   open         applicationManager launch
//   navigate     Maps {target: "mapto:<place>"} (webOS's "directions to")
//   distance     Open-Meteo's geocoder and where the device is
//   photos       com.palm.media.image.file:1 taken on those days, opened in
//                Photos {imageList}
//   play         Music {play: query}
//   weather      Open-Meteo (the Weather app's server) for a named place or
//                where the device is (com.webos.service.location)
//   convert      lib/units.js; currencies with Frankfurter's rates (the
//                European Central Bank's), online
//   worldTime    lib/places.js, else Open-Meteo's geocoder (its time zone)
//   calculate    lib/arith.js
//   time         the clock
//   search       the browser, with Just Type's default engine
//   undo         takes back what the assistant just made (read back first)
//   app:<key>    a command an app declared (lib/grammar.js), launched with
//                {<launchParam>: text}
//
// Each command: {id, title, description, parameters (JSON Schema, for the
// models' tool calling), risk}. risk "send", "delete" and "call" are read
// back and confirmed before they run, whichever layer chose them (and an
// alarm deletion, whose risk depends on what is asked).
//
//   prepare(command, args, env) -> {args, confirm?, reply?, awaiting?}
//       resolves contacts, apps, lists and alarms; reply: it cannot run
//       (said why); confirm: what to ask before running; awaiting: what is
//       missing, asked for (the next words fill it)
//   run(command, args, env) -> {text, data?, open?: {appId, params, title},
//       undo?: {...}}: open is the app to offer ("Open Calendar"), undo
//       what takes it back

"use strict";

var arith = require("./arith");
var D = require("./dates");
var units = require("./units");
var places = require("./places");

var CLOCK_APP = "com.palm.app.clock";
var CALENDAR_APP = "com.palm.app.calendar";
var TASKS_APP = "org.webosphoenix.tasks";
var MEMOS_APP = "com.palm.app.notes";
var CONTACTS_APP = "com.palm.app.contacts";
var EMAIL_APP = "com.palm.app.email";
var MESSAGING_APP = "org.webosphoenix.messaging";
var PHOTOS_APP = "org.webosphoenix.photos";
var SETTINGS_APP = "org.webosphoenix.settings";
var MAPS_APP = "org.webosphoenix.maps";
var ASSISTANT_APP = "org.webosphoenix.assistant";
var AM = "luna://com.palm.activitymanager/";
var DB = "luna://com.palm.db/";
var AUDIO = "luna://com.webos.service.audio/";

var S = { type: "string" }, I = { type: "integer" }, B = { type: "boolean" };
var WHEN = { type: "string", description: "When, as said (\"tomorrow at 3pm\", \"next Tuesday at noon\", \"in 2 hours\") or ISO 8601 local time" };
var BUILT_IN = [
    { id: "call", title: "Phone calls", risk: "call", description: "Phone a contact or a number.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Contact name" }, number: { type: "string", description: "Phone number, if no contact" }, label: { type: "string", enum: ["", "mobile", "home", "work"] } } } },
    { id: "text", title: "Text messages", risk: "send", description: "Send a text message (SMS) to a contact.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Contact name or number" }, message: { type: "string", description: "The words to send" } }, required: ["who"] } },
    { id: "readMessages", title: "Reading messages", risk: "read", description: "Read the last text message received, from anyone or from a contact.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Contact name; empty for anyone" } } } },
    { id: "email", title: "Email", risk: "send", description: "Send an email to a contact (read back first); without a body, open a new email to them.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Contact name or email address" }, subject: S, body: S }, required: ["who"] } },
    { id: "searchEmail", title: "Searching email", risk: "read", description: "Find emails by words, or from someone, or the unread ones.",
      parameters: { type: "object", properties: { query: S, from: { type: "boolean", description: "query is who it is from" }, unread: B } } },
    { id: "event", title: "Calendar events", risk: "change", description: "Add an event to the calendar.",
      parameters: { type: "object", properties: { title: S, start: WHEN, end: { type: "string", description: "When it ends, as said or ISO 8601" },
        duration_minutes: I, all_day: B, location: S, invitees: { type: "array", items: S, description: "Contact names" },
        repeat: { type: "string", enum: ["", "daily", "weekdays", "weekends", "weekly", "monthly", "yearly"] } }, required: ["title", "start"] } },
    { id: "agenda", title: "Calendar agenda", risk: "read", description: "Tell what is on the calendar: a day, a week, the next event, or when an event is.",
      parameters: { type: "object", properties: { range: { type: "string", enum: ["today", "tomorrow", "day", "this week", "next week", "next", "find"] },
        day: { type: "string", description: "For range day: the day, as said or ISO 8601" }, query: { type: "string", description: "For range find: the event's name" } } } },
    { id: "timer", title: "Timers", risk: "change", description: "Start a countdown timer.",
      parameters: { type: "object", properties: { seconds: { type: "integer", minimum: 1, description: "How long, in seconds" }, label: S }, required: ["seconds"] } },
    { id: "timerStatus", title: "Time left on timers", risk: "read", description: "Tell how much time is left on the running timers.",
      parameters: { type: "object", properties: {} } },
    { id: "timerCancel", title: "Cancelling timers", risk: "change", description: "Cancel a running timer (by its label) or all of them.",
      parameters: { type: "object", properties: { label: S, all: B } } },
    { id: "stopwatch", title: "Stopwatch", risk: "change", description: "Start, stop, reset or check the stopwatch.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["start", "stop", "resume", "reset", "status"] } }, required: ["action"] } },
    { id: "alarm", title: "Alarms", risk: "change", description: "Set an alarm in the Clock app, once or repeating.",
      parameters: { type: "object", properties: { time: { type: "string", description: "When, as said: \"7:30 am\", \"tomorrow at 6\", or ISO 8601 local time" }, label: S,
        repeat: { type: "string", enum: ["once", "daily", "weekdays", "weekends"] } }, required: ["time"] } },
    { id: "alarmList", title: "Listing alarms", risk: "read", description: "Tell which alarms are set.", parameters: { type: "object", properties: {} } },
    { id: "alarmManage", title: "Turning off and deleting alarms", risk: "change", description: "Turn off or delete an alarm (by its time) or all alarms.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["off", "delete"] }, time: { type: "string", description: "The alarm's time, \"7am\"" }, all: B }, required: ["action"] } },
    { id: "reminder", title: "Reminders", risk: "change", description: "Add a task to Tasks, with a reminder when a time is given.",
      parameters: { type: "object", properties: { text: { type: "string", description: "What to remind about" }, due: { type: "string", description: "When, as said (\"at 5 pm\", \"in 20 minutes\", \"tomorrow\") or ISO 8601; omit for none" } }, required: ["text"] } },
    { id: "task", title: "Tasks and lists", risk: "change", description: "Add an item to Tasks, to a named list (\"shopping\") or the default one.",
      parameters: { type: "object", properties: { text: S, list: { type: "string", description: "The list's name; empty for the default" }, due: WHEN }, required: ["text"] } },
    { id: "note", title: "Memos", risk: "change", description: "Save a memo in Memos.", parameters: { type: "object", properties: { text: S }, required: ["text"] } },
    { id: "findNotes", title: "Finding memos", risk: "read", description: "Find memos by their words.", parameters: { type: "object", properties: { query: S } } },
    { id: "contactAdd", title: "Adding contacts", risk: "change", description: "Add a contact with a phone number and/or email address.",
      parameters: { type: "object", properties: { name: S, number: S, email: S, label: { type: "string", enum: ["", "mobile", "home", "work"] } }, required: ["name"] } },
    { id: "contactInfo", title: "Contact details", risk: "read", description: "Tell a contact's phone number, email, address or birthday.",
      parameters: { type: "object", properties: { who: S, what: { type: "string", enum: ["phone", "email", "address", "birthday"] }, label: S }, required: ["who"] } },
    { id: "toggle", title: "Wi-Fi, Bluetooth, airplane mode, flashlight, ringer, Do Not Disturb", risk: "change", description: "Turn a device setting on or off.",
      parameters: { type: "object", properties: { setting: { type: "string", enum: ["wifi", "bluetooth", "airplane", "flashlight", "ringer", "dnd"] }, state: { type: "string", enum: ["on", "off", "toggle"] } }, required: ["setting", "state"] } },
    { id: "media", title: "Music controls", risk: "change", description: "Pause, resume, or skip to the next or previous song in the player.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["pause", "play", "next", "prev"] } }, required: ["action"] } },
    { id: "volume", title: "Volume", risk: "change", description: "Turn the volume up or down, set it (0-100), mute or unmute.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["up", "down", "set", "mute", "unmute", "status"] }, level: I }, required: ["action"] } },
    { id: "brightness", title: "Screen brightness", risk: "change", description: "Turn the screen brightness up or down, or set it (1-100).",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["up", "down", "set"] }, level: I }, required: ["action"] } },
    { id: "screenshot", title: "Screenshots", risk: "change", description: "Take a screenshot.", parameters: { type: "object", properties: {} } },
    { id: "lock", title: "Locking the screen", risk: "change", description: "Turn the screen off and lock the device.", parameters: { type: "object", properties: {} } },
    { id: "battery", title: "Battery", risk: "read", description: "Tell the battery level and whether it is charging.", parameters: { type: "object", properties: {} } },
    { id: "settings", title: "Settings pages", risk: "open", description: "Open a page of Settings.",
      parameters: { type: "object", properties: { page: { type: "string", enum: ["wifi", "bluetooth", "airplane", "phone", "hotspot", "vpn", "screen", "battery", "sounds", "datetime",
        "language", "textassist", "justtype", "clipboard", "assistant", "usb", "gamepads", "location", "emergency", "accessibility", "deviceinfo", "backup",
        "updates", "certificates", "devmode", "advanced"] } }, required: ["page"] } },
    { id: "open", title: "Opening apps", risk: "open", description: "Open an app by its name.",
      parameters: { type: "object", properties: { name: { type: "string", description: "The app's name, e.g. Maps" } }, required: ["name"] } },
    { id: "navigate", title: "Directions", risk: "open", description: "Get directions to a place in Maps.",
      parameters: { type: "object", properties: { destination: S }, required: ["destination"] } },
    { id: "distance", title: "Distances", risk: "read", description: "Tell how far away a place is.", parameters: { type: "object", properties: { place: S }, required: ["place"] } },
    { id: "photos", title: "Photos by day", risk: "open", description: "Show the photos taken on a day or in a week.",
      parameters: { type: "object", properties: { day: { type: "string", description: "\"yesterday\", \"last Friday\", \"last week\" or an ISO 8601 date" } } } },
    { id: "play", title: "Music", risk: "open", description: "Play music: an artist, album or song (empty for everything).",
      parameters: { type: "object", properties: { query: S } } },
    { id: "weather", title: "Weather", risk: "read", description: "Tell the weather now or tomorrow, here or in a named place.",
      parameters: { type: "object", properties: { place: { type: "string", description: "City; empty for here" }, day: { type: "string", enum: ["", "today", "tomorrow"] } } } },
    { id: "convert", title: "Unit and currency conversions", risk: "read", description: "Convert units (length, weight, volume, temperature, speed, area, data, time) or currencies (ISO codes).",
      parameters: { type: "object", properties: { value: { type: "number" }, from: { type: "string", description: "Unit id (km, mi, kg, lb, l, cup, c, f, ...) or currency code (USD)" }, to: S }, required: ["value", "from", "to"] } },
    { id: "worldTime", title: "Time around the world", risk: "read", description: "Tell the time in a city.", parameters: { type: "object", properties: { place: S }, required: ["place"] } },
    { id: "calculate", title: "Arithmetic", risk: "read", description: "Work out a sum: + - * / ^ ( ) % sqrt.",
      parameters: { type: "object", properties: { expression: S }, required: ["expression"] } },
    { id: "time", title: "Time and date", risk: "read", description: "Tell the time or the date.",
      parameters: { type: "object", properties: { what: { type: "string", enum: ["time", "date"] } } } },
    { id: "search", title: "Web search", risk: "open", description: "Search the web in the browser.",
      parameters: { type: "object", properties: { query: S }, required: ["query"] } },
    { id: "undo", title: "Undo", risk: "delete", internal: true, description: "Take back what the assistant just did.",
      parameters: { type: "object", properties: {} } }
];

// Every command: the built-in ones, then the apps' (lib/grammar.js compileAppCommands).
function catalogue(appCommands) {
    var out = BUILT_IN.map(function (c) { return Object.assign({ builtIn: true }, c); });
    (appCommands || []).forEach(function (a) {
        out.push({
            id: "app:" + a.key, title: a.title, risk: a.risk, appId: a.appId, url: a.url, launchParam: a.launchParam,
            description: a.description || a.title,
            parameters: { type: "object", properties: { text: { type: "string" } } }
        });
    });
    return out;
}
function find(list, id) {
    for (var i = 0; i < list.length; ++i) if (list[i].id === id) return list[i];
    return null;
}
// A tool name models accept (letters, digits, _ and -; at most 64).
function toolName(id) {
    return String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}
function fromToolName(list, name) {
    for (var i = 0; i < list.length; ++i) if (toolName(list[i].id) === name || list[i].id === name) return list[i];
    return null;
}
function needsConfirm(cmd) { return cmd.risk === "send" || cmd.risk === "delete" || cmd.risk === "call"; }

// ---- Helpers ------------------------------------------------------------------------------------

function ok(r) { return r && r.returnValue !== false; }
function lunaCall(env, uri, params) {
    return env.luna.call(uri, params || {}).then(function (r) {
        if (!ok(r)) {
            var e = new Error((r && r.errorText) || ("failed: " + uri));
            e.reply = r;
            throw e;
        }
        return r || {};
    });
}
function launch(env, id, params) {
    return lunaCall(env, "luna://com.palm.applicationManager/launch", { id: id, params: params || {} });
}
function dbFind(env, kind, extra) {
    return lunaCall(env, DB + "find", { query: Object.assign({ from: kind, limit: 500 }, extra || {}) })
        .then(function (r) { return r.results || []; });
}
function dbPut(env, objects) {
    return lunaCall(env, DB + "put", { objects: objects }).then(function (r) { return (r.results || []).map(function (x) { return x.id; }); });
}
function pad(n) { return (n < 10 ? "0" : "") + n; }
// The activity manager's schedule format (UTC), as @phoenix/luna tasks writes it.
function activityDate(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " +
        pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "Z";
}
function localDate(at) {
    return at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate()) + " " + pad(at.getHours()) + ":" + pad(at.getMinutes()) + ":00";
}
function personName(p) {
    var n = [p.name && p.name.givenName, p.name && p.name.familyName].filter(Boolean).join(" ").trim();
    return n || p.nickname || (p.organization && p.organization.name) || "";
}
function words(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9À-￿@.]+/g, " ").trim(); }
function matches(text, query) {
    var t = " " + words(text) + " ";
    return words(query).split(" ").filter(Boolean).every(function (w) { return t.indexOf(" " + w) >= 0; });
}
function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
function samePhone(a, b) {
    var x = digitsOnly(a), y = digitsOnly(b);
    return x.length >= 7 && y.length >= 7 && x.slice(-7) === y.slice(-7);
}
function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
}

// Contacts (com.palm.person:1), for names the grammar can split on and for
// numbers. Best match: the full name, then the first name, the nickname,
// the start of the name.
function people(env) {
    return lunaCall(env, DB + "find", { query: { from: "com.palm.person:1", limit: 500 } })
        .then(function (r) { return r.results || []; }, function () { return []; });
}
function contactNames(env) {
    return people(env).then(function (all) {
        var names = [];
        all.forEach(function (p) {
            var n = personName(p);
            if (n) names.push(n);
            if (p.name && p.name.givenName) names.push(p.name.givenName);
            if (p.nickname) names.push(p.nickname);
        });
        return names;
    });
}
function findPerson(env, who) {
    var w = String(who || "").toLowerCase().trim();
    return people(env).then(function (all) {
        var tests = [
            function (p) { return personName(p).toLowerCase() === w; },
            function (p) { return p.nickname && p.nickname.toLowerCase() === w; },
            function (p) { return p.name && p.name.givenName && p.name.givenName.toLowerCase() === w; },
            function (p) { return w.length >= 2 && personName(p).toLowerCase().indexOf(w) === 0; }
        ];
        for (var i = 0; i < tests.length; ++i) {
            var hit = all.filter(tests[i]);
            if (hit.length) return hit.sort(function (a, b) { return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0); })[0];
        }
        return null;
    });
}
function numberOf(p, label) {
    var nums = (p && p.phoneNumbers) || [];
    if (!nums.length) return null;
    var want = label ? "type_" + label : "";
    var pick = (want && nums.filter(function (n) { return n.type === want; })[0])
        || nums.filter(function (n) { return n.type === "type_mobile"; })[0]
        || nums.filter(function (n) { return n.primary; })[0] || nums[0];
    return pick.value;
}
function emailOf(p) {
    var list = (p && p.emails) || [];
    var pick = list.filter(function (e) { return e.primary; })[0] || list[0];
    return pick ? pick.value : null;
}
// Who a number or address belongs to, for messages and email.
function nameForPhone(all, addr) {
    var p = all.filter(function (x) { return (x.phoneNumbers || []).some(function (n) { return samePhone(n.value, addr); }); })[0];
    return p ? personName(p) : "";
}

// ---- Arguments a model wrote, as the commands take them ---------------------------------------
// Times as said ("at 5 pm", "tomorrow at 7") or ISO 8601 become ms; numbers as numbers.
function fromModel(cmd, args, env) {
    var a = Object.assign({}, args || {});
    var now = env.now();
    function moment(v, prefer) {
        if (typeof v === "number") return v;
        var s = String(v || "").trim();
        if (!s) return null;
        if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(s)) {
            var d = /T/.test(s) ? Date.parse(s) : new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))).getTime();
            return isNaN(d) ? null : d;
        }
        var w = env.lang.when(s, now, { prefer: prefer });
        if (w === null) w = env.lang.when("at " + s, now, { prefer: prefer });
        return w;
    }
    if (cmd.id === "timer") {
        if (typeof a.seconds === "string") a.seconds = env.lang.duration(a.seconds) || Number(a.seconds);
        a.seconds = Math.round(Number(a.seconds));
    }
    if (cmd.id === "alarm") {
        a.time = moment(a.time, "alarm");
        if (a.repeat && ["daily", "weekdays", "weekends"].indexOf(a.repeat) < 0) a.repeat = "once";
    }
    if (cmd.id === "reminder" || cmd.id === "task") a.due = moment(a.due, "day");
    if (cmd.id === "event") {
        var s = String(a.start || "").trim(), info = s && !/^\d{4}-/.test(s) ? env.lang.extract(s, now) : null;
        if (info) {
            var r = env.lang.resolve(info, now, "day");
            a.start = r.start; a.allDay = r.allDay; if (r.end) a.end = r.end;
            if (r.repeat && !a.repeat) a.repeat = r.repeat;
        } else {
            a.start = moment(s, "day");
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) a.allDay = true;
        }
        if (a.all_day) a.allDay = true;
        if (typeof a.end === "string") a.end = moment(a.end, "day");
        if (!a.end && a.duration_minutes > 0 && a.start) a.end = a.start + a.duration_minutes * 60000;
        var REP = { daily: { freq: "DAILY" }, weekdays: { freq: "WEEKLY", days: [1, 2, 3, 4, 5] }, weekends: { freq: "WEEKLY", days: [0, 6] },
                    weekly: { freq: "WEEKLY" }, monthly: { freq: "MONTHLY" }, yearly: { freq: "YEARLY" } };
        if (typeof a.repeat === "string") a.repeat = REP[a.repeat] || null;
        if (!Array.isArray(a.invitees)) a.invitees = a.invitees ? [String(a.invitees)] : [];
        delete a.duration_minutes; delete a.all_day;
    }
    if (cmd.id === "agenda") {
        var today = D.startOfDay(now), w = D.weekRange(now), range = a.range || "today";
        if (range === "today") { a.range = "day"; a.from = today; a.to = D.addDays(today, 1); }
        else if (range === "tomorrow") { a.range = "day"; a.from = D.addDays(today, 1); a.to = D.addDays(today, 2); }
        else if (range === "day") { var dd = moment(a.day, "day"); a.from = D.startOfDay(dd === null ? now : dd); a.to = D.addDays(a.from, 1); }
        else if (range === "this week") { a.range = "week"; a.from = w.from; a.to = w.to; a.label = "this week"; }
        else if (range === "next week") { a.range = "week"; a.from = w.to; a.to = D.addDays(w.to, 7); a.label = "next week"; }
    }
    if (cmd.id === "alarmManage") {
        var c = a.time ? env.lang.clock(String(a.time).toLowerCase()) : null;
        a.hour = c ? c.hour : null; a.minute = c ? c.minute : null; a.meridiem = c ? c.meridiem || "" : "";
        a.all = !!a.all || !c;
    }
    if (cmd.id === "photos") {
        var said = String(a.day || "").trim();
        a.label = said;
        if (/^\d{4}-\d{2}-\d{2}$/.test(said)) { a.from = moment(said); a.to = D.addDays(a.from, 1); }
        else if (said) {
            var info2 = env.lang.extract(said, now);
            var ww = D.weekRange(now);
            if (info2.week) { a.from = info2.week === "last" ? D.addDays(ww.from, -7) : ww.from; a.to = D.addDays(a.from, 7); }
            else if (info2.day !== undefined) { a.from = info2.day > now ? D.addDays(info2.day, -7) : info2.day; a.to = D.addDays(a.from, 1); }
        }
    }
    if (cmd.id === "convert") { a.from = String(a.from || ""); a.to = String(a.to || ""); a.currency = /^[A-Z]{3}$/.test(a.from) && /^[A-Z]{3}$/.test(a.to); }
    return a;
}

// ---- Prepare: resolve, decide whether to ask ----------------------------------------------------

function prepare(cmd, args, env) {
    var say = env.lang.say;
    args = Object.assign({}, args || {});
    function reply(text) { return Promise.resolve({ args: args, reply: text }); }
    if (cmd.id === "call" || cmd.id === "text") {
        var who = String(args.who || "").trim();
        var raw = args.number || (/^[+\d][\d\s().-]{2,}$/.test(who) ? who : "");
        if (raw) {
            args.number = String(raw).replace(/[^\d+]/g, "");
            args.name = who && !/^[+\d]/.test(who) ? who : "";
            return Promise.resolve(withConfirm(cmd, args, env));
        }
        if (!who) return reply(say.noSuchContact("that person"));
        return findPerson(env, who).then(function (p) {
            if (!p) return { args: args, reply: say.noSuchContact(who) };
            var number = numberOf(p, args.label);
            if (!number) return { args: args, reply: say.noNumber(personName(p) || who) };
            args.name = personName(p) || who;
            args.number = number;
            args.personId = p._id;
            return withConfirm(cmd, args, env);
        });
    }
    if (cmd.id === "email") {
        var to = String(args.who || "").trim();
        if (!to) return reply(say.noSuchContact("that person"));
        var direct = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to) ? Promise.resolve({ name: "", addr: to })
            : findPerson(env, to).then(function (p) {
                if (!p) return { error: say.noSuchContact(to) };
                var addr = emailOf(p);
                return addr ? { name: personName(p), addr: addr } : { error: say.noEmail(personName(p) || to) };
            });
        return direct.then(function (r) {
            if (r.error) return { args: args, reply: r.error };
            args.name = r.name; args.addr = r.addr;
            return withConfirm(cmd, args, env);
        });
    }
    if (cmd.id === "open") {
        var name = String(args.name || args.title || "").toLowerCase().trim();
        if (args.appId) return Promise.resolve({ args: args });
        return env.apps().then(function (apps) {
            var hit = apps.filter(function (a) { return String(a.title).toLowerCase() === name; })[0]
                || apps.filter(function (a) { return name.length >= 3 && String(a.title).toLowerCase().indexOf(name) === 0; })[0];
            if (!hit) return { args: args, reply: say.failed("there is no app called " + (args.name || "that")) };
            args.appId = hit.id;
            args.title = hit.title;
            return { args: args };
        });
    }
    if (cmd.id === "timer" && !(args.seconds > 0)) return reply(say.failed("how long?"));
    if (cmd.id === "alarm" && !(args.time > env.now())) return reply(say.failed("that time has passed"));
    if (cmd.id === "reminder" && !String(args.text || "").trim()) return reply(say.failed("remind you of what?"));
    if (cmd.id === "task" && !String(args.text || "").trim()) return reply(say.failed("add what?"));
    if (cmd.id === "note" && !String(args.text || "").trim()) return reply(say.failed("what should the memo say?"));
    if (cmd.id === "event") {
        if (!args.title) args.title = "New event";
        if (!(args.start > 0)) return Promise.resolve({ args: args, reply: say.eventWhen(), awaiting: { command: "event", args: args } });
        return Promise.resolve({ args: args });
    }
    if (cmd.id === "contactAdd") {
        if (!String(args.name || "").trim() || !(args.number || args.email)) return reply(say.contactNeedsMore());
        return Promise.resolve({ args: args });
    }
    if (cmd.id === "alarmManage") {
        return dbFind(env, "com.palm.clock.alarm:1").then(function (all) {
            var hit = all.filter(function (a) {
                if (args.hour === null || args.hour === undefined) return args.action === "delete" || a.enabled;
                var h = Number(a.hour), want = Number(args.hour);
                var hourOk = args.meridiem === "am" ? h === want % 12 : args.meridiem === "pm" ? h === want % 12 + 12 : args.meridiem === "24" ? h === want : h % 12 === want % 12;
                return hourOk && Number(a.minute) === Number(args.minute || 0);
            });
            if (!hit.length) {
                if (args.hour === null || args.hour === undefined) return { args: args, reply: say.alarmsNone() };
                return { args: args, reply: say.alarmNoMatch(say.clockTime(args.hour, args.minute || 0, args.meridiem)) };
            }
            args.ids = hit.map(function (a) { return a._id; });
            args.keys = hit.map(function (a) { return a.key; });
            args.items = hit.map(function (a) { return a.niceTime || say.clockTime(a.hour, a.minute, "24"); });
            if (args.action === "delete") return { args: args, confirm: say.confirmAlarmDelete(args.items) };
            return { args: args };
        });
    }
    if (cmd.id === "undo") {
        if (!args.undo) return reply(say.nothingToUndo());
        return Promise.resolve({ args: args, confirm: say.confirmUndo(args.undo.what) });
    }
    return Promise.resolve(withConfirm(cmd, args, env));
}
function withConfirm(cmd, args, env) {
    var say = env.lang.say;
    if (!needsConfirm(cmd)) return { args: args };
    if (cmd.id === "call") return { args: args, confirm: say.confirmCall(args.name, args.number) };
    if (cmd.id === "text") {
        if (!String(args.message || "").trim()) return { args: args };   // compose: nothing is sent
        return { args: args, confirm: say.confirmText(args.name || args.number, args.message) };
    }
    if (cmd.id === "email") {
        if (!String(args.body || "").trim()) return { args: args };   // compose: nothing is sent
        return { args: args, confirm: say.confirmEmail(args.name || args.addr, args.subject, args.body) };
    }
    return { args: args, confirm: cmd.title + (args.text ? ": \"" + args.text + "\"" : "") + "?" };
}

// ---- Run -----------------------------------------------------------------------------------------

function ringer(env, on) {
    if (!on) {
        return lunaCall(env, AUDIO + "getInputVolume", { streamType: "pringtones" }).then(function (r) {
            if (r.volume > 0) env.storage.set("assistant:ringerVolume", r.volume);
            return lunaCall(env, AUDIO + "setInputVolume", { streamType: "pringtones", volume: 0 });
        });
    }
    var v = env.storage.get("assistant:ringerVolume") || 70;
    return lunaCall(env, AUDIO + "setInputVolume", { streamType: "pringtones", volume: v });
}
var TOGGLE_RUN = {
    wifi: function (env, on) { return lunaCall(env, "luna://com.webos.service.wifi/setstate", { state: on ? "enabled" : "disabled" }); },
    bluetooth: function (env, on) { return lunaCall(env, "luna://com.webos.service.bluetooth2/adapter/setState", { powered: on }); },
    airplane: function (env, on) { return lunaCall(env, "luna://com.webos.service.connectionmanager/setstate", { offlineMode: on ? "enabled" : "disabled" }); },
    flashlight: function (env, on) { return lunaCall(env, "luna://org.webosports.service.torch/set", { on: on }); },
    ringer: ringer,
    dnd: function (env, on) { return ringer(env, !on); }
};
var TOGGLE_STATE = {
    wifi: function (env) { return lunaCall(env, "luna://com.webos.service.wifi/getstatus", {}).then(function (r) { return r.status !== "serviceDisabled" && r.wifiState !== "disabled"; }); },
    bluetooth: function (env) { return lunaCall(env, "luna://com.webos.service.bluetooth2/adapter/getStatus", {}).then(function (r) { return !!(r.adapters && r.adapters[0] && r.adapters[0].powered); }); },
    airplane: function (env) { return lunaCall(env, "luna://com.webos.service.connectionmanager/getstatus", {}).then(function (r) { return r.offlineMode === "enabled"; }); },
    flashlight: function (env) { return lunaCall(env, "luna://org.webosports.service.torch/getStatus", {}).then(function (r) { return !!r.on; }); },
    ringer: function (env) { return lunaCall(env, AUDIO + "getInputVolume", { streamType: "pringtones" }).then(function (r) { return r.volume > 0; }); },
    dnd: function (env) { return TOGGLE_STATE.ringer(env).then(function (on) { return !on; }); }
};

var WMO = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "raining", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snowing", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers",
    82: "heavy showers", 85: "snow showers", 86: "snow showers", 95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail" };

function getJson(env, url) {
    return env.request({ method: "GET", url: url, headers: { Accept: "application/json" } }).then(function (r) {
        if (r.status !== 200) throw new Error("HTTP " + r.status);
        return JSON.parse(r.body);
    });
}
function geocode(env, place) {
    return getJson(env, "https://geocoding-api.open-meteo.com/v1/search?count=1&language=" + env.lang.id + "&name=" + encodeURIComponent(place))
        .then(function (g) {
            var p = g.results && g.results[0];
            if (!p) throw Object.assign(new Error("no place"), { said: env.lang.say.noPlace(place) });
            return { lat: p.latitude, lon: p.longitude, name: p.name, timezone: p.timezone };
        });
}
function here(env) {
    return lunaCall(env, "luna://com.webos.service.location/getCurrentPosition", { responseTime: 2, maximumAge: 600 })
        .then(function (r) {
            if (typeof r.latitude !== "number" || (r.errorCode && r.errorCode !== 0)) throw new Error("no fix");
            return { lat: r.latitude, lon: r.longitude, name: "" };
        }, function () { throw Object.assign(new Error("no location"), { said: env.lang.say.noLocation() }); });
}

function weather(args, env) {
    var say = env.lang.say;
    var imperial = env.units === "imperial";
    var where = args.place ? geocode(env, args.place) : here(env);
    return where.then(function (pl) {
        var url = "https://api.open-meteo.com/v1/forecast?latitude=" + pl.lat + "&longitude=" + pl.lon +
            "&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=auto" +
            (imperial ? "&temperature_unit=fahrenheit" : "");
        return getJson(env, url).then(function (f) {
            var unit = imperial ? "F" : "C";
            var i = args.day === "tomorrow" ? 1 : 0, daily = f.daily || {};
            var hi = daily.temperature_2m_max ? daily.temperature_2m_max[i] : null, lo = daily.temperature_2m_min ? daily.temperature_2m_min[i] : null;
            var code = i === 1 ? (daily.weather_code || [])[1] : f.current && f.current.weather_code;
            return { text: say.weather(pl.name, f.current ? f.current.temperature_2m : hi, unit, WMO[code] || "", args.day, hi, lo),
                     open: { appId: "org.webosphoenix.weather", params: {}, title: "Weather" } };
        });
    }).catch(function (e) {
        if (e && e.said) return { text: e.said };
        return launch(env, "org.webosphoenix.weather", {}).then(function () { return { text: say.noWeather() }; },
                                                                  function () { return { text: say.noWeather() }; });
    });
}

function defaultSearchUrl(env, query) {
    return lunaCall(env, "luna://com.palm.universalsearch/getUniversalSearchList", {}).then(function (r) {
        var list = r.UniversalSearchList || [];
        var e = list.filter(function (x) { return x.id === r.defaultSearchEngine; })[0] || list[0];
        return e && e.url ? e.url : "https://www.google.com/search?q=#{searchTerms}";
    }, function () { return "https://www.google.com/search?q=#{searchTerms}"; }).then(function (u) {
        return u.replace("#{searchTerms}", encodeURIComponent(query));
    });
}

// ---- Calendar ----------------------------------------------------------------------------------

// The calendar a new event goes in: the first one that can take it, the
// device's own (the profile account's local calendar) first, as the
// Calendar app's default.
function defaultCalendar(env) {
    return dbFind(env, "com.palm.calendar:1").then(function (cals) {
        var ok2 = cals.filter(function (c) { return !c.isReadOnly; });
        return ok2.filter(function (c) { return c.syncSource === "Local"; })[0] || ok2[0] || null;
    });
}
// The events in [from, to), repeats expanded: [{id, title, start, end, allDay, location}] by start.
function eventsIn(env, from, to) {
    return dbFind(env, "com.palm.calendarevent:1").then(function (all) {
        var out = [];
        all.forEach(function (ev) {
            if (ev._del || ev.parentId) return;
            var len = (Number(ev.dtend) || Number(ev.dtstart)) - Number(ev.dtstart);
            D.occurrences(ev, from, to).forEach(function (s) {
                out.push({ id: ev._id, title: ev.subject || "(no title)", start: s, end: s + len, allDay: !!ev.allDay, location: ev.location || "" });
            });
        });
        return out.sort(function (a, b) { return (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.start - b.start; });
    });
}
function addEvent(args, env) {
    var say = env.lang.say, now = env.now();
    return defaultCalendar(env).then(function (cal) {
        if (!cal) return { text: say.noCalendar(), open: { appId: CALENDAR_APP, params: {}, title: "Calendar" } };
        var invited = (args.invitees || []).map(function (n) {
            return findPerson(env, n).then(function (p) { return p && emailOf(p) ? { email: emailOf(p), commonName: personName(p), organizer: false } : null; });
        });
        return Promise.all(invited).then(function (attendees) {
            attendees = attendees.filter(Boolean);
            var start = args.allDay ? D.startOfDay(args.start) : args.start;
            // All day: midnight to 23:59:59, as the Calendar app saves one; else an hour by default.
            var end = args.allDay ? D.at(start, 23, 59) + 59000 : (args.end > start ? args.end : start + 3600000);
            var ev = { _kind: "com.palm.calendarevent:1", calendarId: cal._id, accountId: cal.accountId || "",
                subject: String(args.title || "New event"), location: String(args.location || ""), note: String(args.note || ""),
                dtstart: start, dtend: end, allDay: !!args.allDay, tzId: timeZone(),
                rrule: args.repeat ? D.rrule(args.repeat, start) : null,
                alarm: [{ action: "display", alarmTrigger: { value: args.allDay ? "-P1D" : "-PT15M", valueType: "DURATION" } }],
                attendees: attendees, created: now, lastModified: now, transp: "OPAQUE" };
            return dbPut(env, [ev]).then(function (ids) {
                return { text: say.eventAdded(ev.subject, start, end, ev.allDay, now, ev.location, args.repeat),
                         data: { eventId: ids[0] },
                         open: { appId: CALENDAR_APP, params: { showEventDetail: ids[0] }, title: "Calendar" },
                         undo: { kind: "db", ids: ids, what: say.undoWhat.event(ev.subject) } };
            });
        });
    });
}
function agenda(args, env) {
    var say = env.lang.say, now = env.now(), today = D.startOfDay(now);
    var open = { appId: CALENDAR_APP, params: {}, title: "Calendar" };
    if (args.range === "next" || args.range === "find") {
        return eventsIn(env, args.range === "find" ? today : now, D.addDays(today, args.range === "find" ? 366 : 60)).then(function (evs) {
            if (args.range === "next") {
                var next = evs.filter(function (e) { return !e.allDay && e.start >= now; }).sort(function (a, b) { return a.start - b.start; })[0]
                    || evs.filter(function (e) { return e.start >= today; })[0];
                return { text: say.agendaNext(next || null, now), open: next ? { appId: CALENDAR_APP, params: { showEventDetail: next.id }, title: "Calendar" } : open };
            }
            var q = String(args.query || "").replace(/\b(?:my|the|appointment|meeting|event)\b/g, " ");
            var hit = evs.filter(function (e) { return matches(e.title + " " + e.location, q); }).sort(function (a, b) { return a.start - b.start; })[0];
            return { text: say.agendaFound(args.query, hit || null, now), open: hit ? { appId: CALENDAR_APP, params: { showEventDetail: hit.id }, title: "Calendar" } : open };
        });
    }
    var from = args.from !== undefined ? args.from : today, to = args.to !== undefined ? args.to : D.addDays(today, 1);
    var label = args.label || say.dayLabel(from, now);
    return eventsIn(env, from, to).then(function (evs) {
        if (args.range === "week") evs.sort(function (a, b) { return a.start - b.start; });
        return { text: say.agenda(evs, label, now), data: { count: evs.length }, open: open };
    });
}

// ---- Alarms ------------------------------------------------------------------------------------

function niceDay(at, now) {
    // com.palm.app.clock utility/utilities.js nextAlarmDayText: "" today, "Tomorrow", else the weekday.
    var days = D.daysBetween(now, at);
    if (days <= 0) return "";
    if (days === 1) return "Tomorrow";
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(at).getDay()];
}
function scheduleAlarm(env, record, at) {
    // activitymanager.js setAlarmTimeout: "local" start, ring on launch.
    var local = localDate(at);
    return lunaCall(env, AM + "create", { start: true, replace: true, activity: {
        name: record.key, description: "com.palm.app.clock alarm: " + record.title, type: { foreground: true, persist: true },
        callback: { method: "palm://com.palm.applicationManager/launch",
                    params: { id: CLOCK_APP, params: { action: "ring", key: record.key, setTime: local } } },
        schedule: { start: local, local: true } } });
}
// When an alarm next rings (com.palm.app.clock utilities.js dateGetNext).
function nextRing(a, now) {
    for (var i = 0; i < 8; ++i) {
        var t = D.at(D.addDays(D.startOfDay(now), i), Number(a.hour), Number(a.minute));
        var wd = new Date(t).getDay();
        if (t <= now) continue;
        if (a.occurs === "weekdays" && (wd === 0 || wd === 6)) continue;
        if (a.occurs === "weekends" && wd !== 0 && wd !== 6) continue;
        return t;
    }
    return null;
}

// ---- Memos ---------------------------------------------------------------------------------------

// com.palm.app.notes app/models/Memo.js:111-180 getMemoPosition: a
// position string between two others (the wall sorts by it).
function memoPosition(left, right) {
    var distance, leftCharCode, i;
    for (i = 0; i < left.length && i < right.length && left.charAt(i) === right.charAt(i); i++) { /* first mismatch */ }
    function middleChar(a, b) { return String.fromCharCode(a + (b - a) / 2); }
    if (right.length === left.length && right.length === i) return left + "m";
    if (right.length === i) {
        var z = "z".charCodeAt(0);
        leftCharCode = left.charCodeAt(i);
        distance = z - leftCharCode;
        if (distance > 1) return left.substring(0, i) + middleChar(leftCharCode, z);
        return left.substring(0, i + 1) + memoPosition(left.substring(i + 1), "");
    }
    if (left.length === i) {
        var a = "a".charCodeAt(0), rc = right.charCodeAt(i);
        distance = rc - a;
        if (distance > 1) return left + middleChar(a, rc);
        return left + "a" + memoPosition("", right.substring(i + 1));
    }
    leftCharCode = left.charCodeAt(i);
    distance = right.charCodeAt(i) - leftCharCode;
    if (distance > 1) return left.substring(0, i) + middleChar(leftCharCode, right.charCodeAt(i));
    return left.substring(0, i + 1) + memoPosition(left.substring(i + 1), right.substring(i + 1));
}
var MEMO_COLORS = ["blue", "yellow", "green", "pink", "salmon"];

// ---- Tasks ---------------------------------------------------------------------------------------

function taskList(env, name) {
    return dbFind(env, "com.palm.tasklist:1").then(function (lists) {
        if (name) {
            var n = words(name);
            var hit = lists.filter(function (l) { return words(l.name) === n; })[0]
                || lists.filter(function (l) { return words(l.name).replace(/ list$/, "") === n.replace(/ list$/, ""); })[0]
                || lists.filter(function (l) { return words(l.name).indexOf(n) === 0; })[0];
            if (hit) return { id: hit._id, name: hit.name, made: false };
            return dbPut(env, [{ _kind: "com.palm.tasklist:1", name: name, accountId: "", sortOrder: lists.length }])
                .then(function (ids) { return { id: ids[0], name: name, made: true }; });
        }
        var inbox = lists.filter(function (l) { return l.isDefault; })[0];
        if (inbox) return { id: inbox._id, name: "", made: false };
        return dbPut(env, [{ _kind: "com.palm.tasklist:1", name: "Inbox", accountId: "", sortOrder: 0, isDefault: true }])
            .then(function (ids) { return { id: ids[0], name: "", made: false }; });
    });
}
function addTask(env, text, list, due, remind) {
    var now = env.now();
    return taskList(env, list).then(function (l) {
        var task = { _kind: "com.palm.task:1", summary: String(text).trim(), due: due, allDay: false, completed: false,
            completedTime: null, priority: 0, listId: l.id, accountId: "", remind: remind ? due : null,
            uid: now.toString(36) + "-assistant@webosphoenix", createdTime: now, modifiedTime: now };
        return dbPut(env, [task]).then(function (ids) {
            var taskId = ids[0];
            var done = { task: task, taskId: taskId, list: l };
            if (!remind || !due) return done;
            return lunaCall(env, AM + "create", { start: true, replace: true, activity: {
                name: "org.webosphoenix.tasks.remind." + taskId, description: "Tasks reminder",
                type: { foreground: true, persist: true }, schedule: { start: activityDate(due) },
                callback: { method: "palm://com.palm.applicationManager/launch",
                            params: { id: TASKS_APP, params: { reminder: taskId } } } } }).then(function () { return done; });
        });
    });
}

// ---- The run ------------------------------------------------------------------------------------

function run(cmd, args, env) {
    var say = env.lang.say, now = env.now();
    switch (cmd.id) {
    case "call":
        return launch(env, "org.webosphoenix.phone", { number: args.number, dial: true })
            .then(function () { return { text: say.calling(args.name || args.number) }; });
    case "text":
        if (!String(args.message || "").trim())
            return launch(env, MESSAGING_APP, { to: args.number, name: args.name || "" })
                .then(function () { return { text: say.composing(args.name || args.number) }; });
        return lunaCall(env, "luna://org.webosports.service.messaging/putMessage", { message: {
            _kind: "com.palm.smsmessage:1", folder: "outbox", status: "pending", serviceName: "sms",
            messageText: String(args.message), to: [{ addr: args.number, name: args.name || "" }],
            localTimestamp: now, timestamp: now, flags: { visible: true, read: true } } })
            .then(function () { return { text: say.sent(args.name || args.number), open: { appId: MESSAGING_APP, params: {}, title: "Messaging" } }; });
    case "readMessages":
        return Promise.all([dbFind(env, "com.palm.smsmessage:1"), people(env)]).then(function (got) {
            var all = got[1], who = String(args.who || "").trim();
            var msgs = got[0].filter(function (m) { return m.folder === "inbox" && (!m.flags || m.flags.visible !== false); });
            var finding = who ? findPerson(env, who) : Promise.resolve(null);
            return finding.then(function (p) {
                if (who && !p) return { text: say.noSuchContact(who) };
                if (p) msgs = msgs.filter(function (m) { return (p.phoneNumbers || []).some(function (n) { return m.from && samePhone(n.value, m.from.addr); }); });
                msgs.sort(function (a, b) { return (b.localTimestamp || b.timestamp || 0) - (a.localTimestamp || a.timestamp || 0); });
                var last = msgs[0];
                if (!last) return { text: p ? say.noMessagesFrom(personName(p)) : say.lastMessage("") };
                var from = (last.from && (last.from.name || nameForPhone(all, last.from.addr) || last.from.addr)) || "Someone";
                return { text: say.lastMessage(from, last.messageText || "", last.localTimestamp || last.timestamp, now),
                         open: { appId: MESSAGING_APP, params: last.threadId ? { threadId: last.threadId } : {}, title: "Messaging" } };
            });
        });
    case "email":
        if (!String(args.body || "").trim())
            return launch(env, EMAIL_APP, { recipients: [{ type: "email", role: 1, value: args.addr, contactDisplay: args.name || args.addr }],
                                            summary: String(args.subject || "") })
                .then(function () { return { text: say.emailComposing(args.name || args.addr) }; });
        return dbFind(env, "com.palm.mail.account:1").then(function (accounts) {
            var acct = accounts[0];
            if (!acct) return { text: say.noMailAccount() };
            var body = String(args.body).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
            var email = { from: { addr: acct.email || acct.username || "", name: acct.realName || "", type: "from" },
                to: [{ addr: args.addr, name: args.name || "", type: "to" }], subject: String(args.subject || ""),
                parts: [{ type: "body", mimeType: "text/html", content: body }], timestamp: now, flags: { visible: true, read: true } };
            return lunaCall(env, "luna://com.palm.smtp/sendMail", { accountId: acct.accountId, email: email })
                .then(function () { return { text: say.emailSent(args.name || args.addr), open: { appId: EMAIL_APP, params: {}, title: "Email" } }; });
        });
    case "searchEmail":
        return dbFind(env, "com.palm.email:1").then(function (all) {
            var q = String(args.query || "").trim();
            var hits = all.filter(function (e) {
                if (e.flags && e.flags.visible === false) return false;
                if (args.unread && e.flags && e.flags.read) return false;
                if (!q) return true;
                var from = e.from ? (e.from.name || "") + " " + (e.from.addr || "") : "";
                return args.from ? matches(from, q) : matches([e.subject, from, e.summary].join(" "), q);
            }).sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
            return { text: say.emailsFound(args.unread ? (q || "") : q, hits.map(function (e) { return { subject: e.subject, from: e.from && (e.from.name || e.from.addr) }; }), args.unread),
                     open: { appId: EMAIL_APP, params: hits.length === 1 ? { emailId: hits[0]._id } : {}, title: "Email" } };
        });
    case "event":
        return addEvent(args, env);
    case "agenda":
        return agenda(args, env);
    case "timer": {
        var id = "assistant.timer." + now.toString(36) + Math.random().toString(36).slice(2, 6);
        var label = String(args.label || "");
        return lunaCall(env, AM + "create", { start: true, replace: true, activity: {
            name: id, description: "Assistant timer" + (label ? ": " + label : ""),
            type: { foreground: true, persist: true },
            schedule: { start: activityDate(now + args.seconds * 1000) },
            callback: { method: "palm://com.palm.applicationManager/launch",
                        params: { id: ASSISTANT_APP, params: { timerDone: { id: id, label: label, seconds: args.seconds } } } } } })
            .then(function () {
                env.storage.set("assistant:timer:" + id, { id: id, label: label, seconds: args.seconds, ends: now + args.seconds * 1000 });
                return { text: say.timerSet(args.seconds, label), data: { timer: id, ends: now + args.seconds * 1000 },
                         undo: { kind: "timer", ids: [id], what: say.undoWhat.timer() } };
            });
    }
    case "timerStatus":
        return Promise.resolve({ text: say.timerLeft(runningTimers(env), now) });
    case "timerCancel": {
        var want = String(args.label || "").toLowerCase(), list = runningTimers(env);
        var cancel = list.filter(function (x) { return !want || String(x.label).toLowerCase() === want; });
        if (!args.all && !want && cancel.length > 1) cancel = cancel.slice(0, 1);
        return Promise.all(cancel.map(function (x) {
            env.storage.remove("assistant:timer:" + x.id);
            return lunaCall(env, AM + "cancel", { activityName: x.id }).catch(function () { return null; });
        })).then(function () { return { text: say.timerCancelled(cancel.length, want) }; });
    }
    case "stopwatch": {
        var sw = env.storage.get("assistant:stopwatch") || { running: false, startedAt: 0, elapsed: 0 };
        var elapsed = sw.elapsed + (sw.running ? now - sw.startedAt : 0), act = args.action || "status";
        if (act === "start") sw = { running: true, startedAt: now, elapsed: 0 };
        else if (act === "resume") sw = { running: true, startedAt: now, elapsed: elapsed };
        else if (act === "stop") sw = { running: false, startedAt: 0, elapsed: elapsed };
        else if (act === "reset") sw = { running: false, startedAt: 0, elapsed: 0 };
        else if (!sw.running && !sw.elapsed) act = "none";
        env.storage.set("assistant:stopwatch", sw);
        return Promise.resolve({ text: say.stopwatch(act, elapsed), data: { elapsed: elapsed } });
    }
    case "alarm": {
        // As the Clock makes one (alarmdbmanager.js objBlankAlarm, createBlankAlarm).
        var at = new Date(args.time), key = "clockAlarm" + now;
        var h = at.getHours(), m = at.getMinutes(), occurs = args.repeat && args.repeat !== "once" ? args.repeat : "once";
        var record = { _kind: "com.palm.clock.alarm:1", key: key, title: String(args.label || "Alarm"), occurs: occurs,
            hour: h, minute: m, timezoneOffset: -at.getTimezoneOffset() / 60,
            niceTime: (h % 12 || 12) + ":" + pad(m) + " " + (h < 12 ? "AM" : "PM"), niceDay: niceDay(args.time, now), enabled: true,
            alarmSoundFile: "/usr/palm/sounds/alert.wav", alarmSoundTitle: "Alert", snoozed: false, hideSnoozeTime: false };
        return dbPut(env, [record]).then(function (ids) {
            return scheduleAlarm(env, record, at).then(function () {
                var text = say.alarmSet(args.time, now, args.label, occurs);
                if (args.unrepeated) text += " " + say.alarmRepeatNot(args.unrepeated);
                return { text: text, open: { appId: CLOCK_APP, params: {}, title: "Clock" },
                         undo: { kind: "alarm", ids: ids, keys: [key], what: say.undoWhat.alarm(record.niceTime) } };
            });
        });
    }
    case "alarmList":
        return dbFind(env, "com.palm.clock.alarm:1").then(function (all) {
            all.sort(function (a, b) { return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute); });
            return { text: say.alarmsList(all), open: { appId: CLOCK_APP, params: {}, title: "Clock" } };
        });
    case "alarmManage": {
        var cancels = (args.keys || []).map(function (k) { return lunaCall(env, AM + "cancel", { activityName: k }).catch(function () { return null; }); });
        if (args.action === "delete") {
            return Promise.all(cancels).then(function () { return lunaCall(env, DB + "del", { ids: args.ids }); })
                .then(function () { return { text: say.alarmsDeleted(args.ids.length), open: { appId: CLOCK_APP, params: {}, title: "Clock" } }; });
        }
        return Promise.all(cancels).then(function () {
            return lunaCall(env, DB + "merge", { objects: args.ids.map(function (i) { return { _id: i, enabled: false }; }) });
        }).then(function () {
            return { text: say.alarmsOff(args.items), open: { appId: CLOCK_APP, params: {}, title: "Clock" },
                     undo: { kind: "alarmOn", ids: args.ids, what: "turn " + (args.items.length === 1 ? "that alarm" : "those alarms") + " back on" } };
        });
    }
    case "reminder":
        return addTask(env, args.text, "", args.due > now ? args.due : null, true).then(function (r) {
            return { text: say.reminderSet(r.task.summary, r.task.due, now), open: { appId: TASKS_APP, params: { taskId: r.taskId }, title: "Tasks" },
                     undo: { kind: "db", ids: [r.taskId], activities: r.task.due ? ["org.webosphoenix.tasks.remind." + r.taskId] : [], what: say.undoWhat.task(r.task.summary) } };
        });
    case "task":
        return addTask(env, args.text, args.list || "", args.due || null, false).then(function (r) {
            return { text: say.taskAdded(r.task.summary, r.list.name, r.task.due, now, r.list.made),
                     open: { appId: TASKS_APP, params: { taskId: r.taskId }, title: "Tasks" },
                     undo: { kind: "db", ids: r.list.made ? [r.taskId, r.list.id] : [r.taskId], what: say.undoWhat.task(r.task.summary) } };
        });
    case "note":
        return dbFind(env, "com.palm.note:1").then(function (memos) {
            memos.sort(function (a, b) { return String(a.position || "") < String(b.position || "") ? -1 : 1; });
            var first = memos[0];
            var text = String(args.text).trim();
            var memo = { _kind: "com.palm.note:1", text: text, title: text.substring(0, 50),
                color: first ? MEMO_COLORS[(MEMO_COLORS.indexOf(first.color) + 1) % MEMO_COLORS.length] : "yellow",
                position: memoPosition("a", (first && first.position) || "z"), createdTimestamp: now, modifiedTimestamp: now };
            return dbPut(env, [memo]).then(function (ids) {
                return { text: say.noteSaved(), open: { appId: MEMOS_APP, params: {}, title: "Memos" },
                         undo: { kind: "db", ids: ids, what: say.undoWhat.note() } };
            });
        });
    case "findNotes":
        return dbFind(env, "com.palm.note:1").then(function (memos) {
            var q = String(args.query || "").trim();
            var hits = memos.filter(function (n) { return !q || matches(n.text || n.title, q); })
                .sort(function (a, b) { return (b.modifiedTimestamp || 0) - (a.modifiedTimestamp || 0); });
            return { text: say.notesFound(q, hits), open: { appId: MEMOS_APP, params: {}, title: "Memos" } };
        });
    case "contactAdd": {
        // As runtime/sample-data.js and the contacts linker store a local
        // contact: the contact in the profile account, and its person.
        return dbFind(env, "com.palm.account:1").then(function (accounts) {
            var profile = accounts.filter(function (a) { return a.templateId === "com.palm.palmprofile"; })[0];
            var parts = String(args.name).trim().split(/\s+/);
            var given = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0], family = parts.length > 1 ? parts[parts.length - 1] : "";
            var name = { givenName: given, familyName: family, middleName: "", honorificPrefix: "", honorificSuffix: "" };
            var type = "type_" + (args.label || "mobile");
            var phones = args.number ? [{ value: String(args.number), type: type, primary: true }] : [];
            var emails = args.email ? [{ value: String(args.email), type: "type_home", primary: true }] : [];
            return lunaCall(env, DB + "reserveIds", { count: 2 }).then(function (r) {
                var cid = r.ids[0], pid = r.ids[1];
                var contact = { _id: cid, _kind: "com.palm.contact.palmprofile:1", accountId: profile ? profile._id : "", name: name, nickname: "",
                    emails: emails, phoneNumbers: phones, addresses: [], organizations: [], urls: [], ims: [], photos: [], relations: [], tags: [],
                    birthday: "", anniversary: "", gender: "", note: "" };
                var d = digitsOnly(args.number), rev = function (s) { return s.split("").reverse().join(""); };
                var norm = d.length === 10 ? "-" + rev(d.slice(6)) + rev(d.slice(3, 6)) + "-" + rev(d.slice(0, 3)) + "--" : "-" + rev(d) + "---";
                var person = { _id: pid, _kind: "com.palm.person:1", contactIds: [cid], name: name, names: [name], nickname: "",
                    emails: emails.map(function (e) { return Object.assign({ normalizedValue: e.value.toLowerCase(), favoriteData: {} }, e); }),
                    phoneNumbers: phones.map(function (p) { return Object.assign({ normalizedValue: norm, speedDial: "", favoriteData: {} }, p); }),
                    addresses: [], organization: { name: "", title: "", department: "", type: "", description: "", startDate: "", endDate: "", location: {} },
                    urls: [], ims: [], notes: [], relations: [],
                    photos: { accountId: "", bigPhotoId: "", bigPhotoPath: "", contactId: "", listPhotoPath: "", listPhotoSource: "", squarePhotoId: "", squarePhotoPath: "" },
                    birthday: "", anniversary: "", gender: "", favorite: false, ringtone: { location: "", name: "" }, reminder: "", launcherId: "",
                    sortKey: (family || given ? (family + "\t" + given) : "").toLowerCase(),
                    searchTerms: [(given.charAt(0) + family).toLowerCase(), (family + given).toLowerCase()] };
                return dbPut(env, [contact, person]).then(function () {
                    return { text: say.contactAdded(String(args.name)), open: { appId: CONTACTS_APP, params: { launchType: "showPerson", id: pid }, title: "Contacts" },
                             undo: { kind: "db", ids: [cid, pid], what: say.undoWhat.contact(String(args.name)) } };
                });
            });
        });
    }
    case "contactInfo":
        return findPerson(env, args.who).then(function (p) {
            if (!p) return { text: say.noSuchContact(args.who) };
            var value = "";
            if (args.what === "email") value = emailOf(p) || "";
            else if (args.what === "birthday") value = p.birthday || "";
            else if (args.what === "address") {
                var a = (p.addresses || [])[0];
                value = a ? [a.streetAddress, a.locality, a.region, a.postalCode].filter(Boolean).join(", ") : "";
            } else value = numberOf(p, args.label) || "";
            return { text: say.contactInfo(personName(p), args.what || "phone", value),
                     open: { appId: CONTACTS_APP, params: { launchType: "showPerson", id: p._id }, title: "Contacts" } };
        });
    case "toggle": {
        var setting = args.setting, fn = TOGGLE_RUN[setting];
        if (!fn) return Promise.resolve({ text: say.failed("unknown setting " + setting) });
        var target = args.state === "toggle"
            ? TOGGLE_STATE[setting](env).then(function (on) { return !on; }) : Promise.resolve(args.state === "on");
        return target.then(function (on) {
            return fn(env, on).then(function () { return { text: setting === "dnd" ? say.dnd(on) : say.toggled(setting, on) }; });
        });
    }
    case "media":
        return lunaCall(env, "luna://org.webosphoenix.system/mediaKey", { key: args.action })
            .then(function () { return { text: say.media(args.action) }; });
    case "volume":
        return lunaCall(env, AUDIO + "master/getVolume", {}).then(function (r) {
            var st = r.volumeStatus || r, v = Number(st.volume) || 0;
            if (args.action === "status") return { text: say.volume(v, !!st.muted) };
            if (args.action === "mute" || args.action === "unmute")
                return lunaCall(env, AUDIO + "master/muteVolume", { mute: args.action === "mute" }).then(function () { return { text: say.muted(args.action === "mute") }; });
            var nv = args.action === "set" ? Number(args.level) : v + (args.action === "up" ? 10 : -10);
            nv = Math.max(0, Math.min(100, Math.round(nv)));
            return lunaCall(env, AUDIO + "master/setVolume", { volume: nv }).then(function () {
                return st.muted ? lunaCall(env, AUDIO + "master/muteVolume", { mute: false }) : null;
            }).then(function () { return { text: say.volume(nv, false) }; });
        });
    case "brightness":
        return lunaCall(env, "luna://com.palm.display/control/getProperty", { properties: ["maximumBrightness"] }).then(function (r) {
            var v = Number(r.maximumBrightness) || 50;
            var nv = args.action === "set" ? Number(args.level) : v + (args.action === "up" ? 20 : -20);
            nv = Math.max(1, Math.min(100, Math.round(nv)));
            return lunaCall(env, "luna://com.palm.display/control/setProperty", { maximumBrightness: nv }).then(function () { return { text: say.brightness(nv) }; });
        });
    case "screenshot":
        return lunaCall(env, "luna://com.palm.systemmanager/takeScreenShot", { file: "" }).then(function () {
            return { text: say.screenshot(), open: { appId: PHOTOS_APP, params: {}, title: "Photos" } };
        });
    case "lock":
        return lunaCall(env, "luna://com.palm.display/control/setState", { state: "off" }).then(function () { return { text: say.locked() }; });
    case "battery":
        return Promise.all([lunaCall(env, "luna://com.palm.power/com/palm/power/batteryStatusQuery", {}),
                            lunaCall(env, "luna://com.palm.power/com/palm/power/chargerStatusQuery", {}).catch(function () { return {}; })])
            .then(function (r) {
                return { text: say.battery(Math.round(r[0].percent_ui !== undefined ? r[0].percent_ui : r[0].percent), !!(r[1].Charging || r[1].Connected)),
                         open: { appId: SETTINGS_APP, params: { page: "battery" }, title: "Battery" } };
            });
    case "settings":
        return launch(env, SETTINGS_APP, { page: args.page }).then(function () { return { text: say.openingSettings(args.page) }; });
    case "open":
        return launch(env, args.appId, {}).then(function () { return { text: say.opening(args.title || args.appId) }; });
    case "navigate":
        return launch(env, MAPS_APP, { target: "mapto:" + args.destination })
            .then(function () { return { text: say.navigating(args.destination) }; });
    case "distance":
        return Promise.all([geocode(env, args.place), here(env)]).then(function (r) {
            var a = r[0], b = r[1], rad = Math.PI / 180;
            var x = Math.sin((a.lat - b.lat) * rad / 2), y = Math.sin((a.lon - b.lon) * rad / 2);
            var km = 2 * 6371 * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * y * y));
            return { text: say.distance(a.name || args.place, km, env.units === "imperial"),
                     open: { appId: MAPS_APP, params: { target: "mapto:" + args.place }, title: "Maps" } };
        }).catch(function (e) {
            if (e && e.said) return { text: e.said };
            throw e;
        });
    case "photos":
        return dbFind(env, "com.palm.media.image.file:1").then(function (all) {
            var hits = all.filter(function (p) {
                var t = Number(p.createdTime) || Number(p.modifiedTime) || 0;
                return args.from === undefined || args.from === null || (t >= args.from && t < args.to);
            }).sort(function (a, b) { return (Number(b.createdTime) || 0) - (Number(a.createdTime) || 0); });
            var params = hits.length ? { imageList: { results: hits.slice(0, 200).map(function (p) { return { file_path: p.path }; }) } } : {};
            if (!hits.length) return { text: say.photos(0, args.label), open: { appId: PHOTOS_APP, params: {}, title: "Photos" } };
            return launch(env, PHOTOS_APP, params).then(function () { return { text: say.photos(hits.length, args.label) }; });
        });
    case "play":
        return launch(env, "org.webosphoenix.music", { play: String(args.query || "") })
            .then(function () { return { text: say.playing(args.query) }; });
    case "weather":
        return weather(args, env);
    case "convert": {
        if (!args.currency) {
            var out = units.convert(args.value, args.from, args.to);
            if (out === null) return Promise.resolve({ text: say.notSameKind() });
            return Promise.resolve({ text: say.converted(units.round(Number(args.value)), args.from, units.round(out), args.to), data: { value: out } });
        }
        if (args.from === args.to) return Promise.resolve({ text: say.currency(args.value, args.from, args.value, args.to, "") });
        return getJson(env, "https://api.frankfurter.app/latest?amount=" + encodeURIComponent(args.value) + "&from=" + args.from + "&to=" + args.to)
            .then(function (r) {
                var v = r.rates && r.rates[args.to];
                if (typeof v !== "number") throw new Error("no rate");
                return { text: say.currency(units.round(Number(args.value)), args.from, v.toFixed(2), args.to, r.date || ""), data: { value: v } };
            }, function () { return { text: say.noRates(), offerWeb: true }; });
    }
    case "worldTime": {
        var zone = places.zoneOf(args.place);
        var named = zone ? Promise.resolve({ timezone: zone, name: args.place.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) })
            : geocode(env, args.place).catch(function (e) { return { error: e }; });
        return named.then(function (p) {
            if (p.error || !p.timezone) return { text: p.error && p.error.said ? p.error.said : say.noZone(args.place) };
            var fmt;
            try { fmt = new Intl.DateTimeFormat("en-US", { timeZone: p.timezone, hour: "numeric", minute: "2-digit", weekday: "long", hour12: true }); }
            catch (e) { return { text: say.noZone(args.place) }; }
            var parts = {};
            fmt.formatToParts(new Date(now)).forEach(function (x) { parts[x.type] = x.value; });
            // The hours between here and there.
            var there = new Date(new Date(now).toLocaleString("en-US", { timeZone: p.timezone })).getTime();
            var mine = new Date(new Date(now).toLocaleString("en-US")).getTime();
            var diff = Math.round((there - mine) / 36e5 * 2) / 2;
            var sameDay = new Date(there).getDate() === new Date(mine).getDate();
            var text = parts.hour + ":" + parts.minute + " " + parts.dayPeriod + (sameDay ? "" : " on " + parts.weekday);
            return { text: say.worldTime(p.name, text, diff) };
        });
    }
    case "calculate": {
        var v;
        try { v = arith.evaluate(args.expression); } catch (e) { return Promise.resolve({ text: say.failed(e.message) }); }
        return Promise.resolve({ text: say.answer(arith.pretty(args.expression), arith.format(v)), data: { value: v } });
    }
    case "time":
        return Promise.resolve({ text: args.what === "date" ? say.date(now) : say.time(now) });
    case "search":
        return defaultSearchUrl(env, args.query).then(function (url) {
            return lunaCall(env, "luna://com.palm.applicationManager/open", { target: url });
        }).then(function () { return { text: say.searching(args.query) }; });
    case "undo":
        return undo(args.undo, env).then(function () { return { text: say.undone() }; });
    default:
        if (cmd.appId) {
            var params = {};
            if (cmd.launchParam) params[cmd.launchParam] = String(args.text || "");
            return launch(env, cmd.url || cmd.appId, params).then(function () { return { text: cmd.title + (args.text ? ": " + args.text : "") + "." }; });
        }
        return Promise.resolve({ text: say.failed("unknown command") });
    }
}

function runningTimers(env) {
    var now = env.now();
    return env.storage.keys("assistant:timer:").map(function (k) {
        var t = env.storage.get(k);
        if (!t || t.ends <= now) { env.storage.remove(k); return null; }
        return t;
    }).filter(Boolean).sort(function (a, b) { return a.ends - b.ends; });
}

// Takes back what a command made (its result's undo).
function undo(u, env) {
    if (!u) return Promise.resolve();
    var cancel = function (names) {
        return Promise.all((names || []).map(function (n) { return lunaCall(env, AM + "cancel", { activityName: n }).catch(function () { return null; }); }));
    };
    if (u.kind === "timer") {
        (u.ids || []).forEach(function (id) { env.storage.remove("assistant:timer:" + id); });
        return cancel(u.ids);
    }
    if (u.kind === "alarm") return cancel(u.keys).then(function () { return lunaCall(env, DB + "del", { ids: u.ids }); });
    if (u.kind === "alarmOn") {
        return lunaCall(env, DB + "get", { ids: u.ids }).then(function (r) {
            return Promise.all((r.results || []).map(function (a) {
                return lunaCall(env, DB + "merge", { objects: [{ _id: a._id, enabled: true }] }).then(function () {
                    var at = nextRing(a, env.now());
                    return at ? scheduleAlarm(env, a, new Date(at)) : null;
                });
            }));
        });
    }
    return cancel(u.activities).then(function () { return lunaCall(env, DB + "del", { ids: u.ids || [] }); });
}

module.exports = {
    BUILT_IN: BUILT_IN,
    catalogue: catalogue,
    find: find,
    toolName: toolName,
    fromToolName: fromToolName,
    needsConfirm: needsConfirm,
    prepare: prepare,
    fromModel: fromModel,
    run: run,
    contactNames: contactNames,
    activityDate: activityDate,
    memoPosition: memoPosition
};
