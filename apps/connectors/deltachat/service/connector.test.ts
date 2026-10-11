// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Delta Chat account (connector.js) against a fake deltachat-rpc-server
// (test/fake-rpc-server.cjs) as its system helper, with db8, the accounts
// service and the activity manager in memory: the kit's conformance suite,
// then a build without the core, signing in (a password, a new chatmail
// address, signing in again), chats and groups in Messaging, sending (to a
// new address too), "Delivered" and "Read", read receipts sent, pictures
// both ways, offline, the core's account lost and made again, and the
// account deleted with the core's.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as kit from "@phoenix/connector-kit";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

const require = createRequire(__filename);
const { createFakeRpcServer } = require("./test/fake-rpc-server.cjs");
const fixture = require("./test/fixture.js");
const deltachat = loadCommonJs(join(__dirname, "connector.js"));
const template = JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", "com.webosphoenix.deltachat", "com.webosphoenix.deltachat.json"), "utf8"));
const SERVICE = "org.webosphoenix.service.deltachat";
const ACCOUNT = "deltachat-account-1";
const KIND = "com.palm.immessage.deltachat:1";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
    for (let t = 0; t < ms; t += 20) {
        const v = await fn();
        if (v) return v;
        await sleep(20);
    }
    throw new Error("timed out waiting");
}

describe("conformance: the Delta Chat account", () => {
    for (const check of conformanceChecks(deltachat, fixture)) it(check.name, () => check.run(), 20000);
});

async function world(o?: { noHelper?: boolean }) {
    const server = createFakeRpcServer({
        domain: "chat.test", users: { "me@chat.test": "pw" }, replyDelay: 30,
        people: [{ addr: "sam@chat.test", name: "Sam Delgado", greeting: "Welcome to Delta Chat", replies: ["Got it, encrypted.", "Nice picture!"] },
                 { addr: "priya@chat.test", name: "Priya Nair", greeting: "Hey" }],
        groups: [{ name: "Phoenix Testers", members: ["sam@chat.test", "priya@chat.test"], messages: [["sam@chat.test", "Build 42 boots."]] }]
    });
    const db = memdb.createMemDb(Object.assign({}, memdb.KIND_PARENTS, fixture.kindParents));
    const tempdb = memdb.createMemDb();
    const toasts: any[] = [];
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    let methods: any = {};
    let started = 0;
    const handlers: Record<string, any> = {
        "luna://com.webos.notification/createToast": (p: any) => { toasts.push(p); return { returnValue: true }; },
        "luna://org.webosports.service.messaging/putMessage": async (p: any) => {
            const addr = p.message.folder === "inbox" ? p.message.from.addr : p.message.to[0].addr;
            const r = await db.put([Object.assign({ conversations: ["thread-" + addr] }, p.message)]);
            return { returnValue: true, threadids: ["thread-" + addr], id: r[0].id };
        },
        "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
        ["luna://" + SERVICE + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    };
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers });
    const written: Record<string, Uint8Array> = {};
    const files: Record<string, any> = { "/media/internal/DCIM/100PHNX/pier.jpg": { bytes: JPEG, mimeType: "image/jpeg" } };
    methods = kit.createConnectorService(deltachat, {
        luna: bus, request: (r: any) => server.request(r), periodicSync: false, sleep: async () => {},
        helper: o?.noHelper ? undefined : async (name: string) => { expect(name).toBe("deltachat-rpc-server"); started++; return server.process(); },
        readFile: async (p: string) => { if (!files[p]) throw new Error("no file " + p); return files[p]; },
        writeFile: async (svc: string, name: string, bytes: Uint8Array) => { const p = "/media/internal/.phoenix/connector-files/" + svc + "/" + name; written[p] = bytes; return p; }
    });
    async function create(r: any) {
        accounts[ACCOUNT] = { _id: ACCOUNT, templateId: template.templateId, username: r.username,
                              capabilityProviders: template.capabilityProviders.map((c: any) => ({ id: c.id, capability: c.capability })) };
        credentials[ACCOUNT] = r.credentials;
        await methods.onCreate({ accountId: ACCOUNT, config: r.config });
        for (const p of template.capabilityProviders) await methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
        const s = await methods.sync({ accountId: ACCOUNT });
        expect(s.returnValue, JSON.stringify(s)).toBe(true);
    }
    async function signIn() {
        const r = await methods.checkCredentials({ templateId: template.templateId, username: "me@chat.test", password: "pw" });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        await create(r);
        return r;
    }
    const live = (kind: string) => Object.values(db.objects).filter((x: any) => !x._del && x._kind === kind) as any[];
    const messages = () => live(KIND).sort((a, b) => a.timestamp - b.timestamp || String(a._id).localeCompare(String(b._id)));
    async function send(to: string, text: string, parts?: any[]) {
        const [m] = await db.put([{ _kind: KIND, folder: "outbox", status: "pending", serviceName: "type_deltachat",
                                    username: "me@chat.test", messageText: text, to: [{ addr: to }], localTimestamp: Date.now(), timestamp: Date.now(),
                                    flags: { read: true, visible: true }, conversations: ["thread-" + to], parts }]);
        const r = await methods.outbox({ messageId: m.id });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        return m.id;
    }
    const close = async () => { await methods.disconnect({}); await server.close(); };
    return { server, db, toasts, methods, signIn, create, messages, live, send, written, close, started: () => started };
}

describe("the Delta Chat account", () => {
    it("says when this build has no Delta Chat core, before and at signing in", async () => {
        const w = await world({ noHelper: true });
        try {
            const a = await w.methods.available({});
            expect(a).toMatchObject({ returnValue: true, available: false });
            expect(a.reason).toMatch(/not available in this build/);
            const r = await w.methods.checkCredentials({ templateId: template.templateId, username: "me@chat.test", password: "pw" });
            expect(r).toMatchObject({ returnValue: false, errorCode: "HELPER_NOT_AVAILABLE" });
        } finally { await w.close(); }
    });

    it("signs in with an address and password, once in the core however often it is asked", async () => {
        const w = await world();
        try {
            expect(await w.methods.available({})).toMatchObject({ returnValue: true, available: true, core: expect.stringMatching(/^v2/) });
            expect(await w.methods.checkCredentials({ username: "me@chat.test", password: "nope" })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            expect(w.server.accounts()).toBe(0);
            expect(await w.methods.checkCredentials({ username: "not an address", password: "x" })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
            const r = await w.methods.checkCredentials({ username: "Me@Chat.test", password: "pw" });
            expect(r).toMatchObject({ returnValue: true, username: "me@chat.test", credentials: { common: { password: "pw" } },
                                      config: { addr: "me@chat.test", e2ee: true } });
            // Signing in again (a changed password) keeps the core's account.
            const again = await w.methods.checkCredentials({ username: "me@chat.test", password: "pw" });
            expect(again.config.dcAccountId).toBe(r.config.dcAccountId);
            expect(w.server.accounts()).toBe(1);
            // One core for every account.
            expect(w.started()).toBe(1);
        } finally { await w.close(); }
    });

    it("makes a new address on a chatmail server", async () => {
        const w = await world();
        try {
            const r = await w.methods.checkCredentials({ templateId: template.templateId, config: { chatmail: "chat.test" } });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            expect(r.username).toMatch(/^[a-z0-9]+@chat\.test$/);
            expect(r.credentials.common.password).toBeTruthy();
            expect(await w.methods.checkCredentials({ config: { chatmail: "elsewhere.test" } })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
        } finally { await w.close(); }
    });

    it("files chats and groups, the people in Contacts, and what comes next with a notification", async () => {
        const w = await world();
        try {
            await w.signIn();
            const first = w.messages();
            expect(first.map((m) => m.messageText).sort()).toEqual(["Hey", "Sam Delgado: Build 42 boots.", "Welcome to Delta Chat"].sort());
            const sam = first.find((m) => m.messageText === "Welcome to Delta Chat");
            expect(sam).toMatchObject({ folder: "inbox", username: "me@chat.test", serviceName: "type_deltachat", from: { addr: "sam@chat.test", name: "Sam Delgado" },
                                        flags: { read: true } });
            const group = first.find((m) => m.chatType === "groupchat");
            expect(group).toMatchObject({ channelDisplayName: "Phoenix Testers", from: { name: "Phoenix Testers" } });
            expect(group.channelName).toMatch(/^deltachat-group:\d+$/);
            expect(w.toasts.length).toBe(0);
            const contacts = w.live("com.palm.contact.deltachat:1");
            expect(contacts.map((c) => c.ims[0].value).sort()).toEqual(["priya@chat.test", "sam@chat.test"]);
            const login = w.live("com.palm.imloginstate.deltachat:1")[0];
            expect(login).toMatchObject({ state: "online", serviceName: "type_deltachat", username: "me@chat.test" });

            w.server.deliver("priya@chat.test", "me@chat.test", "Are you there?");
            await until(() => w.messages().some((m) => m.messageText === "Are you there?"));
            const m = w.messages().find((x) => x.messageText === "Are you there?");
            expect(m.flags.read).toBe(false);
            await until(() => w.toasts.length === 1);
            expect(w.toasts[0]).toMatchObject({ message: "Priya Nair: Are you there?" });
            // A second sync files nothing twice.
            const n = w.messages().length;
            expect((await w.methods.sync({ accountId: ACCOUNT })).returnValue).toBe(true);
            expect(w.messages().length).toBe(n);
        } finally { await w.close(); }
    });

    it("sends: delivered, read, answered; to a new address and into a group too", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("sam@chat.test", "Hello from the Pre");
            expect(w.db.objects[id]).toMatchObject({ status: "successful", serviceMessageId: expect.stringMatching(/^Mr\./) });
            await until(() => w.db.objects[id].deliveryStatus === "read");
            await until(() => w.messages().some((m) => m.messageText === "Got it, encrypted."));
            expect(w.server.sent()).toEqual([{ from: "me@chat.test", to: "sam@chat.test", text: "Hello from the Pre", file: null }]);

            const id2 = await w.send("lee@other.test", "Hi Lee");
            expect(w.db.objects[id2].status).toBe("successful");
            await until(() => w.db.objects[id2].deliveryStatus === "delivered");
            expect(w.server.sent()[1]).toMatchObject({ to: "lee@other.test", text: "Hi Lee" });

            const group = w.messages().find((m) => m.chatType === "groupchat");
            const id3 = await w.send(group.channelName, "Hi all");
            expect(w.db.objects[id3].status).toBe("successful");
            expect(w.server.sent()[2]).toMatchObject({ to: "Phoenix Testers", text: "Hi all" });
        } finally { await w.close(); }
    });

    it("sends a picture with its caption, and keeps one sent back", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("sam@chat.test", "The pier", [{ path: "/media/internal/DCIM/100PHNX/pier.jpg", mimeType: "image/jpeg", name: "pier.jpg" }]);
            expect(w.db.objects[id].status).toBe("successful");
            expect(w.server.sent()[0]).toMatchObject({ text: "The pier", file: "/media/internal/DCIM/100PHNX/pier.jpg" });
            w.server.deliver("sam@chat.test", "me@chat.test", "", { picture: true });
            const back = await until(() => w.messages().find((m) => m.folder === "inbox" && m.parts));
            expect(back.parts[0]).toMatchObject({ mimeType: "image/jpeg", name: "pier.jpg" });
            expect(Array.from(w.written[back.parts[0].path])).toEqual(Array.from(JPEG));
        } finally { await w.close(); }
    });

    it("sends read receipts for what is read here", async () => {
        const w = await world();
        try {
            await w.signIn();
            w.server.deliver("priya@chat.test", "me@chat.test", "Read me");
            await until(() => w.messages().some((m) => m.messageText === "Read me"));
            const r = await w.methods.markRead({ accountId: ACCOUNT, threadId: "thread-priya@chat.test" });
            expect(r).toMatchObject({ returnValue: true, marked: true });
            expect(w.server.seen("me@chat.test")).toContain("Read me");
            expect(await w.methods.markRead({ accountId: ACCOUNT, threadId: "thread-priya@chat.test" })).toMatchObject({ marked: false });
        } finally { await w.close(); }
    });

    it("offline stops the core's connection; online starts it again", async () => {
        const w = await world();
        try {
            await w.signIn();
            expect((await w.methods.setPresence({ accountId: ACCOUNT, availability: 4 })).returnValue).toBe(true);
            expect(w.live("com.palm.imloginstate.deltachat:1")[0]).toMatchObject({ state: "offline", availability: 4 });
            const id = await w.send("sam@chat.test", "not now");
            expect(w.db.objects[id]).toMatchObject({ status: "failed", errorText: "Offline" });
            expect((await w.methods.setPresence({ accountId: ACCOUNT, availability: 0 })).returnValue).toBe(true);
            expect(w.live("com.palm.imloginstate.deltachat:1")[0]).toMatchObject({ state: "online", availability: 0 });
        } finally { await w.close(); }
    });

    it("a core that lost the account gets it again from the kept password; deleting removes the core's", async () => {
        const w = await world();
        try {
            const r = await w.signIn();
            await w.methods.disconnect({});
            const rpc = (w.server as any);
            // The core's data gone (a reset): the account is not there.
            const p = rpc.process();
            await new Promise<void>((resolve) => {
                p.onLine(() => resolve());
                p.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "remove_account", params: [r.config.dcAccountId] }));
            });
            expect(rpc.accounts()).toBe(0);
            expect((await w.methods.sync({ accountId: ACCOUNT })).returnValue).toBe(true);
            expect(rpc.accounts()).toBe(1);
            // Its messages are not filed twice.
            const texts = w.messages().map((m) => m.messageText);
            expect(texts.filter((t) => t === "Welcome to Delta Chat").length).toBe(1);

            expect((await w.methods.onDelete({ accountId: ACCOUNT })).returnValue).toBe(true);
            expect(rpc.accounts()).toBe(0);
            expect(w.messages().length).toBe(0);
        } finally { await w.close(); }
    });
});
