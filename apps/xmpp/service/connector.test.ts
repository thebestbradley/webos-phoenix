// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Jabber (XMPP) account (connector.js) against the fake XMPP server
// (test/fake-xmpp.cjs), with db8, tempdb, the accounts service and the
// activity manager in memory: the stream (lib/xml.js, lib/scram.js,
// lib/client.js) on its own, the kit's conformance suite, then the
// account: sign-in through SRV, STARTTLS and SCRAM (or a WebSocket from
// host-meta where there is no TCP), the roster as contacts and buddies
// with presence, chats both ways with receipts and markers, carbons, the
// archive, pictures through HTTP upload, stream resumption, your own
// status, and the account deleted.

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
const { createFakeXmpp } = require("./test/fake-xmpp.cjs");
const X = require("./lib/xml.js");
const scram = require("./lib/scram.js");
const C = require("./lib/client.js");
const S = require("./lib/stanzas.js");
const xmpp = loadCommonJs(join(__dirname, "connector.js"));
const template = JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", "com.webosphoenix.xmpp", "com.webosphoenix.xmpp.json"), "utf8"));
const SERVICE = "org.webosphoenix.service.xmpp";
const ACCOUNT = "xmpp-account-1";
const KINDS = { "com.palm.contact.xmpp:1": "com.palm.contact:1", "com.palm.immessage.xmpp:1": "com.palm.immessage:1",
                "com.palm.immessage:1": "com.palm.message:1", "com.palm.imloginstate.xmpp:1": "com.palm.imloginstate:1",
                "com.palm.imbuddystatus.xmpp:1": "com.palm.imbuddystatus:1" };
const BUDDIES = [
    { jid: "ada.palmer@chat.test", name: "Ada Palmer", status: "Flashing a Pre 3", replies: ["Ha, yes!", "Cards forever."] },
    { jid: "marcus.reyes@chat.test", name: "Marcus Reyes", show: "dnd", status: "In a meeting", replies: ["Later?"] },
    { jid: "theo@chat.test", name: "Theo", online: false, replies: [] }
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
    for (let t = 0; t < ms; t += 20) {
        const v = await fn();
        if (v) return v;
        await sleep(20);
    }
    throw new Error("timed out waiting");
}
function netOf(server: any, o?: any) {
    const env = server.net(o);
    return { supports: { srv: !!env.resolveSrv, tcp: !!env.connect, websocket: !!env.websocket }, allowHost() {},
             resolveSrv: env.resolveSrv, connect: env.connect, websocket: env.websocket };
}

// ---- The stream on its own ----------------------------------------------------------------------

describe("XML for a stream", () => {
    it("parses a stream as it comes, in pieces, with namespaces and entities", () => {
        const p = X.createParser({ stream: true });
        const got: any[] = [];
        let start: any = null;
        p.on("streamStart", (a: any) => { start = a; });
        p.on("stanza", (e: any) => got.push(e));
        const text = "<?xml version='1.0'?><stream:stream xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' from='x'>" +
            "<stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/></stream:features>  " +
            "<message from='a@x/r' to=\"b@x\"><body>1 &lt; 2 &amp;&#x1F600;</body><x xmlns='jabber:x:oob'><url>https://u/a?b=1&amp;c=2</url></x></message>";
        for (let i = 0; i < text.length; i += 7) p.write(text.slice(i, i + 7));
        expect(start.from).toBe("x");
        expect(got).toHaveLength(2);
        expect(got[0].is("features", "http://etherx.jabber.org/streams")).toBe(true);
        expect(got[0].getChild("bind", "urn:ietf:params:xml:ns:xmpp-bind")).toBeTruthy();
        expect(got[1].is("message", "jabber:client")).toBe(true);
        expect(got[1].getChildText("body")).toBe("1 < 2 &\u{1F600}");
        expect(got[1].getChild("x", "jabber:x:oob").getChildText("url")).toBe("https://u/a?b=1&c=2");
        expect(X.parse(got[1].toString()).getChildText("body")).toBe("1 < 2 &\u{1F600}");
    });
    it("refuses a DTD", () => {
        let err: any = null;
        const p = X.createParser({ stream: false });
        p.on("error", (e: any) => { err = e; });
        p.write("<!DOCTYPE x [<!ENTITY a 'b'>]><message/>");
        expect(err && err.condition).toBe("not-well-formed");
    });
});

describe("SASL SCRAM", () => {
    it("matches RFC 7677's SCRAM-SHA-256 example", async () => {
        // RFC 7677 section 3: user "user", password "pencil".
        const first = scram.clientFirst({ username: "user", nonce: "rOprNGfwEbeRWgbNEkqO" });
        expect(first.message).toBe("n,,n=user,r=rOprNGfwEbeRWgbNEkqO");
        const fin = await scram.clientFinal(first.state, "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096", "pencil", "SHA-256");
        expect(fin.message).toBe("c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
        expect(scram.verifyServerFinal("v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=", fin.serverSignature)).toBe(true);
        expect(scram.verifyServerFinal("v=AAAATRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=", fin.serverSignature)).toBe(false);
    });
    it("matches RFC 5802's SCRAM-SHA-1 example", async () => {
        const first = scram.clientFirst({ username: "user", nonce: "fyko+d2lbbFgONRv9qkxdawL" });
        const fin = await scram.clientFinal(first.state, "r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096", "pencil", "SHA-1");
        expect(fin.message).toBe("c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,p=v0X8v3Bz2T0CJGbJQyF0X+HI4Ts=");
        expect(scram.verifyServerFinal("v=rmF9pqV8S7suAoZWja4dJRkFsKQ=", fin.serverSignature)).toBe(true);
    });
});

describe("the client stream", () => {
    it("finds the server by SRV, upgrades to TLS, signs in with SCRAM-SHA-256, binds and enables stream management", async () => {
        const server = createFakeXmpp({ domain: "chat.test", users: { me: "pw" }, buddies: BUDDIES, replyDelay: 20 });
        const c = C.createClient({ net: netOf(server, { websocket: false }), jid: "Me@Chat.Test", password: "pw" });
        const eps = await c.discoverEndpoints("chat.test");
        expect(eps).toEqual([expect.objectContaining({ kind: "starttls", host: "xmpp.chat.test", port: 5222 })]);
        const r = await c.connect();
        expect(r).toEqual({ jid: "me@chat.test/phoenix", resumed: false });
        expect(c.secure).toBe(true);
        expect(c.streamManagement).toMatchObject({ enabled: true, resumable: true });
        await c.close();
        server.close();
    });
    it("says a wrong password is 401_UNAUTHORIZED, and a server asking to slow down gives a backoff", async () => {
        const server = createFakeXmpp({ domain: "chat.test", users: { me: "pw" } });
        const bad = C.createClient({ net: netOf(server), jid: "me@chat.test", password: "nope" });
        await expect(bad.connect()).rejects.toMatchObject({ errorCode: "401_UNAUTHORIZED" });
        server.throttle(600);
        const slow = C.createClient({ net: netOf(server), jid: "me@chat.test", password: "pw", now: () => 1000 });
        await expect(slow.connect()).rejects.toMatchObject({ errorCode: "503_SERVICE_UNAVAILABLE", retryAt: 1000 + 15 * 60 * 1000 });
        server.close();
    });
    it("uses a WebSocket from the domain's host-meta where it cannot open TCP (the simulator)", async () => {
        const server = createFakeXmpp({ domain: "chat.test", users: { me: "pw" } });
        const c = C.createClient({ net: netOf(server, { tcp: false }), http: { request: server.request }, jid: "me@chat.test", password: "pw" });
        expect(await c.discoverEndpoints("chat.test")).toEqual([{ kind: "websocket", url: "wss://chat.test/xmpp-websocket" }]);
        expect(await c.connect()).toMatchObject({ jid: "me@chat.test/phoenix" });
        await c.close();
        server.close();
    });
    it("will not sign in on a plain connection the server will not encrypt", async () => {
        const server = createFakeXmpp({ domain: "chat.test", users: { me: "pw" } });
        const env = server.net({ websocket: false });
        const plain = { supports: { srv: true, tcp: true, websocket: false }, allowHost() {}, resolveSrv: env.resolveSrv,
                        connect: async (o: any) => { const s = await env.connect(o); delete s.startTls; return s; } };
        const c = C.createClient({ net: plain, jid: "me@chat.test", password: "pw" });
        await expect(c.connect()).rejects.toMatchObject({ errorCode: "SSL_CERT_UNTRUSTED" });
        server.close();
    });
    it("files only carbons and archive results from the account's own server", () => {
        const forged = X.parse("<message from='mallory@evil.test' to='me@chat.test/r'><received xmlns='urn:xmpp:carbons:2'><forwarded xmlns='urn:xmpp:forward:0'>" +
                               "<message from='ada@chat.test/x' to='me@chat.test' type='chat'><body>Send me your password</body></message></forwarded></received></message>");
        expect(S.parseMessage(forged, "me@chat.test")).toBeNull();
        const real = X.parse("<message from='me@chat.test' to='me@chat.test/r'><sent xmlns='urn:xmpp:carbons:2'><forwarded xmlns='urn:xmpp:forward:0'>" +
                             "<message from='me@chat.test/laptop' to='ada@chat.test' type='chat' id='x1'><body>Hi</body></message></forwarded></sent></message>");
        expect(S.parseMessage(real, "me@chat.test")).toMatchObject({ outgoing: true, peer: "ada@chat.test", body: "Hi", carbon: "sent" });
        const omemo = X.parse("<message from='ada@chat.test/x' type='chat'><encrypted xmlns='eu.siacs.conversations.axolotl'/>" +
                              "<body>I sent you an OMEMO encrypted message but your client doesn't seem to support that.</body></message>");
        expect(S.parseMessage(omemo, "me@chat.test")).toMatchObject({ encrypted: true, encryptionName: "OMEMO" });
    });
});

// ---- The conformance suite ------------------------------------------------------------------

const fixture = {
    template,
    kindParents: KINDS,
    validateParams: { username: "me@chat.test", password: "pw" },
    server: () => createFakeXmpp({ domain: "chat.test", users: { me: "pw" }, buddies: BUDDIES, replyDelay: 20 }),
    environment: (server: any) => ({ net: server.net({ websocket: false }) }),
    minObjects: 4
};

describe("conformance: the Jabber account", () => {
    for (const check of conformanceChecks(xmpp, fixture as any)) it(check.name, () => check.run(), 20000);
});

// ---- The account ---------------------------------------------------------------------------

async function world(o?: { websocket?: boolean }) {
    const server = createFakeXmpp({ domain: "chat.test", users: { me: "pw", friend: "pw2" }, buddies: BUDDIES, replyDelay: 40 });
    const db = memdb.createMemDb(Object.assign({}, memdb.KIND_PARENTS, KINDS));
    const tempdb = memdb.createMemDb(KINDS);
    const toasts: any[] = [];
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    const written: Record<string, Uint8Array> = {};
    let methods: any = {};
    const handlers: Record<string, any> = {
        "luna://com.webos.notification/createToast": (p: any) => { toasts.push(p); return { returnValue: true }; },
        // The messaging service's thread per address (runtime "Messaging", LuneOS MessageAssigner.js).
        "luna://org.webosports.service.messaging/putMessage": async (p: any) => {
            const addr = p.message.folder === "inbox" ? p.message.from.addr : p.message.to[0].addr;
            const r = await db.put([Object.assign({ conversations: ["thread-" + addr] }, p.message)]);
            return { returnValue: true, threadids: ["thread-" + addr], id: r[0].id };
        },
        "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
        ["luna://" + SERVICE + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    };
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers });
    const files: Record<string, { bytes: Uint8Array; mimeType: string }> = {
        "/media/internal/DCIM/100PHNX/harbor.jpg": { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]), mimeType: "image/jpeg" }
    };
    methods = kit.createConnectorService(xmpp, {
        luna: bus, request: (r: any) => server.request(r), periodicSync: false, sleep: async () => {},
        net: server.net({ websocket: o && o.websocket === true, tcp: !(o && o.websocket === true) }),
        readFile: async (p: string) => { if (!files[p]) throw new Error("no file " + p); return files[p]; },
        writeFile: async (svc: string, name: string, bytes: Uint8Array) => { const p = "/media/internal/.phoenix/connector-files/" + svc + "/" + name; written[p] = bytes; return p; },
        // The stream's timers a hundred times faster (reconnects, keepalives).
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.ceil(ms / 100)),
        clearTimeout: (h: any) => clearTimeout(h)
    });
    async function signIn(user = "me@chat.test", password = "pw") {
        const r = await methods.checkCredentials({ templateId: template.templateId, username: user, password });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        accounts[ACCOUNT] = { _id: ACCOUNT, templateId: template.templateId, username: r.username,
                              capabilityProviders: template.capabilityProviders.map((c: any) => ({ id: c.id, capability: c.capability })) };
        credentials[ACCOUNT] = r.credentials;
        await methods.onCreate({ accountId: ACCOUNT, config: r.config });
        for (const p of template.capabilityProviders) await methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
        const s = await methods.sync({ accountId: ACCOUNT });
        expect(s.returnValue, JSON.stringify(s)).toBe(true);
        return r;
    }
    const live = (d: any, kind: string) => Object.values(d.objects).filter((o: any) => !o._del && (o._kind === kind)) as any[];
    const messages = () => live(db, "com.palm.immessage.xmpp:1").sort((a, b) => a.localTimestamp - b.localTimestamp);
    const buddies = () => live(tempdb, "com.palm.imbuddystatus.xmpp:1");
    const loginState = () => live(db, "com.palm.imloginstate.xmpp:1")[0];
    async function send(to: string, text: string, parts?: any[]) {
        const [m] = await db.put([{ _kind: "com.palm.immessage.xmpp:1", folder: "outbox", status: "pending", serviceName: "type_jabber",
                                    username: "me@chat.test", messageText: text, to: [{ addr: to }], localTimestamp: Date.now(), timestamp: Date.now(),
                                    flags: { read: true, visible: true }, conversations: ["thread-" + to], parts }]);
        const r = await methods.outbox({ messageId: m.id });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        return m.id;
    }
    const close = async () => { await methods.disconnect({}); server.close(); };
    return { server, db, tempdb, toasts, methods, signIn, messages, buddies, loginState, send, written, close, live };
}

describe("the Jabber account", () => {
    it("signs in: the roster as contacts linked to the address book, buddies with presence, the account online", async () => {
        const w = await world();
        try {
            // Ada Palmer is in the address book already.
            const [c] = await w.db.put([{ _kind: "com.palm.contact:1", name: { givenName: "Ada", familyName: "Palmer" }, phoneNumbers: [{ value: "408 555 0142" }] }]);
            const [p] = await w.db.put([{ _kind: "com.palm.person:1", name: { givenName: "Ada", familyName: "Palmer" }, names: [{ givenName: "Ada", familyName: "Palmer" }], contactIds: [c.id] }]);
            const r = await w.signIn();
            expect(r.username).toBe("me@chat.test");
            expect(r.credentials).toEqual({ common: { password: "pw" } });
            expect(r.config).toMatchObject({ jid: "me@chat.test", server: "chat.test", tls: true, e2ee: false });
            const contacts = w.live(w.db, "com.palm.contact.xmpp:1");
            expect(contacts.map((x) => [x.remoteId, x.nickname, x.ims[0]]).sort()).toEqual([
                ["ada.palmer@chat.test", "Ada Palmer", { value: "ada.palmer@chat.test", type: "type_jabber" }],
                ["marcus.reyes@chat.test", "Marcus Reyes", { value: "marcus.reyes@chat.test", type: "type_jabber" }],
                ["theo@chat.test", "Theo", { value: "theo@chat.test", type: "type_jabber" }]]);
            const ada = contacts.find((x) => x.remoteId === "ada.palmer@chat.test");
            const person = w.live(w.db, "com.palm.person:1").find((x) => x._id === p.id);
            expect(person.contactIds).toEqual([c.id, ada._id]);
            expect(person.ims).toEqual([expect.objectContaining({ value: "ada.palmer@chat.test", type: "type_jabber" })]);
            const b = await until(() => { const l = w.buddies(); return l.length === 3 && l.find((x) => x.username === "marcus.reyes@chat.test").availability === 2 ? l : null; });
            expect(b.find((x) => x.username === "ada.palmer@chat.test")).toMatchObject({ availability: 0, status: "Flashing a Pre 3", displayName: "Ada Palmer",
                                                                                          serviceName: "type_jabber", accountId: ACCOUNT, personId: p.id });
            expect(b.find((x) => x.username === "theo@chat.test")).toMatchObject({ availability: 4 });
            expect(w.loginState()).toMatchObject({ accountId: ACCOUNT, username: "me@chat.test", serviceName: "type_jabber", state: "online", availability: 0 });
            expect(w.server.sessions()).toEqual([expect.objectContaining({ user: "me@chat.test", available: true, carbons: true, sm: true })]);
            // A buddy's status changes: the buddy record follows.
            w.server.setPresence("ada.palmer@chat.test", "away", "Lunch");
            await until(() => w.buddies().find((x) => x.username === "ada.palmer@chat.test").availability === 2);
            // A wrong password is refused at sign-in.
            expect(await w.methods.checkCredentials({ username: "me@chat.test", password: "x" })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            expect(await w.methods.checkCredentials({ username: "not a jid", password: "x" })).toMatchObject({ returnValue: false, errorCode: "INVALID_USER" });
        } finally { await w.close(); }
    });

    it("chats: a message in with a notification and a receipt back; one out, delivered and read", async () => {
        const w = await world();
        try {
            await w.signIn();
            w.server.deliver("ada.palmer@chat.test", "me@chat.test", "Is it booting?");
            const inbox = await until(() => w.messages().find((m) => m.folder === "inbox"));
            expect(inbox).toMatchObject({ messageText: "Is it booting?", serviceName: "type_jabber", username: "me@chat.test", status: "successful",
                                          from: { addr: "ada.palmer@chat.test", name: "Ada Palmer" }, flags: { read: false, visible: true }, accountId: ACCOUNT });
            expect(inbox.serviceMessageId).toMatch(/^sid-/);
            expect(w.toasts.map((t) => t.message)).toEqual(["Ada Palmer: Is it booting?"]);
            expect(w.toasts[0].onclick).toEqual({ appId: "org.webosphoenix.messaging", params: { threadId: "thread-ada.palmer@chat.test" } });
            const id = await w.send("ada.palmer@chat.test", "Yes, cards and all");
            const sent = await until(() => { const m = w.messages().find((x) => x._id === id); return m && m.status === "successful" ? m : null; });
            expect(sent.serviceMessageId).toBe(id);
            expect(w.server.archive("me@chat.test").some((s: string) => s.includes("Yes, cards and all") && s.includes("origin-id"))).toBe(true);
            // The buddy's client: received (XEP-0184), then displayed (XEP-0333), then an answer.
            await until(() => w.messages().find((x) => x._id === id).deliveryStatus === "read");
            const reply = await until(() => w.messages().find((m) => m.messageText === "Ha, yes!"));
            expect(reply.folder).toBe("inbox");
            // Read in Messaging: displayed sent to the buddy.
            const mk = await w.methods.markRead({ accountId: ACCOUNT, threadId: "thread-ada.palmer@chat.test" });
            expect(mk).toMatchObject({ returnValue: true, marked: true });
            // Typing.
            w.server.typing("ada.palmer@chat.test", "me@chat.test", "composing");
            await until(() => w.buddies().find((x) => x.username === "ada.palmer@chat.test").chatState === "composing");
        } finally { await w.close(); }
    });

    it("files what the user's other clients sent (carbons) and what came while away (the archive), once each", async () => {
        const w = await world();
        try {
            await w.signIn();
            w.server.sentFromOtherClient("me@chat.test", "marcus.reyes@chat.test", "Sent from my laptop");
            const out = await until(() => w.messages().find((m) => m.messageText === "Sent from my laptop"));
            expect(out).toMatchObject({ folder: "outbox", status: "successful", to: [{ addr: "marcus.reyes@chat.test", name: "Marcus Reyes" }] });
            // Away: the connection closed, two messages meanwhile.
            await w.methods.disconnect({ accountId: ACCOUNT });
            w.server.deliver("ada.palmer@chat.test", "me@chat.test", "Are you there?");
            w.server.deliver("ada.palmer@chat.test", "me@chat.test", "Call me");
            const before = w.toasts.length;
            const r = await w.methods.sync({ accountId: ACCOUNT });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            expect(w.messages().filter((m) => m.messageText === "Are you there?" || m.messageText === "Call me")).toHaveLength(2);
            expect(w.toasts.slice(before).map((t) => t.message)).toEqual(["Jabber: 2 new messages"]);
            // A second sync files nothing twice.
            const n = w.messages().length;
            await w.methods.sync({ accountId: ACCOUNT });
            expect(w.messages()).toHaveLength(n);
        } finally { await w.close(); }
    });

    it("sends a picture through HTTP upload and fetches one it is sent", async () => {
        const w = await world();
        try {
            await w.signIn();
            const id = await w.send("ada.palmer@chat.test", "", [{ path: "/media/internal/DCIM/100PHNX/harbor.jpg", mimeType: "image/jpeg" }]);
            await until(() => w.messages().find((x) => x._id === id).status === "successful");
            const sent = w.server.archive("me@chat.test").find((s: string) => s.includes("jabber:x:oob"));
            const url = /<url>([^<]+)<\/url>/.exec(sent)![1];
            expect(url).toMatch(/^https:\/\/upload\.chat\.test\/.+\/harbor\.jpg$/);
            expect(Array.from(w.server.upload(url).bytes)).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
            // The same picture sent to us: a part of the message, a file of the device.
            w.server.deliver("ada.palmer@chat.test", "me@chat.test", url, { oob: url });
            const pic = await until(() => w.messages().find((m) => m.folder === "inbox" && m.parts));
            expect(pic.messageText).toBe("");
            expect(pic.parts).toEqual([{ path: expect.stringMatching(/^\/media\/internal\/\.phoenix\/connector-files\/org\.webosphoenix\.service\.xmpp\/.+harbor\.jpg$/),
                                         mimeType: "image/jpeg", name: "harbor.jpg" }]);
            expect(w.toasts.map((t) => t.message)).toContain("Ada Palmer: Picture");
        } finally { await w.close(); }
    });

    it("resumes the stream after a drop: nothing lost either way", async () => {
        const w = await world();
        try {
            await w.signIn();
            w.server.dropConnections();
            w.server.deliver("ada.palmer@chat.test", "me@chat.test", "While you were gone");
            await until(() => w.messages().find((m) => m.messageText === "While you were gone"));
            await until(() => w.loginState().state === "online");
            const id = await w.send("ada.palmer@chat.test", "Back");
            await until(() => w.messages().find((x) => x._id === id).status === "successful");
            expect(w.server.sessions()).toHaveLength(1);
        } finally { await w.close(); }
    });

    it("sets your own status, and signs out with Offline (messages then fail)", async () => {
        const w = await world();
        try {
            await w.signIn();
            expect((await w.methods.setPresence({ accountId: ACCOUNT, availability: 2, customMessage: "Busy flashing" })).returnValue).toBe(true);
            expect(w.loginState()).toMatchObject({ availability: 2, customMessage: "Busy flashing", state: "online" });
            await w.methods.setPresence({ accountId: ACCOUNT, availability: 4 });
            await until(() => w.loginState().state === "offline");
            expect(w.server.sessions()).toHaveLength(0);
            expect(w.buddies().every((b) => b.availability === 4)).toBe(true);
            const id = await w.send("ada.palmer@chat.test", "Nope");
            expect(w.messages().find((x) => x._id === id).status).toBe("failed");
            await w.methods.setPresence({ accountId: ACCOUNT, availability: 0 });
            await until(() => w.loginState().state === "online");
        } finally { await w.close(); }
    });

    it("never shows an encrypted message's fallback text, and says it cannot be read here", async () => {
        const w = await world();
        try {
            await w.signIn();
            const el = X.el("message", { from: "ada.palmer@chat.test/phone", to: "me@chat.test", type: "chat", id: "e1" },
                            X.el("encrypted", { xmlns: "eu.siacs.conversations.axolotl" }, X.el("payload", {}, "AAAA")),
                            X.el("body", {}, "I sent you an OMEMO encrypted message but your client doesn't seem to support that."),
                            X.el("encryption", { xmlns: "urn:xmpp:eme:0", namespace: "eu.siacs.conversations.axolotl", name: "OMEMO" }));
            w.server.deliverRaw("me@chat.test", el);
            const m = await until(() => w.messages().find((x) => x.xmpp && x.xmpp.encrypted));
            expect(m.messageText).toBe("Encrypted message (OMEMO): end-to-end encrypted messages can't be read on this device yet.");
        } finally { await w.close(); }
    });

    it("works over a WebSocket too (the simulator's way)", async () => {
        const w = await world({ websocket: true });
        try {
            await w.signIn();
            w.server.deliver("lena@chat.test", "me@chat.test", "Hello from outside the roster");
            const m = await until(() => w.messages().find((x) => x.folder === "inbox"));
            expect(m.from).toEqual({ addr: "lena@chat.test", name: "lena@chat.test" });
        } finally { await w.close(); }
    });

    it("leaves nothing behind when the account is deleted", async () => {
        const w = await world();
        try {
            await w.signIn();
            w.server.deliver("ada.palmer@chat.test", "me@chat.test", "Bye");
            await until(() => w.messages().length);
            for (const p of template.capabilityProviders) await w.methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: false });
            await w.methods.onDelete({ accountId: ACCOUNT });
            expect(w.messages()).toEqual([]);
            expect(w.live(w.db, "com.palm.contact.xmpp:1")).toEqual([]);
            expect(w.live(w.db, "com.palm.imloginstate.xmpp:1")).toEqual([]);
            expect(w.buddies()).toEqual([]);
            expect(w.server.sessions()).toEqual([]);
        } finally { await w.close(); }
    });
});
