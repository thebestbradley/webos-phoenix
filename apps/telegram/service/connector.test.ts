// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Unofficial Telegram account (connector.js) against a fake tdjson
// (test/fake-tdjson.cjs, TDLib's JSON interface behind phoenix-tdjson's
// line protocol) as its system helper, with db8, the accounts service and
// the activity manager in memory: the kit's conformance suite, then a
// build without the app id or TDLib, signing in (the phone, the code, the
// two-step password; the mistakes), chats and groups in Messaging and no
// channels, sending (TDLib's temporary id, then the server's), "Read",
// read receipts sent, pictures both ways, a session ended elsewhere, and
// the account deleted (signed out of Telegram).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as kit from "@phoenix/connector-kit";
import { conformanceChecks } from "../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../shared/connector-kit/src/test-support";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

const require = createRequire(__filename);
const { createFakeTdjson } = require("./test/fake-tdjson.cjs");
const fixture = require("./test/fixture.js");
const telegram = loadCommonJs(join(__dirname, "connector.js"));
const template = JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", "com.webosphoenix.telegram", "com.webosphoenix.telegram.json"), "utf8"));
const SERVICE = "org.webosphoenix.service.telegram";
const ACCOUNT = "telegram-account-1";
const KIND = "com.palm.immessage.telegram:1";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4]);
const SETTINGS = { apiId: 1, apiHash: "test-only-not-a-telegram-app" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
    for (let t = 0; t < ms; t += 20) {
        const v = await fn();
        if (v) return v;
        await sleep(20);
    }
    throw new Error("timed out waiting");
}

describe("conformance: the Unofficial Telegram account", () => {
    for (const check of conformanceChecks(telegram, fixture)) it(check.name, () => check.run(), 20000);
});

async function world(o?: { settings?: any; noHelper?: boolean }) {
    const server = createFakeTdjson({
        accounts: [{ phone: "+15550100", code: "24680", firstName: "Me" }, { phone: "+15550199", code: "11111", password: "hunter2", hint: "the usual" }],
        replyDelay: 30,
        people: [{ id: 7000001, phone: "+15550101", firstName: "Sam", lastName: "Delgado", username: "samdelgado", greeting: "Welcome", replies: ["Got it.", "Nice picture!"] },
                 { id: 7000002, phone: "", firstName: "Priya", username: "priya", greeting: "Hey" }],
        groups: [{ id: -100001, title: "Phoenix Testers", members: [7000001, 7000002], messages: [[7000001, "Build 42 boots."]] }],
        channels: [{ id: -100002, title: "News", messages: ["Channel post"] }]
    });
    const db = memdb.createMemDb(Object.assign({}, memdb.KIND_PARENTS, fixture.kindParents));
    const tempdb = memdb.createMemDb();
    const toasts: any[] = [];
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    let methods: any = {};
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
    methods = kit.createConnectorService(telegram, {
        luna: bus, request: (r: any) => server.request(r), periodicSync: false, sleep: async () => {},
        settings: async () => (o && "settings" in o ? o.settings : SETTINGS),
        helper: o?.noHelper ? undefined : async (name: string) => { expect(name).toBe("phoenix-tdjson"); return server.process(); },
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
        const a = await methods.signIn({ phone: "+15550100" });
        expect(a, JSON.stringify(a)).toMatchObject({ returnValue: true, state: "code", sentBy: "app" });
        const b = await methods.signIn({ key: a.key, code: "24680" });
        expect(b).toMatchObject({ returnValue: true, state: "ready" });
        const r = await methods.checkCredentials({ templateId: template.templateId, config: { key: a.key } });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        await create(r);
        return r;
    }
    const live = (kind: string) => Object.values(db.objects).filter((x: any) => !x._del && x._kind === kind) as any[];
    const messages = () => live(KIND).sort((a, b) => a.timestamp - b.timestamp || String(a._id).localeCompare(String(b._id)));
    async function send(to: string, text: string, parts?: any[]) {
        const [m] = await db.put([{ _kind: KIND, folder: "outbox", status: "pending", serviceName: "type_telegram",
                                    username: "+15550100", messageText: text, to: [{ addr: to }], localTimestamp: Date.now(), timestamp: Date.now(),
                                    flags: { read: true, visible: true }, conversations: ["thread-" + to], parts }]);
        const r = await methods.outbox({ messageId: m.id });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        return m.id;
    }
    const close = async () => { await methods.disconnect({}); await server.close(); };
    return { server, db, toasts, methods, signIn, create, messages, live, send, written, close };
}

describe("the Unofficial Telegram account", () => {
    it("says when this build has no Telegram app id, or no TDLib", async () => {
        const w = await world({ settings: null });
        try {
            const a = await w.methods.available({});
            expect(a).toMatchObject({ returnValue: true, available: false });
            expect(a.reason).toMatch(/not available in this build: it was built without a Telegram app id/);
            expect(await w.methods.signIn({ phone: "+15550100" })).toMatchObject({ returnValue: false, errorCode: "HELPER_NOT_AVAILABLE" });
        } finally { await w.close(); }
        const v = await world({ noHelper: true });
        try {
            const a = await v.methods.available({});
            expect(a.available).toBe(false);
            expect(a.reason).toMatch(/TDLib\) is not installed/);
        } finally { await v.close(); }
    });

    it("signs in with the phone, the code and the two-step password, saying what went wrong", async () => {
        const w = await world();
        try {
            expect(await w.methods.available({})).toMatchObject({ returnValue: true, available: true, tdlib: "1.8.68 (fake)" });
            expect(await w.methods.signIn({ phone: "12" })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
            expect(await w.methods.signIn({ phone: "+15550177" })).toMatchObject({ returnValue: false, errorCode: "NO_ACCOUNT" });
            const a = await w.methods.signIn({ phone: "+1 (555) 0199" });
            expect(a).toMatchObject({ state: "code", phone: "15550199" });
            expect(await w.methods.signIn({ key: a.key, code: "99999" })).toMatchObject({ returnValue: false, errorCode: "WRONG_CODE" });
            expect(await w.methods.signIn({ key: a.key, code: "11111" })).toMatchObject({ state: "password", hint: "the usual" });
            expect(await w.methods.signIn({ key: a.key, password: "nope" })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            expect(await w.methods.signIn({ key: a.key, password: "hunter2" })).toMatchObject({ state: "ready" });
            const r = await w.methods.checkCredentials({ templateId: template.templateId, config: { key: a.key } });
            expect(r).toMatchObject({ returnValue: true, username: "+15550199", config: { userId: 5000002 } });
            expect(r.credentials.common.dbKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
            expect(r.config.dir).toMatch(/^a-/);
            // The session is finished: its key is not good twice; and no key, no account.
            expect(await w.methods.checkCredentials({ config: { key: a.key } })).toMatchObject({ returnValue: false, errorCode: "UNSUPPORTED" });
            expect(await w.methods.signIn({ key: "nothing", code: "1" })).toMatchObject({ returnValue: false, errorCode: "CODE_EXPIRED" });
        } finally { await w.close(); }
    });

    it("files private chats and groups, not channels; the people in Contacts; what comes next notified", async () => {
        const w = await world();
        try {
            await w.signIn();
            const first = w.messages();
            expect(first.map((m) => m.messageText).sort()).toEqual(["Hey", "Sam Delgado: Build 42 boots.", "Welcome"].sort());
            expect(first.find((m) => m.messageText === "Welcome")).toMatchObject({ folder: "inbox", from: { addr: "+15550101", name: "Sam Delgado" },
                                                                                 serviceName: "type_telegram", username: "+15550100", flags: { read: true } });
            expect(first.find((m) => m.messageText === "Hey").from.addr).toBe("@priya");
            expect(first.find((m) => m.chatType === "groupchat")).toMatchObject({ channelName: "telegram-chat:-100001", channelDisplayName: "Phoenix Testers" });
            expect(w.toasts.length).toBe(0);
            const contacts = w.live("com.palm.contact.telegram:1");
            expect(contacts.map((c) => c.ims[0].value).sort()).toEqual(["+15550101", "@priya"]);
            expect(contacts.find((c) => c.ims[0].value === "+15550101").phoneNumbers[0].value).toBe("+15550101");
            expect(w.live("com.palm.imloginstate.telegram:1")[0]).toMatchObject({ state: "online", serviceName: "type_telegram" });

            w.server.deliver("+15550101", "+15550100", "Are you there?");
            await until(() => w.toasts.length === 1);
            expect(w.toasts[0]).toMatchObject({ message: "Sam Delgado: Are you there?" });
            const n = w.messages().length;
            expect((await w.methods.sync({ accountId: ACCOUNT })).returnValue).toBe(true);
            expect(w.messages().length).toBe(n);
        } finally { await w.close(); }
    });

    it("sends: the server's id, read, answered; to someone by username, into a group; not to a number not on Telegram", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("+15550101", "Hello from the Pre");
            expect(w.db.objects[id].status).toBe("successful");
            await until(() => w.db.objects[id].deliveryStatus === "read");
            expect(w.db.objects[id].serviceMessageId).toBe("7000001:" + 2 * 1048576);
            await until(() => w.messages().some((m) => m.messageText === "Got it."));
            expect(w.messages().filter((m) => m.messageText === "Hello from the Pre").length).toBe(1);
            expect(w.server.sent()[0]).toMatchObject({ to: 7000001, text: "Hello from the Pre" });

            expect(w.db.objects[await w.send("@priya", "Hi Priya")].status).toBe("successful");
            const group = w.messages().find((m) => m.chatType === "groupchat");
            expect(w.db.objects[await w.send(group.channelName, "Hi all")].status).toBe("successful");
            expect(w.server.sent().map((s: any) => s.to)).toEqual([7000001, 7000002, -100001]);
            const nope = await w.send("+15550177", "Hello?");
            expect(w.db.objects[nope]).toMatchObject({ status: "permanent-fail" });
        } finally { await w.close(); }
    });

    it("sends a picture with its caption, and keeps one sent back", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("+15550101", "The pier", [{ path: "/media/internal/DCIM/100PHNX/pier.jpg", mimeType: "image/jpeg", name: "pier.jpg" }]);
            expect(w.db.objects[id].status).toBe("successful");
            expect(w.server.sent()[0]).toMatchObject({ text: "The pier", photo: "/media/internal/DCIM/100PHNX/pier.jpg" });
            w.server.deliver("+15550101", "+15550100", "", { picture: true });
            const back = await until(() => w.messages().find((m) => m.folder === "inbox" && m.parts));
            expect(back.parts[0]).toMatchObject({ mimeType: "image/jpeg", name: "pier.jpg" });
            expect(Array.from(w.written[back.parts[0].path])).toEqual(Array.from(JPEG));
        } finally { await w.close(); }
    });

    it("sends read receipts for what is read here", async () => {
        const w = await world();
        try {
            await w.signIn();
            w.server.deliver("+15550101", "+15550100", "Read me");
            const m = await until(() => w.messages().find((x) => x.messageText === "Read me"));
            expect(await w.methods.markRead({ accountId: ACCOUNT, threadId: "thread-+15550101" })).toMatchObject({ returnValue: true, marked: true });
            expect(w.server.viewed()).toContain(m.telegram.id);
            expect(await w.methods.markRead({ accountId: ACCOUNT, threadId: "thread-+15550101" })).toMatchObject({ marked: false });
        } finally { await w.close(); }
    });

    it("a session ended elsewhere asks to sign in again; deleting signs out of Telegram", async () => {
        const w = await world();
        try {
            await w.signIn();
            expect(w.server.sessions()).toBe(1);
            expect((await w.methods.onDelete({ accountId: ACCOUNT })).returnValue).toBe(true);
            expect(w.server.sessions()).toBe(0);
            expect(w.messages().length).toBe(0);
        } finally { await w.close(); }
        const v = await world();
        try {
            await v.signIn();
            v.server.unauthorized(true);
            const r = await v.methods.sync({ accountId: ACCOUNT });
            expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        } finally { await v.close(); }
    });
});
