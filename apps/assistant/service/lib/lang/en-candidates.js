// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The decision model's options (docs/AI-AND-MCP.md "A decision model"):
// for words the grammar did not take, the complete requests they come
// close to, each said as the grammar takes it ("turn bluetooth off",
// "turn off the 7:00 AM alarm", "call Sam Delgado"). The service parses
// each (lib/grammar.js), so an option is always a valid command with its
// arguments; the decision model only picks one. Nothing here guesses free
// words (a memo's text, a message): those are the general model's.
//
// candidates(t, world, last, now) -> [sentence], the likeliest first;
// world {names, alarms [{hour, minute}], events [{title}], apps [title]}.

"use strict";

module.exports = function (h) {
    var M = h.MENTIONS;
    var SETTING = { wifi: "wi-fi", bluetooth: "bluetooth", airplane: "airplane mode", flashlight: "the flashlight",
                    ringer: "the ringer", dnd: "do not disturb", location: "location services", hotspot: "the hotspot",
                    vpn: "the vpn", rotationLock: "rotation lock" };
    var STOP = /^(?:my|the|a|an|with|and|at|on|in|to|for|of|is|it|me|i|you|this|that|meeting|event|appointment)$/;

    function clockText(hour, minute) {
        return (hour % 12 || 12) + ":" + (minute < 10 ? "0" : "") + minute + " " + (hour < 12 ? "am" : "pm");
    }
    // The time the words name, as the grammar says it back ("5:30 am tomorrow").
    function timeSaid(t, now) {
        var info = h.extract(t, now);
        // ("for 7": the "at" the time words need, as the alarm rule does.)
        if (!info.clock && info.relative === undefined) info = h.extract(t.replace(/\b(?:for|by) (\d{1,2}(?::\d\d)?)\b/, "at $1"), now);
        if (!info.clock && info.relative === undefined) return "";
        var r = h.resolve(info, now, "alarm");
        if (r.start === null || r.allDay) return "";
        var d = new Date(r.start), days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
        return clockText(d.getHours(), d.getMinutes()) + (days === 1 ? " tomorrow" : "");
    }
    function durationSaid(t) {
        var m = /(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|ninety|half an?) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/.exec(t);
        var s = m ? h.duration(m[0]) : 0;
        return s ? s : 0;
    }
    function people(t, names) {
        var out = [];
        (names || []).forEach(function (n) {
            var low = String(n).toLowerCase(), first = low.split(" ")[0];
            if (new RegExp("\\b" + low.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t) || (first.length > 2 && new RegExp("\\b" + first + "\\b").test(t)))
                if (out.indexOf(n) < 0) out.push(n);
        });
        // The fullest name of each person ("Sam Delgado" over "Sam").
        return out.filter(function (n) { return !out.some(function (o) { return o !== n && o.toLowerCase().indexOf(n.toLowerCase() + " ") === 0; }); }).slice(0, 2);
    }
    function overlaps(t, title) {
        return String(title || "").toLowerCase().split(/\W+/).some(function (w) { return w.length > 2 && !STOP.test(w) && new RegExp("\\b" + w + "s?\\b").test(t); });
    }

    return function candidates(t, world, last, now) {
        t = String(t || "").toLowerCase();
        world = world || {};
        var out = [], add = function (s) { if (out.indexOf(s) < 0) out.push(s); };
        // The previous turn's switch, the other way ("no, the other way", "actually leave it on").
        if (last && last.command === "toggle" && last.args && SETTING[last.args.setting] && /\b(?:it|that|other|back|leave|keep)\b/.test(t))
            add("turn " + SETTING[last.args.setting] + " " + (last.args.state === "on" ? "off" : "on"));
        // A switch the words name: on, off, or is it on.
        Object.keys(SETTING).forEach(function (k) {
            if (!M.toggle[k] || !M.toggle[k].test(t)) return;
            add("turn " + SETTING[k] + " off");
            add("turn " + SETTING[k] + " on");
            add("is " + SETTING[k] + " on");
        });
        if (M.volume.test(t) || /\b(?:hear|deafening|noisy|noise|can't hear)\b/.test(t)) { add("turn the volume up"); add("turn the volume down"); }
        if (M.brightness.test(t) || /\b(?:display|blinding|see the screen|can't see)\b/.test(t)) { add("turn the brightness up"); add("turn the brightness down"); }
        // Alarms: the time said, the ones there are.
        var when = timeSaid(t, now);
        if (M.alarm.test(t) || M.alarmManage.test(t) || /\b(?:wake|waking|woken|up at)\b/.test(t)) {
            if (when) add("set an alarm for " + when);
            (world.alarms || []).slice(0, 3).forEach(function (a) {
                var c = clockText(a.hour, a.minute);
                add("turn off the " + c + " alarm");
                add("delete the " + c + " alarm");
            });
            add("what alarms do i have");
        }
        // Timers: the length said.
        var secs = durationSaid(t);
        if (secs && !/\b(?:ago|every)\b/.test(t)) add("set a timer for " + (secs % 60 ? secs + " seconds" : secs / 60 + " minutes"));
        if (M.timer.test(t) || M.timerCancel.test(t) || /\b(?:done|ready|up)\b/.test(t) && secs) { add("how much time is left on the timer"); add("cancel the timer"); }
        if (/\b(?:stop ?watch|time how long|how long .* takes)\b/.test(t)) add("start the stopwatch");
        // People the words name.
        // (Not to call or text someone a reminder or an event is about: "remind me to call mom".)
        var about = /^(?:remind|schedule|add|put|book|plan|set up)\b|\bremind me\b|\b(?:meeting|appointment|calendar|lunch|dinner)\b/.test(t);
        people(t, world.names).forEach(function (n) {
            if (!about) {
                add("call " + n);
                add("text " + n);
                add("email " + n);
            }
            add("what's " + n + "'s number");
            if (/\b(?:e-?mails?|mail|inbox)\b/.test(t)) add("show emails from " + n);
        });
        // Events the words point at, and the calendar.
        (world.events || []).filter(function (e) { return overlaps(t, e.title); }).slice(0, 2).forEach(function (e) {
            var title = String(e.title).toLowerCase();
            if (when) add("move my " + title + " to " + when);
            add("cancel my " + title);
            add("when is my " + title);
        });
        if (M.event.test(t) || /\b(?:busy|free|plans|on for|look like|week|today|tomorrow)\b/.test(t)) {
            add(/\btomorrow\b/.test(t) ? "what's on my calendar tomorrow" : /\bnext week\b/.test(t) ? "what's on my calendar next week"
                : /\bweek\b/.test(t) ? "what's on my calendar this week" : "what's on my calendar today");
        }
        // Messages and mail.
        if (/\b(?:message|messages|texted|text me|texts|inbox|heard from|word from)\b/.test(t)) add("read my messages");
        if (/\b(?:e-?mails?|mail|inbox)\b/.test(t)) { add("read my latest email"); add("check my email"); }
        // Music.
        // ("next" alone is no music: "next week".)
        if (/\b(?:play|playing|pause|resume|skip|song|songs|track|music|radio|tunes|album|listen)\b/.test(t)) {
            add("play music"); add("pause the music"); add("resume the music"); add("next song");
        }
        if (/\b(?:weather|rain|raining|sunny|snow|umbrella|sunscreen|forecast|temperature|hot|cold|warm|high today)\b/.test(t))
            add(/\btomorrow\b/.test(t) ? "what's the weather tomorrow" : "what's the weather");
        if (/\bbattery\b/.test(t)) add("how much battery do i have");
        if (M.screenshot.test(t)) add("take a screenshot");
        if (/\b(?:picture|pictures|photo|photos|selfie)\b/.test(t)) { add("open camera"); add("open photos"); }
        // Apps the words name.
        (world.apps || []).forEach(function (a) {
            var low = String(a).toLowerCase();
            if (low.length > 2 && new RegExp("\\b" + low.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t)) add("open " + low);
        });
        return out;
    };
};
