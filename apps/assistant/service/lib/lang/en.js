// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's English: the command grammar (layer 2 of
// docs/M6-PLAN.md F3: no language model, instant, offline) and what the
// assistant says back. Another language is another file shaped like this
// one (lib/lang/<code>.js) registered in lib/grammar.js:
//
//   id, name
//   clean(text) -> text          lower case, no politeness, no end punctuation
//   rules: [[command, fn(text, ctx) -> args | null]], tried in order; the
//          commands and their arguments are lib/commands.js's
//   casual(text) -> [text]       the words said again in the rules' words,
//                                tried when no rule took them (optional)
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
    ["location", /^(?:the )?(?:location(?: services)?|gps|location tracking)$/],
    ["hotspot", /^(?:the |my )?(?:(?:wi-?fi |mobile |personal )?hot ?spot|tethering|wi-?fi tethering)$/],
    ["vpn", /^(?:the |my )?(?:(?:.+ )?vpn)$/],
    ["rotationLock", /^(?:the )?(?:rotation lock|orientation lock|screen lock rotation|lock rotation)$/],
    ["rotation", /^(?:the )?(?:rotation|screen rotation|auto[- ]?rotat(?:e|ion)|auto[- ]?rotate screen)$/],
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
    // "send Mom a message saying call me back": who, without the message's name.
    rest = rest.replace(/^(.+?) (?:a |an )?(?:quick )?(?:text|message|sms|note|line)(?: message)?(?=,|:| saying| that says| to say| and say| that)/, "$1");
    var sep = /^(.+?)(?:,|:| saying| that says| to say| and say| that)\s+(.+)$/.exec(rest);
    if (/^tell /.test(t) && !sep) return null;  // "tell me a joke"
    if (sep && !/^(?:me|us)$/.test(sep[1])) return { who: sep[1], message: cased(sep[2], ctx) };
    var best = nameAtStart(rest, ctx);
    if (best) return { who: best, message: cased(rest.slice(best.length).trim(), ctx) };
    // A number said in groups ("555 0142 hello"): all of it, then the words.
    var num = /^(\+?\(?\d[\d().-]*(?: \(?\d[\d().-]*)*)\s+(\D.*)$/.exec(rest);
    if (num && num[1].replace(/\D/g, "").length >= 3) return { who: num[1], message: cased(num[2], ctx) };
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
    if (/^(?:what|which) alarms?(?: do i have| are set| have i set| are on| is set)?$|^(?:show|list|check|open)(?: me)? (?:my |the |all (?:my )?)?alarms$|^do i have (?:an |any )?alarms?(?: set| on)?(?: for tomorrow| tomorrow)?$|^(?:what(?:'s| is)|when(?:'s| is)) my (?:next )?alarm(?: set for)?$|^(?:my )?alarms$|^what time (?:is|'s) (?:my |the )?(?:next )?alarm(?: set)?(?: for)?$/.test(t))
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
    // "add lunch with Sam on Friday at noon": a get-together with a time is an event too.
    var social = /^\s(?:an? |my )?(?:lunch|dinner|breakfast|brunch|coffee|drinks|party|date|interview|class|game|practice|session|catch-up|catch up|gym|workout)\b/.test(body);
    if (!noun && !onCalendar && !social && !/^(?:schedule|book|plan|arrange)$/.test(verb)) return null;
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
        return { range: "find", query: m[1].replace(/^next /, "") };
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
function findNotes(t, ctx) {
    var m = /^(?:find|search|show(?: me)?|look (?:for|up|through|in)|get|open|read(?: me)?|search through|check) (?:in |through )?(?:all )?(?:my |the )?(?:notes|memos)(?: (?:about|for|on|with|containing|mentioning|that mention|called|named|that say|with the word) (.+))?$/.exec(t)
        || /^(?:find|search|look for|look up) (?:my )?(.+?) in (?:my |the )?(?:notes|memos)$/.exec(t)
        || /^(?:find|show(?: me)?|open) (?:my |the )?(?:note|memo)s? (?:about|for|on|called) (.+)$/.exec(t);
    if (!m) return null;
    return { query: cased((m[1] || "").trim(), ctx) };
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
function searchEmail(t, ctx) {
    var m = /^(?:find|show(?: me)?|look for|search for|get|open) (?:the |my |any )?(?:e-?mails?|mail) from (.+)$/.exec(t);
    if (m) return { query: m[1], from: true, unread: false };
    m = /^(?:search|find|look (?:for|through|in)|check|search through)(?: in| through)? (?:my |the )?(?:e-?mails?|inbox|mail(?:box)?)(?: for| about)? (.+)$/.exec(t)
        || /^(?:find|show(?: me)?|look for|search for|get|open) (?:the |my |any )?(?:e-?mails?|mail|messages in my inbox) (?:about|with|mentioning|regarding|on|containing) (.+)$/.exec(t)
        || /^(?:find|search for|look for) (.+?) in (?:my )?(?:e-?mails?|inbox|mail)$/.exec(t);
    if (m) return { query: cased(m[1].replace(/^(?:for|about) /, ""), ctx), from: false, unread: false };
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
    // "any new texts", "read my unread messages": the unread ones.
    return { who: m[1] || "", unread: /\b(?:new|unread)\b/.test(t) };
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
    // Settings itself: its list of panes (webOS 2.x had a launch point per pane, no "Settings").
    if (/^(?:open|show(?: me)?|go to|take me to|launch|bring up) (?:the |my )?(?:settings|preferences)(?: app)?$|^settings$/.test(t)) return { page: "" };
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
// "show my photos from yesterday", "show my screenshots", "how many photos
// did I take last week" (count: only said, Photos not opened).
function photos(t, ctx) {
    var r = photosSaid(t, ctx);
    if (!r) return null;
    r.screenshots = /\bscreen ?shots?\b/.test(t);
    r.count = /^how many /.test(t);
    return r;
}
function photosSaid(t, ctx) {
    var m = /^(?:show|open|find|view|display|see|get|look at)(?: me)? (?:all )?(?:my |the )?(?:(?:recent|latest|last|new) )?(?:photos|pictures|pics|images|photographs|snaps|screen ?shots)(?: (?:i took|taken|from|of|on|that i took|i made))?(?: (.+))?$/.exec(t)
        || /^(?:my )?(?:photos|pictures|pics) (?:from|of|taken) (.+)$/.exec(t)
        || /^how many (?:photos|pictures|pics|screen ?shots)(?: (?:did i take|have i taken|do i have|i took))?(?: (.+?))?$/.exec(t);
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

// "directions to the nearest coffee shop", "how do I get to Starbucks",
// "walk to the park", "get me directions to 1 Infinite Loop by bike":
// the place as said (commands.js finds it: the closest of a kind, or a
// name nearest first) and how, when said.
function navigate(t) {
    var m = /^(?:(?:get|give|show) me |find |get )?(?:the )?(?:directions|a route|the way|route|navigation)(?: to| for)? (.+)$/.exec(t)
        || /^(?:navigate|take me|drive me|walk me|route me|guide me|bring me|show me the way|show me how to get|how do i get|how can i get|how do i go|how would i get|get me|find a route|find the way|drive|walk|cycle|bike|ride) (?:to |over to |home)(.*)$/.exec(t)
        || /^(?:navigate|take me|drive me|walk me|route me|guide me|show me the way|how do i get|how do i go|get me|find a route|show me how to get) (home)$/.exec(t)
        || /^(?:navigate|directions) (.+)$/.exec(t);
    if (!m) return null;
    var dest = (m[1] || (/home$/.test(m[0]) ? "home" : "")).trim(), mode = "";
    var how = /\s+(?:by (car|foot|bike|bicycle)|on (foot|a bike|my bike)|(walking|driving|cycling|biking))$/.exec(dest);
    if (how) { dest = dest.slice(0, how.index); mode = /foot|walking/.test(how[0]) ? "walk" : /bike|bicycle|cycling|biking/.test(how[0]) ? "bike" : "drive"; }
    if (!mode && /^(?:walk|walk me)\b/.test(t)) mode = "walk";
    if (!mode && /^(?:cycle|bike|ride)\b/.test(t)) mode = "bike";
    dest = dest.replace(/^(?:to|the way to)\s+/, "").replace(/^the /, "").replace(/\s+(?:from here|please|now)$/, "").trim();
    if (!dest || /^(?:it|there|that)$/.test(dest)) return null;
    var r = { destination: dest };
    if (mode) r.mode = mode;
    return r;
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
    if (!found) return null;
    return found.params && Object.keys(found.params).length ? { appId: found.id, title: found.title, params: found.params } : { appId: found.id, title: found.title };
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

// ---- Phone, messages: more (docs/AI-AND-MCP.md, "What it can do for each app") ----------------

// "call back", "call her back", "return my last call"; "redial"
function callBack(t) {
    if (/^(?:call (?:(?:him|her|them|that number|it) )?back|return (?:my |the |that )?(?:last |missed )?call|call back (?:the )?(?:last|missed) (?:call(?:er)?|number))$/.test(t)) return { which: "back" };
    if (/^(?:redial|call (?:the )?last number(?: (?:i|we) called)?(?: again)?|call (?:that|the last) number again|call again)$/.test(t)) return { which: "redial" };
    return null;
}
// "who called me", "did I miss any calls", "my recent calls"
function callLog(t) {
    if (/^(?:did i (?:miss|have) any (?:missed )?calls(?: today)?|(?:do i have |have i got |any )?missed calls?|(?:show(?: me)?|check|read) (?:my )?missed calls|have i missed any calls|who did i miss)$/.test(t)) return { missed: true };
    if (/^(?:who (?:just )?called(?: me)?(?: last| today)?|who was (?:that|the last) call(?: from)?|(?:what was|show(?: me)?|read) (?:my )?(?:last|latest|recent) calls?|(?:show(?: me)?|check) (?:my )?(?:recent calls|call log|call history)|(?:my )?(?:recent calls|call log|call history))$/.test(t)) return { missed: false };
    return null;
}
// "check my voicemail", "call voicemail", "do I have voicemail"
function voicemail(t) {
    if (/^(?:call|dial|listen to|play|get) (?:my )?voice ?mails?$/.test(t)) return { action: "call" };
    if (/^(?:check|show(?: me)?) (?:my )?voice ?mails?$|^(?:do i have|have i got|any) (?:any )?(?:new )?voice ?mails?$|^(?:how many )?(?:new )?voice ?mails?(?: do i have)?$/.test(t)) return { action: "status" };
    return null;
}
// "reply on my way", "reply to that saying ok", "text her back sounds good"
function replyMessage(t, ctx) {
    var m = /^(?:reply|respond|write back|text back|text (?:him|her|them) back)(?: to (?:that|it|him|her|them|this|the (?:last )?(?:message|text)))?(?:,|:| saying| with| that| back)?\s*(.*)$/.exec(t);
    if (!m) return null;
    return { message: m[1] ? capital(cased(m[1], ctx)) : "" };
}

// ---- Calendar: more ----------------------------------------------------------------------------

// The words naming an event, without the nouns and times: "dentist", "lunch with priya".
function eventWords(said) {
    return said.replace(new RegExp("\\b" + EVENT_NOUN + "s?\\b", "g"), " ").replace(/\b(?:my|the|our|that|this|a)\b/g, " ").replace(/\s+/g, " ").trim();
}
// "move my dentist appointment to 4pm", "reschedule lunch with Priya to Friday at noon"
function eventMove(t, ctx) {
    var m = /^(?:move|reschedule|push(?: back)?|shift|bring forward|change|switch) (?:my |the |our |that )?(.+?) (?:to|until|till|for|over to) (.+)$/.exec(t);
    if (!m || /\b(?:alarms?|timers?|tasks?|reminders?|notes?|memos?|contacts?|lists?|volume|brightness)\b/.test(m[1])) return null;
    var info = extract(m[2], ctx.now);
    if (info.rest.replace(/\b(?:at|on|the)\b/g, "").trim()) return null;
    var r = resolve(info, ctx.now, "day");
    if (r.start === null) return null;
    var all = /\b(?:all|every|each)\b|\bthe series\b/.test(m[1]);
    return { query: m[1].replace(/\b(?:all(?: of)?|every|each|the series of)\b ?/g, "").replace(/^(?:my|the) /, ""), start: r.start, hasTime: !!r.hasTime, hasDate: !!r.hasDate, all: all };
}
// "cancel my dentist appointment", "delete lunch with Priya from my calendar",
// "cancel my 3pm meeting tomorrow"
function eventCancel(t) {
    var m = /^(?:cancel|delete|remove|call off|clear|scrap|drop) (?:my |the |our |that )?(.+?)(?: (?:from|off|in|on) (?:my |the )?(?:calendar|schedule|agenda|diary))?$/.exec(t);
    if (!m) return null;
    var onCalendar = / (?:from|off|in|on) (?:my |the )?(?:calendar|schedule|agenda|diary)$/.test(t);
    var gathering = /\b(?:stand-?ups?|lunch|dinner|breakfast|brunch|class|lesson|practice|session|interview|party|date|game|gym|workout)\b/.test(m[1]);
    if (!onCalendar && !gathering && !new RegExp("\\b" + EVENT_NOUN + "s?\\b").test(m[1])) return null;
    if (/\b(?:alarms?|timers?|tasks?|reminders?|notes?|memos?|contacts?)\b/.test(m[1])) return null;
    var all = /\b(?:all|every|each)\b|\bthe series\b/.test(m[1]);
    return { query: m[1].replace(/\b(?:all(?: of)?|every|each|the series of)\b ?/g, "").replace(/^(?:my|the) /, ""), all: all };
}
// "am I free tomorrow at 3", "when am I free on Friday", "am I busy tonight"
function freeTime(t, ctx) {
    var m = /^(?:am i|will i be|are we|is my (?:calendar|schedule)) (free|busy|available|clear|open)(?: (.+?))?$/.exec(t)
        || /^when am i (free|available)(?: (.+?))?$/.exec(t)
        || /^(?:do i have|have i got) (?:any )?(free) time(?: (.+?))?$/.exec(t);
    if (!m) return null;
    var said = (m[2] || "today").replace(/^(?:for|on)\s+/, "");
    var info = extract(said, ctx.now);
    if (info.rest.replace(/\b(?:at|on|in|the|for)\b/g, "").trim()) return null;
    var r = resolve(info, ctx.now, "day");
    var day = info.day !== undefined ? info.day : D.startOfDay(r.start !== null ? r.start : ctx.now);
    return { day: D.startOfDay(day), at: r.hasTime ? r.start : null, label: info.dayWord || "" };
}

// ---- Notes, tasks: more ------------------------------------------------------------------------

// "add eggs to my shopping note", "append call Sam to my work memo"
function noteAppend(t, ctx) {
    var m = /^(?:add|append|put|write) (.+?) (?:to|on|in|at the end of) (?:my |the )?(.+?) (?:note|memo)$/.exec(t), text, which;
    if (m) { text = m[1]; which = m[2]; }
    else if ((m = /^(?:add|append) to (?:my |the )?(.+?) (?:note|memo)\s*[:,-]?\s+(.+)$/.exec(t))) { which = m[1]; text = m[2]; }
    else return null;
    if (/^(?:a|an|new)$/.test(which)) return null;
    return { query: cased(which, ctx), text: cased(text, ctx) };
}
// "what's on my shopping list", "what are my tasks", "read my to-do list"
function taskList(t) {
    var m = /^(?:what(?:'s| is| are)|whats|show(?: me)?|read(?: me)?|list|check|open|tell me)(?: (?:on|in))? (?:everything on )?(?:my |the |our )?(?:(.+?) )?(list|tasks|to-?dos?(?: list)?|todo list)$/.exec(t);
    if (m) {
        var name = (m[1] || "").trim();
        if (/\b(?:alarm|calendar|contact|email|message|call|play|reading)s?\b/.test(name)) return null;
        if (/^(?:to-?do|task|my)$/.test(name)) name = "";
        return { list: name };
    }
    if (/^what do i (?:need|have) to do(?: today)?$/.test(t)) return { list: "" };
    if (/^what do i (?:need|have) to (?:buy|get)$/.test(t)) return { list: "shopping" };
    return null;
}
// "mark buy milk as done", "check off eggs", "cross bread off my list"
function taskDone(t, ctx) {
    var m = /^(?:mark|set) (.+?) (?:as )?(?:done|complete|completed|finished)$/.exec(t)
        || /^(?:check|tick|cross) off (.+?)(?: (?:on|from) (?:my |the )?(?:.+? )?list)?$/.exec(t)
        || /^(?:check|tick|cross) (.+?) off(?: (?:my |the )?(?:.+? )?list)?$/.exec(t)
        || /^(?:complete|finish) (?:the )?task (.+)$/.exec(t);
    if (!m || /\b(?:alarms?|timers?|events?|meetings?)\b/.test(m[1])) return null;
    return { text: cased(m[1].replace(/^(?:the )?(?:task|item) /, ""), ctx) };
}

// ---- Maps, the web, the device, Marketplace ------------------------------------------------------

// "coffee near me", "find me a pharmacy nearby", "where's the nearest gas
// station", "what coffee shops are near me", "I need a pharmacy", "coffee
// shops": just what is looked for ("coffee shops"), never the sentence
// (Maps searches those words, and showed the owner his whole question).
var ASK_FOR = /^(?:(?:find|show|get|give|search for|look for|look up|locate|list)(?: me)?|are there(?: any)?|is there(?: an?| any)?|any|what(?: are)?(?: the| some)?|which|where can i (?:get|find|buy)(?: some| an?)?|where(?: are| is|'s)?(?: there)?(?: an?| some| any)?|i(?:'m| am) looking for|i (?:need|want))\s+/;
function nearby(t) {
    var m = /^(.+?)(?: (?:that )?(?:are|is))? (?:near me|nearby|near here|around here|close by|close to me|in the area|around me|near my location)$/.exec(t)
        || /^where(?:'s| is| are) the (?:nearest|closest) (.+)$/.exec(t)
        || /^(?:find|show(?: me)?|get me|search for) (?:the |a |an )?(?:nearest|closest) (.+)$/.exec(t);
    var what = m ? m[1] : "";
    if (!m) {
        // Nothing says "near": only a kind of place the words are all about
        // ("coffee shops", "the nearest pharmacy", "I need a pharmacy").
        var rest = t.replace(ASK_FOR, "");
        if (!nearbyLib.category(rest) || !(rest !== t || nearbyLib.category(t) || /^(?:the |an? )?(?:nearest|closest) /.test(t))) return null;
        what = rest;
    }
    what = what.replace(ASK_FOR, "").replace(/^(?:an?|the|some|any)\s+/, "").replace(/^(?:nearest|closest|nearby|good|best|local)\s+/, "")
        .replace(/\s+(?:that are open|open now|for me)$/, "").trim();
    if (!what || /^(?:it|me|you|anything|something|places?|stuff)$/.test(what)) return null;
    return { query: what };
}
// "open example.com", "go to wikipedia.org"
function website(t) {
    var m = /^(?:open|go to|visit|browse to|load|show me|take me to|pull up)? ?((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|co|uk|de|fr|nl|info|dev|app|me|tv|ca|au|jp|us|eu)(?:\/\S*)?)$/.exec(t);
    return m ? { url: m[1] } : null;
}
// "how much storage do I have"
function storageLeft(t) {
    return /^(?:how much (?:storage|space|room|disk space|memory)(?: is| do i have| have i got)?(?: left| free| available| remaining| used)?(?: on (?:my |the )?(?:phone|tablet|device))?|(?:check|show)(?: me)?(?: my)? (?:storage|disk space)|(?:my )?storage(?: left| space)?|am i (?:running )?out of (?:storage|space))$/.test(t) ? {} : null;
}
// "find Angry Birds in the Marketplace", "install Doom"
function appStore(t) {
    var m = /^(?:find|search for|look for|look up|show me|is there) (?:an? )?(.+?)(?: app)? (?:in|on|from) (?:the )?(?:marketplace|app store|app catalog|store)$/.exec(t)
        || /^search (?:the )?(?:marketplace|app store) for (?:an? )?(.+?)(?: app)?$/.exec(t);
    if (m) return { query: m[1], install: false };
    m = /^(?:install|download) (?:the |an? )?(.+?)(?: app)?(?: from (?:the )?(?:marketplace|app store))?$/.exec(t);
    if (m && !/\b(?:file|photo|picture|update|map|maps)s?\b/.test(m[1])) return { query: m[1], install: true };
    return null;
}
// "what's playing", "what song is this"
function nowPlaying(t) {
    return /^(?:what(?:'s| is|s) (?:this |that )?(?:song|track|tune)(?: playing| called)?|what(?:'s| is|s) playing(?: now)?|what song is (?:this|that|playing)|who(?:'s| is) (?:this|playing|singing)(?: song)?|name (?:this|that) (?:song|tune))$/.test(t) ? { action: "status" } : null;
}

// ---- Help (lib/lang/en-help.js) ---------------------------------------------------------------------

var HELP = require("./en-help").HOWTO;
var nearbyLib = require("../nearby");
// "help", "what can you do", "give me suggestions"; "how do I close an app"
function help(t) {
    if (/^(?:help|help me|i need help|can you help(?: me)?|what can (?:you|i) (?:do|say|ask)(?: (?:here|with you|you))?|what (?:can|do|else can) you do|what are you able to do|how (?:do|can|should) i use (?:you|this|the assistant)|how does this work|how do you work|give me (?:some )?(?:suggestions|ideas|tips|examples)|(?:any )?suggestions|(?:some )?tips|examples|show me what you can do|what should i (?:say|ask)|(?:list )?(?:your |the )?commands|what are (?:the |your )?commands|what do you know)$/.test(t))
        return { topic: "" };
    var m = /^(?:how (?:do|can|should|would) (?:i|you|one)|how to|what(?:'s| is| are)|tell me about|explain|help (?:me )?with|show me how to|teach me (?:how )?to|i (?:want|need) to|i don't know how to) (.+)$/.exec(t);
    if (!m) return null;
    var w = m[1].replace(/\?$/, "").replace(/ (?:on|in) (?:phoenix|webos|my phone|this phone|this tablet|the phone|my tablet)$/, "").trim();
    for (var i = 0; i < HELP.length; ++i) if (HELP[i].words.test(w)) return { topic: HELP[i].id };
    return null;
}

// ---- More (9 October 2026, second round) --------------------------------------------------------

// The weather at an hour: "what's the weather at 5pm", "will it rain this
// afternoon", "the weather tomorrow evening". -> weather's args with hour.
var DAY_PARTS = { "this morning": ["today", 9], "this afternoon": ["today", 15], "this evening": ["today", 19], "tonight": ["today", 21],
                  "tomorrow morning": ["tomorrow", 9], "tomorrow afternoon": ["tomorrow", 15], "tomorrow evening": ["tomorrow", 19], "tomorrow night": ["tomorrow", 21] };
function weatherHour(t) {
    var m = /^(.+?) (this morning|this afternoon|this evening|tonight|tomorrow morning|tomorrow afternoon|tomorrow evening|tomorrow night)$/.exec(t);
    if (m && m[2] !== "tonight") {
        var w = weather(m[1]);
        if (w && !w.day) return Object.assign(w, { day: DAY_PARTS[m[2]][0], hour: DAY_PARTS[m[2]][1] });
    }
    m = /^(.+?) (?:at|around|by|for) (\d{1,2}(?::\d{2})? ?(?:am|pm)?|\d{1,2} o'clock|noon|midday)(?: (today|tomorrow))?$/.exec(t);
    if (!m) return null;
    var base = weather(m[1]);
    var c = clock(m[2].replace(/ o'clock$/, ""));
    if (!base || !c) return null;
    var h = c.meridiem === "pm" ? c.hour % 12 + 12 : c.meridiem === "am" ? c.hour % 12 : c.hour < 7 ? c.hour + 12 : c.hour;
    return Object.assign(base, { day: m[3] || base.day || "today", hour: h });
}
// "how long will it take to drive to the airport", "how long to walk to
// Union Square", "how's the traffic to work"
function travelTime(t) {
    var m = /^how long (?:will it take|would it take|does it take|is it|to get|is the (?:drive|walk|ride))(?: me)?(?: to)? (?:(drive|walk|bike|cycle|ride|get|go)(?: there)? )?(?:to |into )?(.+?)(?: by (car|foot|bike|bicycle))?$/.exec(t)
        || /^how long to (drive|walk|bike|cycle|get|go) to (.+?)()$/.exec(t);
    if (m) {
        var how = m[3] || m[1] || "";
        var mode = /walk|foot/.test(how) ? "walk" : /bike|bicycle|cycle|ride/.test(how) ? "bike" : "drive";
        return { place: m[2].replace(/^the /, ""), mode: mode, traffic: false };
    }
    m = /^(?:how(?:'s| is|s)|what(?:'s| is|s)) (?:the )?traffic(?: like)?(?: (?:to|on the way to|on my way to) (.+?))?(?: (?:now|right now|today))?$/.exec(t)
        || /^is there (?:any |much )?traffic(?: (?:to|on the way to) (.+))?$/.exec(t);
    if (m) return { place: (m[1] || "").replace(/^the /, ""), mode: "drive", traffic: true };
    return null;
}
// "find my file called budget", "find the paris pdf", "where's my resume",
// "search my files for invoice"
function findFiles(t) {
    var m = /^(?:find|search for|look for|locate|where(?:'s| is| are)|open|show me) (?:my |the |a )?(?:files?|documents?|docs?|pdfs?|downloads?)(?: (?:called|named|about|with|for|that (?:say|says|mention)))? (.+)$/.exec(t)
        || /^(?:search|look through) (?:my |the )?(?:files|documents|downloads) for (.+)$/.exec(t)
        || /^(?:find|where(?:'s| is)|locate) (?:my |the )?(.+?) (?:file|document|doc|pdf|spreadsheet|presentation)s?$/.exec(t)
        || /^(?:find|look for|search for) (.+?) in (?:my |the )?(?:files|documents|downloads)$/.exec(t);
    if (!m) return null;
    var q = m[1].replace(/^(?:called|named) /, "").trim();
    var kind = /\bpdfs?\b/.test(t) && !/\bpdf\b/.test(q) ? "pdf" : "";
    return q ? { query: q, kind: kind } : null;
}
// "read my latest email", "read the email from Alex", "what does the last email say"
function readEmail(t) {
    var m = /^(?:read|open|show)(?: me)? (?:my |the )?(?:last|latest|newest|most recent|new) (?:e-?mail|mail)(?: from (.+))?$/.exec(t)
        || /^(?:read|open|show)(?: me)? (?:my |the )?(?:last |latest )?(?:e-?mail|mail) from (.+)$/.exec(t)
        || /^what(?:'s| does| did) (?:my |the )?(?:last|latest) (?:e-?mail|mail)(?: from (.+?))? say$/.exec(t);
    if (!m) return null;
    return { who: m[1] || "" };
}
// "reply to the email from Alex saying sounds good", "reply to my last email"
function emailReply(t, ctx) {
    var m = /^(?:reply|respond|answer|write back)(?: to)? (?:my |the |that )?(?:last |latest )?(?:e-?mail|mail)(?: from (.+?))?(?:(?:,|:| saying| with| that)\s*(.+))?$/.exec(t);
    if (!m) return null;
    var who = (m[1] || "").trim(), body = m[2] || "";
    var sep = who && /^(.+?)(?:,|:| saying| with| that)\s+(.+)$/.exec(who);
    if (sep) { who = sep[1]; body = sep[2]; }
    return { who: who, body: body ? capital(cased(body, ctx)) : "" };
}

// ---- Casual words ---------------------------------------------------------------------------
// What people say when they talk rather than dictate ("kill the wifi for
// now", "throw on some tunes", "pencil in a dentist visit next tuesday at
// 3", "drop Sam a line saying I'm on my way"): said again in the words the
// rules know, tried only when no rule took the words as they were
// (lib/grammar.js parse). The voice and model work's 28 phrasings the
// grammar missed (docs/AI-AND-MCP.md) are among casual.test.ts's.
var MUSIC_WORDS = "(?:some )?(?:tunes|music|songs|jams|beats|tracks|something(?: to listen to)?)";
var LET_KNOW = "(?: (?:via|by|over|in a|with a) (?:sms|text|message|imessage))?";
var CASUAL = [
    // Fillers at the end.
    [/^(.+?)(?:,)? (?:for now|for a bit|for a sec(?:ond)?|real quick|right now|now|thanks|thank you|cheers|mate|buddy|ok|okay)$/, "$1"],
    [/^(?:yo|hey|um|uh|so|ok so|okay so|alright|right),? (.+)$/, "$1"],
    // The flashlight.
    [/^(?:it's |it is )?(?:(?:pitch|really|so|too) )?dark(?: in here| out here)?(?:,? i (?:need|want) (?:some |a )?light)?$/, "turn on the flashlight"],
    [/^(?:i )?(?:need|want) (?:some |a little |a bit of )?light(?: in here)?$|^light me up\b.*$|^(?:give me|i need) some light\b.*$|^i can't see (?:a thing|anything)(?: in here)?$/, "turn on the flashlight"],
    // Switches: "get the bluetooth going", "kill the wifi", "fire up the hotspot".
    [/^(?:get|fire up|power up|kick on|bring up|start up|crank up) (?:the |my )?(.+?)(?: going| running| started| up| on| back on)?$/, function (m) { return toggleTarget(m[1]) ? "turn on " + m[1] : null; }],
    [/^(?:kill|cut|shut off|shut down|shut|nix|ditch|lose|drop|knock off|power down) (?:off )?(?:the |my )?(.+?)(?: off)?$/, function (m) {
        return toggleTarget(m[1]) ? "turn off " + m[1] : null; }],
    [/^(?:i )?(?:don't|do not) want (?:any )?(?:calls|interruptions|to be disturbed)\b.*$|^(?:hold|block) (?:all )?(?:my )?calls\b.*$|^no (?:more )?(?:calls|interruptions)\b.*$|^(?:.+,\s*)?go (?:silent|quiet)$|^(?:put|set) (?:the |my )?phone (?:on|to) (?:silent|vibrate)$|^stop (?:the )?ringing$|^shush$|^(?:shh+|hush)(?: phone)?$/, "go silent"],
    // Alarms: "set up a wake up call at 6", "I need to be up by 5:45".
    [/^(?:set up|set|make|book|schedule|give me|get me|i need|i want|order) (?:me )?(?:a )?wake[- ]?up call(?: (?:at|for))? (.+)$|^wake[- ]?up call(?: (?:at|for))? (.+)$/, function (m) { return "wake me up at " + (m[1] || m[2]); }],
    [/^(?:i (?:have|need|got) to |i've got to |i gotta |gotta |have to |need to )?(?:be up|get up|be awake|wake up|be out of bed)(?: by| at| for| before)? (.+)$/, "wake me up at $1"],
    [/^(?:get|wake) me (?:up )?(?:by|at|for|before) (.+)$/, "wake me up at $1"],
    // Timers: "count down three minutes for the eggs", "give me ten minutes".
    [/^(?:count ?down|time|countdown) (.+?) for (?:the |my )?(.+)$/, "set a timer for $1 called $2"],
    [/^(?:give me|start|put on|set) (?:a )?(.+? (?:seconds?|secs?|minutes?|mins?|hours?|hrs?))(?: on the clock| timer)?$/, "set a timer for $1"],
    [/^(?:let me know|tell me|ping me|buzz me|beep(?: me)?|shout) (?:in|after) (.+? (?:seconds?|secs?|minutes?|mins?|hours?|hrs?))$/, "set a timer for $1"],
    // Reminders: "don't let me forget to water the plants tonight at 8".
    [/^(?:don't|do not) let me forget (?:to |about |that )?(.+)$|^make sure i (?:remember to |don't forget to )?(.+)$|^(?:i )?(?:mustn't|must not|shouldn't|can't|cannot) forget (?:to |about )?(.+)$|^(?:don't|do not) forget (?:to |about )?(.+)$/, function (m) {
        return "remind me to " + (m[1] || m[2] || m[3] || m[4]); }],
    [/^(?:ping|nudge|buzz|bug|poke|alert) me (?:about|to|that|re|regarding) (.+)$/, "remind me about $1"],
    [/^(?:ping|nudge|buzz|bug|poke|alert) me (.+)$/, "remind me $1"],
    // Calendar: "pencil in a dentist visit next tuesday at 3".
    [/^(?:pencil|slot|squeeze|fit|block|jot|write|pop) (?:me )?(?:in|out|off|down)? ?(?:some )?(?:time (?:for )?)?(.+)$/, function (m, t) {
        return /^(?:jot|write) /.test(t) ? null : "schedule " + m[1]; }],
    // Messages: "drop Sam a line saying I'm on my way", "let Mary know I'll be late".
    [/^(?:drop|shoot|send|fire off|flick|ping) (.+?) (?:a |an )?(?:line|note|text|message|msg|sms)(?:,|:| saying| that says| to say| that|$)\s*(.*)$/, function (m) {
        return /^(?:me|us)$/.test(m[1]) || !m[2] ? null : "text " + m[1] + " saying " + m[2]; }],
    [new RegExp("^let (.+?) know(?: that)? (.+?)" + LET_KNOW + "$"), function (m) {
        return /^(?:me|us)$/.test(m[1]) ? null : "text " + m[1] + " saying " + m[2]; }],
    [/^(?:hit up|ping|text|message) (.+?) (?:and )?(?:say|tell (?:him|her|them)) (.+)$/, "text $1 saying $2"],
    // Volume and brightness: "it's way too loud, quieter please".
    [/^(?:(?:the )?screen(?: is|'s)|it's|it is|display(?: is|'s)) (?:way |much |a bit |a little |really |so )?too bright\b.*$|^(?:tone|turn) (?:the )?(?:screen|display) down$|^dim (?:it|the screen|the display)(?: down)?$|^too bright$/, "the screen is too bright"],
    [/^(?:(?:the )?screen(?: is|'s)|it's|it is|display(?: is|'s)) (?:way |much |a bit |a little |really |so )?too dark\b.*$|^i can't see the screen$|^(?:light|brighten) up the screen$|^brighten (?:it|the screen|the display)(?: up)?$/, "the screen is too dark"],
    [/^(?:it's |it is |that's |this is )?(?:way |much |a bit |a little |really |so |far )?too loud\b.*$|^(?:.+,\s*)?(?:quieter|softer)$|^(?:turn|tone) it down\b.*$|^keep it down$|^pipe down$|^(?:not so|less) loud$/, "quieter"],
    [/^(?:it's |it is |that's |this is )?(?:way |much |a bit |a little |really |so |far )?too quiet\b.*$|^i can't hear (?:it|anything|that|the music)\b.*$|^(?:crank|pump|turn) it up\b.*$|^(?:.+,\s*)?louder$|^(?:make it |a bit )?louder(?: please)?$/, "louder"],
    // Music: "throw on some tunes".
    [new RegExp("^(?:throw on|put on|spin|blast|bump|crank|crank up|queue up|play me|fire up|let's hear|let me hear|i want to hear|i wanna hear|gimme) " + MUSIC_WORDS + "$"), "play music"],
    [/^(?:throw on|spin|blast|bump|crank|crank up|queue up|play me|let me hear|i want to hear|i wanna hear) (.+)$/, "play $1"],
    // Weather: "what's the forecast looking like for the weekend".
    [/^(?:what's|what is|how's|how is) (?:the )?(weather|forecast)(?: looking)?(?: like)?(?: for| on)? (?:the |this )?(weekend|week|today|tonight|tomorrow)$/, function (m) {
        return "what's the " + m[1] + " " + (/^week/.test(m[2]) ? "this " + m[2] : m[2]); }],
    [/^(?:what's|what is|how's|how is) (?:the )?(?:weather|forecast) (?:looking|gonna be|going to be)(?: like)?(?: (?:in|for|at) (.+))?$/, function (m) { return "what's the weather" + (m[1] ? " in " + m[1] : ""); }],
    [/^(?:what's it|what is it) (?:gonna|going to) be like(?: outside)?(?: (today|tonight|tomorrow))?$/, function (m) { return "what's the weather" + (m[1] ? " " + m[1] : ""); }],
    // Apps: "fire up the camera".
    [/^(?:fire up|pull up|boot up|load up|start up|crack open|pop open|jump into|take me to|get me into|get into|hop into|i want|i need|gimme) (?:the |my )?(.+?)(?: app| application)?$/, "open $1"]
];
// The words said again, each way that fits ("kill the wifi for now" ->
// "kill the wifi" -> "turn off wifi"), for the rules to try in turn.
function casual(t) {
    var out = [], seen = {}, queue = [t];
    seen[t] = true;
    while (queue.length && out.length < 8) {
        var s = queue.shift();
        for (var i = 0; i < CASUAL.length; ++i) {
            var re = CASUAL[i][0], to = CASUAL[i][1], m = re.exec(s);
            if (!m) continue;
            var said = typeof to === "function" ? to(m, s) : s.replace(re, to);
            if (!said) continue;
            said = said.replace(/\s+/g, " ").trim();
            if (said && !seen[said]) { seen[said] = true; out.push(said); queue.push(said); }
        }
    }
    return out;
}

// ---- Details: one thing about one item ------------------------------------------------------
// "what time is my meeting with Sam", "where is it", "who's invited",
// "what did I write in my grocery memo", "when did Mom call", "what did
// Alex's last email say", "what's on my to-do list for today". The answer
// is that one thing, with the item's card; "it" is the item the
// conversation is about (the last one shown: assistant.js focus).
var IT_WORDS = /^(?:it|that|this|that one|this one|them|the (?:event|meeting|appointment)|that (?:event|meeting|appointment))$/;
// Words that name an event: a kind of event, a get-together, or "with" someone.
function eventish(q) {
    return new RegExp("\\b" + EVENT_NOUN + "s?\\b").test(q) || / with /.test(" " + q + " ")
        || /\b(?:lunch|dinner|breakfast|brunch|coffee|drinks|party|date|interview|class|lesson|game|practice|session|stand-?up|catch-?up|gym|workout|visit|checkup|check-up|dentist|doctor|haircut|flight|trip|concert|show|wedding|birthday party)\b/.test(q);
}
function detailEvent(q, field) {
    q = q.replace(/^(?:my|the|our) /, "").trim();
    // "Where's the nearest coffee shop" is a place nearby (nearby), not an event.
    if (/^(?:nearest|closest)\b/.test(q)) return null;
    if (IT_WORDS.test(q) || !q) return { kind: "event", query: "", field: field, it: true };
    if (/\b(?:alarm|timer|reminder|task|memo|note|email|message|call from)\b/.test(q) || !eventish(q)) return null;
    return { kind: "event", query: q, field: field, it: false };
}
function detail(t) {
    var m;
    if ((m = /^what time (?:is|'s|are) (.+?)(?: (?:at|on|starting|start|set for))?$/.exec(t)) || (m = /^when (?:does|do|will) (.+?) (?:start|begin)$/.exec(t))
        || (m = /^what time (?:does|do|will) (.+?) (?:start|begin)$/.exec(t)))
        return /^(?:it|it now|now)$/.test(m[1]) && /^what time/.test(t) ? null : detailEvent(m[1], "time");
    if ((m = /^where(?:'s| is| are| will) (.+?)(?: be)?(?: (?:held|happening|taking place|at))?$/.exec(t)))
        return detailEvent(m[1], "place");
    if ((m = /^who(?:'s| is| are)?(?: else)? (?:invited|coming|going|attending|in|joining|on the invite)(?: (?:to|for|at|in) (.+))?$/.exec(t))
        || (m = /^who(?:'s| is| am i) (?:meeting|seeing)(?: (?:at|in|for|on) (.+))?$/.exec(t))
        || (m = /^who(?:'s| is) (?:at|in) (.+)$/.exec(t)))
        return detailEvent(m[1] || "", "people");
    if ((m = /^how long (?:is|'s|will) (.+?)(?: (?:take|last|be))?$/.exec(t)))
        return detailEvent(m[1], "length");
    // A memo's words.
    if ((m = /^(?:what did i (?:write|put|say|jot down|note down|note|save) (?:in|on|about|to) |what(?:'s| is| was) (?:in|on) |what does |read(?: me)? |show(?: me)? |tell me what(?:'s| is) (?:in|on) )(?:my |the )?(.+?) (?:memo|note)(?: say)?$/.exec(t)))
        return /^(?:last|latest|new|newest)$/.test(m[1]) ? null : { kind: "memo", query: m[1], field: "text", it: false };
    if (/^(?:what did i (?:write|put)(?: in it| there)?|what(?:'s| is) in it|read it(?: to me| out)?|read me that one|what does it say)$/.test(t))
        return { kind: "", query: "", field: "text", it: true };
    return null;
}
// "when is Sam's birthday": the contact's (contactInfo); the calendar's if no contact has it.
function birthday(t) {
    var m = /^when(?:'s| is) (.+?)(?:'s|s') birthday$/.exec(t);
    return m && !/^(?:my|your)$/.test(m[1]) ? { who: m[1], what: "birthday", label: "" } : null;
}
// "what did Alex's last email say", "what did the last email from Alex say"
function emailSaid(t) {
    var m = /^what did (.+?)(?:'s|s') (?:last |latest |most recent )?(?:e-?mail|mail|message to me) say$/.exec(t)
        || /^what did (?:the |my )?(?:last |latest |most recent )?(?:e-?mail|mail) from (.+?) say$/.exec(t)
        || /^what(?:'s| is| was) (?:in )?(.+?)(?:'s|s') (?:last |latest )(?:e-?mail|mail)(?: about)?$/.exec(t);
    return m && !/^(?:i|me|my)$/.test(m[1]) ? { who: m[1] } : null;
}
// "when did Mom call", "did Sam call me today", "when was Sam's last call"
function callFrom(t) {
    var m = /^when did (.+?) (?:last )?(?:call|ring|phone)(?: me)?(?: last)?$/.exec(t)
        || /^(?:did|has) (.+?) (?:called|call|rung|ring|phoned|phone)(?: me)?(?: today| yet| back)?$/.exec(t)
        || /^when was (.+?)(?:'s|s') last call$/.exec(t);
    if (!m || /^(?:i|we|anyone|anybody|someone|somebody)$/.test(m[1])) return null;
    return { missed: false, who: m[1] };
}
// "what's on my to-do list for today", "what do I have to do tomorrow"
function tasksDue(t) {
    var m = /^(?:what(?:'s| is| are)|whats|show(?: me)?|read(?: me)?|list|check|tell me)(?: (?:on|in))? (?:everything on )?(?:my |the )?(?:(.+?) )?(list|tasks|to-?dos?(?: list)?|todo list)(?: (?:for|due))? (today|tomorrow|this week)$/.exec(t)
        || /^what do i (?:need|have) to do (today|tomorrow|this week)$/.exec(t);
    if (!m) return null;
    var name = m.length > 2 ? (m[1] || "").trim() : "", day = m.length > 2 ? m[3] : m[1];
    if (/\b(?:alarm|calendar|contact|email|message|call|play|reading)s?\b/.test(name)) return null;
    if (/^(?:to-?do|task|my)$/.test(name)) name = "";
    return { list: name, day: day };
}

// "change the meeting with Sam to 4", "move it to 3:30": a move to a time
// said without "at" (eventMove reads "at 4").
function eventMoveBare(t, ctx) {
    var m = /^((?:move|reschedule|push(?: back)?|shift|bring forward|change|switch) .+? (?:to|until|till|for)) (\d{1,2}(?::\d{2})?(?: ?[ap]\.?m\.?)?|noon|midday)$/.exec(t);
    return m ? eventMove(m[1] + " at " + m[2], ctx) : null;
}
// ---- Edits: changing what was found ----------------------------------------------------------
// "rename it to Coffee with Sam", "add Alex to it", "move it to Zoom",
// "remove eggs from it", "change Sam's email to sam@new.com", "set my 7am
// alarm to 6:30", "rename my grocery memo to Shopping": lib/details.js
// "edit" finds the item (by its words, or "it": the conversation's focus),
// changes it, reads it back, and offers Undo. What "add X to it" means is
// the item's: a guest for an event, a line for a memo, a task for a list.
function editTarget(s) {
    s = String(s || "").replace(/^(?:my|the|our) /, "").trim();
    if (!s || IT_WORDS.test(s)) return { it: true, query: "", kind: "" };
    if (/ (?:memo|note)$/.test(" " + s)) return { it: false, query: s.replace(/ ?(?:memo|note)$/, ""), kind: "memo" };
    if (/ list$/.test(" " + s)) return { it: false, query: s.replace(/ ?list$/, ""), kind: "list" };
    if (eventish(s)) return { it: false, query: s, kind: "event" };
    return null;
}
function edit(t, ctx) {
    var m, target, out;
    var withTarget = function (said, change, value) {
        var tg = editTarget(said);
        return tg ? { kind: tg.kind, query: tg.query, it: tg.it, change: change, value: value } : null;
    };
    // Rename: "rename it to X", "call it X", "change the title of X to Y".
    if ((m = /^(?:rename|retitle) (.+?) (?:to|as) (.+)$/.exec(t)) || (m = /^(?:call|name) (it|that|this|that one|this one) (.+)$/.exec(t))
        || (m = /^(?:change|set) (?:the )?(?:title|name) (?:of (.+?) )?to (.+)$/.exec(t)) || (m = /^(?:change|set) (?:its|it's) (?:title|name) to ()(.+)$/.exec(t)))
        return withTarget(m[1] || "", "title", capital(cased(m[2].replace(/^["“]|["”]$/g, ""), ctx)));
    // The place: "move it to Zoom", "change the location to Room 2", "it's at Bistro Verde now".
    if ((m = /^(?:change|set|update|switch) (?:the )?(?:location|place|venue|room)(?: (?:of|for) (.+?))? to (.+)$/.exec(t))
        || (m = /^(?:move|switch|shift|change) (.+?) to (?:(?:the )?(?:location|place|room|venue) )?(.+)$/.exec(t))
        || (m = /^(it|that)(?:'s| is) (?:at|in|on) (.+?) now$/.exec(t))) {
        // A time is a move (eventMove), not a place: "change the meeting with Sam to 4".
        var timeSaid = when("at " + m[2].replace(/^at /, ""), ctx.now) !== null;
        out = !timeSaid && !/\b(?:alarm|timer|list|memo|note)\b/.test(m[1] || "") ? withTarget(m[1] || "", "place", cased(m[2], ctx)) : null;
        if (out && (out.it || out.kind === "event")) return Object.assign(out, { kind: "event" });
    }
    // Add to it: a guest, a line, a task.
    if ((m = /^(?:add|invite|put) (.+?) (?:to|on|in|into) (it|that|this|that one|this one|the (?:event|meeting|list|memo|note))$/.exec(t)))
        return { kind: "", query: "", it: true, change: "add", value: cased(m[1], ctx) };
    if ((m = /^invite (.+?) to (.+)$/.exec(t)) && (target = editTarget(m[2])) && (target.it || target.kind === "event"))
        return { kind: "event", query: target.query, it: target.it, change: "add", value: cased(m[1], ctx) };
    // "add Alex to my meeting with Sam" (not "add a task to call the bank", "add Robin to my contacts").
    if ((m = /^add (.+?) to (.+)$/.exec(t)) && !/^(?:an?|the|some|my) /.test(m[1]) && !/\d|@/.test(t)
        && !/\b(?:contacts?|calendar|schedule|agenda|diary|lists?|tasks?|to-?dos?|notes?|memos?|favou?rites?)\b/.test(m[2])
        && (target = editTarget(m[2])) && target.kind === "event" && /^(?:my|the|our|that) /.test(m[2]))
        return { kind: "event", query: target.query, it: false, change: "add", value: cased(m[1], ctx) };
    // Take out of it.
    if ((m = /^(?:remove|take|delete|drop|uninvite|cross) (.+?) (?:from|off|out of) (.+)$/.exec(t)) && (target = editTarget(m[2])))
        return { kind: target.kind, query: target.query, it: target.it, change: "remove", value: cased(m[1].replace(/^(?:the )/, ""), ctx) };
    if ((m = /^uninvite (.+)$/.exec(t))) return { kind: "event", query: "", it: true, change: "remove", value: cased(m[1], ctx) };
    // A contact's details: "change Sam's email to sam@new.com".
    if ((m = /^(?:change|update|set|make|edit) (.+?)(?:'s|s') (e-?mail(?: address)?|(?:phone |mobile |cell |work |home )?number|phone|mobile|address|birthday) (?:to|as|is) (.+)$/.exec(t))
        && !/^(?:my|your|its|it)$/.test(m[1])) {
        var field = /mail/.test(m[2]) ? "email" : /address/.test(m[2]) ? "address" : /birthday/.test(m[2]) ? "birthday" : "phone";
        return { kind: "contact", query: m[1], it: false, change: field, value: field === "address" ? cased(m[3], ctx) : m[3].trim() };
    }
    // An alarm's time: "set my 7am alarm to 6:30", "change my alarm to 6:30".
    if ((m = /^(?:set|change|move|make|switch|push|reset|update) (?:my |the )?(?:(.+?) )?alarm(?: (?:for|at) (.+?))? (?:to|for) (.+)$/.exec(t))) {
        var from = ((m[1] || "") + " " + (m[2] || "")).replace(/\b(?:wake[- ]?up|morning|o'clock)\b/g, " ").trim();
        var fc = from ? clock(from) : null, tc = clock(m[3].replace(/^at /, "").replace(/ o'clock$/, ""));
        if ((from && !fc) || !tc) return null;
        // The new time's half of the day, when said; else the alarm's own (commands: details.js).
        return { kind: "alarm", query: from, it: false, change: "time", value: "", to: { hour: tc.hour, minute: tc.minute, meridiem: tc.meridiem || "" },
                 hour: fc ? fc.hour : null, minute: fc ? fc.minute : null, meridiem: fc ? fc.meridiem || "" : "" };
    }
    return null;
}

var rules = [
    ["help", help],
    ["undo", undo],
    ["worldTime", worldTime],
    ["time", time],
    ["convert", convert],
    ["calculate", function (t) { var e = arithmetic(t); return e ? { expression: e } : null; }],
    ["weather", weatherHour],
    ["weather", weather],
    ["travelTime", travelTime],
    ["battery", battery],
    ["storage", storageLeft],
    ["timerStatus", timerStatus],
    ["timerCancel", timerCancel],
    ["stopwatch", stopwatch],
    ["timer", timer],
    ["alarmList", alarmList],
    ["alarmManage", function (t, ctx) { return alarmManage(t, ctx.now); }],
    ["alarm", function (t, ctx) { return alarm(t, ctx.now, ctx); }],
    ["freeTime", freeTime],
    ["eventMove", eventMove],
    ["contactInfo", birthday],
    ["readEmail", emailSaid],
    ["callLog", callFrom],
    ["taskList", tasksDue],
    ["detail", detail],
    ["eventMove", eventMoveBare],
    ["edit", edit],
    ["agenda", agenda],
    ["app", appCommand(false)],
    ["noteAppend", noteAppend],
    ["note", note],
    ["findNotes", findNotes],
    ["contactAdd", contactAdd],
    ["contactInfo", contactInfo],
    ["taskList", taskList],
    ["taskDone", taskDone],
    ["task", task],
    ["event", event],
    ["reminder", function (t, ctx) { return reminder(t, ctx.now, ctx); }],
    ["eventCancel", eventCancel],
    ["readEmail", readEmail],
    ["emailReply", emailReply],
    ["searchEmail", searchEmail],
    ["email", email],
    ["readMessages", readMessages],
    ["replyMessage", replyMessage],
    ["callLog", callLog],
    ["voicemail", voicemail],
    ["callBack", callBack],
    ["media", nowPlaying],
    ["media", media],
    ["volume", volume],
    ["brightness", brightness],
    ["settings", settingsPage],
    ["toggle", toggle],
    ["screenshot", screenshot],
    ["lock", lock],
    ["call", call],
    ["navigate", navigate],
    ["nearby", nearby],
    ["distance", distance],
    ["photos", photos],
    ["text", textMessage],
    ["play", play],
    ["app", appCommand(true)],
    ["beyond", beyond],
    ["findFiles", findFiles],
    ["search", search],
    ["website", website],
    ["appStore", appStore],
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
        dnd: /\b(disturb|dnd|quiet|silent|focus)\b/,
        location: /\b(location|gps)\b/,
        hotspot: /\b(hot ?spot|tether\w*)\b/,
        vpn: /\bvpn\b/,
        rotation: /\b(rotat\w*|orientation)\b/,
        rotationLock: /\b(rotat\w*|orientation)\b/
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
var SETTING_NAMES = { wifi: "Wi-Fi", bluetooth: "Bluetooth", airplane: "Airplane mode", flashlight: "The flashlight", ringer: "The ringer", dnd: "Do Not Disturb",
                      location: "Location Services", rotation: "Screen rotation", rotationLock: "The rotation lock", hotspot: "The hotspot", vpn: "The VPN" };
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
// At most n characters, cut between words.
function excerpt(s, n) {
    if (s.length <= n) return s;
    var cut = s.slice(0, n), sp = cut.lastIndexOf(" ");
    return (sp > n / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

// Requests nothing here understood: the commands their words come close
// to, as one way each to say them (say.suggest), so "I can't do that" is
// not a dead end. First matches first; every example is a request the
// grammar takes as it stands (grammar.test.ts checks).
var SUGGESTIONS = [
    [/\b(?:meeting|appointment|event|calendar|schedule|lunch|dinner)\b/, ["add a meeting with Sam tomorrow at 3", "what's on my calendar tomorrow"]],
    [/\b(?:agenda|busy|free|plans?)\b/, ["what's on my calendar today"]],
    [/\b(?:remind|reminder|forget)\b/, ["remind me to call mom at 6"]],
    [/\b(?:alarm|wake|wakeup)\b/, ["set an alarm for 7am weekdays"]],
    [/\b(?:timer|countdown|minutes?)\b/, ["set a 10 minute timer"]],
    [/\b(?:stopwatch|stop watch)\b/, ["start a stopwatch"]],
    [/\b(?:note|notes|memo|jot|write)\b/, ["new note: buy flowers"]],
    [/\b(?:task|tasks|todo|to-do|to do|list|groceries|shopping)\b/, ["add milk to my shopping list"]],
    [/\b(?:e-?mail|inbox|mail)\b/, ["send an email to Priya saying see you soon", "do I have any new emails"]],
    [/\b(?:text|message|messages|sms|tell)\b/, ["text Sam I'm running late", "read my last message"]],
    [/\b(?:call|phone|dial|ring)\b/, ["call mom"]],
    [/\b(?:contact|contacts|number|address|birthday)\b/, ["what's Sam's number"]],
    [/\b(?:music|song|songs|play|album|artist|track|playlist)\b/, ["play some music by Miles Davis", "next song"]],
    [/\b(?:volume|louder|quieter|mute|sound)\b/, ["turn up the volume"]],
    [/\b(?:bright|brightness|dim|dimmer|screen)\b/, ["set brightness to 50%"]],
    [/\b(?:wi-?fi|bluetooth|airplane|flashlight|torch|silent|disturb)\b/, ["turn on Wi-Fi", "turn on the flashlight"]],
    [/\b(?:settings?|preferences)\b/, ["open Wi-Fi settings"]],
    [/\b(?:weather|rain|sunny|temperature|forecast|cold|hot)\b/, ["what's the weather tomorrow"]],
    [/\b(?:convert|miles?|km|kilometers?|pounds?|kg|cups?|liters?|fahrenheit|celsius|dollars?|euros?|usd|eur)\b/, ["convert 10 miles to km"]],
    [/\b(?:directions|navigate|drive|route|far|distance)\b/, ["navigate to the nearest coffee shop"]],
    [/\b(?:photos?|pictures?|pics)\b/, ["show my photos from yesterday"]],
    [/\b(?:time|date|day|clock)\b/, ["what time is it in Tokyo"]],
    [/\b(?:battery|charge|charging)\b/, ["what's my battery"]],
    [/\b(?:calculate|plus|minus|times|divided|percent|%)\b/, ["what's 15% of 80"]],
    [/\b(?:open|launch|start|app)\b/, ["open Maps"]]
];

// What nothing here can do yet: the app that does it, by its launch
// point's title (say.context; the router offers "Open <title>" when that
// app is installed). First match wins: the camera before the photos, the
// podcasts before the music.
var APP_WORDS = [
    [/\b(?:voicemail|call log|missed calls?|calls?|dial|redial)\b/, "Phone"],
    [/\b(?:texts?|sms|messages?|chats?)\b/, "Messaging"],
    [/\b(?:e-?mails?|inbox|mail)\b/, "Email"],
    [/\b(?:calendar|meetings?|appointments?|events?|schedule|agenda)\b/, "Calendar"],
    [/\b(?:contacts?|address book|phone ?book)\b/, "Contacts"],
    [/\b(?:memos?|notes?)\b/, "Memos"],
    [/\b(?:tasks?|to-?dos?|to do|groceries|shopping list)\b/, "Tasks"],
    [/\b(?:alarms?|timers?|stop ?watch|clock)\b/, "Clock"],
    [/\b(?:weather|forecast|temperature)\b/, "Weather"],
    [/\b(?:maps?|directions|navigate|nearby|near me|route|traffic)\b/, "Maps"],
    [/\b(?:podcasts?|episodes?)\b/, "Podcasts"],
    [/\b(?:music|songs?|albums?|playlists?|artists?|tracks?)\b/, "Music"],
    [/\b(?:videos?|movies?|films?)\b/, "Videos"],
    [/\b(?:camera|selfie|take a (?:photo|picture))\b/, "Camera"],
    [/\b(?:photos?|pictures?|pics|screenshots?|gallery)\b/, "Photos"],
    [/\b(?:files?|documents?|downloads?|folders?|pdfs?)\b/, "Files"],
    [/\b(?:app store|marketplace|install|uninstall)\b/, "Marketplace"],
    [/\b(?:passwords?|logins?)\b/, "Passwords"],
    [/\b(?:clipboard|copied)\b/, "Clipboard"],
    [/\b(?:wi-?fi|bluetooth|settings?|wallpaper|ringtone|vpn|hotspot)\b/, "Settings"],
    [/\b(?:websites?|browser|web ?page|bookmarks?)\b/, "Web"]
];
// A question about the world (a web search may answer it), and small talk
// (it may not).
var QUESTION = /^(?:what|what's|whats|who|who's|whom|whose|when|when's|where|where's|why|how|how's|which|is|are|was|were|do|does|did|can|could|should|would|will|tell me|explain|define|describe|meaning of|recipe|give me)\b|\?$/;
var SMALL_TALK = /^(?:hi|hello|hey|yo|good (?:morning|afternoon|evening|night)|how are you(?: doing| today)?|how's it going|what's up|sup|thanks|thank you|cheers|tell me a joke|say something funny|make me laugh|who are you|what(?:'s| is) your name|are you (?:there|real|a robot|human)|i love you|you're (?:great|awesome|funny|smart)|bye|goodbye|see you|good job|well done|nice)\b/;
// After a model's answer: what to do with it ("Save as Memo" for a recipe,
// Maps for where something is).
var RECIPE = /\b(?:recipes?|how (?:do|can|should) (?:you|i|we|one) (?:make|cook|bake|prepare|brew)|how to (?:make|cook|bake|prepare|brew))\b/;
var PLACE = /^(?:where(?:'s| is| are)|how far is|directions to|what(?:'s| is) the address of)\s+(?:the\s+)?(.+?)\??$/;

var say = {
    // What a request is: {question, smallTalk, app: an app's title or ""}.
    context: function (text) {
        var t = clean(text), app = "";
        for (var i = 0; i < APP_WORDS.length && !app; ++i) if (APP_WORDS[i][0].test(t)) app = APP_WORDS[i][1];
        var small = SMALL_TALK.test(t);
        // "Can you put the torch on?" asks the device to do something.
        var request = /^(?:can|could|would|will) you (?:please )?(?:turn|set|put|switch|call|text|send|open|play|start|stop|pause|add|remind|make|take|show|find|navigate|get|create|delete|cancel|mark|move|lock|mute|dim|raise|lower)\b/.test(t);
        return { question: !small && !request && QUESTION.test(t), smallTalk: small, app: app };
    },
    // Layer 4's words: nothing here can, and what can instead ("app":
    // the app that does it; "question": a web search; "other").
    // close: requests near it follow ("Did you mean ...?").
    fallback: function (kind, title, close) {
        if (kind === "app") return "I don't have the tools for that yet, but I can open " + title + " for you.";
        if (kind === "question") return "I can't answer that on my own yet, but I can search the web for it.";
        return "I'm not sure how to help with that yet." + (close ? "" : " I can search the web for it, or say “help” to see what I can do.");
    },
    // Things to do with a model's answer to text: [{label, run: {command,
    // args}} | {label, open: {query}}] (the router fills in the app).
    related: function (text, answer) {
        var t = clean(text), out = [], m;
        if (RECIPE.test(t) && answer) {
            var dish = t.replace(/^.*?\b(?:make|cook|bake|prepare|brew|recipes? for|recipe)\s+/, "").replace(/\?$/, "");
            if (/^(?:it|that|this|them|one)$/.test(dish)) dish = "recipe";
            out.push({ label: "Save as Memo", run: { command: "note", args: { text: capital(dish) + "\n\n" + answer } } });
        }
        if ((m = PLACE.exec(t))) out.push({ label: "Show in Maps", map: m[1] });
        return out;
    },
    // ---- Phone, messages
    noCalls: function (kind) { return kind === "outgoing" ? "You haven't called anyone yet." : "Nobody has called yet."; },
    callName: function (who) { return "Call " + who; },
    callKind: function (type) { return { missed: "Missed", incoming: "Incoming", outgoing: "Outgoing", ignored: "Ignored" }[type] || "Call"; },
    lastCall: function (c, now) {
        if (!c) return "There are no calls in your call log.";
        var when = whenText(c.at, null, false, now);
        if (c.type === "outgoing") return "Your last call was to " + c.name + ", " + when + ".";
        return (c.type === "missed" ? "You missed a call from " : "Your last call was from ") + c.name + ", " + when + ".";
    },
    missedCalls: function (list, now) {
        if (!list.length) return "No missed calls this week.";
        if (list.length === 1) return "You missed a call from " + list[0].name + ", " + whenText(list[0].at, null, false, now) + ".";
        return "You missed " + list.length + " calls: " + list(list.map(function (c) { return c.name + " " + whenText(c.at, null, false, now); })) + ".";
    },
    voicemail: function (count, waiting) {
        if (!waiting && !count) return "You have no new voicemail.";
        return count ? "You have " + plural(count, "new voicemail", "new voicemails") + "." : "You have new voicemail.";
    },
    callVoicemail: function () { return "Call Voicemail"; },
    noVoicemailNumber: function () { return "There's no voicemail number set. You can add it in Phone's preferences."; },
    nothingToReply: function () { return "There's no message to reply to yet."; },
    replyTo: function (who) { return "Reply to " + who; },
    unreadMessages: function (n) { return n === 1 ? "You have 1 new message." : "You have " + n + " new messages."; },
    noUnreadMessages: function () { return "You have no new messages."; },
    // ---- Calendar
    noSuchEvent: function (what) { return "I couldn't find " + (what ? quote(what) : "that") + " on your calendar."; },
    occurrenceMoved: function (title, at, start, now) {
        var to = D.startOfDay(at) === D.startOfDay(start) ? timeText(start) : whenText(start, null, false, now).replace(/^on /, "");
        return "Moved " + dayText(at, now).replace(/^on /, "") + "'s " + quote(title) + " to " + to + ". The others stay as they are.";
    },
    seriesMoved: function (title, start) { return "Every " + quote(title) + " is at " + timeText(start) + " now."; },
    seriesTimeOnly: function (title) { return quote(title) + " repeats: say a time to move them all, like \u201cmove all my " + title.toLowerCase() + "s to 10am\u201d, or a day to move just one."; },
    occurrenceCancelled: function (title, at, now) { return "Cancelled " + quote(title) + " " + whenText(at, null, false, now) + ". The others stay."; },
    confirmSeriesCancel: function (title) { return "Cancel every " + quote(title) + "?"; },
    seriesCancelled: function (title) { return "Cancelled every " + quote(title) + "."; },
    eventRepeats: function (title) { return quote(title) + " repeats. I can't change a repeating event yet: open it in Calendar to change one day or all of them."; },
    confirmEventCancel: function (title, start, allDay, now) { return "Cancel " + quote(title) + " " + whenText(start, null, allDay, now) + "?"; },
    eventCancelled: function (title) { return "Cancelled " + quote(title) + "."; },
    eventMoved: function (title, start, allDay, now) { return "Moved " + quote(title) + " to " + whenText(start, null, allDay, now).replace(/^on /, "") + "."; },
    freeAt: function (at, clash, now) {
        var when = whenText(at, null, false, now);
        if (!clash) return "Yes, you're free " + when + ".";
        return "No, you have " + quote(clash.title) + " then, " + timeText(clash.start) + " to " + timeText(clash.end) + ".";
    },
    freeSlots: function (slots, label, now) {
        var day = cap(label);
        if (!slots.length) return day + " you're busy all day, from 8 AM to 8 PM.";
        if (slots.length === 1 && slots[0].end - slots[0].start >= 11 * 3600000) return day + " your calendar is clear.";
        return day + " you're free " + list(slots.map(function (x) { return timeText(x.start) + " to " + timeText(x.end); })) + ".";
    },
    // ---- Memos, tasks
    noMemo: function (q) { return "I couldn't find a memo about " + quote(q) + ". Say \u201cnew note\u201d and what it says to start one."; },
    noteAppended: function (title) { return "Added it to your " + quote(excerpt(title, 40)) + " memo."; },
    noTask: function (q) { return "I couldn't find " + quote(q) + " in your tasks."; },
    taskDone: function (t) { return "Marked " + quote(t) + " as done."; },
    noList: function (name) { return "You don't have a list called " + quote(name) + "."; },
    tasks: function (name, items) {
        var where = name ? "your " + name + " list" : "your tasks";
        if (!items.length) return "There's nothing on " + where + ".";
        var shown = items.slice(0, 8).map(quote);
        return cap(where.replace(/^your /, "Your ")) + ": " + list(shown) + (items.length > 8 ? ", and " + (items.length - 8) + " more" : "") + ".";
    },
    // ---- Maps, the web, the device, Marketplace
    // ---- When it did not happen
    notSaved: function (app, why) { return "I couldn't save it" + (app ? " to " + app : "") + ": " + why + "."; },
    notThere: function () { return "it isn't there when I check"; },
    copyInstead: function () { return "Copy It Instead"; },
    copied: function () { return "Copied. You can paste it anywhere."; },
    // ---- Email, files, travel, hotspot and VPN
    readEmail: function (from, subject, text, at, now) {
        return "From " + from + ", " + whenText(at, null, false, now) + ": " + quote(subject || "(no subject)") + (text ? ". " + excerpt(text, 240) : ".");
    },
    noEmails: function () { return "You have no email."; },
    noEmailFrom: function (who) { return "You have no email from " + who + "."; },
    filesFound: function (q, names) {
        return names.length === 1 ? "I found " + quote(names[0]) + "." : "I found " + names.length + " files and folders for " + quote(q) + ".";
    },
    noFiles: function (q) { return "I couldn't find a file called " + quote(q) + ". I can open Files for you."; },
    noFilesService: function () { return "I can't search your files right now, but I can open Files for you."; },
    size: function (b) { return b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : b >= 1e3 ? Math.round(b / 1e3) + " KB" : b + " bytes"; },
    travelTime: function (place, seconds, km, mode, traffic, imperial) {
        var mins = Math.max(1, Math.round(seconds / 60)), time = mins < 60 ? plural(mins, "minute") : durationText(Math.round(mins / 5) * 300);
        var d = imperial ? km / 1.609344 : km, dist = (d >= 10 ? Math.round(d) : Math.round(d * 10) / 10) + (imperial ? " miles" : " km");
        var how = { drive: "by car", walk: "on foot", bike: "by bike" }[mode];
        return (traffic ? "I can't see live traffic, but without it " : "") + cap(place) + " is about " + time + " away " + how + " (" + dist + ")" +
            (traffic || mode !== "drive" ? "." : ", without traffic.");
    },
    noTraffic: function () { return "I can't see live traffic. Say where you're going, like \u201chow long to drive to the airport\u201d, or open Maps."; },
    noRoute: function (place) { return "I couldn't find a way to " + place + "."; },
    // Places and directions (commands.js nearby, directions)
    shortDistance: function (m, imperial) {
        if (imperial) { var mi = m / 1609.344; return mi < 0.1 ? Math.round(m * 3.28084 / 10) * 10 + " ft" : (mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)) + " mi"; }
        return m < 1000 ? Math.round(m / 10) * 10 + " m" : (m < 10000 ? Math.round(m / 100) / 10 : Math.round(m / 1000)) + " km";
    },
    shortTime: function (s) { var m = Math.max(1, Math.round(s / 60)); return m < 60 ? m + " min" : Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : ""); },
    byMode: function (mode) { return { drive: "by car", walk: "on foot", bike: "by bike" }[mode] || ""; },
    nearbyFound: function (what, name, m, imperial, n) {
        return (n > 1 ? "Here are " + what + " near you, closest first. " : "") + "The closest is " + name + ", " + say.shortDistance(m, imperial) + " away.";
    },
    noneNearby: function (what) { return "I couldn't find " + what + " near you."; },
    directionsTo: function (name, address, sum, mode, imperial, others) {
        var where = name + (address ? " (" + address + ")" : "");
        return (sum ? where + " is " + say.shortTime(sum.seconds) + " away " + say.byMode(mode) + ", " + say.shortDistance(sum.km * 1000, imperial) + "."
                    : "Here's the way to " + where + ".") + (others ? " There are others nearby too." : "");
    },
    startNavigation: function () { return "Start Navigation"; },
    weatherAt: function (place, at, temp, unit, desc, rain, about, now) {
        var when = whenText(at, null, false, now).replace(/^today at /, "at ").replace(/^on /, ""), where = place ? " in " + place : "";
        if (about === "rain" || about === "snow")
            return (typeof rain === "number" ? (rain >= 50 ? "Yes, likely: " : rain >= 20 ? "Maybe: " : "Probably not: ") + "a " + rain + "% chance of rain " : "") +
                when + where + ". " + cap(desc || "") + ", " + Math.round(temp) + "°" + unit + ".";
        return cap(when) + where + ": " + Math.round(temp) + "°" + unit + (desc ? " and " + desc : "") + (typeof rain === "number" ? ", " + rain + "% chance of rain." : ".");
    },
    noVpn: function () { return "You haven't set up a VPN yet. You can add one in Settings > VPN."; },
    vpnSignIn: function (name) { return quote(name) + " needs you to sign in. I've opened VPN settings."; },
    vpnOn: function (name) { return "Connecting to " + quote(name) + "."; },
    toggleFailed: function (setting, why) { return SETTING_NAMES[setting] + " didn't turn on: " + why + "."; },
    settingsTitle: function (page) { return PAGE_NAMES[page] || "Settings"; },
    nearby: function (q) { return "Here's " + q + " near you, in Maps."; },
    openingSite: function (url) { return "Opening " + url + "."; },
    storage: function (free, size) { return free ? "You have " + free + " free" + (size ? " of " + size : "") + "." : "I couldn't read how much storage is free."; },
    installed: function () { return "Installed"; },
    noApps: function (q) { return "I couldn't find " + quote(q) + " in the Marketplace."; },
    appsFound: function (q, titles) { return titles.length === 1 ? "I found " + titles[0] + " in the Marketplace." : "I found " + titles.length + " apps for " + quote(q) + " in the Marketplace."; },
    toInstall: function (title) { return "Here's " + title + " in the Marketplace: tap Install to get it."; },
    alreadyInstalled: function (title) { return title + " is already installed."; },
    noMarketplace: function () { return "I couldn't reach the Marketplace right now."; },
    nowPlaying: function (np) {
        if (!np) return "Nothing is playing right now.";
        return (np.playing ? "Playing " : "Paused: ") + quote(np.title) + (np.artist ? " by " + np.artist : "") + ".";
    },
    pauseIt: function () { return "Pause"; },
    playIt: function () { return "Play"; },
    nextOne: function () { return "Next"; },
    // ---- Help
    rightNow: function () { return "Right now"; },
    helpOverview: function () { return "Here's what I can do. Tap an example to try it, or just say what you want. I can also tell you how to use Phoenix: ask \u201chow do I close an app?\u201d"; },
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
    alarmsOff: function (items) {
        var seen = {}, unique = items.filter(function (x) { return seen[x] ? false : (seen[x] = true); });
        return items.length === 1 ? "Turned off your alarm for " + items[0] + "." : "Turned off " + items.length + " alarms (" + list(unique) + ").";
    },
    confirmAlarmDelete: function (items) {
        var seen = {}, unique = items.filter(function (x) { return seen[x] ? false : (seen[x] = true); });
        return items.length === 1 ? "Delete your alarm for " + items[0] + "?" : "Delete " + items.length + " alarms (" + list(unique) + ")?";
    },
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
        var first = notes.slice(0, 3).map(function (n) { return quote(excerpt(String(n.text || n.title || "").split("\n")[0], 60)); });
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
    // Details (one thing about one item)
    eventTime: function (title, start, end, allDay, now) {
        if (allDay) return quote(title) + " is all day, " + dayText(start, now) + ".";
        return quote(title) + " is " + whenText(start, null, false, now) + (end > start ? ", until " + timeText(end) : "") + ".";
    },
    eventPlace: function (title, place) { return place ? quote(title) + " is at " + place + "." : quote(title) + " has no place set."; },
    eventPeople: function (title, names) {
        return names.length ? list(names) + (names.length === 1 ? " is" : " are") + " invited to " + quote(title) + "." : "No one else is invited to " + quote(title) + ".";
    },
    eventLength: function (title, minutes, allDay) {
        if (allDay) return quote(title) + " is all day.";
        var h = Math.floor(minutes / 60), m = minutes % 60;
        return quote(title) + " is " + (h ? h + (h === 1 ? " hour" : " hours") : "") + (h && m ? " " : "") + (m || !h ? m + " minutes" : "") + ".";
    },
    memoSays: function (title, text) { return text ? "Your " + quote(excerpt(title, 40)) + " memo says: " + excerpt(text, 400) : "Your " + quote(excerpt(title, 40)) + " memo is empty."; },
    nothingInFocus: function () { return "Which one? Ask about it by name, like “where is my meeting with Sam”."; },
    // Edits (lib/details.js)
    renamed: function (from, to) { return "Renamed " + quote(from) + " to " + quote(to) + "."; },
    placeSet: function (title, place) { return quote(title) + " is at " + place + " now."; },
    invited: function (name, title) { return "Added " + name + " to " + quote(title) + "."; },
    alreadyInvited: function (name, title) { return name + " is already invited to " + quote(title) + "."; },
    uninvited: function (name, title) { return "Took " + name + " off " + quote(title) + "."; },
    notInvited: function (name, title) { return name + " isn't invited to " + quote(title) + "."; },
    noEmailFor: function (name) { return name + " has no email address in your contacts, so I can't invite them."; },
    lineRemoved: function (text, memo) { return "Took " + quote(text) + " out of your " + quote(excerpt(memo, 40)) + " memo."; },
    taskRemoved: function (text, list) { return "Took " + quote(text) + " off " + (list ? "your " + list + " list" : "your tasks") + "."; },
    contactChanged: function (name, what, value) { return name + "'s " + (what === "phone" ? "number" : what) + " is " + value + " now."; },
    alarmChanged: function (from, to) { return "Your " + from + " alarm is at " + to + " now."; },
    noAlarmAt: function (time) { return time ? "You don't have a " + time + " alarm." : "You don't have an alarm to change."; },
    whichAlarm: function (times) { return "You have alarms at " + list(times) + ": which one? Say “set my " + times[0] + " alarm to…”."; },
    cantEdit: function (what) { return "I can't change that " + (what || "item") + " here yet. Open it to change it."; },
    whatToChange: function () { return "Which one? Say its name, like “rename my meeting with Sam to Coffee with Sam”."; },
    callsFrom: function (name, c, now) {
        if (!c) return "There's no call from " + name + " in your call log.";
        var when = whenText(c.at, null, false, now);
        if (c.type === "outgoing") return "You last called " + c.name + " " + when + "; there's no call from them since.";
        return (c.type === "missed" ? "You missed a call from " : c.name + " last called ") + (c.type === "missed" ? c.name + " " : "") + when + ".";
    },
    tasksDue: function (name, day, items) {
        var where = name ? "your " + name + " list" : "your tasks";
        if (!items.length) return "There's nothing on " + where + " for " + day + ".";
        var shown = items.slice(0, 8).map(quote);
        return cap(day) + " on " + where + ": " + list(shown) + (items.length > 8 ? ", and " + (items.length - 8) + " more" : "") + ".";
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
    openingSettings: function (page) { return page ? "Opening " + (PAGE_NAMES[page] || "Settings") + " settings." : "Opening Settings."; },
    battery: function (percent, charging) { return "Your battery is at " + percent + "%" + (charging ? " and charging" : "") + "."; },
    // Conversions, the world
    converted: function (v, from, out, to) { return amount(v, from) + " is " + amount(out, to) + "."; },
    notSameKind: function () { return "Those can't be converted into each other."; },
    currency: function (v, from, out, to, date) { return v + " " + from + " is " + out + " " + to + (date ? " (rates of " + date + ")" : "") + "."; },
    noRates: function () { return "I can't get exchange rates right now: are you online?"; },
    worldTime: function (place, text, diff) {
        return "It's " + text + " in " + place + (diff === 0 ? ", the same as here." : diff ? ", " + Math.abs(diff) + (Math.abs(diff) === 1 ? " hour " : " hours ") + (diff > 0 ? "ahead." : "behind.") : ".");
    },
    noLookup: function (place) { return "I couldn't look up " + place + " right now: are you online?"; },
    noZone: function (place) { return "I don't know what time it is in " + place + "."; },
    distance: function (place, km, imperial) {
        var d = imperial ? km / 1.609344 : km;
        var n = d >= 100 ? Math.round(d / 10) * 10 : d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
        return cap(place) + " is about " + n.toLocaleString("en") + (imperial ? " miles" : " km") + " away, as the crow flies.";
    },
    // The title Photos gives the pictures: "Photos from Yesterday".
    photosTitle: function (label, what) { return cap(what || "photo") + "s from " + label.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); },
    // n found from label ("yesterday"); what: "photo" or "screenshot";
    // opened: Photos shows them too; count: only how many was asked.
    photos: function (n, label, what, opened, count) {
        var noun = what || "photo", from = label ? " from " + label : "";
        if (!n) return "You don't have any " + noun + "s" + from + ".";
        if (count) return "You have " + plural(n, noun) + from + ".";
        return "Here " + (n === 1 ? "is 1 " + noun : "are " + n + " " + noun + "s") + from + "." +
            (opened ? (n === 1 ? " I've opened it in Photos too." : " I've opened them in Photos too.") : "");
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
        timer: function () { return "cancel that timer"; },
        move: function (title) { return "move " + quote(title) + " back"; },
        restoreEvent: function (title) { return "put " + quote(title) + " back on your calendar"; },
        memoBack: function () { return "take that out of the memo"; },
        edit: function (what) { return "change " + what + " back"; },
        taskBack: function (t) { return "mark " + quote(t) + " as not done"; }
    },
    beyond: function (what) { return what === "translate" ? "I can't translate without a language model yet, but I can search the web for it." : ""; },
    // As before
    toggled: function (setting, on) { return SETTING_NAMES[setting] + (setting === "location" ? " are " : " is ") + (on ? "on" : "off") + "."; },
    noSuchContact: function (who) { return "I couldn't find " + who + " in your contacts."; },
    noNumber: function (who) { return who + " has no phone number in your contacts."; },
    confirmCall: function (who, number) { return "Call " + (who ? who + " (" + number + ")" : number) + "?"; },
    calling: function (who) { return "Calling " + who + "."; },
    confirmText: function (who, message) { return "Send \"" + message + "\" to " + who + "?"; },
    sent: function (who) { return "Sent to " + who + "."; },
    composing: function (who) { return "What would you like to say to " + who + "? I've opened Messaging."; },
    cancelled: function () { return "OK, I won't."; },
    unlockFirst: function () { return "Unlock your phone first, and I'll do that."; },
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
    // "Will it rain tomorrow?": about (rain, snow, sunny, hot, cold, warm,
    // windy) by the chance of rain and the day's sky and temperatures.
    weatherWill: function (about, place, day, chance, desc, hi, lo, unit) {
        var where = place ? " in " + place : "", when = day === "tonight" ? "tonight" : day;
        var sky = desc ? cap(desc) + ", " + Math.round(hi) + "° / " + Math.round(lo) + "°" + unit + "." : "";
        if (about === "rain" || about === "snow") {
            if (typeof chance !== "number") return sky || "I couldn't get the chance of " + about + ".";
            var word = about === "snow" ? "snow" : "rain";
            var likely = about === "snow" ? /snow/.test(desc) : chance >= 50;
            return (chance >= 50 ? "Yes, " + (likely ? word + " is likely" : "probably") : chance >= 20 ? "Maybe" : "Probably not") +
                where + " " + when + ": a " + chance + "% chance of " + (about === "snow" ? "precipitation" : "rain") + ". " + sky;
        }
        return cap(when) + where + ": " + sky;
    },
    weatherDays: function (place, days, unit, label, now) {
        if (!days.length) return "I couldn't get the forecast.";
        var where = place ? " in " + place : "";
        var his = days.map(function (d) { return Math.round(d.hi); }), los = days.map(function (d) { return Math.round(d.lo); });
        var wet = days.filter(function (d) { return d.rain >= 50; }).map(function (d) { return dayText(d.at, now); });
        return cap(label) + where + ": highs " + Math.min.apply(null, his) + "° to " + Math.max.apply(null, his) + "°" + unit +
            ", lows " + Math.min.apply(null, los) + "° to " + Math.max.apply(null, los) + "°" + unit + "." +
            (wet.length ? " Rain likely " + list(wet) + "." : " No rain expected.");
    },
    noPlace: function (place) { return "I couldn't find a place called " + place + "."; },
    // Why the location could not be had (commands.js here): "ask" (not
    // answered yet), "denied", "off", "unavailable"; purpose "weather" or
    // "distance".
    location: function (why, purpose) {
        var need = purpose === "distance" ? "work out how far that is" : purpose === "places" ? "find places near you and the way there" : "check the weather where you are";
        var instead = purpose === "distance" || purpose === "places" ? "" : " Or say a city, like \u201cweather in Paris\u201d.";
        if (why === "ask") return "To " + need + ", I need your location. Is it OK if I use it?";
        if (why === "denied") return "I'm not allowed to use your location. Allow it, here or in Settings > Location Services, and I'll " + need + "." + instead;
        if (why === "off") return "Location Services are off. Turn them on and I'll " + need + "." + instead;
        return "I couldn't find where you are right now." + (instead || " Try again in a moment.");
    },
    locationAccess: function (allow) { return allow ? "OK, I can use your location now." : "OK, I won't use your location. You can always say a city instead."; },
    allow: function () { return "Allow"; },
    dontAllow: function () { return "Don't Allow"; },
    allowLocation: function () { return "Allow Location"; },
    turnOnLocation: function () { return "Turn On Location Services"; },
    locationSettings: function () { return "Location Settings"; },
    noWeather: function () { return "I couldn't get the weather right now. I've opened Weather."; },
    askCloud: function (name) { return "Ask " + name; },
    searchWeb: function () { return "Search the web"; },
    setUpCloud: function () { return "Set up a cloud model"; },
    // Layer 4's other choice when no cloud model is set up: the UI asks
    // which (on-device, cloud or both) and Settings sets it up.
    connectModel: function () { return "Connect model"; },
    // Up to two requests close to what was asked (SUGGESTIONS), and the words that offer them.
    suggest: function (text) {
        var t = clean(text), out = [];
        SUGGESTIONS.forEach(function (s) {
            if (out.length < 2 && s[0].test(t)) s[1].forEach(function (e) { if (out.length < 2 && out.indexOf(e) < 0) out.push(e); });
        });
        return out;
    },
    suggestions: function () { return [].concat.apply([], SUGGESTIONS.map(function (s) { return s[1]; })); },
    didYouMeanAny: function (list) { return "Did you mean " + (list.length > 1 ? "something like " + quote(list[0]) + " or " + quote(list[1]) : quote(list[0])) + "?"; },
    // A question asked again once a model was connected (retry), with none there.
    noModelYet: function () { return "No model is connected yet. You can connect one in Settings > Assistant."; },
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

// The answer to a read-back ("Send it?") in words: "yes", "no", or null for
// something else (a new request).
function answer(t) {
    if (/^(?:yes|yeah|yep|yup|sure|ok|okay|correct|right|that's right|go ahead|do it|please do|yes please|send|send it|call|call (?:him|her|them)|yes send it|yes call)$/.test(t)) return "yes";
    if (/^(?:no|nope|no thanks|no thank you|don't|do not|don't send it|don't call|cancel|cancel it|stop|never ?mind)$/.test(t)) return "no";
    return null;
}

// ---- Follow-up questions (lib/followups.js) -------------------------------------------------
var TOPICS = { location: "where your meetings are", invitees: "who's coming to things", duration: "how long things last",
               alert: "reminders before events", due: "when things are due", list: "which list things go on",
               repeat: "whether alarms repeat", label: "what alarms are for", email: "email addresses for new contacts",
               phone: "phone numbers for new contacts" };
var COMMON_NOUNS = /^(?:meeting|lunch|dinner|breakfast|brunch|coffee|call|phone call|video call|appointment|event|drinks|catch-up|catch up|interview|party|class|session|game|practice|date)\b/i;
// "3 o'clock", "3:30" (people say the hour; 12-hour clock).
function clockWords(ms) {
    var d = new Date(ms), h = d.getHours() % 12 || 12, m = d.getMinutes();
    return m ? h + ":" + (m < 10 ? "0" : "") + m : h + " o'clock";
}
// "today", "tomorrow", "Friday", "October 20".
function dayWord(ms, now) {
    var days = D.daysBetween(now, ms);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days > 1 && days < 7) return cap(WEEKDAYS[new Date(ms).getDay()]);
    return new Date(ms).toLocaleDateString("en", { month: "long", day: "numeric" });
}
// An event as people name it: "tomorrow's lunch with Sam", "“Dentist” on
// Friday", "your 3 o'clock tomorrow" (not an event: its title quoted).
function eventThing(item, now) {
    var t = String(item.title || "");
    if (item.type !== "event") return quote(t);
    if (!item.start) return COMMON_NOUNS.test(t) ? "your " + t.charAt(0).toLowerCase() + t.slice(1) : quote(t);
    var day = dayWord(item.start, now), named = /^(?:today|tomorrow|[A-Z][a-z]+day)$/.test(day);
    if (COMMON_NOUNS.test(t) && named) return day + "'s " + t.charAt(0).toLowerCase() + t.slice(1);
    if (COMMON_NOUNS.test(t)) return "your " + t.charAt(0).toLowerCase() + t.slice(1) + " on " + day;
    return quote(t) + (named ? (day === "today" || day === "tomorrow" ? " " : " on ") + day : " on " + day);
}
// After something is made, one short question about what it still lacks;
// the answer as typed or said (a chip's label also matches).
var EMAIL_ONLY = /^(?:(?:it's|it is|her|his|their|the)?\s*(?:e-?mail(?: address)?(?: is)?)?\s*)([^\s@,]+@[^\s@,]+\.[a-z]{2,})$/;
var followUp = {
    // The question, as conversation: the thing named as people would, one
    // of a few phrasings (variant: how many of the kind were asked before).
    question: function (kind, item, now, variant) {
        var v = variant || 0, t = item.title || "";
        function pick(list) { return list[v % list.length]; }
        var thing = eventThing(item, now), q = quote(t);
        switch (kind) {
        case "location":
            return pick([item.people && item.people.length && !item.allDay && item.start
                             ? "Hey, where are you and " + list(item.people) + " meeting for your " + clockWords(item.start) + " " + dayWord(item.start, now) + "?"
                             : "Hey, where's " + thing + " happening?",
                         "Quick one: where is " + thing + "?",
                         "Where should I say " + thing + " is?"]);
        case "invitees": return pick(["Is anyone joining you for " + thing + "?", "Who's coming to " + thing + "?", "Want me to invite anyone to " + thing + "?"]);
        case "duration": return pick(["How long do you think " + thing + " will run?", "How much time should I block out for " + thing + "?"]);
        case "alert": return pick(["Quick one about " + thing + ": should I remind you beforehand?", "Want a heads-up before " + thing + "?"]);
        case "due": return item.type === "reminder" ? pick(["When should I remind you to " + t + "?", "When's a good time to nudge you to " + t + "?"])
                                                    : pick(["Is there a day you want " + q + " done by?", "When's " + q + " due?"]);
        case "list": return pick(["Which list should " + q + " go on?", "Want me to file " + q + " on one of your lists?"]);
        case "repeat": return pick(["Should your " + t + " alarm go off every day, or just this once?", "Is the " + t + " alarm a one-off, or should it repeat?"]);
        case "label": return pick(["What's the " + t + " alarm for?", "Want to give your " + t + " alarm a name?"]);
        case "email": return pick(["Do you have an email address for " + t + "?", "What's " + t + "'s email, if you have it?"]);
        case "phone": return pick(["Do you have a phone number for " + t + "?", "What's " + t + "'s number, if you have it?"]);
        }
        return "";
    },
    // Skipped a few times: whether that kind of question helps.
    doubt: function (kind, variant) {
        var list = ["I've been asking about " + TOPICS[kind] + ". Is that helpful, or should I stop asking?",
                    "You've skipped a few questions about " + TOPICS[kind] + ". Want me to keep asking those?"];
        return list[(variant || 0) % list.length];
    },
    topic: function (kind) { return TOPICS[kind] || kind; },
    chip: {
        skip: "Skip", videoCall: "Video call", justOnce: "Just once", keepAsking: "Keep asking", stopAsking: "Stop asking",
        minutes: function (n) { return n < 60 ? n + " min" : n === 60 ? "1 hour" : n % 60 ? (n / 60).toFixed(1) + " hours" : n / 60 + " hours"; },
        before: function (n) { return (n < 60 ? n + " min" : n === 60 ? "1 hour" : n / 60 + " hours") + " before"; },
        inAnHour: "In 1 hour", thisEvening: "This evening", tomorrowMorning: "Tomorrow morning",
        today: "Today", tomorrow: "Tomorrow", nextWeek: "Next week",
        daily: "Every day", weekdays: "Weekdays", weekends: "Weekends"
    },
    // What changed, said back.
    done: function (kind, value, now) {
        switch (kind) {
        case "location": return "Got it, I've put " + value + " as the place.";
        case "invitees": return "Done, I've invited " + list(value) + ".";
        case "duration": return "OK, I've blocked out " + durationText(value * 60) + ".";
        case "alert": return value ? "I'll give you a heads-up " + durationText(value * 60) + " before." : "I'll remind you when it starts.";
        case "due": return "OK, that's set for " + whenText(value, null, false, now) + ".";
        case "list": return "Filed it on your " + value + " list.";
        case "repeat": return value === "once" ? "Just this once, then." : "It'll go off " + repeatText(value) + " now.";
        case "label": return "Labelled it " + quote(value) + ".";
        case "email": return "Saved " + value + ".";
        case "phone": return "Saved " + value + ".";
        }
        return "Done.";
    },
    skipped: function () { return "No problem, I'll leave it."; },
    keeping: function () { return "Good to know. I'll keep asking."; },
    stopped: function (kind) { return "OK, I'll stop asking about " + TOPICS[kind] + ". You can turn it back on in Settings > Assistant."; },
    alreadySet: function () { return "That's been set already, so I'll leave it."; },
    gone: function () { return "That's gone now, so there's nothing to add."; },
    noContacts: function (names) { return "I couldn't find " + list(names) + " with an email address in your contacts."; },
    // A typed or spoken answer to kind: {skip: true}, {value} (words for
    // the free-text kinds, a number of minutes, ms for a time), or null
    // (not an answer: a new request).
    answer: function (kind, text, now) {
        var t = clean(text).replace(/[.!]$/, "").trim();
        if (kind === "doubt") {
            if (/^(?:keep(?: asking| going)?|yes|yeah|yep|sure|it's (?:helpful|fine|useful)|(?:it's )?helpful|it helps|go on|carry on|ok|okay)$/.test(t)) return { value: "keep" };
            if (/^(?:stop(?: asking| it)?|no|nope|please stop|not (?:really )?helpful|no thanks|don't|don't ask)$/.test(t)) return { value: "stop" };
            return null;
        }
        if (/^(?:skip|skip it|skip that|no|nope|no thanks|no thank you|not now|never ?mind|leave it|pass|i don't know|don't know|dunno|not sure)$/.test(t)) return { skip: true };
        var m;
        switch (kind) {
        case "location":
            if (/^(?:a )?(?:video(?: call| chat| meeting)?|online|zoom|on zoom|virtual|remote|remotely)$/.test(t)) return { value: "Video call" };
            t = t.replace(/^(?:it's |it is |it'll be |it will be |we're meeting |we are meeting |the place is |the location is )?(?:at |in |@ )?/, "").trim();
            return t ? { value: capital(cased(t, { original: text })) } : null;
        case "duration": {
            var s = duration(t.replace(/^(?:it's |it is |it lasts |it'll be |about |around |roughly |for |make it )+/, "").replace(/ long$/, ""));
            return s && s >= 300 && s <= 86400 ? { value: Math.round(s / 60) } : null;
        }
        case "alert":
            if (/^(?:when it starts|at the start|at the time|on time|at start)$/.test(t)) return { value: 0 };
            if ((m = /^(?:remind me |tell me )?(.+?) (?:before|earlier|ahead|beforehand|in advance)$/.exec(t))) {
                var b = duration(m[1].replace(/^(?:about |around )/, ""));
                return b && b <= 7 * 86400 ? { value: Math.round(b / 60) } : null;
            }
            return null;
        case "due": {
            var due = when(t.replace(/^(?:it's due |it is due |due |remind me |by )/, ""), now, { prefer: "day" });
            return due && due > now ? { value: due } : null;
        }
        case "list":
            t = t.replace(/^(?:it's for |it's on |put it on |put it in |on |in |for |to )?(?:my |the )?/, "").replace(/ list$/, "").trim();
            return t && t.split(" ").length <= 4 ? { value: capital(cased(t, { original: text })) } : null;
        case "repeat":
            if (/^(?:every ?day|daily|each day|all week|every day of the week)$/.test(t)) return { value: "daily" };
            if (/^(?:(?:on |every )?weekdays|monday to friday|mon-fri|work ?days|on work ?days|every weekday)$/.test(t)) return { value: "weekdays" };
            if (/^(?:(?:on |at |every )?weekends?|saturday and sunday)$/.test(t)) return { value: "weekends" };
            if (/^(?:just once|once|only once|no repeat|don't repeat|do not repeat|not repeat)$/.test(t)) return { value: "once" };
            return null;
        case "label":
            t = t.replace(/^(?:it's for |it is for |for |call it |label it |name it |it's |to )/, "").trim();
            return t && t.split(" ").length <= 5 ? { value: capital(cased(t, { original: text })) } : null;
        case "invitees": {
            t = t.replace(/^(?:invite |with |it's with |just |only )/, "");
            var names = t.split(/\s*(?:,|\band\b|&)\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
            return names.length && names.length <= 6 && names.every(function (n) { return n.split(" ").length <= 3; })
                ? { names: names.map(function (n) { return cased(n, { original: text }); }) } : null;
        }
        case "email":
            m = EMAIL_ONLY.exec(String(text).trim().toLowerCase());
            return m ? { value: m[1] } : null;
        case "phone": {
            var d = digits(t).replace(/^(?:it's |it is |the number is |number |call )/, "");
            return /^\+?[\d\s().-]{3,}$/.test(d) && d.replace(/\D/g, "").length >= 3 ? { value: d.trim() } : null;
        }
        }
        return null;
    }
};

module.exports = {
    id: "en",
    name: "English",
    clean: clean,
    rules: rules,
    casual: casual,
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
    // Whether the words name what command does (MENTIONS), for choosing the
    // tools a model is offered.
    mentions: function (command, text) {
        var m = MENTIONS[command], t = String(text || "").toLowerCase();
        if (!m) return false;
        if (m instanceof RegExp) return m.test(t);
        return Object.keys(m).some(function (k) { return m[k].test(t); });
    },
    // A how-to (lib/lang/en-help.js) by its id.
    help: function (id) { return HELP.filter(function (h) { return h.id === id; })[0] || null; },
    eventWords: eventWords,
    grounded: grounded,
    answer: answer,
    followUp: followUp
};
