// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Calendar arithmetic for the Assistant, the same in every
// language (the words are in lib/lang/<code>.js): local days, weeks,
// clock times resolved to moments, and the repeat rules of webOS calendar
// events and Clock alarms.
//
// A repeat, as the language files say it: {freq: "DAILY" | "WEEKLY" |
// "MONTHLY" | "YEARLY", days: [0-6, Sunday 0], interval}. As a webOS
// calendar event's rrule it is what the Calendar app's repeat picker
// writes (com.palm.app.calendar app/edit/RepeatView.js:385-430):
// {freq, interval, rules: [{ruleType: "BYDAY", ruleValue: [{day}]}]} for
// weekly, BYMONTHDAY [{ord: date}] for monthly. The Clock's alarms repeat
// only "daily", "weekdays" or "weekends" (com.palm.app.clock
// main/alarmedit.js:36-40).

"use strict";

var DAY_MS = 864e5;

function startOfDay(ms) {
    var d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
// Days are added on the calendar (a day with a clock change is 23 or 25 hours).
function addDays(ms, n) {
    var d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}
function at(dayMs, hour, minute) {
    var d = new Date(dayMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute || 0, 0, 0).getTime();
}
function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}
// The next `weekday` (0-6) after today (a week ahead when it is today).
function nextWeekday(now, weekday, includeToday) {
    var ahead = (weekday - new Date(now).getDay() + 7) % 7;
    if (ahead === 0 && !includeToday) ahead = 7;
    return startOfDay(addDays(now, ahead));
}
// The Monday a week starts on.
function mondayOf(ms) {
    return startOfDay(addDays(ms, -((new Date(ms).getDay() + 6) % 7)));
}
// This week, from today to Sunday (what is left of it: "what's on this
// week"); `to` is next Monday.
function weekRange(now) {
    var from = startOfDay(now);
    var d = new Date(now).getDay();
    var toSunday = (7 - d) % 7;
    return { from: from, to: startOfDay(addDays(now, toSunday + 1)) };
}

// ---- Clock times to moments --------------------------------------------------------------------

// The hour of a clock time {hour, minute, meridiem ("am", "pm", "24" or
// null)}; without am/pm by `prefer`:
//   "day"   1 to 6 is the afternoon, 7 to 11 the morning (events: "lunch at
//           1", "meeting at 9")
//   "am"    the morning (an alarm a whole day ahead)
//   other   either: the caller takes the next of the two
function hours(c, prefer) {
    if (c.meridiem === "24") return [c.hour];
    if (c.meridiem === "am") return [c.hour % 12];
    if (c.meridiem === "pm") return [c.hour % 12 + 12];
    if (prefer === "day") return [c.hour >= 1 && c.hour <= 6 ? c.hour + 12 : c.hour % 12 + (c.hour === 12 ? 12 : 0)];
    if (prefer === "am") return [c.hour % 12];
    return [c.hour % 12, c.hour % 12 + 12];
}
// The moment a clock time comes: on `day` (ms of the day) if given, else
// the next one from now.
function resolveClock(c, now, day, prefer) {
    var hs = hours(c, prefer);
    if (day !== null && day !== undefined) {
        // Both halves possible on a given day: the later one if the earlier has passed today.
        var opts = hs.map(function (h) { return at(day, h, c.minute); });
        var later = opts.filter(function (t) { return t > now; });
        return later.length ? Math.min.apply(null, later) : opts[0];
    }
    var best = null;
    for (var add = 0; add < 3 && best === null; ++add) {
        hs.forEach(function (h) {
            var t = at(addDays(startOfDay(now), add), h, c.minute);
            if (t > now && (best === null || t < best)) best = t;
        });
    }
    return best;
}

// ---- Repeats -------------------------------------------------------------------------------------

function rrule(repeat, startMs) {
    if (!repeat) return null;
    var r = { freq: repeat.freq, interval: repeat.interval || 1, rules: [] };
    if (repeat.freq === "WEEKLY")
        r.rules.push({ ruleType: "BYDAY", ruleValue: (repeat.days && repeat.days.length ? repeat.days : [new Date(startMs).getDay()])
            .map(function (d) { return { day: d }; }) });
    if (repeat.freq === "MONTHLY") r.rules.push({ ruleType: "BYMONTHDAY", ruleValue: [{ ord: new Date(startMs).getDate() }] });
    return r;
}
// The Clock's "occurs" for a repeat, or null when the Clock cannot repeat that way.
function alarmOccurs(repeat) {
    if (!repeat) return "once";
    var days = (repeat.days || []).slice().sort().join(",");
    if (repeat.freq === "DAILY" || days === "0,1,2,3,4,5,6") return "daily";
    if (repeat.freq === "WEEKLY" && days === "1,2,3,4,5") return "weekdays";
    if (repeat.freq === "WEEKLY" && days === "0,6") return "weekends";
    return null;
}
// The first day on or after `from` that a repeat falls on (alarms, events
// starting today or later).
function firstRepeatDay(repeat, from) {
    var days = repeat && repeat.days && repeat.days.length ? repeat.days : null;
    if (!days) return startOfDay(from);
    for (var i = 0; i < 7; ++i) {
        var d = addDays(startOfDay(from), i);
        if (days.indexOf(new Date(d).getDay()) >= 0) return d;
    }
    return startOfDay(from);
}

// The times an event happens in [from, to): its start, and for a repeating
// event (a webOS rrule: DAILY, WEEKLY with BYDAY, MONTHLY with BYMONTHDAY,
// YEARLY; interval, count, until, exdates) each repeat. Enough for the
// agenda; the Calendar app expands the rest itself.
function occurrences(ev, from, to) {
    var start = Number(ev.dtstart), end = Number(ev.dtend) || start;
    var len = Math.max(0, end - start), out = [];
    var r = ev.rrule;
    if (!r || !r.freq) {
        if (start < to && start + len > from || (start >= from && start < to)) out.push(start);
        return out;
    }
    var interval = Math.max(1, Number(r.interval) || 1);
    var until = r.until ? Number(r.until) : Infinity, count = r.count ? Number(r.count) : Infinity;
    var byday = null, bymonthday = null;
    (r.rules || []).forEach(function (rule) {
        if (rule.ruleType === "BYDAY") byday = (rule.ruleValue || []).map(function (v) { return Number(v.day); });
        if (rule.ruleType === "BYMONTHDAY") bymonthday = (rule.ruleValue || []).map(function (v) { return Number(v.ord); });
    });
    var ex = {};
    // An exception as the Calendar app writes one (Utilities.js
    // addException: UTC "YYYYMMDDTHHMMSSZ"), or as ms.
    (ev.exdates || []).forEach(function (x) {
        var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(x));
        ex[m ? String(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : String(x)] = true;
    });
    var s = new Date(start), n = 0;
    // Walk the days from the first one; at most ten years of them.
    for (var i = 0; i < 3660; ++i) {
        var day = at(addDays(startOfDay(start), i), s.getHours(), s.getMinutes());
        if (day > until || day >= to || n >= count) break;
        var d = new Date(day), weeks = Math.floor(daysBetween(start, day) / 7), months = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
        var hit = false;
        if (r.freq === "DAILY") hit = i % interval === 0;
        else if (r.freq === "WEEKLY") hit = weeks % interval === 0 && (byday ? byday.indexOf(d.getDay()) >= 0 : d.getDay() === s.getDay());
        else if (r.freq === "MONTHLY") hit = months % interval === 0 && (bymonthday ? bymonthday.indexOf(d.getDate()) >= 0 : d.getDate() === s.getDate());
        else if (r.freq === "YEARLY") hit = (d.getFullYear() - s.getFullYear()) % interval === 0 && d.getMonth() === s.getMonth() && d.getDate() === s.getDate();
        if (!hit) continue;
        n++;
        if (ex[String(day)]) continue;
        if (day + len > from && day < to || (day >= from && day < to)) out.push(day);
    }
    return out;
}

// A time as the Calendar app's exception dates and recurrenceIds write it
// (com.palm.app.calendar app/shared/Utilities.js getUTCFormatDateString).
function utcString(ms) {
    var d = new Date(ms), two = function (n) { return (n < 10 ? "0" : "") + n; };
    return "" + d.getUTCFullYear() + two(d.getUTCMonth() + 1) + two(d.getUTCDate()) + "T" + two(d.getUTCHours()) + two(d.getUTCMinutes()) + two(d.getUTCSeconds()) + "Z";
}

module.exports = {
    utcString: utcString,
    DAY_MS: DAY_MS,
    startOfDay: startOfDay,
    addDays: addDays,
    at: at,
    daysBetween: daysBetween,
    nextWeekday: nextWeekday,
    weekRange: weekRange,
    mondayOf: mondayOf,
    hours: hours,
    resolveClock: resolveClock,
    rrule: rrule,
    alarmOccurs: alarmOccurs,
    firstRepeatDay: firstRepeatDay,
    occurrences: occurrences
};
