// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Matrix account (connector.js) against the fake homeserver
// (test/fake-homeserver.cjs), with db8, the accounts service and the
// activity manager in memory and the real OAuth service
// (services/oauth/oauthservice.js) for the homeserver's own sign-in page:
// the kit's conformance suite, then discovery and sign-in (a password, and
// OAuth with a client registered dynamically), sliding sync and /v3/sync,
// direct chats and rooms in Messaging, the encrypted room said honestly,
// sending (a new direct chat made), read receipts both ways, pictures, and
// the account deleted.

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
const { createFakeHomeserver } = require("./test/fake-homeserver.cjs");
const fixture = require("./test/fixture.js");
const oauthLib = require("../../../../services/oauth/oauthservice.js");
const matrix = loadCommonJs(join(__dirname, "connector.js"));
const template = JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", "com.webosphoenix.matrix", "com.webosphoenix.matrix.json"), "utf8"));
const SERVICE = "org.webosphoenix.service.matrix";
const ACCOUNT = "matrix-account-1";
const KINDS = fixture.kindParents;
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

describe("conformance: the Matrix account", () => {
    for (const check of conformanceChecks(matrix, fixture)) it(check.name, () => check.run(), 20000);
});

async function world(o?: { slidingSync?: boolean; oauth?: boolean }) {
    const server = createFakeHomeserver({
        serverName: "matrix.test", users: { me: "pw" }, replyDelay: 40, maxWaitMs: 200, slidingSync: o?.slidingSync, oauth: o?.oauth,
        people: [{ userId: "@sam:matrix.test", displayname: "Sam Delgado", greeting: "Welcome to Matrix", replies: ["Nice, it works."] },
                 { userId: "@priya:matrix.test", displayname: "Priya Nair", encrypted: true, greeting: "secret" },
                 { userId: "@lee:matrix.test", displayname: "Lee", replies: ["Hi!"] }],
        groups: [{ name: "Phoenix Testers", members: ["@sam:matrix.test", "@priya:matrix.test"], messages: [["@sam:matrix.test", "Build 42 boots."]] }]
    });
    const db = memdb.createMemDb(Object.assign({}, memdb.KIND_PARENTS, KINDS));
    const tempdb = memdb.createMemDb();
    const toasts: any[] = [];
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    const keys: Record<string, any> = {};
    let methods: any = {};
    const oauth = oauthLib.createOAuthService({
        request: (r: any) => server.request(r),
        keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
        crypto: { randomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)),
                  sha256: async (b: Uint8Array) => new Uint8Array(require("crypto").createHash("sha256").update(Buffer.from(b)).digest()) },
        redirectUri: "http://127.0.0.1:1/signed-in.html",
        // The user presses Continue on the homeserver's page.
        sheet: async (url: string, prefix: string) => {
            const page = await server.request({ method: "GET", url });
            const pending = /name="pending" value="([^"]+)"/.exec(page.body)![1];
            const r = await server.request({ method: "POST", url: server.base + "/oauth2/authorize", headers: { "content-type": "application/x-www-form-urlencoded" },
                                             body: "pending=" + pending + "&user=me" });
            expect(r.headers.location.indexOf(prefix)).toBe(0);
            return r.headers.location;
        }
    });
    const handlers: Record<string, any> = {
        "luna://org.webosphoenix.service.oauth/*": (p: any, uri: string) => (oauth as any)[uri.slice(uri.lastIndexOf("/") + 1)](p, SERVICE),
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
    methods = kit.createConnectorService(matrix, {
        luna: bus, request: (r: any) => server.request(r), periodicSync: false, sleep: async () => {},
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
        const r = await methods.checkCredentials({ templateId: template.templateId, username: "@me:matrix.test", password: "pw" });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        await create(r);
        return r;
    }
    const live = (kind: string) => Object.values(db.objects).filter((x: any) => !x._del && x._kind === kind) as any[];
    const messages = () => live("com.palm.immessage.matrix:1").sort((a, b) => a.timestamp - b.timestamp);
    async function send(to: string, text: string, parts?: any[]) {
        const [m] = await db.put([{ _kind: "com.palm.immessage.matrix:1", folder: "outbox", status: "pending", serviceName: "type_matrix",
                                    username: "@me:matrix.test", messageText: text, to: [{ addr: to }], localTimestamp: Date.now(), timestamp: Date.now(),
                                    flags: { read: true, visible: true }, conversations: ["thread-" + to], parts }]);
        const r = await methods.outbox({ messageId: m.id });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        return m.id;
    }
    const close = async () => { await methods.disconnect({}); await server.close(); };
    return { server, db, toasts, methods, signIn, create, messages, live, send, written, keys, close };
}

describe("the Matrix account", () => {
    it("finds the homeserver from the Matrix ID and signs in with the password", async () => {
        const w = await world();
        try {
            const o = await w.methods.signInOptions({ user: "@me:matrix.test" });
            expect(o).toMatchObject({ returnValue: true, homeserver: "https://matrix.test", password: true, oauth: false, slidingSync: true });
            const r = await w.signIn();
            expect(r.username).toBe("@me:matrix.test");
            expect(Object.keys(r.credentials.common).sort()).toEqual(["accessToken", "deviceId"]);
            expect(r.config).toMatchObject({ homeserver: "https://matrix.test", userId: "@me:matrix.test", slidingSync: true, e2ee: false });
            expect(await w.methods.checkCredentials({ username: "@me:matrix.test", password: "nope" })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            expect(await w.methods.checkCredentials({ username: "not an id", password: "x" })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
        } finally { await w.close(); }
    });

    it("signs in on the homeserver's own page where it uses OAuth (a client registered once, the token in the key store)", async () => {
        const w = await world({ oauth: true });
        try {
            const o = await w.methods.signInOptions({ user: "@me:matrix.test" });
            expect(o).toMatchObject({ password: false, oauth: true });
            const s = await w.methods.signIn({ user: "@me:matrix.test" });
            expect(s.returnValue, JSON.stringify(s)).toBe(true);
            expect(Object.keys(s.credentials.common)).toEqual(["oauthKey"]);
            const key = w.keys["key:" + s.credentials.common.oauthKey];
            expect(key && key.owner).toBe(SERVICE);
            expect(JSON.stringify(s)).not.toContain(key.accessToken);
            expect(Object.values(w.server.oauthClients())[0]).toMatchObject({ client_name: "webOS Phoenix", token_endpoint_auth_method: "none", application_type: "native" });
            await w.methods.signIn({ user: "@me:matrix.test" });
            expect(Object.keys(w.server.oauthClients())).toHaveLength(1);
            const v = await w.methods.checkCredentials({ config: { oauthKey: s.credentials.common.oauthKey, homeserver: s.config.homeserver, userId: s.config.userId } });
            expect(v.returnValue, JSON.stringify(v)).toBe(true);
            await w.create(v);
            await until(() => w.messages().length >= 2);
        } finally { await w.close(); }
    });

    for (const sliding of [true, false]) {
        it("files direct chats and rooms in Messaging (" + (sliding ? "sliding sync" : "/v3/sync") + "), the encrypted one said honestly", async () => {
            const w = await world({ slidingSync: sliding });
            try {
                await w.signIn();
                const ms = w.messages();
                const sam = ms.find((m) => m.messageText === "Welcome to Matrix");
                expect(sam).toMatchObject({ folder: "inbox", from: { addr: "@sam:matrix.test", name: "Sam Delgado" }, flags: { read: true }, serviceName: "type_matrix" });
                const priya = ms.find((m) => m.from && m.from.addr === "@priya:matrix.test");
                expect(priya.messageText).toBe(matrix.ENCRYPTED_TEXT);
                expect(priya.matrix.encrypted).toBe(true);
                const group = ms.find((m) => m.chatType === "groupchat");
                expect(group).toMatchObject({ messageText: "Sam Delgado: Build 42 boots.", channelDisplayName: "Phoenix Testers", from: { name: "Phoenix Testers" } });
                expect(group.from.addr).toMatch(/^!grp/);
                // The first sync's history: read, no notifications.
                expect(w.toasts).toEqual([]);
                const contacts = w.live("com.palm.contact.matrix:1");
                expect(contacts.map((c) => [c.remoteId, c.nickname, c.ims[0].type]).sort()).toEqual([
                    ["@lee:matrix.test", "Lee", "type_matrix"], ["@priya:matrix.test", "Priya Nair", "type_matrix"], ["@sam:matrix.test", "Sam Delgado", "type_matrix"]]);
                // Their own display names: not used to link them to the address book.
                expect(contacts.every((c) => !c.name)).toBe(true);
                expect(w.live("com.palm.imloginstate.matrix:1")[0]).toMatchObject({ state: "online", serviceName: "type_matrix", username: "@me:matrix.test" });
                // A new message: in, with a notification.
                w.server.say("@sam:matrix.test", "@me:matrix.test", "Still there?");
                const m = await until(() => w.messages().find((x) => x.messageText === "Still there?"));
                expect(m.flags.read).toBe(false);
                expect(w.toasts.map((t) => t.message)).toEqual(["Sam Delgado: Still there?"]);
            } finally { await w.close(); }
        });
    }

    it("sends: to a direct chat, read by them, their answer; a new direct chat made; nothing into an encrypted room", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("@sam:matrix.test", "Phoenix speaks Matrix");
            const sent = w.messages().find((x) => x._id === id);
            expect(sent).toMatchObject({ status: "successful" });
            expect(sent.serviceMessageId).toMatch(/^\$/);
            await until(() => w.messages().find((x) => x._id === id).deliveryStatus === "read");
            const reply = await until(() => w.messages().find((x) => x.messageText === "Nice, it works."));
            expect(reply.folder).toBe("inbox");
            // The echo of our own message in the sync is not filed twice.
            await sleep(300);
            expect(w.messages().filter((x) => x.messageText === "Phoenix speaks Matrix")).toHaveLength(1);
            // Someone without a room yet: a direct chat is made, and m.direct says so.
            const id2 = await w.send("@newfriend:matrix.test", "Hello");
            expect(w.messages().find((x) => x._id === id2).status).toBe("successful");
            const dm = w.server.rooms().find((r: any) => r.members.includes("@newfriend:matrix.test"));
            expect(dm.direct).toBe(true);
            // Priya's room is end-to-end encrypted: not sent (it would go unencrypted).
            const id3 = await w.send("@priya:matrix.test", "Secret?");
            const refused = w.messages().find((x) => x._id === id3);
            expect(refused.status).toBe("permanent-fail");
            expect(refused.errorText).toMatch(/end-to-end encrypted/);
            // Read in Messaging: a read receipt for Sam's last message.
            const mk = await w.methods.markRead({ accountId: ACCOUNT, threadId: "thread-@sam:matrix.test" });
            expect(mk).toMatchObject({ returnValue: true, marked: true });
            expect(w.server.receiptsBy("@me:matrix.test").length).toBe(1);
        } finally { await w.close(); }
    });

    it("sends a picture (media upload) and fetches one it is sent (authenticated media)", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("@sam:matrix.test", "", [{ path: "/media/internal/DCIM/100PHNX/pier.jpg", mimeType: "image/jpeg" }]);
            expect(w.messages().find((x) => x._id === id).status).toBe("successful");
            const dm = w.server.rooms().find((r: any) => r.members.includes("@sam:matrix.test") && r.direct);
            const ev = w.server.events(dm.id).find((e: any) => e.content && e.content.msgtype === "m.image");
            expect(ev.content).toMatchObject({ body: "pier.jpg", info: { mimetype: "image/jpeg", size: JPEG.length } });
            expect(Array.from(w.server.media(ev.content.url).bytes)).toEqual(Array.from(JPEG));
            w.server.say("@sam:matrix.test", "@me:matrix.test", "", { image: { bytes: JPEG, type: "image/jpeg", name: "harbour.jpg" } });
            const pic = await until(() => w.messages().find((x) => x.folder === "inbox" && x.parts));
            expect(pic.messageText).toBe("");
            expect(pic.parts[0]).toMatchObject({ mimeType: "image/jpeg", name: "harbour.jpg" });
            expect(Array.from(w.written[pic.parts[0].path])).toEqual(Array.from(JPEG));
            expect(w.toasts.map((t) => t.message)).toContain("Sam Delgado: Picture");
        } finally { await w.close(); }
    });

    it("signs out on the server and leaves nothing behind when the account is deleted", async () => {
        const w = await world();
        try {
            await w.signIn();
            expect(w.server.tokens()).toHaveLength(1);
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: false });
            await w.methods.onDelete({ accountId: ACCOUNT });
            expect(w.messages()).toEqual([]);
            expect(w.live("com.palm.contact.matrix:1")).toEqual([]);
            expect(w.live("com.palm.imloginstate.matrix:1")).toEqual([]);
            expect(w.server.tokens()).toHaveLength(0);
        } finally { await w.close(); }
    });
});
