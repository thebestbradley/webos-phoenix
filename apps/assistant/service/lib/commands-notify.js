// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What came while you were away, and messages said aloud (docs/AI-AND-MCP.md,
// "Everyday features"):
//
//   notifications     "what did I miss", "read my notifications (from
//                     Messaging)": the shell's notification list
//                     (org.webosphoenix.system getNotifications, which the
//                     shell's NotificationFeed.qml keeps: the runtime's in the
//                     simulator, services/shellhost on a device), grouped by
//                     app, the app with the newest one first and each app's
//                     newest first. Over the lock screen with Show previews
//                     off (Settings > Screen & Lock), how many from which app
//                     only, as the lock screen itself shows them
//                     (LockScreen.qml privatePreviews).
//   drivingMode       "I'm driving", "driving mode off", "am I in driving
//                     mode": while on, messages are said as they come and the
//                     reply is listened for (announce below), and the rest is
//                     quiet: Do Not Disturb (the ringer off, as webOS's mute
//                     switch: the toggle's dnd), as it was again when it ends.
//   announceMessages  "announce my messages on my headphones": with
//                     headphones in (a wired headset, a Bluetooth headset),
//                     each message is said as it comes (Settings > Assistant
//                     > Announce Messages, off by default).
//
// The service's own methods (service() below; assistant.js adds them):
//   announce {appId, app, title, body, headphones}  the shell, for each
//       notification that comes (NotificationFeed.qml) -> {spoken, listen}:
//       a message said aloud when driving mode is on, or announcements are
//       on and headphones are in; put in the conversation, so "reply ..."
//       answers it. listen (driving mode): the shell listens for the reply,
//       whose read-back is spoken and answered by voice like any other.
//   driving {on?}  -> {on, since}: driving mode as it is, or set (Settings).
//
// Made by lib/commands-everyday.js with lib/commands.js's helpers.

"use strict";

var SYSTEM = "luna://org.webosphoenix.system/";
var DRIVING_KEY = "assistant:driving";
// The apps whose notifications are messages: Messaging (texts and the chat
// networks it carries) and the chat apps.
var MESSAGE_APP = /(?:^|\.)(?:messaging|telegram|chat|jabber|matrix|deltachat|signal)(?:$|\.)/i;
var MOST = 6;       // notifications said by name, in all
var PER_APP = 3;    // ... from one app

var STATE = { type: "string", enum: ["on", "off", "status"] };
var COMMANDS = [
    { id: "notifications", title: "Notifications", risk: "read", whenLocked: true,
      description: "Read the notifications that came (what the user missed), grouped by app, newest first; or those of one app.",
      parameters: { type: "object", properties: { app: { type: "string", description: "One app's notifications (\"Messaging\", \"Email\"); empty for all" } } },
      examples: ["catch me up on what came in", "anything new on my phone", "go through my alerts", "what came in from email"] },
    { id: "drivingMode", title: "Driving mode", risk: "change", whenLocked: true,
      description: "Turn driving mode on or off, or tell whether it is on: messages read aloud as they come, replies by voice, everything else quiet.",
      parameters: { type: "object", properties: { state: STATE }, required: ["state"] },
      examples: ["I'm behind the wheel now", "I'm about to drive", "I've parked, stop driving mode", "am I in driving mode"] },
    { id: "announceMessages", title: "Announcing messages", risk: "change",
      description: "Turn on or off saying messages aloud as they come while headphones are in, or tell whether it is on.",
      parameters: { type: "object", properties: { state: STATE }, required: ["state"] },
      examples: ["read my texts to me when my earbuds are in", "say new messages out loud in my headphones", "stop reading messages in my headphones"] },
    // The answer to an announcement's "Want to reply?": "yes" asks what to
    // say; words are the reply, read back as replyMessage reads it back.
    { id: "replyTo", title: "Replying to a message said aloud", risk: "send", internal: true,
      description: "Reply to the message just read aloud.",
      parameters: { type: "object", properties: { message: { type: "string" } } } }
];
var YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|reply|yes reply|yes please|go ahead|please do|i do|let's reply)$/;
module.exports = function (h) {
    function modeOf(env) { return env.storage.get(DRIVING_KEY) || { on: false, since: 0, dndBefore: false }; }

    function words(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
    // One app's, by its name or its id's words ("messages": Messaging; "email": Email).
    function ofApp(n, app) {
        var w = words(app).replace(/\b(?:app|my|the|new)\b/g, "").replace(/\s+/g, " ").trim().replace(/s$/, "");
        if (!w) return true;
        var name = words(n.app), id = words(n.appId);
        return name.indexOf(w) >= 0 || id.indexOf(w) >= 0 || (w === "text" && /messag/.test(name + " " + id)) ||
               (w === "mail" && /mail/.test(name + " " + id)) || (w === "call" && /phone/.test(name + " " + id));
    }
    // By app: [{appId, app, items (newest first), newest}], the newest app first.
    function grouped(list) {
        var byApp = {}, order = [];
        list.forEach(function (n) {
            var k = n.appId || n.app;
            if (!byApp[k]) { byApp[k] = { appId: n.appId, app: n.app || n.appId, items: [], newest: 0 }; order.push(k); }
            byApp[k].items.push(n);
            byApp[k].newest = Math.max(byApp[k].newest, Number(n.time) || 0);
        });
        var groups = order.map(function (k) { return byApp[k]; });
        groups.forEach(function (g) { g.items.sort(function (a, b) { return (b.time || 0) - (a.time || 0); }); });
        groups.sort(function (a, b) { return b.newest - a.newest; });
        return groups;
    }
    function read(args, env) {
        var say = env.lang.say;
        return h.lunaCall(env, SYSTEM + "getNotifications", {}).then(function (r) {
            var all = (r.notifications || []).filter(function (n) { return n && !n.ongoing; });
            var list = args.app ? all.filter(function (n) { return ofApp(n, args.app); }) : all;
            var groups = grouped(list);
            var app = args.app ? (groups[0] ? groups[0].app : String(args.app).replace(/^\w/, function (c) { return c.toUpperCase(); })) : "";
            if (!list.length) return { text: say.noNotifications(app) };
            // Locked, previews off: which apps and how many, nothing more.
            if (r.private) return { text: say.notificationsPrivate(groups.map(function (g) { return { app: g.app, count: g.items.length }; })) };
            var shown = 0, told = [];
            groups.forEach(function (g) {
                var items = g.items.slice(0, Math.max(0, Math.min(PER_APP, MOST - shown)));
                shown += items.length;
                told.push({ app: g.app, count: g.items.length, items: items.map(function (n) { return { title: n.title, body: n.body }; }) });
            });
            var cards = [];
            groups.forEach(function (g) {
                g.items.forEach(function (n) {
                    cards.push({ title: n.title || g.app, subtitle: [g.app, h.whenShown(env, n.time, null, false)].filter(Boolean).join(" · "),
                                 detail: n.body || "", open: { appId: n.appId, params: {}, title: g.app } });
                });
            });
            var one = groups.length === 1 ? { appId: groups[0].appId, params: {}, title: groups[0].app } : undefined;
            return { text: say.notificationsRead(list.length, told), attachments: h.cards(cards), open: one };
        }, function (e) {
            return { text: say.failed(e && e.message || "the notifications can't be read"), failed: true };
        });
    }

    function driving(args, env) {
        var say = env.lang.say, m = modeOf(env), now = env.now();
        if (args.state === "status") return Promise.resolve({ text: say.drivingStatus(m.on, m.since, now) });
        var on = args.state === "on";
        if (on === m.on) return Promise.resolve({ text: say.drivingAlready(on) });
        if (on) {
            // Do Not Disturb as it was, to put back when driving ends.
            return h.TOGGLE_STATE.dnd(env).catch(function () { return false; }).then(function (before) {
                return h.TOGGLE_RUN.dnd(env, true).then(function () {
                    env.storage.set(DRIVING_KEY, { on: true, since: now, dndBefore: !!before });
                    return { text: say.drivingOn(), data: { driving: true } };
                });
            });
        }
        env.storage.set(DRIVING_KEY, { on: false, since: 0, dndBefore: false });
        var back = m.dndBefore ? Promise.resolve() : h.TOGGLE_RUN.dnd(env, false);
        return back.then(function () { return { text: say.drivingOff(m.since, now), data: { driving: false } }; });
    }

    function announceSetting(args, env) {
        var say = env.lang.say, on = !!(env.settings && env.settings.announceMessages);
        if (args.state === "status") return Promise.resolve({ text: say.announceStatus(on) });
        var want = args.state === "on";
        if (!env.setSettings) return Promise.resolve({ text: say.failed("the setting can't be changed here"), failed: true });
        return Promise.resolve(env.setSettings({ announceMessages: want })).then(function () {
            return { text: say.announceSet(want), open: { appId: "org.webosphoenix.settings", params: { page: "assistant" }, title: "Settings" } };
        });
    }

    // ---- The service's methods ------------------------------------------------------------------
    // s: assistant.js's {settings(), env(), speak(text), privileged(), conversation(text, last) -> thread id}.
    function service(s) {
        return {
            announce: function (p) {
                if (!s.privileged()) return Promise.resolve({ returnValue: false, errorCode: -3, errorText: "Only the system UI announces" });
                var e = s.env(), set = s.settings(), mode = modeOf(e);
                var message = MESSAGE_APP.test(String(p.appId || ""));
                var why = !message ? "" : mode.on ? "driving" : set.announceMessages && p.headphones === true ? "headphones" : "";
                if (!why) return Promise.resolve({ returnValue: true, spoken: false, listen: false });
                var text = e.lang.say.announceMessage(String(p.title || p.app || ""), String(p.body || ""), why === "driving");
                // Driving: the next words answer "Want to reply?" (replyTo).
                var tid = s.conversation(text, { command: "readMessages", args: {}, status: "done" },
                                         why === "driving" ? { awaiting: { command: "replyTo", args: {}, field: "message" } } : null);
                s.speak(text);
                return Promise.resolve({ returnValue: true, spoken: true, listen: why === "driving", threadId: tid, text: text });
            },
            driving: function (p) {
                var e = s.env();
                if (typeof p.on !== "boolean") {
                    var m = modeOf(e);
                    return Promise.resolve({ returnValue: true, on: !!m.on, since: m.since || 0 });
                }
                if (!s.privileged()) return Promise.resolve({ returnValue: false, errorCode: -3, errorText: "Not allowed" });
                return driving({ state: p.on ? "on" : "off" }, e).then(function (r) {
                    var m = modeOf(e);
                    return { returnValue: true, on: !!m.on, since: m.since || 0, text: r.text };
                });
            }
        };
    }

    return {
        COMMANDS: COMMANDS,
        METHODS: ["announce", "driving"],
        service: service,
        prepare: function (cmd, args, env) {
            if (cmd.id !== "replyTo") return null;
            var reply = h.find(h.BUILT_IN, "replyMessage");
            var said = env.lang.clean(String(args.message || ""));
            if (!said || YES.test(said)) {
                return h.prepare(reply, {}, env).then(function (p) {
                    if (p.reply) return p;
                    return { args: {}, reply: env.lang.say.whatToSay(p.args.name || p.args.number), awaiting: { command: "replyMessage", args: {}, field: "message" } };
                });
            }
            return h.prepare(reply, { message: args.message }, env);
        },
        run: function (cmd, args, env) {
            if (cmd.id === "replyTo") return h.run(h.find(h.BUILT_IN, "replyMessage"), args, env);
            if (cmd.id === "notifications") return read(args, env);
            if (cmd.id === "drivingMode") return driving(args, env);
            if (cmd.id === "announceMessages") return announceSetting(args, env);
            return null;
        },
        // For lib/commands-everyday.js's routines ("good night"): driving mode as it is.
        drivingOn: function (env) { return !!modeOf(env).on; }
    };
};
