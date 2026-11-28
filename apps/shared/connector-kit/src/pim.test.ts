// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What calendar and task connectors share (pim.ts) and the registered
// providers' helpers (registered.ts).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";
import { alarmBefore, alarmMinutes, allDayDates, allDaySpan, joinUrlOf, meetingNote, plainText, rruleOf, rruleText, syncContainers } from "./pim";
import { notAvailable, oauthOption, oauthSignIn, registeredClient, restApi, viaRelay } from "./registered";

describe("pim", () => {
    it("reads an RRULE into the Calendar app's rrule, and writes it back", () => {
        const r = rruleOf("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T235959Z", { dtstart: Date.UTC(2026, 9, 12, 9), tzId: "UTC" });
        expect(r).toMatchObject({ freq: "WEEKLY", interval: 2, rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }, { day: 3 }] }], until: Date.UTC(2026, 11, 31, 23, 59, 59) });
        expect(rruleText(r, { tzId: "UTC" })).toBe("FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T235959Z;BYDAY=MO,WE");
        expect(rruleOf("FREQ=MONTHLY;BYDAY=-1FR", { dtstart: Date.UTC(2026, 9, 30), tzId: "UTC" })).toMatchObject({ rules: [{ ruleType: "BYDAY", ruleValue: [{ ord: -1, day: 5 }] }] });
        expect(rruleOf("", { dtstart: 0 })).toBeUndefined();
    });

    it("keeps reminders as minutes before the start", () => {
        expect(alarmBefore(15)).toEqual([{ action: "display", alarmTrigger: { valueType: "DURATION", value: "-PT15M" } }]);
        expect(alarmBefore(120)[0].alarmTrigger.value).toBe("-PT2H");
        expect(alarmBefore(2880)[0].alarmTrigger.value).toBe("-P2D");
        expect(alarmBefore(0)[0].alarmTrigger.value).toBe("PT0M");
        expect(alarmBefore(null)).toEqual([]);
        expect(alarmMinutes(alarmBefore(45))).toBe(45);
        expect(alarmMinutes(alarmBefore(0))).toBe(0);
        expect(alarmMinutes([{ alarmTrigger: { valueType: "DATETIME", value: "20261012T080000Z" } }])).toBeNull();
        expect(alarmMinutes([])).toBeNull();
    });

    it("turns all-day spans into the device's days and back", () => {
        const s = allDaySpan("2026-11-26", "2026-11-28", "Europe/Berlin")!;
        expect(new Date(s.dtstart).toISOString()).toBe("2026-11-25T23:00:00.000Z");
        expect(new Date(s.dtend).toISOString()).toBe("2026-11-27T22:59:59.000Z");
        expect(allDayDates(s.dtstart, s.dtend, "Europe/Berlin")).toEqual({ first: "2026-11-26", endExclusive: "2026-11-28" });
    });

    it("finds meeting addresses and puts them first in the note", () => {
        const teams = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0";
        expect(joinUrlOf("Room 4", "Dial in or join: " + teams + " (Teams)")).toBe(teams);
        expect(joinUrlOf("https://us02web.zoom.us/j/81234567890?pwd=abc")).toBe("https://us02web.zoom.us/j/81234567890?pwd=abc");
        expect(joinUrlOf("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
        expect(joinUrlOf("https://meet.jit.si/PhoenixStandup", "nothing")).toBe("https://meet.jit.si/PhoenixStandup");
        expect(joinUrlOf("https://example.com/agenda")).toBe("");
        expect(meetingNote("Agenda", teams, "Microsoft Teams")).toBe("Join Microsoft Teams meeting: " + teams + "\n\nAgenda");
        expect(meetingNote("Join: " + teams, teams, "Microsoft Teams")).toBe("Join: " + teams);
    });

    it("makes text of HTML bodies", () => {
        expect(plainText("<p>Hi &amp; welcome</p><p>Line<br>two</p><style>x{}</style>")).toBe("Hi & welcome\nLine\ntwo");
    });

    it("keeps one db8 object per calendar: new ones put, renamed, gone ones deleted, the user's colour kept", async () => {
        const db = memdb.createMemDb({ "com.palm.calendar.x:1": "com.palm.calendar:1" });
        const ctx: any = { db, accountId: "a1" };
        const kind = "com.palm.calendar.x:1";
        const ids = await syncContainers(ctx, kind, [{ remoteId: "c1", fields: { name: "Work", color: "blue" } }, { remoteId: "c2", fields: { name: "Home", color: "green" } }],
                                         { createOnly: ["color"] });
        await db.merge([{ _id: ids.c1, color: "red" }]);
        const again = await syncContainers(ctx, kind, [{ remoteId: "c1", fields: { name: "Office", color: "blue" } }], { createOnly: ["color"] });
        expect(again).toEqual({ c1: ids.c1 });
        const all = await db.find({ from: kind });
        expect(all.map((c: any) => [c.name, c.color, c.accountId])).toEqual([["Office", "red", "a1"]]);
    });
});

describe("registered providers", () => {
    const ctx = (config: any): any => ({ systemConfig: async () => config, http: { allowHost: () => {}, request: async (r: any) => ({ status: 200, body: JSON.stringify({ url: r.url, auth: r.headers.Authorization }) }) } });

    it("read the registration from the image's setting, or say the provider is not available", async () => {
        expect(await registeredClient(ctx(null), "x/clients.json", "x", { scope: "a" })).toBeNull();
        expect(await registeredClient(ctx({ x: { clientId: "" } }), "x/clients.json", "x", {})).toBeNull();
        expect(await registeredClient(ctx({ x: { clientId: "id1", scope: "b" } }), "x/clients.json", "x", { scope: "a", tokenEndpoint: "t" }))
            .toEqual({ clientId: "id1", scope: "b", tokenEndpoint: "t" });
        const e = notAvailable("Todoist", "Sign In with Todoist") as any;
        expect(e.errorCode).toBe("NOT_AVAILABLE");
        expect(e.message).toBe("Sign In with Todoist is not available in this build: Phoenix's app is not registered with Todoist here (docs/DEVELOPER-APPS.md)");
    });

    it("offer Sign In with the provider when registered; without it, say so only where the page has no other way in", () => {
        expect(oauthOption({ available: true, label: "Sign In with Todoist" }, true)).toEqual({ available: true, label: "Sign In with Todoist" });
        // A token or an app password signs in: no warning, no Sign In with the provider.
        expect(oauthOption({ available: false, reason: "Sign In with Todoist is not available in this build" }, true)).toBeNull();
        // Nothing else signs in: the reason, as before.
        expect(oauthOption({ available: false, reason: "Google is not available in this build" }, false))
            .toEqual({ available: false, reason: "Google is not available in this build" });
    });

    it("go through Phoenix's token relay when the setting says \"relay\": true and the OAuth service has one", async () => {
        const asked: any[] = [];
        const world = (relay: any, setting: any): any => ({
            systemConfig: async () => setting,
            http: { allowHost: () => {} },
            luna: { call: async (uri: string, p: any) => {
                asked.push([uri, p]);
                if (uri.endsWith("/redirectUri")) { if (relay instanceof Error) throw relay; return { returnValue: true, redirectUri: "http://127.0.0.1/oauth/callback", relay }; }
                return { returnValue: true, keyId: "k1" };
            } }
        });
        const defaults = { authorizationEndpoint: "https://account.box.com/api/oauth2/authorize", tokenEndpoint: "https://api.box.com/oauth2/token", scope: "root_readwrite" };
        const relayed = { box: { clientId: "id1", relay: true } };
        const reg = async (ctx: any) => registeredClient(ctx, "drives/clients.json", "box", defaults);
        // No relay asked for, a relay named some other way, or none in this OAuth service: null.
        expect(await viaRelay(world(true, null), await reg(world(true, { box: { clientId: "id1" } })))).toBeNull();
        expect(await viaRelay(world(true, null), await reg(world(true, { box: { clientId: "id1", relay: "https://relay.example/v1/oauth-broker/box" } })))).toBeNull();
        expect(await viaRelay(world(false, null), await reg(world(false, relayed)))).toBeNull();
        expect(await viaRelay(world(undefined, null), await reg(world(undefined, relayed)))).toBeNull();
        expect(await viaRelay(world(new Error("no such method"), null), await reg(world(true, relayed)))).toBeNull();
        expect(await viaRelay(world(true, null), null)).toBeNull();
        // A secret left in the setting is not sent.
        const ctx = world(true, { box: { clientId: "id1", relay: true, clientSecret: "must-not-leave" } });
        const c = await viaRelay(ctx, await reg(ctx));
        expect(c).toMatchObject({ clientId: "id1", relay: "box", scope: "root_readwrite" });
        expect(c!.clientSecret).toBeUndefined();
        expect(await oauthSignIn(ctx, c!)).toBe("k1");
        const req = asked[asked.length - 1];
        expect(req).toEqual(["luna://org.webosphoenix.service.oauth/authorize", expect.objectContaining({ relay: "box", clientId: "id1", redirectUri: "http://127.0.0.1/oauth/callback" })]);
        expect(JSON.stringify(req)).not.toContain("must-not-leave");
    });

    it("call REST APIs with the token", async () => {
        const a = restApi(ctx(null), { base: "https://api.example/v1/", token: async () => "T" });
        expect(await a.get("/items", { q: "a b", n: 2, none: undefined })).toEqual({ url: "https://api.example/v1/items?q=a%20b&n=2", auth: "Bearer T" });
        expect((await a.get("")).url).toBe("https://api.example/v1/");
        expect((await a.get("https://other.example/next?p=2")).url).toBe("https://other.example/next?p=2");
    });
});
