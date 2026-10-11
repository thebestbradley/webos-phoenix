// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Routines (docs/AI-AND-MCP.md, "Everyday features"): a name, the phrases
// that run it, steps (requests in words: "turn on do not disturb", "set an
// alarm for 7am", "what's the weather"), and optionally a time and days it
// runs at, and the device's own moments (put on charge, connected to the
// car). Made and changed in Settings > Assistant > Routines; "Good night"
// and "Good morning" are offered there as starters, off until added.
//
//   routine         "good night" (a routine's phrase), "run my morning
//                   routine": each step done as if asked, in turn, and what
//                   each did said together ("Good night. Do Not Disturb is
//                   on. Your alarm is set for 7:00 AM.")
//   routineList     "what routines do I have"; "make a routine" opens
//                   Settings > Assistant > Routines
//   routineManage   "turn off my good night routine", "delete my morning
//                   routine" (read back first)
//
// A step is words, read by the grammar when the routine runs (so "7am" is
// the next 7 AM then, not when it was made). Steps may read, change and
// open; never send, call or delete (those are always read back first, and a
// routine runs without asking), nor run a routine.
//
// Its time: an activity (com.palm.activitymanager, as the Clock's alarms)
// that calls the service's routineWake {id} then; the next one is set as
// it runs. Charging and the car: the shell says when the device is put on
// charge or connects to a car kit over Bluetooth (routineEvent {event:
// "charging" | "car"}, Shell.qml), as the device reports them. A routine run
// by them, or by its time, is said aloud, put in the conversation and left
// as a notification.
//
// The service's methods (service() below):
//   routines {}                         -> {routines, starters, templates, events}
//   setRoutine {routine}                -> {routine}: made (no id) or changed; every step checked
//   removeRoutine {id}
//   runRoutine {id}                     -> {text}: Settings' Run Now
//   routineWake {id, $activity}         the activity manager, at its time
//   routineEvent {event}                the system UI: "charging", "car"

"use strict";

var grammar = require("./grammar");

var KEY = "assistant:routines";
var AM = "luna://com.palm.activitymanager/";
var WAKE = "luna://org.webosphoenix.assistant/routineWake";
var EVENTS = ["charging", "car"];
// What a step may not be, whatever its risk: the routines' own, and the
// assistant's internal answers.
var NOT_A_STEP = /^(?:routine|routineList|routineManage|undo|chat|checkDone|copyText|locationAccess|replyTo|help|beyond|negated|multi|emergency)$/;
var MAX_STEPS = 12;

var COMMANDS = [
    { id: "routine", title: "Routines", risk: "change", whenLocked: false,
      description: "Run one of the user's routines (a set of steps they made in Settings), by its name or phrase.",
      parameters: { type: "object", properties: { name: { type: "string", description: "The routine's name, \"Good night\"" } }, required: ["name"] },
      examples: ["start my bedtime routine", "do my morning routine", "kick off the good night routine"] },
    { id: "routineList", title: "Listing routines", risk: "read",
      description: "Tell which routines the user has, or open Settings to make one.",
      parameters: { type: "object", properties: { create: { type: "boolean", description: "The user wants to make a new one" } } },
      examples: ["which routines have I set up", "show me my routines", "I want to set up a new routine"] },
    { id: "routineManage", title: "Turning routines on and off", risk: "change",
      description: "Turn a routine on or off, delete it (read back first), or open it in Settings to change it.",
      parameters: { type: "object", properties: { name: { type: "string" }, action: { type: "string", enum: ["on", "off", "delete", "edit"] } }, required: ["name", "action"] },
      examples: ["pause my morning routine", "switch the good night routine back on", "get rid of the bedtime routine"] }
];

function clean(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim(); }
function newId(now) { return "r" + now.toString(36) + Math.random().toString(36).slice(2, 6); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
var HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

module.exports = function (h) {
    function all(env) { var l = env.storage.get(KEY); return Array.isArray(l) ? l : []; }
    function save(env, list) { env.storage.set(KEY, list); }
    function byName(list, name) {
        var n = clean(name).replace(/^(?:my|the) /, "").replace(/ routine$/, "");
        return list.filter(function (r) { return clean(r.name) === n || (r.phrases || []).some(function (p) { return clean(p) === n; }); })[0] || null;
    }

    // ---- A step: words read by the grammar, as the user would say them ----
    function parseCtx(env) {
        return Promise.resolve(env.apps ? env.apps() : []).catch(function () { return []; }).then(function (apps) {
            return { lang: env.lang.id, now: env.now(), apps: apps, names: [], appCommands: [] };
        });
    }
    // -> {command, args} | {error}
    function readStep(text, ctx, env) {
        var say = env.lang.say;
        var p = grammar.parse(String(text || ""), ctx);
        if (!p || p.command === "beyond") return { error: say.routineStepUnknown(text) };
        if (p.command === "multi") return { error: say.routineStepOne(text) };
        var cmd = h.find(h.BUILT_IN, p.command);
        if (!cmd || NOT_A_STEP.test(p.command) || cmd.internal) return { error: say.routineStepNotAllowed(text) };
        if (h.needsConfirm(cmd)) return { error: say.routineStepAsks(text) };
        return { command: p.command, args: p.args, cmd: cmd };
    }
    // Each step in turn: what it said, or why it could not.
    function runSteps(r, env) {
        var say = env.lang.say;
        return parseCtx(env).then(function (ctx) {
            // actions: what a step offers to do next (the location's Allow), kept on the routine's answer.
            var said = [], failed = 0, actions = [];
            return (r.steps || []).reduce(function (p, step) {
                return p.then(function () {
                    var s = readStep(step.text, Object.assign({}, ctx, { now: env.now() }), env);
                    if (s.error) { failed++; said.push(s.error); return null; }
                    return Promise.resolve(h.prepare(s.cmd, s.args, env)).then(function (pr) {
                        if (pr.reply || pr.awaiting) { failed++; said.push(pr.reply || say.routineStepUnknown(step.text)); return null; }
                        if (pr.confirm) { failed++; said.push(say.routineStepAsks(step.text)); return null; }
                        return h.run(s.cmd, pr.args, env).then(function (out) {
                            if (out && out.failed) failed++;
                            if (out && out.text) said.push(out.text);
                            if (out && out.actions) actions = actions.concat(out.actions.filter(function (a) { return a && a.run; }));
                        });
                    }).catch(function (e) { failed++; said.push(say.failed(e && e.message || String(e))); });
                });
            }, Promise.resolve()).then(function () {
                return { text: say.routineRan(r.name, said), failed: failed, actions: actions.slice(0, 4) };
            });
        });
    }

    // ---- Its time ----
    // The next time it runs after now: days [0-6] (none: every day).
    function nextAt(r, now) {
        var m = HHMM.exec(r.time || "");
        if (!m) return null;
        for (var i = 0; i < 8; ++i) {
            var d = new Date(now);
            d.setDate(d.getDate() + i);
            d.setHours(Number(m[1]), Number(m[2]), 0, 0);
            if (d.getTime() <= now) continue;
            if (r.days && r.days.length && r.days.indexOf(d.getDay()) < 0) continue;
            return d.getTime();
        }
        return null;
    }
    function schedule(env, r) {
        var name = "assistant.routine." + r.id;
        var at = r.enabled !== false ? nextAt(r, env.now()) : null;
        if (!at) return h.lunaCall(env, AM + "cancel", { activityName: name }).catch(function () { return null; });
        return h.lunaCall(env, AM + "create", { start: true, replace: true, activity: {
            name: name, description: "Assistant routine: " + r.name, type: { foreground: true, persist: true },
            schedule: { start: h.activityDate(at) },
            callback: { method: WAKE, params: { id: r.id, at: at } } } }).then(function () { return at; });
    }

    // ---- Commands ----
    function run(args, env) {
        var say = env.lang.say, r = args.id ? all(env).filter(function (x) { return x.id === args.id; })[0] : byName(all(env), args.name);
        if (!r) return Promise.resolve({ text: say.noRoutine(args.name || "") });
        if (r.enabled === false)
            return Promise.resolve({ text: say.routineIsOff(r.name),
                                     actions: [{ label: say.turnRoutineOn(), run: { command: "routineManage", args: { name: r.name, action: "on" } } }] });
        return runSteps(r, env).then(function (out) {
            return { text: out.text, failed: out.failed > 0 && out.failed === (r.steps || []).length, data: { routine: r.id },
                     actions: out.actions.length ? out.actions : undefined };
        });
    }
    function list(args, env) {
        var say = env.lang.say, rs = all(env);
        var settings = { appId: "org.webosphoenix.settings", params: { page: "assistant", section: "routines" }, title: "Routines" };
        if (args.create) return Promise.resolve({ text: say.routineMake(), open: settings });
        return Promise.resolve({ text: say.routinesAre(rs.map(function (r) { return { name: r.name, on: r.enabled !== false, phrase: (r.phrases || [])[0] || r.name }; })),
                                 open: settings });
    }
    function manage(args, env) {
        var say = env.lang.say, rs = all(env), r = byName(rs, args.name);
        if (!r) return Promise.resolve({ text: say.noRoutine(args.name || "") });
        if (args.action === "edit")
            return Promise.resolve({ text: say.routineEdit(r.name),
                                     open: { appId: "org.webosphoenix.settings", params: { page: "assistant", section: "routines", routine: r.id }, title: "Settings" } });
        if (args.action === "delete") {
            save(env, rs.filter(function (x) { return x.id !== r.id; }));
            return h.lunaCall(env, AM + "cancel", { activityName: "assistant.routine." + r.id }).catch(function () { return null; })
                .then(function () { return { text: say.routineDeleted(r.name) }; });
        }
        r.enabled = args.action === "on";
        save(env, rs);
        return schedule(env, r).then(function () { return { text: say.routineSwitched(r.name, r.enabled) }; });
    }

    // ---- Settings' list: checked, saved, scheduled ----
    function normalized(r, env) {
        var say = env.lang.say;
        var name = String(r.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (!name) return Promise.resolve({ error: say.routineNeedsName() });
        var phrases = (Array.isArray(r.phrases) ? r.phrases : [r.phrases]).map(function (p) { return String(p || "").replace(/\s+/g, " ").trim().slice(0, 80); })
            .filter(Boolean);
        if (!phrases.length) phrases = [name];
        var steps = (Array.isArray(r.steps) ? r.steps : []).map(function (s) { return { text: String(s && s.text || s || "").trim().slice(0, 200) }; })
            .filter(function (s) { return s.text; }).slice(0, MAX_STEPS);
        if (!steps.length) return Promise.resolve({ error: say.routineNeedsSteps() });
        var time = r.time ? String(r.time) : "";
        if (time && !HHMM.test(time)) return Promise.resolve({ error: say.routineBadTime() });
        var days = Array.isArray(r.days) ? r.days.map(Number).filter(function (d) { return d >= 0 && d <= 6 && Math.floor(d) === d; }) : [];
        var events = Array.isArray(r.events) ? r.events.filter(function (e) { return EVENTS.indexOf(e) >= 0; }) : [];
        return parseCtx(env).then(function (ctx) {
            var bad = [];
            // Each read now, and prepared as it would run (nothing is done):
            // one that would ask first (deleting alarms), or ask for more, is no step.
            return steps.reduce(function (p, s) {
                return p.then(function () {
                    var x = readStep(s.text, ctx, env);
                    if (x.error) { bad.push(x.error); return null; }
                    s.command = x.command;
                    return Promise.resolve(h.prepare(x.cmd, x.args, env)).then(function (pr) {
                        if (pr.confirm) bad.push(say.routineStepAsks(s.text));
                        else if (pr.awaiting) bad.push(say.routineStepNeedsMore(s.text, pr.reply));
                    }, function () { return null; });
                });
            }, Promise.resolve()).then(function () { return bad; });
        }).then(function (bad) {
            if (bad.length) return { error: bad.join(" ") };
            return { routine: { id: r.id || "", name: name, phrases: phrases, steps: steps, time: time, days: days.sort(), events: events,
                                enabled: r.enabled !== false, starter: r.starter || "" } };
        });
    }
    function phraseClash(rs, r, env) {
        var mine = r.phrases.map(clean);
        for (var i = 0; i < rs.length; ++i) {
            if (rs[i].id === r.id) continue;
            var theirs = (rs[i].phrases || []).map(clean);
            var both = mine.filter(function (p) { return theirs.indexOf(p) >= 0; });
            if (both.length) return env.lang.say.routinePhraseTaken(both[0], rs[i].name);
        }
        return "";
    }

    // s: assistant.js's {privileged(), settings(), env(), speak(text), conversation(text, last), notify(n)}.
    function service(s) {
        function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
        function fail(text) { return { returnValue: false, errorCode: -1, errorText: text }; }
        // A routine run by its time or the device: said, in the conversation, and a notification.
        function ranAlone(r, why) {
            var e = s.env();
            return runSteps(r, e).then(function (out) {
                s.conversation(out.text, { command: "routine", args: { name: r.name }, status: "done" });
                s.speak(out.text);
                if (s.notify) s.notify({ appId: "org.webosphoenix.assistant", title: r.name, body: out.text, tag: "routine:" + r.id,
                                          params: { openThread: true } });
                return ok({ ran: true, text: out.text, why: why });
            });
        }
        return {
            routines: function () {
                var e = s.env(), l = e.lang;
                return Promise.resolve(ok({ routines: all(e), starters: l.routineStarters ? l.routineStarters() : [],
                                           templates: l.routineTemplates ? l.routineTemplates() : [], events: EVENTS }));
            },
            setRoutine: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                var e = s.env(), rs = all(e);
                if (p.routine && p.routine.id && !rs.some(function (x) { return x.id === p.routine.id; })) return Promise.resolve(fail("No such routine"));
                return normalized(p.routine || {}, e).then(function (n) {
                    if (n.error) return fail(n.error);
                    var r = n.routine;
                    var clash = phraseClash(rs, r, e);
                    if (clash) return fail(clash);
                    if (!r.id) { r.id = newId(e.now()); rs.push(r); }
                    else rs = rs.map(function (x) { return x.id === r.id ? r : x; });
                    save(e, rs);
                    s.changed && s.changed("routines");
                    return schedule(e, r).then(function (at) { return ok({ routine: r, nextAt: at || 0 }); });
                });
            },
            removeRoutine: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                var e = s.env();
                save(e, all(e).filter(function (x) { return x.id !== p.id; }));
                s.changed && s.changed("routines");
                return h.lunaCall(e, AM + "cancel", { activityName: "assistant.routine." + p.id }).catch(function () { return null; })
                    .then(function () { return ok(); });
            },
            runRoutine: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                var e = s.env(), r = all(e).filter(function (x) { return x.id === p.id; })[0];
                if (!r) return Promise.resolve(fail("No such routine"));
                return runSteps(r, e).then(function (out) { return ok({ text: out.text }); });
            },
            // The activity manager, at a routine's time: run if it is due
            // (a minute's grace; never another's call out of time), then the next.
            routineWake: function (p) {
                var e = s.env(), r = all(e).filter(function (x) { return x.id === p.id; })[0];
                if (!r || r.enabled === false || !r.time) return Promise.resolve(ok({ ran: false }));
                var due = Number(p.at) || 0, now = e.now();
                if (!due || now < due - 60000 || now > due + 6 * 3600000) return schedule(e, r).then(function () { return ok({ ran: false }); });
                return ranAlone(r, "time").then(function (out) { return schedule(e, r).then(function () { return out; }); });
            },
            // The system UI: the device was put on charge, or connected to the car.
            routineEvent: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                if (EVENTS.indexOf(p.event) < 0) return Promise.resolve(fail("event: charging or car"));
                var e = s.env();
                var due = all(e).filter(function (r) { return r.enabled !== false && (r.events || []).indexOf(p.event) >= 0; });
                return due.reduce(function (pr, r) { return pr.then(function () { return ranAlone(r, p.event); }); }, Promise.resolve())
                    .then(function () { return ok({ ran: due.length }); });
            }
        };
    }

    return {
        COMMANDS: COMMANDS,
        METHODS: ["routines", "setRoutine", "removeRoutine", "runRoutine", "routineWake", "routineEvent"],
        service: service,
        prepare: function (cmd, args, env) {
            if (cmd.id === "routineManage" && args.action === "delete") {
                var r = byName(all(env), args.name);
                if (!r) return Promise.resolve({ args: args, reply: env.lang.say.noRoutine(args.name || "") });
                return Promise.resolve({ args: args, confirm: env.lang.say.confirmRoutineDelete(r.name) });
            }
            return null;
        },
        run: function (cmd, args, env) {
            if (cmd.id === "routine") return run(args, env);
            if (cmd.id === "routineList") return list(args, env);
            if (cmd.id === "routineManage") return manage(args, env);
            return null;
        },
        // The grammar's: every routine, its phrases and whether it is on
        // (a phrase alone runs one that is on; "run my ... routine" any).
        phrases: function (env) {
            return all(env).map(function (r) { return { id: r.id, name: r.name, phrases: r.phrases || [r.name], on: r.enabled !== false }; });
        },
        nextAt: nextAt
    };
};
