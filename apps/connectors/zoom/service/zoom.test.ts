// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Zoom account (connector.js) against the stand-in for Zoom's API and
// OAuth (apps/connectors/testing/zoom.cjs), over real HTTP: the kit's
// conformance suite; "not available in this build" without Phoenix's
// registration (a client id alone is not enough: Zoom wants the secret or
// the relay); upcoming meetings in a read-only "Zoom" calendar with where
// to join, a recurring meeting's occurrences one by one; a meeting
// scheduled through createMeeting (the Assistant's) shows in Calendar.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addZoom } = require("../../testing/zoom.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const TEMPLATE = "com.webosphoenix.zoom";
const K = def.KINDS;
const kindParents = { [K.calendar]: "com.palm.calendar:1", [K.event]: "com.palm.calendarevent:1" };

let base: any, z: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    z = addZoom(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });

describe("conformance: Zoom", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents,
        validateParams: { config: { oauthKey: "key-1" } },
        systemConfig: (name: string) => (name === "zoom/clients.json" ? z.clients(true) : null),
        server: () => { base.unauthorizedAll = false; base.throttleSeconds = 0; return base.conformance(request); },
        handlers: () => ({ "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: base.issue("zoom").access_token }),
                           "luna://org.webosphoenix.service.oauth/forget": () => ({ returnValue: true }) })
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("Zoom", () => {
    beforeEach(fresh);

    it("is not available without Phoenix's registration and its secret (or the relay)", async () => {
        for (const cfg of [null, { zoom: { clientId: "id-only" } }]) {
            const w = await world({ dir: DIR, def, config: { "zoom/clients.json": cfg }, kindParents });
            const info = await w.methods.providerInfo({});
            expect(info.oauth.available).toBe(false);
            expect(info.oauth.reason).toMatch(/^Zoom is not available in this build/);
            expect((await w.methods.signIn({})).errorCode).toBe("NOT_AVAILABLE");
        }
    });

    it("puts upcoming meetings in a Zoom calendar with where to join; a meeting scheduled here shows too", async () => {
        const w = await world({ dir: DIR, def, config: { "zoom/clients.json": z.clients(true) }, kindParents });
        const r = await w.methods.signIn({});
        expect(r, JSON.stringify(r)).toMatchObject({ returnValue: true, username: "anna@example.com" });
        expect(new URL(w.sheets[0]).searchParams.get("scope")).toBe("user:read:user meeting:read:list_meetings meeting:read:meeting meeting:write:meeting");
        const id = await w.addAccount(TEMPLATE, r);
        await w.enable(id, def.PROVIDER);
        expect((await w.sync(id)).returnValue).toBe(true);
        const cals = await w.find(K.calendar);
        expect(cals).toMatchObject([{ name: "Zoom", isReadOnly: true }]);
        const events = await w.find(K.event);
        expect(events.map((e: any) => e.subject).sort()).toEqual(["Book club", "Book club", "Client kickoff"]);
        const kick = events.find((e: any) => e.subject === "Client kickoff");
        expect(kick).toMatchObject({ dtstart: Date.UTC(2026, 9, 15, 13), dtend: Date.UTC(2026, 9, 15, 13, 45), location: "Zoom", calendarId: cals[0]._id,
                                     url: z.meetings[0].join_url, joinUrl: z.meetings[0].join_url });
        expect(kick.note).toBe("Join Zoom meeting: " + z.meetings[0].join_url + "\n\nScope and timeline");
        expect(events.filter((e: any) => e.subject === "Book club").map((e: any) => e.dtstart).sort())
            .toEqual([Date.UTC(2026, 9, 16, 18), Date.UTC(2026, 9, 30, 18)]);
        const made = await w.methods.createMeeting({ accountId: id, topic: "Call with Sam", start: Date.UTC(2026, 9, 20, 15), duration: 20 });
        expect(made).toMatchObject({ returnValue: true, joinUrl: expect.stringMatching(/^https:\/\/us02web\.zoom\.us\/j\//) });
        await w.sync(id);
        expect((await w.find(K.event)).find((e: any) => e.subject === "Call with Sam")).toMatchObject({ dtend: Date.UTC(2026, 9, 20, 15, 20) });
        expect((await w.methods.createMeeting({ accountId: id, topic: "No time" })).returnValue).toBe(false);
    });
});
