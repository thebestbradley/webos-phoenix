// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Picture messages (MMS) and instant messages (the simulated Jabber / XMPP
// transport) against runtime/phoenix-runtime.js: sending and receiving,
// threads, unread counts, the shell's notifications, the IM account's
// sign-in through the accounts service, the roster with presence (tempdb)
// and your own status.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./bridge";
import { db, tempdb } from "./db8";
import { AVAILABILITY, IM_BUDDY_KIND, IM_LOGIN_KIND, messaging, presenceClass, serviceLabel, type ChatThread, type ImBuddy,
         type ImLoginState, type Message } from "./messaging";

const REPO = resolve(__dirname, "../../../..");
const TEMPLATE = "/usr/share/phoenix/runtime/accounts/com.webosphoenix.xmpp/com.webosphoenix.xmpp.json";

interface Rt {
    simulateIncomingMms(o?: object): Promise<string>;
    simulateIncomingIm(o?: object): string | null;
    seedPhoneDemoData(force: boolean): boolean;
    xmpp: { setBuddyPresence(jid: string, availability: number, status?: string): boolean };
}
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
let rt: Rt;

// The simulated network takes its time (sending, a buddy's answer two
// seconds later), which a busy machine stretches.
vi.setConfig({ testTimeout: 20000 });

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    rt = w.__phoenixRuntime as Rt;
    const files: Record<string, string> = {
        "/usr/share/phoenix/runtime/sample-data.js": readFileSync(resolve(REPO, "runtime/sample-data.js"), "utf8"),
        [TEMPLATE]: readFileSync(resolve(REPO, "runtime/accounts/com.webosphoenix.xmpp/com.webosphoenix.xmpp.json"), "utf8"),
    };
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) => files[p];
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
    rt.seedPhoneDemoData(true);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 4000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
        const v = await read();
        if (ok(v)) return v;
        if (Date.now() > until) throw new Error("timed out; last: " + JSON.stringify(v));
        await wait(50);
    }
}
const threadOf = async (id: string) => (await db.get<ChatThread>([id]))[0];
const messagesOf = (id: string) => db.find<Message>({ from: "com.palm.message:1", where: [{ prop: "conversations", op: "=", val: id }] });

// A picture of the user's: the file manager stores it (a few JPEG bytes will do).
async function aPicture(path = "/media/internal/Pictures/pier.jpg") {
    await call("luna://org.webosphoenix.filemanager/write", { path, data: btoa("\xff\xd8\xff\xe0 pier \xff\xd9"), encoding: "base64" });
    return path;
}

describe("picture messages (MMS)", () => {
    it("sends a picture with its text: the store keeps a copy, telephony sends it", async () => {
        const pic = await aPicture();
        const [threadId] = await messaging.sendMms({ addr: "(408) 555-0142", name: "Ada Palmer" }, "Look at this",
                                                   [{ path: pic, mimeType: "image/jpeg", name: "pier.jpg" }]);
        expect(threadId).toBeTruthy();
        const t = await threadOf(threadId);
        expect(t).toMatchObject({ displayName: "Ada Palmer", summary: "Picture: Look at this", replyService: "mms" });
        const [m] = (await messagesOf(threadId)).filter((x) => x._kind === "com.palm.mmsmessage:1");
        expect(m).toMatchObject({ folder: "outbox", serviceName: "mms", messageText: "Look at this" });
        expect(m.parts![0]).toMatchObject({ mimeType: "image/jpeg", name: "pier.jpg" });
        expect(m.parts![0].path).toMatch(/^\/media\/internal\/\.mms\/.+-pier\.jpg$/);
        // The copy is whole, and the message keeps it when the original goes.
        await call("luna://org.webosphoenix.filemanager/remove", { path: pic });
        const kept = await call("luna://org.webosphoenix.filemanager/stat", { path: m.parts![0].path }) as unknown as { entry: { size: number } };
        expect(kept.entry.size).toBe(12);
        const sent = await eventually(() => db.get<Message>([m._id!]), ([x]) => x?.status === "successful");
        expect(sent[0].status).toBe("successful");
    });

    it("receives one: a thread, unread, and a notification saying it is a picture", async () => {
        const pic = await aPicture("/media/internal/Pictures/harbor.jpg");
        const threadId = await rt.simulateIncomingMms({ from: "(408) 555-0142", text: "We made it", image: pic });
        const t = await threadOf(threadId);
        expect(t).toMatchObject({ displayName: "Ada Palmer", unreadCount: 1, summary: "Picture: We made it" });
        const [m] = await messagesOf(threadId).then((all) => all.filter((x) => x._kind === "com.palm.mmsmessage:1"));
        expect(m).toMatchObject({ folder: "inbox", from: { addr: "(408) 555-0142" } });
        expect(m.parts![0].path.startsWith("/media/internal/.mms/")).toBe(true);
        const note = hostMessages.find((h) => h.type === "notification");
        expect(note?.payload).toMatchObject({ appId: "org.webosphoenix.messaging", title: "Ada Palmer", body: "Picture: We made it",
                                              params: { threadId } });
        await messaging.markRead(threadId);
        expect((await threadOf(threadId)).unreadCount).toBe(0);
    });

    it("keeps the message's pictures out of Photos", async () => {
        const pic = await aPicture("/media/internal/Pictures/kept.jpg");
        await rt.simulateIncomingMms({ image: pic, text: "" });
        await call("luna://com.webos.service.mediaindexer/requestMediaScan", { path: "/media/internal" });
        const list = await call("luna://com.webos.service.mediaindexer/getImageList", { uri: "storage:///media/internal" }) as unknown as
            { imageList: { results: { file_path: string }[] } };
        expect(list.imageList.results.some((r) => r.file_path.includes("/.mms/"))).toBe(false);
    });
});

describe("instant messaging (simulated Jabber / XMPP)", () => {
    async function signIn(username = "me@chat.example") {
        const checked = await call("luna://org.webosphoenix.service.xmpp/checkCredentials", { username, password: "secret" });
        expect(checked).toMatchObject({ credentials: { common: { password: "secret" } } });
        const r = await call("luna://com.palm.service.accounts/createAccount", {
            templateId: "com.webosphoenix.xmpp", username, capabilityProviders: [{ id: "com.webosphoenix.xmpp.im" }],
            credentials: { common: { password: "secret" } },
        }) as unknown as { result: { _id: string } };
        // onCreate, then onEnabled(true): signed in, with the roster.
        await eventually(() => db.find<ImLoginState>({ from: IM_LOGIN_KIND }), (s) => s.some((x) => x.state === "online"));
        return r.result._id;
    }
    const buddies = () => tempdb.find<ImBuddy>({ from: IM_BUDDY_KIND });

    it("checks credentials as the Accounts app asks", async () => {
        await expect(call("luna://org.webosphoenix.service.xmpp/checkCredentials", { username: "me", password: "x" }))
            .rejects.toMatchObject({ errorText: expect.stringMatching(/like you@chat\.example/) });
        await expect(call("luna://org.webosphoenix.service.xmpp/checkCredentials", { username: "me@elsewhere.example", password: "x" }))
            .rejects.toMatchObject({ errorCode: "HOST_NOT_FOUND" });
        await expect(call("luna://org.webosphoenix.service.xmpp/checkCredentials", { username: "me@chat.example", password: "" }))
            .rejects.toMatchObject({ errorCode: "401_UNAUTHORIZED" });
        const t = await call("luna://com.palm.service.accounts/listAccountTemplates", { capability: "MESSAGING" }) as unknown as
            { results: { templateId: string; loc_name: string }[] };
        expect(t.results.find((x) => x.templateId === "com.webosphoenix.xmpp")?.loc_name).toBe("Jabber (XMPP)");
    });

    it("signs in when the account is made: its state, and the roster with presence linked to Contacts", async () => {
        const accountId = await signIn();
        const [state] = await db.find<ImLoginState>({ from: IM_LOGIN_KIND });
        expect(state).toMatchObject({ accountId, username: "me@chat.example", serviceName: "type_jabber", state: "online", availability: 0 });
        const roster = await buddies();
        const ada = roster.find((b) => b.username === "ada.palmer@chat.example")!;
        expect(ada).toMatchObject({ accountId, displayName: "Ada Palmer", availability: AVAILABILITY.AVAILABLE, status: "Flashing a Pre 3" });
        const [person] = await db.get<{ _kind: string; name: { givenName: string } }>([ada.personId!]);
        expect(person.name.givenName).toBe("Ada");
        expect(presenceClass(roster.find((b) => b.username.startsWith("marcus"))!.availability)).toBe("busy");
        expect(presenceClass(roster.find((b) => b.username.startsWith("theo"))!.availability)).toBe("offline");
        expect(serviceLabel("type_jabber")).toBe("Jabber (XMPP)");
    });

    it("sends an instant message, and the buddy answers: threaded, unread, notified", async () => {
        await signIn();
        const [threadId] = await messaging.sendIm("type_jabber", "me@chat.example", { addr: "ada.palmer@chat.example", name: "Ada Palmer" },
                                                  "Running Phoenix?");
        const t = await threadOf(threadId);
        expect(t).toMatchObject({ replyService: "type_jabber", replyAddress: "ada.palmer@chat.example", username: "me@chat.example",
                                  displayName: "Ada Palmer" });
        expect(t.personId).toBeTruthy();
        const all = await eventually(() => messagesOf(threadId), (ms) => ms.some((x) => x.folder === "inbox"));
        expect(all.find((x) => x.folder === "outbox")).toMatchObject({ status: "successful", _kind: "com.palm.immessage.xmpp:1" });
        expect(all.find((x) => x.folder === "inbox")).toMatchObject({ messageText: "Ha, yes!", from: { addr: "ada.palmer@chat.example" } });
        expect((await threadOf(threadId)).unreadCount).toBe(1);
        expect(hostMessages.find((h) => h.type === "notification")?.payload).toMatchObject({ title: "Ada Palmer", body: "Ha, yes!" });
        // Texts to Ada's number stay a conversation of their own.
        const sms = (await db.find<ChatThread>({ from: "com.palm.chatthread:1" })).find((x) => x.replyService === "sms" && x.displayName === "Ada Palmer");
        expect(sms?._id).not.toBe(threadId);
    });

    it("an offline buddy does not answer; signed out, nothing is sent", async () => {
        const accountId = await signIn();
        const [t1] = await messaging.sendIm("type_jabber", "me@chat.example", { addr: "theo.lindqvist@chat.example" }, "Hello?");
        await wait(2600);
        expect((await messagesOf(t1)).filter((m) => m.folder === "inbox")).toEqual([]);
        await messaging.setPresence(accountId, AVAILABILITY.OFFLINE);
        expect((await db.find<ImLoginState>({ from: IM_LOGIN_KIND }))[0]).toMatchObject({ state: "offline", availability: 4 });
        expect(await buddies()).toEqual([]);
        const [t2] = await messaging.sendIm("type_jabber", "me@chat.example", { addr: "ada.palmer@chat.example" }, "Anyone?");
        const m = await eventually(() => messagesOf(t2), (ms) => ms.some((x) => x.status === "failed"));
        expect(m.find((x) => x.messageText === "Anyone?")?.status).toBe("failed");
        // Busy is signed in, and shows so.
        await messaging.setPresence(accountId, AVAILABILITY.BUSY);
        expect((await db.find<ImLoginState>({ from: IM_LOGIN_KIND }))[0]).toMatchObject({ state: "online", availability: 2 });
        expect((await buddies()).length).toBe(4);
    });

    it("receives a message from a buddy, and follows their presence", async () => {
        await signIn();
        const threadId = rt.simulateIncomingIm({ from: "lena.okafor@chat.example", text: "Just landed" })!;
        expect(await threadOf(threadId)).toMatchObject({ displayName: "Lena Okafor", unreadCount: 1, summary: "Just landed" });
        expect(rt.xmpp.setBuddyPresence("lena.okafor@chat.example", AVAILABILITY.BUSY, "Driving")).toBe(true);
        const lena = (await buddies()).find((b) => b.username === "lena.okafor@chat.example");
        expect(lena).toMatchObject({ availability: 2, status: "Driving" });
    });

    it("deleting the account takes its conversations", async () => {
        const accountId = await signIn();
        const id = rt.simulateIncomingIm({ text: "hi" })!;
        await call("luna://com.palm.service.accounts/deleteAccount", { accountId });
        await eventually(() => db.find<ImLoginState>({ from: IM_LOGIN_KIND }), (s) => s.length === 0);
        expect(await threadOf(id)).toBeUndefined();
        expect(await buddies()).toEqual([]);
    });
});
