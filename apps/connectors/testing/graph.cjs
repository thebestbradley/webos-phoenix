// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for Microsoft Graph v1.0 (https://learn.microsoft.com/graph/api/overview)
// and the Microsoft identity platform's OAuth, the endpoints the Microsoft
// account uses (apps/connectors/microsoft), as documented, under /graph/v1.0:
//
//   /me                                    who signed in
//   /me/contacts[/{id}]                    GET (@odata.nextLink pages, $top), POST, PATCH, DELETE
//   /me/calendars                          GET
//   /me/calendars/{id}/events              GET (times in UTC only with Prefer outlook.timezone="UTC"), POST
//   /me/events/{id}                        PATCH, DELETE
//   /me/todo/lists[/{id}/tasks[/{tid}]]    GET, POST, PATCH, DELETE
//   /me/mailFolders, /me/mailFolders/{id}/messages, /me/messages/{id}, /me/sendMail   (lib/mail.js)
//
// Every object has a changeKey that changes with it. OAuth: /oauth/microsoft/
// (a public client with PKCE). fake.graph: {contacts, calendars, events, lists, tasks, folders, messages, sent}

"use strict";

const crypto = require("crypto");

function addGraph(base) {
    const send = base.send;
    let n = 100;
    const id = (p) => (p || "AAMk") + (n++).toString(36) + crypto.randomBytes(3).toString("hex");
    const ck = () => crypto.randomBytes(6).toString("base64");
    const g = base.graph = {
        me: { id: "8f2a1c3e-0000-4000-8000-000000000001", displayName: "Anna Lee", mail: "anna@contoso.example", userPrincipalName: "anna@contoso.example" },
        contacts: [], calendars: [], events: [], lists: [], tasks: [], folders: [], messages: [], sent: [], pageSize: 2, preferSeen: []
    };
    const stamp = (o) => Object.assign(o, { changeKey: ck(), "@odata.etag": "W/\"" + ck() + "\"", lastModifiedDateTime: new Date().toISOString() });
    g.contacts.push(stamp({ id: id("C"), givenName: "Megan", surname: "Bowen", displayName: "Megan Bowen", emailAddresses: [{ address: "megan@contoso.example", name: "Megan Bowen" }],
                            businessPhones: ["+1 425 555 0109"], mobilePhone: "+1 425 555 0110", homePhones: [], companyName: "Contoso", jobTitle: "Marketing Manager",
                            businessAddress: { street: "1 Microsoft Way", city: "Redmond", state: "WA", postalCode: "98052", countryOrRegion: "USA" },
                            birthday: "1990-05-14T11:59:00Z", personalNotes: "Met at Build" }));
    g.contacts.push(stamp({ id: id("C"), givenName: "Alex", surname: "Wilber", displayName: "Alex Wilber", emailAddresses: [{ address: "alex@contoso.example" }], businessPhones: [], homePhones: [] }));
    g.contacts.push(stamp({ id: id("C"), givenName: "", surname: "", displayName: "Reception", companyName: "Contoso", emailAddresses: [], businessPhones: ["+1 425 555 0100"], homePhones: [] }));
    const work = { id: id("CAL"), name: "Calendar", color: "lightBlue", canEdit: true, isDefaultCalendar: true };
    const holidays = { id: id("CAL"), name: "United States holidays", color: "lightGreen", canEdit: false, isDefaultCalendar: false };
    g.calendars.push(work, holidays);
    const ev = (cal, o) => { const e = stamp(Object.assign({ id: id("E"), calendarId: cal.id, type: "singleInstance", isCancelled: false, isAllDay: false,
                                                              isReminderOn: true, reminderMinutesBeforeStart: 15, attendees: [], body: { contentType: "text", content: "" },
                                                              location: { displayName: "" }, showAs: "busy", sensitivity: "normal" }, o)); g.events.push(e); return e; };
    g.teams = ev(work, { subject: "Project sync", start: { dateTime: "2026-10-13T16:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-13T16:30:00.0000000", timeZone: "UTC" },
                         isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness",
                         onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7b%7d" },
                         body: { contentType: "text", content: "Weekly status." }, location: { displayName: "Microsoft Teams Meeting" },
                         organizer: { emailAddress: { address: "megan@contoso.example", name: "Megan Bowen" } },
                         attendees: [{ type: "required", status: { response: "accepted" }, emailAddress: { address: "anna@contoso.example", name: "Anna Lee" } }] });
    ev(work, { subject: "Standup", type: "seriesMaster", start: { dateTime: "2026-10-12T08:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-12T08:45:00.0000000", timeZone: "UTC" },
               recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday", "friday"], firstDayOfWeek: "sunday" },
                             range: { type: "endDate", startDate: "2026-10-12", endDate: "2026-12-18" } } });
    ev(holidays, { subject: "Thanksgiving Day", isAllDay: true, start: { dateTime: "2026-11-26T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-27T00:00:00.0000000", timeZone: "UTC" },
                   isReminderOn: false, showAs: "free" });
    const tasksList = { id: id("L"), displayName: "Tasks", wellknownListName: "defaultList" };
    const shop = { id: id("L"), displayName: "Shopping", wellknownListName: "none" };
    g.lists.push(tasksList, shop);
    const task = (list, o) => { const t = stamp(Object.assign({ id: id("T"), listId: list.id, status: "notStarted", importance: "normal", body: { content: "", contentType: "text" } }, o)); g.tasks.push(t); return t; };
    task(tasksList, { title: "Send the slides", importance: "high", dueDateTime: { dateTime: "2026-10-14T00:00:00.0000000", timeZone: "UTC" } });
    task(shop, { title: "Coffee beans" });
    task(tasksList, { title: "Book the venue", status: "completed", completedDateTime: { dateTime: "2026-10-09T10:00:00.0000000", timeZone: "UTC" } });
    g.edit = (list, obj, fields) => Object.assign(stamp(obj), fields);

    base.oauthProvider("microsoft", { pkce: true, scope: "offline_access User.Read Contacts.ReadWrite Calendars.ReadWrite Tasks.ReadWrite Mail.ReadWrite Mail.Send" });

    const P = "/graph/v1.0";
    base.route("*", /^\/graph\/v1\.0\//, (req, res) => {
        if (!base.bearer(req, "microsoft")) return send(res, 401, { error: { code: "InvalidAuthenticationToken", message: "Access token has expired or is not yet valid." } });
        return false;
    });
    const page = (req, c, list, path) => {
        const size = Math.min(Number(c.query.get("$top")) || 100, g.pageSize || 100);
        const skip = Number(c.query.get("$skip") || 0);
        const out = { value: list.slice(skip, skip + size) };
        if (skip + size < list.length) out["@odata.nextLink"] = base.origin + path + "?$top=" + size + "&$skip=" + (skip + size);
        return out;
    };
    const notFound = (res) => send(res, 404, { error: { code: "ErrorItemNotFound", message: "The specified object was not found in the store." } });
    const strip = (o) => { const x = Object.assign({}, o); delete x.calendarId; delete x.listId; return x; };
    base.route("GET", /^\/graph\/v1\.0\/me$/, (req, res) => send(res, 200, g.me));

    base.route("GET", /^\/graph\/v1\.0\/me\/contacts$/, (req, res, c) => send(res, 200, page(req, c, g.contacts, P + "/me/contacts")));
    base.route("POST", /^\/graph\/v1\.0\/me\/contacts$/, (req, res, c) => { const x = stamp(Object.assign({ id: id("C") }, c.json())); g.contacts.push(x); return send(res, 201, x); });
    base.route("*", /^\/graph\/v1\.0\/me\/contacts\/([^/]+)$/, (req, res, c) => {
        const i = g.contacts.findIndex((x) => x.id === decodeURIComponent(c.m[1]));
        if (i < 0) return notFound(res);
        if (req.method === "PATCH") return send(res, 200, stamp(Object.assign(g.contacts[i], c.json())));
        if (req.method === "DELETE") { g.contacts.splice(i, 1); return send(res, 204, ""); }
        return send(res, 200, g.contacts[i]);
    });

    base.route("GET", /^\/graph\/v1\.0\/me\/calendars$/, (req, res, c) => send(res, 200, page(req, c, g.calendars, P + "/me/calendars")));
    base.route("*", /^\/graph\/v1\.0\/me\/calendars\/([^/]+)\/events$/, (req, res, c) => {
        const cal = g.calendars.find((x) => x.id === decodeURIComponent(c.m[1]));
        if (!cal) return notFound(res);
        if (req.method === "POST") {
            if (!cal.canEdit) return send(res, 403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } });
            const x = stamp(Object.assign({ id: id("E"), calendarId: cal.id, type: "singleInstance", isCancelled: false }, c.json()));
            if (x.recurrence) x.type = "seriesMaster";
            g.events.push(x);
            return send(res, 201, strip(x));
        }
        g.preferSeen.push(req.headers.prefer || "");
        // Without the Prefer header Graph answers in the calendar's own zone: the fake says so by refusing.
        if (!/outlook\.timezone="UTC"/.test(req.headers.prefer || "")) return send(res, 400, { error: { code: "Test", message: "the connector must ask for UTC" } });
        return send(res, 200, page(req, c, g.events.filter((e) => e.calendarId === cal.id).map(strip), c.url.pathname));
    });
    base.route("*", /^\/graph\/v1\.0\/me\/events\/([^/]+)$/, (req, res, c) => {
        const i = g.events.findIndex((x) => x.id === decodeURIComponent(c.m[1]));
        if (i < 0) return notFound(res);
        if (req.method === "PATCH") { const x = stamp(Object.assign(g.events[i], c.json())); if (x.recurrence) x.type = "seriesMaster"; return send(res, 200, strip(x)); }
        if (req.method === "DELETE") { g.events.splice(i, 1); return send(res, 204, ""); }
        return send(res, 200, strip(g.events[i]));
    });
    base.route("POST", /^\/graph\/v1\.0\/me\/events$/, (req, res, c) => {
        const x = stamp(Object.assign({ id: id("E"), calendarId: work.id, type: "singleInstance" }, c.json()));
        g.events.push(x);
        return send(res, 201, strip(x));
    });

    base.route("GET", /^\/graph\/v1\.0\/me\/todo\/lists$/, (req, res, c) => send(res, 200, page(req, c, g.lists, P + "/me/todo/lists")));
    base.route("*", /^\/graph\/v1\.0\/me\/todo\/lists\/([^/]+)\/tasks$/, (req, res, c) => {
        const list = g.lists.find((x) => x.id === decodeURIComponent(c.m[1]));
        if (!list) return notFound(res);
        if (req.method === "POST") { const x = stamp(Object.assign({ id: id("T"), listId: list.id, status: "notStarted", importance: "normal" }, c.json())); g.tasks.push(x); return send(res, 201, strip(x)); }
        return send(res, 200, page(req, c, g.tasks.filter((t) => t.listId === list.id).map(strip), c.url.pathname));
    });
    base.route("*", /^\/graph\/v1\.0\/me\/todo\/lists\/([^/]+)\/tasks\/([^/]+)$/, (req, res, c) => {
        const i = g.tasks.findIndex((x) => x.id === decodeURIComponent(c.m[2]) && x.listId === decodeURIComponent(c.m[1]));
        if (i < 0) return notFound(res);
        if (req.method === "PATCH") return send(res, 200, strip(stamp(Object.assign(g.tasks[i], c.json()))));
        if (req.method === "DELETE") { g.tasks.splice(i, 1); return send(res, 204, ""); }
        return send(res, 200, strip(g.tasks[i]));
    });

    g.clients = (withClient) => ({ microsoft: withClient === false ? { graph: base.origin + P }
        : base.clientOf("microsoft", { graph: base.origin + P, revocationEndpoint: undefined }) });
    return g;
}

module.exports = { addGraph };
