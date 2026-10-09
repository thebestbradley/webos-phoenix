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

function device(opts: { offline?: boolean; locationAllowed?: boolean | null } = {}) {
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
    put({ _id: "mail-1", _kind: "com.palm.email:1", subject: "Invoice 2231", from: { name: "Alex Rivera", addr: "alex@example.com" }, summary: "Your invoice", timestamp: NOW - 3600e3, flags: { read: false, visible: true },
          parts: [{ type: "body", mimeType: "text/html", content: "Hi,<br>Your invoice 2231 is attached.<br>Alex" }] });
    put({ _id: "mail-2", _kind: "com.palm.email:1", subject: "Lunch today?", from: { name: "Priya Nair", addr: "priya@example.net" }, summary: "Noon?", timestamp: NOW - 7200e3, flags: { read: true, visible: true } });
    put({ _id: "sms-1", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Running 5 min late", from: { addr: "3035550135" }, localTimestamp: NOW - 600e3, threadId: "t-sam",
          flags: { read: false, visible: true } });
    put({ _id: "sms-2", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Lunch at noon?", from: { addr: "4155550123" }, localTimestamp: NOW - 3600e3, threadId: "t-priya" });
    put({ _id: "call-1", _kind: "com.palm.phonecall:1", type: "missed", timestamp: NOW - 1800e3, duration: 0, from: { addr: "(303) 555-0135" }, to: [] });
    put({ _id: "call-2", _kind: "com.palm.phonecall:1", type: "outgoing", timestamp: NOW - 7200e3, duration: 60000, from: { addr: "" }, to: [{ addr: "(415) 555-0123", name: "Priya Nair" }] });
    put({ _id: "list-shop", _kind: "com.palm.tasklist:1", name: "Groceries" });
    put({ _id: "task-milk", _kind: "com.palm.task:1", summary: "Milk", listId: "list-shop", completed: false, createdTime: 1 });
    put({ _id: "task-eggs", _kind: "com.palm.task:1", summary: "Eggs", listId: "list-shop", completed: false, createdTime: 2 });
    put({ _id: "task-done", _kind: "com.palm.task:1", summary: "Bread", listId: "list-shop", completed: true, createdTime: 3 });
    put({ _id: "img-1", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/a.jpg", createdTime: at(6, 15) });
    put({ _id: "img-2", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/b.jpg", createdTime: at(6, 16) });
    put({ _id: "img-3", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/c.jpg", createdTime: at(1, 9) });

    const calls: { uri: string; params: any }[] = [];
    const state = { volume: 50, muted: false, ringtones: 60, brightness: 70, activities: new Map<string, any>(),
                    gps: true, network: true, locationAllowed: (opts.locationAllowed === undefined ? true : opts.locationAllowed) as boolean | null,
                    prefs: { rotationLock: false } as Record<string, unknown>, nowPlaying: null as Record<string, unknown> | null,
                    hotspot: false, hotspotPass: false, vpn: "", vpnProfiles: [] as string[] };
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
            // Location (OSE's methods, and Phoenix's per-app permissions in
            // front of them, as runtime/phoenix-runtime.js answers them).
            if (m === "org.webosphoenix.service.location/getPermissions")
                return okr({ permissions: state.locationAllowed === null ? [] : [{ appId: "org.webosphoenix.assistant", title: "Assistant", allowed: state.locationAllowed }] });
            if (m === "org.webosphoenix.service.location/setPermission") { state.locationAllowed = p.allowed; return okr(); }
            if (m === "com.webos.service.location/getAllLocationHandlers") return okr({ handlers: [{ name: "gps", state: state.gps }, { name: "network", state: state.network }] });
            if (m === "com.webos.service.location/setState") { state[p.Handler as "gps" | "network"] = p.state; return okr(); }
            if (m === "com.webos.service.location/getLocationUpdates") {
                if (!state.gps && !state.network) return Promise.resolve({ returnValue: false, errorCode: 5, errorText: "Location services are off" });
                return okr({ errorCode: 0, latitude: 37.37, longitude: -122.04, horizAccuracy: 8 });
            }
            // What OSE's service does not have (getCurrentPosition was the legacy com.palm.location's).
            if (m.startsWith("com.webos.service.location/")) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "Unknown method" });
            if (m === "org.webosphoenix.filemanager/search")
                return okr({ entries: p.query === "budget" ? [{ name: "Budget 2026.pdf", path: "/media/internal/Documents/Budget 2026.pdf", type: "file", size: 52000, mtime: at(6, 12) }] : [] });
            if (m === "org.webosphoenix.tethering/setWifi") {
                if (p.enabled && !state.hotspotPass) return Promise.resolve({ returnValue: false, errorCode: -1, errorText: "The password has 8 to 63 characters" });
                state.hotspot = p.enabled; return okr();
            }
            if (m === "com.webos.service.vpn/getProfileList") return okr({ vpnProfiles: state.vpnProfiles.map((n) => ({ vpnProfileName: n })) });
            if (m === "com.webos.service.vpn/connect") { state.vpn = p.vpnProfileName; return okr(); }
            if (m === "com.webos.service.vpn/disconnect") { state.vpn = ""; return okr(); }
            if (m === "org.webosphoenix.system/getNowPlaying") return okr({ nowPlaying: state.nowPlaying });
            if (m === "com.palm.telephony/voicemailQuery") return okr({ number: "(408) 555-0100", waiting: true, count: 2 });
            if (m === "com.webos.service.systemservice/deviceInfo/query") return okr({ storage_free: "5.8 GB", storage_size: "8 GB" });
            if (m === "org.webosphoenix.service.packages/search")
                return okr({ apps: p.query === "doom" ? [{ id: "com.example.doom", sourceId: "museum", title: "Doom", summary: "The classic", developer: { name: "id" }, installed: null }] : [] });
            if (m === "com.webos.service.systemservice/setPreferences") { Object.assign(state.prefs, p); return okr(); }
            if (m === "com.webos.service.systemservice/getPreferences") return okr({ ...state.prefs });
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
        if (r.url.includes("api.open-meteo.com/v1/forecast") && !r.url.includes("hourly="))
            return Promise.resolve({ status: 200, body: JSON.stringify({ current: { temperature_2m: 64.4, weather_code: 2 },
                daily: { weather_code: [2, 61], temperature_2m_max: [70.2, 61.1], temperature_2m_min: [52.3, 50], precipitation_probability_max: [10, 80] } }) });
        if (r.url.includes("photon.komoot.io")) return Promise.resolve({ status: 200, body: JSON.stringify({ features: [{ geometry: { coordinates: [-121.93, 37.36] }, properties: { name: "San Jose Airport" } }] }) });
        if (r.url.includes("valhalla1.openstreetmap.de/route")) {
            const q = JSON.parse(decodeURIComponent(r.url.split("json=")[1]));
            return Promise.resolve({ status: 200, body: JSON.stringify({ trip: { summary: { time: q.costing === "auto" ? 1080 : 5400, length: 12.4 } } }) });
        }
        if (r.url.includes("hourly=")) {
            const times = Array.from({ length: 48 }, (_, h) => { const d = new Date(2026, 9, 7, h); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:00`; });
            return Promise.resolve({ status: 200, body: JSON.stringify({ current: { temperature_2m: 64, weather_code: 2 }, daily: { temperature_2m_max: [70, 61], temperature_2m_min: [52, 50], weather_code: [2, 61] },
                hourly: { time: times, temperature_2m: times.map((_, h) => 50 + (h % 24)), weather_code: times.map((_, h) => (h % 24 >= 15 ? 61 : 2)), precipitation_probability: times.map((_, h) => (h % 24 >= 15 ? 70 : 5)) } }) });
        }
        if (r.url.includes("geocoding")) return Promise.resolve({ status: 200, body: JSON.stringify({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris" }] }) });
        return Promise.resolve({ status: 404, body: "" });
    };
    let clock = NOW;
    // The commands alone: the questions after them have their own tests (followups.test.ts).
    data.set("assistant:settings", { followUps: false });
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

// The launch an answer made, without the flags every command's launch has
// (behind, returnToCaller: checked once on their own).
function launched(x: { called(part: string): { params: any }[] }) {
    const p = { ...x.called("applicationManager/launch").at(-1)!.params };
    delete p.behind;
    delete p.returnToCaller;
    return p;
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
        expect(launched(d)).toEqual({ id: "com.palm.app.calendar", params: { showEventDetail: ev._id } });
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
        const dentist = await d.ask("when is my dentist appointment");
        expect(dentist.text).toBe("“Dentist” is on Friday at 2:00 PM, at Downtown Dental.");
        // The event shown as a card, which opens it in Calendar.
        expect(dentist.data.attachments).toEqual([{ type: "cards", items: [{ title: "Dentist", subtitle: "On Friday at 2:00 PM", detail: "Downtown Dental",
            open: { appId: "com.palm.app.calendar", params: { showEventDetail: "ev-dentist" }, title: "Calendar" } }] }]);
        await d.choose(dentist, "show:0");
        expect(launched(d)).toEqual({ id: "com.palm.app.calendar", params: { showEventDetail: "ev-dentist" } });
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
        expect(d.of("com.palm.task:1").find((t) => t.summary === "Milk" && t.listId === list._id)).toMatchObject({ completed: false });
        expect((await d.ask("put eggs on the shopping list")).text).toBe("Added “Eggs” to your Shopping list.");
        expect(d.of("com.palm.tasklist:1")).toHaveLength(3);
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
        expect(launched(d)).toEqual({ id: "com.palm.app.email", params: {
            recipients: [{ type: "email", role: 1, value: "sam@example.com", contactDisplay: "Sam Delgado" }], summary: "The report" } });
        expect((await d.ask("email Priya about lunch")).text).toBe("Priya Nair has no email address in your contacts.");
    });
    it("finds email; reads the last message", async () => {
        const d = device();
        const inv = await d.ask("search my email for invoice");
        expect(inv.text).toBe("One email about “invoice”: “Invoice 2231” from Alex Rivera.");
        expect(inv.data.attachments[0].items[0]).toMatchObject({ title: "Invoice 2231", subtitle: "Alex Rivera", open: { params: { emailId: "mail-1" } } });
        expect((await d.ask("do I have any new emails")).text).toBe("1 unread email: “Invoice 2231” from Alex Rivera.");
        expect((await d.ask("read my last message")).text).toBe("Sam Delgado said, today at 9:50 AM: “Running 5 min late”");
        const p = await d.ask("what did Priya say");
        expect(p.text).toBe("Priya Nair said, today at 9:00 AM: “Lunch at noon?”");
        await d.choose(p, "open");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.messaging", params: { threadId: "t-priya" } });
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
        expect(launched(d)).toEqual({ id: "org.webosphoenix.settings", params: { page: "wifi" } });
        // webOS 2.x has a launch point per pane and none called Settings: the list of them.
        expect((await d.ask("open settings")).text).toBe("Opening Settings.");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.settings", params: {} });
        // A pane's launch point opens with its own params.
        expect((await d.ask("open sounds & ringtones")).text).toBe("Opening Sounds & Ringtones.");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.settings", params: { page: "sounds" } });
    });
    it("photos from a day: shown in the conversation, and in Photos (just those) behind it", async () => {
        const d = device();
        const m = await d.ask("show my photos from yesterday");
        expect(m.text).toBe("Here are 2 photos from yesterday. I've opened them in Photos too.");
        const list = { results: [{ file_path: "/media/internal/DCIM/b.jpg" }, { file_path: "/media/internal/DCIM/a.jpg" }], title: "Photos from Yesterday" };
        expect(launched(d)).toEqual({ id: "org.webosphoenix.photos", params: { imageList: list } });
        // The pictures in the reply, and Open Photos to bring it forward.
        expect(m.data.attachments).toEqual([{ type: "images", total: 2, items: [
            { path: "/media/internal/DCIM/b.jpg", open: { appId: "org.webosphoenix.photos", title: "Photos", params: { imageList: { results: [{ file_path: "/media/internal/DCIM/b.jpg" }] } } } },
            { path: "/media/internal/DCIM/a.jpg", open: { appId: "org.webosphoenix.photos", title: "Photos", params: { imageList: { results: [{ file_path: "/media/internal/DCIM/a.jpg" }] } } } }] }]);
        expect(m.choices).toEqual([{ id: "open", label: "Open Photos" }]);
        // Opened behind the conversation, and Back there comes back to it.
        expect(d.called("applicationManager/launch").at(-1)!.params).toMatchObject({ behind: true, returnToCaller: true });
        // A picture tapped: Photos on it; the buttons stay.
        await d.choose(m, "show:1");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.photos", params: { imageList: { results: [{ file_path: "/media/internal/DCIM/a.jpg" }] } } });
        expect((await d.svc.thread({ id: m.threadId })).messages.find((x: Msg) => x.id === m.id).chosen).toBeUndefined();
        await d.choose(m, "open");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.photos", params: { imageList: list } });
        expect((await d.ask("show my photos from last week")).text).toBe("Here is 1 photo from last week. I've opened it in Photos too.");
    });
    it("no photos: says so and offers Photos; how many: only said", async () => {
        const d = device();
        const launches = () => d.called("applicationManager/launch").length;
        const m = await d.ask("show my photos from today");
        expect(m.text).toBe("You don't have any photos from today.");
        expect(m.choices).toEqual([{ id: "open", label: "Open Photos" }]);
        const before = launches();
        expect((await d.ask("how many photos did I take yesterday")).text).toBe("You have 2 photos from yesterday.");
        expect((await d.ask("show my screenshots")).text).toBe("You don't have any screenshots.");
        expect(launches()).toBe(before);
    });
});

describe("more for each app (docs/AI-AND-MCP.md, what it can do for each app)", () => {
    it("phone: who called, missed calls, call back and redial (read back), voicemail", async () => {
        const d = device();
        const who = await d.ask("who called me");
        expect(who.text).toBe("You missed a call from Sam Delgado, today at 9:30 AM.");
        expect(who.choices!.map((c) => c.label)).toEqual(["Call Sam Delgado", "Open Phone"]);
        expect((await d.ask("did I miss any calls")).text).toBe("You missed a call from Sam Delgado, today at 9:30 AM.");
        const back = await d.ask("call back");
        expect(back).toMatchObject({ status: "pending", text: "Call Sam Delgado (3035550135)?" });
        await d.confirm(back);
        expect(launched(d)).toEqual({ id: "org.webosphoenix.phone", params: { number: "3035550135", dial: true } });
        expect((await d.ask("redial")).text).toBe("Call Priya Nair (4155550123)?");
        const vm = await d.ask("check my voicemail");
        expect(vm.text).toBe("You have 2 new voicemails.");
        expect(vm.choices!.map((c) => c.label)).toEqual(["Call Voicemail"]);
        expect((await d.ask("call voicemail")).text).toBe("Call voicemail ((408) 555-0100)?");
    });
    it("messages: the new ones, a reply read back and sent", async () => {
        const d = device();
        const m = await d.ask("any new texts");
        expect(m.text).toBe("You have 1 new message. Sam Delgado said, today at 9:50 AM: “Running 5 min late”");
        expect(m.choices!.map((c) => c.label)).toEqual(["Reply to Sam Delgado", "Open Messaging"]);
        const r = await d.ask("reply on my way");
        expect(r).toMatchObject({ status: "pending", text: "Send \"On my way\" to Sam Delgado?" });
        await d.confirm(r);
        expect(d.called("messaging/putMessage")[0].params.message).toMatchObject({ messageText: "On my way", to: [{ addr: "3035550135" }] });
    });
    it("calendar: free time, an event moved (and back), one cancelled after Yes (and back)", async () => {
        const d = device();
        expect((await d.ask("am I free on Friday at 2:30")).text).toBe("No, you have “Dentist” then, 2:00 PM to 3:00 PM.");
        expect((await d.ask("am I free tomorrow at 3")).text).toBe("Yes, you're free tomorrow at 3:00 PM.");
        expect((await d.ask("when am I free on Friday")).text).toBe("On Friday you're free 8:00 AM to 9:30 AM, 10:00 AM to 2:00 PM and 3:00 PM to 8:00 PM.");
        const moved = await d.ask("move my dentist appointment to 4pm");
        expect(moved.text).toBe("Moved “Dentist” to Friday at 4:00 PM.");
        expect(d.db.get("ev-dentist")).toMatchObject({ dtstart: at(9, 16), dtend: at(9, 17) });
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("ev-dentist")).toMatchObject({ dtstart: at(9, 14), dtend: at(9, 15) });
        // A repeating one: the next day of it only (the Calendar's "this event only"), or all.
        const one = await d.ask("move my stand-up to 10am");
        expect(one.text).toBe("Moved tomorrow's “Team stand-up” to 10:00 AM. The others stay as they are.");
        const parent = d.db.get("ev-standup");
        expect(parent.exdates).toEqual([new Date(at(8, 9, 30)).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")]);
        const child = d.of("com.palm.calendarevent:1").find((e) => e.parentId === "ev-standup");
        expect(child).toMatchObject({ subject: "Team stand-up", dtstart: at(8, 10), dtend: at(8, 10, 30), recurrenceId: parent.exdates[0] });
        expect(child.rrule).toBeUndefined();
        expect((await d.ask("what's on my calendar tomorrow")).text).toMatch(/“Team stand-up” at 10:00 AM/);
        expect((await d.ask("what's on my calendar on Friday")).text).toMatch(/“Team stand-up” at 9:30 AM/);
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("ev-standup").exdates).toEqual([]);
        expect(d.of("com.palm.calendarevent:1").some((e) => e.parentId)).toBe(false);
        expect((await d.ask("move all my stand-ups to 9am")).text).toBe("Every “Team stand-up” is at 9:00 AM now.");
        expect(d.db.get("ev-standup")).toMatchObject({ dtstart: at(5, 9), dtend: at(5, 9, 30) });
        const friday = await d.ask("cancel my stand-up on Friday");
        expect(friday.text).toBe("Cancel “Team stand-up” on Friday at 9:00 AM?");
        expect((await d.confirm(friday)).text).toBe("Cancelled “Team stand-up” on Friday at 9:00 AM. The others stay.");
        expect((await d.ask("what's on my calendar on Friday")).text).not.toMatch(/stand-up/);
        expect((await d.ask("cancel every team stand-up")).text).toBe("Cancel every “Team stand-up”?");
        const c = await d.ask("cancel my dentist appointment");
        expect(c).toMatchObject({ status: "pending", text: "Cancel “Dentist” on Friday at 2:00 PM?" });
        expect(d.db.has("ev-dentist")).toBe(true);
        expect((await d.confirm(c)).text).toBe("Cancelled “Dentist”.");
        expect(d.db.has("ev-dentist")).toBe(false);
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("ev-dentist")).toMatchObject({ subject: "Dentist", dtstart: at(9, 14) });
        expect((await d.ask("cancel my yoga class from my calendar")).text).toBe("I couldn't find “yoga class” on your calendar.");
    });
    it("memos and tasks: added to a memo, a list read, a task done (and back)", async () => {
        const d = device();
        expect((await d.ask("add the guest code to my wi-fi note")).text).toBe("Added it to your “Wi-Fi at the cabin: network Lakeview” memo.");
        expect(d.db.get("memo-1").text).toBe("Wi-Fi at the cabin: network Lakeview\nthe guest code");
        expect((await d.ask("add eggs to my recipes memo")).text).toMatch(/^I couldn't find a memo about “recipes”/);
        const list = await d.ask("what's on my groceries list");
        expect(list.text).toBe("Your Groceries list: “Milk” and “Eggs”.");
        expect(list.data.attachments[0].items.map((x: any) => x.title)).toEqual(["Milk", "Eggs"]);
        expect((await d.ask("check off milk")).text).toBe("Marked “Milk” as done.");
        expect(d.db.get("task-milk").completed).toBe(true);
        expect((await d.ask("what's on my groceries list")).text).toBe("Your Groceries list: “Eggs”.");
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("task-milk").completed).toBe(false);
        expect((await d.ask("what's on my packing list")).text).toBe("You don't have a list called “packing”.");
    });
    it("maps, the web, storage, the Marketplace, what's playing", async () => {
        const d = device();
        expect((await d.ask("coffee near me")).text).toBe("Here's coffee near you, in Maps.");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.maps", params: { query: "coffee" } });
        expect((await d.ask("open example.com")).text).toBe("Opening example.com.");
        expect(d.called("applicationManager/open").pop()!.params).toEqual({ target: "https://example.com" });
        expect((await d.ask("how much storage do I have")).text).toBe("You have 5.8 GB free of 8 GB.");
        const doom = await d.ask("find doom in the marketplace");
        expect(doom.text).toBe("I found Doom in the Marketplace.");
        expect(doom.choices).toEqual([{ id: "open", label: "Open Marketplace" }]);
        expect((await d.ask("install doom")).text).toBe("Here's Doom in the Marketplace: tap Install to get it.");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.marketplace", params: { sourceId: "museum", id: "com.example.doom" } });
        expect((await d.ask("install frobnicator")).text).toBe("I couldn't find “frobnicator” in the Marketplace.");
        expect((await d.ask("what's playing")).text).toBe("Nothing is playing right now.");
        d.state.nowPlaying = { title: "So What", artist: "Miles Davis", album: "Kind of Blue", playing: true, appId: "org.webosphoenix.music" };
        const np = await d.ask("what song is this");
        expect(np.text).toBe("Playing “So What” by Miles Davis.");
        expect(np.choices!.map((c) => c.label)).toEqual(["Pause", "Next", "Open Music"]);
        await d.choose(np, "do:0");
        expect(d.called("org.webosphoenix.system/mediaKey").pop()!.params).toEqual({ key: "pause" });
    });
    it("weather: will it rain, the week", async () => {
        const d = device();
        expect((await d.ask("will it rain tomorrow")).text).toBe("Yes, rain is likely tomorrow: a 80% chance of rain. Light rain, 61° / 50°F.");
        expect((await d.ask("will it rain today")).text).toBe("Probably not today: a 10% chance of rain. Partly cloudy, 70° / 52°F.");
        expect((await d.ask("what's the weather this week")).text).toBe("This week: highs 61° to 70°F, lows 50° to 52°F. Rain likely tomorrow.");
    });
    it("help: what it can do by app, with what fits now; how to use Phoenix", async () => {
        const d = device();
        const h = await d.ask("what can you do");
        expect(h.text).toMatch(/^Here's what I can do\. Tap an example/);
        const groups = h.data.attachments as { type: string; title: string; items: { text: string }[] }[];
        expect(groups[0]).toMatchObject({ type: "examples", title: "Right now" });
        // 10:00 on a Wednesday, a message unread and a missed call.
        expect(groups[0].items.map((x) => x.text)).toEqual(["Read my new messages", "Who called me?", "Do I have any new emails?", "What's the weather today?"]);
        expect(groups.slice(1).map((g) => g.title)).toContain("Calendar");
        const how = await d.ask("how do I close an app?");
        expect(how.text).toBe("In card view, flick the app's card up and off the top of the screen. Swipe up in the gesture area first to see the cards.");
        expect(how.choices).toEqual([{ id: "open", label: "Open Help" }]);
        await d.choose(how, "open");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.help", params: { topic: "help-cards" } });
    });
});

describe("the gaps closed (9 October 2026, second round)", () => {
    it("email: the latest read out, a reply read back and sent through com.palm.smtp", async () => {
        const d = device();
        const m = await d.ask("read my latest email");
        expect(m.text).toBe("From Alex Rivera, today at 9:00 AM: “Invoice 2231”. Your invoice");
        expect(m.choices!.map((c) => c.label)).toEqual(["Reply to Alex Rivera", "Open Email"]);
        expect((await d.ask("read the email from Priya")).text).toMatch(/^From Priya Nair, today at 8:00 AM: “Lunch today\?”/);
        const r = await d.ask("reply to the email from Alex saying thanks, paid today");
        expect(r).toMatchObject({ status: "pending", text: "Email Alex Rivera, subject “Re: Invoice 2231”: “Thanks, paid today”?" });
        await d.confirm(r);
        expect(d.called("com.palm.smtp/sendMail")[0].params.email).toMatchObject({ subject: "Re: Invoice 2231", to: [{ addr: "alex@example.com" }] });
        expect((await d.ask("reply to my last email")).text).toBe("Here's a new email to Alex Rivera.");
        expect((await d.ask("read the email from Gandalf")).text).toBe("You have no email from gandalf.");
    });
    it("files: found by name, as cards opening their folder in Files", async () => {
        const d = device();
        const f = await d.ask("find my file called budget");
        expect(f.text).toBe("I found “Budget 2026.pdf”.");
        expect(f.data.attachments[0].items[0]).toMatchObject({ title: "Budget 2026.pdf", open: { appId: "org.webosphoenix.files", params: { path: "/media/internal/Documents" } } });
        expect(f.data.attachments[0].items[0].subtitle).toMatch(/^Internal storage\/Documents · 52 KB · /);
        expect((await d.ask("find the tax pdf")).text).toBe("I couldn't find a file called “tax”. I can open Files for you.");
    });
    it("one day of a repeating event moved or cancelled, as the Calendar does (tested above), and travel time without traffic", async () => {
        const d = device();
        expect((await d.ask("how long will it take to drive to the airport")).text).toBe("San Jose Airport is about 18 minutes away by car (7.7 miles), without traffic.");
        expect((await d.ask("how long to walk to the airport")).text).toBe("San Jose Airport is about 1 hour and 30 minutes away on foot (7.7 miles).");
        const t = await d.ask("what's the traffic like to the airport");
        expect(t.text).toBe("I can't see live traffic, but without it San Jose Airport is about 18 minutes away by car (7.7 miles).");
        expect(t.choices).toEqual([{ id: "open", label: "Open Maps" }]);
        expect((await d.ask("how's the traffic")).text).toMatch(/^I can't see live traffic\. Say where you're going/);
    });
    it("the weather at an hour", async () => {
        const d = device();
        expect((await d.ask("what's the weather at 5pm")).text).toBe("At 5:00 PM: 67°F and light rain, 70% chance of rain.");
        expect((await d.ask("will it rain this morning")).text).toBe("Probably not: a 5% chance of rain at 9:00 AM. Partly cloudy, 59°F.");
    });
    it("hotspot and VPN: on and off, or what Settings needs", async () => {
        const d = device();
        const h = await d.ask("turn on the hotspot");
        expect(h).toMatchObject({ status: "failed", text: "The hotspot didn't turn on: The password has 8 to 63 characters." });
        expect(h.choices).toEqual([{ id: "open", label: "Open Hotspot & Tethering" }]);
        d.state.hotspotPass = true;
        expect((await d.ask("turn on the hotspot")).text).toBe("The hotspot is on.");
        expect(d.state.hotspot).toBe(true);
        expect((await d.ask("turn on vpn")).text).toBe("You haven't set up a VPN yet. You can add one in Settings > VPN.");
        d.state.vpnProfiles = ["Work"];
        expect((await d.ask("turn on vpn")).text).toBe("Connecting to “Work”.");
        expect(d.state.vpn).toBe("Work");
        expect((await d.ask("turn off vpn")).text).toBe("The VPN is off.");
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
    it("the weather here: the position from OSE's location service, with the Assistant's permission", async () => {
        const d = device();
        const m = await d.ask("what's the weather");
        expect(m.text).toBe("It's 64°F and partly cloudy. Today: 70° / 52°.");
        expect(d.called("getCurrentPosition")).toHaveLength(0);
        expect(d.called("com.webos.service.location/getLocationUpdates")[0].params).toEqual({});
        expect(d.requests.at(-1)).toMatch(/latitude=37.37&longitude=-122.04/);
    });
    it("the location not answered yet: it asks, and Allow answers the weather", async () => {
        const d = device({ locationAllowed: null });
        const m = await d.ask("what's the weather");
        expect(m.text).toBe("To check the weather where you are, I need your location. Is it OK if I use it?");
        expect(m.choices!.map((c) => c.label)).toEqual(["Allow", "Don't Allow"]);
        expect(d.called("getLocationUpdates")).toHaveLength(0);
        const r = await d.choose(m, "do:0");
        expect(r.messages.map((x: Msg) => x.text)).toEqual(["OK, I can use your location now.", "It's 64°F and partly cloudy. Today: 70° / 52°."]);
        expect(d.state.locationAllowed).toBe(true);
    });
    it("the location denied: it says so, with Allow Location and the setting", async () => {
        const d = device({ locationAllowed: false });
        const m = await d.ask("what's the weather");
        expect(m.status).toBe("failed");
        expect(m.text).toMatch(/^I'm not allowed to use your location\. Allow it, here or in Settings > Location Services/);
        expect(m.choices!.map((c) => [c.id, c.label])).toEqual([["do:0", "Allow Location"], ["open:1", "Location Settings"]]);
        await d.choose(m, "open:1");
        expect(launched(d)).toEqual({ id: "org.webosphoenix.settings", params: { page: "location" } });
        const r = await d.choose(m, "do:0");
        expect(r.messages.at(-1).text).toBe("It's 64°F and partly cloudy. Today: 70° / 52°.");
    });
    it("Location Services off: it offers to turn them on, then answers", async () => {
        const d = device();
        d.state.gps = d.state.network = false;
        const m = await d.ask("what's the weather");
        expect(m.text).toBe("Location Services are off. Turn them on and I'll check the weather where you are. Or say a city, like “weather in Paris”.");
        expect(m.choices!.map((c) => c.label)).toEqual(["Turn On Location Services", "Location Settings"]);
        const r = await d.choose(m, "do:0");
        expect(r.messages.map((x: Msg) => x.text)).toEqual(["Location Services are on.", "It's 64°F and partly cloudy. Today: 70° / 52°."]);
        expect(d.state.gps && d.state.network).toBe(true);
        expect((await d.ask("turn off location services")).text).toBe("Location Services are off.");
    });
    it("translation goes on to a model or the web", async () => {
        const d = device();
        const m = await d.ask("translate hello into French");
        expect(m.text).toBe("I can't translate without a language model yet, but I can search the web for it.");
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
