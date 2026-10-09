// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Follow-up questions (docs/AI-AND-MCP.md, "Follow-up questions"): after
// the assistant makes something, it asks one short question about the most
// useful detail the thing still lacks, with answers to tap, instead of
// leaving it to the user. A Phoenix addition: webOS had no assistant.
//
//   - In the conversation: one question after a command made something
//     (an event, a reminder, a task, an alarm, a contact), the next after
//     an answer, at most RULES.perItem about one thing; never what was
//     already given. Answers change the real thing through the same
//     services the command used (db8, the activity manager), and the reply
//     says what changed ("Added Office as the place.").
//   - No answer: the user closes the assistant (leave) or does not answer
//     within RULES.windowMs: the question is queued (the service's store,
//     so it survives a restart).
//   - Later: a queued question comes back as a notification with the same
//     answers as buttons, RULES.firstMs after it was queued (Settings >
//     Assistant > First follow-up: 15 minutes, 1 hour or 3 hours; sooner
//     when the thing is soon), never in the quiet hours (Settings >
//     Assistant, 22:00-08:00 by default), with Do Not Disturb on or in a
//     call (it waits), never once the thing's time has passed; once more
//     RULES.againMs later (Second follow-up: off, 1 hour, 4 hours or the
//     next day), then it is dropped. The activity manager
//     wakes the service for it (one activity, ACTIVITY, at the next time
//     anything is due), as webOS services were woken.
//   - Restraint: a question whose detail the user filled in themselves
//     (the field changed since it was asked) or whose thing is gone is
//     dropped; two Skips on one thing end the questions about it. After
//     RULES.kindSkips Skips in a row of one kind (across things) it does not
//     stop on its own: it asks whether that kind of question helps ("I've
//     been asking about where your meetings are. Is that helpful, or
//     should I stop?" Keep asking / Stop asking), and stops only on "Stop
//     asking": the topic is then off in Settings > Assistant > Follow-up
//     topics (settings followUpTopicsOff), where it can be turned on again;
//     Follow-up questions turns them all off.
//   - Words: the language file's (lang.followUp), said as conversation and
//     naming the thing as people would ("your 3 o'clock tomorrow",
//     "tomorrow's lunch with Sam"), a few phrasings per question taken in
//     turn so they do not repeat.
//   - Where: in the conversation the thing was made in. A question sent
//     later arrives there too, as a message (deps.delivered), counted unread
//     until the conversation is opened, as well as in its notification.
//
// create(deps) -> {afterCreate, answer, answerable, leave, leaveOne, reopen, attach, wake, list, reset}
//   deps: {storage, now() -> ms, env() -> the commands' env (luna, lang, now),
//          settings() -> {followUps, quietStart, quietEnd, followUpFirst,
//          followUpAgain (minutes; 0: no second), followUpTopicsOff},
//          stopTopic(kind) (turns a topic off in the settings),
//          delivered(question, text, choices) -> messageId (a question sent
//          later, said in its conversation), notify(n) (a
//          notification: {appId, tag, title, body, params, actions} or
//          {appId, tag, remove: true}), log, changed}
//
// A question: {id, kind, item: {type, id, contactId?, title, at}, threadId,
// messageId, state ("open" in the conversation, "queued", "delivered" as a
// notification; then "answered", "skipped" or "dropped"), askedAt,
// openUntil, queuedAt, nextAt, attempts, snapshot (the detail as it was
// when asked), options [{label, value}], why (dropped: "gone", "edited",
// "passed", "unanswered", "off", "stopped")}.

"use strict";

var C = require("./commands");
var D = require("./dates");

var DB = "luna://com.palm.db/";
var ASSISTANT_APP = "org.webosphoenix.assistant";
var SERVICE_URI = "luna://org.webosphoenix.assistant/";
var ACTIVITY = "org.webosphoenix.assistant.followups";
var PREFIX = "assistant:followup:q:";
var STATS = "assistant:followup:stats";

var MIN = 60000, HOUR = 60 * MIN;
// Decided for the owner (8 October 2026); docs/AI-AND-MCP.md says why.
var RULES = {
    windowMs: 2 * MIN,        // unanswered this long in the conversation: queued
    firstMs: HOUR,            // queued -> its notification (the default of settings followUpFirst)
    againMs: 4 * HOUR,        // a notification unanswered -> once more (followUpAgain); after the last, dropped
    attempts: 2,              // notifications per question (1 with followUpAgain off)
    perItem: 2,               // questions about one thing, in the conversation
    itemSkips: 2,             // Skips that end the questions about a thing
    kindSkips: 3,             // Skips in a row of one kind, across things, before asking whether it helps
    callWaitMs: 10 * MIN,     // in a call: tried again then
    dndWaitMs: 30 * MIN,      // Do Not Disturb: tried again then
    beforeMs: 30 * MIN,       // about something soon: this long before it at the latest
    soonestMs: 10 * MIN,      // ... but not sooner than this after it was queued
    keepMs: 7 * 24 * HOUR     // finished questions are forgotten after this
};

// What to ask about each kind of thing, most useful first.
var KINDS = {
    event: ["location", "invitees", "duration", "alert"],
    reminder: ["due"],
    task: ["due", "list"],
    alarm: ["repeat", "label"],
    contact: ["email", "phone"]
};
// The commands that make something, and what they make.
var ITEM_OF = { event: "event", reminder: "reminder", task: "task", alarm: "alarm", contactAdd: "contact" };
var FINAL = { answered: 1, skipped: 1, dropped: 1 };

function words(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9@.+ ]+/g, " ").replace(/\s+/g, " ").trim(); }
function dbGet(env, id) {
    return C.lunaCall(env, DB + "get", { ids: [id] }).then(function (r) {
        var o = (r.results || [])[0];
        return o && !o._del ? o : null;
    }, function () { return null; });
}
function dbMerge(env, objects) { return C.lunaCall(env, DB + "merge", { objects: objects }); }
// "-PT10M", "-PT1H": the Calendar app's alarm triggers (CalendarEvent.js alarm).
function trigger(min) { return min === 0 ? "PT0M" : "-PT" + (min % 60 ? min + "M" : min / 60 + "H"); }

// ---- The questions ---------------------------------------------------------------------------
// Each kind: field(rec) the detail as it stands (to see whether the user
// changed it), missing(rec, args) worth asking, options(env, rec, item)
// the answers to tap ([{label, value}]; needsOptions: not asked without
// any), apply(env, rec, item, value) -> the value said back.
var Q = {
    location: {
        field: function (ev) { return ev.location || ""; },
        missing: function (ev) { return !String(ev.location || "").trim(); },
        // Places of other events, newest first, the invitees' addresses, a video call.
        options: function (env, ev) {
            var chip = env.lang.followUp.chip;
            return C.dbFind(env, "com.palm.calendarevent:1").then(function (all) {
                var seen = {}, out = [];
                all.filter(function (e) { return e._id !== ev._id && !e._del && e.location; })
                    .sort(function (a, b) { return (b.lastModified || b.created || 0) - (a.lastModified || a.created || 0); })
                    .forEach(function (e) {
                        var k = words(e.location);
                        if (seen[k] || k === "video call" || out.length >= 2) return;
                        seen[k] = true;
                        out.push({ label: e.location, value: e.location });
                    });
                return Promise.all((ev.attendees || []).slice(0, 3).map(function (a) {
                    return a.commonName ? C.findPerson(env, a.commonName) : null;
                })).then(function (ps) {
                    ps.forEach(function (p) {
                        var ad = p && (p.addresses || [])[0];
                        var text = ad ? (ad.freeformAddress || [ad.streetAddress, ad.locality].filter(Boolean).join(", ")) : "";
                        if (text && out.length < 2 && !seen[words(text)]) {
                            seen[words(text)] = true;
                            out.push({ label: (p.name && p.name.givenName || C.personName(p)) + "'s place", value: text });
                        }
                    });
                    out.push({ label: chip.videoCall, value: "Video call" });
                    return out;
                });
            });
        },
        apply: function (env, ev, item, value) {
            return dbMerge(env, [{ _id: ev._id, location: String(value), lastModified: env.now() }]).then(function () { return String(value); });
        }
    },
    invitees: {
        needsOptions: true,
        field: function (ev) { return (ev.attendees || []).length; },
        missing: function (ev) { return !(ev.attendees || []).length; },
        // Who has an email: the favourites, then the people of other events.
        options: function (env, ev) {
            return Promise.all([C.people(env), C.dbFind(env, "com.palm.calendarevent:1")]).then(function (got) {
                var byEmail = {}, out = [];
                got[0].forEach(function (p) { var e = C.emailOf(p); if (e) byEmail[e.toLowerCase()] = p; });
                function add(p) {
                    var e = C.emailOf(p);
                    if (!e || out.length >= 3 || out.some(function (o) { return o.value[0].email === e; })) return;
                    out.push({ label: C.personName(p), value: [{ email: e, name: C.personName(p) }] });
                }
                got[0].filter(function (p) { return p.favorite; }).forEach(add);
                got[1].filter(function (e) { return e._id !== ev._id; })
                    .sort(function (a, b) { return (b.lastModified || 0) - (a.lastModified || 0); })
                    .forEach(function (e) {
                        (e.attendees || []).forEach(function (a) { var p = a.email && byEmail[String(a.email).toLowerCase()]; if (p) add(p); });
                    });
                return out;
            });
        },
        apply: function (env, ev, item, value) {
            var att = (ev.attendees || []).concat(value.map(function (v) { return { email: v.email, commonName: v.name, organizer: false }; }));
            return dbMerge(env, [{ _id: ev._id, attendees: att, lastModified: env.now() }])
                .then(function () { return value.map(function (v) { return v.name || v.email; }); });
        }
    },
    duration: {
        field: function (ev) { return Number(ev.dtend) - Number(ev.dtstart); },
        // Not when it was said ("for 90 minutes", "from 2 to 3"), nor all day.
        missing: function (ev, args) { return !ev.allDay && !(args && (args.end > args.start || args.duration_minutes)); },
        options: function (env) {
            var chip = env.lang.followUp.chip;
            return Promise.resolve([30, 60, 120].map(function (n) { return { label: chip.minutes(n), value: n }; }));
        },
        apply: function (env, ev, item, value) {
            return dbMerge(env, [{ _id: ev._id, dtend: Number(ev.dtstart) + value * MIN, lastModified: env.now() }]).then(function () { return value; });
        }
    },
    alert: {
        field: function (ev) { return JSON.stringify(ev.alarm || []); },
        missing: function (ev) { return !ev.allDay; },
        options: function (env) {
            var chip = env.lang.followUp.chip;
            return Promise.resolve([10, 60].map(function (n) { return { label: chip.before(n), value: n }; }));
        },
        apply: function (env, ev, item, value) {
            var alarm = [{ action: "display", alarmTrigger: { value: trigger(value), valueType: "DURATION" } }];
            return dbMerge(env, [{ _id: ev._id, alarm: alarm, lastModified: env.now() }]).then(function () { return value; });
        }
    },
    due: {
        field: function (t) { return t.due || null; },
        missing: function (t) { return !t.due; },
        // Times as said when they are answered, not when asked ("in 1 hour"
        // from a notification tapped later).
        options: function (env, t, item) {
            var chip = env.lang.followUp.chip, now = env.now(), today = D.startOfDay(now), out = [];
            if (item.type === "reminder") {
                out.push({ label: chip.inAnHour, value: { inMin: 60 } });
                if (D.at(today, 18, 0) - now > HOUR) out.push({ label: chip.thisEvening, value: { day: 0, hour: 18 } });
                out.push({ label: chip.tomorrowMorning, value: { day: 1, hour: 9 } });
            } else {
                if (D.at(today, 18, 0) > now) out.push({ label: chip.today, value: { day: 0, hour: 18 } });
                out.push({ label: chip.tomorrow, value: { day: 1, hour: 9 } });
                out.push({ label: chip.nextWeek, value: { weekday: 1, hour: 9 } });
            }
            return Promise.resolve(out);
        },
        apply: function (env, t, item, value) {
            var now = env.now(), due = typeof value === "number" ? value : value.inMin ? Math.ceil((now + value.inMin * MIN) / (5 * MIN)) * 5 * MIN
                : value.weekday !== undefined ? D.at(D.nextWeekday(now, value.weekday, false), value.hour, 0)
                : D.at(D.addDays(D.startOfDay(now), value.day), value.hour, 0);
            var remind = item.type === "reminder" || t.remind;
            return dbMerge(env, [{ _id: t._id, due: due, remind: remind ? due : null, modifiedTime: now }])
                .then(function () { return remind ? C.remindTask(env, t._id, due) : null; })
                .then(function () { return due; });
        }
    },
    list: {
        needsOptions: true,
        field: function (t) { return t.listId || ""; },
        // Only a task put in the default list, when there are others.
        missing: function (t, args) { return !(args && args.list); },
        options: function (env, t) {
            return C.dbFind(env, "com.palm.tasklist:1").then(function (lists) {
                return lists.filter(function (l) { return l._id !== t.listId && !l.isDefault && !l._del; })
                    .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }).slice(0, 3)
                    .map(function (l) { return { label: l.name, value: { id: l._id, name: l.name } }; });
            });
        },
        apply: function (env, t, item, value) {
            var get = typeof value === "string" ? C.taskList(env, value) : Promise.resolve(value);
            return get.then(function (l) {
                return dbMerge(env, [{ _id: t._id, listId: l.id, modifiedTime: env.now() }]).then(function () { return l.name; });
            });
        }
    },
    repeat: {
        field: function (a) { return a.occurs || "once"; },
        missing: function (a) { return (a.occurs || "once") === "once"; },
        options: function (env) {
            var chip = env.lang.followUp.chip;
            return Promise.resolve([{ label: chip.daily, value: "daily" }, { label: chip.weekdays, value: "weekdays" },
                                    { label: chip.weekends, value: "weekends" }, { label: chip.justOnce, value: "once" }]);
        },
        // The Clock's record, and its activity at the next ring (com.palm.app.clock
        // utility/alarmdbmanager.js, utility/activitymanager.js setAlarmTimeout).
        apply: function (env, a, item, value) {
            if (value === "once") return Promise.resolve(value);
            var rec = Object.assign({}, a, { occurs: value });
            var next = C.nextRing(rec, env.now());
            return dbMerge(env, [{ _id: a._id, occurs: value }])
                .then(function () { return next ? C.scheduleAlarm(env, rec, new Date(next)) : null; })
                .then(function () { return value; });
        }
    },
    label: {
        field: function (a) { return a.title || ""; },
        missing: function (a, args) { return !(args && args.label); },
        options: function (env, a) {
            return C.dbFind(env, "com.palm.clock.alarm:1").then(function (all) {
                var seen = {}, out = [];
                all.forEach(function (x) {
                    var k = words(x.title);
                    if (x._id === a._id || !k || k === "alarm" || seen[k] || out.length >= 2) return;
                    seen[k] = true;
                    out.push({ label: x.title, value: x.title });
                });
                return out;
            });
        },
        apply: function (env, a, item, value) {
            return dbMerge(env, [{ _id: a._id, title: String(value) }]).then(function () { return String(value); });
        }
    },
    email: {
        field: function (p) { return (p.emails || []).length; },
        missing: function (p) { return !(p.emails || []).length; },
        options: function () { return Promise.resolve([]); },
        // The contact and its person, as contactAdd made them.
        apply: function (env, p, item, value) {
            var e = { value: String(value), type: "type_home", primary: true };
            return dbMerge(env, [{ _id: item.contactId, emails: [e] },
                                 { _id: p._id, emails: [Object.assign({ normalizedValue: e.value.toLowerCase(), favoriteData: {} }, e)] }])
                .then(function () { return e.value; });
        }
    },
    phone: {
        field: function (p) { return (p.phoneNumbers || []).length; },
        missing: function (p) { return !(p.phoneNumbers || []).length; },
        options: function () { return Promise.resolve([]); },
        apply: function (env, p, item, value) {
            var n = { value: String(value), type: "type_mobile", primary: true };
            return dbMerge(env, [{ _id: item.contactId, phoneNumbers: [n] },
                                 { _id: p._id, phoneNumbers: [Object.assign({ normalizedValue: C.normalizedPhone(n.value), speedDial: "", favoriteData: {} }, n)] }])
                .then(function () { return n.value; });
        }
    }
};

// What a command made, from its run's result: {type, id, contactId?}.
function itemOf(cmdId, data) {
    var type = ITEM_OF[cmdId];
    if (!type || !data) return null;
    if (type === "event" && data.eventId) return { type: type, id: data.eventId };
    if ((type === "reminder" || type === "task") && data.taskId) return { type: type, id: data.taskId };
    if (type === "alarm" && data.alarmId) return { type: type, id: data.alarmId };
    if (type === "contact" && data.personId) return { type: type, id: data.personId, contactId: data.contactId };
    return null;
}
// Its title and time, as the record says now.
function describe(item, rec, now) {
    var out = { type: item.type, id: item.id, title: "", at: null };
    if (item.contactId) out.contactId = item.contactId;
    if (item.type === "event") {
        out.title = rec.subject || "";
        out.at = rec.rrule ? null : Number(rec.dtstart) || null;
        out.start = Number(rec.dtstart) || null;
        out.allDay = !!rec.allDay;
        out.people = (rec.attendees || []).map(function (a) { return String(a.commonName || a.email || "").split(" ")[0]; }).filter(Boolean);
    } else if (item.type === "reminder" || item.type === "task") {
        out.title = rec.summary || "";
        out.at = rec.due || null;
    } else if (item.type === "alarm") {
        out.title = rec.niceTime || "";
        out.at = (rec.occurs || "once") === "once" ? C.nextRing(rec, now) : null;
    } else if (item.type === "contact") {
        out.title = C.personName(rec);
    }
    return out;
}

function create(deps) {
    var storage = deps.storage;
    var now = deps.now || function () { return Date.now(); };
    var log = deps.log || function () {};
    var changed = deps.changed || function () {};
    var notify = deps.notify || function () {};
    var seq = 0;

    function env() { return deps.env(); }
    function words2() { return env().lang.followUp; }
    function settings() { return deps.settings(); }

    // ---- The store --------------------------------------------------------------------------
    function get(id) { var r = id ? storage.get(PREFIX + id) : null; return r && r.id === id ? r : null; }
    function put(r) { storage.set(PREFIX + r.id, r); }
    function all() {
        return storage.keys(PREFIX).map(function (k) { return storage.get(k); }).filter(function (r) { return r && r.id; })
            .sort(function (a, b) { return a.askedAt - b.askedAt || (a.id < b.id ? -1 : 1); });
    }
    function stats() {
        var s = storage.get(STATS) || {};
        return { kinds: s.kinds || {}, items: s.items || {}, said: s.said || {} };
    }
    function itemKey(item) { return item.type + ":" + item.id; }
    function itemStats(s, item) {
        var k = itemKey(item);
        if (!s.items[k]) s.items[k] = { asked: [], skips: 0, at: now() };
        return s.items[k];
    }
    // A topic turned off (Settings, or "Stop asking").
    function muted(s, kind) { return (settings().followUpTopicsOff || []).indexOf(kind) >= 0; }
    // Skipped so often that it is time to ask whether it helps.
    function doubtful(s, kind) { return (s.kinds[kind] || 0) >= RULES.kindSkips; }
    function loadItem(item) {
        return dbGet(env(), item.id);
    }

    // ---- Asking -----------------------------------------------------------------------------
    // The next question about a thing: the most useful kind not asked yet,
    // not stopped, still missing, with answers to offer where it needs them.
    function next(item, rec, args) {
        var s = stats(), st = itemStats(s, item), e = env();
        if (st.skips >= RULES.itemSkips || st.asked.length >= RULES.perItem) return Promise.resolve(null);
        var kinds = (KINDS[item.type] || []).filter(function (k) { return st.asked.indexOf(k) < 0 && !muted(s, k) && Q[k].missing(rec, args); });
        function from(i) {
            if (i >= kinds.length) return Promise.resolve(null);
            var k = kinds[i];
            if (doubtful(s, k)) {
                var w = e.lang.followUp.chip;
                return Promise.resolve({ kind: k, meta: true, options: [{ label: w.keepAsking, value: "keep" }, { label: w.stopAsking, value: "stop" }] });
            }
            return Q[k].options(e, rec, item).then(function (opts) {
                if (Q[k].needsOptions && !opts.length) return from(i + 1);
                return { kind: k, options: opts };
            }, function () { return from(i + 1); });
        }
        return from(0);
    }
    function newId() { return now().toString(36) + "-" + (seq++ % 1296).toString(36) + Math.random().toString(36).slice(2, 6); }
    function choicesOf(r) {
        var list = r.options.map(function (o, i) { return { id: "fu:" + i, label: o.label }; });
        return r.meta ? list : list.concat([{ id: "fu:skip", label: words2().chip.skip }]);
    }
    // at: the time it is said at (a fast-forward's, else now).
    function textOf(r, at) {
        return r.meta ? words2().doubt(r.kind, r.variant || 0) : words2().question(r.kind, r.item, at || now(), r.variant || 0);
    }
    // Asked in the conversation: kept open for an answer.
    function open(item, rec, q, args, threadId) {
        var s = stats(), st = itemStats(s, item);
        st.asked.push(q.meta ? "?" + q.kind : q.kind);
        // The phrasings in turn, per kind.
        s.said = s.said || {};
        var said = (q.meta ? "?" : "") + q.kind, variant = s.said[said] || 0;
        s.said[said] = variant + 1;
        storage.set(STATS, s);
        var at = now();
        var r = { id: newId(), kind: q.kind, meta: !!q.meta, variant: variant, item: describe(item, rec, at), threadId: threadId, messageId: "", state: "open",
                  askedAt: at, openUntil: at + RULES.windowMs, queuedAt: 0, nextAt: 0, attempts: 0,
                  snapshot: Q[q.kind].field(rec), options: q.options, args: { end: args && args.end || null, start: args && args.start || null,
                  duration_minutes: args && args.duration_minutes || null, list: args && args.list || "", label: args && args.label || "" } };
        put(r);
        reschedule();
        return { id: r.id, kind: r.kind, meta: r.meta, text: textOf(r), choices: choicesOf(r) };
    }

    // After a command made something: the first question about it, or null.
    function afterCreate(cmdId, args, data, threadId) {
        if (!settings().followUps) return Promise.resolve(null);
        var item = itemOf(cmdId, data);
        if (!item) return Promise.resolve(null);
        return loadItem(item).then(function (rec) {
            if (!rec) return null;
            return next(item, rec, args).then(function (q) { return q ? open(item, rec, q, args, threadId) : null; });
        }).catch(function (e) { log("follow-up for " + cmdId + ": " + (e && e.message)); return null; });
    }
    // The question's message in its thread (for typed answers and the chips).
    function attach(id, threadId, messageId) {
        var r = get(id);
        if (!r) return;
        r.threadId = threadId;
        r.messageId = messageId;
        put(r);
    }

    function finish(r, state, why) {
        var wasShown = r.state === "delivered";
        r.state = state;
        r.endedAt = now();
        if (why) r.why = why;
        put(r);
        if (wasShown) notify({ appId: ASSISTANT_APP, tag: "followup:" + r.id, remove: true });
    }
    // Still worth asking: the thing is there, its detail as it was, its
    // time to come. Resolves {rec} or {why}.
    function check(r, at) {
        return loadItem(r.item).then(function (rec) {
            if (!rec) return { why: "gone" };
            if (JSON.stringify(Q[r.kind].field(rec)) !== JSON.stringify(r.snapshot)) return { why: "edited" };
            var item = describe(r.item, rec, at);
            if (r.item.at && at >= r.item.at) return { why: "passed" };
            if (item.at && at >= item.at) return { why: "passed" };
            var s = stats();
            if ((!r.meta && itemStats(s, r.item).skips >= RULES.itemSkips) || muted(s, r.kind)) return { why: "stopped" };
            return { rec: rec };
        });
    }

    // ---- Answers ------------------------------------------------------------------------------
    // Whether question id still takes an answer.
    function answerable(id) { var r = get(id); return !!r && !FINAL[r.state]; }
    // input: {choice: "fu:<n>" | "fu:skip"} or {text} (typed or said;
    // {parsed} when the caller already read it). chain: in the conversation,
    // the next question about the thing comes after. Resolves {text, next?,
    // kind, skipped?} or null (text that is not an answer to this question).
    function answer(id, input, chain) {
        var r = get(id), w = words2();
        if (!r || FINAL[r.state]) return Promise.resolve({ text: w.alreadySet(), done: true });
        var parsed = input.parsed || null;
        if (!parsed && input.text !== undefined) parsed = w.answer(r.meta ? "doubt" : r.kind, input.text, now());
        if (!parsed && input.choice === undefined) return Promise.resolve(null);
        var skip = input.choice === "fu:skip" || (parsed && parsed.skip);
        var e = env();
        return check(r, now()).then(function (c) {
            if (c.why) {
                finish(r, "dropped", c.why);
                return { text: c.why === "gone" ? w.gone() : w.alreadySet(), kind: r.kind, dropped: c.why };
            }
            var s = stats(), st = itemStats(s, r.item);
            // Whether this kind of question helps: asked again, or stopped.
            if (r.meta) {
                var keep = skip ? null : input.choice !== undefined ? (r.options[Number(String(input.choice).slice(3))] || {}).value
                    : parsed && parsed.value;
                if (keep === "stop") {
                    if (deps.stopTopic) deps.stopTopic(r.kind);
                    s.kinds[r.kind] = 0;
                    storage.set(STATS, s);
                    finish(r, "answered");
                    return { text: w.stopped(r.kind), kind: r.kind, stopped: true };
                }
                if (keep === "keep") s.kinds[r.kind] = 0;
                storage.set(STATS, s);
                finish(r, keep ? "answered" : "skipped");
                return { text: keep ? w.keeping() : w.skipped(), kind: r.kind, rec: c.rec };
            }
            if (skip) {
                st.skips++;
                s.kinds[r.kind] = (s.kinds[r.kind] || 0) + 1;
                storage.set(STATS, s);
                finish(r, "skipped");
                return { text: w.skipped(), kind: r.kind, skipped: true, rec: c.rec };
            }
            var value;
            if (input.choice !== undefined) {
                var o = r.options[Number(String(input.choice).slice(3))];
                if (!o) return { text: w.alreadySet(), kind: r.kind };
                value = o.value;
            } else {
                // A chip's words are that chip.
                var said = words(input.text);
                var hit = r.options.filter(function (x) { return words(x.label) === said; })[0];
                value = hit ? hit.value : parsed.value;
            }
            var resolving = Promise.resolve(value);
            if (!hit && r.kind === "invitees" && parsed && parsed.names) {
                resolving = Promise.all(parsed.names.map(function (n) {
                    return C.findPerson(e, n).then(function (p) { return p && C.emailOf(p) ? { email: C.emailOf(p), name: C.personName(p) } : null; });
                })).then(function (found) {
                    var missing = parsed.names.filter(function (n, i) { return !found[i]; });
                    if (missing.length) throw { said: w.noContacts(missing) };
                    return found;
                });
            }
            return resolving.then(function (v) {
                return Q[r.kind].apply(e, c.rec, r.item, v);
            }).then(function (shown) {
                s.kinds[r.kind] = 0;
                storage.set(STATS, s);
                finish(r, "answered");
                r.answer = shown;
                put(r);
                return { text: w.done(r.kind, shown, now()), kind: r.kind, rec: c.rec };
            }, function (err) {
                if (err && err.said) return { text: err.said, kind: r.kind, retry: true };
                throw err;
            });
        }).then(function (out) {
            changed("followUps");
            reschedule();
            if (!chain || out.dropped === "gone" || out.retry || out.stopped) return out;
            // The next question about the same thing, in the conversation.
            return loadItem(r.item).then(function (rec) {
                if (!rec || !settings().followUps) return out;
                return next(r.item, rec, r.args).then(function (q) {
                    if (q) out.next = open(r.item, rec, q, r.args, r.threadId);
                    return out;
                });
            });
        });
    }

    // ---- Leaving it for later ---------------------------------------------------------------------
    function queue(r, at) {
        r.state = "queued";
        r.queuedAt = at;
        var t = at + timing().firstMs, when = r.item.at;
        // Something soon: before it, if there is still time.
        if (when && t > when - RULES.beforeMs) t = Math.max(at + RULES.soonestMs, when - RULES.beforeMs);
        r.nextAt = t;
        put(r);
    }
    // The assistant closed: what it was asking there waits for later.
    function leave(threadId) {
        var n = 0;
        all().forEach(function (r) {
            if (r.state === "open" && (!threadId || r.threadId === threadId)) { queue(r, now()); n++; }
        });
        if (n) { reschedule(); changed("followUps"); }
        return n;
    }
    // The user went on to something else.
    function leaveOne(id) {
        var r = get(id);
        if (r && r.state === "open") { queue(r, now()); reschedule(); changed("followUps"); }
    }
    // A notification's question tapped: asked again in its conversation.
    // Resolves {id, kind, text, choices} or {why}.
    function reopen(id) {
        var r = get(id);
        if (!r || FINAL[r.state]) return Promise.resolve({ why: "answered" });
        var at = now();
        return check(r, at).then(function (c) {
            if (c.why) { finish(r, "dropped", c.why); changed("followUps"); reschedule(); return { why: c.why }; }
            if (r.state === "delivered") notify({ appId: ASSISTANT_APP, tag: "followup:" + r.id, remove: true });
            // Its message keeps its answers (a notification's and the conversation's are the same).
            return (r.meta || r.state === "delivered" ? Promise.resolve(r.options) : Q[r.kind].options(env(), c.rec, r.item)).then(function (opts) {
                r.options = opts;
                r.state = "open";
                r.openUntil = at + RULES.windowMs;
                r.item = describe(r.item, c.rec, at);
                put(r);
                reschedule();
                changed("followUps");
                return { id: r.id, kind: r.kind, meta: r.meta, text: textOf(r), choices: choicesOf(r), threadId: r.threadId, messageId: r.messageId };
            });
        });
    }

    // ---- Waking (the activity manager) -------------------------------------------------------------
    // The reminder brackets the user chose (Settings > Assistant > First /
    // Second follow-up, in minutes; the service's settings() keeps them to
    // FIRST_CHOICES / AGAIN_CHOICES): {firstMs, againMs, attempts}. With no
    // second, an unanswered notification still goes after RULES.againMs.
    function timing() {
        var s = settings();
        var first = typeof s.followUpFirst === "number" && s.followUpFirst > 0 ? s.followUpFirst * MIN : RULES.firstMs;
        var again = typeof s.followUpAgain === "number" ? s.followUpAgain * MIN : RULES.againMs;
        return { firstMs: first, againMs: again > 0 ? again : RULES.againMs, attempts: again > 0 ? RULES.attempts : 1 };
    }
    function minutesOf(hhmm) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    }
    // In the quiet hours: when they end (ms); else 0.
    function quietUntil(at) {
        var s = settings(), a = minutesOf(s.quietStart), b = minutesOf(s.quietEnd);
        if (a === null || b === null || a === b) return 0;
        var d = new Date(at), m = d.getHours() * 60 + d.getMinutes();
        var inside = a < b ? m >= a && m < b : m >= a || m < b;
        if (!inside) return 0;
        var end = D.at(D.startOfDay(at), Math.floor(b / 60), b % 60);
        return end > at ? end : D.at(D.addDays(D.startOfDay(at), 1), Math.floor(b / 60), b % 60);
    }
    // Do Not Disturb (the ringer off: the assistant's own toggle), a call.
    function busy() {
        var e = env();
        var dnd = C.lunaCall(e, "luna://com.webos.service.audio/getInputVolume", { streamType: "pringtones" })
            .then(function (r) { return r.volume === 0; }, function () { return false; });
        var call = C.lunaCall(e, "luna://com.palm.telephony/callStatusQuery", {})
            .then(function (r) { return (r.calls || []).some(function (c) { return c.state && c.state !== "disconnected"; }); }, function () { return false; });
        return Promise.all([dnd, call]).then(function (x) { return { dnd: x[0], call: x[1] }; });
    }
    function deliver(r, at) {
        var rec0 = r.rec;
        // The answers offered again: times and places as they are now.
        return (r.meta ? Promise.resolve(r.options) : Q[r.kind].options(env(), r.rec, r.item)).catch(function () { return r.options; }).then(function (opts) {
            r.options = opts && opts.length ? opts : r.options;
            r.attempts++;
            r.state = "delivered";
            r.deliveredAt = at;
            // The next try, or with none (the second follow-up off) when the
            // unanswered notification goes.
            r.nextAt = at + timing().againMs;
            if (r.item.at && r.nextAt > r.item.at) r.nextAt = r.item.at;
            delete r.rec;
            r.item = describe(r.item, rec0, at);
            // Said in its conversation too, waiting there (unread).
            if (deps.delivered) {
                var mid = deps.delivered(r, textOf(r, at), choicesOf(r));
                if (mid) r.messageId = mid;
            }
            put(r);
            // Room for two answers and Skip in a dashboard row.
            var items = choicesOf(r);
            items = items.length > 3 ? items.slice(0, 2).concat(items.slice(-1)) : items;
            notify({ appId: ASSISTANT_APP, tag: "followup:" + r.id, title: textOf(r, at), body: "",
                     params: { followUp: r.id },
                     actions: { uri: SERVICE_URI + "answerFollowUp", params: { id: r.id }, items: items } });
        });
    }
    // Everything due by at (now, or a later time for the simulator's and
    // the tests' fast-forward). Resolves {queued, delivered, dropped, postponed}.
    function wake(at) {
        var t = at === undefined ? now() : at, out = { queued: 0, delivered: 0, dropped: 0, postponed: 0 };
        var due = [];
        all().forEach(function (r) {
            if (r.state === "open" && t >= r.openUntil) { queue(r, r.openUntil); out.queued++; }
            if ((r.state === "queued" || r.state === "delivered") && r.nextAt <= t) due.push(r);
            // Long finished: forgotten.
            if (FINAL[r.state] && t - (r.endedAt || r.askedAt) > RULES.keepMs) storage.remove(PREFIX + r.id);
        });
        var s = stats(), pruned = false;
        Object.keys(s.items).forEach(function (k) { if (t - (s.items[k].at || 0) > 4 * RULES.keepMs) { delete s.items[k]; pruned = true; } });
        if (pruned) storage.set(STATS, s);
        var conditions = null;
        function conditionsNow() { if (!conditions) conditions = busy(); return conditions; }
        return due.reduce(function (p, r) {
            return p.then(function () {
                if (!settings().followUps) { finish(r, "dropped", "off"); out.dropped++; return null; }
                if (r.state === "delivered" && r.attempts >= timing().attempts) { finish(r, "dropped", "unanswered"); out.dropped++; return null; }
                return check(r, t).then(function (c) {
                    if (c.why) { finish(r, "dropped", c.why); out.dropped++; return null; }
                    var quiet = quietUntil(t);
                    if (quiet) { r.nextAt = quiet; put(r); out.postponed++; return null; }
                    return conditionsNow().then(function (b) {
                        if (b.dnd || b.call) { r.nextAt = t + (b.call ? RULES.callWaitMs : RULES.dndWaitMs); put(r); out.postponed++; return null; }
                        r.rec = c.rec;
                        out.delivered++;
                        return deliver(r, t);
                    });
                });
            });
        }, Promise.resolve()).then(function () {
            reschedule();
            if (out.queued || out.delivered || out.dropped) changed("followUps");
            return out;
        });
    }

    // One activity, at the next time anything is due (replaced each time).
    var scheduled = -1;
    function reschedule() {
        var t = Infinity;
        all().forEach(function (r) {
            if (r.state === "open") t = Math.min(t, r.openUntil);
            else if (r.state === "queued" || r.state === "delivered") t = Math.min(t, r.nextAt);
        });
        if (t === scheduled) return;
        scheduled = t;
        var e = env();
        if (t === Infinity) {
            C.lunaCall(e, "luna://com.palm.activitymanager/cancel", { activityName: ACTIVITY }).catch(function () {});
            return;
        }
        C.lunaCall(e, "luna://com.palm.activitymanager/create", { start: true, replace: true, activity: {
            name: ACTIVITY, description: "Assistant follow-up questions", type: { background: true, persist: true },
            schedule: { start: C.activityDate(Math.max(t, now())) },
            callback: { method: SERVICE_URI + "followUpWake", params: {} } } })
            .catch(function (err) { log("follow-up activity: " + (err && err.message)); });
    }

    // ---- For the UI ------------------------------------------------------------------------------
    function list() {
        var s = stats();
        return {
            followUps: all().filter(function (r) { return !FINAL[r.state]; }).map(function (r) {
                return { id: r.id, kind: r.kind, meta: !!r.meta, question: textOf(r), item: r.item, state: r.state, attempts: r.attempts,
                         nextAt: r.state === "open" ? r.openUntil : r.nextAt, threadId: r.threadId, choices: choicesOf(r) };
            }),
            topicsOff: (settings().followUpTopicsOff || []).slice()
        };
    }
    // Forget the Skips counted (the kinds' and the things').
    function reset() {
        var s = stats();
        s.kinds = {};
        Object.keys(s.items).forEach(function (k) { s.items[k].skips = 0; });
        storage.set(STATS, s);
        changed("followUps");
    }
    // Follow-up questions turned off: nothing waits.
    function clear() {
        all().forEach(function (r) { if (!FINAL[r.state]) finish(r, "dropped", "off"); });
        reschedule();
        changed("followUps");
    }

    return { afterCreate: afterCreate, attach: attach, answer: answer, answerable: answerable, leave: leave, leaveOne: leaveOne,
             reopen: reopen, wake: wake, list: list, reset: reset, clear: clear, get: get };
}

module.exports = { create: create, RULES: RULES, KINDS: KINDS, ACTIVITY: ACTIVITY };
