// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Picture messages (MMS) against runtime/phoenix-runtime.js: sending and
// receiving, threads, unread counts, the shell's notifications; and what
// Messaging asks of the IM transports (which are connectors with tests of
// their own: apps/xmpp, apps/matrix, ...).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./bridge";
import { db } from "./db8";
import { AVAILABILITY, IM_LOGIN_KIND, messaging, presenceClass, serviceLabel, takesPictures, transportService, type ChatThread,
         type Message } from "./messaging";

const REPO = resolve(__dirname, "../../../..");

interface Rt {
    simulateIncomingMms(o?: object): Promise<string>;
    seedPhoneDemoData(force: boolean): boolean;
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

// The IM transports are connectors now, each with its own tests (apps/xmpp,
// apps/matrix, ...: their service/connector.test.ts); Messaging with them,
// in Chromium: tools/test-xmpp.cjs. Here, what Messaging asks of them.
describe("instant messaging transports", () => {
    it("names each service, its transport and whether it takes pictures", () => {
        expect(serviceLabel("type_jabber")).toBe("Jabber (XMPP)");
        expect(serviceLabel("type_matrix")).toBe("Matrix");
        expect(transportService("type_jabber")).toBe("org.webosphoenix.service.xmpp");
        expect(transportService("type_matrix")).toBe("org.webosphoenix.service.matrix");
        expect(transportService("sms")).toBeUndefined();
        expect(takesPictures("sms")).toBe(true);
        expect(takesPictures("type_jabber")).toBe(true);
        expect(takesPictures("type_fediverse")).toBe(false);
        expect(presenceClass(AVAILABILITY.BUSY)).toBe("busy");
    });
    it("asks the account's transport to set your status", async () => {
        const seen: unknown[] = [];
        const state = { _kind: IM_LOGIN_KIND, accountId: "acc-m", username: "me@example.org", serviceName: "type_matrix", state: "online", availability: 0 };
        await db.put([state]);
        await messaging.setPresence("acc-m", AVAILABILITY.BUSY).catch((e: { errorText?: string }) => seen.push(e.errorText));
        // No Matrix service runs in this page: the call went to it, by name.
        expect(String(seen[0] || "")).toMatch(/org\.webosphoenix\.service\.matrix|matrix/i);
    });
});
