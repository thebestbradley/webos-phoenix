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
//   rules: [[command, fn(text, ctx) -> args | null]], tried in order; the
//          commands and their arguments are lib/commands.js's
//   duration(text) -> seconds | null
//   clock(text) -> {hour, minute, meridiem} | null
//   extract(text, now) -> what a sentence says about when, and the rest
//   resolve(extracted, now, prefer) -> {start, end, allDay, repeat, ...}
//   when(text, now, opts) -> ms | null      "at 5", "tomorrow at 9", "in 20 minutes"
//   arithmetic(text) -> expression for lib/arith.js | null
//   timeText, dayText, whenText, repeatText, durationText: times as said
//   say: replies, one function each (see the bottom)
//   grounded(command, args, text): a model's choice fits the words
//
// The calendar arithmetic shared by every language is lib/dates.js; unit
// sizes are lib/units.js (the words for them are here).
//
// ctx: {now, original (the words as typed, for their case), apps: [{id,
//       title, keywords?}], names: [contact names], appCommands: [{key,
//       quickAction, phrases: [regexp source with (.+) for {text}]}]}

"use strict";

var D = require("../dates");

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

// ---- Days, dates and times in a sentence ------------------------------------------------------
//
// extract(text, now) finds the words that say when ("tomorrow at 3",
// "next Tuesday at noon", "from 2 to 4", "for an hour", "in 2 hours",
// "every Monday", "on the 15th", "October 20") anywhere in a sentence,
// and gives what they say and the rest of the sentence:
//   {rest, day (ms of a local midnight), dayWord, week ("this"|"next"|"last"),
//    weekend, part ("morning"|"afternoon"|"evening"|"night"), clock, endClock,
//    seconds (a length), relative (ms), repeat {freq, days, interval}, allDay}
// resolve(info, now, prefer) turns that into moments:
//   {start, end, allDay, repeat, hasTime, hasDate}
// prefer, for an hour said without am/pm: "day" (1 to 6 in the afternoon,
// 7 to 11 in the morning: events, reminders), "alarm" (the next of the
// two; on a given day the morning), "am" (the morning: waking up), "next"
// (the next of the two; on a given day as "day").

var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var WD = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
var MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?";
var ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
    nineteenth: 19, twentieth: 20, thirtieth: 30 };
var PARTS = { morning: 9, afternoon: 14, evening: 18, night: 21 };
var MER = "(?:\\s?(?:am|pm))";
// A clock time: one that cannot be anything else, and one after "at".
var T_STRICT = "(?:noon|midday|midnight|(?:half|quarter|\\d{1,2}) (?:past|after|to) \\d{1,2}" + MER + "?|\\d{1,2}(?::\\d{2})?" + MER +
               "|\\d{1,2}:\\d{2}|\\d{1,2} o'?clock" + MER + "?)";
var T_ANY = "(?:" + T_STRICT + "|\\d{1,2})";

function monthOf(s) {
    s = String(s).replace(/\.$/, "");
    for (var i = 0; i < MONTHS.length; ++i) if (MONTHS[i].indexOf(s) === 0) return i;
    return -1;
}

// Number words where they say a time or a length, as digits ("at seven
// thirty" -> "at 7:30", "for twenty minutes" -> "for 20 minutes"), and
// ordinals after "the" or a month ("the fifth" -> "the 5th"); other words
// stay ("one on one" is a meeting).
function timeWords(text) {
    var seq = NUMBER_WORD + "(?:[ -]" + NUMBER_WORD + ")*";
    var t = String(text).replace(/\ba\.m\.?(?=\s|$)/g, "am").replace(/\bp\.m\.?(?=\s|$)/g, "pm");
    t = t.replace(new RegExp("\\b(at|by|from|until|till|to|for|in|every|and|past|after|around|about|between|than) (" + seq + ")\\b", "g"), function (m, p, w) {
        if (/^(?:a|an|and|oh|few|couple)$/.test(w)) return m;
        if (/^(?:at|by|from|until|till|to|around|about|between)$/.test(p) && /\s/.test(w)) {
            var c = clock(w);
            if (c && c.minute) return p + " " + c.hour + ":" + (c.minute < 10 ? "0" : "") + c.minute;
        }
        return p + " " + digits(w);
    });
    t = t.replace(new RegExp("\\b(" + seq + ")(?= ?(?:am|pm|o'?clock|minutes?|mins?|hours?|hrs?|days?|weeks?|seconds?)\\b)", "g"), function (m, w) {
        return /^(?:a|an|and|oh)$/.test(w) ? m : digits(w);
    });
    t = t.replace(/\b(the|january|february|march|april|may|june|july|august|september|october|november|december) (twenty |thirty )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/g,
        function (m, p, tens, o) { return p + " " + ((tens ? TENS[tens.trim()] : 0) + ORDINALS[o]) + "th"; });
    return t;
}

function repeatDays(list) {
    return list.split(/\s*(?:,|\band\b|\bor\b|&)\s*/).map(function (w) { return WEEKDAYS.indexOf(w.trim().replace(/s$/, "")); })
        .filter(function (d) { return d >= 0; }).sort();
}

function extract(text, now) {
    var t = " " + timeWords(String(text || "").toLowerCase()) + " ", info = {};
    function take(re, fn) {
        var m = re.exec(t);
        if (!m || fn(m) === false) return false;
        t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
        return true;
    }
    var today = D.startOfDay(now);
    var WDS = WD + "s?(?:(?:,| and| or|, and) " + WD + "s?)*";

    // Repeats.
    take(/\s(?:every|each) (other )?(?:single )?day\s|\sdaily\s/, function (m) { info.repeat = { freq: "DAILY", interval: m[1] ? 2 : 1 }; })
    || take(/\s(?:(?:every|each) (?:week ?day|weekday)|(?:on )?weekdays|monday to friday|monday through friday)\s/, function () { info.repeat = { freq: "WEEKLY", days: [1, 2, 3, 4, 5] }; })
    || take(/\s(?:(?:every|each) weekend|(?:on |at )?weekends|saturdays? and sundays?)\s/, function () { info.repeat = { freq: "WEEKLY", days: [0, 6] }; })
    || take(new RegExp("\\s(?:every|each) (other )?(" + WDS + ")\\s"), function (m) { info.repeat = { freq: "WEEKLY", days: repeatDays(m[2]), interval: m[1] ? 2 : 1 }; })
    || take(new RegExp("\\s(?:on )?(" + WD + "s(?:(?:,| and|, and) " + WD + "s)*)\\s"), function (m) { info.repeat = { freq: "WEEKLY", days: repeatDays(m[1]) }; })
    || take(/\s(?:(?:every|each) (other )?week|weekly)\s/, function (m) { info.repeat = { freq: "WEEKLY", interval: m && m[1] ? 2 : 1 }; })
    || take(/\s(?:(?:every|each) month|monthly)\s/, function () { info.repeat = { freq: "MONTHLY" }; })
    || take(/\s(?:(?:every|each) year|yearly|annually)\s/, function () { info.repeat = { freq: "YEARLY" }; });

    take(/\s(?:all[ -]day|for the (?:whole |entire )?day)\s/, function () { info.allDay = true; });

    // From ... to ...; 3-4pm; until 5.
    take(new RegExp("\\s(?:from|between) (" + T_ANY + ") ?(?:to|until|till|and|-|–) ?(" + T_ANY + ")\\s"), function (m) {
        var a = clock(m[1]), b = clock(m[2]);
        if (!a || !b) return false;
        info.clock = a; info.endClock = b;
    })
    || take(new RegExp("\\s(\\d{1,2}(?::\\d{2})?" + MER + "?) ?(?:-|–) ?(\\d{1,2}(?::\\d{2})?" + MER + ")\\s"), function (m) {
        var a = clock(m[1]), b = clock(m[2]);
        if (!a || !b) return false;
        info.clock = a; info.endClock = b;
    });
    if (!info.endClock) take(new RegExp("\\s(?:until|till|til) (" + T_ANY + ")\\s"), function (m) { info.endClock = clock(m[1]); return !!info.endClock; });

    // For an hour.
    take(/\sfor (?:about |around )?((?:an?|half an?|a quarter of an?|\d+(?:\.\d+)?)(?: and a half)? ?(?:hours?|hrs?|minutes?|mins?)(?: and (?:a half|\d+ ?(?:minutes?|mins?)))?)\s/, function (m) {
        var s = duration(m[1]);
        if (s === null) return false;
        info.seconds = s;
    });

    // In 20 minutes; an hour from now; in 3 days.
    take(/\s(?:in|after) ((?:an?|half an?|a quarter of an?|\d+(?:\.\d+)?)(?: and a half)? ?(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)(?: and (?:a half|\d+ ?(?:minutes?|mins?|seconds?)))?)(?: from now| time)?\s/, function (m) {
        var s = duration(m[1]);
        if (s === null) return false;
        info.relative = now + s * 1000;
    })
    || take(/\s((?:an?|half an?|\d+(?:\.\d+)?) ?(?:hours?|minutes?|mins?)) from now\s/, function (m) {
        var s = duration(m[1]);
        if (s === null) return false;
        info.relative = now + s * 1000;
    })
    || take(/\s(?:in (an?|\d+) (days?|weeks?)|(an?|\d+) (days?|weeks?) from (?:now|today))\s/, function (m) {
        var n = m[1] || m[3], unit = m[2] || m[4];
        n = /^an?$/.test(n) ? 1 : Number(n);
        info.day = D.addDays(today, n * (/^week/.test(unit) ? 7 : 1));
    });

    // Today, tomorrow, tonight, yesterday; the part of the day.
    take(/\s(?:the )?day after tomorrow\s/, function () { info.day = D.addDays(today, 2); info.dayWord = "after"; })
    || take(/\s(?:the )?day before yesterday\s/, function () { info.day = D.addDays(today, -2); })
    || take(/\stomorrow(?: (morning|afternoon|evening|night))?\s/, function (m) { info.day = D.addDays(today, 1); info.dayWord = "tomorrow"; if (m[1]) info.part = m[1]; })
    || take(/\syesterday(?: (morning|afternoon|evening))?\s/, function (m) { info.day = D.addDays(today, -1); info.dayWord = "yesterday"; if (m[1]) info.part = m[1]; })
    || take(/\stonight\s/, function () { info.day = today; info.part = "evening"; info.dayWord = "today"; })
    || take(/\stoday\s/, function () { info.day = today; info.dayWord = "today"; })
    || take(/\sthis (morning|afternoon|evening)\s/, function (m) { info.day = today; info.part = m[1]; info.dayWord = "today"; });
    if (!info.part) take(/\s(?:in the (morning|afternoon|evening)|at (night))\s/, function (m) { info.part = m[1] || m[2]; });

    // Weeks and weekends.
    take(/\s(this|next|last) (week ?end|week)\s/, function (m) {
        if (/end/.test(m[2])) {
            var sat = D.nextWeekday(now, 6, true);
            if (new Date(now).getDay() === 0) sat = D.addDays(today, -1);
            if (m[1] === "next") sat = D.addDays(sat, 7);
            if (m[1] === "last") sat = D.addDays(sat, -7);
            info.weekend = m[1];
            info.day = sat;
        } else {
            info.week = m[1];
        }
    });

    // On Friday, next Tuesday, last Monday.
    if (info.day === undefined) take(new RegExp("\\s(?:on |this |next |coming |this coming |last |(?:on )?the )?" + WD + "(?: (morning|afternoon|evening|night))?\\s"), function (m) {
        var wd = WEEKDAYS.indexOf(m[1]);
        if (/last/.test(m[0])) info.day = D.addDays(D.nextWeekday(now, wd, false), -7);
        else info.day = D.nextWeekday(now, wd, /this /.test(m[0]) && !/coming/.test(m[0]));
        if (m[2]) info.part = m[2];
    });

    // October 20th, the 20th of October, on the 15th.
    function date(month, dayOfMonth, year) {
        var y = year ? Number(year) : new Date(now).getFullYear();
        var d = new Date(y, month, dayOfMonth).getTime();
        if (!year && d < today) d = new Date(y + 1, month, dayOfMonth).getTime();
        info.day = d;
    }
    if (info.day === undefined) take(new RegExp("\\s(?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)? " + MONTH + "(?:,? (\\d{4}))?\\s"), function (m) {
        var mo = monthOf(m[2]), dd = Number(m[1]);
        if (mo < 0 || dd < 1 || dd > 31) return false;
        date(mo, dd, m[3]);
    })
    || take(new RegExp("\\s(?:on )?" + MONTH + " (?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\s"), function (m) {
        var mo = monthOf(m[1]), dd = Number(m[2]);
        if (mo < 0 || dd < 1 || dd > 31) return false;
        date(mo, dd, m[3]);
    })
    || take(/\s(?:on )?the (\d{1,2})(?:st|nd|rd|th)\s/, function (m) {
        var n = new Date(now), dd = Number(m[1]);
        if (dd < 1 || dd > 31) return false;
        var d = new Date(n.getFullYear(), n.getMonth(), dd).getTime();
        if (d < today) d = new Date(n.getFullYear(), n.getMonth() + 1, dd).getTime();
        info.day = d;
    });

    // At 3, 3pm, noon, half past six.
    if (!info.clock) take(new RegExp("\\s(?:at|by|@|around|about) (" + T_ANY + ")(?!\\s(?:minutes?|mins?|hours?|days?|weeks?|percent|people|of|times)\\b)\\s"), function (m) {
        var c = clock(m[1]);
        if (!c) return false;
        info.clock = c;
    })
    || take(new RegExp("\\s(" + T_STRICT + ")\\s"), function (m) {
        var c = clock(m[1]);
        if (!c) return false;
        info.clock = c;
    });
    if (info.clock && !info.part) {
        // "7 in the morning" after the time.
        take(/\s(?:in the (morning|afternoon|evening)|at (night))\s/, function (m) { info.part = m[1] || m[2]; });
    }
    info.rest = t.replace(/\s+/g, " ").trim();
    return info;
}

function withPart(c, part) {
    if (!c || c.meridiem || !part) return c;
    return { hour: c.hour, minute: c.minute, meridiem: part === "morning" ? "am" : "pm" };
}

function resolve(info, now, prefer) {
    var out = { start: null, end: null, allDay: !!info.allDay, repeat: info.repeat || null, hasTime: false, hasDate: false };
    var today = D.startOfDay(now);
    var day = info.day !== undefined ? info.day : null;
    if (day === null && info.week) day = info.week === "next" ? D.addDays(D.weekRange(now).to, 0) : info.week === "last" ? D.addDays(D.weekRange(now).from, -7) : null;
    out.hasDate = day !== null;
    var c = withPart(info.clock, info.part);
    if (info.relative !== undefined) {
        out.start = info.relative;
        out.hasTime = true;
    } else if (c) {
        out.hasTime = true;
        var fromRepeat = false;
        if (day === null && info.repeat) { day = D.firstRepeatDay(info.repeat, now); fromRepeat = true; }
        // How to read an hour said without am/pm (see above); an alarm on a
        // given day is in the morning.
        var mode = c.meridiem ? null : prefer === "am" ? "am" : prefer === "alarm" ? (day !== null ? "am" : null)
                 : prefer === "day" || day !== null ? "day" : null;
        if (day !== null) {
            out.start = D.resolveClock(c, now, day, mode);
            if (fromRepeat && out.start <= now)
                out.start = D.resolveClock(c, now, D.firstRepeatDay(info.repeat, D.addDays(today, 1)), mode);
        } else if (mode === "day") {
            var h = D.hours(c, "day")[0];
            out.start = D.at(today, h, c.minute);
            if (out.start <= now) out.start = D.at(D.addDays(today, 1), h, c.minute);
        } else {
            out.start = D.resolveClock(c, now, null, mode);
        }
    } else if (info.part && !info.allDay) {
        out.hasTime = true;
        if (day === null) day = today;
        out.start = D.at(day, PARTS[info.part], 0);
    } else if (day !== null || info.repeat) {
        if (day === null) day = D.firstRepeatDay(info.repeat, now);
        out.start = day;
        out.allDay = true;
    } else if (info.allDay) {
        out.start = today;
    }
    if (out.start !== null) {
        if (info.endClock) {
            var e = info.endClock;
            // "3-4pm": the start takes the end's half of the day when it can.
            if (c && c.meridiem === null && e.meridiem && e.meridiem !== "24") {
                var sh = c.hour % 12 + (e.meridiem === "pm" ? 12 : 0);
                if (sh <= e.hour % 12 + (e.meridiem === "pm" ? 12 : 0)) out.start = D.at(out.start, sh, c.minute);
            }
            var hs = D.hours(e, null), best = null;
            hs.forEach(function (hh) {
                var tt = D.at(out.start, hh, e.minute);
                if (tt > out.start && (best === null || tt < best)) best = tt;
            });
            out.end = best;
        } else if (info.seconds) {
            out.end = out.start + info.seconds * 1000;
        }
    }
    return out;
}

// When something should happen, said on its own: "in 20 minutes", "at 5",
// "at 5pm tomorrow", "tomorrow", "tonight", "on friday at 9". ms or null.
// opts.preferAm: an hour without am/pm in the morning (waking up).
function when(text, now, opts) {
    var info = extract(text, now);
    if (info.rest.replace(/\b(?:at|on|by|for|the|this|in)\b/g, "").trim()) return null;
    var r = resolve(info, now, opts && opts.preferAm ? "am" : (opts && opts.prefer) || "next");
    if (r.start === null) return null;
    // A day alone: 9 in the morning.
    if (r.allDay && !info.allDay) return D.at(r.start, 9, 0);
    return r.start;
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

// Words of the cleaned text as the user wrote them ("text Sam I'm late":
// the message is "I'm late", not "i'm late"): found again in the
// original, case aside. ctx.original is what was said.
function cased(words, ctx) {
    var w = String(words || "");
    var o = String((ctx && ctx.original) || "").replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ");
    var i = w ? o.toLowerCase().indexOf(w) : -1;
    return i >= 0 ? o.slice(i, i + w.length) : w;
}
function capital(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

// ---- The rules ------------------------------------------------------------------------------

var TOGGLES = [
    ["wifi", /^(?:the )?(?:wi-?fi|wi fi|wireless|wlan)$/],
    ["bluetooth", /^(?:the )?blue ?tooth$/],
    ["airplane", /^(?:the )?(?:airplane|aeroplane|flight|plane)(?: mode)?$/],
    ["flashlight", /^(?:the )?(?:flash ?light|torch|light)$/],
    ["ringer", /^(?:the )?(?:ringer|ringtone|ring tone|ringing|sound)$/],
    // webOS had no Do Not Disturb; its ringer switch silenced calls and
    // alerts, and the assistant's Do Not Disturb is that.
    ["dnd", /^(?:the )?(?:do not disturb|don't disturb|dnd|quiet mode|focus mode)(?: mode)?$/]
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
    if (/^(?:go|switch|put (?:me|the phone) )?(?:in(?:to)? )?(?:do not disturb|dnd)(?: mode)?$/.test(t)) return { setting: "dnd", state: "on" };
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

// The longest contact name `rest` starts with ("" for none).
function nameAtStart(rest, ctx) {
    var names = (ctx && ctx.names) || [], best = "";
    names.forEach(function (n) {
        var ln = String(n || "").toLowerCase().trim();
        if (ln && (rest === ln || rest.indexOf(ln + " ") === 0) && ln.length > best.length) best = ln;
    });
    return best;
}

// "text sam i'm late", "send a message to sam saying hi", "tell sam that ..."
function textMessage(t, ctx) {
    var m = /^(?:text|message|sms|imessage|send (?:a |an )?(?:text|message|sms)(?: message)? to|send|tell|write to|write) (.+)$/.exec(t);
    if (!m) return null;
    var rest = m[1];
    if (/^(?:an? )?e-?mail\b/.test(rest)) return null;
    var sep = /^(.+?)(?:,|:| saying| that says| to say| and say| that)\s+(.+)$/.exec(rest);
    if (/^tell /.test(t) && !sep) return null;  // "tell me a joke"
    if (sep && !/^(?:me|us)$/.test(sep[1])) return { who: sep[1], message: cased(sep[2], ctx) };
    var best = nameAtStart(rest, ctx);
    if (best) return { who: best, message: cased(rest.slice(best.length).trim(), ctx) };
    var sp = rest.indexOf(" ");
    if (/^tell /.test(t) || /^(?:me|us)\b/.test(rest)) return null;
    return sp < 0 ? { who: rest, message: "" } : { who: rest.slice(0, sp), message: cased(rest.slice(sp + 1), ctx) };
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
function timerStatus(t) {
    if (/^(?:how (?:much|long)(?: time)?(?: is| 's)?(?: there)? (?:left|remaining)(?: on (?:the |my )?(?:.+ )?timer)?|how long (?:is )?left|(?:time|how much) left|(?:check|show)(?: me)? (?:the |my )?timers?|how(?:'s| is) (?:the |my )?timer(?: doing| going)?|what(?:'s| is) (?:left )?on (?:the |my )?timer|what timers? (?:do i have|are (?:set|running))|is (?:the |my )?timer (?:still )?(?:going|running|on))$/.test(t))
        return { };
    return null;
}
function timerCancel(t) {
    var m = /^(?:cancel|stop|delete|remove|clear|turn off|kill|end|dismiss) (?:the |my |all (?:the |my )?)?(?:(.+?) )?timers?$/.exec(t);
    if (!m) return null;
    return { label: m[1] && !/^(?:my|the|all)$/.test(m[1]) ? m[1] : "", all: /\ball\b|timers$/.test(t) };
}
function stopwatch(t) {
    var m = /^(start|stop|pause|reset|resume|restart|check|clear|show) (?:a |the |my |up (?:a |the )?)?stop ?watch$/.exec(t);
    if (m) return { action: { start: "start", restart: "start", resume: "resume", stop: "stop", pause: "stop", reset: "reset", clear: "reset", check: "status", show: "status" }[m[1]] };
    if (/^stop ?watch(?: start| on)?$/.test(t)) return { action: "start" };
    if (/^(?:how long|how much time|what time)(?: has| is| does| did)? (?:the |my )?stop ?watch(?: been running| say| at| show)?$|^stop ?watch status$/.test(t)) return { action: "status" };
    return null;
}

// Repeats as the Clock has them ("every weekday at 7", "7am weekdays").
function alarm(t, now, ctx) {
    var m = /^(?:set |create |make |add |put )?(?:me )?(?:an |the |my |a new )?alarm (?:clock )?(?:for |at |to |on )?(.+?)(?: (?:called|named|labelled|labeled|for) (?!\d)(.+))?$/.exec(t)
        || /^wake me(?: up)?(?: at| by)? (.+?)()$/.exec(t);
    if (!m) return null;
    var wake = /^wake/.test(t);
    // ("for 11": the "at" the time words need.)
    var info = extract((/^\d/.test(m[1]) ? "at " : "") + m[1], now);
    if (!info.clock && info.relative === undefined) info = extract("at " + m[1], now);
    if (info.rest.replace(/\b(?:at|on|for|by|the)\b/g, "").trim() || !(info.clock || info.relative !== undefined)) return null;
    var r = resolve(info, now, wake ? "am" : "alarm");
    if (r.start === null) return null;
    var out = { time: r.start, label: m[2] ? cased(m[2], ctx) : "" };
    if (r.repeat) {
        out.repeat = D.alarmOccurs(r.repeat) || "once";
        if (out.repeat === "once") out.unrepeated = repeatText(r.repeat);
    }
    return out;
}
// "cancel my 7am alarm", "turn off all alarms", "delete the alarm for 6:30"
function alarmManage(t, now) {
    var m = /^(cancel|turn off|disable|switch off|stop|delete|remove|clear|get rid of) (?:all )?(?:of )?(?:my |the |all |all my |all the )?(?:(.+?) )?alarms?(?: (?:for|at|set for) (.+?))?$/.exec(t);
    if (!m) return null;
    var timeWordsSaid = (m[2] || "") + " " + (m[3] || "");
    var c = null;
    if (timeWordsSaid.trim()) {
        var info = extract(timeWordsSaid, now);
        if (info.rest.replace(/\b(?:at|for|the|morning|wake[- ]up)\b/g, "").trim()) return null;
        c = withPart(info.clock, info.part);
        if (!c) return null;
    }
    return { action: /^(?:delete|remove|clear|get rid of)$/.test(m[1]) ? "delete" : "off",
             hour: c ? c.hour : null, minute: c ? c.minute : null, meridiem: c ? c.meridiem || "" : "",
             all: !c && (/\ball\b/.test(t) || /alarms$/.test(t)) };
}
function alarmList(t) {
    if (/^(?:what|which) alarms?(?: do i have| are set| have i set| are on| is set)?$|^(?:show|list|check|open)(?: me)? (?:my |the |all (?:my )?)?alarms$|^do i have (?:an |any )?alarms?(?: set| on)?(?: for tomorrow| tomorrow)?$|^(?:what(?:'s| is)|when(?:'s| is)) my (?:next )?alarm(?: set for)?$|^(?:my )?alarms$/.test(t))
        return {};
    return null;
}

function reminder(t, now, ctx) {
    var m = /^(?:remind me|set a reminder|create a reminder|add a reminder|make a reminder|remember)(?: to| that| about| for)? (.+)$/.exec(t);
    if (!m) return null;
    if (/^remember (?:that )?/.test(t) && !/^remember to /.test(t)) return null;   // "remember that ...": a note
    var info = extract(m[1], now), due = null, rest = info.rest;
    var r = resolve(info, now, "day");
    if (r.start !== null) due = r.allDay && !info.allDay ? D.at(r.start, 9, 0) : r.start;
    else rest = m[1];
    // "at 5 to pick up the kids": what is left starts with "to".
    rest = rest.replace(/^(?:to|that|about) /, "").replace(/ (?:to|at|on)$/, "").trim();
    if (!rest) return null;
    var out = { text: cased(rest, ctx), due: due };
    if (r.repeat) out.repeat = r.repeat;
    return out;
}

// ---- Calendar ------------------------------------------------------------------------------

var EVENT_NOUN = "(?:calendar )?(?:event|meeting|appointment|appt|entry|booking|reservation|call|phone call|video call)";
var CALENDAR_PLACE = /\s(?:to|in|on|into) (?:my |the )?(?:calendar|diary|schedule|agenda)\b/;

// "add a meeting with Sam tomorrow at 3", "create an event called dentist
// on Friday at 10am", "schedule lunch with Priya next Tuesday at noon for
// an hour at Bistro Verde", "put gym on my calendar every Monday at 7".
function event(t, ctx) {
    var m = /^(add|create|schedule|make|book|put|set up|setup|plan|new|arrange|organi[sz]e|enter)(?: me)? (.+)$/.exec(t);
    if (!m) return null;
    var verb = m[1], body = " " + m[2] + " ";
    var onCalendar = CALENDAR_PLACE.test(body);
    body = body.replace(CALENDAR_PLACE, " ");
    var noun = new RegExp("^\\s(?:an? |the |my |another )?(?:new )?(" + EVENT_NOUN + ")\\b").exec(body);
    if (!noun && !onCalendar && !/^(?:schedule|book|plan|arrange)$/.test(verb)) return null;
    if (noun) body = body.slice(noun[0].length);
    var info = extract(body, ctx.now);
    var rest = " " + info.rest + " ";
    var title = "", m2;
    if ((m2 = /^\s(?:called|named|titled|entitled|labelled|labeled|for|about|to|:)\s?(.+?)\s$/.exec(rest))) { title = m2[1]; rest = " "; }
    // A place: "at Bistro Verde", "in room 4B" (what is left after the time).
    var location = "";
    if ((m2 = /\s(?:at|in|@) (?!my\b|the calendar)(.+?)\s$/.exec(rest)) && !/^(?:the )?(?:morning|afternoon|evening)$/.test(m2[1])) {
        location = m2[1];
        rest = rest.slice(0, m2.index) + " ";
    }
    if (!title) {
        var said = rest.trim();
        if (noun && (!said || /^with /.test(said))) title = noun[1].replace(/^calendar /, "").replace(/^appt$/, "appointment") + (said ? " " + said : "");
        else title = said;
    }
    title = title.replace(/^(?:an?|the) /, "").trim();
    // Who comes: "with Sam and Priya".
    var invitees = [];
    var w = / with (.+?)(?: (?:about|for|to discuss|re) .+)?$/.exec(" " + title);
    if (w) invitees = w[1].split(/\s*(?:,|\band\b|&)\s*/).map(function (x) { return x.replace(/^(?:my )/, "").trim(); }).filter(Boolean);
    var r = resolve(info, ctx.now, "day");
    // Without any time it is not clearly an event ("add milk", "make a note").
    if (!noun && r.start === null) return null;
    return {
        title: title ? capital(cased(title, ctx)) : "",
        start: r.start, end: r.end, allDay: r.allDay, repeat: r.repeat,
        location: location ? cased(location, ctx) : "", invitees: invitees
    };
}

// "what's on my calendar today", "what do I have tomorrow", "what's my next
// meeting", "do I have anything on Friday", "my schedule this week", "when
// is my dentist appointment"
function agenda(t, ctx) {
    var CAL = "(?:calendar|schedule|agenda|diary|appointments?|meetings?|events?|plans?)";
    var asks = new RegExp("^(?:what(?:'s| is| do i have| have i got| are)|whats|show(?: me)?|tell me|read(?: me)?|check|list|give me|how(?:'s| does| is)|open|go through|anything|do i have anything|have i got anything|am i (?:busy|free)|any)\\b").test(t);
    var mentions = new RegExp("\\b" + CAL + "\\b").test(t);
    var m;
    // Next: "what's next", "what's my next meeting"
    if (/^(?:what(?:'s| is) next(?: on (?:my |the )?calendar)?|what(?:'s| is) (?:my )?next (?:meeting|appointment|event|thing)|when(?:'s| is) my next (?:meeting|appointment|event))$/.test(t))
        return { range: "next" };
    // When is my dentist appointment
    if ((m = /^when(?:'s| is| are) (?:my |the |our )?(.+?)(?: (?:appointment|meeting|event))?$/.exec(t)) && !/^(?:it|that|this)$/.test(m[1])
        && !/\b(?:sunset|sunrise|easter|christmas|thanksgiving|halloween)\b/.test(m[1]) && !/^(?:my )?next alarm/.test(m[1]))
        return { range: "find", query: m[1] };
    var dayish = /\b(?:today|tonight|tomorrow|yesterday|this week|next week|this weekend|next weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bon the \d/.test(timeWords(t));
    if (!(asks && (mentions || (dayish && /\b(?:have|got|on|busy|free|planned|happening)\b/.test(t)))) && !/^(?:my )?(?:calendar|schedule|agenda)(?: for)?(?: .+)?$/.test(t))
        return null;
    if (/^(?:add|create|new|schedule|book|put|make|set up)\b/.test(t)) return null;
    var info = extract(t, ctx.now);
    if (info.week) {
        var w = D.weekRange(ctx.now);
        if (info.week === "next") return { range: "week", from: w.to, to: D.addDays(w.to, 7), label: "next week" };
        if (info.week === "last") return { range: "week", from: D.addDays(D.mondayOf(ctx.now), -7), to: D.mondayOf(ctx.now), label: "last week" };
        return { range: "week", from: w.from, to: w.to, label: "this week" };
    }
    if (info.weekend) return { range: "week", from: info.day, to: D.addDays(info.day, 2), label: info.weekend + " weekend" };
    if (info.day !== undefined) return { range: "day", from: info.day, to: D.addDays(info.day, 1) };
    var today = D.startOfDay(ctx.now);
    return { range: "day", from: today, to: D.addDays(today, 1) };
}

// ---- Notes, tasks, lists -------------------------------------------------------------------

function note(t, ctx) {
    var m = /^(?:(?:take|make|create|add|write|new|start|jot)(?: me)?(?: a| an)?(?: new| quick)? (?:note|memo)(?: down)?|note(?: down)?|memo|write down|jot down|remember that)(?: that| saying| to say| about| of)?\s?[:,-]?\s+(.+)$/.exec(t);
    if (!m) return null;
    if (/^(?:note|memo)s? (?:about|for|on)$/.test(t)) return null;
    return { text: capital(cased(m[1], ctx)) };
}
function findNotes(t) {
    var m = /^(?:find|search|show(?: me)?|look (?:for|up|through|in)|get|open|read(?: me)?|search through|check) (?:in |through )?(?:all )?(?:my |the )?(?:notes|memos)(?: (?:about|for|on|with|containing|mentioning|that mention|called|named|that say|with the word) (.+))?$/.exec(t)
        || /^(?:find|search|look for|look up) (?:my )?(.+?) in (?:my |the )?(?:notes|memos)$/.exec(t)
        || /^(?:find|show(?: me)?|open) (?:my |the )?(?:note|memo)s? (?:about|for|on|called) (.+)$/.exec(t);
    if (!m) return null;
    return { query: (m[1] || "").trim() };
}

// "add milk to my shopping list", "create a task pay rent", "add a task to
// call the bank tomorrow", "put eggs on the grocery list"
function task(t, ctx) {
    var m, text = "", list = "";
    if ((m = /^(?:add|put|stick|write) (.+?) (?:to|on|onto|in) (?:my |the |our )?(.+?) ?(?:list|tasks)$/.exec(t))) {
        text = m[1];
        list = m[2].replace(/^(?:to-?do|todo|task|tasks|reminders?)$/, "").trim();
    } else if ((m = /^(?:add|put) (.+?) (?:to|on) (?:my |the )?(?:to-?dos?|todos|tasks|task list)$/.exec(t))) {
        text = m[1];
    } else if ((m = /^(?:create|add|make|new|set up|start)(?: me)?(?: a| an)?(?: new)? (?:task|to-?do|todo)(?: item)?(?: to| called| named| for| that says)?\s?[:,-]?\s+(.+)$/.exec(t))
               || /^(?:task|to-?do)[:,-]?\s+(.+)$/.exec(t)) {
        text = m[1];
    } else {
        return null;
    }
    if (/^(?:an? )?(?:event|meeting|appointment)\b/.test(text)) return null;
    var info = extract(text, ctx.now), due = null;
    var r = resolve(info, ctx.now, "day");
    if (r.start !== null) { due = r.allDay ? D.at(r.start, 9, 0) : r.start; text = info.rest; }
    text = text.replace(/^(?:to|that) /, "").replace(/ (?:to|at|on|by)$/, "").trim();
    if (!text) return null;
    return { text: capital(cased(text, ctx)), list: list ? capital(cased(list, ctx)) : "", due: due };
}

// ---- People ----------------------------------------------------------------------------------

var NUMBER_SAID = /(?:(?:with |and |,\s*)?(?:(?:the |a |his |her |their )?(?:phone|mobile|cell|work|home)? ?(?:phone )?number|phone)?(?: is| of)?\s*)?(\+?\d[\d\s().-]{3,}\d)/;
var EMAIL_SAID = /(?:(?:with |and |,\s*)?(?:(?:the |an? |his |her |their )?e-?mail(?: address)?(?: is| of)?\s*)?)?([^\s@,]+@[^\s@,]+\.[a-z]{2,})/;
// "add Sam to contacts with number 555 0100", "new contact Robin Lee 555-0111"
function contactAdd(t, ctx) {
    var m = /^(?:add|save|create|make|new|store)(?: a| an)?(?: new)? contact(?: for| called| named)?:? (.+)$/.exec(t)
        || /^(?:add|save|put) (.+?) (?:to|in|into|as a contact in) (?:my |the )?(?:contacts?|address book|phone ?book)(?: list)?(.*)$/.exec(t)
        || /^(?:add|save) (.+?) as a (?:new )?contact(.*)$/.exec(t);
    if (!m) return null;
    var said = (m[1] + " " + (m[2] || "")).trim(), number = "", email = "", label = "";
    var e = EMAIL_SAID.exec(said);
    if (e) { email = e[1]; said = (said.slice(0, e.index) + " " + said.slice(e.index + e[0].length)).trim(); }
    var n = NUMBER_SAID.exec(said);
    if (n) {
        number = n[1].trim();
        var lab = /(mobile|cell|work|home)/.exec(n[0]);
        label = lab ? (lab[1] === "cell" ? "mobile" : lab[1]) : "";
        said = (said.slice(0, n.index) + " " + said.slice(n.index + n[0].length)).trim();
    }
    var name = said.replace(/\s+(?:with|and)$/, "").replace(/^(?:with|named|called)\s+/, "").replace(/[,]+$/, "").trim();
    if (!name || name.split(" ").length > 4) return null;
    return { name: cased(name, ctx).replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }), number: number, email: email, label: label };
}
// "what's Sam's number", "what is Ada's email address"
function contactInfo(t) {
    var m = /^(?:what(?:'s| is)|tell me|give me|show(?: me)?|find|get) (.+?)(?:'s|s') (phone number|number|mobile(?: number)?|cell(?: number)?|work number|home number|e-?mail(?: address)?|address|birthday)$/.exec(t)
        || /^(?:what(?:'s| is)|tell me|give me|show(?: me)?|find|get) (?:the )?(phone number|number|e-?mail(?: address)?|address|birthday) (?:for|of) (.+)$/.exec(t);
    if (!m) return null;
    var who = /'|s$/.test(m[0].split(" ")[0]) ? m[1] : m[1];
    var what = m[2], person = m[1];
    if (/^(?:phone number|number|e-?mail(?: address)?|address|birthday)$/.test(m[1])) { what = m[1]; person = m[2]; }
    void who;
    var kind = /mail/.test(what) ? "email" : /address/.test(what) ? "address" : /birthday/.test(what) ? "birthday" : "phone";
    var label = /mobile|cell/.test(what) ? "mobile" : /work/.test(what) ? "work" : /home/.test(what) ? "home" : "";
    if (/^(?:my|your|the|this|that|it)$/.test(person)) return null;
    return { who: person, what: kind, label: label };
}

// ---- Email and messages ------------------------------------------------------------------------

// "email Alex about the report", "send an email to Priya saying see you
// soon", "email Sam subject lunch saying are you free"
function email(t, ctx) {
    var m = /^(?:e-?mail|send (?:an |a )?(?:e-?mail|mail)(?: message)? to|write (?:an )?e-?mail to|compose (?:an )?e-?mail to|send (.+?) an e-?mail|drop (.+?) an e-?mail|mail) ?(.*)$/.exec(t);
    if (!m) return null;
    var rest = (m[1] || m[2] ? (m[1] || m[2]) + " " + m[3] : m[3]).trim();
    if (!rest) return null;
    var body = "", subject = "", who = rest, x;
    if ((x = /^(.+?)(?:,|:| saying| that says| to say| and say| that| telling (?:him|her|them))\s+(.+)$/.exec(who))) { who = x[1]; body = x[2]; }
    if ((x = /^(.+?) (?:about|regarding|re|with the subject|with subject|subject)\s+(.+)$/.exec(who))) { who = x[1]; subject = x[2]; }
    if (!body && !subject) {
        var best = nameAtStart(who, ctx);
        if (best && best !== who) { body = who.slice(best.length).trim(); who = best; }
    }
    who = who.replace(/^(?:to )/, "").trim();
    if (!who || /^(?:me|myself)$/.test(who)) return null;
    return { who: who, subject: subject ? capital(cased(subject, ctx)) : "", body: body ? capital(cased(body, ctx)) : "" };
}
function searchEmail(t) {
    var m = /^(?:find|show(?: me)?|look for|search for|get|open) (?:the |my |any )?(?:e-?mails?|mail) from (.+)$/.exec(t);
    if (m) return { query: m[1], from: true, unread: false };
    m = /^(?:search|find|look (?:for|through|in)|check|search through)(?: in| through)? (?:my |the )?(?:e-?mails?|inbox|mail(?:box)?)(?: for| about)? (.+)$/.exec(t)
        || /^(?:find|show(?: me)?|look for|search for|get|open) (?:the |my |any )?(?:e-?mails?|mail|messages in my inbox) (?:about|with|mentioning|regarding|on|containing) (.+)$/.exec(t)
        || /^(?:find|search for|look for) (.+?) in (?:my )?(?:e-?mails?|inbox|mail)$/.exec(t);
    if (m) return { query: m[1].replace(/^(?:for|about) /, ""), from: false, unread: false };
    m = /^(?:do i have|have i got|any|check(?: my)?|read(?: me)?|show(?: me)?|what(?:'s| is| are)(?: in)?) (?:any )?(?:my |the )?(new |unread |latest |recent )?(?:e-?mails?|mail|inbox)(?: from (.+))?$/.exec(t);
    if (m) return { query: m[2] || "", from: !!m[2], unread: !!m[1] && !/latest|recent/.test(m[1]) };
    return null;
}
// "read my last message", "what did Sam say", "any new texts"
function readMessages(t) {
    var m = /^(?:read|show|play|what(?:'s| is| was| were))(?: me)? (?:my |the )?(?:last|latest|most recent|newest|new|unread|recent)? ?(?:text |sms )?(?:messages?|texts?|sms)(?: from (.+))?$/.exec(t)
        || /^(?:do i have|have i got|any|check(?: my)?) (?:any )?(?:new |unread )?(?:text )?(?:messages?|texts?|sms)(?: from (.+))?$/.exec(t)
        || /^what did (.+?) (?:say|text|send|write)(?: me)?$/.exec(t);
    if (!m) return null;
    return { who: m[1] || "" };
}

// ---- Music, volume, the screen -----------------------------------------------------------------

function media(t) {
    var THIS = "(?: (?:the |this |my )?(?:music|song|track|tune|playback|audio|podcast|it|album|player))?";
    if (new RegExp("^(?:pause|hold)" + THIS + "$|^stop (?:the |this |my )?(?:music|song|track|playback|audio|podcast|playing)$").test(t)) return { action: "pause" };
    if (new RegExp("^(?:resume|unpause|continue|keep playing|restart)" + THIS + "$|^(?:play|start)(?: the| my)? (?:music|song|playback) (?:again|back)$|^(?:play)$|^continue playing$").test(t)) return { action: "play" };
    if (/^(?:next|skip)(?: (?:the |this )?(?:song|track|tune|one))?$|^(?:play |go to )?(?:the )?next (?:song|track|tune|one)$|^skip (?:this|it|ahead)$/.test(t)) return { action: "next" };
    if (/^(?:previous|prev|last|go back|back)(?: (?:a )?(?:song|track|tune|one))?$|^(?:play |go to )?(?:the )?(?:previous|last) (?:song|track|tune|one)(?: again)?$|^go back (?:a|one) (?:song|track)$/.test(t)) return { action: "prev" };
    return null;
}
function volume(t) {
    var m;
    var V = "(?:volume|sound|music|it|audio|media volume)";
    if ((m = new RegExp("^(?:turn|crank|bring|put|push|set) (?:the )?" + V + " (up|down)(?: (?:a bit|a little|a lot|some|more))?$").exec(t))
        || (m = new RegExp("^(?:turn|crank|bring) (up|down) (?:the )?" + V + "(?: a bit| a little)?$").exec(t))
        || (m = /^(?:volume|sound) (up|down)$/.exec(t)))
        return { action: m[1] };
    if (/^(?:louder|make it louder|(?:a bit|a little) louder|increase (?:the )?volume|raise (?:the )?volume|more volume)$/.test(t)) return { action: "up" };
    if (/^(?:quieter|softer|make it quieter|(?:a bit|a little) quieter|decrease (?:the )?volume|lower (?:the )?volume|reduce (?:the )?volume|less volume)$/.test(t)) return { action: "down" };
    if ((m = /^(?:set|change|put|turn|adjust) (?:the )?(?:volume|sound)(?: level)? (?:to|at|up to|down to) (\d+|max(?:imum)?|full|half|min(?:imum)?)(?: ?%| percent)?$/.exec(t))
        || (m = /^volume (?:to |at )?(\d+|max(?:imum)?|full|half)(?: ?%| percent)?$/.exec(t))
        || (m = /^(max(?:imum)?|full) volume$/.exec(t)))
        return { action: "set", level: /^(?:max|full)/.test(m[1]) ? 100 : m[1] === "half" ? 50 : /^min/.test(m[1]) ? 10 : Number(m[1]) };
    if (/^(?:mute|silence)(?: (?:the )?(?:volume|sound|audio|media|music|everything|all sounds?|speaker|it))?$/.test(t)) return { action: "mute" };
    if (/^(?:unmute|un-mute)(?: (?:the )?(?:volume|sound|audio|media|music|everything|speaker|it))?$|^turn (?:the )?(?:sound|volume) back on$/.test(t)) return { action: "unmute" };
    if (/^(?:what(?:'s| is) the volume|how loud is it|volume)$/.test(t)) return { action: "status" };
    return null;
}
function brightness(t) {
    var m;
    var B = "(?:screen |display )?(?:brightness|backlight)";
    if ((m = new RegExp("^(?:set|change|put|turn|adjust|make) (?:the )?(?:" + B + "|screen|display)(?: level)? (?:to|at|up to|down to) (\\d+|max(?:imum)?|full|half|min(?:imum)?|lowest|highest)(?: ?%| percent)?$").exec(t))
        || (m = new RegExp("^" + B + " (?:to |at )?(\\d+|max(?:imum)?|full|half|min(?:imum)?)(?: ?%| percent)?$").exec(t))
        || (m = new RegExp("^(max(?:imum)?|full|min(?:imum)?) " + B + "$").exec(t)))
        return { action: "set", level: /^(?:max|full|highest)/.test(m[1]) ? 100 : m[1] === "half" ? 50 : /^(?:min|lowest)/.test(m[1]) ? 1 : Number(m[1]) };
    if ((m = new RegExp("^(?:turn|crank|bring|put) (?:the )?" + B + " (up|down)(?: a bit| a little)?$").exec(t))
        || (m = new RegExp("^(?:turn|crank|bring) (up|down) (?:the )?" + B + "$").exec(t))
        || (m = new RegExp("^" + B + " (up|down)$").exec(t)))
        return { action: m[1] };
    if (/^(?:make (?:the )?(?:screen|display|it) )?brighter$|^(?:increase|raise) (?:the )?(?:screen )?brightness$|^the screen is too dark$/.test(t)) return { action: "up" };
    if (/^(?:make (?:the )?(?:screen|display|it) )?(?:dimmer|darker)$|^(?:decrease|lower|reduce|dim) (?:the )?(?:screen|display|brightness|screen brightness)$|^the screen is too bright$/.test(t)) return { action: "down" };
    return null;
}

// ---- System ---------------------------------------------------------------------------------

// Settings' panes (apps/settings src/pages/index.ts), by what people call them.
var SETTINGS_PAGES = [
    ["wifi", /^(?:wi-?fi|wi fi|wireless|wlan|network|networks|internet)$/], ["bluetooth", /^blue ?tooth$/],
    ["airplane", /^(?:airplane|aeroplane|flight)(?: mode)?$/], ["phone", /^(?:phone|call|calling)(?: preferences)?$/],
    ["hotspot", /^(?:hotspot|hot spot|tethering|hotspot (?:and|&) tethering)$/], ["vpn", /^vpn$/],
    ["screen", /^(?:screen|display|screen (?:and|&) lock|lock(?: screen)?|brightness|wallpaper|passcode|pin|password)$/],
    ["battery", /^(?:battery|power|battery saver)$/], ["sounds", /^(?:sounds?|ringtones?|sounds (?:and|&) ringtones|volume|audio|notifications? sounds?)$/],
    ["datetime", /^(?:date|time|date (?:and|&) time|clock|time ?zone)$/], ["language", /^(?:language|region|language (?:and|&) region|locale)$/],
    ["textassist", /^(?:text assist|keyboard|autocorrect|auto ?correct|typing)$/], ["justtype", /^(?:just type|search)$/],
    ["clipboard", /^clipboard$/], ["assistant", /^(?:assistant|phoenix)$/], ["usb", /^usb$/],
    ["gamepads", /^(?:game ?controllers?|gamepads?|controllers?)$/], ["location", /^(?:location(?: services)?|gps)$/],
    ["emergency", /^(?:emergency(?: info)?|medical id)$/], ["accessibility", /^accessibility$/],
    ["deviceinfo", /^(?:device info|device|about(?: (?:this )?(?:phone|device))?|phone info|storage)$/], ["backup", /^(?:backups?)$/],
    ["updates", /^(?:updates?|software updates?|system updates?)$/], ["certificates", /^(?:certificates?|certificate manager)$/],
    ["devmode", /^(?:developer(?: mode)?|dev mode)$/], ["advanced", /^advanced$/]
];
function settingsPage(t) {
    var m = /^(?:open|show(?: me)?|go to|take me to|launch|bring up|get to|change|adjust) (?:the |my )?(.+?) (?:settings|preferences|options|prefs|panel|pane)$/.exec(t)
        || /^(?:open |show )?(?:the )?settings (?:for|of) (?:the )?(.+)$/.exec(t)
        || /^(.+?) settings$/.exec(t);
    if (!m) return null;
    var want = m[1].trim();
    for (var i = 0; i < SETTINGS_PAGES.length; ++i) if (SETTINGS_PAGES[i][1].test(want)) return { page: SETTINGS_PAGES[i][0] };
    return null;
}
function screenshot(t) {
    return /^(?:take|grab|capture|make|get|snap|save)(?: me)?(?: a| an)? (?:screen ?shot|screen capture|screen grab|screen ?cap|capture of (?:the |my )?screen|picture of (?:the |my )?screen)$|^screen ?shot$|^capture (?:the |my )?screen$/.test(t) ? {} : null;
}
function lock(t) {
    return /^(?:lock(?: (?:the|my))? (?:screen|phone|device|tablet)|lock it|lock|lock up|turn off the screen|turn the screen off|screen off|switch off the screen)$/.test(t) ? {} : null;
}
function battery(t) {
    if (/^(?:what(?:'s| is)|how(?:'s| is| much)|check|show(?: me)?|tell me)(?: my| the)? (?:battery|charge|battery life|power)(?: level| life| percentage| left| status| charge)?(?: do i have| is left| have i got| left| remaining)?$|^(?:how much )?battery(?: level| percentage| left| status)?$|^is (?:my |the )?(?:phone|tablet|device|battery) charging$|^how much (?:charge|power|juice) (?:do i have|is left|have i got)(?: left)?$/.test(t))
        return {};
    return null;
}

// Conversions. The words for units (lib/units.js has the sizes).
var UNIT_WORDS = [
    ["mm", "millimet(?:er|re)s?|mm"], ["cm", "centimet(?:er|re)s?|cm"], ["km", "kilomet(?:er|re)s?|kms?|kays"], ["m", "met(?:er|re)s?|m"],
    ["in", "inch(?:es)?|in"], ["ft", "f(?:oo|ee)t|ft"], ["yd", "yards?|yds?"], ["mi", "miles?|mi"], ["nmi", "nautical miles?"],
    ["mg", "milligrams?|mg"], ["kg", "kilo(?:gram)?s?|kgs?"], ["g", "grams?|g"], ["t", "(?:metric )?tons?|tonnes?"],
    ["oz", "ounces?|oz"], ["lb", "pounds? (?=in|to|into)|lbs?|pounds?(?! sterling)"], ["st", "stones?"],
    ["ml", "millilit(?:er|re)s?|ml"], ["cl", "centilit(?:er|re)s?|cl"], ["dl", "decilit(?:er|re)s?|dl"], ["l", "lit(?:er|re)s?|l"],
    ["m3", "cubic met(?:er|re)s?"], ["tsp", "teaspoons?|tsp"], ["tbsp", "tablespoons?|tbsp"], ["floz", "fluid ounces?|fl oz"],
    ["cup", "cups?"], ["pt", "pints?|pts?"], ["qt", "quarts?|qts?"], ["gal", "gallons?|gal"],
    ["km2", "square kilomet(?:er|re)s?|sq km|km2"], ["m2", "square met(?:er|re)s?|sq m|m2"], ["ft2", "square f(?:oo|ee)t|sq ft"],
    ["mi2", "square miles?|sq mi"], ["ha", "hectares?|ha"], ["acre", "acres?"],
    ["kmh", "kilomet(?:er|re)s? (?:an|per) hour|km/h|kph|kmh"], ["mph", "miles (?:an|per) hour|mph"], ["ms", "met(?:er|re)s per second|m/s"], ["kn", "knots?"],
    ["sec", "seconds?|secs?"], ["min", "minutes?|mins?"], ["h", "hours?|hrs?"], ["day", "days?"], ["wk", "weeks?"],
    ["tb", "terabytes?|tb"], ["gb", "gigabytes?|gigs?|gb"], ["mb", "megabytes?|megs?|mb"], ["kb", "kilobytes?|kb"], ["b", "bytes?"],
    ["c", "(?:degrees? )?(?:celsius|centigrade|c)"], ["f", "(?:degrees? )?(?:fahrenheit|f)"], ["k", "kelvins?|k"]
];
var CURRENCY_WORDS = [
    ["USD", "us dollars?|american dollars?|dollars?|usd|bucks|\\$"], ["EUR", "euros?|eur|€"], ["GBP", "british pounds?|pounds? sterling|sterling|quid|gbp|£"],
    ["JPY", "japanese yen|yen|jpy|¥"], ["CHF", "swiss francs?|francs?|chf"], ["CAD", "canadian dollars?|cad"], ["AUD", "australian dollars?|aud"],
    ["NZD", "new zealand dollars?|nzd"], ["CNY", "chinese yuan|yuan|renminbi|rmb|cny"], ["HKD", "hong kong dollars?|hkd"],
    ["SGD", "singapore dollars?|sgd"], ["INR", "indian rupees?|rupees?|inr"], ["KRW", "korean won|won|krw"], ["SEK", "swedish kronor|swedish krona|sek"],
    ["NOK", "norwegian kroner|norwegian krone|nok"], ["DKK", "danish kroner|danish krone|dkk"], ["PLN", "polish zloty|zloty|pln"],
    ["CZK", "czech koruna|crowns|czk"], ["HUF", "forints?|huf"], ["MXN", "mexican pesos?|pesos?|mxn"], ["BRL", "brazilian reals?|reais|reals?|brl"],
    ["ZAR", "south african rand|rand|zar"], ["TRY", "turkish lira|lira|try"], ["ILS", "shekels?|ils"], ["THB", "baht|thb"],
    ["IDR", "rupiah|idr"], ["PHP", "philippine pesos?|php"], ["MYR", "ringgit|myr"], ["RON", "romanian lei|lei|ron"], ["ISK", "icelandic kronur|isk"], ["BGN", "leva|bgn"]
];
function wordUnit(w, table) {
    var s = String(w || "").trim().replace(/\.$/, "");
    for (var i = 0; i < table.length; ++i) if (new RegExp("^(?:" + table[i][1] + ")$").test(s)) return table[i][0];
    return null;
}
// "convert 10 miles to km", "what's 20 USD in EUR", "how many cups in a
// liter", "100 fahrenheit in celsius"
function convert(t) {
    var s = digits(t).replace(/(\d),(\d{3})\b/g, "$1$2");
    var m = /^(?:convert |change |what(?:'s| is| are) |how (?:much|many) (?:is |are )?)?(-?\d+(?:\.\d+)?|an?|one) ?(.+?) (?:in|to|into|as|in to|equals how many|is how many|are how many)(?: (?:a|an))? (.+?)$/.exec(s);
    var value, from, to;
    if (m) { value = /^(?:an?|one)$/.test(m[1]) ? 1 : Number(m[1]); from = m[2]; to = m[3]; }
    else if ((m = /^how many (.+?) (?:are |is )?(?:there )?(?:in|to) (?:a |an |one )?(-?\d+(?:\.\d+)?)? ?(.+)$/.exec(s))) { to = m[1]; value = m[2] ? Number(m[2]) : 1; from = m[3]; }
    else if ((m = /^(?:convert |what(?:'s| is) )?(?:\$|€|£)(\d+(?:\.\d+)?) (?:in|to|into) (.+)$/.exec(s))) { value = Number(m[1]); from = s.match(/[$€£]/)[0]; to = m[2]; }
    else return null;
    var fu = wordUnit(from, UNIT_WORDS), tu = wordUnit(to, UNIT_WORDS);
    if (fu && tu) return { value: value, from: fu, to: tu };
    var fc = wordUnit(from, CURRENCY_WORDS), tc = wordUnit(to, CURRENCY_WORDS);
    // "50 pounds to dollars": money, when the other side is.
    if (!fc && tc && /^pounds?$/.test(from)) fc = "GBP";
    if (fc && !tc && /^pounds?$/.test(to)) tc = "GBP";
    if (fc && tc) return { value: value, from: fc, to: tc, currency: true };
    return null;
}

function worldTime(t) {
    var m = /^(?:what(?:'s| is) the (?:time|date)|what time is it|what day is it|tell me the time|time|current time|the time) (?:right now |now )?in (.+?)(?: right now| now)?$/.exec(t)
        || /^what time (?:is it )?(?:in|at) (.+?)(?: right now| now)?$/.exec(t);
    return m ? { place: m[1] } : null;
}
function distance(t) {
    var m = /^how far (?:away )?(?:is it |away is |is |am i from )?(?:to |from here to )?(.+?)(?: from here| away)?$/.exec(t)
        || /^(?:what(?:'s| is) the )?distance (?:to|from here to) (.+)$/.exec(t);
    if (!m || /^(?:it|that|there|this)$/.test(m[1])) return null;
    return { place: m[1].replace(/^the /, "") };
}
// "show my photos from yesterday", "photos from last week", "pictures I
// took on Friday"
function photos(t, ctx) {
    var m = /^(?:show|open|find|view|display|see|get|look at)(?: me)? (?:all )?(?:my |the )?(?:photos|pictures|pics|images|photographs|snaps|screenshots)(?: (?:i took|taken|from|of|on|that i took|i made))?(?: (.+))?$/.exec(t)
        || /^(?:my )?(?:photos|pictures|pics) (?:from|of|taken) (.+)$/.exec(t);
    if (!m) return null;
    var said = (m[1] || "").replace(/^(?:from|on|of|taken) /, "");
    if (!said) return { from: null, to: null, label: "" };
    var info = extract(said, ctx.now);
    if (info.rest.replace(/\b(?:from|on|the|of)\b/g, "").trim()) return null;
    if (info.week) {
        var w = D.weekRange(ctx.now);
        var from = info.week === "last" ? D.addDays(D.mondayOf(ctx.now), -7) : info.week === "next" ? w.to : D.mondayOf(ctx.now);
        return { from: from, to: D.addDays(from, 7), label: info.week + " week" };
    }
    if (info.weekend) return { from: info.day, to: D.addDays(info.day, 2), label: info.weekend + " weekend" };
    if (info.day === undefined) return null;
    // A weekday said alone means the last one (photos are of the past).
    var day = info.day > ctx.now ? D.addDays(info.day, -7) : info.day;
    return { from: day, to: D.addDays(day, 1), label: info.dayWord || "" };
}

function undo(t) {
    if (/^(?:undo|undo that|undo it|take (?:that|it) back|revert(?: that)?|delete (?:that|it)|remove (?:that|it)|cancel (?:that|it)|scratch that|never ?mind|forget (?:it|that)|cancel|no cancel|stop that|don't do (?:that|it))$/.test(t))
        return { pending: /^(?:cancel|never|forget|no |stop|don't|scratch)/.test(t) };
    return null;
}

// Things only a language model (or the web) can do: noted, then the router
// goes on to the on-device model or offers a cloud model.
function beyond(t) {
    if (/^(?:translate|how do (?:you|i) say|what(?:'s| is) .+ in (?:french|spanish|german|italian|japanese|chinese|portuguese|korean|russian|arabic|dutch|greek)$)/.test(t)) return { what: "translate" };
    return null;
}

function time(t) {
    if (/^(?:what(?:'s| is) the time|what time is it|tell me the time|the time|time|current time)(?: now| right now)?$/.test(t)) return { what: "time" };
    if (/^(?:what(?:'s| is) (?:the date|today's date|the day)|what day is it(?: today)?|what is today|what's today|what's the date today|today's date)$/.test(t)) return { what: "date" };
    return null;
}

function navigate(t) {
    var m = /^(?:navigate|directions|get directions|give me directions|take me|drive me|drive|route me|guide me|show me the way|how do i get|how do i go|get me|find a route|show me how to get) (?:to |home)?(.*)$/.exec(t);
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
        if (/^(?:today|tonight|tomorrow)$/.test(place)) { day = place; place = ""; }
        return { place: place, day: day };
    }
    m = /^(?:will|is) it (?:going to )?(?:be )?(rain|raining|snow|snowing|sunny|hot|cold|warm|windy)(?: (?:in|at) (.+?))?(?: (today|tonight|tomorrow))?$/.exec(t)
        || /^do i need (?:an umbrella|a coat|a jacket)()(?: (?:in|at) (.+?))?(?: (today|tonight|tomorrow))?$/.exec(t);
    if (m) return { place: m[2] || "", day: m[3] || "", about: m[1] || "rain" };
    if (/^(?:how (?:hot|cold|warm) is it|is it (?:hot|cold) outside)(?: outside)?$/.test(t)) return { place: "", day: "" };
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

// Commands apps declare (appinfo.json; lib/grammar.js compiles their
// phrases): the ones they wrote phrases for come before the built-in
// commands; their Just Type Quick Actions ("New Task {text}", which only
// open the app) after them.
function appCommand(quick) {
    return function (t, ctx) {
        var list = (ctx && ctx.appCommands) || [];
        for (var i = 0; i < list.length; ++i) {
            if (!!list[i].quickAction !== quick) continue;
            for (var j = 0; j < list[i].phrases.length; ++j) {
                var m = new RegExp("^" + list[i].phrases[j] + "$").exec(t);
                if (m) return { key: list[i].key, text: cased((m[1] || "").trim(), ctx) };
            }
        }
        return null;
    };
}

var rules = [
    ["undo", undo],
    ["worldTime", worldTime],
    ["time", time],
    ["convert", convert],
    ["calculate", function (t) { var e = arithmetic(t); return e ? { expression: e } : null; }],
    ["weather", weather],
    ["battery", battery],
    ["timerStatus", timerStatus],
    ["timerCancel", timerCancel],
    ["stopwatch", stopwatch],
    ["timer", timer],
    ["alarmList", alarmList],
    ["alarmManage", function (t, ctx) { return alarmManage(t, ctx.now); }],
    ["alarm", function (t, ctx) { return alarm(t, ctx.now, ctx); }],
    ["agenda", agenda],
    ["app", appCommand(false)],
    ["note", note],
    ["findNotes", findNotes],
    ["contactAdd", contactAdd],
    ["contactInfo", contactInfo],
    ["task", task],
    ["event", event],
    ["reminder", function (t, ctx) { return reminder(t, ctx.now, ctx); }],
    ["searchEmail", searchEmail],
    ["email", email],
    ["readMessages", readMessages],
    ["media", media],
    ["volume", volume],
    ["brightness", brightness],
    ["settings", settingsPage],
    ["toggle", toggle],
    ["screenshot", screenshot],
    ["lock", lock],
    ["call", call],
    ["navigate", navigate],
    ["distance", distance],
    ["photos", photos],
    ["text", textMessage],
    ["play", play],
    ["app", appCommand(true)],
    ["beyond", beyond],
    ["search", search],
    ["open", openApp]
];

// ---- Does a model's choice fit what was said? -----------------------------------------------

// A language model (above all a small one on the device) sometimes picks
// a command the words never asked for ("why is the sky blue" -> play
// music). Its choice runs only when the words name that kind of thing;
// otherwise the assistant reads it back first. Reads (weather, sums, the
// time, a web search, the agenda) need nothing.
var MENTIONS = {
    toggle: {
        wifi: /\b(wi-?fi|wi fi|wireless|wlan|internet)\b/,
        bluetooth: /\bblue ?tooth\b/,
        airplane: /\b(airplane|aeroplane|flight|plane)\b/,
        flashlight: /\b(flash ?light|torch|light|dark)\b/,
        ringer: /\b(ringer|ring|ringtone|silent|silence|mute|unmute|sound|quiet|vibrate)\b/,
        dnd: /\b(disturb|dnd|quiet|silent|focus)\b/
    },
    timer: /\b(timer|countdown|count down|minutes?|seconds?|hours?)\b/,
    timerCancel: /\b(timer|countdown)\b/,
    stopwatch: /\bstop ?watch\b/,
    alarm: /\b(alarm|wake|get up)\b/,
    alarmManage: /\balarms?\b/,
    reminder: /\b(remind|reminder|remember|task|to-?do)\b/,
    event: /\b(calendar|event|meeting|appointment|schedule|book|diary|agenda|lunch|dinner|party)\b/,
    note: /\b(note|memo|write down|jot|remember)\b/,
    task: /\b(task|to-?do|list|remind)\b/,
    contactAdd: /\b(contact|address book|phone ?book|number)\b/,
    email: /\b(e-?mail|mail)\b/,
    play: /\b(play|music|song|songs|album|listen|put on)\b/,
    media: /\b(play|pause|stop|resume|next|skip|previous|back|song|track|music)\b/,
    volume: /\b(volume|loud|louder|quiet|quieter|mute|unmute|sound)\b/,
    brightness: /\b(bright|brightness|dim|dimmer|darker|screen)\b/,
    screenshot: /\b(screen ?shot|screen capture|capture|screen grab)\b/,
    lock: /\b(lock|screen off)\b/,
    navigate: /\b(navigate|directions?|take me|drive|route|get to|way to|go to)\b/,
    call: /\b(call|phone|ring|dial)\b/,
    text: /\b(text|message|sms|tell|send|write)\b/
};
function grounded(command, args, text) {
    var t = String(text || "").toLowerCase();
    var m = MENTIONS[command];
    if (command === "toggle") {
        if (!args || !m[args.setting] || !m[args.setting].test(t)) return false;
        // And the way it goes ("I need some light" is no "off").
        if (args.state === "on") return /\b(on|enable|activate|start|unmute)\b/.test(t) || (args.setting === "dnd" && /\bdisturb\b/.test(t));
        if (args.state === "off") return /\b(off|disable|deactivate|stop|mute|silence|quiet)\b/.test(t);
        return /\b(toggle|switch)\b/.test(t);
    }
    if (command === "open") return !!(args && args.title && t.indexOf(String(args.title).toLowerCase()) >= 0);
    if (!m) return true;
    return m.test(t);
}

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
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function dayText(ms, now) {
    var d = new Date(ms);
    var days = D.daysBetween(now, ms);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days === -1) return "yesterday";
    if (days > 1 && days < 7) return cap(WEEKDAYS[d.getDay()]);
    if (days < 0 && days > -7) return "last " + cap(WEEKDAYS[d.getDay()]);
    return d.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
}
// "today at 3:00 PM", "Friday", "tomorrow from 3:00 to 4:00 PM"
function whenText(start, end, allDay, now) {
    var day = dayText(start, now);
    var on = /^(?:today|tomorrow|yesterday|last )/.test(day) ? day : "on " + day;
    if (allDay) return on;
    return on + " at " + timeText(start);
}
function list(items) {
    return items.length > 1 ? items.slice(0, -1).join(", ") + " and " + items[items.length - 1] : items[0] || "";
}
var REPEAT_TEXT = { daily: "every day", weekdays: "on weekdays", weekends: "at weekends" };
function repeatText(r) {
    if (!r) return "";
    if (typeof r === "string") return REPEAT_TEXT[r] || "";
    var every = r.interval === 2 ? "every other " : "every ";
    if (r.freq === "DAILY") return every + "day";
    if (r.freq === "MONTHLY") return every + "month";
    if (r.freq === "YEARLY") return every + "year";
    var days = (r.days || []).slice().sort().join(",");
    if (days === "1,2,3,4,5") return "on weekdays";
    if (days === "0,6") return "at weekends";
    if (!r.days || !r.days.length) return every + "week";
    return every + list(r.days.map(function (d) { return cap(WEEKDAYS[d]); }));
}
var SETTING_NAMES = { wifi: "Wi-Fi", bluetooth: "Bluetooth", airplane: "Airplane mode", flashlight: "The flashlight", ringer: "The ringer", dnd: "Do Not Disturb" };
var PAGE_NAMES = { wifi: "Wi-Fi", bluetooth: "Bluetooth", airplane: "Airplane Mode", phone: "Phone Preferences", hotspot: "Hotspot & Tethering",
    vpn: "VPN", screen: "Screen & Lock", battery: "Battery", sounds: "Sounds & Ringtones", datetime: "Date & Time", language: "Language & Region",
    textassist: "Text Assist", justtype: "Just Type", clipboard: "Clipboard", assistant: "Assistant", usb: "USB", gamepads: "Game Controllers",
    location: "Location Services", emergency: "Emergency Info", accessibility: "Accessibility", deviceinfo: "Device Info", backup: "Backup",
    updates: "Updates", certificates: "Certificate Manager", devmode: "Developer Mode", advanced: "Advanced" };
var UNIT_NAMES = { mm: ["millimetre", "millimetres"], cm: ["centimetre", "centimetres"], m: ["metre", "metres"], km: ["kilometre", "kilometres"],
    in: ["inch", "inches"], ft: ["foot", "feet"], yd: ["yard", "yards"], mi: ["mile", "miles"], nmi: ["nautical mile", "nautical miles"],
    mg: ["milligram", "milligrams"], g: ["gram", "grams"], kg: ["kilogram", "kilograms"], t: ["tonne", "tonnes"], oz: ["ounce", "ounces"],
    lb: ["pound", "pounds"], st: ["stone", "stone"], ml: ["millilitre", "millilitres"], cl: ["centilitre", "centilitres"], dl: ["decilitre", "decilitres"],
    l: ["litre", "litres"], m3: ["cubic metre", "cubic metres"], tsp: ["teaspoon", "teaspoons"], tbsp: ["tablespoon", "tablespoons"],
    floz: ["fluid ounce", "fluid ounces"], cup: ["cup", "cups"], pt: ["pint", "pints"], qt: ["quart", "quarts"], gal: ["gallon", "gallons"],
    m2: ["square metre", "square metres"], km2: ["square kilometre", "square kilometres"], ft2: ["square foot", "square feet"],
    mi2: ["square mile", "square miles"], ha: ["hectare", "hectares"], acre: ["acre", "acres"], kmh: ["km/h", "km/h"], mph: ["mph", "mph"],
    ms: ["metre per second", "metres per second"], kn: ["knot", "knots"], sec: ["second", "seconds"], min: ["minute", "minutes"],
    h: ["hour", "hours"], day: ["day", "days"], wk: ["week", "weeks"], b: ["byte", "bytes"], kb: ["kilobyte", "kilobytes"],
    mb: ["megabyte", "megabytes"], gb: ["gigabyte", "gigabytes"], tb: ["terabyte", "terabytes"], c: ["°C", "°C"], f: ["°F", "°F"], k: ["kelvin", "kelvin"] };
function amount(v, unit) {
    var n = UNIT_NAMES[unit] || [unit, unit];
    var s = typeof v === "number" ? v : Number(v);
    var words = Math.abs(s) === 1 ? n[0] : n[1];
    return /^°/.test(words) ? v + words : v + " " + words;
}
function quote(s) { return "“" + s + "”"; }

var say = {
    off: function () { return "The assistant is turned off. You can turn it on in Settings > Assistant."; },
    notAllowed: function (title) { return "\"" + title + "\" is turned off in Settings > Assistant."; },
    openApp: function (title) { return "Open " + title; },
    // Timers and the stopwatch
    timerSet: function (s, label) { return "Timer set for " + durationText(s) + (label ? " (" + label + ")" : "") + "."; },
    timerDone: function (label) { return label ? "Your " + label + " timer is done." : "Your timer is done."; },
    timerLeft: function (timers, now) {
        if (!timers.length) return "You have no timers running.";
        return timers.map(function (x, i) {
            var left = durationText(Math.max(1, Math.round((x.ends - now) / 1000)));
            return (i === 0 ? cap(left) : left) + " left" + (x.label ? " on your " + x.label + " timer" : timers.length > 1 ? " on a timer" : "");
        }).join("; ") + ".";
    },
    timerCancelled: function (n, label) {
        if (!n) return label ? "You have no " + label + " timer." : "You have no timers running.";
        return n === 1 ? "Cancelled your " + (label ? label + " " : "") + "timer." : "Cancelled " + n + " timers.";
    },
    stopwatch: function (action, ms) {
        var s = durationText(Math.round(ms / 1000));
        if (action === "start") return "Stopwatch started.";
        if (action === "resume") return "Stopwatch going again, at " + s + ".";
        if (action === "stop") return "Stopwatch stopped at " + s + ".";
        if (action === "reset") return "Stopwatch reset.";
        if (action === "none") return "The stopwatch isn't running. Say \"start a stopwatch\".";
        return "The stopwatch is at " + s + ".";
    },
    // Alarms
    alarmSet: function (ms, now, label, occurs) {
        var r = occurs && occurs !== "once" ? " " + REPEAT_TEXT[occurs] + ", starting " + dayText(ms, now) : " " + dayText(ms, now);
        return "Alarm set for " + timeText(ms) + r + (label ? " (" + label + ")" : "") + ".";
    },
    alarmRepeatNot: function (what) { return "The Clock repeats alarms every day, on weekdays or at weekends, not " + what + ". I set it once."; },
    alarmsNone: function () { return "You have no alarms."; },
    alarmsList: function (alarms) {
        if (!alarms.length) return "You have no alarms.";
        var on = alarms.filter(function (a) { return a.enabled; });
        var items = alarms.map(function (a) { return a.niceTime + (a.occurs !== "once" ? " " + REPEAT_TEXT[a.occurs] : "") + (a.enabled ? "" : " (off)"); });
        return (alarms.length === 1 ? "You have one alarm: " : "You have " + alarms.length + " alarms" + (on.length !== alarms.length ? ", " + on.length + " on" : "") + ": ") + list(items) + ".";
    },
    alarmNoMatch: function (what) { return "You have no alarm for " + what + "."; },
    alarmsOff: function (items) { return items.length === 1 ? "Turned off your " + items[0] + " alarm." : "Turned off " + items.length + " alarms."; },
    confirmAlarmDelete: function (items) { return items.length === 1 ? "Delete your " + items[0] + " alarm?" : "Delete " + items.length + " alarms (" + list(items) + ")?"; },
    alarmsDeleted: function (n) { return n === 1 ? "Alarm deleted." : n + " alarms deleted."; },
    clockTime: function (h, m, mer) {
        var hh = mer === "pm" ? h % 12 + 12 : mer === "am" ? h % 12 : h;
        return mer || h > 12 || h === 0 ? timeText(new Date(2000, 0, 1, hh, m).getTime()) : h + ":" + (m < 10 ? "0" : "") + m;
    },
    // Reminders, tasks, notes
    reminderSet: function (text, due, now, repeat) {
        return due ? "I'll remind you to " + text + " " + whenText(due, null, false, now) + (repeat ? ", " + repeatText(repeat) : "") + "." : "Added " + quote(text) + " to your tasks.";
    },
    taskAdded: function (text, list, due, now, made) {
        return "Added " + quote(text) + " to " + (list ? "your " + list + " list" + (made ? " (a new list)" : "") : "your tasks") + (due ? ", due " + whenText(due, null, false, now) : "") + ".";
    },
    noteSaved: function () { return "Saved to Memos."; },
    notesFound: function (q, notes) {
        if (!notes.length) return q ? "I found no memos about " + quote(q) + "." : "You have no memos.";
        var first = notes.slice(0, 3).map(function (n) { return quote(String(n.text || n.title || "").split("\n")[0].slice(0, 60)); });
        return (notes.length === 1 ? "One memo" : notes.length + " memos") + (q ? " about " + quote(q) : "") + ": " + list(first) + (notes.length > 3 ? ", and more" : "") + ".";
    },
    // Calendar
    eventWhen: function () { return "When is it? Say a day and a time, like \"tomorrow at 3\"."; },
    eventAdded: function (title, start, end, allDay, now, location, repeat) {
        return "Added " + quote(title) + " to your calendar, " + whenText(start, end, allDay, now) + (repeat ? ", " + repeatText(repeat) : "") +
            (location ? ", at " + location : "") + ".";
    },
    noCalendar: function () { return "There's no calendar to add it to. Open Calendar to set one up."; },
    agenda: function (events, label, now) {
        if (!events.length) return "Nothing on your calendar " + label + ".";
        var items = events.slice(0, 5).map(function (e) {
            var multiDay = label.indexOf("week") >= 0;
            var at = e.allDay ? (multiDay ? dayText(e.start, now) + " (all day)" : "all day") : (multiDay ? dayText(e.start, now) + " " : "") + timeText(e.start);
            return quote(e.title) + " " + (e.allDay && !multiDay ? at : (multiDay ? at : "at " + at));
        });
        return cap(label) + " you have " + plural(events.length, "event") + ": " + list(items) + (events.length > 5 ? ", and " + (events.length - 5) + " more" : "") + ".";
    },
    agendaNext: function (e, now) {
        if (!e) return "Nothing coming up on your calendar.";
        return "Next: " + quote(e.title) + " " + whenText(e.start, null, e.allDay, now) + (e.location ? ", at " + e.location : "") + ".";
    },
    agendaFound: function (q, e, now) {
        if (!e) return "I couldn't find " + quote(q) + " on your calendar.";
        return quote(e.title) + " is " + whenText(e.start, null, e.allDay, now) + (e.location ? ", at " + e.location : "") + ".";
    },
    dayLabel: function (from, now) { var d = dayText(from, now); return /^(?:today|tomorrow|yesterday)$/.test(d) ? d : "on " + d; },
    // People
    contactAdded: function (name) { return "Added " + name + " to your contacts."; },
    contactNeedsMore: function () { return "Who? Say a name, and a number or an email address."; },
    contactInfo: function (name, what, value) {
        if (!value) return name + " has no " + (what === "phone" ? "phone number" : what) + " in your contacts.";
        return name + "'s " + (what === "phone" ? "number" : what) + " is " + value + ".";
    },
    // Email and messages
    noEmail: function (who) { return who + " has no email address in your contacts."; },
    noMailAccount: function () { return "There's no email account to send from. Add one in Accounts."; },
    confirmEmail: function (who, subject, body) { return "Email " + who + (subject ? ", subject " + quote(subject) : "") + ": " + quote(body) + "?"; },
    emailSent: function (who) { return "Email sent to " + who + "."; },
    emailComposing: function (who) { return "Here's a new email to " + who + "."; },
    emailsFound: function (q, emails, unread) {
        if (!emails.length) return unread ? "No unread email" + (q ? " from " + q : "") + "." : "I found no email" + (q ? " about " + quote(q) : "") + ".";
        var first = emails.slice(0, 3).map(function (e) { return quote(e.subject || "(no subject)") + (e.from ? " from " + e.from : ""); });
        return (unread ? plural(emails.length, "unread email") : (emails.length === 1 ? "One email" : emails.length + " emails") + (q ? " about " + quote(q) : "")) + ": " + list(first) + (emails.length > 3 ? ", and more" : "") + ".";
    },
    lastMessage: function (from, text, ms, now) {
        if (!from) return "You have no messages.";
        return from + " said, " + dayText(ms, now) + " at " + timeText(ms) + ": " + quote(text);
    },
    noMessagesFrom: function (who) { return "You have no messages from " + who + "."; },
    // Music, sound, the screen
    media: function (action) { return { pause: "Paused.", play: "Playing.", next: "Next song.", prev: "Previous song." }[action] || "Done."; },
    volume: function (v, muted) { return muted ? "Sound is muted." : "Volume " + v + "%."; },
    muted: function (on) { return on ? "Muted." : "Sound is back on, at the volume it was."; },
    brightness: function (v) { return "Brightness " + v + "%."; },
    dnd: function (on) { return on ? "Do Not Disturb is on: the ringer and alerts are silent." : "Do Not Disturb is off: the ringer is back on."; },
    screenshot: function () { return "Screenshot taken. It's in Photos."; },
    locked: function () { return "Locked."; },
    openingSettings: function (page) { return "Opening " + (PAGE_NAMES[page] || "Settings") + " settings."; },
    battery: function (percent, charging) { return "Your battery is at " + percent + "%" + (charging ? " and charging" : "") + "."; },
    // Conversions, the world
    converted: function (v, from, out, to) { return amount(v, from) + " is " + amount(out, to) + "."; },
    notSameKind: function () { return "Those can't be converted into each other."; },
    currency: function (v, from, out, to, date) { return v + " " + from + " is " + out + " " + to + (date ? " (rates of " + date + ")" : "") + "."; },
    noRates: function () { return "I can't get exchange rates right now: are you online?"; },
    worldTime: function (place, text, diff) {
        return "It's " + text + " in " + place + (diff === 0 ? ", the same as here." : diff ? ", " + Math.abs(diff) + (Math.abs(diff) === 1 ? " hour " : " hours ") + (diff > 0 ? "ahead." : "behind.") : ".");
    },
    noZone: function (place) { return "I don't know what time it is in " + place + "."; },
    distance: function (place, km, imperial) {
        var d = imperial ? km / 1.609344 : km;
        var n = d >= 100 ? Math.round(d / 10) * 10 : d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
        return cap(place) + " is about " + n.toLocaleString("en") + (imperial ? " miles" : " km") + " away, as the crow flies.";
    },
    photos: function (n, label) {
        if (!n) return "I found no photos" + (label ? " from " + label : "") + ".";
        return "Here " + (n === 1 ? "is 1 photo" : "are " + n + " photos") + (label ? " from " + label : "") + ".";
    },
    // Undo
    nothingToUndo: function () { return "There's nothing to undo."; },
    confirmUndo: function (what) { return "Undo: " + what + "?"; },
    undone: function () { return "Undone."; },
    undoWhat: {
        event: function (title) { return "remove " + quote(title) + " from your calendar"; },
        task: function (text) { return "remove " + quote(text) + " from your tasks"; },
        note: function () { return "delete that memo"; },
        alarm: function (time) { return "delete the " + time + " alarm"; },
        contact: function (name) { return "remove " + name + " from your contacts"; },
        timer: function () { return "cancel that timer"; }
    },
    beyond: function (what) { return what === "translate" ? "I can't translate on the phone." : ""; },
    // As before
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
    newThread: function () { return "New conversation"; },
    // A model's choice the words did not ask for, read back.
    didYouMean: function (what) { return "Did you mean: " + what + "?"; },
    describe: function (command, args, title) {
        if (command === "toggle") return (args.state === "toggle" ? "switch " : "turn ") + (SETTING_NAMES[args.setting] || args.setting).replace(/^The /, "the ") + (args.state === "toggle" ? "" : " " + args.state);
        if (command === "play") return "play " + (args.query ? "\"" + args.query + "\"" : "music");
        if (command === "open") return "open " + (args.title || args.name);
        if (command === "navigate") return "get directions to " + args.destination;
        if (command === "timer") return "set a timer for " + durationText(args.seconds || 0);
        if (command === "alarm") return "set an alarm for " + (args.time ? timeText(args.time) : "that time");
        if (command === "reminder") return "remind you to " + args.text;
        if (command === "event") return "add " + quote(args.title || "an event") + " to your calendar";
        if (command === "task") return "add " + quote(args.text) + " to your " + (args.list ? args.list + " list" : "tasks");
        if (command === "note") return "save a memo: " + quote(args.text);
        if (command === "media") return { pause: "pause the music", play: "play the music", next: "skip to the next song", prev: "go back a song" }[args.action] || "control the music";
        if (command === "volume") return args.action === "set" ? "set the volume to " + args.level + "%" : args.action === "mute" ? "mute the sound" : "turn the volume " + args.action;
        if (command === "brightness") return args.action === "set" ? "set the brightness to " + args.level + "%" : "turn the brightness " + args.action;
        if (command === "lock") return "lock the screen";
        if (command === "screenshot") return "take a screenshot";
        return title.toLowerCase() + (args && args.text ? " \"" + args.text + "\"" : "");
    }
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
    extract: extract,
    resolve: resolve,
    when: when,
    arithmetic: arithmetic,
    durationText: durationText,
    timeText: timeText,
    dayText: dayText,
    whenText: whenText,
    repeatText: repeatText,
    say: say,
    grounded: grounded
};
