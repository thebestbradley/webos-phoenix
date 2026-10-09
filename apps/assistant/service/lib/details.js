// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One thing about one item, and the item a conversation is about.
//
// "what time is my meeting with Sam", "where is it", "who's invited",
// "what did I write in my grocery memo": the command "detail" answers the
// field asked for, concisely, with the item's card. The item it was about
// becomes the conversation's focus (focusOf: the one item an answer shows,
// by the app it opens), so the next "it" is that item (assistant.js keeps
// it per conversation and gives it to the commands as env.focus).
//
// Made by lib/commands.js with the helpers it shares: require("./details")(h).

"use strict";

var CALENDAR_APP = "com.palm.app.calendar";
var MEMOS_APP = "com.palm.app.notes";
var CONTACTS_APP = "com.palm.app.contacts";
var EMAIL_APP = "com.palm.app.email";
var TASKS_APP = "org.webosphoenix.tasks";

var S = { type: "string" };
var COMMANDS = [
    { id: "detail", title: "Details of events and memos", risk: "read",
      description: "Tell one thing about one event (its time, place, who is invited, how long) or what a memo says; it: the one the conversation is about.",
      parameters: { type: "object", properties: {
          kind: { type: "string", enum: ["event", "memo", ""] },
          query: { type: "string", description: "The event's or memo's words (\"meeting with Sam\", \"grocery\"); empty with it" },
          field: { type: "string", enum: ["time", "place", "people", "length", "text"] },
          it: { type: "boolean", description: "The item the conversation is about (\"where is it\")" } }, required: ["field"] } },
    { id: "edit", title: "Changing events, memos, lists, contacts and alarms", risk: "change",
      description: "Change something found: rename an event, memo or task; set an event's place; add or remove a guest, a memo line or a list item; change a contact's email, number, address or birthday; change an alarm's time. it: the item the conversation is about.",
      parameters: { type: "object", properties: {
          kind: { type: "string", enum: ["event", "memo", "list", "contact", "alarm", ""] },
          query: { type: "string", description: "The item's words (\"meeting with Sam\", \"grocery\", a contact's name, the alarm's time)" },
          it: { type: "boolean", description: "The item the conversation is about (\"rename it\")" },
          change: { type: "string", enum: ["title", "place", "add", "remove", "email", "phone", "address", "birthday", "time"] },
          value: { type: "string", description: "The new title, place, guest, line, item or detail" },
          to: { type: "object", description: "An alarm's new time", properties: { hour: { type: "number" }, minute: { type: "number" }, meridiem: { type: "string", enum: ["", "am", "pm"] } } } },
        required: ["change"] } }
];
function quote(s) { return "\u201c" + s + "\u201d"; }
// Words for "the item the conversation is about".
var IT = /^(?:it|that|this|that one|this one|them)$/;

// The item an answer is about: the one thing it opens.
function focusOf(r) {
    var o = r && r.open, p = (o && o.params) || {};
    if (!o) return null;
    var card = r.attachments && r.attachments[0] && r.attachments[0].type === "cards" && r.attachments[0].items.length === 1 ? r.attachments[0].items[0] : null;
    var title = card ? String(card.title || "") : "";
    if (o.appId === CALENDAR_APP && p.showEventDetail) return { kind: "event", id: String(p.showEventDetail), title: title };
    if (o.appId === MEMOS_APP && p.memoId) return { kind: "memo", id: String(p.memoId), title: title };
    if (o.appId === CONTACTS_APP && p.id) return { kind: "contact", id: String(p.id), title: title };
    if (o.appId === EMAIL_APP && p.emailId) return { kind: "email", id: String(p.emailId), title: title };
    if (o.appId === TASKS_APP && p.taskId) return { kind: "task", id: String(p.taskId), title: title };
    return null;
}

module.exports = function (h) {
    var D = h.D;

    function get(env, id) {
        return h.lunaCall(env, "luna://com.palm.db/get", { ids: [id] }).then(function (r) {
            var o = (r.results || [])[0];
            return o && !o._del ? o : null;
        });
    }
    // The event: the one in focus, or by its words. -> {event, title, start} | null
    function theEvent(env, args) {
        if (args.it) {
            var f = env.focus;
            if (!f || f.kind !== "event") return Promise.resolve(null);
            return get(env, f.id).then(function (ev) {
                if (!ev) return null;
                // A repeating one: the next day of it.
                var now = env.now(), next = D.occurrences(ev, D.startOfDay(now), D.addDays(D.startOfDay(now), 400))[0];
                return { event: ev, title: ev.subject || "(no title)", start: next !== undefined ? next : Number(ev.dtstart) };
            });
        }
        return h.findEvent(env, args.query);
    }
    function theMemo(env, args) {
        if (args.it) {
            var f = env.focus;
            if (!f || f.kind !== "memo") return Promise.resolve(null);
            return get(env, f.id);
        }
        return h.dbFind(env, "com.palm.note:1").then(function (memos) {
            var q = String(args.query || "").trim();
            var live = memos.filter(function (n) { return !n._del; });
            return live.filter(function (n) { return q && h.matches((n.text || "").split("\n")[0], q); })[0]
                || live.filter(function (n) { return q && h.matches(n.text || "", q); })[0] || null;
        });
    }

    function eventDetail(args, env) {
        var say = env.lang.say, now = env.now();
        return theEvent(env, args).then(function (hit) {
            if (!hit) return { text: args.it ? say.nothingInFocus() : say.noSuchEvent(args.query) };
            var ev = hit.event, len = Number(ev.dtend) - Number(ev.dtstart), allDay = !!ev.allDay;
            var cal = { appId: CALENDAR_APP, params: { showEventDetail: ev._id }, title: "Calendar" };
            var card = { title: hit.title, subtitle: h.whenShown(env, hit.start, allDay ? null : hit.start + len, allDay), detail: ev.location || "", open: cal };
            var text;
            if (args.field === "place") text = say.eventPlace(hit.title, ev.location || "");
            else if (args.field === "people") {
                var names = (ev.attendees || []).filter(function (a) { return !a.organizer; })
                    .map(function (a) { return a.commonName || a.email || ""; }).filter(Boolean);
                text = say.eventPeople(hit.title, names);
            } else if (args.field === "length") text = say.eventLength(hit.title, Math.round(len / 60000), allDay);
            else text = say.eventTime(hit.title, hit.start, hit.start + len, allDay, now);
            return { text: text, open: cal, attachments: h.cards([card]) };
        });
    }
    function memoDetail(args, env) {
        var say = env.lang.say;
        return theMemo(env, args).then(function (n) {
            if (!n) return { text: args.it ? say.nothingInFocus() : say.noMemo(String(args.query || "")) };
            var lines = String(n.text || "").split("\n"), title = lines[0] || "", rest = lines.slice(1).join("\n").trim();
            var memo = { appId: MEMOS_APP, params: { memoId: n._id }, title: "Memos" };
            return { text: say.memoSays(title, rest || title), open: memo, attachments: h.cards([{ title: title, detail: rest, open: memo }]) };
        });
    }

    // ---- Edits -------------------------------------------------------------------------------
    // Each changes one record (db8 merge, read back by commands.js run) and
    // can be taken back (undo: what it replaced).
    function merged(env, obj) { return h.lunaCall(env, "luna://com.palm.db/merge", { objects: [obj] }); }
    function cal(id) { return { appId: CALENDAR_APP, params: { showEventDetail: id }, title: "Calendar" }; }
    function sameName(a, b) { return h.words(a) === h.words(b) || h.matches(a, b); }

    function editEvent(args, env) {
        var say = env.lang.say, now = env.now();
        return theEvent(env, args).then(function (hit) {
            if (!hit) return { text: args.it ? say.whatToChange() : say.noSuchEvent(args.query) };
            var ev = hit.event, title = hit.title, value = String(args.value || "").trim();
            var shown = function (t, extra) {
                var card = { title: t, subtitle: h.whenShown(env, hit.start, ev.allDay ? null : hit.start + Number(ev.dtend) - Number(ev.dtstart), !!ev.allDay),
                             detail: extra !== undefined ? extra : ev.location || "", open: cal(ev._id) };
                return { open: cal(ev._id), attachments: h.cards([card]) };
            };
            var undoOf = function (fields) { return Object.assign({ _id: ev._id }, fields); };
            if (args.change === "title") {
                if (!value) return { text: say.whatToChange() };
                return merged(env, { _id: ev._id, subject: value, lastModified: now }).then(function () {
                    return Object.assign({ text: say.renamed(title, value), undo: { kind: "merge", objects: [undoOf({ subject: ev.subject || "" })], what: say.undoWhat.edit(quote(value)) } }, shown(value));
                });
            }
            if (args.change === "place") {
                return merged(env, { _id: ev._id, location: value, lastModified: now }).then(function () {
                    return Object.assign({ text: say.placeSet(title, value), undo: { kind: "merge", objects: [undoOf({ location: ev.location || "" })], what: say.undoWhat.edit("the place") } }, shown(title, value));
                });
            }
            var guests = (ev.attendees || []).slice();
            if (args.change === "add") {
                return h.findPerson(env, value).then(function (p) {
                    if (!p) return { text: say.noSuchContact(value) };
                    var name = h.personName(p), email = h.emailOf(p);
                    if (!email) return { text: say.noEmailFor(name) };
                    if (guests.some(function (a) { return String(a.email).toLowerCase() === email.toLowerCase(); })) return Object.assign({ text: say.alreadyInvited(name, title) }, shown(title));
                    var next = guests.concat([{ email: email, commonName: name, organizer: false }]);
                    return merged(env, { _id: ev._id, attendees: next, lastModified: now }).then(function () {
                        return Object.assign({ text: say.invited(name, title), undo: { kind: "merge", objects: [undoOf({ attendees: guests })], what: say.undoWhat.edit("the guests") } }, shown(title));
                    });
                });
            }
            if (args.change === "remove") {
                var keep = guests.filter(function (a) { return a.organizer || !(sameName(a.commonName || "", value) || sameName(a.email || "", value)); });
                if (keep.length === guests.length) return Object.assign({ text: say.notInvited(value.charAt(0).toUpperCase() + value.slice(1), title) }, shown(title));
                var gone = guests.filter(function (a) { return keep.indexOf(a) < 0; })[0];
                return merged(env, { _id: ev._id, attendees: keep, lastModified: now }).then(function () {
                    return Object.assign({ text: say.uninvited(gone.commonName || gone.email, title), undo: { kind: "merge", objects: [undoOf({ attendees: guests })], what: say.undoWhat.edit("the guests") } }, shown(title));
                });
            }
            return { text: say.cantEdit("event") };
        });
    }

    function editMemo(args, env) {
        var say = env.lang.say, now = env.now();
        return theMemo(env, args).then(function (n) {
            if (!n) return { text: args.it ? say.whatToChange() : say.noMemo(String(args.query || "")) };
            var old = String(n.text || ""), lines = old.split("\n"), title = lines[0] || "", value = String(args.value || "").trim(), text;
            if (args.change === "title") text = [value].concat(lines.slice(1)).join("\n");
            else if (args.change === "add") text = old.replace(/\s+$/, "") + "\n" + value;
            else if (args.change === "remove") {
                var rest = lines.slice(1).filter(function (l) { return !sameName(l, value); });
                if (rest.length === lines.length - 1) return { text: say.noTask(value) };
                text = [title].concat(rest).join("\n");
            } else return { text: say.cantEdit("memo") };
            var memo = { appId: MEMOS_APP, params: { memoId: n._id }, title: "Memos" };
            var newTitle = text.split("\n")[0];
            return merged(env, { _id: n._id, text: text, title: text.substring(0, 50), modifiedTimestamp: now }).then(function () {
                var said = args.change === "title" ? say.renamed(title, newTitle) : args.change === "add" ? say.noteAppended(title) : say.lineRemoved(value, title);
                return { text: said, open: memo, attachments: h.cards([{ title: newTitle, detail: text.split("\n").slice(1).join("\n"), open: memo }]),
                         undo: { kind: "merge", objects: [{ _id: n._id, text: old, title: old.substring(0, 50) }], what: say.undoWhat.memoBack() } };
            });
        });
    }

    // A list: by its name, or the one the task in focus is on.
    function theList(env, args) {
        if (!args.it) {
            return h.dbFind(env, "com.palm.tasklist:1").then(function (lists) {
                var n = h.words(args.query).replace(/ list$/, "");
                return lists.filter(function (l) { return h.words(l.name).replace(/ list$/, "") === n; })[0]
                    || lists.filter(function (l) { return h.words(l.name).indexOf(n) === 0; })[0] || null;
            });
        }
        var f = env.focus;
        return get(env, f.id).then(function (task) {
            return task ? get(env, task.listId).then(function (l) { return l || { _id: task.listId, name: "", isDefault: true }; }) : null;
        });
    }
    function editList(args, env) {
        var say = env.lang.say, value = String(args.value || "").trim();
        return theList(env, args).then(function (l) {
            if (!l) return { text: args.it ? say.whatToChange() : say.noList(String(args.query || "")) };
            var name = l.isDefault ? "" : l.name;
            if (args.change === "add") {
                return h.addTask(env, value.charAt(0).toUpperCase() + value.slice(1), name, null, false).then(function (r) {
                    return { text: say.taskAdded(r.task.summary, r.list.name, null, env.now(), false),
                             open: { appId: TASKS_APP, params: { taskId: r.taskId }, title: "Tasks" },
                             undo: { kind: "db", ids: [r.taskId], what: say.undoWhat.task(r.task.summary) } };
                });
            }
            if (args.change !== "remove") return { text: say.cantEdit("list") };
            return h.dbFind(env, "com.palm.task:1").then(function (tasks) {
                var open = tasks.filter(function (x) { return !x._del && !x.completed && x.listId === l._id; });
                var hit = open.filter(function (x) { return h.words(x.summary) === h.words(value); })[0] || open.filter(function (x) { return h.matches(x.summary, value); })[0];
                if (!hit) return { text: say.noTask(value) };
                return h.lunaCall(env, "luna://com.palm.db/del", { ids: [hit._id] }).then(function () {
                    return { text: say.taskRemoved(hit.summary, name), open: { appId: TASKS_APP, params: {}, title: "Tasks" },
                             undo: { kind: "put", objects: [hit], what: "put " + quote(hit.summary) + " back" } };
                });
            });
        });
    }

    function editContact(args, env) {
        var say = env.lang.say, value = String(args.value || "").trim();
        return h.findPerson(env, args.query).then(function (p) {
            if (!p) return { text: say.noSuchContact(args.query) };
            var name = h.personName(p), field = args.change, change = {}, old = {};
            if (field === "email") {
                old.emails = p.emails || [];
                var e = old.emails.slice(); e[0] = Object.assign({}, e[0] || { type: "type_home", primary: true }, { value: value });
                change.emails = e;
            } else if (field === "phone") {
                old.phoneNumbers = p.phoneNumbers || [];
                var ph = old.phoneNumbers.slice(); ph[0] = Object.assign({}, ph[0] || { type: "type_mobile", primary: true }, { value: value });
                change.phoneNumbers = ph;
            } else if (field === "address") {
                old.addresses = p.addresses || [];
                var ad = old.addresses.slice(); ad[0] = Object.assign({}, ad[0] || { type: "type_home" }, { streetAddress: value, locality: "", region: "", postalCode: "", country: "" });
                change.addresses = ad;
            } else if (field === "birthday") { old.birthday = p.birthday || ""; change.birthday = value; }
            else return { text: say.cantEdit("contact") };
            var ids = [p._id].concat(p.contactIds || []);
            var person = { appId: CONTACTS_APP, params: { launchType: "showPerson", id: p._id }, title: "Contacts" };
            return h.lunaCall(env, "luna://com.palm.db/merge", { objects: ids.map(function (id) { return Object.assign({ _id: id }, change); }) }).then(function () {
                return { text: say.contactChanged(name, field, value), open: person,
                         attachments: h.cards([{ title: name, subtitle: field === "email" ? value : field === "phone" ? value : "", open: person }]),
                         undo: { kind: "merge", objects: ids.map(function (id) { return Object.assign({ _id: id }, old); }), what: say.undoWhat.edit(name + "'s " + (field === "phone" ? "number" : field)) } };
            });
        });
    }

    function editAlarm(args, env) {
        var say = env.lang.say, now = env.now(), to = args.to || {};
        var nice = function (hh, mm) { return (hh % 12 || 12) + ":" + (mm < 10 ? "0" : "") + mm + " " + (hh < 12 ? "AM" : "PM"); };
        return h.dbFind(env, "com.palm.clock.alarm:1").then(function (all) {
            var live = all.filter(function (a) { return !a._del; });
            var hits = args.hour === null || args.hour === undefined ? live.filter(function (a) { return a.enabled; }) : live.filter(function (a) {
                var hh = Number(a.hour), want = Number(args.hour);
                var hourOk = args.meridiem === "am" ? hh === want % 12 : args.meridiem === "pm" ? hh === want % 12 + 12 : hh % 12 === want % 12;
                return hourOk && Number(a.minute) === Number(args.minute || 0);
            });
            if (!hits.length) return { text: say.noAlarmAt(args.hour === null || args.hour === undefined ? "" : nice(Number(args.hour) % 24, Number(args.minute || 0))) };
            if (hits.length > 1) return { text: say.whichAlarm(hits.map(function (a) { return a.niceTime; })) };
            var a = hits[0], hour = Number(to.hour) % 24, minute = Number(to.minute || 0);
            // The new time in the old one's half of the day unless said ("set my 7am alarm to 6:30": 6:30 AM).
            if (to.meridiem === "pm" && hour < 12) hour += 12;
            else if (to.meridiem === "am" && hour === 12) hour = 0;
            else if (!to.meridiem && hour < 12 && Number(a.hour) >= 12) hour += 12;
            var record = Object.assign({}, a, { hour: hour, minute: minute, niceTime: nice(hour, minute), enabled: true });
            var at = h.nextRing(record, now);
            return merged(env, { _id: a._id, hour: hour, minute: minute, niceTime: record.niceTime, enabled: true })
                .then(function () { return at ? h.scheduleAlarm(env, record, new Date(at)) : null; })
                .then(function () {
                    return { text: say.alarmChanged(a.niceTime, record.niceTime), open: { appId: "com.palm.app.clock", params: {}, title: "Clock" },
                             undo: { kind: "multi", steps: [{ kind: "merge", objects: [{ _id: a._id, hour: Number(a.hour), minute: Number(a.minute), niceTime: a.niceTime }] },
                                                            { kind: "alarmOn", ids: [a._id] }], what: say.undoWhat.edit("the alarm") } };
                });
        });
    }

    function edit(args, env) {
        var f = env.focus, kind = args.kind;
        if (args.it && !f) return Promise.resolve({ text: env.lang.say.whatToChange() });
        if (!kind && args.it) kind = f.kind === "task" ? "list" : f.kind;
        // A rename of the task in focus.
        if (kind === "list" && args.it && args.change === "title") {
            return get(env, f.id).then(function (task) {
                if (!task) return { text: env.lang.say.whatToChange() };
                var value = String(args.value || "").trim();
                return merged(env, { _id: task._id, summary: value, modifiedTime: env.now() }).then(function () {
                    return { text: env.lang.say.renamed(task.summary, value), open: { appId: TASKS_APP, params: { taskId: task._id }, title: "Tasks" },
                             undo: { kind: "merge", objects: [{ _id: task._id, summary: task.summary }], what: env.lang.say.undoWhat.edit(quote(value)) } };
                });
            });
        }
        if (args.it && kind && f.kind !== kind && !(kind === "list" && f.kind === "task")) return Promise.resolve({ text: env.lang.say.whatToChange() });
        if (kind === "event") return editEvent(args, env);
        if (kind === "memo") return editMemo(args, env);
        if (kind === "list") return editList(args, env);
        if (kind === "contact") return editContact(args, env);
        if (kind === "alarm") return editAlarm(args, env);
        return Promise.resolve({ text: env.lang.say.cantEdit(kind) });
    }

    // "it" in the other commands that change one item ("move it to 4",
    // "cancel it", "mark it done", "add the code to it"): the focus's words.
    function prepare(cmd, args, env) {
        var f = env.focus;
        var said = function (k) { return IT.test(String(args[k] || "").trim().toLowerCase()); };
        var key = (cmd.id === "eventMove" || cmd.id === "eventCancel") && f && f.kind === "event" ? "query"
            : cmd.id === "noteAppend" && f && f.kind === "memo" ? "query" : cmd.id === "taskDone" && f && f.kind === "task" ? "text" : "";
        if (!key || !said(key)) return Promise.resolve(args);
        // Its words as they are now (a card's title may be shortened, or missing).
        return get(env, f.id).then(function (o) {
            var words = o ? (f.kind === "event" ? o.subject : f.kind === "memo" ? String(o.text || "").split("\n")[0] : o.summary) : f.title;
            if (words) args[key] = words;
            return args;
        });
    }

    return {
        COMMANDS: COMMANDS,
        focusOf: focusOf,
        prepare: prepare,
        // "it" with no kind said ("what does it say"): the focus's kind.
        run: function (cmd, args, env) {
            if (cmd.id === "edit") return edit(args, env);
            if (cmd.id !== "detail") return null;
            var kind = args.kind || (args.it && env.focus ? env.focus.kind : "");
            if (kind === "memo" || (kind !== "event" && args.field === "text")) return memoDetail(args, env);
            return eventDetail(args, env);
        }
    };
};
