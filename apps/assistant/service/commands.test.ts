// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's everyday commands end to end through the service
// (assistant.js -> lib/commands.js) against a small stand-in for the
// device: a db8 that keeps what is put, the activity manager, audio,
// display, power. Each test checks the Luna calls a device would see and
// that the data is there afterwards (the event in db8 for Calendar, the
// task in its list for Tasks, ...), and what the assistant says.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Reply = { returnValue: boolean; errorText?: string; [k: string]: any };
type Msg = { id: string; role: string; text: string; status?: string; command?: string; confirm?: any; choices?: { id: string; label: string }[]; data?: any };
const req = createRequire(import.meta.url);
const { createAssistantService } = req("./assistant.js") as { createAssistantService(d: object): Record<string, (p?: object) => Promise<Reply>> };

// Wednesday 7 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();

function device(opts: { offline?: boolean } = {}) {
    let n = 0;
    const db = new Map<string, any>();
    const put = (o: any) => { const id = o._id || "db" + ++n; db.set(id, { ...o, _id: id }); return id; };
    // What the device starts with.
    put({ _id: "acct-profile", _kind: "com.palm.account:1", templateId: "com.palm.palmprofile" });
    put({ _id: "cal-local", _kind: "com.palm.calendar:1", accountId: "acct-profile", name: "Phoenix Account", isReadOnly: false, syncSource: "Local" });
    put({ _id: "cal-ro", _kind: "com.palm.calendar:1", accountId: "x", name: "Holidays", isReadOnly: true });
    put({ _id: "ev-standup", _kind: "com.palm.calendarevent:1", calendarId: "cal-local", subject: "Team stand-up", dtstart: at(5, 9, 30), dtend: at(5, 10), allDay: false,
          rrule: { freq: "WEEKLY", interval: 1, rules: [{ ruleType: "BYDAY", ruleValue: [1, 2, 3, 4, 5].map((day) => ({ day })) }] } });
    put({ _id: "ev-dentist", _kind: "com.palm.calendarevent:1", calendarId: "cal-local", subject: "Dentist", location: "Downtown Dental", dtstart: at(9, 14), dtend: at(9, 15), allDay: false });
    put({ _id: "p-sam", _kind: "com.palm.person:1", name: { givenName: "Sam", familyName: "Delgado" }, phoneNumbers: [{ value: "(303) 555-0135", type: "type_mobile" }],
          emails: [{ value: "sam@example.com", type: "type_home" }] });
    put({ _id: "p-priya", _kind: "com.palm.person:1", name: { givenName: "Priya", familyName: "Nair" }, phoneNumbers: [{ value: "(415) 555-0123", type: "type_mobile" }], emails: [] });
    put({ _id: "list-inbox", _kind: "com.palm.tasklist:1", name: "Inbox", isDefault: true });
    put({ _id: "memo-1", _kind: "com.palm.note:1", text: "Wi-Fi at the cabin: network Lakeview", color: "yellow", position: "m" });
    put({ _id: "memo-2", _kind: "com.palm.note:1", text: "Books to read", color: "pink", position: "n" });
    put({ _id: "alarm-7", _kind: "com.palm.clock.alarm:1", key: "clockAlarm1", hour: 7, minute: 0, occurs: "weekdays", enabled: true, niceTime: "7:00 AM" });
    put({ _id: "alarm-630", _kind: "com.palm.clock.alarm:1", key: "clockAlarm2", hour: 18, minute: 30, occurs: "once", enabled: true, niceTime: "6:30 PM" });
    put({ _id: "mail-acct", _kind: "com.palm.mail.account:1", accountId: "acct-mail", email: "jordan@example.com", realName: "Jordan Avery" });
    put({ _id: "mail-1", _kind: "com.palm.email:1", subject: "Invoice 2231", from: { name: "Alex Rivera", addr: "alex@example.com" }, summary: "Your invoice", timestamp: NOW - 3600e3, flags: { read: false, visible: true } });
    put({ _id: "mail-2", _kind: "com.palm.email:1", subject: "Lunch today?", from: { name: "Priya Nair", addr: "priya@example.net" }, summary: "Noon?", timestamp: NOW - 7200e3, flags: { read: true, visible: true } });
    put({ _id: "sms-1", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Running 5 min late", from: { addr: "3035550135" }, localTimestamp: NOW - 600e3, threadId: "t-sam" });
    put({ _id: "sms-2", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Lunch at noon?", from: { addr: "4155550123" }, localTimestamp: NOW - 3600e3, threadId: "t-priya" });
    put({ _id: "img-1", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/a.jpg", createdTime: at(6, 15) });
    put({ _id: "img-2", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/b.jpg", createdTime: at(6, 16) });
    put({ _id: "img-3", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/c.jpg", createdTime: at(1, 9) });

    const calls: { uri: string; params: any }[] = [];
    const state = { volume: 50, muted: false, ringtones: 60, brightness: 70, activities: new Map<string, any>() };
    const okr = (o: object = {}) => Promise.resolve({ returnValue: true, ...o });
    const luna = {
        call(uri: string, p: any): Promise<any> {
            calls.push({ uri, params: p });
            const m = uri.replace(/^luna:\/\//, "");
            if (m === "com.palm.applicationManager/listLaunchPoints")
                return okr({ launchPoints: [{ id: "com.palm.app.calendar", title: "Calendar" },
                                            { id: "org.webosphoenix.settings", title: "Sounds & Ringtones", params: { page: "sounds" } }] });
            if (m === "com.palm.db/find") {
                const kind = p.query.from;
                return okr({ results: [...db.values()].filter((o) => o._kind === kind || (kind === "com.palm.email:1" && /email:1$/.test(o._kind))) });
            }
            if (m === "com.palm.db/put") return okr({ results: p.objects.map((o: any) => ({ id: put(o), rev: 1 })) });
            if (m === "com.palm.db/merge") { p.objects.forEach((o: any) => db.set(o._id, { ...db.get(o._id), ...o })); return okr(); }
            if (m === "com.palm.db/del") { p.ids.forEach((id: string) => db.delete(id)); return okr(); }
            if (m === "com.palm.db/get") return okr({ results: p.ids.map((id: string) => db.get(id)).filter(Boolean) });
            if (m === "com.palm.db/reserveIds") return okr({ ids: Array.from({ length: p.count }, () => "res" + ++n) });
            if (m === "com.palm.activitymanager/create") { state.activities.set(p.activity.name, p.activity); return okr({ activityId: 1 }); }
            if (m === "com.palm.activitymanager/cancel") { state.activities.delete(p.activityName); return okr(); }
            if (m === "com.webos.service.audio/master/getVolume") return okr({ volumeStatus: { volume: state.volume, muted: state.muted } });
            if (m === "com.webos.service.audio/master/setVolume") { state.volume = p.volume; return okr(); }
            if (m === "com.webos.service.audio/master/muteVolume") { state.muted = p.mute; return okr(); }
            if (m === "com.webos.service.audio/getInputVolume") return okr({ volume: state.ringtones });
            if (m === "com.webos.service.audio/setInputVolume") { state.ringtones = p.volume; return okr(); }
            if (m === "com.palm.display/control/getProperty") return okr({ maximumBrightness: state.brightness });
            if (m === "com.palm.display/control/setProperty") { state.brightness = p.maximumBrightness; return okr(); }
            if (m === "com.palm.power/com/palm/power/batteryStatusQuery") return okr({ percent: 76, percent_ui: 76 });
            if (m === "com.palm.power/com/palm/power/chargerStatusQuery") return okr({ Charging: true, Connected: true });
            if (m === "com.webos.service.location/getCurrentPosition") return okr({ latitude: 37.37, longitude: -122.04, errorCode: 0 });
            return okr();
        },
    };
    const data = new Map<string, unknown>();
    const storage = {
        get: (k: string) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null),
        set: (k: string, v: unknown) => { data.set(k, JSON.parse(JSON.stringify(v))); },
        remove: (k: string) => { data.delete(k); },
        keys: (prefix: string) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    };
    const requests: string[] = [];
    const request = (r: { url: string }) => {
        requests.push(r.url);
        if (opts.offline) return Promise.reject(new Error("offline"));
        if (r.url.includes("frankfurter")) return Promise.resolve({ status: 200, body: JSON.stringify({ amount: 20, base: "USD", date: "2026-10-07", rates: { EUR: 17.3 } }) });
        if (r.url.includes("geocoding")) return Promise.resolve({ status: 200, body: JSON.stringify({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris" }] }) });
        return Promise.resolve({ status: 404, body: "" });
    };
    let clock = NOW;
    const svc = createAssistantService({ luna, storage, request, now: () => clock, caller: () => "com.palm.systemui",
                                         secrets: { seal: () => Promise.resolve({}), unseal: () => Promise.resolve("") }, locale: () => "en-US" });
    let thread = "";
    async function ask(text: string): Promise<Msg> {
        const r = await svc.ask({ text, ...(thread ? { threadId: thread } : { newThread: true }) });
        expect(r.returnValue, r.errorText).toBe(true);
        thread = r.thread.id;
        return r.messages[r.messages.length - 1];
    }
    async function confirm(m: Msg, accept = true): Promise<Msg> {
        const r = await svc.confirm({ threadId: thread, messageId: m.id, accept });
        expect(r.returnValue, r.errorText).toBe(true);
        return r.messages[r.messages.length - 1];
    }
    async function choose(m: Msg, choice: string) {
        const r = await svc.choose({ threadId: thread, messageId: m.id, choice });
        expect(r.returnValue, r.errorText).toBe(true);
        return r;
    }
    const of = (kind: string) => [...db.values()].filter((o) => o._kind === kind);
    const called = (part: string) => calls.filter((c) => c.uri.includes(part));
    return { svc, db, of, calls, called, state, ask, confirm, choose, requests, setNow: (t: number) => { clock = t; } };
}

describe("calendar", () => {
    it("adds an event in db8, as the Calendar app saves one, and offers Calendar", async () => {
        const d = device();
        const m = await d.ask("Add a meeting with Sam tomorrow at 3 at Bistro Verde");
        expect(m).toMatchObject({ status: "done", command: "event", text: "Added “Meeting with Sam” to your calendar, tomorrow at 3:00 PM, at Bistro Verde." });
        const ev = d.of("com.palm.calendarevent:1").find((e) => e.subject === "Meeting with Sam");
        expect(ev).toMatchObject({ calendarId: "cal-local", accountId: "acct-profile", dtstart: at(8, 15), dtend: at(8, 16), allDay: false,
                                   location: "Bistro Verde", rrule: null, attendees: [{ email: "sam@example.com", commonName: "Sam Delgado", organizer: false }] });
        expect(ev.alarm).toEqual([{ action: "display", alarmTrigger: { value: "-PT15M", valueType: "DURATION" } }]);
        expect(m.choices).toEqual([{ id: "open", label: "Open Calendar" }]);
        await d.choose(m, "open");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "com.palm.app.calendar", params: { showEventDetail: ev._id } });
    });
    it("all-day and repeating events, as the Calendar stores them", async () => {
        const d = device();
        await d.ask("add an event called team offsite on Friday all day");
        expect(d.of("com.palm.calendarevent:1").find((e) => e.subject === "Team offsite")).toMatchObject({ allDay: true, dtstart: at(9, 0), dtend: at(9, 23, 59) + 59000 });
        const m = await d.ask("schedule yoga every Monday at 7pm for 90 minutes");
        expect(m.text).toBe("Added “Yoga” to your calendar, on Monday at 7:00 PM, every Monday.");
        expect(d.of("com.palm.calendarevent:1").find((e) => e.subject === "Yoga")).toMatchObject({
            dtstart: at(12, 19), dtend: at(12, 20, 30), rrule: { freq: "WEEKLY", interval: 1, rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }] }] } });
    });
    it("asks when, and the next words say it", async () => {
        const d = device();
        const q = await d.ask("add a meeting with Priya");
        expect(q.text).toBe("When is it? Say a day and a time, like \"tomorrow at 3\".");
        expect(d.of("com.palm.calendarevent:1")).toHaveLength(2);
        const m = await d.ask("next Tuesday at noon");
        expect(m).toMatchObject({ status: "done", command: "event" });
        expect(d.of("com.palm.calendarevent:1").find((e) => e.subject === "Meeting with Priya")).toMatchObject({ dtstart: at(13, 12) });
    });
    it("reads the agenda: today, a week, the next one, one by name", async () => {
        const d = device();
        expect((await d.ask("what's on my calendar today")).text).toBe("Today you have 1 event: “Team stand-up” at 9:30 AM.");
        expect((await d.ask("what do I have on Friday")).text)
            .toBe("On Friday you have 2 events: “Team stand-up” at 9:30 AM and “Dentist” at 2:00 PM.");
        await d.ask("add lunch with Priya to my calendar tomorrow at 1");
        expect((await d.ask("what's on my calendar tomorrow")).text)
            .toBe("Tomorrow you have 2 events: “Team stand-up” at 9:30 AM and “Lunch with Priya” at 1:00 PM.");
        const week = await d.ask("what's on my calendar this week");
        expect(week.text).toMatch(/^This week you have 5 events: .*“Dentist” Friday 2:00 PM/);
        expect((await d.ask("what's my next meeting")).text).toBe("Next: “Team stand-up” tomorrow at 9:30 AM.");
        expect((await d.ask("when is my dentist appointment")).text).toBe("“Dentist” is on Friday at 2:00 PM, at Downtown Dental.");
        expect((await d.ask("what's on my calendar on Sunday")).text).toBe("Nothing on your calendar on Sunday.");
    });
    it("undo takes the event back, after Yes", async () => {
        const d = device();
        await d.ask("create an event called dentist on Friday at 10am");
        expect(d.of("com.palm.calendarevent:1")).toHaveLength(3);
        const q = await d.ask("undo");
        expect(q).toMatchObject({ status: "pending", text: "Undo: remove “Dentist” from your calendar?" });
        expect(d.of("com.palm.calendarevent:1")).toHaveLength(3);
        expect((await d.confirm(q)).text).toBe("Undone.");
        expect(d.of("com.palm.calendarevent:1")).toHaveLength(2);
        expect((await d.ask("undo")).text).toBe("There's nothing to undo.");
    });
});

describe("alarms, timers, the stopwatch", () => {
    it("a repeating alarm in the Clock, with its activity", async () => {
        const d = device();
        const m = await d.ask("set an alarm for 7am weekdays");
        expect(m.text).toBe("Alarm set for 7:00 AM on weekdays, starting tomorrow.");
        const a = d.of("com.palm.clock.alarm:1").find((x) => x.key !== "clockAlarm1" && x.hour === 7);
        expect(a).toMatchObject({ occurs: "weekdays", minute: 0, enabled: true, niceTime: "7:00 AM", niceDay: "Tomorrow" });
        expect(d.state.activities.get(a.key)).toMatchObject({ schedule: { start: "2026-10-08 07:00:00", local: true },
            callback: { params: { id: "com.palm.app.clock", params: { action: "ring", key: a.key } } } });
        expect((await d.ask("set an alarm for 6 every monday")).text).toBe("Alarm set for 6:00 AM Monday. The Clock repeats alarms every day, on weekdays or at weekends, not every Monday. I set it once.");
    });
    it("alarms listed, turned off (and back on by undo), deleted after Yes", async () => {
        const d = device();
        expect((await d.ask("what alarms do I have")).text).toBe("You have 2 alarms: 7:00 AM on weekdays and 6:30 PM.");
        expect((await d.ask("cancel my 7am alarm")).text).toBe("Turned off your alarm for 7:00 AM on weekdays.");
        expect(d.db.get("alarm-7").enabled).toBe(false);
        expect(d.called("activitymanager/cancel").map((c) => c.params.activityName)).toEqual(["clockAlarm1"]);
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("alarm-7").enabled).toBe(true);
        expect(d.state.activities.get("clockAlarm1").schedule.start).toBe("2026-10-08 07:00:00");
        expect((await d.ask("cancel my 9am alarm")).text).toBe("You have no alarm for 9:00 AM.");
        const q = await d.ask("delete all alarms");
        expect(q).toMatchObject({ status: "pending", text: "Delete 2 alarms (7:00 AM on weekdays and 6:30 PM)?" });
        expect(d.of("com.palm.clock.alarm:1")).toHaveLength(2);
        expect((await d.confirm(q)).text).toBe("2 alarms deleted.");
        expect(d.of("com.palm.clock.alarm:1")).toHaveLength(0);
    });
    it("timers: time left, cancelled", async () => {
        const d = device();
        await d.ask("set a 5 minute timer");
        await d.ask("set a 10 minute timer for the pasta");
        d.setNow(NOW + 72000);
        expect((await d.ask("how much time is left")).text).toBe("3 minutes and 48 seconds left on a timer; 8 minutes and 48 seconds left on your pasta timer.");
        expect((await d.ask("cancel the pasta timer")).text).toBe("Cancelled your pasta timer.");
        expect(d.state.activities.size).toBe(1);
        expect((await d.ask("cancel all timers")).text).toBe("Cancelled your timer.");
        expect((await d.ask("how much time is left")).text).toBe("You have no timers running.");
    });
    it("the stopwatch", async () => {
        const d = device();
        expect((await d.ask("start a stopwatch")).text).toBe("Stopwatch started.");
        d.setNow(NOW + 83000);
        expect((await d.ask("how long has the stopwatch been running")).text).toBe("The stopwatch is at 1 minute and 23 seconds.");
        expect((await d.ask("stop the stopwatch")).text).toBe("Stopwatch stopped at 1 minute and 23 seconds.");
    });
});

describe("tasks, memos, contacts", () => {
    it("adds to a named list, making it the first time", async () => {
        const d = device();
        const m = await d.ask("add milk to my shopping list");
        expect(m.text).toBe("Added “Milk” to your Shopping list (a new list).");
        const list = d.of("com.palm.tasklist:1").find((l) => l.name === "Shopping");
        expect(d.of("com.palm.task:1").find((t) => t.summary === "Milk")).toMatchObject({ listId: list._id, completed: false });
        expect((await d.ask("put eggs on the shopping list")).text).toBe("Added “Eggs” to your Shopping list.");
        expect(d.of("com.palm.tasklist:1")).toHaveLength(2);
        const t = await d.ask("create a task to call the bank tomorrow");
        expect(t.text).toBe("Added “Call the bank” to your tasks, due tomorrow at 9:00 AM.");
        expect(d.of("com.palm.task:1").find((x) => x.summary === "Call the bank")).toMatchObject({ listId: "list-inbox", due: at(8, 9) });
        expect(t.choices).toEqual([{ id: "open", label: "Open Tasks" }]);
    });
    it("saves a memo first on the wall, as Memos places a new one", async () => {
        const d = device();
        expect((await d.ask("new note: buy flowers for Ada")).text).toBe("Saved to Memos.");
        const memo = d.of("com.palm.note:1").find((n) => n.text === "Buy flowers for Ada");
        // The colour after the first memo's (Memo.getNextMemoColor); a position before "m".
        expect(memo).toMatchObject({ title: "Buy flowers for Ada", color: "green", position: "g" });
        expect(memo.position < "m").toBe(true);
        expect((await d.ask("find my notes about the cabin")).text).toBe("One memo about “the cabin”: “Wi-Fi at the cabin: network Lakeview”.");
    });
    it("adds a contact the next command can call", async () => {
        const d = device();
        expect((await d.ask("add Robin Lee to my contacts with number 555 0111")).text).toBe("Added Robin Lee to your contacts.");
        expect(d.of("com.palm.contact.palmprofile:1")[0]).toMatchObject({ accountId: "acct-profile", name: { givenName: "Robin", familyName: "Lee" },
            phoneNumbers: [{ value: "555 0111", type: "type_mobile", primary: true }] });
        expect(d.of("com.palm.person:1").find((p) => p.name.givenName === "Robin")).toMatchObject({ contactIds: [d.of("com.palm.contact.palmprofile:1")[0]._id] });
        expect((await d.ask("call Robin")).text).toBe("Call Robin Lee (555 0111)?");
        expect((await d.ask("what's Sam's number")).text).toBe("Sam Delgado's number is (303) 555-0135.");
    });
});

describe("email and messages", () => {
    it("reads an email back, sends it on Yes through com.palm.smtp", async () => {
        const d = device();
        const q = await d.ask("send an email to Sam saying see you soon");
        expect(q).toMatchObject({ status: "pending", text: "Email Sam Delgado: “See you soon”?" });
        expect(d.called("smtp/sendMail")).toHaveLength(0);
        expect((await d.confirm(q)).text).toBe("Email sent to Sam Delgado.");
        expect(d.called("smtp/sendMail")[0].params).toMatchObject({ accountId: "acct-mail", email: {
            to: [{ addr: "sam@example.com", name: "Sam Delgado", type: "to" }], parts: [{ type: "body", mimeType: "text/html", content: "See you soon" }] } });
    });
    it("composes when there is nothing to send yet", async () => {
        const d = device();
        expect((await d.ask("email Sam about the report")).text).toBe("Here's a new email to Sam Delgado.");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "com.palm.app.email", params: {
            recipients: [{ type: "email", role: 1, value: "sam@example.com", contactDisplay: "Sam Delgado" }], summary: "The report" } });
        expect((await d.ask("email Priya about lunch")).text).toBe("Priya Nair has no email address in your contacts.");
    });
    it("finds email; reads the last message", async () => {
        const d = device();
        expect((await d.ask("search my email for invoice")).text).toBe("One email about “invoice”: “Invoice 2231” from Alex Rivera.");
        expect((await d.ask("do I have any new emails")).text).toBe("1 unread email: “Invoice 2231” from Alex Rivera.");
        expect((await d.ask("read my last message")).text).toBe("Sam Delgado said, today at 9:50 AM: “Running 5 min late”");
        const p = await d.ask("what did Priya say");
        expect(p.text).toBe("Priya Nair said, today at 9:00 AM: “Lunch at noon?”");
        await d.choose(p, "open");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "org.webosphoenix.messaging", params: { threadId: "t-priya" } });
    });
});

describe("the device", () => {
    it("music keys, volume, brightness, Do Not Disturb", async () => {
        const d = device();
        expect((await d.ask("pause the music")).text).toBe("Paused.");
        expect((await d.ask("next song")).text).toBe("Next song.");
        expect(d.called("org.webosphoenix.system/mediaKey").map((c) => c.params.key)).toEqual(["pause", "next"]);
        expect((await d.ask("turn up the volume")).text).toBe("Volume 60%.");
        expect((await d.ask("set the volume to 30%")).text).toBe("Volume 30%.");
        expect((await d.ask("mute")).text).toBe("Muted.");
        expect(d.state).toMatchObject({ volume: 30, muted: true });
        expect((await d.ask("set brightness to 50%")).text).toBe("Brightness 50%.");
        expect((await d.ask("turn the brightness up")).text).toBe("Brightness 70%.");
        expect(d.called("display/control/setProperty").map((c) => c.params)).toEqual([{ maximumBrightness: 50 }, { maximumBrightness: 70 }]);
        expect((await d.ask("turn on do not disturb")).text).toBe("Do Not Disturb is on: the ringer and alerts are silent.");
        expect(d.state.ringtones).toBe(0);
        expect((await d.ask("turn off do not disturb")).text).toBe("Do Not Disturb is off: the ringer is back on.");
        expect(d.state.ringtones).toBe(60);
    });
    it("screenshot, lock, battery, Settings pages", async () => {
        const d = device();
        expect((await d.ask("take a screenshot")).text).toBe("Screenshot taken. It's in Photos.");
        expect(d.called("com.palm.systemmanager/takeScreenShot")).toHaveLength(1);
        expect((await d.ask("lock the screen")).text).toBe("Locked.");
        expect(d.called("display/control/setState")[0].params).toEqual({ state: "off" });
        expect((await d.ask("what's my battery")).text).toBe("Your battery is at 76% and charging.");
        expect((await d.ask("open Wi-Fi settings")).text).toBe("Opening Wi-Fi settings.");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "org.webosphoenix.settings", params: { page: "wifi" } });
        // webOS 2.x has a launch point per pane and none called Settings: the list of them.
        expect((await d.ask("open settings")).text).toBe("Opening Settings.");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "org.webosphoenix.settings", params: {} });
        // A pane's launch point opens with its own params.
        expect((await d.ask("open sounds & ringtones")).text).toBe("Opening Sounds & Ringtones.");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "org.webosphoenix.settings", params: { page: "sounds" } });
    });
    it("photos from a day open in Photos", async () => {
        const d = device();
        expect((await d.ask("show my photos from yesterday")).text).toBe("Here are 2 photos from yesterday.");
        expect(d.called("applicationManager/launch").pop()!.params).toEqual({ id: "org.webosphoenix.photos", params: { imageList: { results: [
            { file_path: "/media/internal/DCIM/b.jpg" }, { file_path: "/media/internal/DCIM/a.jpg" }] } } });
        expect((await d.ask("show my photos from last week")).text).toBe("Here is 1 photo from last week.");
    });
});

describe("conversions and the world", () => {
    it("units offline, currencies online (and says so offline)", async () => {
        const d = device();
        expect((await d.ask("convert 10 miles to km")).text).toBe("10 miles is 16.09 kilometres.");
        expect((await d.ask("how many cups in a liter")).text).toBe("1 litre is 4.23 cups.");
        expect((await d.ask("what's 100 fahrenheit in celsius")).text).toBe("100°F is 37.78°C.");
        expect((await d.ask("what's 20 USD in EUR")).text).toBe("20 USD is 17.30 EUR (rates of 2026-10-07).");
        const off = device({ offline: true });
        const m = await off.ask("what's 20 USD in EUR");
        expect(m).toMatchObject({ status: "failed", text: "I can't get exchange rates right now: are you online?", choices: [{ id: "web", label: "Search the web" }] });
    });
    it("the time in a city, offline for the big ones", async () => {
        const d = device();
        const m = await d.ask("what time is it in Tokyo");
        const tokyo = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", minute: "2-digit", hour12: true }).format(NOW);
        expect(m.text.startsWith("It's " + tokyo)).toBe(true);
        expect(m.text).toMatch(/in Tokyo/);
        expect(d.requests).toHaveLength(0);
    });
    it("how far a place is", async () => {
        const d = device();
        // From Sunnyvale (the stand-in location), in miles for en-US.
        expect((await d.ask("how far is Paris")).text).toBe("Paris is about 5,580 miles away, as the crow flies.");
        expect((await device({ offline: true }).ask("how far is Paris")).text).toBe("I couldn't look up paris right now: are you online?");
    });
    it("translation goes on to a model or the web", async () => {
        const d = device();
        const m = await d.ask("translate hello into French");
        expect(m.text).toBe("I can't translate on the phone.");
        expect(m.choices!.map((c) => c.id)).toContain("web");
    });
});

describe("the model path", () => {
    it("gets the same commands as tools, with times as said", async () => {
        const commands = req("./lib/commands.js");
        const en = req("./lib/lang/en.js");
        const ids = commands.BUILT_IN.filter((c: any) => !c.internal).map((c: any) => c.id);
        for (const id of ["event", "agenda", "alarmManage", "task", "note", "email", "media", "volume", "brightness", "convert", "worldTime", "screenshot", "lock"])
            expect(ids).toContain(id);
        const env = { now: () => NOW, lang: en };
        const ev = commands.fromModel(commands.find(commands.catalogue([]), "event"),
            { title: "Dentist", start: "friday at 10am", duration_minutes: 45, repeat: "weekly" }, env);
        expect(ev).toMatchObject({ title: "Dentist", start: at(9, 10), end: at(9, 10, 45), repeat: { freq: "WEEKLY" } });
        const ag = commands.fromModel(commands.find(commands.catalogue([]), "agenda"), { range: "tomorrow" }, env);
        expect(ag).toMatchObject({ range: "day", from: new Date(2026, 9, 8).getTime(), to: new Date(2026, 9, 9).getTime() });
    });
});
