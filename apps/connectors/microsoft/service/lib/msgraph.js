// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Microsoft Graph (https://learn.microsoft.com/graph/api/overview, v1.0) as
// the Microsoft account uses it, and its objects mapped to webOS's:
//
//   contacts  GET/POST /me/contacts, PATCH/DELETE /me/contacts/{id}
//             (https://learn.microsoft.com/graph/api/resources/contact)
//   calendar  GET /me/calendars; GET /me/calendars/{id}/events (series
//             masters and single events, times in UTC by the Prefer header
//             outlook.timezone, bodies as text by outlook.body-content-type);
//             POST /me/calendars/{id}/events, PATCH/DELETE /me/events/{id}
//             (https://learn.microsoft.com/graph/api/resources/event); an
//             online meeting's joinUrl (Teams) is the event's url and its
//             note's first line
//   To Do     GET /me/todo/lists, /me/todo/lists/{id}/tasks; POST, PATCH,
//             DELETE of a task in its list
//             (https://learn.microsoft.com/graph/api/resources/todotask)
//   mail      lib/mail.js
//
// Pages are followed by @odata.nextLink. The account's registration is
// Phoenix's Entra app, the same one the drives' OneDrive uses
// (docs/DEVELOPER-APPS.md): a public client with PKCE.

"use strict";

var kit = require("@phoenix/connector-kit");

var GRAPH = "https://graph.microsoft.com/v1.0";
var SCOPE = "offline_access openid profile User.Read Contacts.ReadWrite Calendars.ReadWrite Tasks.ReadWrite Mail.ReadWrite Mail.Send";
var OAUTH = {
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: SCOPE,
    // The account picker each time: an account already signed in on the sheet's browser is not taken for granted.
    params: { prompt: "select_account" }
};
var PREFER = "outlook.timezone=\"UTC\", outlook.body-content-type=\"text\"";

function api(ctx, token, base) {
    return kit.restApi(ctx, {
        base: base || GRAPH, token: token,
        describe: function (b) { return b && b.error ? String(b.error.code || "") + (b.error.message ? ": " + b.error.message : "") : ""; }
    });
}

/** Every page of a listing (value, @odata.nextLink). */
function all(a, path, query, headers, max) {
    var out = [];
    function page(url, n) {
        var call = url ? a.send("GET", url, { headers: headers }) : a.send("GET", path, { query: query, headers: headers });
        return call.then(function (r) {
            out = out.concat((r && r.value) || []);
            var next = r && r["@odata.nextLink"];
            return next && n < (max || 50) ? page(next, n + 1) : out;
        });
    }
    return page(null, 0);
}

function whoAmI(a) {
    return a.get("/me", { $select: "id,displayName,mail,userPrincipalName" }).then(function (me) {
        return { id: me.id, username: me.mail || me.userPrincipalName || me.displayName || me.id, name: me.displayName || "" };
    });
}

// ---- Contacts -----------------------------------------------------------------------------

var CONTACT_SELECT = "id,changeKey,givenName,surname,middleName,displayName,nickName,emailAddresses,businessPhones,homePhones,mobilePhone," +
    "companyName,jobTitle,department,birthday,homeAddress,businessAddress,otherAddress,personalNotes,businessHomePage,imAddresses,title,generation";

function addressOf(a, type) {
    if (!a) return null;
    var out = { streetAddress: a.street || "", locality: a.city || "", region: a.state || "", postalCode: a.postalCode || "",
                country: a.countryOrRegion || "", type: type };
    return out.streetAddress || out.locality || out.region || out.postalCode || out.country ? out : null;
}

/** A Graph contact -> the Contacts app's fields. */
function contactFields(c) {
    var phones = [];
    (c.businessPhones || []).forEach(function (v) { if (v) phones.push({ value: v, type: "type_work" }); });
    (c.homePhones || []).forEach(function (v) { if (v) phones.push({ value: v, type: "type_home" }); });
    if (c.mobilePhone) phones.push({ value: c.mobilePhone, type: "type_mobile" });
    var org = c.companyName || c.jobTitle || c.department ? [{ name: c.companyName || "", title: c.jobTitle || "", department: c.department || "", type: "type_work" }] : [];
    var given = c.givenName || "", family = c.surname || "";
    if (!given && !family && c.displayName && !c.companyName) given = c.displayName;
    return {
        name: { givenName: given, familyName: family, middleName: c.middleName || "", honorificPrefix: c.title || "", honorificSuffix: c.generation || "" },
        nickname: c.nickName || "",
        birthday: c.birthday ? String(c.birthday).slice(0, 10) : "",
        note: c.personalNotes || "",
        emails: (c.emailAddresses || []).filter(function (e) { return e && e.address; }).map(function (e, i) { return { value: e.address, type: "type_other", primary: i === 0 }; }),
        phoneNumbers: phones,
        addresses: [addressOf(c.businessAddress, "type_work"), addressOf(c.homeAddress, "type_home"), addressOf(c.otherAddress, "type_other")].filter(Boolean),
        organizations: org,
        urls: c.businessHomePage ? [{ value: c.businessHomePage, type: "type_work" }] : [],
        ims: (c.imAddresses || []).filter(Boolean).map(function (v) { return { value: v, type: "type_default" }; })
    };
}

function graphAddress(a) {
    return a ? { street: a.streetAddress || "", city: a.locality || "", state: a.region || "", postalCode: a.postalCode || "", countryOrRegion: a.country || "" } : {};
}

/** The Contacts app's fields -> a Graph contact (POST or PATCH body). */
function graphContact(f) {
    var n = f.name || {};
    var phones = f.phoneNumbers || [];
    var addrs = f.addresses || [];
    var org = (f.organizations || [])[0] || {};
    var byType = function (t) { return addrs.filter(function (a) { return a.type === t; })[0]; };
    var other = addrs.filter(function (a) { return a.type !== "type_work" && a.type !== "type_home"; })[0];
    return {
        givenName: n.givenName || "", surname: n.familyName || "", middleName: n.middleName || "", title: n.honorificPrefix || "", generation: n.honorificSuffix || "",
        displayName: [n.givenName, n.middleName, n.familyName].filter(Boolean).join(" ") || org.name || "",
        nickName: f.nickname || "",
        birthday: f.birthday ? f.birthday + "T00:00:00Z" : null,
        personalNotes: f.note || "",
        emailAddresses: (f.emails || []).filter(function (e) { return e && e.value; }).slice(0, 3).map(function (e) { return { address: e.value, name: e.value }; }),
        businessPhones: phones.filter(function (p) { return p.type === "type_work" || p.type === "type_main" || p.type === "type_work_fax"; }).map(function (p) { return p.value; }),
        homePhones: phones.filter(function (p) { return p.type === "type_home" || p.type === "type_personal_fax" || p.type === "type_other"; }).map(function (p) { return p.value; }),
        mobilePhone: (phones.filter(function (p) { return p.type === "type_mobile"; })[0] || {}).value || null,
        companyName: org.name || "", jobTitle: org.title || "", department: org.department || "",
        businessAddress: graphAddress(byType("type_work")), homeAddress: graphAddress(byType("type_home")), otherAddress: graphAddress(other),
        businessHomePage: ((f.urls || [])[0] || {}).value || "",
        imAddresses: (f.ims || []).map(function (i) { return i.value; }).filter(Boolean).slice(0, 3)
    };
}

// ---- Calendar ------------------------------------------------------------------------------

var EVENT_SELECT = "id,changeKey,subject,body,bodyPreview,location,start,end,isAllDay,recurrence,reminderMinutesBeforeStart,isReminderOn," +
    "attendees,organizer,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,showAs,sensitivity,type,webLink,categories,isCancelled";
// The Calendar app's colours (apps/dav/service/lib/sync.js COLORS), for Outlook's.
var COLORS = { lightBlue: "blue", lightGreen: "green", lightOrange: "orange", lightGray: "gray", lightYellow: "yellow", lightTeal: "teal",
               lightPink: "pink", lightBrown: "orange", lightRed: "red", maxColor: "purple", auto: "blue" };
var DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
var INDEX = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

function utcMs(dt) {
    // Graph's "2026-10-12T09:00:00.0000000" in UTC (the Prefer header).
    var s = String(dt && dt.dateTime || "");
    if (!s) return NaN;
    return Date.parse(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(/(\.\d{3})\d*$/, "$1") + "Z");
}

/** patternedRecurrence -> an RRULE value. */
function rruleOfPattern(rec, allDay) {
    if (!rec || !rec.pattern) return "";
    var p = rec.pattern, r = rec.range || {}, parts = [];
    var days = (p.daysOfWeek || []).map(function (d) { return DAY_CODES[DAYS.indexOf(String(d).toLowerCase())]; }).filter(Boolean);
    switch (p.type) {
    case "daily": parts.push("FREQ=DAILY"); break;
    case "weekly": parts.push("FREQ=WEEKLY"); if (days.length) parts.push("BYDAY=" + days.join(",")); break;
    case "absoluteMonthly": parts.push("FREQ=MONTHLY", "BYMONTHDAY=" + p.dayOfMonth); break;
    case "relativeMonthly": parts.push("FREQ=MONTHLY", "BYDAY=" + days.map(function (d) { return (INDEX[p.index] || 1) + d; }).join(",")); break;
    case "absoluteYearly": parts.push("FREQ=YEARLY", "BYMONTH=" + p.month, "BYMONTHDAY=" + p.dayOfMonth); break;
    case "relativeYearly": parts.push("FREQ=YEARLY", "BYMONTH=" + p.month, "BYDAY=" + days.map(function (d) { return (INDEX[p.index] || 1) + d; }).join(",")); break;
    default: return "";
    }
    if (p.interval && p.interval !== 1) parts.push("INTERVAL=" + p.interval);
    if (r.type === "numbered" && r.numberOfOccurrences) parts.push("COUNT=" + r.numberOfOccurrences);
    else if (r.type === "endDate" && r.endDate) parts.push("UNTIL=" + String(r.endDate).replace(/-/g, "") + (allDay ? "" : "T235959Z"));
    return parts.join(";");
}

/** The Calendar app's rrule object -> patternedRecurrence (startDate: the event's first day, "YYYY-MM-DD"). */
function patternOf(rrule, startDate, tz) {
    if (!rrule || !rrule.freq) return null;
    var rules = {};
    (rrule.rules || []).forEach(function (x) { rules[x.ruleType] = x.ruleValue || []; });
    var days = (rules.BYDAY || []).map(function (v) { return DAYS[v.day]; }).filter(Boolean);
    var ord = (rules.BYDAY || []).map(function (v) { return v.ord; }).filter(function (x) { return x; })[0];
    var index = ord === -1 ? "last" : ["first", "second", "third", "fourth"][(ord || 1) - 1] || "first";
    var p = { interval: rrule.interval || 1 };
    var start = kit.dateParts(startDate) || { month: 1, day: 1 };
    switch (String(rrule.freq).toUpperCase()) {
    case "DAILY": p.type = "daily"; break;
    case "WEEKLY": p.type = "weekly"; p.daysOfWeek = days.length ? days : [DAYS[new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]]; p.firstDayOfWeek = "sunday"; break;
    case "MONTHLY":
        if (ord) { p.type = "relativeMonthly"; p.daysOfWeek = days; p.index = index; }
        else { p.type = "absoluteMonthly"; p.dayOfMonth = ((rules.BYMONTHDAY || [])[0] || {}).ord || start.day; }
        break;
    case "YEARLY":
        p.month = ((rules.BYMONTH || [])[0] || {}).ord || start.month;
        if (ord) { p.type = "relativeYearly"; p.daysOfWeek = days; p.index = index; }
        else { p.type = "absoluteYearly"; p.dayOfMonth = ((rules.BYMONTHDAY || [])[0] || {}).ord || start.day; }
        break;
    default: return null;
    }
    var range = { startDate: startDate, recurrenceTimeZone: "UTC" };
    if (rrule.count) { range.type = "numbered"; range.numberOfOccurrences = rrule.count; }
    else if (rrule.until) {
        var w = new Date(rrule.until);
        range.type = "endDate";
        range.endDate = w.getUTCFullYear() + "-" + ("0" + (w.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + w.getUTCDate()).slice(-2);
    } else range.type = "noEnd";
    void tz;
    return { pattern: p, range: range };
}

/** A Graph event -> the Calendar app's fields (calendarId: the db8 calendar's). */
function eventFields(e, calendarId, tz) {
    var f = { calendarId: calendarId, subject: e.subject || "", location: (e.location && e.location.displayName) || "", allDay: !!e.isAllDay, tzId: tz };
    if (e.isAllDay) {
        var span = kit.allDaySpan(e.start && e.start.dateTime, e.end && e.end.dateTime, tz);
        f.dtstart = span ? span.dtstart : utcMs(e.start);
        f.dtend = span ? span.dtend : utcMs(e.end);
    } else {
        f.dtstart = utcMs(e.start);
        f.dtend = utcMs(e.end);
        f.tzId = "UTC";
    }
    var note = (e.body && e.body.contentType === "html" ? kit.plainText(e.body.content) : (e.body && e.body.content) || e.bodyPreview || "").trim();
    var join = (e.onlineMeeting && e.onlineMeeting.joinUrl) || kit.joinUrlOf(e.location && e.location.displayName, note);
    var provider = e.onlineMeetingProvider === "teamsForBusiness" || e.onlineMeetingProvider === "teamsForConsumer" || /teams\./.test(join) ? "Microsoft Teams" : "online";
    f.note = join ? kit.meetingNote(note, join, provider) : note;
    f.url = join || "";
    f.joinUrl = join || "";
    var rule = rruleOfPattern(e.recurrence, e.isAllDay);
    f.rrule = rule ? kit.rruleOf(rule, { dtstart: f.dtstart, tzId: f.tzId, allDay: f.allDay }) || null : null;
    f.alarm = e.isReminderOn === false ? [] : kit.alarmBefore(e.reminderMinutesBeforeStart);
    var people = [];
    if (e.organizer && e.organizer.emailAddress && e.organizer.emailAddress.address)
        people.push({ email: e.organizer.emailAddress.address, commonName: e.organizer.emailAddress.name || "", organizer: true });
    (e.attendees || []).forEach(function (a) {
        var ea = a.emailAddress || {};
        if (!ea.address || people.some(function (p) { return p.email === ea.address; })) return;
        var st = (a.status && a.status.response) || "none";
        people.push({ email: ea.address, commonName: ea.name || "", organizer: false,
                      participationStatus: { accepted: "ACCEPTED", declined: "DECLINED", tentativelyAccepted: "TENTATIVE" }[st] || "NEEDS-ACTION",
                      role: a.type === "optional" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT" });
    });
    f.attendees = people;
    f.transp = e.showAs === "free" ? "TRANSPARENT" : "OPAQUE";
    f.classification = e.sensitivity === "private" || e.sensitivity === "confidential" ? "PRIVATE" : "PUBLIC";
    return f;
}

function isoUtc(ms) { return new Date(ms).toISOString().replace(/Z$/, ""); }

/** The Calendar app's fields -> a Graph event (POST or PATCH body). */
function graphEvent(f, tz) {
    var body = { subject: f.subject || "", body: { contentType: "text", content: f.note || "" }, location: { displayName: f.location || "" },
                 isAllDay: !!f.allDay, showAs: f.transp === "TRANSPARENT" ? "free" : "busy",
                 sensitivity: f.classification === "PRIVATE" ? "private" : "normal" };
    if (f.allDay) {
        var d = kit.allDayDates(Number(f.dtstart), Number(f.dtend), tz);
        body.start = { dateTime: d.first + "T00:00:00", timeZone: "UTC" };
        body.end = { dateTime: d.endExclusive + "T00:00:00", timeZone: "UTC" };
    } else {
        body.start = { dateTime: isoUtc(Number(f.dtstart)), timeZone: "UTC" };
        body.end = { dateTime: isoUtc(Number(f.dtend || f.dtstart)), timeZone: "UTC" };
    }
    var mins = kit.alarmMinutes(f.alarm);
    body.isReminderOn = mins !== null;
    if (mins !== null) body.reminderMinutesBeforeStart = mins;
    var startDate = f.allDay ? body.start.dateTime.slice(0, 10) : new Date(Number(f.dtstart)).toISOString().slice(0, 10);
    body.recurrence = f.rrule ? patternOf(f.rrule, startDate, tz) : null;
    body.attendees = (f.attendees || []).filter(function (a) { return a && a.email && !a.organizer; }).map(function (a) {
        return { emailAddress: { address: a.email, name: a.commonName || "" }, type: a.role === "OPT-PARTICIPANT" ? "optional" : "required" };
    });
    return body;
}

function calendarFields(c, i) {
    return { name: c.name || "Calendar", isReadOnly: c.canEdit === false, syncSource: "Microsoft", excludeFromAll: false,
             color: COLORS[c.color] || ["blue", "green", "orange", "purple", "teal", "red", "pink", "yellow", "gray"][i % 9] };
}

// ---- To Do ---------------------------------------------------------------------------------

function taskFields(t, listId, tz) {
    var due = null;
    if (t.dueDateTime && t.dueDateTime.dateTime) {
        var p = kit.dateParts(t.dueDateTime.dateTime);
        due = p ? new Date(p.year, p.month - 1, p.day).getTime() : null;
    }
    void tz;
    var done = t.status === "completed";
    return {
        summary: t.title || "", notes: (t.body && (t.body.contentType === "html" ? kit.plainText(t.body.content) : t.body.content)) || "",
        due: due, allDay: due !== null, completed: done,
        completedTime: done && t.completedDateTime ? (utcMs(t.completedDateTime) || null) : null,
        priority: t.importance === "high" ? 1 : t.importance === "low" ? 9 : 0,
        listId: listId
    };
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

function graphTask(f) {
    var body = { title: f.summary || "", body: { contentType: "text", content: f.notes || "" },
                 importance: f.priority === 1 ? "high" : f.priority >= 6 ? "low" : "normal",
                 status: f.completed ? "completed" : "notStarted" };
    if (f.due) {
        var d = new Date(Number(f.due));
        body.dueDateTime = { dateTime: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T00:00:00", timeZone: "UTC" };
    } else body.dueDateTime = null;
    if (f.completed) body.completedDateTime = { dateTime: isoUtc(Number(f.completedTime) || Date.now()), timeZone: "UTC" };
    return body;
}

module.exports = {
    GRAPH: GRAPH, SCOPE: SCOPE, OAUTH: OAUTH, PREFER: PREFER, CONTACT_SELECT: CONTACT_SELECT, EVENT_SELECT: EVENT_SELECT,
    HOSTS: ["graph.microsoft.com", "login.microsoftonline.com"],
    api: api, all: all, whoAmI: whoAmI,
    contactFields: contactFields, graphContact: graphContact,
    eventFields: eventFields, graphEvent: graphEvent, calendarFields: calendarFields, rruleOfPattern: rruleOfPattern, patternOf: patternOf, utcMs: utcMs,
    taskFields: taskFields, graphTask: graphTask
};
