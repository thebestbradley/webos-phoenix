// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Places (docs/AI-AND-MCP.md, "Everyday features"):
//
//   parking        "remember where I parked" (here and now, with a note:
//                  "I parked on level 3"), "forget where I parked"
//   findParking    "where did I park": how far and which way from here, when
//                  it was, the note; Maps on the spot, Directions on foot
//   placeReminder  "remind me to buy milk when I get home", "when I leave
//                  work remind me to call Sam": a task in Tasks, its
//                  reminder when the device gets to (or leaves) the place
//   setPlace       "this is my home", "set my work location to here"
//
// Home and work are the user's saved places in Maps called "Home" and
// "Work" (org.webosphoenix.maps.place:1, which Maps lists, renames and
// removes); "this is my home" saves one, as Settings > Assistant > Home &
// Work does. A place reminder may also name any other saved place ("when I
// get to the gym"), or "here".
//
// A place reminder is a geofence. OSE's location service has none
// (com.webos.service.location's methods: getLocationUpdates and the rest),
// so it is the activity manager's: an activity whose trigger is
// getLocationUpdates (every minute at most, or 50 m moved) with db8 where
// clauses on the reply's latitude and longitude: inside a box about the
// place (arriving: 150 m each way), or, with {or: [...]}, outside a wider
// one (leaving: 250 m, so a fix at the edge does not come and go). Its
// callback is the service's placeWake, with the fix as $activity.trigger
// (as com.palm.service.contacts reads its trigger: contactsService.js
// 347-352); it restarts the activity with the next trigger
// (contactsService.js 433-465) or, at the end, has Tasks post the reminder
// as it does a timed one ({reminder: taskId}: its notification, with the
// task's note, "When you get home"). Made at the place itself, "when I get
// home" first waits to leave it (and "when I leave work", said away from
// work, first to get there). The device does the watching, so nothing of
// the assistant runs until a fix matches. In the simulator, the simulated
// location (Simulate > Location, or __phoenixRuntime.location.set) moves
// the device, and its activity manager has the same triggers.
//
// The service's methods (service() below):
//   places {}                     -> {home, work}: {name, detail, lat, lon} | null (Settings)
//   setPlace {place, clear?}      home or work: here, or cleared (Settings)
//   placeWake {id, $activity}     the activity manager, the trigger matched

"use strict";

var nearby = require("./nearby");

var PARKING_KEY = "assistant:parking";
var REMINDERS_KEY = "assistant:placeReminders";
var PLACE_KIND = "org.webosphoenix.maps.place:1";
var MAPS_APP = "org.webosphoenix.maps";
var TASKS_APP = "org.webosphoenix.tasks";
var DB = "luna://com.palm.db/";
var AM = "luna://com.palm.activitymanager/";
var LOCATION = "luna://com.webos.service.location/";
var WAKE = "luna://org.webosphoenix.assistant/placeWake";
var ARRIVE_M = 150, LEAVE_M = 250;
// Not more than a fix a minute, or one 50 m on (OSE getLocationUpdates).
var WATCH = { subscribe: true, minimumInterval: 60000, minimumDistance: 50 };
var RETRY_MS = 15 * 60000;   // no fix (location off): try again then

var COMMANDS = [
    { id: "parking", title: "Remembering where you parked", risk: "change",
      description: "Remember where the user parked (where the device is now), with a note if they give one (\"level 3\"), or forget it.",
      parameters: { type: "object", properties: {
          action: { type: "string", enum: ["save", "forget"] },
          note: { type: "string", description: "What they said about the spot, \"level 3, row F\"" } }, required: ["action"] },
      examples: ["mark where my car is", "save my parking spot", "I left the car here", "I've got my car back, forget the spot"] },
    { id: "findParking", title: "Finding your car", risk: "read",
      description: "Tell where the user parked (saved earlier): how far and which way from here and when, with directions in Maps.",
      parameters: { type: "object", properties: { directions: { type: "boolean", description: "They want the way there" } } },
      examples: ["where's the car", "help me find my car", "how far away is my car", "take me back to the car"] },
    { id: "placeReminder", title: "Reminders at a place", risk: "change",
      description: "Remind the user of something when they get to or leave a place: home, work, here, or a place saved in Maps.",
      parameters: { type: "object", properties: {
          text: { type: "string", description: "What to remind about" },
          place: { type: "string", description: "\"home\", \"work\", \"here\", or the name of a place saved in Maps" },
          when: { type: "string", enum: ["arrive", "leave"] } }, required: ["text", "place", "when"] },
      examples: ["once I'm back home remind me to water the plants", "nudge me to grab my badge as I head out of work"] },
    { id: "setPlace", title: "Home and work", risk: "change",
      description: "Save where the user is now as their home or their work.",
      parameters: { type: "object", properties: { place: { type: "string", enum: ["home", "work"] } }, required: ["place"] },
      examples: ["I live here", "save this spot as my office", "this is where I work"] }
];

function fold(s) { return String(s || "").toLowerCase().replace(/^(?:the|my) /, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim(); }
function newId(now) { return "p" + now.toString(36) + Math.random().toString(36).slice(2, 6); }

// ---- The fence: boxes in degrees about a place, and the triggers on them ----
function box(q, m) {
    var dLat = m / 111320, dLon = m / (111320 * Math.max(0.01, Math.cos(q.lat * Math.PI / 180)));
    return { s: q.lat - dLat, n: q.lat + dLat, w: q.lon - dLon, e: q.lon + dLon };
}
function within(p, q, m) {
    var b = box(q, m);
    return p.lat >= b.s && p.lat <= b.n && p.lon >= b.w && p.lon <= b.e;
}
function rounded(v) { return Math.round(v * 1e6) / 1e6; }
// Inside the arriving box: each where clause of the array must match.
function enterTrigger(q) {
    var b = box(q, ARRIVE_M);
    return { method: LOCATION + "getLocationUpdates", params: WATCH,
             where: [{ prop: "latitude", op: ">=", val: rounded(b.s) }, { prop: "latitude", op: "<=", val: rounded(b.n) },
                     { prop: "longitude", op: ">=", val: rounded(b.w) }, { prop: "longitude", op: "<=", val: rounded(b.e) }] };
}
// Outside the leaving box: any side.
function exitTrigger(q) {
    var b = box(q, LEAVE_M);
    var side = function (prop, op, val) { return { method: LOCATION + "getLocationUpdates", params: WATCH, where: { prop: prop, op: op, val: rounded(val) } }; };
    return { or: [side("latitude", "<", b.s), side("latitude", ">", b.n), side("longitude", "<", b.w), side("longitude", ">", b.e)] };
}
// What a reminder waits for: "arrive" (to be in), "leave" (to be out), or
// first the other way ("away": out before in; "reach": in before out).
function triggerFor(r) { return r.phase === "arrive" || r.phase === "reach" ? enterTrigger(r) : exitTrigger(r); }
function activityName(r) { return "assistant.place." + r.id; }

// Compass point from a to b.
function bearing(a, b) {
    var toR = Math.PI / 180;
    var y = Math.sin((b.lon - a.lon) * toR) * Math.cos(b.lat * toR);
    var x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lon - a.lon) * toR);
    var deg = (Math.atan2(y, x) / toR + 360) % 360;
    return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(deg / 45) % 8];
}

module.exports = function (h) {
    function reminders(env) { var l = env.storage.get(REMINDERS_KEY); return Array.isArray(l) ? l : []; }
    function saveReminders(env, l) { env.storage.set(REMINDERS_KEY, l); }
    function call(env, uri, p) { return h.lunaCall(env, uri, p).catch(function () { return null; }); }

    // A name for the spot: the location service's address, when it has one
    // (the simulator's nearest city; OSE answers with a geocoder's reply).
    function addressOf(env, p) {
        return call(env, LOCATION + "getReverseLocation", { latitude: p.lat, longitude: p.lon }).then(function (r) {
            if (!r || r.returnValue === false) return "";
            if (r.address) return String(r.address);
            var g = r.response && r.response.results && r.response.results[0];
            return g && g.formatted_address ? String(g.formatted_address) : "";
        });
    }

    // ---- Saved places: home, work, others (Maps') ----
    function savedPlaces(env) { return h.dbFind(env, PLACE_KIND).catch(function () { return []; }); }
    function placeNamed(list, name) {
        var n = fold(name);
        var hits = list.filter(function (p) { return fold(p.name) === n; });
        return hits.sort(function (a, b) { return (b.created || 0) - (a.created || 0); })[0] || null;
    }
    function placeLabel(place) { return place === "home" ? "Home" : place === "work" ? "Work" : place; }
    function savePlace(env, place, at, detail) {
        return savedPlaces(env).then(function (list) {
            var name = placeLabel(place), old = placeNamed(list, name), now = env.now();
            var fields = { name: name, detail: detail, lat: at.lat, lon: at.lon, searchText: (name + " " + detail).toLowerCase() };
            if (old) return h.lunaCall(env, DB + "merge", { objects: [Object.assign({ _id: old._id }, fields)] }).then(function () { return { id: old._id, before: old }; });
            return h.lunaCall(env, DB + "put", { objects: [Object.assign({ _kind: PLACE_KIND, created: now }, fields)] })
                .then(function (r) { return { id: r.results && r.results[0] && r.results[0].id }; });
        });
    }

    // ---- Parking ----
    function park(args, env) {
        var say = env.lang.say;
        if (args.action === "forget") {
            var had = env.storage.get(PARKING_KEY);
            env.storage.remove(PARKING_KEY);
            return Promise.resolve({ text: had ? say.parkingForgotten() : say.noParking() });
        }
        return h.here(env, "parking").then(function (me) {
            return addressOf(env, me).then(function (where) {
                var spot = { lat: me.lat, lon: me.lon, at: env.now(), note: String(args.note || "").trim(), address: where };
                env.storage.set(PARKING_KEY, spot);
                return { text: say.parked(spot.note, where), data: { parking: spot },
                         open: { appId: MAPS_APP, params: { place: carPlace(env, spot) }, title: "Maps" } };
            });
        }).catch(function (e) {
            if (e && e.location) return h.blockedReply(e, { command: "parking", args: args });
            throw e;
        });
    }
    function carPlace(env, spot) {
        return { id: "parked-car", name: env.lang.say.yourCar(), lat: spot.lat, lon: spot.lon, detail: spot.note || spot.address || "", category: "parking" };
    }
    function findCar(args, env) {
        var say = env.lang.say, spot = env.storage.get(PARKING_KEY);
        if (!spot) return Promise.resolve({ text: say.noParking() });
        var car = carPlace(env, spot);
        var walk = { appId: MAPS_APP, params: { destination: car, travelMode: "walk", navigate: !!args.directions }, title: "Maps" };
        // Where the device is now, if it can be had (no question asked about it here: the spot is told either way).
        return h.here(env, "parking").then(function (me) { return me; }, function () { return null; }).then(function (me) {
            var m = me ? nearby.meters(me, spot) : -1;
            var text = say.parkedAt(spot, m, me && m >= 0 ? bearing(me, spot) : "", env.now(), env.units === "imperial");
            var shown = args.directions ? walk : { appId: MAPS_APP, params: { place: car }, title: "Maps" };
            // Maps behind the answer, on the car or the way there (as directions do).
            return h.launch(env, MAPS_APP, shown.params).catch(function () { return null; }).then(function () {
                return { text: text, open: shown, actions: args.directions ? undefined : [{ label: say.walkThere(), open: walk }],
                         data: { parking: spot, meters: m >= 0 ? Math.round(m) : undefined } };
            });
        });
    }

    // ---- Home and work ----
    function setPlace(args, env) {
        var say = env.lang.say, place = args.place === "work" ? "work" : "home";
        // "Set my home address to 12 Main Street": Maps finds an address
        // and saves it (named "Home"); here, only where the device is.
        if (String(args.address || "").trim()) {
            var query = { query: String(args.address).trim() };
            return h.launch(env, MAPS_APP, query).catch(function () { return null; }).then(function () {
                return { text: say.placeByAddress(place), open: { appId: MAPS_APP, params: query, title: "Maps" } };
            });
        }
        // From Settings (explicit: "Set to Where I Am Now" tapped), that tap is
        // the asking: the location is read without the Assistant's own
        // question (the location service still asks for the Assistant if it
        // must, and "off" and "not allowed" stand).
        var at = h.here(env, "home").catch(function (e) {
            if (!args.explicit || !e || e.location !== "ask") throw e;
            return h.lunaCall(env, LOCATION + "getLocationUpdates", {}).then(function (r) {
                if (r && r.returnValue !== false && typeof r.latitude === "number") return { lat: r.latitude, lon: r.longitude };
                throw e;
            });
        });
        return at.then(function (me) {
            return addressOf(env, me).then(function (where) {
                return savePlace(env, place, me, where).then(function (saved) {
                    var out = { text: say.placeSaved(place, where, !!saved.before), data: { placeId: saved.id } };
                    if (saved.before)
                        out.undo = { kind: "merge", objects: [{ _id: saved.id, lat: saved.before.lat, lon: saved.before.lon, detail: saved.before.detail || "",
                                                                searchText: saved.before.searchText || "" }], what: say.undoPlace(place, true) };
                    else if (saved.id) out.undo = { kind: "db", ids: [saved.id], what: say.undoPlace(place, false) };
                    return out;
                });
            });
        }).catch(function (e) {
            if (e && e.location) return h.blockedReply(e, { command: "setPlace", args: args });
            throw e;
        });
    }

    // ---- Reminders at a place ----
    function placeOf(args, env) {
        var p = fold(args.place);
        if (p === "here" || p === "this place" || p === "back here") return Promise.resolve({ kind: "here" });
        var key = /^(?:home|my house|house|my place|place)$/.test(p) ? "home" : /^(?:work|office|the office|my office|my work|job)$/.test(p) ? "work" : "";
        return savedPlaces(env).then(function (list) {
            var hit = placeNamed(list, key ? placeLabel(key) : p);
            return { kind: key || "named", saved: hit, name: key ? "" : (hit ? hit.name : String(args.place || "").trim()) };
        });
    }
    function placeReminder(args, env) {
        var say = env.lang.say, when = args.when === "leave" ? "leave" : "arrive", text = String(args.text || "").trim();
        if (!text) return Promise.resolve({ text: say.failed("remind you of what?"), failed: true });
        return placeOf(args, env).then(function (pl) {
            if (pl.kind !== "here" && !pl.saved) {
                // A place Maps does not have: the task all the same (its note
                // says where), and how to have the reminder there.
                if (pl.kind === "named")
                    return h.addTask(env, text, "", null, false).then(function (t) {
                        return h.lunaCall(env, DB + "merge", { objects: [{ _id: t.taskId, notes: say.placeNote(when, pl.name) }] }).then(function () {
                            return { text: say.unknownPlace(t.task.summary, pl.name), open: { appId: TASKS_APP, params: { taskId: t.taskId }, title: "Tasks" },
                                     data: { taskId: t.taskId }, undo: { kind: "db", ids: [t.taskId], what: say.undoWhat.task(t.task.summary) } };
                        });
                    });
                // Home or work not known yet: where the user is now, or Settings.
                return { text: say.noHomeYet(pl.kind),
                         actions: [{ label: say.setPlaceHere(pl.kind), answer: "yes", run: { command: "setPlace", args: { place: pl.kind }, then: { command: "placeReminder", args: args } } },
                                   { label: say.homeWorkSettings(), open: { appId: "org.webosphoenix.settings", params: { page: "assistant", section: "places" }, title: "Settings" } }] };
            }
            return h.here(env, "placeReminder").then(function (me) {
                var at = pl.kind === "here" ? me : { lat: pl.saved.lat, lon: pl.saved.lon };
                var inside = within(me, at, ARRIVE_M);
                var phase = when === "arrive" ? (inside ? "away" : "arrive") : (inside || within(me, at, LEAVE_M) ? "leave" : "reach");
                var label = pl.kind === "here" ? "here" : pl.kind === "named" ? pl.name : pl.kind;
                var note = say.placeNote(when, label);
                return h.addTask(env, text, "", null, false).then(function (t) {
                    return h.lunaCall(env, DB + "merge", { objects: [{ _id: t.taskId, notes: note }] }).then(function () {
                        var r = { id: newId(env.now()), text: t.task.summary, taskId: t.taskId, when: when, place: label, lat: at.lat, lon: at.lon, phase: phase, at: env.now() };
                        saveReminders(env, reminders(env).filter(function (x) { return x.taskId !== t.taskId; }).concat([r]));
                        return arm(env, r).then(function () {
                            return { text: say.placeReminderSet(t.task.summary, when, label), data: { taskId: t.taskId, reminder: r.id },
                                     open: { appId: TASKS_APP, params: { taskId: t.taskId }, title: "Tasks" },
                                     undo: { kind: "db", ids: [t.taskId], activities: [activityName(r)], what: say.undoWhat.task(t.task.summary) } };
                        });
                    });
                });
            });
        }).catch(function (e) {
            if (e && e.location) return h.blockedReply(e, { command: "placeReminder", args: args });
            throw e;
        });
    }
    function arm(env, r) {
        return h.lunaCall(env, AM + "create", { start: true, replace: true, activity: {
            name: activityName(r), description: "Assistant reminder: " + r.text,
            type: { foreground: true, persist: true },
            trigger: triggerFor(r),
            callback: { method: WAKE, params: { id: r.id } } } });
    }
    function restart(env, r, later) {
        var p = { activityName: activityName(r), restart: true, trigger: triggerFor(r), callback: { method: WAKE, params: { id: r.id } } };
        if (later) p.schedule = { start: h.activityDate(env.now() + RETRY_MS) };
        return call(env, AM + "complete", p);
    }

    // s: assistant.js's {privileged(), env(), ...} (commands-routines.js).
    function service(s) {
        function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
        function fail(text) { return { returnValue: false, errorCode: -1, errorText: text }; }
        function shown(p) { return p ? { id: p._id, name: p.name, detail: p.detail || "", lat: p.lat, lon: p.lon } : null; }
        return {
            places: function () {
                var e = s.env();
                return savedPlaces(e).then(function (list) {
                    return ok({ home: shown(placeNamed(list, "Home")), work: shown(placeNamed(list, "Work")) });
                });
            },
            setPlace: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                if (p.place !== "home" && p.place !== "work") return Promise.resolve(fail("place: home or work"));
                var e = s.env();
                if (p.clear) {
                    return savedPlaces(e).then(function (list) {
                        var old = placeNamed(list, placeLabel(p.place));
                        return (old ? h.lunaCall(e, DB + "del", { ids: [old._id] }) : Promise.resolve()).then(function () { return ok(); });
                    });
                }
                return setPlace({ place: p.place, explicit: true }, e).then(function (out) {
                    if (out.failed || !out.data) return fail(out.text);
                    return ok({ text: out.text });
                }, function (err) { return fail(String(err && err.message || err)); });
            },
            // The activity manager: a reminder's trigger matched (or failed).
            placeWake: function (p) {
                var e = s.env(), list = reminders(e), r = list.filter(function (x) { return x.id === p.id; })[0];
                var fix = p.$activity && p.$activity.trigger;
                if (!r) return call(e, AM + "complete", { activityName: "assistant.place." + p.id }).then(function () { return ok({ fired: false }); });
                if (!fix || fix.returnValue === false || typeof fix.latitude !== "number")
                    return restart(e, r, true).then(function () { return ok({ fired: false, retry: true }); });
                var me = { lat: fix.latitude, lon: fix.longitude };
                var save = function () { saveReminders(e, list.map(function (x) { return x.id === r.id ? r : x; })); };
                if (r.phase === "away" || r.phase === "reach") {
                    var moved = r.phase === "away" ? !within(me, r, LEAVE_M) : within(me, r, ARRIVE_M);
                    if (moved) { r.phase = r.phase === "away" ? "arrive" : "leave"; save(); }
                    return restart(e, r).then(function () { return ok({ fired: false, phase: r.phase }); });
                }
                var due = r.phase === "arrive" ? within(me, r, ARRIVE_M) : !within(me, r, LEAVE_M);
                if (!due) return restart(e, r).then(function () { return ok({ fired: false }); });
                saveReminders(e, list.filter(function (x) { return x.id !== r.id; }));
                return call(e, AM + "complete", { activityName: activityName(r) }).then(function () {
                    // Tasks posts it, as a timed reminder (nothing if the task was done or deleted
                    // meanwhile), its card not brought up (as the activity manager's launch of it).
                    return call(e, "luna://com.palm.applicationManager/launch", { id: TASKS_APP, params: { reminder: r.taskId }, behind: true });
                }).then(function () { return ok({ fired: true, taskId: r.taskId }); });
            }
        };
    }

    return {
        COMMANDS: COMMANDS,
        METHODS: ["places", "setPlace", "placeWake"],
        service: service,
        run: function (cmd, args, env) {
            if (cmd.id === "parking") return park(args, env);
            if (cmd.id === "findParking") return findCar(args, env);
            if (cmd.id === "placeReminder") return placeReminder(args, env);
            // (explicit: Settings' own, never a request's.)
            if (cmd.id === "setPlace") return setPlace({ place: args.place, address: args.address }, env);
            return null;
        },
        // For tests and the simulator's checks.
        fence: { box: box, within: within, enterTrigger: enterTrigger, exitTrigger: exitTrigger, ARRIVE_M: ARRIVE_M, LEAVE_M: LEAVE_M }
    };
};
