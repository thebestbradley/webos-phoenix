// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The telephony, messaging, contacts and db8 clients against the simulated
// legacy services in runtime/phoenix-runtime.js (as runtime.test.ts does for
// the Settings services).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LunaError } from "./bridge";
import { contacts, matchNumber, normalizePhoneNumber, personDisplayName, phoneTypeLabel, sameNumber, type Person } from "./contacts";
import { db } from "./db8";
import { messaging, type ChatThread, type Message } from "./messaging";
import { primaryCall, ringingCall, telephony, type CallStatus } from "./telephony";

interface Rt {
    simulateIncomingCall(o?: object): number;
    simulateRemoteHangup(): boolean;
    simulateIncomingSms(o?: object): string;
    seedPhoneDemoData(force: boolean): boolean;
}
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
let rt: Rt;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
    rt = w.__phoenixRuntime as Rt;
    // The demo people are the runtime's sample contacts, which it reads with
    // PalmSystem.getResource (a synchronous request jsdom cannot serve).
    const sample = readFileSync(resolve(__dirname, "../../../../runtime/sample-data.js"), "utf8");
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource =
        (p: string) => (p.endsWith("/runtime/sample-data.js") ? sample : undefined);
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
    rt.seedPhoneDemoData(true);
});

const until = <T,>(start: (cb: (v: T) => void) => { cancel(): void }, pred: (v: T) => boolean, ms = 4000) =>
    new Promise<T>((res, rej) => {
        const timer = setTimeout(() => { sub.cancel(); rej(new Error("timed out")); }, ms);
        const sub = start((v) => { if (pred(v)) { clearTimeout(timer); sub.cancel(); res(v); } });
    });

describe("contacts helpers", () => {
    it("normalises numbers like the contacts linker (digits, reversed)", () => {
        expect(normalizePhoneNumber("(408) 555-0142")).toBe("2410555804");
    });
    it("matches numbers on their last seven digits", () => {
        expect(sameNumber("+1 408 555 0142", "(408) 555-0142")).toBe(true);
        expect(sameNumber("555-0142", "(408) 555-0142")).toBe(true);
        expect(sameNumber("555-0143", "(408) 555-0142")).toBe(false);
        expect(sameNumber("911", "112")).toBe(false);
        expect(sameNumber("", "")).toBe(false);
    });
    it("names people and number types", () => {
        const p: Person = { _kind: "com.palm.person:1", name: { givenName: "Ada", familyName: "Palmer" } };
        expect(personDisplayName(p)).toBe("Ada Palmer");
        expect(personDisplayName({ _kind: "x", phoneNumbers: [{ value: "555" }] })).toBe("555");
        expect(phoneTypeLabel("type_mobile")).toBe("Mobile");
        expect(phoneTypeLabel(undefined)).toBe("Other");
    });
    it("reads the demo contacts and favourites from com.palm.person:1", async () => {
        const all = await contacts.all();
        expect(all.length).toBeGreaterThanOrEqual(7);
        const favs = await until<Person[]>((cb) => contacts.watchFavorites(cb), () => true);
        expect(favs.every((p) => p.favorite)).toBe(true);
        expect(matchNumber(all, "+14085550142")?.person.name?.givenName).toBe("Ada");
        expect(matchNumber(all, "(650) 555-0110")?.number.type).toBe("type_work");
    });
});

describe("com.palm.telephony (simulated)", () => {
    it("dials, connects and hangs up", async () => {
        await telephony.dial("(212) 555-0164");
        const ringing = await until<CallStatus>((cb) => telephony.watchCalls(cb), (s) => s.calls.length > 0);
        expect(ringing.calls[0]).toMatchObject({ state: "dialing", direction: "outgoing", number: "(212) 555-0164" });
        const up = await until<CallStatus>((cb) => telephony.watchCalls(cb), (s) => s.calls[0]?.state === "active");
        const c = primaryCall(up.calls)!;
        expect(c.connectTime).toBeGreaterThan(0);
        await telephony.setMuted(true);
        await telephony.setSpeaker(true);
        await telephony.sendDtmf("12#");
        let s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(s).toMatchObject({ muted: true, speaker: true });
        await telephony.hold(c.id);
        s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(s.calls[0].state).toBe("held");
        await telephony.unhold(c.id);
        await telephony.hangup(c.id);
        s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(s.calls[0]).toMatchObject({ state: "disconnected", disconnectReason: "local" });
        expect(s.muted).toBe(false);
        expect(primaryCall(s.calls)).toBeNull();
    });

    it("rejects bad requests", async () => {
        await expect(telephony.dial("")).rejects.toBeInstanceOf(LunaError);
        await expect(telephony.answer(99)).rejects.toBeInstanceOf(LunaError);
        await expect(telephony.sendDtmf("1")).rejects.toBeInstanceOf(LunaError);
    });

    it("refuses to dial in airplane mode", async () => {
        localStorage.setItem("phoenix:settings:state", JSON.stringify({ offlineMode: true }));
        const e = await telephony.dial("555-0100").catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorText).toMatch(/airplane/);
    });

    it("rings with an incoming call that can be answered or ignored", async () => {
        const id = rt.simulateIncomingCall({ number: "(408) 555-0142" });
        let s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(ringingCall(s.calls)?.id).toBe(id);
        await telephony.answer(id);
        s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(primaryCall(s.calls)).toMatchObject({ id, state: "active", direction: "incoming" });
        // A second call waits; answering it holds the first.
        const id2 = rt.simulateIncomingCall({ number: "(303) 555-0135" });
        s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(ringingCall(s.calls)).toMatchObject({ id: id2, state: "waiting" });
        await telephony.ignore(id2);
        s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(s.calls.find((c) => c.id === id2)).toMatchObject({ state: "disconnected", ignored: true });
        expect(rt.simulateRemoteHangup()).toBe(true);
        s = await until<CallStatus>((cb) => telephony.watchCalls(cb), () => true);
        expect(s.calls.find((c) => c.id === id)).toMatchObject({ state: "disconnected", disconnectReason: "remote" });
    });

    it("reports voicemail", async () => {
        const v = await until((cb: (v: { number: string; count: number }) => void) => telephony.watchVoicemail(cb), () => true);
        expect(v.number).toMatch(/555/);
        expect(v.count).toBeGreaterThan(0);
    });
});

describe("messaging (simulated)", () => {
    it("lists the demo conversations newest first", async () => {
        const threads = await until<ChatThread[]>((cb) => messaging.watchThreads(cb), () => true);
        expect(threads.map((t) => t.displayName)).toEqual(["Marcus Reyes", "Lena Okafor", "Ada Palmer"]);
        expect(threads[0].unreadCount).toBe(1);
    });

    it("sends a text: putMessage assigns the thread and telephony sends it", async () => {
        const [threadId] = await messaging.sendSms({ addr: "(408) 555-0142", name: "Ada Palmer" }, "On my way");
        const threads = await until<ChatThread[]>((cb) => messaging.watchThreads(cb), () => true);
        expect(threads[0]).toMatchObject({ _id: threadId, displayName: "Ada Palmer", summary: "On my way" });
        const sent = await until<Message[]>((cb) => messaging.watchMessages(threadId, cb),
            (ms) => ms[ms.length - 1]?.status === "successful");
        expect(sent[sent.length - 1]).toMatchObject({ folder: "outbox", messageText: "On my way", _kind: "com.palm.smsmessage:1" });
        expect(sent.length).toBe(4);
    });

    it("starts a new thread for an unknown number", async () => {
        const [threadId] = await messaging.sendSms({ addr: "555-0177" }, "Hello");
        const [t] = await db.get<ChatThread>([threadId]);
        expect(t.displayName).toBe("555-0177");
        expect(t.personId).toBeUndefined();
    });

    it("receives a text, counts it unread and tells the shell", async () => {
        const threadId = rt.simulateIncomingSms({ from: "+1 212 555 0164", text: "Call me" });
        const [t] = await db.get<ChatThread>([threadId]);
        expect(t).toMatchObject({ displayName: "Lena Okafor", unreadCount: 1, summary: "Call me" });
        const note = hostMessages.find((m) => m.type === "notification");
        expect(note?.payload).toMatchObject({ appId: "org.webosphoenix.messaging", title: "Lena Okafor", body: "Call me" });
        await messaging.markRead(threadId);
        const [r] = await db.get<ChatThread>([threadId]);
        expect(r.unreadCount).toBe(0);
        const ms = await db.find<Message>({ from: "com.palm.message:1", where: [{ prop: "conversations", op: "=", val: threadId }] });
        expect(ms.every((m) => m.folder !== "inbox" || m.flags?.read)).toBe(true);
    });

    it("deletes a conversation", async () => {
        const threads = await db.find<ChatThread>({ from: "com.palm.chatthread:1" });
        await messaging.deleteThread(threads[0]._id!);
        const left = await db.find<ChatThread>({ from: "com.palm.chatthread:1" });
        expect(left.length).toBe(threads.length - 1);
    });
});
