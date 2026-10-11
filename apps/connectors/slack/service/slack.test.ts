// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Slack account (connector.js) against the stand-in for Slack's Web API
// (apps/connectors/testing/slack.cjs), over real HTTP, with a user token as
// the token relay would give one: the kit's conformance suite; "not
// available in this build" (no relay); the workspace's people in Contacts;
// direct messages and channels in Messaging, one conversation's history per
// sync outside the Slack Marketplace, a mention notified; a reply from
// Messaging posted to its conversation.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addSlack } = require("../../testing/slack.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const TEMPLATE = "com.webosphoenix.slack";
const K = def.KINDS, P = def.PROVIDERS;
const kindParents = { [K.contact]: "com.palm.contact:1", [K.message]: "com.palm.immessage:1" };

let base: any, sl: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    sl = addSlack(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });
// The OAuth service's token for the account's key: the user token the relay gave.
const tokenHandler = () => ({ "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: sl.token }),
                              "luna://org.webosphoenix.service.oauth/forget": () => ({ returnValue: true }) });

describe("conformance: Slack", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents,
        validateParams: { config: { oauthKey: "key-1" } },
        // Listed in the Slack Marketplace: every conversation each sync (the suite's second sync changes nothing).
        systemConfig: (name: string) => (name === "slack/clients.json" ? { slack: Object.assign(sl.clients().slack, { marketplace: true }) } : null),
        server: () => { base.unauthorizedAll = false; base.throttleSeconds = 0; sl.marketplace = true; return base.conformance(request); },
        handlers: tokenHandler
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("Slack", () => {
    beforeEach(fresh);

    it("is not available in this build: its sign-in needs Phoenix's token relay", async () => {
        const w = await world({ dir: DIR, def, config: { "slack/clients.json": { slack: { clientId: "123.456" } } }, kindParents });
        const info = await w.methods.providerInfo({});
        expect(info.oauth).toMatchObject({ available: false, reason: expect.stringMatching(/token relay/) });
        expect((await w.methods.signIn({})).errorCode).toBe("NOT_AVAILABLE");
        expect(def.OAUTH.params.user_scope).toContain("im:history");
    });

    it("brings the workspace's people, and messages one conversation a sync outside the Marketplace", async () => {
        const w = await world({ dir: DIR, def, config: { "slack/clients.json": sl.clients() }, kindParents, handlers: tokenHandler() });
        const r = await w.methods.checkCredentials({ templateId: TEMPLATE, config: { oauthKey: "k1" } });
        expect(r).toMatchObject({ returnValue: true, username: "anna@Phoenix Makers", config: { userId: "U0ANNA", teamName: "Phoenix Makers" } });
        const id = await w.addAccount(TEMPLATE, r);
        await w.enable(id, P.contacts);
        await w.enable(id, P.messaging);
        const s1 = await w.sync(id);
        expect(s1.returnValue, JSON.stringify(s1)).toBe(true);
        const people = await w.find(K.contact);
        expect(people.map((c: any) => c.name.givenName + " " + c.name.familyName).sort()).toEqual(["Anna Lee", "Kim ", "Raj Patel"]);
        expect(people.find((c: any) => c.name.familyName === "Patel")).toMatchObject({ nickname: "@raj", emails: [{ value: "raj@example.com" }],
                                                                                      organizations: [{ name: "Phoenix Makers", title: "Designer" }] });
        expect(s1.stats[P.messaging]).toMatchObject({ conversations: 2, read: 1 });
        await w.sync(id);
        let msgs = await w.find(K.message);
        expect(msgs.map((m: any) => [m.from.addr, m.messageText]).sort()).toEqual([
            ["#general@T0PHX", "Kim: Release notes are up: notes (https://example.org/notes)"], ["raj@T0PHX", "Morning! Did the build pass?"]]);
        expect(w.toasts).toEqual([]);
        // A minute on: Raj writes again, and Kim mentions Anna in #general.
        sl.say("D0RAJ", "U0RAJ", "Ping me when it's green");
        sl.say("C0GEN", "U0KIM", "<@U0ANNA> can you review?");
        sl.historyCalls = {};
        await w.sync(id);
        await w.sync(id);
        msgs = await w.find(K.message);
        expect(msgs.length).toBe(4);
        expect(w.toasts.map((t: any) => t.message)).toEqual(["Raj Patel: Ping me when it's green", "Kim in #general: @anna can you review?"]);
        // A reply from Messaging.
        const [out] = await w.db.put([{ _kind: K.message, folder: "outbox", status: "pending", serviceName: "type_slack", username: "anna@Phoenix Makers",
                                        to: [{ addr: "raj@T0PHX" }], messageText: "Will do" }]);
        expect(await w.methods.outbox({ messageId: out.id })).toMatchObject({ returnValue: true, sent: 1 });
        expect(sl.posted).toEqual([{ channel: "D0RAJ", text: "Will do" }]);
        // Our own message is not brought back as theirs.
        sl.historyCalls = {};
        await w.sync(id);
        await w.sync(id);
        expect((await w.find(K.message, [{ prop: "folder", op: "=", val: "inbox" }])).length).toBe(4);
    });

    it("says to sign in again when Slack refuses the token", async () => {
        const w = await world({ dir: DIR, def, config: { "slack/clients.json": sl.clients() }, kindParents,
                                handlers: { "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: "xoxp-revoked" }) } });
        const r = await w.methods.checkCredentials({ templateId: TEMPLATE, config: { oauthKey: "k1" } });
        expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
    });
});
