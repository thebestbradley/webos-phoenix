// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What did I miss, messages said aloud, driving mode (lib/commands-notify.js,
// lib/lang/en-notify.js): the words, the shell's notification list read
// grouped by app and newest first, the lock screen's previews respected,
// Do Not Disturb while driving and back as it was, and a message read
// aloud answered by voice.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });

const NOTES = [
    { id: "n1", appId: "org.webosphoenix.messaging", app: "Messaging", title: "Sam Delgado", body: "Running 5 min late", time: NOW - 600e3 },
    { id: "n2", appId: "com.palm.app.email", app: "Email", title: "Alex Rivera", body: "Invoice 2231", time: NOW - 3600e3 },
    { id: "n3", appId: "org.webosphoenix.messaging", app: "Messaging", title: "Priya Nair", body: "Lunch at noon?", time: NOW - 1200e3 },
    { id: "n4", appId: "org.webosphoenix.files", app: "Files", title: "Downloading", body: "50%", time: NOW, ongoing: true },
];
function withNotes(extra: object = {}) {
    const spoken: string[] = [];
    const d = device({ deps: { tts: { speak: (t: string) => { spoken.push(t); return Promise.resolve(); }, stop: () => undefined } }, ...extra });
    d.state.notifications = NOTES.map((n) => ({ ...n }));
    return Object.assign(d, { spoken });
}

describe("the words", () => {
    it("asks for the notifications in the ways people do", () => {
        for (const t of ["what did I miss", "What did I miss?", "what have I missed", "did I miss anything", "catch me up", "read my notifications",
                         "read me my notifications", "any notifications", "do I have any new notifications", "what notifications do I have",
                         "check my notifications", "show me my notifications", "go through my notifications"])
            expect(parse(t), t).toEqual({ command: "notifications", args: { app: "" } });
        expect(parse("read my notifications from Messaging")).toEqual({ command: "notifications", args: { app: "messaging" } });
        expect(parse("any notifications from my email")).toEqual({ command: "notifications", args: { app: "email" } });
        expect(parse("what notifications do I have today")).toEqual({ command: "notifications", args: { app: "" } });
    });
    it("leaves missed calls and small talk alone", () => {
        expect(parse("did I miss any calls")?.command).toBe("callLog");
        expect(parse("what's new")?.command).toBe("chat");
        expect(parse("read my new messages")?.command).toBe("readMessages");
    });
    it("turns driving mode on and off, and asks about it", () => {
        for (const t of ["I'm driving", "im driving", "I'm in the car", "turn on driving mode", "start driving mode", "driving mode on", "put me in driving mode"])
            expect(parse(t), t).toEqual({ command: "drivingMode", args: { state: "on" } });
        for (const t of ["driving mode off", "turn off driving mode", "I'm done driving", "I'm not driving anymore", "I've arrived", "exit driving mode"])
            expect(parse(t), t).toEqual({ command: "drivingMode", args: { state: "off" } });
        for (const t of ["am I in driving mode", "is driving mode on"]) expect(parse(t), t).toEqual({ command: "drivingMode", args: { state: "status" } });
    });
    it("turns announcing messages on and off", () => {
        for (const t of ["announce my messages on my headphones", "announce messages", "read my texts aloud when they come in", "turn on announce messages"])
            expect(parse(t), t).toEqual({ command: "announceMessages", args: { state: "on" } });
        for (const t of ["stop announcing messages", "turn off announce messages", "stop reading my messages aloud"])
            expect(parse(t), t).toEqual({ command: "announceMessages", args: { state: "off" } });
        expect(parse("are you announcing my messages")).toEqual({ command: "announceMessages", args: { state: "status" } });
    });
});

describe("what did I miss", () => {
    it("reads them by app, the newest app first and each app's newest first, without what is still going on", async () => {
        const d = withNotes();
        const m = await d.ask("what did I miss");
        expect(m).toMatchObject({ command: "notifications", status: "done" });
        expect(m.text).toBe("You have 3 notifications. From Messaging: Sam Delgado, “Running 5 min late”; Priya Nair, “Lunch at noon?” From Email: Alex Rivera, “Invoice 2231”.");
        const cards = m.data.attachments[0].items;
        expect(cards.map((c: any) => c.title)).toEqual(["Sam Delgado", "Priya Nair", "Alex Rivera"]);
        expect(cards[0]).toMatchObject({ detail: "Running 5 min late", open: { appId: "org.webosphoenix.messaging" } });
        expect(d.called("org.webosphoenix.system/getNotifications")).toHaveLength(1);
    });
    it("reads one app's, and says when there are none", async () => {
        const d = withNotes();
        const m = await d.ask("read my notifications from email");
        expect(m.text).toBe("You have 1 notification. Email: Alex Rivera, “Invoice 2231”.");
        expect(m.data.open).toMatchObject({ appId: "com.palm.app.email" });
        expect((await d.ask("any notifications from photos")).text).toBe("No notifications from Photos.");
        d.state.notifications = [];
        expect((await d.ask("what did I miss")).text).toBe("Nothing new: you're all caught up.");
    });
    it("says only how many and from which app over the lock screen with previews off", async () => {
        const d = withNotes();
        d.state.deviceLocked = true;
        d.state.previews = false;
        const m = await d.ask("what did I miss", { locked: true, voice: true });
        expect(m).toMatchObject({ command: "notifications", status: "done" });
        expect(m.text).toBe("You have 3 notifications: 2 from Messaging and 1 from Email. Unlock your phone to hear what they say.");
        expect(m.text).not.toMatch(/Sam|Invoice/);
        expect(m.data?.attachments).toBeUndefined();
        // Previews on: the lock screen shows them, so it says them.
        d.state.previews = true;
        expect((await d.ask("what did I miss", { locked: true, voice: true })).text).toMatch(/^You have 3 notifications\. From Messaging: Sam Delgado/);
    });
    it("says no more than six by name", async () => {
        const d = withNotes();
        d.state.notifications = Array.from({ length: 9 }, (_, i) => ({ id: "m" + i, appId: "org.webosphoenix.messaging", app: "Messaging",
                                                                      title: "Person " + i, body: "Hi " + i, time: NOW - i * 60e3 }));
        const m = await d.ask("what did I miss");
        expect(m.text).toBe("You have 9 notifications. From Messaging: Person 0, “Hi 0”; Person 1, “Hi 1”; Person 2, “Hi 2”; 6 more.");
    });
});

describe("driving mode", () => {
    it("quiets the phone and puts it back as it was", async () => {
        const d = withNotes();
        expect(d.state.ringtones).toBe(60);
        let m = await d.ask("I'm driving");
        expect(m).toMatchObject({ command: "drivingMode", status: "done" });
        expect(m.text).toMatch(/^Driving mode is on\./);
        expect(d.state.ringtones).toBe(0);
        expect((await d.ask("turn on driving mode")).text).toBe("Driving mode is already on.");
        d.setNow(NOW + 25 * 60e3);
        expect((await d.ask("am I in driving mode")).text).toBe("Yes, driving mode has been on for 25 minutes.");
        m = await d.ask("I'm done driving");
        expect(m.text).toBe("Driving mode is off after 25 minutes. Your notifications are back as they were.");
        expect(d.state.ringtones).toBe(60);
    });
    it("leaves Do Not Disturb on when it was on before", async () => {
        const d = withNotes();
        await d.ask("turn on do not disturb");
        await d.ask("I'm driving");
        await d.ask("driving mode off");
        expect(d.state.ringtones).toBe(0);
        expect(d.storage.get("assistant:driving")).toMatchObject({ on: false });
    });
    it("may be turned on by voice over the lock screen", async () => {
        const d = withNotes();
        const m = await d.ask("I'm driving", { locked: true, voice: true });
        expect(m).toMatchObject({ command: "drivingMode", status: "done" });
    });
    it("reads a message aloud as it comes and takes the reply by voice, read back first", async () => {
        const d = withNotes();
        await d.ask("I'm driving");
        const a = await d.svc.announce({ appId: "org.webosphoenix.messaging", app: "Messaging", title: "Sam Delgado", body: "Where are you?", headphones: false });
        expect(a).toMatchObject({ returnValue: true, spoken: true, listen: true, text: "Sam Delgado says: Where are you? Want to reply?" });
        expect(d.spoken.at(-1)).toBe("Sam Delgado says: Where are you? Want to reply?");
        let m = await d.ask("yes", { voice: true });
        expect(m).toMatchObject({ command: "replyTo", status: "ask", text: "What should I say to Sam Delgado?" });
        m = await d.ask("almost there", { voice: true });
        expect(m).toMatchObject({ command: "replyMessage", status: "pending", text: "Send \"Almost there\" to Sam Delgado?" });
        m = await d.ask("yes", { voice: true });
        expect(m).toMatchObject({ command: "replyMessage", status: "done" });
        expect(d.called("putMessage").at(-1)?.params.message).toMatchObject({ messageText: "Almost there", to: [{ addr: "3035550135" }] });
    });
    it("lets the question go on a no, and takes a whole reply at once", async () => {
        const d = withNotes();
        await d.ask("I'm driving");
        await d.svc.announce({ appId: "org.webosphoenix.messaging", app: "Messaging", title: "Sam Delgado", body: "OK" });
        expect(await d.ask("no", { voice: true })).toMatchObject({ status: "cancelled", text: "OK, I won't." });
        await d.svc.announce({ appId: "org.webosphoenix.messaging", app: "Messaging", title: "Sam Delgado", body: "OK" });
        expect(await d.ask("reply on my way", { voice: true })).toMatchObject({ command: "replyMessage", status: "pending" });
        expect(d.called("putMessage")).toHaveLength(0);
    });
    it("says nothing for other apps, or when it is off", async () => {
        const d = withNotes();
        expect(await d.svc.announce({ appId: "org.webosphoenix.messaging", title: "Sam", body: "Hi", headphones: true })).toMatchObject({ spoken: false });
        await d.ask("I'm driving");
        expect(await d.svc.announce({ appId: "com.palm.app.email", title: "Alex", body: "Invoice" })).toMatchObject({ spoken: false });
        expect(d.spoken).toEqual([]);
    });
    it("is set from Settings too", async () => {
        const d = withNotes();
        expect(await d.svc.driving({})).toMatchObject({ on: false });
        expect(await d.svc.driving({ on: true })).toMatchObject({ on: true, since: NOW });
        expect(d.state.ringtones).toBe(0);
        expect(await d.svc.driving({ on: false })).toMatchObject({ on: false });
        expect(d.state.ringtones).toBe(60);
    });
});

describe("announcing messages on headphones", () => {
    it("is off until asked for, then says messages while headphones are in", async () => {
        const d = withNotes();
        expect((await d.ask("are you announcing my messages")).text).toMatch(/^No/);
        const m = await d.ask("announce my messages on my headphones");
        expect(m).toMatchObject({ command: "announceMessages", status: "done" });
        expect((await d.svc.getSettings({})).settings.announceMessages).toBe(true);
        expect(await d.svc.announce({ appId: "org.webosphoenix.messaging", title: "Priya Nair", body: "Lunch?", headphones: false })).toMatchObject({ spoken: false });
        expect(await d.svc.announce({ appId: "org.webosphoenix.messaging", title: "Priya Nair", body: "Lunch?", headphones: true }))
            .toMatchObject({ spoken: true, listen: false, text: "Priya Nair says: Lunch?" });
        await d.ask("stop announcing messages");
        expect((await d.svc.getSettings({})).settings.announceMessages).toBe(false);
    });
    it("is the system UI's to call", async () => {
        const d = device({ deps: { caller: () => "com.example.app" } });
        expect(await d.svc.announce({ appId: "org.webosphoenix.messaging", title: "Sam", body: "Hi" })).toMatchObject({ returnValue: false });
    });
});
