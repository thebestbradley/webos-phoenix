// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device service (davservice.js and the sync engine in lib/) against a
// real CardDAV / CalDAV server: Radicale on 127.0.0.1 (pip install radicale;
// the tests are skipped without it), with db8, the accounts service and the
// activity manager faked in memory (test/memdb.cjs). Covers the validator,
// onCreate, the first sync, changes both ways, deletions both ways, recurring
// events with an edited occurrence, the "server wins" conflict rules and a
// server without sync-collection (ctag / etag sync).

import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as synckit from "@phoenix/synckit";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";
import { loadCommonJs } from "../../shared/connector-kit/src/test-support";

const require = createRequire(import.meta.url);
// The service's CommonJS files, with the shared sync layer's sources
// (@phoenix/synckit), as the simulator's loader runs them: no build and
// no node_modules link needed.
const load = (file: string) => loadCommonJs(join(__dirname, file));
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createDavService } = load("davservice.js") as Any;
const { createRequest } = synckit as Any;
const vcard = synckit.vcard as Any;
const ical = synckit.ical as Any;
const { createMemDb, createFakeBus, KIND_PARENTS } = memdb as Any;
const radicale = require("./test/radicale.cjs") as Any;

const TZ = "America/New_York";
const ACCOUNT = "dav-account-1";

const VCARD_ADA = [
    "BEGIN:VCARD", "VERSION:3.0", "UID:ada-1", "N:Palmer;Ada;;;", "FN:Ada Palmer",
    "TEL;TYPE=CELL:(408) 555-0142", "EMAIL;TYPE=INTERNET,HOME:ada@example.com",
    "ADR;TYPE=HOME:;;1 Infinite Loop;Cupertino;CA;95014;USA", "BDAY:1990-12-10", "NOTE:Met at WWDC",
    "PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo=", "CATEGORIES:Friends", "END:VCARD", ""].join("\r\n");
const VCARD_BOB = [
    "BEGIN:VCARD", "VERSION:4.0", "UID:bob-1", "N:Okafor;Bob;;;", "FN:Bob Okafor",
    "TEL;TYPE=work:+1 312 555 0155", "EMAIL;TYPE=work:bob@example.org", "ORG:Northwind;Research", "TITLE:Fellow",
    "END:VCARD", ""].join("\r\n");
const ICS_STANDUP = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:standup-1",
    "DTSTAMP:20260101T000000Z", "DTSTART;TZID=America/Los_Angeles:20260928T093000",
    "DTEND;TZID=America/Los_Angeles:20260928T100000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10",
    "SUMMARY:Stand-up", "LOCATION:Room 4B", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "BEGIN:VEVENT", "UID:standup-1", "DTSTAMP:20260101T000000Z",
    "RECURRENCE-ID;TZID=America/Los_Angeles:20260930T093000", "DTSTART;TZID=America/Los_Angeles:20260930T110000",
    "DTEND;TZID=America/Los_Angeles:20260930T113000", "SUMMARY:Stand-up (moved)", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const ICS_TRIP = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:trip-1", "DTSTAMP:20260101T000000Z",
    "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261013", "SUMMARY:Coastal trip", "DESCRIPTION:Bring boots",
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");

function setup(server: Any, options: Any = {}) {
    const db = createMemDb(KIND_PARENTS);
    const account = {
        _id: ACCOUNT, templateId: "com.webosphoenix.dav", username: server.user,
        capabilityProviders: [{ id: "com.webosphoenix.dav.contacts", capability: "CONTACTS" },
                              { id: "com.webosphoenix.dav.calendar", capability: "CALENDAR" }]
    };
    const bus = createFakeBus({
        db, accounts: { [ACCOUNT]: account },
        credentials: { [ACCOUNT]: { common: { password: server.password, serverUrl: server.url } } }
    });
    const logs: string[] = [];
    const svc = createDavService({
        luna: bus, request: options.request || createRequest(), localTz: TZ, periodicSync: false,
        log: (m: string) => logs.push(m)
    });
    return { db, bus, svc, logs, account };
}

const live = (db: Any, kind: string) => Object.values(db.objects as Record<string, Any>)
    .filter((o: Any) => !o._del && o._kind === kind);
const contacts = (db: Any) => live(db, "com.palm.contact.dav:1");
const events = (db: Any) => live(db, "com.palm.calendarevent.dav:1");
const persons = (db: Any) => live(db, "com.palm.person:1");
const byGiven = (db: Any, given: string) => contacts(db).find((c: Any) => c.name.givenName === given);

describe.skipIf(!radicale.available())("CardDAV and CalDAV sync against Radicale", () => {
    let server: Any;
    let ctx: ReturnType<typeof setup>;

    beforeAll(async () => {
        server = await radicale.start();
        await server.mkAddressbook("contacts", "Contacts");
        await server.mkCalendar("calendar", "Personal");
        await server.put("/alice/contacts/ada-1.vcf", VCARD_ADA);
        await server.put("/alice/contacts/bob-1.vcf", VCARD_BOB);
        await server.put("/alice/calendar/standup-1.ics", ICS_STANDUP);
        await server.put("/alice/calendar/trip-1.ics", ICS_TRIP);
        ctx = setup(server);
    }, 30000);
    afterAll(() => server && server.stop());

    it("validates credentials by discovery (well-known, principal, home sets)", async () => {
        const ok = await ctx.svc.checkCredentials({ username: server.user, password: server.password, config: { serverUrl: server.url } });
        expect(ok.returnValue).toBe(true);
        expect(ok.credentials.common.password).toBe(server.password);
        expect(ok.config).toMatchObject({ serverUrl: server.url + "/", principalUrl: server.url + "/alice/", addressbooks: 1, calendars: 1 });
        const bad = await ctx.svc.checkCredentials({ username: server.user, password: "wrong", config: { serverUrl: server.url } });
        expect(bad).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        const none = await ctx.svc.checkCredentials({ username: "x", password: "y", config: { serverUrl: "http://127.0.0.1:9" } });
        expect(none).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED" });
    });

    it("first sync brings contacts, persons, a calendar and events into db8", async () => {
        expect((await ctx.svc.onCreate({ accountId: ACCOUNT, config: { serverUrl: server.url } })).returnValue).toBe(true);
        const r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.returnValue).toBe(true);
        expect(r.stats).toMatchObject({ collections: 2, contactsChanged: 2, eventsChanged: 2, conflicts: 0, errors: [] });

        const ada = byGiven(ctx.db, "Ada");
        expect(ada).toMatchObject({
            accountId: ACCOUNT, remoteId: server.url + "/alice/contacts/ada-1.vcf",
            name: { familyName: "Palmer", givenName: "Ada" }, birthday: "1990-12-10", note: "Met at WWDC",
            phoneNumbers: [{ value: "(408) 555-0142", type: "type_mobile" }],
            emails: [{ value: "ada@example.com", type: "type_home" }],
            addresses: [{ streetAddress: "1 Infinite Loop", locality: "Cupertino", postalCode: "95014", type: "type_home" }]
        });
        expect(ada.photos[0].value).toBe("data:image/png;base64,iVBORw0KGgo=");
        expect(byGiven(ctx.db, "Bob").organizations[0]).toMatchObject({ name: "Northwind", department: "Research", title: "Fellow" });
        // The Contacts app lists persons: one per contact here.
        expect(persons(ctx.db).map((p: Any) => p.sortKey).sort()).toEqual(["okafor\tbob", "palmer\tada"]);

        const cals = live(ctx.db, "com.palm.calendar.dav:1");
        expect(cals).toHaveLength(1);
        expect(cals[0]).toMatchObject({ accountId: ACCOUNT, name: "Personal", isReadOnly: false });
        const standup = events(ctx.db).find((e: Any) => e.subject === "Stand-up");
        expect(standup).toMatchObject({
            calendarId: cals[0]._id, tzId: "America/Los_Angeles", allDay: false, location: "Room 4B",
            dtstart: Date.UTC(2026, 8, 28, 16, 30), dtend: Date.UTC(2026, 8, 28, 17, 0),
            rrule: { freq: "WEEKLY", count: 10, rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }, { day: 3 }, { day: 5 }] }] },
            alarm: [{ action: "display", alarmTrigger: { value: "-PT15M", valueType: "DURATION" } }],
            exdates: ["20260930T163000Z"]
        });
        const moved = events(ctx.db).find((e: Any) => e.subject === "Stand-up (moved)");
        expect(moved).toMatchObject({ parentId: standup._id, recurrenceId: "20260930T163000Z", dtstart: Date.UTC(2026, 8, 30, 18, 0) });
        const trip = events(ctx.db).find((e: Any) => e.subject === "Coastal trip");
        // All day, three days: local midnight to 23:59:59 of the last day (New York is UTC-4 in October).
        expect(trip).toMatchObject({ allDay: true, note: "Bring boots", dtstart: Date.UTC(2026, 9, 10, 4), dtend: Date.UTC(2026, 9, 13, 3, 59, 59) });
    });

    it("pushes device changes: edits, new contacts and events, deletions", async () => {
        const ada = byGiven(ctx.db, "Ada");
        await ctx.db.merge([{ _id: ada._id, nickname: "Countess", phoneNumbers: [...ada.phoneNumbers, { value: "555-0100", type: "type_work" }] }]);
        await ctx.db.put([{ _kind: "com.palm.contact.dav:1", accountId: ACCOUNT, name: { givenName: "Carol", familyName: "Nguyen" },
                            emails: [{ value: "carol@example.net", type: "type_work" }] }]);
        const cal = live(ctx.db, "com.palm.calendar.dav:1")[0];
        await ctx.db.put([{ _kind: "com.palm.calendarevent.dav:1", accountId: ACCOUNT, calendarId: cal._id, subject: "Dentist",
                            dtstart: Date.UTC(2026, 9, 1, 14), dtend: Date.UTC(2026, 9, 1, 15), tzId: TZ, allDay: false,
                            alarm: [{ action: "display", alarmTrigger: { value: "-PT30M", valueType: "DURATION" } }] }]);
        const trip = events(ctx.db).find((e: Any) => e.subject === "Coastal trip");
        await ctx.db.del([trip._id]);
        const bob = byGiven(ctx.db, "Bob");
        await ctx.db.del([bob._id]);

        const r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats).toMatchObject({ uploaded: { created: 2, modified: 1, deleted: 2 }, conflicts: 0, errors: [] });

        const ada2 = vcard.toContact((await server.get("/alice/contacts/ada-1.vcf")).body);
        expect(ada2.contact.nickname).toBe("Countess");
        expect(ada2.contact.phoneNumbers.map((p: Any) => p.value)).toEqual(["(408) 555-0142", "555-0100"]);
        // What the device has no field for survives the round trip.
        expect((await server.get("/alice/contacts/ada-1.vcf")).body).toContain("CATEGORIES:Friends");
        const cardHrefs = await server.list("/alice/contacts/");
        expect(cardHrefs.some((h: string) => h.endsWith("bob-1.vcf"))).toBe(false);
        const carol = byGiven(ctx.db, "Carol");
        expect(carol.remoteId).toMatch(/\/alice\/contacts\/[0-9a-f-]+\.vcf$/);
        expect(vcard.toContact((await server.get(new URL(carol.remoteId).pathname)).body).contact.emails[0].value).toBe("carol@example.net");
        expect(persons(ctx.db).map((p: Any) => p.sortKey).sort()).toEqual(["nguyen\tcarol", "palmer\tada"]);

        const calHrefs = await server.list("/alice/calendar/");
        expect(calHrefs.some((h: string) => h.endsWith("trip-1.ics"))).toBe(false);
        const dentist = events(ctx.db).find((e: Any) => e.subject === "Dentist");
        const ics = (await server.get(new URL(dentist.remoteId).pathname)).body;
        expect(ics).toContain("DTSTART;TZID=America/New_York:20261001T100000");
        expect(ics).toContain("TRIGGER:-PT30M");
        expect(ical.toEvents(ics, { localTz: TZ }).master).toMatchObject({ subject: "Dentist", dtstart: Date.UTC(2026, 9, 1, 14) });
    });

    it("an occurrence edited on the device goes up as an override", async () => {
        const standup = events(ctx.db).find((e: Any) => e.subject === "Stand-up");
        // What the Calendar app does (EditView.saveEvent with a parentId).
        const rid = "20261002T163000Z";
        await ctx.db.merge([{ _id: standup._id, exdates: [...standup.exdates, rid] }]);
        await ctx.db.put([{ _kind: "com.palm.calendarevent.dav:1", accountId: ACCOUNT, calendarId: standup.calendarId, parentId: standup._id,
                            recurrenceId: rid, subject: "Stand-up (Friday, late)", tzId: "America/Los_Angeles", allDay: false,
                            dtstart: Date.UTC(2026, 9, 2, 20), dtend: Date.UTC(2026, 9, 2, 20, 30) }]);
        const r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats.uploaded.modified).toBe(1);
        const parsed = ical.toEvents((await server.get("/alice/calendar/standup-1.ics")).body, { localTz: TZ });
        expect(parsed.overrides.map((o: Any) => [o.recurrenceId, o.subject]).sort()).toEqual([
            ["20260930T163000Z", "Stand-up (moved)"], ["20261002T163000Z", "Stand-up (Friday, late)"]]);
        // An override is not also an EXDATE on the server.
        expect((await server.get("/alice/calendar/standup-1.ics")).body).not.toContain("EXDATE");
    });

    it("pulls server changes: edits, new resources, deletions", async () => {
        await server.put("/alice/contacts/ada-1.vcf", VCARD_ADA.replace("NOTE:Met at WWDC", "NOTE:Moved to Lisbon"));
        await server.put("/alice/contacts/dan-1.vcf", VCARD_BOB.replace(/bob-1/g, "dan-1").replace("N:Okafor;Bob", "N:Reyes;Dan")
            .replace("FN:Bob Okafor", "FN:Dan Reyes").replace("bob@example.org", "dan@example.org"));
        await server.del("/alice/calendar/standup-1.ics");
        const r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats).toMatchObject({ contactsChanged: 2, eventsRemoved: 1, conflicts: 0 });
        const ada = byGiven(ctx.db, "Ada");
        expect(ada.note).toBe("Moved to Lisbon");
        // The server copy replaced the whole contact: the device's nickname edit was uploaded before, so it is gone now.
        expect(ada.nickname).toBe("");
        expect(byGiven(ctx.db, "Dan").emails[0].value).toBe("dan@example.org");
        expect(events(ctx.db).filter((e: Any) => /Stand-up/.test(e.subject))).toHaveLength(0);
        expect(persons(ctx.db)).toHaveLength(3);
    });

    it("server wins when both sides changed the same contact", async () => {
        const ada = byGiven(ctx.db, "Ada");
        await ctx.db.merge([{ _id: ada._id, note: "Device edit" }]);
        await server.put("/alice/contacts/ada-1.vcf", VCARD_ADA.replace("NOTE:Met at WWDC", "NOTE:Server edit"));
        const r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats.conflicts).toBe(1);
        expect(byGiven(ctx.db, "Ada").note).toBe("Server edit");
        expect(vcard.toContact((await server.get("/alice/contacts/ada-1.vcf")).body).contact.note).toBe("Server edit");
    });

    it("server wins when the etag changed between pull and push (412)", async () => {
        const ada = byGiven(ctx.db, "Ada");
        await ctx.db.merge([{ _id: ada._id, note: "Device edit 2" }]);
        // Someone else writes the card just before the device's PUT reaches the server.
        const inner = createRequest();
        let raced = false;
        const racing = (req: Any) => {
            if (!raced && req.method === "PUT" && req.url.endsWith("/ada-1.vcf")) {
                raced = true;
                return server.put("/alice/contacts/ada-1.vcf", VCARD_ADA.replace("NOTE:Met at WWDC", "NOTE:Raced in")).then(() => inner(req));
            }
            return inner(req);
        };
        const svc = createDavService({ luna: ctx.bus, request: racing, localTz: TZ, periodicSync: false });
        const r = await svc.sync({ accountId: ACCOUNT });
        expect(raced).toBe(true);
        expect(r.stats.conflicts).toBe(1);
        expect(byGiven(ctx.db, "Ada").note).toBe("Raced in");
        expect(vcard.toContact((await server.get("/alice/contacts/ada-1.vcf")).body).contact.note).toBe("Raced in");
    });

    it("a second sync with nothing changed uploads and downloads nothing", async () => {
        const r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats).toMatchObject({ contactsChanged: 0, contactsRemoved: 0, eventsChanged: 0, eventsRemoved: 0,
                                        uploaded: { created: 0, modified: 0, deleted: 0 }, conflicts: 0, errors: [] });
    });

    it("onEnabled(false) and onDelete remove the account's data", async () => {
        expect((await ctx.svc.onEnabled({ accountId: ACCOUNT, capabilityProviderId: "com.webosphoenix.dav.calendar", enabled: false })).returnValue).toBe(true);
        expect(events(ctx.db)).toHaveLength(0);
        expect(live(ctx.db, "com.palm.calendar.dav:1")).toHaveLength(0);
        expect(contacts(ctx.db).length).toBeGreaterThan(0);
        expect((await ctx.svc.onDelete({ accountId: ACCOUNT })).returnValue).toBe(true);
        expect(contacts(ctx.db)).toHaveLength(0);
        expect(persons(ctx.db)).toHaveLength(0);
    });
});

describe.skipIf(!radicale.available())("servers without sync-collection (ctag and etags)", () => {
    let server: Any;
    beforeAll(async () => {
        server = await radicale.start();
        await server.mkAddressbook("contacts");
        await server.mkCalendar("calendar");
        await server.put("/alice/contacts/ada-1.vcf", VCARD_ADA);
    }, 30000);
    afterAll(() => server && server.stop());

    it("syncs both ways by comparing etags", async () => {
        const inner = createRequest();
        const reports: string[] = [];
        // Hide RFC 6578 support, as older servers do.
        const noSync = (req: Any) => {
            if (req.method === "REPORT" && /sync-collection/.test(req.body || "")) reports.push(req.url);
            return inner(req).then((res: Any) => {
                if (req.method === "PROPFIND") {
                    res.body = res.body.replace(/<sync-token>[^<]*<\/sync-token>/g, "")
                        .replace(/<supported-report><report><sync-collection \/><\/report><\/supported-report>/g, "");
                }
                return res;
            });
        };
        const ctx = setup(server, { request: noSync });
        await ctx.svc.onCreate({ accountId: ACCOUNT, config: { serverUrl: server.url + "/alice/" } });
        let r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats).toMatchObject({ contactsChanged: 1, errors: [] });
        const ada = byGiven(ctx.db, "Ada");
        await ctx.db.merge([{ _id: ada._id, note: "Edited offline" }]);
        await server.put("/alice/contacts/bob-1.vcf", VCARD_BOB);
        r = await ctx.svc.sync({ accountId: ACCOUNT });
        expect(r.stats).toMatchObject({ contactsChanged: 1, uploaded: { modified: 1 }, conflicts: 0 });
        expect(vcard.toContact((await server.get("/alice/contacts/ada-1.vcf")).body).contact.note).toBe("Edited offline");
        expect(byGiven(ctx.db, "Bob")).toBeTruthy();
        expect(reports).toEqual([]);
    });
});
