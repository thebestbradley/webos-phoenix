// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Google's APIs as the Google account uses them, and their objects mapped to
// webOS's (the Drive is the drives' package):
//
//   who      GET https://openidconnect.googleapis.com/v1/userinfo (openid email profile)
//   Calendar https://developers.google.com/calendar/api/v3/reference:
//            GET users/me/calendarList; GET calendars/{id}/events (pageToken,
//            then syncToken for what changed: cancelled events are
//            deletions; 410 Gone asks for a full listing again);
//            POST, PATCH, DELETE calendars/{id}/events[/{eventId}]
//   People   https://developers.google.com/people/api/rest:
//            GET people/me/connections (personFields, pageToken);
//            POST people:createContact; PATCH {resourceName}:updateContact
//            (updatePersonFields, the etag); DELETE {resourceName}:deleteContact
//   Tasks    https://developers.google.com/tasks/reference/rest:
//            GET users/@me/lists; GET lists/{id}/tasks (showCompleted,
//            showHidden); POST, PATCH, DELETE lists/{id}/tasks[/{taskId}];
//            POST lists/{id}/tasks/{taskId}/move?destinationTasklist= (another list)
//
// One OAuth client for all of them: Phoenix's Google Cloud project, a
// "Desktop app" client (PKCE; its secret is not secret: Google says so for
// installed apps), the project the drives' Google Drive uses
// (docs/DEVELOPER-APPS.md). The scopes are "sensitive": Google's
// verification of the app before more than 100 users can sign in.

"use strict";

var kit = require("@phoenix/connector-kit");

var BASES = {
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    calendar: "https://www.googleapis.com/calendar/v3",
    people: "https://people.googleapis.com/v1",
    tasks: "https://tasks.googleapis.com/tasks/v1"
};
var SCOPE = "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/tasks";
var OAUTH = {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    revocationEndpoint: "https://oauth2.googleapis.com/revoke",
    scope: SCOPE,
    // A refresh token, and the account chooser.
    params: { access_type: "offline", prompt: "consent select_account" }
};
var PERSON_FIELDS = "names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,birthdays,biographies,urls,imClients,metadata";
// Google's colour ids' nearest Calendar app colours.
var COLORS = ["blue", "green", "purple", "pink", "yellow", "orange", "teal", "gray", "blue", "green", "red"];

function apis(ctx, token, client) {
    var b = Object.assign({}, BASES, client || {});
    var describe = function (body) { return body && body.error ? String(body.error.status || body.error.code || "") + (body.error.message ? ": " + body.error.message : "") : ""; };
    var make = function (base) { return kit.restApi(ctx, { base: base, token: token, describe: describe }); };
    return { userinfo: b.userinfo, calendar: make(b.calendar), people: make(b.people), tasks: make(b.tasks), who: make(b.userinfo) };
}

/** Every page (items, nextPageToken) -> {items, syncToken}. */
function pages(a, path, query, key, max) {
    var out = [];
    function page(token, n) {
        return a.get(path, Object.assign({}, query || {}, token ? { pageToken: token } : {})).then(function (r) {
            out = out.concat((r && r[key || "items"]) || []);
            if (r && r.nextPageToken && n < (max || 50)) return page(r.nextPageToken, n + 1);
            return { items: out, syncToken: (r && (r.nextSyncToken || null)) };
        });
    }
    return page(null, 0);
}

function whoAmI(g) {
    return g.who.get("").then(function (me) {
        if (!me || !me.sub) throw Object.assign(new Error("Google did not say who signed in"), { errorCode: "401_UNAUTHORIZED" });
        return { id: String(me.sub), username: me.email || me.name || String(me.sub), name: me.name || "" };
    });
}

// ---- Contacts (People) -----------------------------------------------------------------------------

var PHONE_TYPES = { mobile: "type_mobile", home: "type_home", work: "type_work", homeFax: "type_personal_fax", workFax: "type_work_fax", main: "type_main", pager: "type_pager" };
var REV_PHONE = { type_mobile: "mobile", type_home: "home", type_work: "work", type_personal_fax: "homeFax", type_work_fax: "workFax", type_main: "main", type_pager: "pager" };
function hwo(t) { return t === "home" ? "type_home" : t === "work" ? "type_work" : "type_other"; }
function revHwo(t) { return t === "type_home" ? "home" : t === "type_work" ? "work" : "other"; }
function pad(n) { return (n < 10 ? "0" : "") + n; }

/** A People person -> the Contacts app's fields. */
function contactFields(p) {
    var n = (p.names || [])[0] || {};
    var org = (p.organizations || [])[0];
    var b = (p.birthdays || []).map(function (x) { return x.date; }).filter(function (d) { return d && d.month && d.day; })[0];
    return {
        name: { givenName: n.givenName || (!n.familyName && n.displayName && !org ? n.displayName : ""), familyName: n.familyName || "", middleName: n.middleName || "",
                honorificPrefix: n.honorificPrefix || "", honorificSuffix: n.honorificSuffix || "" },
        nickname: ((p.nicknames || [])[0] || {}).value || "",
        birthday: b ? (b.year ? b.year : "0000") + "-" + pad(b.month) + "-" + pad(b.day) : "",
        note: ((p.biographies || [])[0] || {}).value || "",
        emails: (p.emailAddresses || []).filter(function (e) { return e.value; }).map(function (e) {
            return { value: e.value, type: hwo(e.type), primary: !!(e.metadata && e.metadata.primary) };
        }),
        phoneNumbers: (p.phoneNumbers || []).filter(function (e) { return e.value; }).map(function (e) {
            return { value: e.value, type: PHONE_TYPES[e.type] || "type_other", primary: !!(e.metadata && e.metadata.primary) };
        }),
        addresses: (p.addresses || []).map(function (a) {
            return { streetAddress: [a.streetAddress, a.extendedAddress].filter(Boolean).join("\n"), locality: a.city || "", region: a.region || "",
                     postalCode: a.postalCode || "", country: a.country || "", type: hwo(a.type) };
        }),
        organizations: org ? [{ name: org.name || "", title: org.title || "", department: org.department || "", type: "type_work" }] : [],
        urls: (p.urls || []).filter(function (u) { return u.value; }).map(function (u) { return { value: u.value, type: hwo(u.type) }; }),
        ims: (p.imClients || []).filter(function (i) { return i.username; }).map(function (i) { return { value: i.username, type: "type_default" }; })
    };
}

/** The Contacts app's fields -> a People person (createContact / updateContact body). */
function person(f) {
    var n = f.name || {};
    var org = (f.organizations || [])[0];
    var out = {
        names: [{ givenName: n.givenName || "", familyName: n.familyName || "", middleName: n.middleName || "", honorificPrefix: n.honorificPrefix || "", honorificSuffix: n.honorificSuffix || "" }],
        nicknames: f.nickname ? [{ value: f.nickname }] : [],
        biographies: f.note ? [{ value: f.note, contentType: "TEXT_PLAIN" }] : [],
        emailAddresses: (f.emails || []).filter(function (e) { return e && e.value; }).map(function (e) { return { value: e.value, type: revHwo(e.type) }; }),
        phoneNumbers: (f.phoneNumbers || []).filter(function (e) { return e && e.value; }).map(function (e) { return { value: e.value, type: REV_PHONE[e.type] || "other" }; }),
        addresses: (f.addresses || []).map(function (a) {
            return { streetAddress: a.streetAddress || "", city: a.locality || "", region: a.region || "", postalCode: a.postalCode || "", country: a.country || "", type: revHwo(a.type) };
        }),
        organizations: org ? [{ name: org.name || "", title: org.title || "", department: org.department || "" }] : [],
        urls: (f.urls || []).filter(function (u) { return u && u.value; }).map(function (u) { return { value: u.value, type: revHwo(u.type) }; }),
        birthdays: []
    };
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.birthday || "");
    if (m) out.birthdays = [{ date: Object.assign(m[1] !== "0000" ? { year: +m[1] } : {}, { month: +m[2], day: +m[3] }) }];
    return out;
}

// ---- Calendar ----------------------------------------------------------------------------------

function calendarFields(c, i) {
    return { name: c.summaryOverride || c.summary || "Calendar", isReadOnly: c.accessRole === "reader" || c.accessRole === "freeBusyReader",
             syncSource: "Google", excludeFromAll: false, color: COLORS[(Number(c.colorId) || i + 1) % COLORS.length] };
}

/** A Google event -> the Calendar app's fields. */
function eventFields(e, calendarId, tz) {
    var f = { calendarId: calendarId, subject: e.summary || "", location: e.location || "", allDay: !!(e.start && e.start.date) };
    if (f.allDay) {
        var span = kit.allDaySpan(e.start.date, e.end && e.end.date, tz);
        f.dtstart = span.dtstart; f.dtend = span.dtend; f.tzId = tz;
    } else {
        f.dtstart = Date.parse(e.start && e.start.dateTime);
        f.dtend = Date.parse(e.end && e.end.dateTime) || f.dtstart;
        f.tzId = (e.start && e.start.timeZone) || "UTC";
    }
    var note = kit.plainText(e.description || "");
    var video = ((e.conferenceData && e.conferenceData.entryPoints) || []).filter(function (p) { return p.entryPointType === "video" && p.uri; })[0];
    var join = e.hangoutLink || (video && video.uri) || kit.joinUrlOf(e.location, note);
    f.note = join ? kit.meetingNote(note, join, /meet\.google\.com/.test(join) ? "Google Meet" : /zoom\./.test(join) ? "Zoom" : /teams\./.test(join) ? "Microsoft Teams" : "online") : note;
    f.url = join || "";
    f.joinUrl = join || "";
    var rule = (e.recurrence || []).filter(function (r) { return /^RRULE:/i.test(r); })[0];
    f.rrule = rule ? kit.rruleOf(rule, { dtstart: f.dtstart, tzId: f.tzId, allDay: f.allDay }) || null : null;
    var ex = [];
    (e.recurrence || []).filter(function (r) { return /^EXDATE/i.test(r); }).forEach(function (r) {
        String(r).replace(/^EXDATE[^:]*:/i, "").split(",").forEach(function (v) {
            var m = /^(\d{8})(T\d{6}Z?)?$/.exec(v.trim());
            if (m) ex.push(m[2] ? m[1] + m[2].replace(/Z?$/, "Z") : m[1] + "T000000Z");
        });
    });
    f.exdates = ex.length ? ex : null;
    var rem = e.reminders || {};
    var mins = rem.useDefault ? 10 : ((rem.overrides || []).filter(function (o) { return o.method === "popup"; })[0] || (rem.overrides || [])[0] || {}).minutes;
    f.alarm = mins === undefined ? [] : kit.alarmBefore(mins);
    f.attendees = (e.attendees || []).filter(function (a) { return a.email; }).map(function (a) {
        return { email: a.email, commonName: a.displayName || "", organizer: !!a.organizer,
                 participationStatus: { accepted: "ACCEPTED", declined: "DECLINED", tentative: "TENTATIVE" }[a.responseStatus] || "NEEDS-ACTION",
                 role: a.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT" };
    });
    if (e.organizer && e.organizer.email && !f.attendees.some(function (a) { return a.email === e.organizer.email; }))
        f.attendees.unshift({ email: e.organizer.email, commonName: e.organizer.displayName || "", organizer: true });
    f.transp = e.transparency === "transparent" ? "TRANSPARENT" : "OPAQUE";
    f.classification = e.visibility === "private" || e.visibility === "confidential" ? "PRIVATE" : "PUBLIC";
    return f;
}

/** The Calendar app's fields -> a Google event (insert / patch body). */
function googleEvent(f, tz) {
    var body = { summary: f.subject || "", description: f.note || "", location: f.location || "",
                 transparency: f.transp === "TRANSPARENT" ? "transparent" : "opaque", visibility: f.classification === "PRIVATE" ? "private" : "default" };
    if (f.allDay) {
        var d = kit.allDayDates(Number(f.dtstart), Number(f.dtend), tz);
        body.start = { date: d.first };
        body.end = { date: d.endExclusive };
    } else {
        body.start = { dateTime: new Date(Number(f.dtstart)).toISOString(), timeZone: f.tzId && f.tzId !== "UTC" ? f.tzId : "UTC" };
        body.end = { dateTime: new Date(Number(f.dtend || f.dtstart)).toISOString(), timeZone: body.start.timeZone };
    }
    var rec = [];
    if (f.rrule) rec.push("RRULE:" + kit.rruleText(f.rrule, { allDay: f.allDay, tzId: f.tzId || tz }));
    if (f.rrule && f.exdates && f.exdates.length) rec.push("EXDATE:" + f.exdates.join(","));
    body.recurrence = rec;
    var mins = kit.alarmMinutes(f.alarm);
    body.reminders = mins === null ? { useDefault: false, overrides: [] } : { useDefault: false, overrides: [{ method: "popup", minutes: mins }] };
    body.attendees = (f.attendees || []).filter(function (a) { return a && a.email && !a.organizer; }).map(function (a) {
        return { email: a.email, displayName: a.commonName || undefined, optional: a.role === "OPT-PARTICIPANT" || undefined };
    });
    return body;
}

// ---- Tasks ---------------------------------------------------------------------------------------

function taskFields(t, listId) {
    var due = null;
    var p = t.due ? kit.dateParts(t.due) : null;
    if (p) due = new Date(p.year, p.month - 1, p.day).getTime();
    var done = t.status === "completed";
    return { summary: t.title || "", notes: t.notes || "", due: due, allDay: due !== null, completed: done,
             completedTime: done && t.completed ? Date.parse(t.completed) || null : null, priority: 0, listId: listId };
}

function googleTask(f) {
    var body = { title: f.summary || "", notes: f.notes || "", status: f.completed ? "completed" : "needsAction" };
    if (f.due) {
        var d = new Date(Number(f.due));
        // Google keeps the date only: midnight UTC of the day.
        body.due = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T00:00:00.000Z";
    } else body.due = null;
    body.completed = f.completed ? new Date(Number(f.completedTime) || Date.now()).toISOString() : null;
    return body;
}

module.exports = {
    BASES: BASES, SCOPE: SCOPE, OAUTH: OAUTH, PERSON_FIELDS: PERSON_FIELDS,
    HOSTS: ["openidconnect.googleapis.com", "www.googleapis.com", "people.googleapis.com", "tasks.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"],
    apis: apis, pages: pages, whoAmI: whoAmI,
    contactFields: contactFields, person: person,
    calendarFields: calendarFields, eventFields: eventFields, googleEvent: googleEvent,
    taskFields: taskFields, googleTask: googleTask
};
