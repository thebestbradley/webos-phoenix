// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The LinkedIn account (connector.js, lib/connections.js) against the
// stand-in for LinkedIn's userinfo and Posts API and its OAuth
// (apps/connectors/testing/linkedin.cjs), over real HTTP: the kit's
// conformance suite; "not available in this build" without the
// registration and its secret (or the relay); Sign In with LinkedIn (OpenID
// Connect); the data export's Connections.csv imported into Contacts,
// linked to the people you have, again and again; Share on LinkedIn.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addLinkedin } = require("../../testing/linkedin.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const CSV = loadCommonJs(join(__dirname, "lib", "connections.js"));
const TEMPLATE = "com.webosphoenix.linkedin";
const K = def.KINDS;
const kindParents = { [K.contact]: "com.palm.contact:1" };

let base: any, li: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    li = addLinkedin(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });

describe("conformance: LinkedIn", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents, minObjects: 0,
        validateParams: { config: { oauthKey: "key-1" } },
        systemConfig: (name: string) => (name === "linkedin/clients.json" ? li.clients(true) : null),
        server: () => { base.unauthorizedAll = false; base.throttleSeconds = 0; return base.conformance(request); },
        handlers: () => ({ "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: base.issue("linkedin").access_token }),
                           "luna://org.webosphoenix.service.oauth/forget": () => ({ returnValue: true }) }),
        share: { content: { text: "Hello from Phoenix", url: "https://example.com/" } }
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("LinkedIn", () => {
    beforeEach(fresh);

    it("reads the export's Connections.csv", () => {
        const list = CSV.readConnections(li.csv);
        expect(list.map((c: any) => c.fields.name.familyName)).toEqual(["Lindqvist", "Okafor", "Tanaka"]);
        expect(list[0]).toEqual({ remoteId: "https://www.linkedin.com/in/sofia-lindqvist", fields: {
            name: { givenName: "Sofia", familyName: "Lindqvist" }, organizations: [{ name: "Uppsala University", title: "Researcher, HCI", type: "type_work" }],
            urls: [{ value: "https://www.linkedin.com/in/sofia-lindqvist", type: "type_profile" }], emails: [{ value: "sofia.lindqvist@example.edu", type: "type_work" }],
            note: "LinkedIn connection since 5 Oct 2024" } });
        expect(list[2].fields.organizations).toEqual([]);
        expect(() => CSV.readConnections("Name,Phone\nA,1\n")).toThrow(/Connections\.csv/);
    });

    it("is not available without the registration and its secret (or the relay)", async () => {
        const w = await world({ dir: DIR, def, config: { "linkedin/clients.json": { linkedin: { clientId: "only-an-id" } } }, kindParents });
        expect((await w.methods.providerInfo({})).oauth).toMatchObject({ available: false, reason: expect.stringMatching(/^LinkedIn is not available in this build/) });
        expect((await w.methods.signIn({})).errorCode).toBe("NOT_AVAILABLE");
    });

    it("signs in with LinkedIn, imports the connections into Contacts, and shares", async () => {
        const w = await world({ dir: DIR, def, config: { "linkedin/clients.json": li.clients(true) }, kindParents });
        const r = await w.methods.signIn({});
        expect(r, JSON.stringify(r)).toMatchObject({ returnValue: true, username: "anna@example.com", config: { userId: "782bbtaQ", name: "Anna Lee" } });
        expect(new URL(w.sheets[0]).searchParams.get("scope")).toBe("openid profile email w_member_social");
        const id = await w.addAccount(TEMPLATE, r);
        await w.enable(id, def.PROVIDER);
        expect((await w.sync(id)).returnValue).toBe(true);
        expect(await w.find(K.contact)).toEqual([]);
        // A contact already on the device: Sofia, from the address book.
        await w.db.put([{ _kind: "com.palm.contact:1", accountId: "", name: { givenName: "Sofia", familyName: "Lindqvist" }, phoneNumbers: [{ value: "555-0101" }] }]);
        const imp = await w.methods.importConnections({ accountId: id, csv: li.csv });
        expect(imp).toMatchObject({ returnValue: true, imported: 3 });
        await w.sync(id);
        const contacts = await w.find(K.contact);
        expect(contacts.length).toBe(3);
        expect(contacts.find((c: any) => c.name.familyName === "Okafor")).toMatchObject({ organizations: [{ name: "Northwind Labs", title: "Engineering Manager" }] });
        // A file that is not the export: refused, nothing changed.
        expect((await w.methods.importConnections({ accountId: id, path: "/media/internal/notes.txt" })).returnValue).toBe(false);
        // Imported again with one fewer: that one goes.
        await w.methods.importConnections({ accountId: id, csv: li.csv.split("\r\n").filter((l: string) => !/^Mei,/.test(l)).join("\r\n") });
        await w.sync(id);
        expect((await w.find(K.contact)).map((c: any) => c.name.familyName).sort()).toEqual(["Lindqvist", "Okafor"]);
        // Shared to LinkedIn.
        const s = await w.methods.share({ accountId: id, content: { title: "Phoenix", text: "Our new release", url: "https://example.org/phoenix" }, audience: "CONNECTIONS", idempotencyKey: "k" });
        expect(s).toMatchObject({ returnValue: true, url: expect.stringMatching(/^https:\/\/www\.linkedin\.com\/feed\/update\/urn%3Ali%3Ashare%3A/) });
        expect(li.posts[0]).toMatchObject({ author: "urn:li:person:782bbtaQ", commentary: "Our new release", visibility: "CONNECTIONS",
                                            content: { article: { source: "https://example.org/phoenix", title: "Phoenix" } } });
        // The sign-in expired (60 days): the sync says so.
        base.expireTokens();
        const exp = await w.sync(id);
        expect(exp).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
    });
});
