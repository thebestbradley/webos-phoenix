// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Todoist connector (connector.js) against the stand-in for Todoist's
// API v1 (apps/connectors/testing/todoist.cjs), over real HTTP: the kit's
// conformance suite; the personal token's sign-in (no registration);
// "not available in this build" for Sign In with Todoist without a client
// id, and the OAuth sign-in with one; projects as lists and tasks both ways
// (due days and times, priorities, completion, moves, deletions, a field
// changed on both sides); the share sheet's "Add to Todoist"; turning Tasks
// off and deleting the account leave nothing behind.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addTodoist } = require("../../testing/todoist.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const TEMPLATE = "com.webosphoenix.todoist";
const PROVIDER = TEMPLATE + ".tasks";
const TASK = "com.palm.task.todoist:1", LIST = "com.palm.tasklist.todoist:1";
const kindParents = { [TASK]: "com.palm.task:1", [LIST]: "com.palm.tasklist:1" };

// A new Todoist for each test (the conformance suite's share one).
let base: any, td: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    td = addTodoist(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });

const config = (withClient: boolean) => ({ "todoist/clients.json": withClient ? td.clients() : { todoist: { api: base.origin + "/api/v1" } } });

describe("conformance: Todoist with a personal token", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents,
        get validateParams() { return { username: "", password: td.token }; },
        // The suite gives no image settings: Todoist's own address goes to the fake.
        server: () => {
            base.unauthorizedAll = false; base.throttleSeconds = 0;
            const s = base.conformance((req: any) => request(Object.assign({}, req, { url: String(req.url).replace("https://api.todoist.com", base.origin) })));
            s.editRemote = (remoteId: string, field: string, value: any) => td.edit(remoteId, field === "summary" ? { content: value } : { [field]: value });
            return s;
        },
        conflict: { providerId: PROVIDER, field: "summary", localValue: "Edited on the device", remoteValue: "Edited on Todoist" },
        share: { content: { title: "Read this", url: "https://example.com/article" } }
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("Todoist", () => {
    beforeEach(fresh);
    it("signs in with the personal token, and refuses a wrong one", async () => {
        const w = await world({ dir: DIR, def, config: config(false), kindParents });
        const ok = await w.methods.checkCredentials({ templateId: TEMPLATE, password: td.token });
        expect(ok).toMatchObject({ returnValue: true, username: "anna@example.com", credentials: { common: { token: td.token } },
                                   config: { mode: "token", userId: "2671355" } });
        const bad = await w.methods.checkCredentials({ templateId: TEMPLATE, password: "ffffffffffffffffffffffffffffffffffffffff" });
        expect(bad).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        const junk = await w.methods.checkCredentials({ templateId: TEMPLATE, password: "my password" });
        expect(junk.errorCode).toBe("401_UNAUTHORIZED");
    });

    it("says Sign In with Todoist is not available without Phoenix's registration, and signs in with OAuth with it", async () => {
        const w0 = await world({ dir: DIR, def, config: config(false), kindParents });
        const info = await w0.methods.providerInfo({});
        expect(info.oauth).toMatchObject({ available: false });
        expect(info.oauth.reason).toMatch(/not available in this build/);
        const refused = await w0.methods.signIn({});
        expect(refused).toMatchObject({ returnValue: false, errorCode: "NOT_AVAILABLE" });

        const w = await world({ dir: DIR, def, config: config(true), kindParents });
        expect((await w.methods.providerInfo({})).oauth).toMatchObject({ available: true });
        const r = await w.methods.signIn({});
        expect(r).toMatchObject({ returnValue: true, username: "anna@example.com", config: { mode: "oauth" } });
        expect(r.credentials.common.oauthKey).toBeTruthy();
        expect(w.sheets[0]).toContain("/oauth/todoist/authorize?");
        expect(w.sheets[0]).toContain("scope=data%3Aread_write%2Cdata%3Adelete");
        // The validator takes the key the sign-in got.
        const v = await w.methods.checkCredentials({ templateId: TEMPLATE, config: { oauthKey: r.credentials.common.oauthKey } });
        expect(v).toMatchObject({ returnValue: true, username: "anna@example.com" });
        const id = await w.addAccount(TEMPLATE, r);
        await w.enable(id, PROVIDER);
        expect((await w.sync(id)).returnValue).toBe(true);
        expect((await w.find(TASK)).length).toBeGreaterThan(0);
        // Deleting the account forgets the key.
        expect((await w.methods.onDelete({ accountId: id })).returnValue).toBe(true);
        expect(Object.keys(w.keys).filter((k) => k.indexOf("key:") === 0)).toEqual([]);
    });

    it("brings the projects as lists and the tasks into Tasks, both ways", async () => {
        const w = await world({ dir: DIR, def, config: config(false), kindParents });
        const id = await w.addAccount(TEMPLATE, await w.methods.checkCredentials({ templateId: TEMPLATE, password: td.token }));
        await w.enable(id, PROVIDER);
        expect((await w.sync(id)).returnValue).toBe(true);
        const lists = await w.find(LIST);
        expect(lists.map((l: any) => l.name).sort()).toEqual(["Groceries", "Todoist Inbox"]);
        expect(lists.every((l: any) => l.accountId === id && l.taskKind === TASK)).toBe(true);
        const groceries = lists.find((l: any) => l.name === "Groceries");
        const tasks = await w.find(TASK);
        const by = (s: string) => tasks.find((t: any) => t.summary === s);
        // A day, a floating time, a fixed time; P1 urgent is high.
        expect(by("Buy milk")).toMatchObject({ listId: groceries._id, allDay: true, due: new Date(2026, 9, 12).getTime(), priority: 1, completed: false });
        expect(by("Call the dentist")).toMatchObject({ allDay: false, due: new Date(2026, 9, 13, 9, 30).getTime(), notes: "About the cleaning" });
        expect(by("Renew passport")).toMatchObject({ due: Date.UTC(2026, 10, 1, 8), priority: 9 });
        // Done lately: shown done.
        expect(by("Plan the trip")).toMatchObject({ completed: true });
        // The parent kind finds them (Tasks, the Assistant).
        expect((await w.find("com.palm.task:1")).length).toBe(tasks.length);

        // From the device: a new task, an edit, a completion, a deletion.
        const inbox = lists.find((l: any) => l.name === "Todoist Inbox");
        await w.db.put([{ _kind: TASK, summary: "Water the plants", notes: "", completed: false, priority: 5, listId: inbox._id, accountId: id,
                          due: new Date(2026, 9, 20).getTime(), allDay: true }]);
        await w.db.merge([{ _id: by("Buy milk")._id, summary: "Buy oat milk", listId: inbox._id }]);
        await w.db.merge([{ _id: by("Call the dentist")._id, completed: true, completedTime: Date.now() }]);
        await w.db.del([by("Renew passport")._id]);
        const r2 = await w.sync(id);
        expect(r2.returnValue, JSON.stringify(r2)).toBe(true);
        expect(r2.stats[PROVIDER].pushed).toEqual({ created: 1, updated: 2, deleted: 1 });
        const server = (s: string) => td.tasks.find((t: any) => t.content === s && !t.is_deleted);
        expect(server("Water the plants")).toMatchObject({ priority: 3, project_id: "220474322", due: { date: "2026-10-20" } });
        expect(server("Buy oat milk")).toMatchObject({ project_id: "220474322" });
        expect(server("Call the dentist")).toMatchObject({ checked: true });
        expect(server("Renew passport")).toBeUndefined();
        // Nothing changed: nothing written, nothing sent.
        const before = base.requests.filter((q: any) => q.method !== "GET").length;
        const r3 = await w.sync(id);
        expect(r3.stats[PROVIDER]).toMatchObject({ created: 0, updated: 0, deleted: 0, pushed: { created: 0, updated: 0, deleted: 0 } });
        expect(base.requests.filter((q: any) => q.method !== "GET").length).toBe(before);

        // From Todoist: an edit and a deletion.
        td.edit(server("Water the plants").id, { content: "Water the garden", due: null });
        server("Buy oat milk").is_deleted = true;
        await w.sync(id);
        const after = await w.find(TASK);
        // The date taken off (db8's merge drops a field set to null).
        const garden = after.find((t: any) => t.summary === "Water the garden");
        expect(garden.due ?? null).toBeNull();
        expect(garden.allDay).toBe(false);
        expect(after.find((t: any) => t.summary === "Buy oat milk")).toBeUndefined();

        // Tasks turned off: the account's tasks and lists go; on again: back, and nothing deleted on Todoist.
        await w.enable(id, PROVIDER, false);
        expect(await w.find(TASK)).toEqual([]);
        expect(await w.find(LIST)).toEqual([]);
        const open = td.tasks.filter((t: any) => !t.is_deleted).length;
        await w.enable(id, PROVIDER, true);
        await w.sync(id);
        expect(td.tasks.filter((t: any) => !t.is_deleted).length).toBe(open);
        expect((await w.find(TASK)).length).toBeGreaterThan(0);
        expect((await w.methods.onDelete({ accountId: id })).returnValue).toBe(true);
        expect(await w.find(TASK)).toEqual([]);
        expect(await w.find(LIST)).toEqual([]);
    });

    it("adds a shared link to the Inbox once, however often it is retried", async () => {
        const w = await world({ dir: DIR, def, config: config(false), kindParents });
        const id = await w.addAccount(TEMPLATE, await w.methods.checkCredentials({ templateId: TEMPLATE, password: td.token }));
        const share = { accountId: id, content: { title: "A recipe", text: "Try this one", url: "https://example.com/soup" }, idempotencyKey: "k-1" };
        const r = await w.methods.share(share);
        expect(r).toMatchObject({ returnValue: true });
        expect(r.url).toMatch(/^https:\/\/app\.todoist\.com\/app\/task\//);
        await w.methods.share(share);
        const made = td.tasks.filter((t: any) => t.content === "A recipe");
        expect(made.length).toBe(1);
        expect(made[0].description).toBe("Try this one\n\nhttps://example.com/soup");
        expect((await w.methods.share({ accountId: id, content: {} })).returnValue).toBe(false);
    });
});
