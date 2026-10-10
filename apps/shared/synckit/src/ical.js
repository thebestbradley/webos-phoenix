// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// iCalendar VEVENT (RFC 5545) <-> the legacy webOS calendar event,
// com.palm.calendarevent:1. Field names and value formats follow the
// Calendar app and its own iCalendar importer / exporter:
//   third_party/loadable-frameworks/calendar.io/javascript/import.js (field
//     names: subject, note, dtstart/dtend in ms, tzId, allDay, rrule
//     {freq, interval, count, until, wkst, rules: [{ruleType: "BYDAY",
//     ruleValue: [{day, ord}]}]}, alarm [{action, alarmTrigger: {value,
//     valueType}}], attendees, exdates),
//   calendar.io/javascript/import_rrule.js, transform_rrule.js (RRULE),
//   core-apps/com.palm.app.calendar/app/edit/EditView.js (an edited
//     occurrence is a child event: parentId, recurrenceId "yyyyMMddTHHmmssZ",
//     and the parent gets the same string in exdates),
//   runtime/sample-data.js (all-day events run from local midnight to
//     23:59:59 of their last day, as the Calendar app saves them).
//
//   toEvents(text, opts)                        -> { uid, master, overrides: [event] }
//   fromEvents(master, children, base, opts)    -> iCalendar text
//
// As with vCards, fromEvents() edits the server's last copy (base) and keeps
// what it does not map: attendees and organizer of existing events, VTIMEZONE
// definitions, X- properties, VTODOs in the same resource.

"use strict";

var CL = require("./contentline");
var DT = require("./datetime");
var newUid = require("./vcard").newUid;

var PRODID = "-//webOS Phoenix//CalDAV sync//EN";
var DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
var BY_RULES = ["BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS", "BYHOUR", "BYMINUTE", "BYSECOND"];

// Master VEVENT properties this mapping owns (rewritten on every upload).
var MAPPED = ["DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE", "SUMMARY", "LOCATION", "DESCRIPTION",
              "TRANSP", "CLASS", "DTSTAMP", "LAST-MODIFIED", "RECURRENCE-ID"];

function textProp(comp, name) {
    var p = CL.first(comp, name);
    return p ? CL.unescapeText(CL.textOf(p)) : "";
}

function param(p, name) { return p && p.params[name] ? p.params[name][0] : undefined; }

// ---- Time zones without an IANA name: the VTIMEZONE's observances -----------------

function nthWeekday(year, month, spec) {
    // spec like "2SU" or "-1SU" -> day of month
    var m = /^([+-]?\d+)?([A-Z]{2})$/.exec(spec || "");
    if (!m) return null;
    var n = m[1] ? +m[1] : 1, wd = DAYS.indexOf(m[2]);
    if (n > 0) {
        var first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    }
    var last = new Date(Date.UTC(year, month, 0));
    return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7) + (n + 1) * 7;
}

function parseOffset(s) {
    var m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(s || "").trim());
    if (!m) return 0;
    var ms = ((+m[2] * 60 + +m[3]) * 60 + +(m[4] || 0)) * 1000;
    return m[1] === "-" ? -ms : ms;
}

// Offset (ms) of a VTIMEZONE at a wall time: the observance (STANDARD or
// DAYLIGHT) whose latest onset is before it. Yearly RRULEs with BYMONTH and
// BYDAY cover what calendar servers generate.
function vtimezoneOffset(vtz, w) {
    var best = null, bestAt = -Infinity, fallback = null;
    (vtz.components || []).forEach(function (obs) {
        if (obs.name !== "STANDARD" && obs.name !== "DAYLIGHT") return;
        var to = parseOffset(CL.textOf(CL.first(obs, "TZOFFSETTO")));
        if (!fallback || obs.name === "STANDARD") fallback = to;
        var start = DT.parseIcalDate(CL.textOf(CL.first(obs, "DTSTART")));
        if (!start) return;
        var rr = CL.first(obs, "RRULE"), onset;
        var at = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
        [w.year, w.year - 1].forEach(function (y) {
            if (y < start.year) return;
            var month = start.month, day = start.day;
            if (rr) {
                var r = parseRruleParts(rr.value);
                if (r.BYMONTH) month = +r.BYMONTH;
                if (r.BYDAY) day = nthWeekday(y, month, r.BYDAY);
                else if (r.BYMONTHDAY) day = +r.BYMONTHDAY;
            } else if (y !== start.year) {
                return;
            }
            onset = Date.UTC(y, month - 1, day, start.hour, start.minute, start.second);
            if (onset <= at && onset > bestAt) { bestAt = onset; best = to; }
        });
    });
    return best !== null ? best : (fallback || 0);
}

function parseRruleParts(value) {
    var out = {};
    String(value).split(";").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i > 0) out[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
    });
    return out;
}

// A DATE / DATE-TIME property -> { ms, dateOnly, tzId, wall }.
function readTime(p, ctx) {
    if (!p) return null;
    var w = DT.parseIcalDate(CL.textOf(p));
    if (!w) return null;
    var tzid = param(p, "TZID");
    if (w.dateOnly || param(p, "VALUE") === "DATE") {
        w.dateOnly = true;
        return { ms: DT.fromWall(w, ctx.localTz), dateOnly: true, tzId: ctx.localTz, wall: w };
    }
    if (w.utc) return { ms: DT.fromWall(w, "UTC"), dateOnly: false, tzId: "UTC", wall: w };
    if (tzid) {
        var iana = DT.ianaZone(tzid);
        if (iana) return { ms: DT.fromWall(w, iana), dateOnly: false, tzId: iana, wall: w };
        var vtz = ctx.timezones[tzid];
        if (vtz) {
            var ms = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - vtimezoneOffset(vtz, w);
            return { ms: ms, dateOnly: false, tzId: ctx.localTz, wall: w };
        }
    }
    // Floating time: the device's zone.
    return { ms: DT.fromWall(w, ctx.localTz), dateOnly: false, tzId: ctx.localTz, wall: w };
}

// Legacy exdate / recurrenceId string for an instant ("yyyyMMddTHHmmssZ").
function legacyUtc(ms) { return DT.formatUtc(ms); }

function legacyToMs(s) {
    var w = DT.parseIcalDate(s);
    if (!w) return null;
    return w.utc || !w.dateOnly ? DT.fromWall(w, "UTC") : null;
}

function readRrule(p, ctx, allDay) {
    var r = parseRruleParts(CL.textOf(p));
    if (!r.FREQ) return undefined;
    var out = { freq: r.FREQ.toUpperCase() };
    if (r.INTERVAL) out.interval = parseInt(r.INTERVAL, 10) || 1;
    if (r.COUNT) out.count = parseInt(r.COUNT, 10);
    if (r.UNTIL) {
        var w = DT.parseIcalDate(r.UNTIL);
        if (w) {
            if (w.dateOnly) { w.hour = 23; w.minute = 59; w.second = 59; out.until = DT.fromWall(w, ctx.localTz); }
            else out.until = DT.fromWall(w, w.utc ? "UTC" : (ctx.tzId || ctx.localTz));
        }
    }
    if (r.WKST && DAYS.indexOf(r.WKST.toUpperCase()) >= 0) out.wkst = DAYS.indexOf(r.WKST.toUpperCase());
    var rules = [];
    BY_RULES.forEach(function (name) {
        if (!r[name]) return;
        var values = r[name].split(",").map(function (v) {
            if (name === "BYDAY") {
                var m = /^([+-]?\d+)?([A-Za-z]{2})$/.exec(v.trim());
                if (!m) return null;
                var o = { day: DAYS.indexOf(m[2].toUpperCase()) };
                if (m[1]) o.ord = parseInt(m[1], 10);
                return o.day >= 0 ? o : null;
            }
            return /^[+-]?\d+$/.test(v.trim()) ? { ord: parseInt(v, 10) } : null;
        }).filter(Boolean);
        if (values.length) rules.push({ ruleType: name, ruleValue: values });
    });
    if (rules.length) out.rules = rules;
    return out;
}

function readAlarms(vevent) {
    return (vevent.components || []).filter(function (c) { return c.name === "VALARM"; }).map(function (a) {
        var trig = CL.first(a, "TRIGGER");
        if (!trig) return null;
        var v = CL.textOf(trig).trim();
        var isDate = param(trig, "VALUE") === "DATE-TIME" || !/P/.test(v);
        var t = { value: v, valueType: isDate ? "DATETIME" : "DURATION" };
        if (param(trig, "RELATED")) t.related = param(trig, "RELATED").toLowerCase();
        return { action: (textProp(a, "ACTION") || "DISPLAY").toLowerCase(), alarmTrigger: t };
    }).filter(Boolean);
}

function readAttendees(vevent) {
    var out = [];
    function person(p, organizer) {
        var email = CL.textOf(p).replace(/^mailto:/i, "").trim();
        var a = { email: email, commonName: param(p, "CN") || "", organizer: organizer };
        if (param(p, "ROLE")) a.role = param(p, "ROLE");
        if (param(p, "PARTSTAT")) a.participationStatus = param(p, "PARTSTAT");
        if (param(p, "RSVP")) a.rsvp = /true/i.test(param(p, "RSVP"));
        if (param(p, "CUTYPE")) a.calendarUserType = param(p, "CUTYPE");
        return a;
    }
    CL.find(vevent, "ORGANIZER").forEach(function (p) { out.push(person(p, true)); });
    CL.find(vevent, "ATTENDEE").forEach(function (p) {
        var a = person(p, false);
        if (!out.some(function (o) { return o.email && o.email === a.email; })) out.push(a);
    });
    return out;
}

function readEvent(vevent, ctx) {
    var start = readTime(CL.first(vevent, "DTSTART"), ctx);
    if (!start) return null;
    var ev = {
        subject: textProp(vevent, "SUMMARY"),
        location: textProp(vevent, "LOCATION"),
        note: textProp(vevent, "DESCRIPTION"),
        allDay: start.dateOnly,
        tzId: start.tzId,
        dtstart: start.ms
    };
    var end = readTime(CL.first(vevent, "DTEND"), ctx);
    var dur = CL.first(vevent, "DURATION") ? DT.parseDuration(CL.textOf(CL.first(vevent, "DURATION"))) : null;
    if (start.dateOnly) {
        // Exclusive end date -> 23:59:59 of the last day.
        var days = 1;
        if (end && end.dateOnly) days = Math.max(1, Math.round((Date.UTC(end.wall.year, end.wall.month - 1, end.wall.day) -
            Date.UTC(start.wall.year, start.wall.month - 1, start.wall.day)) / 86400000));
        else if (dur) days = Math.max(1, Math.round(dur / 86400000));
        var last = new Date(Date.UTC(start.wall.year, start.wall.month - 1, start.wall.day + days - 1));
        ev.dtend = DT.fromWall({ year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate(),
                                 hour: 23, minute: 59, second: 59 }, ctx.localTz);
    } else {
        ev.dtend = end ? end.ms : start.ms + (dur !== null ? dur : 0);
    }
    var rr = CL.first(vevent, "RRULE");
    if (rr) ev.rrule = readRrule(rr, { localTz: ctx.localTz, tzId: start.tzId }, ev.allDay);
    var exdates = [];
    CL.find(vevent, "EXDATE").forEach(function (p) {
        CL.textOf(p).split(",").forEach(function (v) {
            var t = readTime({ name: "EXDATE", params: p.params, value: v, group: "" }, ctx);
            if (t) exdates.push(legacyUtc(t.ms));
        });
    });
    if (exdates.length) ev.exdates = exdates;
    var alarms = readAlarms(vevent);
    if (alarms.length) ev.alarm = alarms;
    var attendees = readAttendees(vevent);
    if (attendees.length) ev.attendees = attendees;
    var opt = { TRANSP: "transp", CLASS: "classification", STATUS: "status", URL: "url", CATEGORIES: "categories" };
    Object.keys(opt).forEach(function (k) { var v = textProp(vevent, k); if (v) ev[opt[k]] = v; });
    var seq = CL.first(vevent, "SEQUENCE");
    if (seq) ev.sequence = parseInt(CL.textOf(seq), 10) || 0;
    var rid = CL.first(vevent, "RECURRENCE-ID");
    if (rid) {
        var r = readTime(rid, ctx);
        if (r) ev.recurrenceId = legacyUtc(r.ms);
    }
    return ev;
}

// options.localTz: the device's zone (floating and all-day times).
function toEvents(text, options) {
    options = options || {};
    var cal = CL.parse(text).filter(function (c) { return c.name === "VCALENDAR"; })[0];
    if (!cal) throw new Error("no VCALENDAR in resource");
    var ctx = { localTz: options.localTz || DT.localZone(), timezones: {} };
    cal.components.forEach(function (c) {
        if (c.name === "VTIMEZONE") ctx.timezones[textProp(c, "TZID")] = c;
    });
    var vevents = cal.components.filter(function (c) { return c.name === "VEVENT"; });
    var master = null, overrides = [], uid = "";
    vevents.forEach(function (ve) {
        var ev = readEvent(ve, ctx);
        if (!ev) return;
        uid = uid || textProp(ve, "UID");
        if (ev.recurrenceId) overrides.push(ev);
        else if (!master) master = ev;
    });
    // As the Calendar app does for an edited occurrence, the parent lists
    // each override in its exdates so the rule does not show it twice.
    if (master && overrides.length) {
        var ex = master.exdates || [];
        overrides.forEach(function (o) { if (ex.indexOf(o.recurrenceId) < 0) ex.push(o.recurrenceId); });
        master.exdates = ex;
    }
    return { uid: uid, master: master, overrides: overrides,
             hasTodo: cal.components.some(function (c) { return c.name === "VTODO"; }) };
}

// ---- Writing ----------------------------------------------------------------------

function dayAfter(w) {
    var d = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// How an event's times are written: all-day as DATE, timed with the
// event's IANA TZID (servers accept IANA names without a VTIMEZONE; RFC 7809),
// or in UTC.
function timeWriter(ev, localTz) {
    var tz = ev.tzId && ev.tzId !== "UTC" ? DT.ianaZone(ev.tzId) : null;
    if (ev.allDay) {
        var z = tz || localTz;
        return {
            prop: function (name, ms, isEnd) {
                var w = isEnd ? dayAfter(DT.wall(ms, z)) : DT.wall(ms, z);
                return CL.prop(name, DT.formatDate(w), { VALUE: ["DATE"] });
            },
            value: function (ms) { return DT.formatDate(DT.wall(ms, z)); },
            params: { VALUE: ["DATE"] }
        };
    }
    if (tz && tz !== "UTC") {
        return {
            prop: function (name, ms) { return CL.prop(name, DT.formatWall(DT.wall(ms, tz)), { TZID: [tz] }); },
            value: function (ms) { return DT.formatWall(DT.wall(ms, tz)); },
            params: { TZID: [tz] }
        };
    }
    return {
        prop: function (name, ms) { return CL.prop(name, DT.formatUtc(ms)); },
        value: function (ms) { return DT.formatUtc(ms); },
        params: {}
    };
}

function rruleValue(rr, ev, localTz) {
    var parts = ["FREQ=" + String(rr.freq).toUpperCase()];
    if (rr.interval && +rr.interval !== 1) parts.push("INTERVAL=" + rr.interval);
    if (rr.count) parts.push("COUNT=" + rr.count);
    else if (rr.until) {
        parts.push("UNTIL=" + (ev.allDay ? DT.formatDate(DT.wall(rr.until, DT.ianaZone(ev.tzId) || localTz)) : DT.formatUtc(rr.until)));
    }
    if (typeof rr.wkst === "number" && DAYS[rr.wkst]) parts.push("WKST=" + DAYS[rr.wkst]);
    (rr.rules || []).forEach(function (rule) {
        if (typeof rule === "string") { parts.push(rule); return; }
        var vals = (rule.ruleValue || []).map(function (v) {
            return (v.ord !== undefined && v.ord !== null && v.ord !== "" ? String(v.ord) : "") +
                (typeof v.day === "number" ? DAYS[v.day] : "");
        }).filter(Boolean);
        if (vals.length) parts.push(String(rule.ruleType).toUpperCase() + "=" + vals.join(","));
    });
    return parts.join(";");
}

function alarmComponents(ev) {
    return (ev.alarm || []).filter(function (a) { return a && a.alarmTrigger && a.alarmTrigger.value; }).map(function (a) {
        var t = a.alarmTrigger, params = {};
        if (t.valueType === "DATETIME") params.VALUE = ["DATE-TIME"];
        if (t.related) params.RELATED = [String(t.related).toUpperCase()];
        var action = String(a.action || "display").toUpperCase();
        var props = [CL.prop("ACTION", action === "AUDIO" || action === "EMAIL" ? action : "DISPLAY"),
                     CL.prop("TRIGGER", t.value, params)];
        if (action !== "AUDIO") props.push(CL.prop("DESCRIPTION", CL.escapeText(ev.subject || "Reminder")));
        return { name: "VALARM", props: props, components: [] };
    });
}

function writeEvent(ev, baseComp, uid, localTz, options) {
    var comp = baseComp ? { name: "VEVENT", props: baseComp.props.slice(), components: [] }
                        : { name: "VEVENT", props: [], components: [] };
    var isNew = !baseComp;
    comp.props = comp.props.filter(function (p) {
        if (MAPPED.indexOf(p.name) >= 0) return false;
        // Attendees are written only for new events; the server's list stays otherwise.
        if (isNew && (p.name === "ATTENDEE" || p.name === "ORGANIZER")) return false;
        return p.name !== "UID";
    });
    // Keep non-alarm subcomponents of the base.
    if (baseComp) comp.components = (baseComp.components || []).filter(function (c) { return c.name !== "VALARM"; });
    var tw = timeWriter(ev, localTz);
    var head = [CL.prop("UID", uid), CL.prop("DTSTAMP", DT.formatUtc(options.now))];
    if (ev.recurrenceId) {
        var rms = legacyToMs(ev.recurrenceId);
        if (rms !== null) head.push(tw.prop("RECURRENCE-ID", rms));
    }
    head.push(tw.prop("DTSTART", ev.dtstart));
    if (ev.allDay) head.push(tw.prop("DTEND", ev.dtend || ev.dtstart, true));
    else head.push(tw.prop("DTEND", Math.max(ev.dtend || ev.dtstart, ev.dtstart)));
    head.push(CL.prop("SUMMARY", CL.escapeText(ev.subject || "")));
    if (ev.location) head.push(CL.prop("LOCATION", CL.escapeText(ev.location)));
    if (ev.note) head.push(CL.prop("DESCRIPTION", CL.escapeText(ev.note)));
    if (ev.transp) head.push(CL.prop("TRANSP", ev.transp));
    if (ev.classification) head.push(CL.prop("CLASS", ev.classification));
    if (ev.rrule && ev.rrule.freq && !ev.recurrenceId) head.push(CL.prop("RRULE", rruleValue(ev.rrule, ev, localTz)));
    var skip = options.skipExdates || {};
    var ex = (ev.exdates || []).map(legacyToMs).filter(function (ms, i) {
        return ms !== null && !skip[(ev.exdates || [])[i]];
    });
    if (ex.length && !ev.recurrenceId) head.push(CL.prop("EXDATE", ex.map(tw.value).join(","), tw.params));
    head.push(CL.prop("LAST-MODIFIED", DT.formatUtc(options.now)));
    if (isNew) {
        (ev.attendees || []).forEach(function (a) {
            if (!a.email) return;
            var params = {};
            if (a.commonName) params.CN = [a.commonName];
            comp.props.push(CL.prop(a.organizer ? "ORGANIZER" : "ATTENDEE", "mailto:" + a.email, params));
        });
    }
    comp.props = head.concat(comp.props);
    comp.components = comp.components.concat(alarmComponents(ev));
    return comp;
}

// master: the parent event; children: its live child events (edited
// occurrences, each with a recurrenceId); base: the server's last copy.
function fromEvents(master, children, base, options) {
    options = options || {};
    var localTz = options.localTz || DT.localZone();
    options.now = options.now || Date.now();
    var cal = base ? CL.parse(base).filter(function (c) { return c.name === "VCALENDAR"; })[0] : null;
    var uid = options.uid;
    var baseMaster = null, baseOverrides = {};
    if (cal) {
        cal.components.forEach(function (c) {
            if (c.name !== "VEVENT") return;
            uid = uid || textProp(c, "UID");
            var rid = CL.first(c, "RECURRENCE-ID");
            if (!rid) { if (!baseMaster) baseMaster = c; return; }
            var t = readTime(rid, { localTz: localTz, timezones: {} });
            if (t) baseOverrides[legacyUtc(t.ms)] = c;
        });
    } else {
        cal = { name: "VCALENDAR", props: [CL.prop("VERSION", "2.0"), CL.prop("PRODID", PRODID)], components: [] };
    }
    uid = uid || newUid();
    children = (children || []).filter(function (c) { return c && !c._del && c.recurrenceId; });
    // An override replaces its occurrence: it must not also be an EXDATE.
    var skip = {};
    children.forEach(function (c) { skip[c.recurrenceId] = true; });
    var comps = [writeEvent(master, baseMaster, uid, localTz, { now: options.now, skipExdates: skip })];
    children.forEach(function (c) {
        comps.push(writeEvent(c, baseOverrides[c.recurrenceId] || null, uid, localTz, { now: options.now }));
    });
    // Other components (VTIMEZONE, VTODO) stay; the VEVENTs are replaced.
    cal.components = cal.components.filter(function (c) { return c.name !== "VEVENT"; }).concat(comps);
    return CL.serialize(cal);
}

function uidOf(text) {
    var cal = CL.parse(text).filter(function (c) { return c.name === "VCALENDAR"; })[0];
    var ve = cal && cal.components.filter(function (c) { return c.name === "VEVENT" || c.name === "VTODO"; })[0];
    return ve ? textProp(ve, "UID") : "";
}

module.exports = { toEvents: toEvents, fromEvents: fromEvents, uidOf: uidOf, rruleValue: rruleValue };
