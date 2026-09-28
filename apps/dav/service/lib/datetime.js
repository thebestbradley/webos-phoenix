// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Date and time helpers for the iCalendar mapping: IANA time zones through
// the Intl API (Node.js and browsers both carry the time zone database, so
// no tz library is needed), iCalendar DATE / DATE-TIME / DURATION values,
// and the date strings the legacy Calendar app stores (exdates and
// recurrenceId are "yyyyMMddTHHmmssZ" in UTC: Utilities.getUTCFormatDateString
// in core-apps/com.palm.app.calendar/app/shared/Utilities.js).

"use strict";

var formatters = {};

function formatter(tz) {
    if (!formatters[tz]) {
        formatters[tz] = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
    }
    return formatters[tz];
}

function isZone(tz) {
    if (!tz || typeof tz !== "string") return false;
    try { formatter(tz); return true; } catch (e) { return false; }
}

// Time zone names Outlook and Exchange put in TZID, for the zones people
// meet most. Anything else that is not an IANA name falls back to the
// offsets of the calendar's VTIMEZONE (see ical.js).
var WINDOWS_ZONES = {
    "UTC": "UTC", "Coordinated Universal Time": "UTC", "GMT": "UTC",
    "Pacific Standard Time": "America/Los_Angeles", "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix", "Central Standard Time": "America/Chicago",
    "Eastern Standard Time": "America/New_York", "Atlantic Standard Time": "America/Halifax",
    "Alaskan Standard Time": "America/Anchorage", "Hawaiian Standard Time": "Pacific/Honolulu",
    "GMT Standard Time": "Europe/London", "W. Europe Standard Time": "Europe/Berlin",
    "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw", "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kiev", "GTB Standard Time": "Europe/Bucharest",
    "Russian Standard Time": "Europe/Moscow", "Israel Standard Time": "Asia/Jerusalem",
    "India Standard Time": "Asia/Kolkata", "China Standard Time": "Asia/Shanghai",
    "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul",
    "Singapore Standard Time": "Asia/Singapore", "AUS Eastern Standard Time": "Australia/Sydney",
    "New Zealand Standard Time": "Pacific/Auckland", "E. South America Standard Time": "America/Sao_Paulo"
};

// An IANA name for a TZID, or null. Also accepts the prefixed names some
// clients write ("/mozilla.org/20050126_1/America/New_York").
function ianaZone(tzid) {
    if (!tzid) return null;
    tzid = String(tzid).replace(/^"|"$/g, "");
    if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid];
    if (tzid === "Z" || tzid === "Etc/UTC") return "UTC";
    if (isZone(tzid) && /\//.test(tzid)) return tzid;
    var m = /([A-Za-z_]+\/[A-Za-z_\-]+(?:\/[A-Za-z_\-]+)?)$/.exec(tzid);
    if (m && isZone(m[1])) return m[1];
    return isZone(tzid) ? tzid : null;
}

function localZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
}

// The wall clock of instant ms in zone tz.
function wall(ms, tz) {
    var parts = {};
    formatter(tz).formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    return {
        year: +parts.year, month: +parts.month, day: +parts.day,
        hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second
    };
}

// Offset of zone tz from UTC at instant ms, in ms.
function offset(ms, tz) {
    var w = wall(ms, tz);
    var asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
}

// The instant of a wall clock time in zone tz. Wall times that do not
// exist (in a spring-forward gap) move forward, as most calendars do.
function fromWall(w, tz) {
    var guess = Date.UTC(w.year, w.month - 1, w.day, w.hour || 0, w.minute || 0, w.second || 0);
    if (tz === "UTC") return guess;
    var t = guess - offset(guess, tz);
    var t2 = guess - offset(t, tz);
    return t2;
}

function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }

// iCalendar DATE or DATE-TIME text -> { year, month, day, hour, minute, second, utc, dateOnly }
function parseIcalDate(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(s).trim());
    if (!m) {
        // Also accept ISO 8601 with separators (2026-09-28T09:30:00Z).
        m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z)?)?$/.exec(String(s).trim());
        if (!m) return null;
    }
    return {
        year: +m[1], month: +m[2], day: +m[3],
        hour: m[4] ? +m[4] : 0, minute: m[5] ? +m[5] : 0, second: m[6] ? +m[6] : 0,
        utc: !!m[7], dateOnly: !m[4]
    };
}

function formatUtc(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
        pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
}

function formatWall(w) {
    return pad(w.year, 4) + pad(w.month) + pad(w.day) + "T" + pad(w.hour) + pad(w.minute) + pad(w.second);
}

function formatDate(w) { return pad(w.year, 4) + pad(w.month) + pad(w.day); }

// RFC 5545 DURATION ("-P1DT2H30M", "PT15M", "P1W") <-> ms.
function parseDuration(s) {
    var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s).trim());
    if (!m) return null;
    var ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60000 + +(m[6] || 0) * 1000;
    return m[1] === "-" ? -ms : ms;
}

function formatDuration(ms) {
    var sign = ms < 0 ? "-" : "";
    var s = Math.abs(Math.round(ms / 1000));
    if (s === 0) return "PT0S";
    var days = Math.floor(s / 86400); s -= days * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var mi = Math.floor(s / 60); s -= mi * 60;
    var out = sign + "P";
    if (days && days % 7 === 0 && !h && !mi && !s) return out + (days / 7) + "W";
    if (days) out += days + "D";
    if (h || mi || s) out += "T" + (h ? h + "H" : "") + (mi ? mi + "M" : "") + (s ? s + "S" : "");
    return out;
}

module.exports = {
    isZone: isZone, ianaZone: ianaZone, localZone: localZone, wall: wall, offset: offset, fromWall: fromWall,
    parseIcalDate: parseIcalDate, formatUtc: formatUtc, formatWall: formatWall, formatDate: formatDate,
    parseDuration: parseDuration, formatDuration: formatDuration, pad: pad
};
