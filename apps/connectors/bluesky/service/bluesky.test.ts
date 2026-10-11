// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Bluesky connector (connector.js, lib/atproto.js, lib/oauth.js)
// against the stand-in AT Protocol services of
// apps/connectors/testing/bluesky.cjs, over real HTTP: the kit's
// conformance suite; signing in with a handle and an app password (the
// handle resolved to its DID and PDS; an account password and a wrong one
// refused); the people followed as contacts; notifications (none for old
// news); direct messages both ways, and an app password without them;
// sessions refreshed; posting from the share sheet (links as facets,
// pictures with alt text, once per share); and AT Protocol OAuth (PAR,
// PKCE, DPoP with the server's nonce, refresh, revocation), offered only
// with Phoenix's client address and the system's sheet.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import { request, template, world } from "../../testing/world";

const require = createRequire(__filename);
const { createFakeBase } = require("../../testing/fake-base.cjs");
const { addBluesky } = require("../../testing/bluesky.cjs");
const DIR = join(__dirname, "..");
const def = loadCommonJs(join(__dirname, "connector.js"));
const atproto = loadCommonJs(join(__dirname, "lib", "atproto.js"));
const TEMPLATE = "com.webosphoenix.bluesky";
const P = def.PROVIDERS;
const CONTACT = "com.palm.contact.bluesky:1", MESSAGE = "com.palm.immessage.bluesky:1";
const kindParents = { [CONTACT]: "com.palm.contact:1", [MESSAGE]: "com.palm.immessage:1" };

let base: any, bs: any;
async function fresh() {
    if (base) await base.stop();
    base = createFakeBase({ autoApprove: true });
    bs = addBluesky(base);
    await base.start(0);
}
beforeAll(fresh);
afterAll(async () => { await base.stop(); });

const config = (oauth = false) => ({ "bluesky/clients.json": bs.clients(oauth) });
// The system's sign-in sheet lent for the browser step (org.webosphoenix.service.oauth "sheet").
const sheetHandler = (log: string[]) => ({
    "luna://org.webosphoenix.service.oauth/sheet": async (p: any) => {
        if (p.probe) return { returnValue: true };
        log.push(p.url);
        let at = p.url;
        for (let i = 0; i < 5 && at.indexOf(p.redirectUri) !== 0; i++) {
            const r = await request({ method: "GET", url: at });
            if (!r.headers.location) return { returnValue: false, errorCode: "401_UNAUTHORIZED", errorText: String(r.body) };
            at = new URL(r.headers.location, at).href.replace(/^org\.webosphoenix:\/\/?/, "org.webosphoenix:/");
            if (r.headers.location.indexOf(p.redirectUri) === 0) at = r.headers.location;
        }
        return { returnValue: true, redirect: at };
    }
});

describe("conformance: Bluesky with an app password", () => {
    const fx = {
        template: template(DIR, TEMPLATE), kindParents,
        get validateParams() { return { username: "anna.test", password: bs.appPassword }; },
        // The suite gives no image settings: the real services' addresses go to the fake.
        server: () => {
            base.unauthorizedAll = false; base.throttleSeconds = 0;
            return base.conformance((req: any) => request(Object.assign({}, req, {
                url: String(req.url).replace("https://anna.test/.well-known/atproto-did", base.origin + "/bsky/well-known/anna.test")
                    .replace("https://plc.directory/", base.origin + "/bsky/plc/").replace("https://bsky.social/xrpc/", base.origin + "/bsky/xrpc/")
            })));
        },
        share: { content: { text: "Hello from Phoenix", url: "https://example.com/" } }
    };
    for (const check of conformanceChecks(def, fx as any)) it(check.name, () => check.run());
});

describe("Bluesky", () => {
    beforeEach(fresh);

    async function signedIn(w: any, password?: string) {
        const r = await w.methods.checkCredentials({ templateId: TEMPLATE, username: "@Anna.Test", password: password || bs.appPassword });
        const id = await w.addAccount(TEMPLATE, r);
        return { id, r };
    }

    it("signs in with the handle and an app password, and says why another password is refused", async () => {
        const w = await world({ dir: DIR, def, config: config(), kindParents });
        const r = await w.methods.checkCredentials({ templateId: TEMPLATE, username: "@Anna.Test", password: bs.appPassword });
        expect(r).toMatchObject({ returnValue: true, username: "anna.test", credentials: { common: { appPassword: bs.appPassword } },
                                  config: { did: bs.did, handle: "anna.test", pds: base.origin + "/bsky/pds", mode: "app-password", displayName: "Anna Lee" } });
        const main = await w.methods.checkCredentials({ templateId: TEMPLATE, username: "anna.test", password: bs.accountPassword });
        expect(main).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        expect(main.errorText).toMatch(/app password/);
        expect((await w.methods.checkCredentials({ templateId: TEMPLATE, username: "anna.test", password: "nope-nope-nope-nope" })).errorCode).toBe("401_UNAUTHORIZED");
        expect((await w.methods.checkCredentials({ templateId: TEMPLATE, username: "nobody.test", password: bs.appPassword })).errorCode).toBe("INVALID_USER");
        expect((await w.methods.checkCredentials({ templateId: TEMPLATE, username: "not a handle", password: "x" })).errorCode).toBe("INVALID_USER");
    });

    it("puts the people followed on contact cards, every page of them", async () => {
        const w = await world({ dir: DIR, def, config: config(), kindParents });
        const { id } = await signedIn(w);
        await w.enable(id, P.contacts);
        expect((await w.sync(id)).returnValue).toBe(true);
        const contacts = await w.find(CONTACT);
        expect(contacts.map((c: any) => c.nickname).sort()).toEqual(["@bob.test", "@carla.test", "@dee.example"]);
        expect(contacts.find((c: any) => c.nickname === "@bob.test")).toMatchObject({
            name: { givenName: "Bob", familyName: "Marsh" }, note: "Birds and boats.", remoteId: "did:plc:bobbobbobbobbobbobbobbob",
            urls: [{ value: "https://bsky.app/profile/bob.test", type: "type_profile" }] });
        // A person for each (the linker).
        expect((await w.find("com.palm.person:1")).length).toBe(3);
        // An unfollow goes from the device.
        bs.follows.pop();
        await w.sync(id);
        expect((await w.find(CONTACT)).length).toBe(2);
    });

    it("notifies new likes, follows and replies, not old news; opens them on bsky.app", async () => {
        const w = await world({ dir: DIR, def, config: config(), kindParents });
        const { id } = await signedIn(w);
        await w.enable(id, P.notifications);
        await w.sync(id);
        expect(w.toasts).toEqual([]);
        bs.notify("follow", bs.people[1]);
        bs.notify("reply", bs.people[0], "Nice photo!");
        await w.sync(id);
        expect(w.toasts.map((t: any) => t.message)).toEqual(["Carla followed you: @carla.test", "Bob Marsh replied to you: Nice photo!"]);
        expect(w.toasts[1].onclick).toMatchObject({ appId: "org.webosphoenix.bluesky", params: { open: expect.stringMatching(/^https:\/\/bsky\.app\/profile\/bob\.test\/post\//) } });
        await w.sync(id);
        expect(w.toasts.length).toBe(2);
    });

    it("brings direct messages into Messaging and sends replies from it", async () => {
        const w = await world({ dir: DIR, def, config: config(), kindParents });
        const { id } = await signedIn(w);
        await w.enable(id, P.messaging);
        expect((await w.sync(id)).returnValue).toBe(true);
        let msgs = await w.find(MESSAGE);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatchObject({ folder: "inbox", serviceName: "type_bluesky", username: "anna.test", from: { addr: "bob.test", name: "Bob Marsh" },
                                        messageText: "Hi Anna!", flags: { read: true } });
        expect(w.toasts).toEqual([]);
        bs.message("convo-bob", "Are you coming on Saturday?");
        await w.sync(id);
        msgs = await w.find(MESSAGE);
        expect(msgs.map((m: any) => m.messageText)).toEqual(["Hi Anna!", "Are you coming on Saturday?"]);
        expect(w.toasts.map((t: any) => t.message)).toEqual(["Bob Marsh: Are you coming on Saturday?"]);
        // A reply written in Messaging.
        const [out] = await w.db.put([{ _kind: MESSAGE, folder: "outbox", status: "pending", serviceName: "type_bluesky", username: "anna.test",
                                        to: [{ addr: "bob.test" }], messageText: "Yes, see you there" }]);
        const sent = await w.methods.outbox({ messageId: out.id });
        expect(sent).toMatchObject({ returnValue: true, sent: 1 });
        expect(bs.convos[0].messages.slice(-1)[0]).toMatchObject({ text: "Yes, see you there", sender: { did: bs.did } });
        expect((await w.db.get([out.id]))[0]).toMatchObject({ status: "successful", bluesky: { convoId: "convo-bob" } });
        // Our own message is not brought back as theirs.
        await w.sync(id);
        expect((await w.find(MESSAGE, [{ prop: "folder", op: "=", val: "inbox" }])).length).toBe(2);
        // Messaging off: the messages go.
        await w.enable(id, P.messaging, false);
        expect(await w.find(MESSAGE)).toEqual([]);
    });

    it("says to make an app password that may read direct messages when it may not", async () => {
        const w = await world({ dir: DIR, def, config: config(), kindParents });
        const { id } = await signedIn(w, bs.chatlessPassword);
        await w.enable(id, P.messaging);
        const r = await w.sync(id);
        expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        expect(r.errorText).toMatch(/direct messages/);
    });

    it("keeps the session: refreshes an expired one instead of signing in again", async () => {
        const w = await world({ dir: DIR, def, config: config(), kindParents });
        const { id } = await signedIn(w);
        await w.enable(id, P.contacts);
        await w.sync(id);
        const made = bs.createSessions;
        bs.expireSessions();
        expect((await w.sync(id)).returnValue).toBe(true);
        expect(bs.createSessions).toBe(made);
    });

    it("posts from the share sheet: links as facets, pictures with alt text, once per share", async () => {
        const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
        const w = await world({ dir: DIR, def, config: config(), kindParents, files: { "/media/internal/a.png": { bytes: png, mimeType: "image/png" } } });
        const { id } = await signedIn(w);
        const share = { accountId: id, content: { text: "Café notes ☕", url: "https://example.com/menu", files: [{ path: "/media/internal/a.png", mimeType: "image/png", description: "The menu" }] },
                        idempotencyKey: "share-1" };
        const r = await w.methods.share(share);
        expect(r).toMatchObject({ returnValue: true, url: "https://bsky.app/profile/anna.test/post/share-1" });
        const p = bs.posts[0].record;
        expect(p.text).toBe("Café notes ☕\n\nhttps://example.com/menu");
        const start = Buffer.byteLength("Café notes ☕\n\n");
        expect(p.facets).toEqual([{ index: { byteStart: start, byteEnd: start + Buffer.byteLength("https://example.com/menu") },
                                    features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/menu" }] }]);
        expect(p.embed.images[0]).toMatchObject({ alt: "The menu", image: { mimeType: "image/png", size: png.length } });
        // A retry of the same share: still one post.
        expect((await w.methods.share(share)).returnValue).toBe(true);
        expect(bs.posts).toHaveLength(1);
        // Too long for Bluesky: refused before it is sent.
        const long = await w.methods.share({ accountId: id, content: { text: "x".repeat(301) }, idempotencyKey: "share-2" });
        expect(long.returnValue).toBe(false);
        expect(bs.posts).toHaveLength(1);
        expect(atproto.graphemes("👍🏽 ok")).toBe(4);
    });

    it("offers Sign In with Bluesky only with Phoenix's client address and the system's sheet", async () => {
        const none = await world({ dir: DIR, def, config: config(false), kindParents });
        const i1 = await none.methods.providerInfo({});
        expect(i1.oauth.available).toBe(false);
        expect(i1.oauth.reason).toMatch(/not available in this build/);
        expect(i1.fields.map((f: any) => f.name)).toEqual(["username", "password"]);
        const noSheet = await world({ dir: DIR, def, config: config(true), kindParents });
        const i2 = await noSheet.methods.providerInfo({});
        expect(i2.oauth.available).toBe(false);
        expect(i2.oauth.reason).toMatch(/sign-in sheet/);
        expect((await noSheet.methods.signIn({ username: "anna.test" })).errorCode).toBe("NOT_AVAILABLE");
        const yes = await world({ dir: DIR, def, config: config(true), kindParents, handlers: sheetHandler([]) });
        expect((await yes.methods.providerInfo({})).oauth).toEqual({ available: true, label: "Sign In with Bluesky" });
    });

    it("signs in with AT Protocol OAuth: PAR, PKCE and DPoP with the server's nonce; refreshes and revokes", async () => {
        const sheets: string[] = [];
        const w = await world({ dir: DIR, def, config: config(true), kindParents, handlers: sheetHandler(sheets) });
        const r = await w.methods.signIn({ username: "anna.test" });
        expect(r, JSON.stringify(r)).toMatchObject({ returnValue: true, username: "anna.test", config: { did: bs.did, mode: "oauth" } });
        // The browser saw only client_id and request_uri (PAR).
        expect(sheets[0]).toMatch(/\/bsky\/as\/oauth\/authorize\?client_id=[^&]+&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3A/);
        expect(r.credentials.common.oauth).toMatchObject({ did: bs.did, refreshToken: expect.stringMatching(/^ort-/) });
        expect(r.credentials.common.oauth.jwk.d).toBeTruthy();
        // Every PAR and token request carried a DPoP proof; the first was asked for the nonce.
        const par = base.requests.filter((q: any) => q.path === "/bsky/as/oauth/par");
        expect(par.length).toBe(2);
        expect(par.every((q: any) => !!q.headers.dpop)).toBe(true);
        const id = await w.addAccount(TEMPLATE, r);
        await w.enable(id, P.contacts);
        expect((await w.sync(id)).returnValue).toBe(true);
        expect((await w.find(CONTACT)).length).toBe(3);
        const calls = base.requests.filter((q: any) => /getFollows/.test(q.path));
        expect(calls.every((q: any) => /^DPoP /.test(q.headers.authorization) && !!q.headers.dpop)).toBe(true);
        // Expired: refreshed with the refresh token (used once: the next one is kept).
        bs.expireOAuth();
        const s1 = await w.sync(id);
        expect(s1.returnValue, JSON.stringify(s1)).toBe(true);
        bs.expireOAuth();
        expect((await w.sync(id)).returnValue).toBe(true);
        // Posting works with the OAuth session too.
        expect((await w.methods.share({ accountId: id, content: { text: "Signed in with OAuth" }, idempotencyKey: "o-1" })).returnValue).toBe(true);
        // The account goes: its refresh token is revoked.
        await w.methods.onDelete({ accountId: id });
        expect(bs.revoked).toBe(1);
    });
});
