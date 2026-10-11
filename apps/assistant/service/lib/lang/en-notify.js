// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-notify.js: what did I miss, announcing
// messages, driving mode. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    var NOTE = "(?:notifications?|alerts?|notifs?)";
    var FROM = "(?: (?:from|in|on|for) (?:my |the )?(.+?)(?: app)?)?(?: today| tonight| this morning| lately| so far)?";
    var READ = new RegExp("^(?:read|show|tell|give|go through|check|play|list|open|see)(?: me)?(?: all)?(?: of)?(?: my| the)?(?: new| recent| latest| unread)? " + NOTE + FROM + "(?: to me| aloud| out loud| please)?$");
    var ANY = new RegExp("^(?:(?:do i have|have i got|are there|is there|did i get|i have) )?any(?:thing)? (?:new )?" + NOTE + FROM + "\\??$");
    var WHAT = new RegExp("^what(?:'s| are| is)?(?: in)? (?:my |the |new )*" + NOTE + "(?: do i have| have i got| are there| came in)?" + FROM + "$");
    var MISSED = /^(?:what (?:did|have) i (?:just )?miss(?:ed)?|what i(?:'ve)? missed|what else did i miss|did i miss anything|have i missed anything|anything i missed|what's (?:been )?happening on my (?:phone|tablet)|catch me up|fill me in|what came in(?: while i was (?:away|out|busy|gone))?|(?:what's|what is) waiting for me)$/;
    function notifications(t) {
        if (MISSED.test(t)) return { app: "" };
        var m = READ.exec(t) || ANY.exec(t) || WHAT.exec(t);
        if (!m) return null;
        var app = String(m[1] || "").replace(/^(?:my|the) /, "").trim();
        // "what notifications do I have today": no app called "today".
        if (/^(?:today|tonight|now|this morning|lately)$/.test(app)) app = "";
        return { app: app };
    }

    var DRIVE_ON = /^(?:(?:i'm|i am|we're|we are) (?:driving|in the car|behind the wheel|on the road|about to drive|getting in the car|starting to drive|heading out in the car)(?: now)?|(?:turn on|start|enable|activate|switch on|begin|put (?:me|the phone|it) in|go into|enter) (?:the )?(?:driving|car) mode|(?:driving|car) mode(?: on)?|(?:turn|switch) (?:the )?(?:driving|car) mode on)$/;
    var DRIVE_OFF = /^(?:(?:i'm|i am|we're|we are) (?:done|finished|not) driving(?: anymore| any more)?|(?:i've|i have|we've|we have) (?:stopped driving|arrived|parked)|(?:i|we) (?:stopped driving|arrived|parked)|(?:turn off|stop|end|disable|deactivate|switch off|exit|leave|cancel|quit) (?:the )?(?:driving|car) mode|(?:driving|car) mode off|(?:turn|switch) (?:the )?(?:driving|car) mode off)$/;
    var DRIVE_STATUS = /^(?:is (?:the )?(?:driving|car) mode (?:on|off)|am i (?:in|on) (?:the )?(?:driving|car) mode|is my phone in (?:driving|car) mode)$/;
    function drivingMode(t) {
        if (DRIVE_OFF.test(t)) return { state: "off" };
        if (DRIVE_STATUS.test(t)) return { state: "status" };
        if (DRIVE_ON.test(t)) return { state: "on" };
        return null;
    }

    var MSGS = "(?:my |new |incoming )*(?:messages|texts|text messages|notifications)";
    var EARS = "(?: (?:on|in|through|over|when i'm wearing|while i'm wearing|when i have|when i've got|with) (?:my )?(?:headphones|headset|earbuds|earphones|airpods|ear ?buds))?";
    var ANN_ON = new RegExp("^(?:(?:turn on|enable|start|switch on) )?(?:announc(?:e|ing) " + MSGS + EARS + "|read " + MSGS + " (?:aloud|out loud|to me)(?: as they come in| when they come in| when they arrive)?" + EARS + ")(?: on)?$");
    var ANN_OFF = new RegExp("^(?:(?:turn off|disable|stop|switch off) )(?:announc(?:e|ing) " + MSGS + EARS + "|reading " + MSGS + " (?:aloud|out loud|to me)" + EARS + ")$|^(?:announc(?:e|ing) " + MSGS + EARS + " off)$");
    var ANN_STATUS = new RegExp("^(?:are|do you) (?:you )?(?:announc(?:e|ing)) " + MSGS + EARS + "$|^(?:is )?announce messages (?:on|turned on)$");
    function announceMessages(t) {
        if (ANN_OFF.test(t)) return { state: "off" };
        if (ANN_STATUS.test(t)) return { state: "status" };
        if (ANN_ON.test(t)) return { state: "on" };
        return null;
    }

    function plural(n, one, many) { return n === 1 ? "1 " + one : n + " " + (many || one + "s"); }
    function quoted(s) { return "“" + s + "”"; }
    // A full stop, unless it ends with one already (inside quotes too: “Lunch at noon?”).
    function sentence(s) { return /[.!?…]["”]?$/.test(s) ? s : s + "."; }
    // At most this long, cut at a word.
    function shortened(s, n) {
        s = String(s || "").replace(/\s+/g, " ").trim();
        if (s.length <= n) return s;
        return s.slice(0, n).replace(/\s+\S*$/, "") + "…";
    }
    function minutes(ms) { var m = Math.round(ms / 60000); return m < 60 ? plural(Math.max(1, m), "minute") : plural(Math.round(m / 60), "hour"); }

    var say = {
        noNotifications: function (app) { return app ? "No notifications from " + app + "." : "Nothing new: you're all caught up."; },
        // [{app, count}]: locked, previews off.
        notificationsPrivate: function (groups) {
            var n = groups.reduce(function (s, g) { return s + g.count; }, 0);
            return "You have " + plural(n, "notification") + ": " + h.list(groups.map(function (g) { return g.count + " from " + g.app; })) +
                   ". Unlock your phone to hear what they say.";
        },
        // told: [{app, count, items: [{title, body}]}], the newest app first.
        notificationsRead: function (n, told) {
            var parts = told.map(function (g) {
                var items = g.items.map(function (x) {
                    var who = x.title && x.title !== g.app ? x.title : "";
                    var what = x.body ? quoted(shortened(x.body, 90)) : "";
                    return who && what ? who + ", " + what : who || what || "a notification";
                });
                var more = g.count - g.items.length;
                if (more > 0) items.push(plural(more, "more", "more"));
                return (told.length > 1 || g.count > 1 ? "From " + g.app + ": " : g.app + ": ") + (items.length ? items.join("; ") : plural(g.count, "notification"));
            });
            return (n === 1 ? "You have 1 notification. " : "You have " + n + " notifications. ") + parts.map(sentence).join(" ");
        },
        drivingOn: function () { return "Driving mode is on. I'll read your messages as they come and listen for your reply; everything else stays quiet. Drive safely."; },
        drivingOff: function (since, now) { return "Driving mode is off" + (since ? " after " + minutes(now - since) : "") + ". Your notifications are back as they were."; },
        drivingAlready: function (on) { return on ? "Driving mode is already on." : "Driving mode is already off."; },
        drivingStatus: function (on, since, now) { return on ? "Yes, driving mode has been on for " + minutes(now - since) + "." : "No, driving mode is off."; },
        announceSet: function (on) {
            return on ? "OK, I'll read your messages aloud as they come while your headphones are in." : "OK, I won't read your messages aloud any more.";
        },
        announceStatus: function (on) { return on ? "Yes, I read your messages aloud when your headphones are in." : "No, I don't read messages aloud on your headphones. Want me to?"; },
        // A message as it comes (driving: and a reply is listened for).
        announceMessage: function (who, body, driving) {
            var w = String(who || "").trim() || "Someone";
            return (body ? w + " says: " + shortened(body, 240) : "New message from " + w + ".").replace(/([^.!?…])$/, "$1.") +
                   (driving ? " Want to reply?" : "");
        }
    };

    return {
        rules: [["notifications", notifications], ["drivingMode", drivingMode], ["announceMessages", announceMessages]],
        say: say,
        MENTIONS: {
            drivingMode: /\b(driv\w*|car|wheel|road)\b/,
            announceMessages: /\b(announc\w*|aloud|out loud|read|say|speak)\b/
        },
        describe: function (command, args) {
            if (command === "drivingMode") return args.state === "off" ? "turn driving mode off" : args.state === "status" ? "check driving mode" : "turn driving mode on";
            if (command === "announceMessages") return args.state === "off" ? "stop reading messages aloud" : "read messages aloud on your headphones";
            return "";
        },
        help: { title: "Notifications & Driving", examples: ["What did I miss?", "Read my notifications from Messaging", "I'm driving", "Announce my messages on my headphones"] }
    };
};
