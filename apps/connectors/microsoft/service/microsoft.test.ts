// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Microsoft account (connector.js, lib/msgraph.js) against the stand-in
// for Microsoft Graph and its sign-in (apps/connectors/testing/graph.cjs),
// over real HTTP: the kit's conformance suite; "not available in this
// build" without Phoenix's registration, and one sign-in with it (PKCE,
// the token in the key store); contacts, calendars (a Teams meeting's join
// address, a weekly repeat, an all-day holiday in a read-only calendar)
// and To Do lists, both ways.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addGraph } = require("../../testing/graph.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const G = loadCommonJs(join(__dirname, "lib", "msgraph.js"));
const TEMPLATE = "com.webosphoenix.microsoft";
const K = def.KINDS, P = def.PROVIDERS;
const kindParents = { [K.contact]: "com.palm.contact:1", [K.calendar]: "com.palm.calendar:1", [K.event]: "com.palm.calendarevent:1",
                      [K.list]: "com.palm.tasklist:1", [K.task]: "com.palm.task:1" };

let base: any, g: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    g = addGraph(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });
const config = (withClient = true) => ({ "microsoft/clients.json": g.clients(withClient) });

describe("conformance: Microsoft", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents,
        validateParams: { config: { oauthKey: "key-1" } },
        systemConfig: (name: string) => (name === "microsoft/clients.json" ? g.clients(true) : null),
        server: () => {
            base.unauthorizedAll = false; base.throttleSeconds = 0;
            const s = base.conformance(request);
            s.editRemote = (remoteId: string, field: string, value: any) => {
                const t = g.tasks.find((x: any) => remoteId.endsWith("/" + x.id));
                g.edit(null, t, field === "summary" ? { title: value } : { [field]: value });
            };
            return s;
        },
        // The OAuth service's token for the account's key: one the fake issued.
        handlers: () => ({ "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: base.issue("microsoft").access_token }),
                           "luna://org.webosphoenix.service.oauth/forget": () => ({ returnValue: true }) }),
        conflict: { providerId: P.tasks, field: "summary", localValue: "Edited on the phone", remoteValue: "Edited in To Do" }
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("Microsoft", () => {
    beforeEach(fresh);

    it("is not available in this build without Phoenix's registration", async () => {
        const w = await world({ dir: DIR, def, config: config(false), kindParents });
        const info = await w.methods.providerInfo({});
        expect(info.oauth.available).toBe(false);
        expect(info.oauth.reason).toBe("Microsoft is not available in this build: Phoenix's app is not registered with Microsoft here (docs/DEVELOPER-APPS.md)");
        expect(await w.methods.signIn({})).toMatchObject({ returnValue: false, errorCode: "NOT_AVAILABLE" });
    });

    async function signedIn() {
        const w = await world({ dir: DIR, def, config: config(true), kindParents });
        const r = await w.methods.signIn({});
        expect(r, JSON.stringify(r)).toMatchObject({ returnValue: true, username: "anna@contoso.example" });
        const id = await w.addAccount(TEMPLATE, r);
        return { w, id, r };
    }

    it("signs in once on Microsoft's page (PKCE), the token kept in the key store", async () => {
        const { w, r } = await signedIn();
        expect(w.sheets[0]).toMatch(/\/oauth\/microsoft\/authorize\?/);
        const q = new URL(w.sheets[0]).searchParams;
        expect(q.get("code_challenge_method")).toBe("S256");
        expect(q.get("prompt")).toBe("select_account");
        expect(q.get("scope")!.split(" ")).toEqual(expect.arrayContaining(["offline_access", "Contacts.ReadWrite", "Calendars.ReadWrite", "Tasks.ReadWrite"]));
        expect(Object.keys(r.credentials.common)).toEqual(["oauthKey"]);
        expect(JSON.stringify(r)).not.toMatch(/at-microsoft/);
    });

    it("brings contacts, both ways", async () => {
        const { w, id } = await signedIn();
        await w.enable(id, P.contacts);
        expect((await w.sync(id)).returnValue).toBe(true);
        const contacts = await w.find(K.contact);
        const megan = contacts.find((c: any) => c.name.familyName === "Bowen");
        expect(megan).toMatchObject({
            name: { givenName: "Megan", familyName: "Bowen" }, birthday: "1990-05-14", note: "Met at Build",
            emails: [{ value: "megan@contoso.example", type: "type_other", primary: true }],
            phoneNumbers: [{ value: "+1 425 555 0109", type: "type_work" }, { value: "+1 425 555 0110", type: "type_mobile" }],
            organizations: [{ name: "Contoso", title: "Marketing Manager", type: "type_work" }],
            addresses: [{ streetAddress: "1 Microsoft Way", locality: "Redmond", region: "WA", postalCode: "98052", country: "USA", type: "type_work" }]
        });
        expect(contacts.find((c: any) => c.organizations[0] && c.organizations[0].name === "Contoso" && !c.name.givenName)).toBeTruthy();
        // From the device: a new contact, an edit.
        await w.db.put([{ _kind: K.contact, accountId: id, name: { givenName: "Isaiah", familyName: "Langer" }, emails: [{ value: "isaiah@contoso.example" }],
                          phoneNumbers: [{ value: "+1 555 0001", type: "type_mobile" }] }]);
        await w.db.merge([{ _id: megan._id, note: "Met at Build 2026" }]);
        const r = await w.sync(id);
        expect(r.stats[P.contacts].pushed).toMatchObject({ created: 1, updated: 1 });
        expect(g.contacts.find((c: any) => c.surname === "Langer")).toMatchObject({ givenName: "Isaiah", mobilePhone: "+1 555 0001", emailAddresses: [{ address: "isaiah@contoso.example" }] });
        expect(g.contacts.find((c: any) => c.surname === "Bowen").personalNotes).toBe("Met at Build 2026");
        // Each contact from the server has a person (the linker); the one made on the device has the Contacts app's.
        expect((await w.find("com.palm.person:1")).length).toBe(3);
    });

    it("brings calendars and events: a Teams meeting with where to join, a weekly repeat, an all-day holiday", async () => {
        const { w, id } = await signedIn();
        await w.enable(id, P.calendar);
        const s = await w.sync(id);
        expect(s.returnValue, JSON.stringify(s)).toBe(true);
        const cals = await w.find(K.calendar);
        expect(cals.map((c: any) => [c.name, c.isReadOnly, c.color])).toEqual([["Calendar", false, "blue"], ["United States holidays", true, "green"]]);
        const events = await w.find(K.event);
        const teams = events.find((e: any) => e.subject === "Project sync");
        expect(teams).toMatchObject({ dtstart: Date.UTC(2026, 9, 13, 16), dtend: Date.UTC(2026, 9, 13, 16, 30), allDay: false,
                                      url: g.teams.onlineMeeting.joinUrl, joinUrl: g.teams.onlineMeeting.joinUrl,
                                      alarm: [{ action: "display", alarmTrigger: { valueType: "DURATION", value: "-PT15M" } }] });
        expect(teams.note).toBe("Join Microsoft Teams meeting: " + g.teams.onlineMeeting.joinUrl + "\n\nWeekly status.");
        expect(teams.attendees).toEqual([{ email: "megan@contoso.example", commonName: "Megan Bowen", organizer: true },
                                         { email: "anna@contoso.example", commonName: "Anna Lee", organizer: false, participationStatus: "ACCEPTED", role: "REQ-PARTICIPANT" }]);
        const standup = events.find((e: any) => e.subject === "Standup");
        expect(standup.rrule).toMatchObject({ freq: "WEEKLY", rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }, { day: 3 }, { day: 5 }] }] });
        expect(new Date(standup.rrule.until).toISOString().slice(0, 10)).toBe("2026-12-18");
        const thanks = events.find((e: any) => e.subject === "Thanksgiving Day");
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(thanks).toMatchObject({ allDay: true, alarm: [], transp: "TRANSPARENT", calendarId: cals[1]._id, tzId: tz });
        expect(new Date(thanks.dtstart).getDate()).toBe(26);
        // Times in UTC were asked for every time.
        expect(g.preferSeen.every((p: string) => /outlook\.timezone="UTC"/.test(p))).toBe(true);

        // From the device: a new event with a repeat, a moved one, a deleted one.
        await w.db.put([{ _kind: K.event, accountId: id, calendarId: cals[0]._id, subject: "Dentist", location: "Main St", note: "", allDay: false,
                          dtstart: Date.UTC(2026, 9, 20, 7), dtend: Date.UTC(2026, 9, 20, 8), tzId: "UTC",
                          rrule: { freq: "MONTHLY", interval: 1, count: 3 }, alarm: [{ action: "display", alarmTrigger: { valueType: "DURATION", value: "-PT1H" } }] }]);
        await w.db.merge([{ _id: teams._id, dtstart: Date.UTC(2026, 9, 13, 17), dtend: Date.UTC(2026, 9, 13, 17, 30) }]);
        await w.db.del([standup._id]);
        const r = await w.sync(id);
        expect(r.stats[P.calendar].pushed).toEqual({ created: 1, updated: 1, deleted: 1 });
        const dentist = g.events.find((e: any) => e.subject === "Dentist");
        expect(dentist).toMatchObject({ start: { dateTime: "2026-10-20T07:00:00.000", timeZone: "UTC" }, reminderMinutesBeforeStart: 60, isReminderOn: true,
                                        recurrence: { pattern: { type: "absoluteMonthly", dayOfMonth: 20, interval: 1 }, range: { type: "numbered", numberOfOccurrences: 3 } } });
        expect(g.events.find((e: any) => e.subject === "Project sync").start.dateTime).toBe("2026-10-13T17:00:00.000");
        expect(g.events.find((e: any) => e.subject === "Standup")).toBeUndefined();
        // Calendar off: the account's calendars and events go.
        await w.enable(id, P.calendar, false);
        expect(await w.find(K.event)).toEqual([]);
        expect(await w.find(K.calendar)).toEqual([]);
    });

    it("brings Microsoft To Do's lists and tasks, both ways", async () => {
        const { w, id } = await signedIn();
        await w.enable(id, P.tasks);
        expect((await w.sync(id)).returnValue).toBe(true);
        const lists = await w.find(K.list);
        expect(lists.map((l: any) => l.name)).toEqual(["To Do: Tasks", "Shopping"]);
        expect(lists.every((l: any) => l.taskKind === K.task)).toBe(true);
        const tasks = await w.find(K.task);
        const slides = tasks.find((t: any) => t.summary === "Send the slides");
        expect(slides).toMatchObject({ priority: 1, allDay: true, due: new Date(2026, 9, 14).getTime(), completed: false, listId: lists[0]._id });
        expect(tasks.find((t: any) => t.summary === "Book the venue")).toMatchObject({ completed: true, completedTime: Date.UTC(2026, 9, 9, 10) });
        await w.db.put([{ _kind: K.task, accountId: id, listId: lists[1]._id, summary: "Milk", notes: "Oat", completed: false, priority: 0 }]);
        await w.db.merge([{ _id: slides._id, completed: true, completedTime: Date.UTC(2026, 9, 12, 9) }]);
        const r = await w.sync(id);
        expect(r.stats[P.tasks].pushed).toMatchObject({ created: 1, updated: 1 });
        expect(g.tasks.find((t: any) => t.title === "Milk")).toMatchObject({ listId: g.lists[1].id, body: { content: "Oat" }, importance: "normal" });
        expect(g.tasks.find((t: any) => t.title === "Send the slides")).toMatchObject({ status: "completed" });
        // A task moved to another list: made there, deleted here.
        const coffee = (await w.find(K.task)).find((t: any) => t.summary === "Coffee beans");
        await w.db.merge([{ _id: coffee._id, listId: lists[0]._id }]);
        await w.sync(id);
        expect(g.tasks.filter((t: any) => t.title === "Coffee beans").map((t: any) => t.listId)).toEqual([g.lists[0].id]);
        await w.sync(id);
        expect((await w.find(K.task)).filter((t: any) => t.summary === "Coffee beans").map((t: any) => t.listId)).toEqual([lists[0]._id]);
    });

    it("maps Outlook's repeats both ways", () => {
        const weekly = { pattern: { type: "weekly", interval: 2, daysOfWeek: ["tuesday", "thursday"] }, range: { type: "numbered", numberOfOccurrences: 10, startDate: "2026-10-13" } };
        expect(G.rruleOfPattern(weekly, false)).toBe("FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2;COUNT=10");
        expect(G.rruleOfPattern({ pattern: { type: "relativeMonthly", interval: 1, daysOfWeek: ["monday"], index: "last" }, range: { type: "noEnd" } }, false))
            .toBe("FREQ=MONTHLY;BYDAY=-1MO");
        expect(G.rruleOfPattern({ pattern: { type: "absoluteYearly", interval: 1, month: 3, dayOfMonth: 14 }, range: { type: "noEnd" } }, true))
            .toBe("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14");
        expect(G.patternOf({ freq: "MONTHLY", rules: [{ ruleType: "BYDAY", ruleValue: [{ ord: -1, day: 1 }] }] }, "2026-10-26", "UTC"))
            .toEqual({ pattern: { interval: 1, type: "relativeMonthly", daysOfWeek: ["monday"], index: "last" }, range: { startDate: "2026-10-26", recurrenceTimeZone: "UTC", type: "noEnd" } });
    });
});
