// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A subscribed calendar (template com.webosphoenix.webcal; docs/M6-PLAN.md
// F4 item 8, after the webOS Archive's WebCal Sync): a public .ics file at
// an address (http, https or webcal), read one way into a read-only
// calendar of the Calendar app, again at every sync (every 30 minutes, and
// "Sync now").
//
// The file holds many events; the CalDAV mapping (ical.js toEvents) reads
// one resource, one UID (a series and its changed occurrences), so the
// file is cut into a calendar per UID, each with the file's time zones. A
// file that has not changed since the last sync (the same text) is not
// read again. The events are written to the same db8 kinds as CalDAV's
// (com.palm.calendarevent.dav:1 in a com.palm.calendar.dav:1), so the
// account's removal or a capability turned off removes them as for CalDAV
// (sync.js removeData).

"use strict";

var ical = require("@phoenix/synckit").ical;
var KINDS = require("./sync").KINDS;

var EVENT_FIELDS = ["subject", "location", "note", "allDay", "tzId", "dtstart", "dtend", "rrule", "exdates", "alarm",
                    "attendees", "transp", "classification", "status", "url", "categories", "sequence", "recurrenceId"];

// webcal://host/x.ics is https://host/x.ics (the scheme only says "a calendar").
function httpUrl(url) {
    var u = String(url || "").trim();
    if (/^webcals?:\/\//i.test(u)) u = "https://" + u.replace(/^webcals?:\/\//i, "");
    if (!/^https?:\/\/[^\s/]+/i.test(u)) {
        var e = new Error("The calendar address starts with http://, https:// or webcal://");
        e.errorCode = "400_BAD_REQUEST";
        throw e;
    }
    return u;
}

// Unfolded lines of an iCalendar text (RFC 5545 3.1).
function lines(text) {
    return String(text).replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

// {name, timezones (text), events: [{uid, text}]}: one VCALENDAR per UID.
function split(text) {
    var ls = lines(text);
    if (!ls.some(function (l) { return /^BEGIN:VCALENDAR/i.test(l); })) {
        var e = new Error("This address is not a calendar (.ics)");
        e.errorCode = "400_BAD_REQUEST";
        throw e;
    }
    var name = "", tz = [], byUid = {}, order = [], block = null, depth = 0, kind = "";
    ls.forEach(function (l) {
        var begin = /^BEGIN:(\w+)/i.exec(l), end = /^END:(\w+)/i.exec(l);
        if (!block) {
            if (begin && /^(VEVENT|VTIMEZONE)$/i.test(begin[1])) {
                block = [l];
                depth = 1;
                kind = begin[1].toUpperCase();
            } else if (/^X-WR-CALNAME[;:]/i.test(l)) {
                name = l.slice(l.indexOf(":") + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
            }
            return;
        }
        block.push(l);
        if (begin) depth++;
        if (end && --depth === 0) {
            if (kind === "VTIMEZONE") {
                tz.push(block.join("\r\n"));
            } else {
                var uidLine = block.filter(function (x) { return /^UID[;:]/i.test(x); })[0];
                var uid = uidLine ? uidLine.slice(uidLine.indexOf(":") + 1).trim() : "phoenix-" + order.length;
                if (!byUid[uid]) { byUid[uid] = []; order.push(uid); }
                byUid[uid].push(block.join("\r\n"));
            }
            block = null;
        }
    });
    var head = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//webOS Phoenix//WebCal//EN\r\n" + (tz.length ? tz.join("\r\n") + "\r\n" : "");
    return {
        name: name,
        events: order.map(function (uid) {
            return { uid: uid, text: head + byUid[uid].join("\r\n") + "\r\nEND:VCALENDAR\r\n" };
        })
    };
}

// A short hash of the text, to tell an unchanged file (FNV-1a).
function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return text.length + "-" + h.toString(16);
}

function pick(o) {
    var out = {};
    EVENT_FIELDS.forEach(function (f) { if (o[f] !== undefined && o[f] !== null) out[f] = o[f]; });
    return out;
}

// ctx: {db (sync.js's), request, accountId, localTz?, log?}
function createWebcal(ctx) {
    var db = ctx.db, log = ctx.log || function () {};

    function fetchText(url, hops) {
        return ctx.request({ method: "GET", url: url, headers: { Accept: "text/calendar, */*" } }).then(function (res) {
            if (res.status >= 300 && res.status < 400 && res.headers && res.headers.location && (hops || 0) < 5)
                return fetchText(new URL(res.headers.location, url).toString(), (hops || 0) + 1);
            if (res.status !== 200) {
                var e = new Error("The calendar address answered " + res.status);
                e.status = res.status;
                e.errorCode = res.status === 401 || res.status === 403 ? "401_UNAUTHORIZED" : res.status >= 500 ? undefined : "400_BAD_REQUEST";
                throw e;
            }
            return String(res.body || "");
        });
    }

    // The validator: is there a calendar at this address? -> {url, name, events}
    function check(url) {
        var u = httpUrl(url);
        return fetchText(u).then(function (text) {
            var parsed = split(text);
            return { url: u, name: parsed.name || new URL(u).hostname, events: parsed.events.length };
        });
    }

    function collection() {
        return db.find({ from: KINDS.collection, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] })
            .then(function (r) { return r[0] || null; });
    }

    // Read the file again into the subscription's calendar. -> stats
    function sync(url, name) {
        var u = httpUrl(url);
        var stats = { events: 0, unchanged: false, skipped: 0 };
        return Promise.all([fetchText(u), collection()]).then(function (r) {
            var text = r[0], col = r[1];
            var parsed = split(text);
            var digest = hash(text);
            col = col || { _kind: KINDS.collection, accountId: ctx.accountId, capability: "CALENDAR", url: u };
            var calendar = {
                _kind: KINDS.calendar, accountId: ctx.accountId, name: name || parsed.name || new URL(u).hostname,
                isReadOnly: true, syncSource: "WebCal", excludeFromAll: false, color: "teal", remoteId: u
            };
            var haveCalendar = col.calendarId
                ? db.get([col.calendarId]).then(function (c) { return !!c[0]; }) : Promise.resolve(false);
            return haveCalendar.then(function (have) {
                if (have && col.ctag === digest) {
                    stats.unchanged = true;
                    return null;
                }
                var cal = have ? db.merge([{ _id: col.calendarId, name: calendar.name, isReadOnly: true }])
                               : db.put([calendar]).then(function (res) { col.calendarId = res[0].id; });
                return cal.then(function () {
                    // One way: what the file says replaces what was there.
                    return db.delQuery({ from: KINDS.event, where: [{ prop: "calendarId", op: "=", val: col.calendarId }] });
                }).then(function () {
                    var objects = [];
                    parsed.events.forEach(function (ev) {
                        var e;
                        try { e = ical.toEvents(ev.text, { localTz: ctx.localTz }); } catch (x) { stats.skipped++; return; }
                        if (!e.master) { stats.skipped++; return; }
                        var base = { accountId: ctx.accountId, calendarId: col.calendarId, remoteId: "webcal:" + ev.uid };
                        objects.push({ master: Object.assign({ _kind: KINDS.event }, pick(e.master), base), overrides: e.overrides, base: base });
                    });
                    return objects.reduce(function (p, o) {
                        return p.then(function () {
                            return db.put([o.master]).then(function (res) {
                                stats.events++;
                                if (!o.overrides.length) return null;
                                return db.put(o.overrides.map(function (ov) {
                                    return Object.assign({ _kind: KINDS.event }, pick(ov), o.base,
                                                         { parentId: res[0].id, parentDtstart: o.master.dtstart });
                                }));
                            });
                        });
                    }, Promise.resolve());
                }).then(function () {
                    col.ctag = digest;
                    col.lastSync = Date.now();
                    return col._id ? db.merge([col]) : db.put([col]);
                });
            }).then(function () {
                log("webcal " + ctx.accountId + ": " + (stats.unchanged ? "unchanged" : stats.events + " events"));
                return stats;
            });
        });
    }

    return { check: check, sync: sync };
}

module.exports = { createWebcal: createWebcal, split: split, httpUrl: httpUrl, hash: hash };
