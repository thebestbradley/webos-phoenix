// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Fediverse account (connector.js) against the fake Mastodon server
// (test/fake-mastodon.cjs), with db8, the accounts service and the
// activity manager in memory and the real OAuth service
// (services/oauth/oauthservice.js) whose browser sheet presses
// "Authorize" on the server's page: the conformance suite of the kit, then
// the sign-in, followed accounts as contacts, direct mentions in
// Messaging, notifications, sharing a post with a photo, replies from
// Messaging's outbox, and the token revoked with the account.

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
const { createFakeMastodon } = require("./test/fake-mastodon.cjs");
const oauthLib = require("../../../services/oauth/oauthservice.js");
const fediverse = loadCommonJs(join(__dirname, "connector.js"));
const template = JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", "com.webosphoenix.fediverse", "com.webosphoenix.fediverse.json"), "utf8"));
const SERVICE = "org.webosphoenix.service.fediverse";
const ACCOUNT = "fedi-account-1";
const KINDS = { "com.palm.contact.fediverse:1": "com.palm.contact:1", "com.palm.immessage.fediverse:1": "com.palm.immessage:1",
                "com.palm.immessage:1": "com.palm.message:1" };

// ---- The conformance suite ------------------------------------------------------------------

const fixture = {
    template,
    kindParents: KINDS,
    validateParams: { username: "phoenix@127.0.0.1:9", config: { server: "http://127.0.0.1:9", oauthKey: "conformance-key" } },
    server: () => createFakeMastodon({ base: "http://127.0.0.1:9" }),
    // The OAuth service's token for the key: one the fake server knows.
    handlers: (server: any) => {
        let token = "";
        return {
            "luna://org.webosphoenix.service.oauth/token": () => ({ returnValue: true, accessToken: token || (token = server.issueToken()) }),
            "luna://org.webosphoenix.service.oauth/forget": () => ({ returnValue: true })
        };
    },
    minObjects: 3,
    // What the share checks post: a link and a picture with its description, unlisted.
    share: { content: { text: "webOS lives", url: "https://example.org/phoenix",
                        files: [{ path: "/media/internal/DCIM/100PHNX/harbor.jpg", mimeType: "image/jpeg", description: "A harbour at dusk" }] },
             audience: "unlisted" },
    files: { "/media/internal/DCIM/100PHNX/harbor.jpg": { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" } }
};

describe("conformance: the Fediverse account", () => {
    for (const check of conformanceChecks(fediverse, fixture)) it(check.name, () => check.run());
});

// ---- The whole account ----------------------------------------------------------------------

async function world() {
    const server = await createFakeMastodon().start(0);
    const db = memdb.createMemDb(Object.assign({}, memdb.KIND_PARENTS, KINDS));
    const tempdb = memdb.createMemDb();
    const keys: Record<string, any> = {};
    const toasts: any[] = [];
    const messages: any[] = [];
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    // The OAuth service, its sheet a user who presses "Authorize" on the server's page.
    const sheetSeen: string[] = [];
    let deny = false;
    const oauth = oauthLib.createOAuthService({
        request: (r: any) => server.request(r),
        keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
        crypto: { randomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)),
                  sha256: async (b: Uint8Array) => new Uint8Array(require("crypto").createHash("sha256").update(Buffer.from(b)).digest()) },
        redirectUri: "http://127.0.0.1:1/signed-in.html",
        sheet: async (url: string, prefix: string) => {
            sheetSeen.push(url);
            const page = await server.request({ method: "GET", url });
            const fields: Record<string, string> = {};
            for (const m of page.body.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]] = m[2].replace(/&amp;/g, "&").replace(/&quot;/g, "\"");
            fields.decision = deny ? "deny" : "allow";
            const r = await server.request({ method: "POST", url: server.base + "/oauth/authorize", headers: { "content-type": "application/x-www-form-urlencoded" },
                                             body: new URLSearchParams(fields).toString() });
            expect(r.headers.location.indexOf(prefix)).toBe(0);
            return r.headers.location;
        }
    });
    let methods: any = {};
    const handlers: Record<string, any> = {
        "luna://org.webosphoenix.service.oauth/*": (p: any, uri: string) => (oauth as any)[uri.slice(uri.lastIndexOf("/") + 1)](p, SERVICE),
        "luna://com.webos.notification/createToast": (p: any) => { toasts.push(p); return { returnValue: true }; },
        "luna://org.webosports.service.messaging/putMessage": async (p: any) => {
            messages.push(p.message);
            const r = await db.put([Object.assign({ conversations: ["thread-" + p.message.from.addr] }, p.message)]);
            return { returnValue: true, threadids: ["thread-" + p.message.from.addr], id: r[0].id };
        },
        "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
        ["luna://" + SERVICE + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    };
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers });
    const files: Record<string, { bytes: Uint8Array; mimeType: string }> = {
        "/media/internal/DCIM/100PHNX/harbor.jpg": { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" }
    };
    methods = kit.createConnectorService(fediverse, {
        luna: bus, request: (r: any) => server.request(r), periodicSync: false, sleep: async () => {},
        readFile: async (p: string) => { if (!files[p]) throw new Error("no file " + p); return files[p]; }
    });
    // Sign in, then what com.palm.service.accounts does: the account, its credentials, onCreate, onEnabled.
    async function signIn() {
        const r = await methods.signIn({ handle: "@phoenix@" + server.domain });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        accounts[ACCOUNT] = { _id: ACCOUNT, templateId: template.templateId, username: r.username,
                              capabilityProviders: template.capabilityProviders.map((c: any) => ({ id: c.id, capability: c.capability })) };
        credentials[ACCOUNT] = r.credentials;
        await methods.onCreate({ accountId: ACCOUNT, config: r.config });
        return r;
    }
    const live = (kind: string) => Object.values(db.objects).filter((o: any) => !o._del && o._kind === kind) as any[];
    return { server, db, tempdb, keys, toasts, messages, methods, bus, signIn, live, sheetSeen, setDeny: (d: boolean) => { deny = d; } };
}

describe("the Fediverse account", () => {
    it("signs in by handle: WebFinger, NodeInfo, the app registered once, OAuth with PKCE, the token kept in the key store", async () => {
        const w = await world();
        try {
            const r = await w.signIn();
            expect(r.username).toBe("phoenix@" + w.server.domain);
            expect(r.config).toMatchObject({ server: w.server.base, acct: "phoenix@" + w.server.domain, accountId: "1", software: "mastodon",
                                             displayName: "Phoenix Tester" });
            expect(Object.keys(r.credentials.common).sort()).toEqual(["oauthKey", "server"]);
            const key = w.keys["key:" + r.credentials.common.oauthKey];
            expect(key).toMatchObject({ owner: SERVICE, tokenType: "Bearer" });
            expect(JSON.stringify(r)).not.toContain(key.accessToken);
            expect(w.sheetSeen[0]).toMatch(/\/oauth\/authorize\?response_type=code&client_id=.*&code_challenge=[\w-]{43}&code_challenge_method=S256/);
            expect(w.sheetSeen[0]).toContain("scope=read%3Aaccounts%20read%3Afollows");
            // A second sign-in on the same server keeps the app's registration.
            await w.methods.signIn({ handle: "phoenix@" + w.server.domain });
            expect(Object.keys(w.server.apps).length).toBe(1);
            // Refused on the server's page: ACCESS_DENIED; a handle nobody has: INVALID_USER.
            w.setDeny(true);
            expect(await w.methods.signIn({ handle: "@phoenix@" + w.server.domain })).toMatchObject({ returnValue: false, errorCode: "ACCESS_DENIED" });
            expect(await w.methods.signIn({ handle: "@nobody@" + w.server.domain })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
            expect(await w.methods.signIn({ handle: "not a handle" })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
        } finally { await w.server.close(); }
    });

    it("puts the accounts you follow on contact cards, linked to the people you have", async () => {
        const w = await world();
        try {
            // Sofia Lindqvist is in the address book already.
            const [c] = await w.db.put([{ _kind: "com.palm.contact:1", name: { givenName: "Sofia", familyName: "Lindqvist" },
                                          emails: [{ value: "sofia@example.edu", type: "type_work" }] }]);
            await w.db.put([{ _kind: "com.palm.person:1", name: { givenName: "Sofia", familyName: "Lindqvist" },
                              names: [{ givenName: "Sofia", familyName: "Lindqvist" }], contactIds: [c.id] }]);
            await w.signIn();
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
            const r = await w.methods.sync({ accountId: ACCOUNT });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            const contacts = w.live("com.palm.contact.fediverse:1");
            expect(contacts.map((x) => [x.name.givenName, x.name.familyName, x.nickname]).sort()).toEqual([
                ["Juniper", "Bloom", "@juniper@pixels.example"], ["Sofia", "Lindqvist", "@sofia@fedi.example"], ["theo", "", "@theo@" + w.server.domain]]);
            const sofia = contacts.find((x) => x.nickname === "@sofia@fedi.example");
            expect(sofia.urls).toEqual([{ value: "https://fedi.example/@sofia", type: "type_profile" }, { value: "https://sofia.example/", type: "type_homepage" }]);
            expect(sofia.photos[0]).toMatchObject({ value: w.server.base + "/avatars/sofia.png", type: "type_big" });
            expect(sofia.note).toBe("Latest post, 9 Oct 2026: Flashed Phoenix on my old Pre 3 today. It boots!");
            expect(sofia.accountId).toBe(ACCOUNT);
            const persons = w.live("com.palm.person:1");
            const linked = persons.find((p) => p.contactIds.indexOf(sofia._id) >= 0);
            expect(linked.contactIds).toEqual([c.id, sofia._id]);
            expect(linked.urls.map((u: any) => u.value)).toContain("https://fedi.example/@sofia");
            expect(persons).toHaveLength(3);
            // Unfollowed on the server: gone from the card at the next sync.
            w.server.unfollow("juniper");
            await w.methods.sync({ accountId: ACCOUNT });
            expect(w.live("com.palm.contact.fediverse:1").map((x) => x.nickname)).not.toContain("@juniper@pixels.example");
            expect(w.live("com.palm.person:1")).toHaveLength(2);
        } finally { await w.server.close(); }
    });

    it("brings direct mentions into Messaging and the rest as notifications", async () => {
        const w = await world();
        try {
            await w.signIn();
            // An old direct mention: in Messaging, read, without a notification.
            w.server.mention("sofia", "Did you get the Pre 3 booting?", "direct");
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
            await w.methods.sync({ accountId: ACCOUNT });
            expect(w.messages.map((m) => [m.messageText, m.flags.read])).toEqual([["Did you get the Pre 3 booting?", true]]);
            expect(w.toasts).toEqual([]);
            // New ones.
            w.server.mention("sofia", "Send pictures!", "direct");
            w.server.mention("juniper", "Phoenix looks great", "public");
            w.server.notifyOf("follow", "theo");
            const r = await w.methods.sync({ accountId: ACCOUNT });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            const dm = w.messages[1];
            expect(dm).toMatchObject({ _kind: "com.palm.immessage.fediverse:1", folder: "inbox", serviceName: "type_fediverse",
                                       username: "phoenix@" + w.server.domain, messageText: "Send pictures!", accountId: ACCOUNT,
                                       from: { addr: "sofia@fedi.example", name: "Sofia Lindqvist" }, flags: { read: false, visible: true } });
            expect(dm.fediverse.statusId).toMatch(/^\d+$/);
            expect(w.toasts.map((t) => [t.message, t.onclick.appId])).toEqual([
                ["Sofia Lindqvist: Send pictures!", "org.webosphoenix.messaging"],
                ["Juniper Bloom mentioned you: @phoenix Phoenix looks great", "org.webosphoenix.fediverse"],
                ["theo followed you: @theo", "org.webosphoenix.fediverse"]
            ]);
            expect(w.toasts[0].onclick.params).toEqual({ threadId: "thread-sofia@fedi.example" });
            expect(w.toasts[1].onclick.params.open).toMatch(/^https:\/\/pixels\.example\/@juniper\/\d+$/);
            // Nothing new: nothing written, nothing shown.
            const before = w.toasts.length, mark = w.bus.calls.length;
            await w.methods.sync({ accountId: ACCOUNT });
            expect(w.toasts.length).toBe(before);
            expect(w.bus.calls.slice(mark).filter((c: any) => /com\.palm\.db\/(put|merge|del)$/.test(c.uri))).toEqual([]);
        } finally { await w.server.close(); }
    });

    it("a first sync with no notifications at all still makes the next mention news", async () => {
        const w = await world();
        try {
            await w.signIn();
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
            await w.methods.sync({ accountId: ACCOUNT });
            expect(w.messages).toEqual([]);
            w.server.mention("sofia", "First!", "direct");
            w.server.notifyOf("favourite", "juniper");
            await w.methods.sync({ accountId: ACCOUNT });
            expect(w.messages.map((m) => [m.messageText, m.flags.read])).toEqual([["First!", false]]);
            expect(w.toasts.map((t) => t.message)).toEqual(["Sofia Lindqvist: First!", "Juniper Bloom favourited your post: Hello, Fediverse!"]);
        } finally { await w.server.close(); }
    });

    it("posts what is shared (the kit's share): a link, text, a photo with its description, the visibility chosen", async () => {
        const w = await world();
        try {
            await w.signIn();
            const shared = { accountId: ACCOUNT, content: { text: "webOS lives", url: "https://example.org/phoenix",
                                                          files: [{ path: "/media/internal/DCIM/100PHNX/harbor.jpg", description: "A harbour at dusk" }] },
                             audience: "unlisted", idempotencyKey: "share-1" };
            const r = await w.methods.share(shared);
            expect(r).toMatchObject({ returnValue: true, posted: { id: expect.any(String) } });
            expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/@phoenix\/\d+$/);
            const st = w.server.statuses[0];
            expect(st).toMatchObject({ text: "webOS lives\n\nhttps://example.org/phoenix", visibility: "unlisted" });
            expect(st.media_attachments).toEqual([expect.objectContaining({ description: "A harbour at dusk", mimeType: "image/jpeg", bytes: 8, filename: "harbor.jpg" })]);
            // The same share again (a retry): the same status.
            await w.methods.share(shared);
            expect(w.server.statuses).toHaveLength(1);
            expect(await w.methods.share({ accountId: ACCOUNT, content: { text: "" } })).toMatchObject({ returnValue: false, errorCode: "SHARE_NOTHING" });
            expect(await w.methods.share({ accountId: ACCOUNT, content: { text: "Hi" }, audience: "everyone" }))
                .toMatchObject({ returnValue: false, errorCode: "SHARE_BAD_AUDIENCE" });
            expect(w.methods.post).toBeUndefined();
        } finally { await w.server.close(); }
    });

    it("sends Messaging's replies as direct mentions in reply to the last one", async () => {
        const w = await world();
        try {
            await w.signIn();
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
            await w.methods.sync({ accountId: ACCOUNT });
            w.server.mention("sofia", "Lunch on Friday?", "direct");
            await w.methods.sync({ accountId: ACCOUNT });
            const theirs = w.live("com.palm.immessage.fediverse:1")[0];
            const [out] = await w.db.put([{ _kind: "com.palm.immessage.fediverse:1", folder: "outbox", status: "pending", serviceName: "type_fediverse",
                                           username: "phoenix@" + w.server.domain, to: [{ addr: "sofia@fedi.example" }], messageText: "Yes! Noon?" }]);
            const r = await w.methods.outbox({ messageId: out.id });
            expect(r).toMatchObject({ returnValue: true, sent: 1 });
            const st = w.server.statuses[0];
            expect(st).toMatchObject({ text: "@sofia@fedi.example Yes! Noon?", visibility: "direct", in_reply_to_id: theirs.fediverse.statusId });
            expect(w.db.objects[out.id]).toMatchObject({ status: "successful", accountId: ACCOUNT });
        } finally { await w.server.close(); }
    });

    it("turning Messaging off removes its conversations; deleting the account revokes the token", async () => {
        const w = await world();
        try {
            const r = await w.signIn();
            w.server.mention("sofia", "Hi", "direct");
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
            await w.methods.sync({ accountId: ACCOUNT });
            await w.db.put([{ _kind: "com.palm.chatthread:1", replyService: "type_fediverse", username: r.username, replyAddress: "sofia@fedi.example" }]);
            expect(w.live("com.palm.immessage.fediverse:1")).toHaveLength(1);
            await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: "com.webosphoenix.fediverse.messaging", enabled: false });
            expect(w.live("com.palm.immessage.fediverse:1")).toHaveLength(0);
            expect(w.live("com.palm.chatthread:1")).toHaveLength(0);
            expect(await w.methods.onDelete({ accountId: ACCOUNT })).toMatchObject({ returnValue: true });
            expect(w.server.revoked).toHaveLength(1);
            expect(Object.keys(w.keys).filter((k) => k.indexOf("key:") === 0)).toEqual([]);
            expect(w.live("com.palm.contact.fediverse:1")).toEqual([]);
        } finally { await w.server.close(); }
    });
});
