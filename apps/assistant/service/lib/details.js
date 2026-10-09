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
          it: { type: "boolean", description: "The item the conversation is about (\"where is it\")" } }, required: ["field"] } }
];

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

    return {
        COMMANDS: COMMANDS,
        focusOf: focusOf,
        // "it" with no kind said ("what does it say"): the focus's kind.
        run: function (cmd, args, env) {
            if (cmd.id !== "detail") return null;
            var kind = args.kind || (args.it && env.focus ? env.focus.kind : "");
            if (kind === "memo" || (kind !== "event" && args.field === "text")) return memoDetail(args, env);
            return eventDetail(args, env);
        }
    };
};
