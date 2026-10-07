// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Assistant's English: the command grammar (layer 2 of
// docs/M6-PLAN.md F3: no language model, instant, offline) and what the
// assistant says back. Another language is another file shaped like this
// one (lib/lang/<code>.js) registered in lib/grammar.js:
//
//   id, name
//   clean(text) -> text          lower case, no politeness, no end punctuation
//   rules: [[command, fn(text, ctx) -> args | null]], tried in order
//   duration(text) -> seconds | null
//   clock(text) -> {hour, minute, meridiem} | null
//   when(text, now, opts) -> ms | null      "at 5", "tomorrow at 9", "in 20 minutes"
//   arithmetic(text) -> expression for lib/arith.js | null
//   say: replies, one function each (see the bottom)
//
// ctx: {apps: [{id, title, keywords?}], names: [contact names],
//       appCommands: [{key, phrases: [regexp source with (.+) for {text}]}]}

"use strict";

// ---- Numbers in words -------------------------------------------------------------------

var UNITS = {
    zero: 0, oh: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, couple: 2, few: 3
};
var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
var NUMBER_WORD = "(?:" + Object.keys(UNITS).concat(Object.keys(TENS), ["hundred", "thousand", "million", "and"]).join("|") + ")";

// "twenty five" -> 25, "a hundred and ten" -> 110, "3.5" -> 3.5; null if not a number.
function number(text) {
    var t = String(text || "").trim().toLowerCase().replace(/-/g, " ");
    if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
    if (!t) return null;
    var words = t.split(/\s+/), total = 0, cur = 0, any = false;
    for (var i = 0; i < words.length; ++i) {
        var w = words[i];
        if (w === "and" && any) continue;
        if (w in UNITS && !(w === "a" && i + 1 >= words.length)) { cur += UNITS[w]; any = true; }
        else if (w in TENS) { cur += TENS[w]; any = true; }
        else if (w === "hundred") { cur = (cur || 1) * 100; any = true; }
        else if (w === "thousand" || w === "million") { total += (cur || 1) * (w === "thousand" ? 1000 : 1e6); cur = 0; any = true; }
        else return null;
    }
    return any ? total + cur : null;
}
// Number words in a text turned into digits ("set a timer for ten minutes").
function digits(text) {
    var re = new RegExp("\\b" + NUMBER_WORD + "(?:[\\s-]+" + NUMBER_WORD + ")*\\b", "g");
    return String(text).replace(re, function (m) {
        // "a"/"an"/"and" alone are words, not numbers.
        if (/^(a|an|and|oh|few|couple)$/.test(m)) return m;
        var lead = /^(a|an)\s+(?!hundred|thousand|million)/.exec(m);
        var body = lead ? m.slice(lead[0].length) : m;
        var n = number(body.replace(/\s+and$/, ""));
        if (n === null) return m;
        return (lead ? lead[0] : "") + n + (/\s+and$/.test(body) ? " and" : "");
    });
}

// ---- Durations ---------------------------------------------------------------------------

var UNIT_SECONDS = [
    [/^(?:h|hr|hrs|hour|hours)$/, 3600], [/^(?:m|min|mins|minute|minutes)$/, 60], [/^(?:s|sec|secs|second|seconds)$/, 1]
];
// "10 minutes", "an hour and a half", "1h30", "half an hour", "90 seconds", "2 and a half minutes"
function duration(text) {
    var t = digits(String(text || "").toLowerCase()).replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return null;
    if (/^half an? (?:hour|hr)$/.test(t)) return 1800;
    if (/^(?:a )?quarter (?:of an? )?hour$/.test(t)) return 900;
    var m = /^(\d+)h ?(\d+)(?:m|min)?$/.exec(t);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
    var total = 0, rest = t, found = false;
    var part = /^(?:and )?(\d+(?:\.\d+)?|an?|one)(?: and (?:a )?half)? ?(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b(?: and a half)?/;
    while (rest) {
        var p = part.exec(rest);
        if (!p) break;
        var n = /^an?$|^one$/.test(p[1]) ? 1 : Number(p[1]);
        if (/ and (?:a )?half/.test(p[0])) n += 0.5;
        var unit = 0;
        for (var i = 0; i < UNIT_SECONDS.length; ++i) if (UNIT_SECONDS[i][0].test(p[2])) unit = UNIT_SECONDS[i][1];
        total += n * unit;
        found = true;
        rest = rest.slice(p[0].length).trim();
    }
    if (!found || rest) return null;
    return Math.round(total);
}

// ---- Clock times -------------------------------------------------------------------------

// "7", "7am", "7:30 pm", "7.30", "noon", "half past six", "quarter to 8",
// "seven thirty", "6 in the morning", "8 tonight" -> {hour 0-23 or 1-12, minute, meridiem}
function clock(text) {
    var raw = String(text || "").toLowerCase().trim();
    // "seven thirty", "six oh five": an hour and its minutes in words.
    var w = /^([a-z]+) (?:oh )?([a-z]+(?:[ -][a-z]+)?)((?: (?:am|pm|a\.m\.|p\.m\.))?)$/.exec(raw);
    if (w && number(w[1]) !== null && number(w[1]) >= 1 && number(w[1]) <= 12 && number(w[2]) !== null && number(w[2]) < 60 && !/^(?:am|pm)$/.test(w[2]))
        raw = number(w[1]) + ":" + (number(w[2]) < 10 ? "0" : "") + number(w[2]) + w[3];
    var t = digits(raw).replace(/\./g, ":").replace(/\s+/g, " ").trim();
    var mer = null;
    var tail = /\s*(?:(a\s?m|p\s?m|o'?clock)|in the (morning|afternoon|evening)|at night|tonight|this (morning|afternoon|evening))$/.exec(t);
    if (tail) {
        var w = tail[0];
        if (/a\s?m|morning/.test(w)) mer = "am";
        else if (/p\s?m|afternoon|evening|night/.test(w)) mer = "pm";
        t = t.slice(0, tail.index).trim();
    }
    if (t === "noon" || t === "midday") return { hour: 12, minute: 0, meridiem: "pm" };
    if (t === "midnight") return { hour: 0, minute: 0, meridiem: "am" };
    var m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t) || /^(\d{1,2}) (\d{2})$/.exec(t);
    if (m) {
        var h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
        if (h > 23 || min > 59) return null;
        if (h > 12 || h === 0) mer = null;
        return { hour: h, minute: min, meridiem: h > 12 || (h === 0 && !mer) ? "24" : mer };
    }
    m = /^(half|quarter|\d{1,2}) (past|after|to|before) (\d{1,2})$/.exec(t);
    if (m) {
        var mins = m[1] === "half" ? 30 : m[1] === "quarter" ? 15 : Number(m[1]);
        var hour = Number(m[3]);
        if (hour > 12 || mins > 59) return null;
        if (/to|before/.test(m[2])) { hour = hour === 1 ? 12 : hour - 1; mins = 60 - mins; }
        return { hour: hour, minute: mins, meridiem: mer };
    }
    return null;
}
// The next moment a clock time comes, from `now`. Without am/pm, the next
// of the two (preferAm: the morning one when it is a whole day ahead).
function nextClock(c, now, day, preferAm) {
    var base = new Date(now);
    if (day === "tomorrow") base.setDate(base.getDate() + 1);
    var hours;
    if (c.meridiem === "24") hours = [c.hour];
    else if (c.meridiem === "am") hours = [c.hour % 12];
    else if (c.meridiem === "pm") hours = [c.hour % 12 + 12];
    else hours = preferAm ? [c.hour % 12] : [c.hour % 12, c.hour % 12 + 12];
    var best = null;
    for (var add = 0; add < 3 && best === null; ++add) {
        hours.forEach(function (h) {
            var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add, h, c.minute, 0, 0).getTime();
            if (d > now && (best === null || d < best)) best = d;
        });
        if (day === "tomorrow" || day === "today") break;
    }
    return best;
}

var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// When something should happen: "in 20 minutes", "at 5", "at 5pm tomorrow",
// "tomorrow", "tonight", "on friday at 9". ms since the epoch, or null.
function when(text, now, opts) {
    // (Number words stay words: clock() reads "seven thirty" as 7:30.)
    var t = String(text || "").toLowerCase().trim();
    var m = /^in (.+)$/.exec(t);
    if (m) {
        var s = duration(m[1]);
        return s === null ? null : now + s * 1000;
    }
    var day = null, wd = -1;
    var d = /\b(today|tonight|tomorrow(?: morning| afternoon| evening| night)?)\b/.exec(t);
    if (d) {
        day = /tomorrow/.test(d[1]) ? "tomorrow" : "today";
        if (/morning/.test(d[1])) t = t.replace(d[0], "") + " am";
        else if (/afternoon|evening|night|tonight/.test(d[1])) t = t.replace(d[0], "") + " pm";
        else t = t.replace(d[0], "");
    }
    var w = /\b(?:on |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
    if (w) { wd = WEEKDAYS.indexOf(w[1]); t = t.replace(w[0], ""); }
    t = t.replace(/^\s*(?:at|by|for)\s+/, "").replace(/\s+(?:at|by)\s+/, " ").replace(/\s+/g, " ").trim();
    var c = t && t !== "am" && t !== "pm" ? clock(t.replace(/^(am|pm) (.*)$/, "$2 $1")) : null;
    if (t && t !== "am" && t !== "pm" && !c) return null;
    if (!c) {
        if (!day && wd < 0) return null;
        // A day alone: 9 in the morning, or 6 in the evening for "tonight".
        c = { hour: t === "pm" ? 6 : 9, minute: 0, meridiem: t === "pm" ? "pm" : "am" };
    }
    if (wd >= 0) {
        // That weekday, next week if it is today; a bare hour before 7 is in the evening.
        var base = new Date(now), ahead = (wd - base.getDay() + 7) % 7 || 7;
        var h = c.meridiem === "24" ? c.hour : c.meridiem === "pm" ? c.hour % 12 + 12
              : c.meridiem === "am" ? c.hour % 12 : (c.hour < 7 ? c.hour + 12 : c.hour % 12);
        return new Date(base.getFullYear(), base.getMonth(), base.getDate() + ahead, h, c.minute, 0, 0).getTime();
    }
    return nextClock(c, now, day, opts && opts.preferAm);
}

// ---- Arithmetic --------------------------------------------------------------------------

// The expression in "what's 15% of 80", "twelve times seven", "the square
// root of 81", "10 divided by 4": for lib/arith.js, or null when the text
// is not a sum (it needs a number and an operator).
function arithmetic(text) {
    var t = digits(String(text || "").toLowerCase())
        .replace(/^(?:what(?:'s| is)|calculate|compute|work out|how much is|tell me)\s+/, "")
        .replace(/\?+$/, "").trim();
    if (!/\d/.test(t)) return null;
    t = t.replace(/\b(?:the )?square root of\b/g, " sqrt ")
         .replace(/\b(?:per ?cent|percent)\b/g, "%")
         .replace(/%\s*of\b/g, "% *")
         .replace(/\bto the power of\b/g, "^").replace(/\bsquared\b/g, "^2").replace(/\bcubed\b/g, "^3")
         .replace(/\b(?:multiplied by|times)\b/g, "*").replace(/(\d)\s*x\s*(\d)/g, "$1 * $2")
         .replace(/\b(?:divided by|over)\b/g, "/").replace(/\bplus\b/g, "+").replace(/\b(?:minus|take away)\b/g, "-")
         .replace(/×/g, "*").replace(/÷/g, "/").replace(/(\d),(\d{3})\b/g, "$1$2").trim();
    if (!/^[\d\s.+\-*/^()%sqrt]+$/.test(t)) return null;
    if (!/[+\-*/^%]|sqrt/.test(t.replace(/^-/, ""))) return null;
    return t;
}

// ---- Cleaning ------------------------------------------------------------------------------

function clean(text) {
    var t = String(text || "").toLowerCase().replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
    var before;
    do {
        before = t;
        t = t.replace(/^(?:hey |ok |okay )?(?:phoenix|assistant)[,!.]?\s+/, "")
             .replace(/^(?:please|kindly|just)\s+/, "")
             .replace(/^(?:can|could|would|will) you(?: please)?\s+/, "")
             .replace(/^(?:i want to|i'd like to|i would like to|i need to|let's|lets)\s+/, "")
             .replace(/[\s,]+please$/, "").replace(/[.!?]+$/, "").trim();
    } while (t !== before);
    return t;
}

// ---- The rules ------------------------------------------------------------------------------

var TOGGLES = [
    ["wifi", /^(?:the )?(?:wi-?fi|wi fi|wireless|wlan)$/],
    ["bluetooth", /^(?:the )?blue ?tooth$/],
    ["airplane", /^(?:the )?(?:airplane|aeroplane|flight|plane)(?: mode)?$/],
    ["flashlight", /^(?:the )?(?:flash ?light|torch|light)$/],
    ["ringer", /^(?:the )?(?:ringer|ringtone|ring tone|ringing|sound)$/]
];
function toggleTarget(word) {
    for (var i = 0; i < TOGGLES.length; ++i) if (TOGGLES[i][1].test(word.trim())) return TOGGLES[i][0];
    return null;
}
function toggle(t) {
    var m, target;
    if ((m = /^(?:turn|switch|put|set) (on|off) (.+)$/.exec(t)) && (target = toggleTarget(m[2])))
        return { setting: target, state: m[1] };
    if ((m = /^(?:turn|switch|put|set) (.+?) (on|off)$/.exec(t)) && (target = toggleTarget(m[1])))
        return { setting: target, state: m[2] };
    if ((m = /^(enable|disable|activate|deactivate|start|stop) (.+)$/.exec(t)) && (target = toggleTarget(m[2])))
        return { setting: target, state: /^(enable|activate|start)$/.test(m[1]) ? "on" : "off" };
    if ((m = /^toggle (.+)$/.exec(t)) && (target = toggleTarget(m[1])))
        return { setting: target, state: "toggle" };
    if ((m = /^(.+?) (on|off)$/.exec(t)) && (target = toggleTarget(m[1])))
        return { setting: target, state: m[2] };
    // Silent mode is the ringer off.
    if (/^(?:silence|mute) (?:the )?(?:phone|ringer|ringtone)$|^(?:turn on |switch on |enable )?(?:silent|vibrate) mode(?: on)?$|^go silent$/.test(t))
        return { setting: "ringer", state: "off" };
    if (/^(?:unmute|unsilence) (?:the )?(?:phone|ringer|ringtone)$|^(?:turn off |switch off |disable )?(?:silent|vibrate) mode(?: off)?$/.test(t)
        && !/^(?:turn on|switch on|enable)/.test(t))
        return { setting: "ringer", state: "on" };
    return null;
}

var PHONE_LABEL = /\s+(?:on |at )?(?:(?:his|her|their|the) )?(mobile|cell|cellphone|home|work|office)(?: phone| number)?$/;

function call(t) {
    var m = /^(?:call|phone|ring|dial|ring up|give) (.+?)(?: a (?:call|ring))?$/.exec(t);
    if (!m || /^(?:me|back)$/.test(m[1])) return null;
    var who = m[1], label = "";
    var l = PHONE_LABEL.exec(who);
    if (l) { label = { cell: "mobile", cellphone: "mobile", office: "work" }[l[1]] || l[1]; who = who.slice(0, l.index); }
    if (/^[+\d][\d\s().-]{2,}$/.test(who)) return { number: who.replace(/[^\d+]/g, ""), label: label };
    return { who: who, label: label };
}

// "text sam i'm late", "send a message to sam saying hi", "tell sam that ..."
function textMessage(t, ctx) {
    var m = /^(?:text|message|sms|imessage|send (?:a |an )?(?:text|message|sms)(?: message)? to|send|tell|write to|write) (.+)$/.exec(t);
    if (!m) return null;
    var rest = m[1];
    var sep = /^(.+?)(?:,|:| saying| that says| to say| and say| that)\s+(.+)$/.exec(rest);
    if (/^tell /.test(t) && !sep) return null;  // "tell me a joke"
    if (sep && !/^(?:me|us)$/.test(sep[1])) return { who: sep[1], message: sep[2] };
    // The longest contact name the text starts with.
    var names = (ctx && ctx.names) || [], best = "";
    names.forEach(function (n) {
        var ln = String(n || "").toLowerCase().trim();
        if (ln && (rest === ln || rest.indexOf(ln + " ") === 0) && ln.length > best.length) best = ln;
    });
    if (best) return { who: best, message: rest.slice(best.length).trim() };
    var sp = rest.indexOf(" ");
    if (/^tell /.test(t) || /^(?:me|us)\b/.test(rest)) return null;
    return sp < 0 ? { who: rest, message: "" } : { who: rest.slice(0, sp), message: rest.slice(sp + 1) };
}

function timer(t) {
    var m = /^(?:set|start|create|make|put on|run)?\s*(?:a |an |the )?(?:timer|countdown)(?: for| of)? (.+?)(?: (?:for|called|named|labelled|labeled) (?:the )?(.+))?$/.exec(t)
        || /^(?:set |start )?(?:a |an )?(.+?) (?:timer|countdown)(?: (?:for|called) (?:the )?(.+))?$/.exec(t)
        || /^(?:time|count down) (.+?)()$/.exec(t);
    if (!m) return null;
    var s = duration(m[1]);
    if (s === null || s <= 0) return null;
    return { seconds: s, label: m[2] || "" };
}

function alarm(t, now) {
    var m = /^(?:set |create |make )?(?:an |the |my )?alarm (?:for |at )?(.+?)(?: (?:called|named|labelled|labeled|for) (.+))?$/.exec(t)
        || /^wake me(?: up)?(?: at| by)? (.+?)()$/.exec(t);
    if (!m) return null;
    var wake = /^wake/.test(t);
    var at = when(m[1], now, { preferAm: wake });
    if (at === null) return null;
    return { time: at, label: m[2] || "" };
}

function reminder(t, now) {
    var m = /^(?:remind me|set a reminder|create a reminder|add a reminder|make a reminder)(?: to| that| about| for)? (.+)$/.exec(t);
    if (!m) return null;
    var rest = m[1];
    // A time at the end ("... at 5", "... tomorrow at 9", "... in 20 minutes"), or at the start ("at 5 to ...").
    var tailRe = /\s+((?:in .+)|(?:(?:today|tonight|tomorrow)(?: (?:morning|afternoon|evening|night))?(?: at .+)?)|(?:(?:on |next )?(?:sun|mon|tues|wednes|thurs|fri|satur)day(?: at .+)?)|(?:at .+?(?: (?:today|tonight|tomorrow))?))$/;
    var due = null, x = tailRe.exec(rest);
    for (var cut = x; cut; cut = null) {
        var at = when(cut[1], now);
        if (at !== null) { due = at; rest = rest.slice(0, cut.index); }
    }
    if (due === null) {
        var lead = /^((?:in|at|on|tomorrow|tonight|today) .+?) (?:to|that) (.+)$/.exec(rest);
        if (lead && (due = when(lead[1], now)) !== null) rest = lead[2];
    }
    rest = rest.replace(/^(?:to|that) /, "").trim();
    if (!rest) return null;
    return { text: rest, due: due };
}

function navigate(t) {
    var m = /^(?:navigate|directions|get directions|give me directions|take me|drive me|drive|route me|guide me|show me the way|how do i get|how do i go|get me) (?:to |home)?(.*)$/.exec(t);
    if (!m) return null;
    var dest = (/home$/.test(m[0]) && !m[1] ? "home" : m[1]).replace(/^the /, "").trim();
    return dest ? { destination: dest } : null;
}

function play(t) {
    var m = /^(?:play|listen to|put on|shuffle) (.+)$/.exec(t);
    if (!m) return null;
    var q = m[1].replace(/^(?:some |my |the )/, "")
        .replace(/^(?:music|songs|tracks|tunes)(?: by| from)?\s*/, "")
        .replace(/^(?:the )?(?:album|song|track|artist) /, "")
        .replace(/ (?:on|in) (?:music|the music app)$/, "").replace(/^by /, "").trim();
    if (/^(?:a )?(?:game|video|movie)\b/.test(q)) return null;
    return { query: q === "music" ? "" : q };
}

function weather(t) {
    var m = /^(?:what(?:'s| is| will be)(?: the)? |how(?:'s| is)(?: the)? |show(?: me)?(?: the)? |check(?: the)? |get(?: the)? |tell me the )?(weather|forecast|temperature)(?: be)?(?: like| going to be like| forecast)?(?: (?:in|for|at) (.+?))?(?: (today|tonight|tomorrow|this week|this weekend))?$/.exec(t);
    if (m) {
        var place = (m[2] || "").replace(/ (today|tonight|tomorrow)$/, "");
        var day = m[3] || (/ (today|tonight|tomorrow)$/.exec(m[2] || "") || [])[1] || "";
        if (/^(?:it|that)$/.test(place)) return null;
        return { place: place, day: day };
    }
    m = /^(?:will|is) it (?:going to )?(?:be )?(rain|raining|snow|snowing|sunny|hot|cold|warm|windy)(?: (?:in|at) (.+?))?(?: (today|tonight|tomorrow))?$/.exec(t)
        || /^do i need (?:an umbrella|a coat|a jacket)()(?: (?:in|at) (.+?))?(?: (today|tonight|tomorrow))?$/.exec(t);
    if (m) return { place: m[2] || "", day: m[3] || "", about: m[1] || "rain" };
    if (/^(?:how (?:hot|cold|warm) is it|is it (?:hot|cold) outside)(?: outside)?$/.test(t)) return { place: "", day: "" };
    return null;
}

function time(t) {
    if (/^(?:what(?:'s| is) the time|what time is it|tell me the time|the time|time)(?: now| right now)?$/.test(t)) return { what: "time" };
    if (/^(?:what(?:'s| is) (?:the date|today's date|the day)|what day is it(?: today)?|what is today|what's today)$/.test(t)) return { what: "date" };
    return null;
}

function search(t) {
    var m = /^(?:search(?: the web| the internet| online)?(?: for)?|google|look up|web search(?: for)?|find (?:on|online) ?(?:the web )?)\s+(.+)$/.exec(t);
    return m ? { query: m[1] } : null;
}

// "open maps", "launch the camera app", "start voice memos"
function openApp(t, ctx) {
    var m = /^(?:open|launch|start|run|show me|go to|switch to|bring up) (?:the |my )?(.+?)(?: app| application)?$/.exec(t);
    if (!m) return null;
    var want = m[1].trim(), apps = (ctx && ctx.apps) || [], found = null;
    var norm = function (s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim(); };
    var w = norm(want);
    apps.forEach(function (a) { if (!found && norm(a.title) === w) found = a; });
    apps.forEach(function (a) {
        if (!found && (a.keywords || []).some(function (k) { return norm(k) === w; })) found = a;
    });
    apps.forEach(function (a) { if (!found && w.length >= 3 && norm(a.title).indexOf(w) === 0) found = a; });
    return found ? { appId: found.id, title: found.title } : null;
}

// Commands apps declare (appinfo.json; lib/grammar.js compiles their phrases).
function appCommand(t, ctx) {
    var list = (ctx && ctx.appCommands) || [];
    for (var i = 0; i < list.length; ++i) {
        for (var j = 0; j < list[i].phrases.length; ++j) {
            var m = new RegExp("^" + list[i].phrases[j] + "$").exec(t);
            if (m) return { key: list[i].key, text: (m[1] || "").trim() };
        }
    }
    return null;
}

var rules = [
    ["time", time],
    ["calculate", function (t) { var e = arithmetic(t); return e ? { expression: e } : null; }],
    ["weather", weather],
    ["timer", timer],
    ["alarm", function (t, ctx) { return alarm(t, ctx.now); }],
    ["reminder", function (t, ctx) { return reminder(t, ctx.now); }],
    ["toggle", toggle],
    ["call", call],
    ["navigate", navigate],
    ["app", appCommand],
    ["text", textMessage],
    ["play", play],
    ["search", search],
    ["open", openApp]
];

// ---- What the assistant says ---------------------------------------------------------------

function plural(n, one, many) { return n === 1 ? "1 " + one : n + " " + (many || one + "s"); }
function durationText(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60, out = [];
    if (h) out.push(plural(h, "hour"));
    if (m) out.push(plural(m, "minute"));
    if (sec) out.push(plural(sec, "second"));
    return out.length > 1 ? out.slice(0, -1).join(", ") + " and " + out[out.length - 1] : out[0] || "0 seconds";
}
function timeText(ms) {
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "AM" : "PM");
}
function dayText(ms, now) {
    var d = new Date(ms), n = new Date(now);
    var days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days < 7) return WEEKDAYS[d.getDay()].replace(/^./, function (c) { return c.toUpperCase(); });
    return d.toLocaleDateString("en", { month: "long", day: "numeric" });
}
var SETTING_NAMES = { wifi: "Wi-Fi", bluetooth: "Bluetooth", airplane: "Airplane mode", flashlight: "The flashlight", ringer: "The ringer" };

var say = {
    off: function () { return "The assistant is turned off. You can turn it on in Settings > Assistant."; },
    notAllowed: function (title) { return "\"" + title + "\" is turned off in Settings > Assistant."; },
    timerSet: function (s, label) { return "Timer set for " + durationText(s) + (label ? " (" + label + ")" : "") + "."; },
    timerDone: function (label) { return label ? "Your " + label + " timer is done." : "Your timer is done."; },
    alarmSet: function (ms, now, label) { return "Alarm set for " + timeText(ms) + " " + dayText(ms, now) + (label ? " (" + label + ")" : "") + "."; },
    reminderSet: function (text, due, now) {
        return due ? "I'll remind you to " + text + " at " + timeText(due) + " " + dayText(due, now) + "." : "Added \"" + text + "\" to your tasks.";
    },
    toggled: function (setting, on) { return SETTING_NAMES[setting] + " is " + (on ? "on" : "off") + "."; },
    noSuchContact: function (who) { return "I couldn't find " + who + " in your contacts."; },
    noNumber: function (who) { return who + " has no phone number in your contacts."; },
    confirmCall: function (who, number) { return "Call " + (who ? who + " (" + number + ")" : number) + "?"; },
    calling: function (who) { return "Calling " + who + "."; },
    confirmText: function (who, message) { return "Send \"" + message + "\" to " + who + "?"; },
    sent: function (who) { return "Sent to " + who + "."; },
    composing: function (who) { return "What would you like to say to " + who + "? I've opened Messaging."; },
    cancelled: function () { return "OK, I won't."; },
    opening: function (title) { return "Opening " + title + "."; },
    navigating: function (dest) { return "Getting directions to " + dest + "."; },
    playing: function (q) { return q ? "Playing " + q + "." : "Playing your music."; },
    searching: function (q) { return "Searching the web for \"" + q + "\"."; },
    answer: function (expr, value) { return expr + " = " + value; },
    time: function (now) { return "It's " + timeText(now) + "."; },
    date: function (now) { return "It's " + new Date(now).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + "."; },
    weather: function (place, temp, unit, desc, day, hi, lo) {
        var where = place ? " in " + place : "";
        if (day === "tomorrow") return "Tomorrow" + where + ": " + desc + ", " + Math.round(hi) + "° / " + Math.round(lo) + "°" + unit + ".";
        return "It's " + Math.round(temp) + "°" + unit + " and " + desc + where + "." + (hi !== null ? " Today: " + Math.round(hi) + "° / " + Math.round(lo) + "°." : "");
    },
    noPlace: function (place) { return "I couldn't find a place called " + place + "."; },
    noLocation: function () { return "I don't know where you are. Say a city, like \"weather in Paris\", or turn on Location Services."; },
    noWeather: function () { return "I couldn't get the weather right now. I've opened Weather."; },
    cantDo: function () { return "I can't do that on the phone."; },
    askCloud: function (name) { return "Ask " + name; },
    searchWeb: function () { return "Search the web"; },
    setUpCloud: function () { return "Set up a cloud model"; },
    cloudNoControl: function (name) { return name + " asked to control the phone, but cloud models may only chat. You can allow it in Settings > Assistant."; },
    cloudFailed: function (name, why) { return name + " didn't answer: " + why; },
    localFailed: function (why) { return "The on-device model didn't answer (" + why + ")."; },
    unknownTool: function (name) { return "The model asked for \"" + name + "\", which isn't a command I know."; },
    done: function () { return "Done."; },
    failed: function (why) { return "That didn't work: " + why; },
    newThread: function () { return "New conversation"; }
};

module.exports = {
    id: "en",
    name: "English",
    clean: clean,
    rules: rules,
    number: number,
    digits: digits,
    duration: duration,
    clock: clock,
    when: when,
    arithmetic: arithmetic,
    durationText: durationText,
    timeText: timeText,
    say: say
};
