// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Google account (connector.js, lib/google.js) against the stand-in for
// Google's userinfo, Calendar, People and Tasks APIs and its OAuth
// (apps/connectors/testing/google.cjs), over real HTTP: the kit's
// conformance suite; "not available in this build" without Phoenix's
// registration, the sign-in with it (PKCE with the desktop client's
// non-secret secret, a refresh token asked for); contacts, calendars (a
// Meet's address, a weekly repeat with an exception, an all-day holiday in
// a read-only calendar; after the first listing only what changed, and a
// full listing again when the sync token is refused) and tasks, both ways.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addGoogle } = require("../../testing/google.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const TEMPLATE = "com.webosphoenix.google";
const K = def.KINDS, P = def.PROVIDERS;
const kindParents = { [K.contact]: "com.palm.contact:1", [K.calendar]: "com.palm.calendar:1", [K.event]: "com.palm.calendarevent:1",
                      [K.list]: "com.palm.tasklist:1", [K.task]: "com.palm.task:1" };

let base: any, gg: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    gg = addGoogle(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });
const config = (withClient = true) => ({ "google/clients.json": gg.clients(withClient) });

describe("conformance: Google", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents,
        validateParams: { config: { oauthKey: "key-1" } },
        systemConfig: (name: string) => (name === "google/clients.json" ? gg.clients(true) : null),
        server: () => {
            base.unauthorizedAll = false; base.throttleSeconds = 0;
            const s = base.conformance(request);
            s.editRemote = (remoteId: string, field: string, value: any) => {
                const t = gg.tasks.find((x: any) => x.id === remoteId);
                gg.touch(Object.assign(t, field === "summary" ? { title: value } : { [field]: value }));
            };
            return s;
        },
        handlers: () => ({ "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: base.issue("google").access_token }),
                           "luna://org.webosphoenix.service.oauth/forget": () => ({ returnValue: true }) }),
        conflict: { providerId: P.tasks, field: "summary", localValue: "Edited on the phone", remoteValue: "Edited in Google Tasks" }
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("Google", () => {
    beforeEach(fresh);

    async function signedIn() {
        const w = await world({ dir: DIR, def, config: config(true), kindParents });
        const r = await w.methods.signIn({});
        expect(r, JSON.stringify(r)).toMatchObject({ returnValue: true, username: "anna.lee@gmail.example" });
        const id = await w.addAccount(TEMPLATE, r);
        return { w, id };
    }

    it("is not available in this build without Phoenix's registration; signs in with it", async () => {
        const w0 = await world({ dir: DIR, def, config: config(false), kindParents });
        expect((await w0.methods.providerInfo({})).oauth.reason).toBe("Google is not available in this build: Phoenix's app is not registered with Google here (docs/DEVELOPER-APPS.md)");
        expect((await w0.methods.signIn({})).errorCode).toBe("NOT_AVAILABLE");
        const { w } = await signedIn();
        const q = new URL(w.sheets[0]).searchParams;
        expect(q.get("access_type")).toBe("offline");
        expect(q.get("scope")).toContain("https://www.googleapis.com/auth/calendar");
        expect(q.get("scope")).toContain("https://www.googleapis.com/auth/contacts");
        expect(q.get("scope")).toContain("https://www.googleapis.com/auth/tasks");
    });

    it("brings contacts, both ways", async () => {
        const { w, id } = await signedIn();
        await w.enable(id, P.contacts);
        expect((await w.sync(id)).returnValue).toBe(true);
        const bo = (await w.find(K.contact)).find((c: any) => c.name.familyName === "Andersen");
        expect(bo).toMatchObject({ birthday: "0000-07-02", emails: [{ value: "bo@gmail.example", type: "type_home", primary: true }],
                                   phoneNumbers: [{ value: "+45 20 12 34 56", type: "type_mobile" }], organizations: [{ name: "Nordlys", title: "Designer" }] });
        await w.db.merge([{ _id: bo._id, note: "Met in Aarhus" }]);
        await w.db.put([{ _kind: K.contact, accountId: id, name: { givenName: "Dana", familyName: "Ruiz" }, phoneNumbers: [{ value: "555-0199", type: "type_work" }] }]);
        const r = await w.sync(id);
        expect(r.stats[P.contacts].pushed).toMatchObject({ created: 1, updated: 1 });
        expect(gg.people.find((p: any) => p.names[0].familyName === "Andersen").biographies).toEqual([{ value: "Met in Aarhus", contentType: "TEXT_PLAIN" }]);
        expect(gg.people.find((p: any) => p.names[0].familyName === "Ruiz").phoneNumbers).toEqual([{ value: "555-0199", type: "work" }]);
    });

    it("brings calendars: a Meet's address, a repeat with an exception, an all-day holiday; then only what changed", async () => {
        const { w, id } = await signedIn();
        await w.enable(id, P.calendar);
        const s1 = await w.sync(id);
        expect(s1.returnValue, JSON.stringify(s1)).toBe(true);
        const cals = await w.find(K.calendar);
        expect(cals.map((c: any) => [c.name, c.isReadOnly])).toEqual([["Anna Lee", false], ["Holidays in United States", true]]);
        let events = await w.find(K.event);
        const review = events.find((e: any) => e.subject === "Design review");
        expect(review).toMatchObject({ url: "https://meet.google.com/abc-defg-hij", dtstart: Date.UTC(2026, 9, 14, 15), tzId: "Europe/London",
                                       alarm: [{ action: "display", alarmTrigger: { valueType: "DURATION", value: "-PT10M" } }] });
        expect(review.note).toBe("Join Google Meet meeting: https://meet.google.com/abc-defg-hij\n\nAgenda\nMock-ups");
        expect(review.attendees.map((a: any) => [a.email, a.organizer, a.participationStatus || ""])).toEqual([["anna.lee@gmail.example", true, ""], ["bo@gmail.example", false, "TENTATIVE"]]);
        const yoga = events.find((e: any) => e.subject === "Yoga");
        expect(yoga.rrule).toMatchObject({ freq: "WEEKLY", count: 8, rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }] }] });
        expect(yoga.exdates).toEqual(["20261026T173000Z"]);
        expect(yoga.alarm[0].alarmTrigger.value).toBe("-PT30M");
        expect(events.find((e: any) => e.subject === "Veterans Day")).toMatchObject({ allDay: true, transp: "TRANSPARENT", alarm: [] });

        // Changed on Google: one event edited, one deleted; only those come.
        const before = base.requests.length;
        gg.touch(Object.assign(gg.meet, { summary: "Design review (moved)" }));
        gg.touch(Object.assign(gg.events.find((e: any) => e.summary === "Yoga"), { status: "cancelled" }));
        const s2 = await w.sync(id);
        expect(s2.stats[P.calendar]).toMatchObject({ updated: 1, deleted: 1, created: 0 });
        expect(base.requests.slice(before).filter((q: any) => /\/events$/.test(q.path)).every((q: any) => /syncToken=s\d+/.test(q.query))).toBe(true);
        events = await w.find(K.event);
        expect(events.map((e: any) => e.subject).sort()).toEqual(["Design review (moved)", "Veterans Day"]);
        // A refused sync token: everything listed again, nothing lost.
        gg.invalidTokens = true;
        const s3 = await w.sync(id);
        gg.invalidTokens = false;
        expect(s3.returnValue, JSON.stringify(s3)).toBe(true);
        expect((await w.find(K.event)).length).toBe(2);

        // From the device: a new event in the primary calendar; one in the read-only calendar is refused there and kept here.
        await w.db.put([{ _kind: K.event, accountId: id, calendarId: cals[0]._id, subject: "Haircut", allDay: false, tzId: "Europe/London",
                          dtstart: Date.UTC(2026, 9, 16, 9), dtend: Date.UTC(2026, 9, 16, 10), alarm: [] }]);
        const s4 = await w.sync(id);
        expect(s4.stats[P.calendar].pushed.created).toBe(1);
        expect(gg.events.find((e: any) => e.summary === "Haircut")).toMatchObject({ calendarId: "anna.lee@gmail.example",
            start: { dateTime: "2026-10-16T09:00:00.000Z", timeZone: "Europe/London" }, reminders: { useDefault: false, overrides: [] } });
    });

    it("brings Google Tasks, both ways, a task moved to another list keeping its id", async () => {
        const { w, id } = await signedIn();
        await w.enable(id, P.tasks);
        expect((await w.sync(id)).returnValue).toBe(true);
        const lists = await w.find(K.list);
        expect(lists.map((l: any) => l.name)).toEqual(["My Tasks", "Errands"]);
        const card = (await w.find(K.task)).find((t: any) => t.summary === "Renew library card");
        expect(card).toMatchObject({ allDay: true, due: new Date(2026, 9, 15).getTime(), notes: "Bring ID", listId: lists[0]._id });
        await w.db.merge([{ _id: card._id, listId: lists[1]._id, completed: true, completedTime: Date.UTC(2026, 9, 12) }]);
        const r = await w.sync(id);
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        const moved = gg.tasks.find((t: any) => t.title === "Renew library card");
        expect(moved).toMatchObject({ listId: gg.lists[1].id, status: "completed" });
        await w.sync(id);
        expect((await w.find(K.task)).filter((t: any) => t.summary === "Renew library card").map((t: any) => t._id)).toEqual([card._id]);
    });
});
