// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for Google's APIs the Google account uses (apps/connectors/google),
// as documented: the OpenID userinfo endpoint (/google/userinfo), Calendar v3
// (/google/calendar/v3: calendarList, events with pageToken and syncToken:
// what changed since, cancelled events among them, 410 Gone for a token
// made invalid), People v1 (/google/people/v1: connections, createContact,
// updateContact with its etag checked, deleteContact) and Tasks v1
// (/google/tasks/v1: lists, tasks, move with destinationTasklist), and
// Google's OAuth (/oauth/google/: a desktop client, PKCE and the
// non-secret secret). fake.google: {calendars, events, people, lists, tasks}

"use strict";

const crypto = require("crypto");

function addGoogle(base) {
    const send = base.send;
    let n = 1;
    const id = (p) => p + (n++).toString(36) + crypto.randomBytes(3).toString("hex");
    const etag = () => "\"" + crypto.randomBytes(5).toString("hex") + "\"";
    let seq = 1;
    const touch = (o) => Object.assign(o, { etag: etag(), updated: new Date().toISOString(), _seq: seq++ });
    const gg = base.google = {
        me: { sub: "109876543210", email: "anna.lee@gmail.example", name: "Anna Lee" },
        calendars: [{ id: "anna.lee@gmail.example", summary: "Anna Lee", accessRole: "owner", primary: true, colorId: "1" },
                    { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays in United States", accessRole: "reader", colorId: "2" }],
        events: [], people: [], lists: [], tasks: [], pageSize: 2, secret: "google-desktop-not-secret", invalidTokens: false
    };
    const ev = (cal, o) => { const e = touch(Object.assign({ id: id("ev"), calendarId: cal, status: "confirmed", kind: "calendar#event" }, o)); gg.events.push(e); return e; };
    gg.meet = ev("anna.lee@gmail.example", { summary: "Design review", start: { dateTime: "2026-10-14T15:00:00Z", timeZone: "Europe/London" }, end: { dateTime: "2026-10-14T16:00:00Z", timeZone: "Europe/London" },
                                              hangoutLink: "https://meet.google.com/abc-defg-hij", description: "<b>Agenda</b><br>Mock-ups", reminders: { useDefault: true },
                                              attendees: [{ email: "bo@gmail.example", displayName: "Bo", responseStatus: "tentative" }], organizer: { email: "anna.lee@gmail.example", displayName: "Anna Lee", self: true } });
    ev("anna.lee@gmail.example", { summary: "Yoga", start: { dateTime: "2026-10-12T17:30:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-12T18:30:00Z", timeZone: "UTC" },
                                   recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8", "EXDATE:20261026T173000Z"], reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] } });
    ev("en.usa#holiday@group.v.calendar.google.com", { summary: "Veterans Day", start: { date: "2026-11-11" }, end: { date: "2026-11-12" }, transparency: "transparent", reminders: { useDefault: false } });
    const person = (o) => { const p = touch(Object.assign({ resourceName: "people/" + id("c") }, o)); gg.people.push(p); return p; };
    person({ names: [{ givenName: "Bo", familyName: "Andersen", displayName: "Bo Andersen" }], emailAddresses: [{ value: "bo@gmail.example", type: "home", metadata: { primary: true } }],
             phoneNumbers: [{ value: "+45 20 12 34 56", type: "mobile" }], birthdays: [{ date: { month: 7, day: 2 } }], organizations: [{ name: "Nordlys", title: "Designer" }] });
    person({ names: [{ givenName: "Chen", familyName: "Wei" }], emailAddresses: [{ value: "chen@gmail.example", type: "work" }], biographies: [{ value: "Climbing partner" }] });
    const lst = (title) => { const l = touch({ id: id("L"), title }); gg.lists.push(l); return l; };
    const mine = lst("My Tasks"), errands = lst("Errands");
    const task = (list, o) => { const t = touch(Object.assign({ id: id("t"), listId: list.id, status: "needsAction" }, o)); gg.tasks.push(t); return t; };
    task(mine, { title: "Renew library card", due: "2026-10-15T00:00:00.000Z", notes: "Bring ID" });
    task(errands, { title: "Pick up dry cleaning" });
    task(mine, { title: "Call mum", status: "completed", completed: "2026-10-10T08:00:00.000Z" });
    gg.touch = touch;

    base.oauthProvider("google", { pkce: true, secret: gg.secret, scope: "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/tasks" });

    const err = (res, code, status, message) => send(res, code, { error: { code, status, message } });
    base.route("*", /^\/google\//, (req, res) => (base.bearer(req, "google") ? false : err(res, 401, "UNAUTHENTICATED", "Request had invalid authentication credentials.")));
    base.route("GET", /^\/google\/userinfo$/, (req, res) => send(res, 200, gg.me));
    const page = (c, list, key, extra) => {
        const size = Math.min(Number(c.query.get("maxResults") || c.query.get("pageSize")) || 100, gg.pageSize || 100);
        const start = Number(c.query.get("pageToken") || 0);
        const out = Object.assign({ [key]: list.slice(start, start + size) }, extra && start + size >= list.length ? extra : {});
        if (start + size < list.length) out.nextPageToken = String(start + size);
        return out;
    };
    const strip = (o) => { const x = Object.assign({}, o); delete x.calendarId; delete x.listId; delete x._seq; return x; };

    // ---- Calendar ----
    base.route("GET", /^\/google\/calendar\/v3\/users\/me\/calendarList$/, (req, res, c) => send(res, 200, page(c, gg.calendars, "items")));
    base.route("*", /^\/google\/calendar\/v3\/calendars\/([^/]+)\/events$/, (req, res, c) => {
        const cal = gg.calendars.find((x) => x.id === decodeURIComponent(c.m[1]));
        if (!cal) return err(res, 404, "NOT_FOUND", "Not Found");
        if (req.method === "POST") {
            if (cal.accessRole === "reader") return err(res, 403, "PERMISSION_DENIED", "Forbidden");
            return send(res, 200, strip(ev(cal.id, c.json())));
        }
        const sync = c.query.get("syncToken");
        let list = gg.events.filter((e) => e.calendarId === cal.id);
        if (sync) {
            if (gg.invalidTokens || !/^s\d+$/.test(sync)) return err(res, 410, "GONE", "Sync token is no longer valid, a full sync is required.");
            const since = Number(sync.slice(1));
            list = list.filter((e) => e._seq > since);
        } else list = list.filter((e) => e.status !== "cancelled");
        return send(res, 200, page(c, list.map(strip), "items", { nextSyncToken: "s" + (seq - 1) }));
    });
    base.route("*", /^\/google\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/, (req, res, c) => {
        const e = gg.events.find((x) => x.calendarId === decodeURIComponent(c.m[1]) && x.id === decodeURIComponent(c.m[2]) && x.status !== "cancelled");
        if (!e) return err(res, 404, "NOT_FOUND", "Not Found");
        if (req.method === "PATCH") return send(res, 200, strip(touch(Object.assign(e, c.json()))));
        if (req.method === "DELETE") { touch(Object.assign(e, { status: "cancelled" })); return send(res, 204, ""); }
        return send(res, 200, strip(e));
    });

    // ---- People ----
    base.route("GET", /^\/google\/people\/v1\/people\/me\/connections$/, (req, res, c) => {
        if (!c.query.get("personFields")) return err(res, 400, "INVALID_ARGUMENT", "personFields mask is required");
        return send(res, 200, page(c, gg.people.map(strip), "connections", { totalPeople: gg.people.length }));
    });
    base.route("POST", /^\/google\/people\/v1\/people:createContact$/, (req, res, c) => send(res, 200, strip(person(c.json()))));
    base.route("*", /^\/google\/people\/v1\/(people\/[^/:]+)(:updateContact|:deleteContact)?$/, (req, res, c) => {
        const p = gg.people.find((x) => x.resourceName === c.m[1]);
        if (!p) return err(res, 404, "NOT_FOUND", "Requested entity was not found.");
        if (c.m[2] === ":updateContact" && req.method === "PATCH") {
            const b = c.json() || {};
            if (b.etag !== p.etag) return err(res, 400, "FAILED_PRECONDITION", "Request person.etag is different than the current person.etag.");
            const fields = String(c.query.get("updatePersonFields") || "").split(",");
            fields.forEach((f) => { if (b[f] !== undefined) p[f] = b[f]; });
            return send(res, 200, strip(touch(p)));
        }
        if (c.m[2] === ":deleteContact" && req.method === "DELETE") { gg.people.splice(gg.people.indexOf(p), 1); return send(res, 200, {}); }
        return send(res, 200, strip(p));
    });

    // ---- Tasks ----
    base.route("GET", /^\/google\/tasks\/v1\/users\/@me\/lists$/, (req, res, c) => send(res, 200, page(c, gg.lists.map(strip), "items")));
    base.route("*", /^\/google\/tasks\/v1\/lists\/([^/]+)\/tasks$/, (req, res, c) => {
        const l = gg.lists.find((x) => x.id === decodeURIComponent(c.m[1]));
        if (!l) return err(res, 404, "NOT_FOUND", "Not Found");
        if (req.method === "POST") return send(res, 200, strip(task(l, c.json())));
        if (c.query.get("showCompleted") !== "true") return err(res, 400, "Test", "the connector must ask for completed tasks too");
        return send(res, 200, page(c, gg.tasks.filter((t) => t.listId === l.id).map(strip), "items"));
    });
    base.route("POST", /^\/google\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/, (req, res, c) => {
        const t = gg.tasks.find((x) => x.listId === decodeURIComponent(c.m[1]) && x.id === decodeURIComponent(c.m[2]));
        if (!t) return err(res, 404, "NOT_FOUND", "Not Found");
        const dest = c.query.get("destinationTasklist");
        if (dest) { if (!gg.lists.some((l) => l.id === dest)) return err(res, 400, "INVALID_ARGUMENT", "Invalid destination"); t.listId = dest; }
        return send(res, 200, strip(touch(t)));
    });
    base.route("*", /^\/google\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/, (req, res, c) => {
        const t = gg.tasks.find((x) => x.listId === decodeURIComponent(c.m[1]) && x.id === decodeURIComponent(c.m[2]));
        if (!t) return err(res, 404, "NOT_FOUND", "Not Found");
        if (req.method === "PATCH") { const b = c.json(); Object.keys(b).forEach((k) => { if (b[k] === null) delete t[k]; else t[k] = b[k]; }); return send(res, 200, strip(touch(t))); }
        if (req.method === "DELETE") { gg.tasks.splice(gg.tasks.indexOf(t), 1); return send(res, 204, ""); }
        return send(res, 200, strip(t));
    });

    gg.clients = (withClient) => {
        const bases = { userinfo: base.origin + "/google/userinfo", calendar: base.origin + "/google/calendar/v3", people: base.origin + "/google/people/v1",
                        tasks: base.origin + "/google/tasks/v1" };
        return { google: withClient === false ? bases : base.clientOf("google", bases) };
    };
    return gg;
}

module.exports = { addGoogle };
