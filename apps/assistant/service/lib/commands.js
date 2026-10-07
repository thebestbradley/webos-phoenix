// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the Phoenix Assistant can do: the commands the grammar recognises,
// which the on-device model (and a cloud model, when the user allows it)
// choose among as tools. Each does what Just Type's actions and the apps
// already do, with the same Luna calls:
//
//   call       Phone {number, dial: true} (apps/phone)
//   text       org.webosports.service.messaging putMessage, an SMS in the
//              outbox (@phoenix/luna messaging.sendSms); without words,
//              Messaging's compose {to, name}
//   timer      an activity (com.palm.activitymanager) whose callback opens
//              the Assistant app with {timerDone}; it rings there
//   alarm      the Clock's own alarm: a com.palm.clock.alarm:1 record and
//              the activity the Clock schedules for it (com.palm.app.clock
//              utility/alarmdbmanager.js:91-104, utility/activitymanager.js:58-82)
//   reminder   a task in Tasks (com.palm.task:1) with its reminder activity
//              (@phoenix/luna tasks.save / scheduleReminder)
//   toggle     Wi-Fi (com.webos.service.wifi setstate), Bluetooth
//              (bluetooth2 adapter/setState), airplane mode
//              (connectionmanager setstate offlineMode), the flashlight
//              (org.webosports.service.torch set), the ringer (the ringtone
//              stream's volume to 0 and back: a phone with no ringer switch)
//   open       applicationManager launch
//   navigate   Maps {target: "mapto:<place>"} (webOS's "directions to")
//   play       Music {play: query}
//   weather    Open-Meteo (the Weather app's server) for a named place or
//              where the device is (com.webos.service.location)
//   calculate  lib/arith.js
//   time       the clock
//   search     the browser, with Just Type's default engine
//   app:<key>  a command an app declared (lib/grammar.js), launched with
//              {<launchParam>: text}
//
// Each command: {id, title, description, parameters (JSON Schema, for the
// models' tool calling), risk}. risk "send", "delete" and "call" are read
// back and confirmed before they run, whichever layer chose them.
//
//   prepare(command, args, env) -> {args, confirm?, reply?}
//       resolves contacts and apps; reply: it cannot run (said why);
//       confirm: what to ask before running
//   run(command, args, env) -> {text}

"use strict";

var arith = require("./arith");

var CLOCK_APP = "com.palm.app.clock";
var ASSISTANT_APP = "org.webosphoenix.assistant";
var AM = "luna://com.palm.activitymanager/";
var DB = "luna://com.palm.db/";

var BUILT_IN = [
    { id: "call", title: "Phone calls", risk: "call", description: "Phone a contact or a number.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Contact name" }, number: { type: "string", description: "Phone number, if no contact" }, label: { type: "string", enum: ["", "mobile", "home", "work"] } } } },
    { id: "text", title: "Text messages", risk: "send", description: "Send a text message (SMS) to a contact.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Contact name or number" }, message: { type: "string", description: "The words to send" } }, required: ["who"] } },
    { id: "timer", title: "Timers", risk: "change", description: "Start a countdown timer.",
      parameters: { type: "object", properties: { seconds: { type: "integer", minimum: 1, description: "How long, in seconds" }, label: { type: "string" } }, required: ["seconds"] } },
    { id: "alarm", title: "Alarms", risk: "change", description: "Set an alarm in the Clock app.",
      parameters: { type: "object", properties: { time: { type: "string", description: "When, as said: \"7:30 am\", \"tomorrow at 6\", or ISO 8601 local time" }, label: { type: "string" } }, required: ["time"] } },
    { id: "reminder", title: "Reminders", risk: "change", description: "Add a task to Tasks, with a reminder when a time is given.",
      parameters: { type: "object", properties: { text: { type: "string", description: "What to remind about" }, due: { type: "string", description: "When, as said (\"at 5 pm\", \"in 20 minutes\", \"tomorrow\") or ISO 8601; omit for none" } }, required: ["text"] } },
    { id: "toggle", title: "Wi-Fi, Bluetooth, airplane mode, flashlight, ringer", risk: "change", description: "Turn a device setting on or off.",
      parameters: { type: "object", properties: { setting: { type: "string", enum: ["wifi", "bluetooth", "airplane", "flashlight", "ringer"] }, state: { type: "string", enum: ["on", "off", "toggle"] } }, required: ["setting", "state"] } },
    { id: "open", title: "Opening apps", risk: "open", description: "Open an app by its name.",
      parameters: { type: "object", properties: { name: { type: "string", description: "The app's name, e.g. Maps" } }, required: ["name"] } },
    { id: "navigate", title: "Directions", risk: "open", description: "Get directions to a place in Maps.",
      parameters: { type: "object", properties: { destination: { type: "string" } }, required: ["destination"] } },
    { id: "play", title: "Music", risk: "open", description: "Play music: an artist, album or song (empty for everything).",
      parameters: { type: "object", properties: { query: { type: "string" } } } },
    { id: "weather", title: "Weather", risk: "read", description: "Tell the weather now or tomorrow, here or in a named place.",
      parameters: { type: "object", properties: { place: { type: "string", description: "City; empty for here" }, day: { type: "string", enum: ["", "today", "tomorrow"] } } } },
    { id: "calculate", title: "Arithmetic", risk: "read", description: "Work out a sum: + - * / ^ ( ) % sqrt.",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
    { id: "time", title: "Time and date", risk: "read", description: "Tell the time or the date.",
      parameters: { type: "object", properties: { what: { type: "string", enum: ["time", "date"] } } } },
    { id: "search", title: "Web search", risk: "open", description: "Search the web in the browser.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }
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
function pad(n) { return (n < 10 ? "0" : "") + n; }
// The activity manager's schedule format (UTC), as @phoenix/luna tasks writes it.
function activityDate(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " +
        pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "Z";
}
function personName(p) {
    var n = [p.name && p.name.givenName, p.name && p.name.familyName].filter(Boolean).join(" ").trim();
    return n || p.nickname || (p.organization && p.organization.name) || "";
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

// Arguments a model wrote, as the commands take them: times as said ("at 5
// pm", "tomorrow at 7") or ISO 8601 become ms; numbers as numbers.
function fromModel(cmd, args, env) {
    var a = Object.assign({}, args || {});
    function moment(v, opts) {
        if (typeof v === "number") return v;
        var s = String(v || "").trim();
        if (!s) return null;
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { var d = Date.parse(s); return isNaN(d) ? null : d; }
        var w = env.lang.when(s, env.now(), opts);
        if (w === null) w = env.lang.when("at " + s, env.now(), opts);
        return w;
    }
    if (cmd.id === "timer") {
        if (typeof a.seconds === "string") a.seconds = env.lang.duration(a.seconds) || Number(a.seconds);
        a.seconds = Math.round(Number(a.seconds));
    }
    if (cmd.id === "alarm") a.time = moment(a.time, { preferAm: false });
    if (cmd.id === "reminder") a.due = moment(a.due);
    return a;
}

// ---- Prepare: resolve, decide whether to ask ----------------------------------------------------

function prepare(cmd, args, env) {
    var say = env.lang.say;
    args = Object.assign({}, args || {});
    if (cmd.id === "call" || cmd.id === "text") {
        var who = String(args.who || "").trim();
        var raw = args.number || (/^[+\d][\d\s().-]{2,}$/.test(who) ? who : "");
        if (raw) {
            args.number = String(raw).replace(/[^\d+]/g, "");
            args.name = who && !/^[+\d]/.test(who) ? who : "";
            return Promise.resolve(withConfirm(cmd, args, env));
        }
        if (!who) return Promise.resolve({ args: args, reply: say.noSuchContact("that person") });
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
    if (cmd.id === "timer" && !(args.seconds > 0)) return Promise.resolve({ args: args, reply: say.failed("how long?") });
    if (cmd.id === "alarm" && !(args.time > env.now())) return Promise.resolve({ args: args, reply: say.failed("that time has passed") });
    if (cmd.id === "reminder" && !String(args.text || "").trim()) return Promise.resolve({ args: args, reply: say.failed("remind you of what?") });
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
    return { args: args, confirm: cmd.title + (args.text ? ": \"" + args.text + "\"" : "") + "?" };
}

// ---- Run -----------------------------------------------------------------------------------------

var TOGGLE_RUN = {
    wifi: function (env, on) { return lunaCall(env, "luna://com.webos.service.wifi/setstate", { state: on ? "enabled" : "disabled" }); },
    bluetooth: function (env, on) { return lunaCall(env, "luna://com.webos.service.bluetooth2/adapter/setState", { powered: on }); },
    airplane: function (env, on) { return lunaCall(env, "luna://com.webos.service.connectionmanager/setstate", { offlineMode: on ? "enabled" : "disabled" }); },
    flashlight: function (env, on) { return lunaCall(env, "luna://org.webosports.service.torch/set", { on: on }); },
    ringer: function (env, on) {
        var AUDIO = "luna://com.webos.service.audio/";
        if (!on) {
            return lunaCall(env, AUDIO + "getInputVolume", { streamType: "pringtones" }).then(function (r) {
                if (r.volume > 0) env.storage.set("assistant:ringerVolume", r.volume);
                return lunaCall(env, AUDIO + "setInputVolume", { streamType: "pringtones", volume: 0 });
            });
        }
        var v = env.storage.get("assistant:ringerVolume") || 70;
        return lunaCall(env, AUDIO + "setInputVolume", { streamType: "pringtones", volume: v });
    }
};
var TOGGLE_STATE = {
    wifi: function (env) { return lunaCall(env, "luna://com.webos.service.wifi/getstatus", {}).then(function (r) { return r.status !== "serviceDisabled" && r.wifiState !== "disabled"; }); },
    bluetooth: function (env) { return lunaCall(env, "luna://com.webos.service.bluetooth2/adapter/getStatus", {}).then(function (r) { return !!(r.adapters && r.adapters[0] && r.adapters[0].powered); }); },
    airplane: function (env) { return lunaCall(env, "luna://com.webos.service.connectionmanager/getstatus", {}).then(function (r) { return r.offlineMode === "enabled"; }); },
    flashlight: function (env) { return lunaCall(env, "luna://org.webosports.service.torch/getStatus", {}).then(function (r) { return !!r.on; }); },
    ringer: function (env) { return lunaCall(env, "luna://com.webos.service.audio/getInputVolume", { streamType: "pringtones" }).then(function (r) { return r.volume > 0; }); }
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

function weather(args, env) {
    var say = env.lang.say;
    var imperial = env.units === "imperial";
    var where = args.place
        ? getJson(env, "https://geocoding-api.open-meteo.com/v1/search?count=1&language=" + env.lang.id + "&name=" + encodeURIComponent(args.place))
            .then(function (g) {
                var p = g.results && g.results[0];
                if (!p) throw Object.assign(new Error("no place"), { said: say.noPlace(args.place) });
                return { lat: p.latitude, lon: p.longitude, name: p.name };
            })
        : lunaCall(env, "luna://com.webos.service.location/getCurrentPosition", { responseTime: 2, maximumAge: 600 })
            .then(function (r) {
                if (typeof r.latitude !== "number" || (r.errorCode && r.errorCode !== 0)) throw new Error("no fix");
                return { lat: r.latitude, lon: r.longitude, name: "" };
            }, function () { throw Object.assign(new Error("no location"), { said: say.noLocation() }); });
    return where.then(function (pl) {
        var url = "https://api.open-meteo.com/v1/forecast?latitude=" + pl.lat + "&longitude=" + pl.lon +
            "&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=auto" +
            (imperial ? "&temperature_unit=fahrenheit" : "");
        return getJson(env, url).then(function (f) {
            var unit = imperial ? "F" : "C";
            var i = args.day === "tomorrow" ? 1 : 0, daily = f.daily || {};
            var hi = daily.temperature_2m_max ? daily.temperature_2m_max[i] : null, lo = daily.temperature_2m_min ? daily.temperature_2m_min[i] : null;
            var code = i === 1 ? (daily.weather_code || [])[1] : f.current && f.current.weather_code;
            return { text: say.weather(pl.name, f.current ? f.current.temperature_2m : hi, unit, WMO[code] || "", args.day, hi, lo) };
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

function run(cmd, args, env) {
    var say = env.lang.say, now = env.now();
    switch (cmd.id) {
    case "call":
        return launch(env, "org.webosphoenix.phone", { number: args.number, dial: true })
            .then(function () { return { text: say.calling(args.name || args.number) }; });
    case "text":
        if (!String(args.message || "").trim())
            return launch(env, "org.webosphoenix.messaging", { to: args.number, name: args.name || "" })
                .then(function () { return { text: say.composing(args.name || args.number) }; });
        return lunaCall(env, "luna://org.webosports.service.messaging/putMessage", { message: {
            _kind: "com.palm.smsmessage:1", folder: "outbox", status: "pending", serviceName: "sms",
            messageText: String(args.message), to: [{ addr: args.number, name: args.name || "" }],
            localTimestamp: now, timestamp: now, flags: { visible: true, read: true } } })
            .then(function () { return { text: say.sent(args.name || args.number) }; });
    case "timer": {
        var id = "assistant.timer." + now.toString(36);
        var label = String(args.label || "");
        return lunaCall(env, AM + "create", { start: true, replace: true, activity: {
            name: id, description: "Assistant timer" + (label ? ": " + label : ""),
            type: { foreground: true, persist: true },
            schedule: { start: activityDate(now + args.seconds * 1000) },
            callback: { method: "palm://com.palm.applicationManager/launch",
                        params: { id: ASSISTANT_APP, params: { timerDone: { id: id, label: label, seconds: args.seconds } } } } } })
            .then(function () { return { text: say.timerSet(args.seconds, label), data: { timer: id, ends: now + args.seconds * 1000 } }; });
    }
    case "alarm": {
        // As the Clock makes one (alarmdbmanager.js objBlankAlarm, createBlankAlarm).
        var at = new Date(args.time), key = "clockAlarm" + now;
        var h = at.getHours(), m = at.getMinutes();
        var record = { _kind: "com.palm.clock.alarm:1", key: key, title: String(args.label || "Alarm"), occurs: "once",
            hour: h, minute: m, timezoneOffset: -at.getTimezoneOffset() / 60,
            niceTime: (h % 12 || 12) + ":" + pad(m) + " " + (h < 12 ? "AM" : "PM"), niceDay: "--", enabled: true,
            alarmSoundFile: "/usr/palm/sounds/alert.wav", alarmSoundTitle: "Alert", snoozed: false, hideSnoozeTime: false };
        return lunaCall(env, DB + "put", { objects: [record] }).then(function () {
            // activitymanager.js setAlarmTimeout: "local" start, ring on launch.
            var local = at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate()) + " " + pad(h) + ":" + pad(m) + ":00";
            return lunaCall(env, AM + "create", { start: true, replace: true, activity: {
                name: key, description: "com.palm.app.clock alarm: " + record.title, type: { foreground: true, persist: true },
                callback: { method: "palm://com.palm.applicationManager/launch",
                            params: { id: CLOCK_APP, params: { action: "ring", key: key, setTime: local } } },
                schedule: { start: local, local: true } } });
        }).then(function () { return { text: say.alarmSet(args.time, now, args.label) }; });
    }
    case "reminder":
        return lunaCall(env, DB + "find", { query: { from: "com.palm.tasklist:1" } }).then(function (r) {
            var inbox = (r.results || []).filter(function (l) { return l.isDefault; })[0];
            if (inbox) return inbox._id;
            return lunaCall(env, DB + "put", { objects: [{ _kind: "com.palm.tasklist:1", name: "Inbox", accountId: "", sortOrder: 0, isDefault: true }] })
                .then(function (p) { return p.results[0].id; });
        }).then(function (listId) {
            var due = args.due > now ? args.due : null;
            var task = { _kind: "com.palm.task:1", summary: String(args.text).trim(), due: due, allDay: false, completed: false,
                completedTime: null, priority: 0, listId: listId, accountId: "", remind: due,
                uid: now.toString(36) + "-assistant@webosphoenix", createdTime: now, modifiedTime: now };
            return lunaCall(env, DB + "put", { objects: [task] }).then(function (p) {
                var taskId = p.results[0].id;
                if (!due) return null;
                return lunaCall(env, AM + "create", { start: true, replace: true, activity: {
                    name: "org.webosphoenix.tasks.remind." + taskId, description: "Tasks reminder",
                    type: { foreground: true, persist: true }, schedule: { start: activityDate(due) },
                    callback: { method: "palm://com.palm.applicationManager/launch",
                                params: { id: "org.webosphoenix.tasks", params: { reminder: taskId } } } } });
            }).then(function () { return { text: say.reminderSet(task.summary, due, now) }; });
        });
    case "toggle": {
        var setting = args.setting, fn = TOGGLE_RUN[setting];
        if (!fn) return Promise.resolve({ text: say.failed("unknown setting " + setting) });
        var target = args.state === "toggle"
            ? TOGGLE_STATE[setting](env).then(function (on) { return !on; }) : Promise.resolve(args.state === "on");
        return target.then(function (on) {
            return fn(env, on).then(function () { return { text: say.toggled(setting, on) }; });
        });
    }
    case "open":
        return launch(env, args.appId, {}).then(function () { return { text: say.opening(args.title || args.appId) }; });
    case "navigate":
        return launch(env, "org.webosphoenix.maps", { target: "mapto:" + args.destination })
            .then(function () { return { text: say.navigating(args.destination) }; });
    case "play":
        return launch(env, "org.webosphoenix.music", { play: String(args.query || "") })
            .then(function () { return { text: say.playing(args.query) }; });
    case "weather":
        return weather(args, env);
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
    default:
        if (cmd.appId) {
            var params = {};
            if (cmd.launchParam) params[cmd.launchParam] = String(args.text || "");
            return launch(env, cmd.url || cmd.appId, params).then(function () { return { text: cmd.title + (args.text ? ": " + args.text : "") + "." }; });
        }
        return Promise.resolve({ text: say.failed("unknown command") });
    }
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
    activityDate: activityDate
};
