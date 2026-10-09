// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A small stand-in for the device the Assistant's service runs on, for
// tests that go through the service (assistant.js -> lib/commands.js): a
// db8 that keeps what is put, the activity manager, audio, display, power,
// location, and the web services' answers. The same as commands.test.ts's,
// with seed() to add records. NOW is Wednesday 7 October 2026, 10:00.

import { createRequire } from "node:module";
import { expect } from "vitest";

export type Reply = { returnValue: boolean; errorText?: string; [k: string]: any };
export type Msg = { id: string; role: string; text: string; status?: string; command?: string; confirm?: any; choices?: { id: string; label: string }[]; data?: any };
const req = createRequire(import.meta.url);
const { createAssistantService } = req("../assistant.js") as { createAssistantService(d: object): Record<string, (p?: object) => Promise<Reply>> };

export const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
export const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();

// llm: the on-device model runner, llmRequest its HTTP (model-calls.test.ts:
// a real llama-server); apps: more launch points.
export function device(opts: { offline?: boolean; locationAllowed?: boolean | null; seed?: (put: (o: any) => string) => void; llm?: object;
                               llmRequest?: (r: object) => Promise<any>; apps?: { id: string; title: string }[] } = {}) {
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

    opts.seed?.(put);
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
                                            { id: "org.webosphoenix.settings", title: "Sounds & Ringtones", params: { page: "sounds" } }].concat(opts.apps || []) });
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
        if (opts.llmRequest && /^http:\/\/127\.0\.0\.1[:/]/.test(r.url)) return opts.llmRequest(r);
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
    const svc = createAssistantService({ luna, storage, request, now: () => clock, caller: () => "com.palm.systemui", llm: opts.llm, localDeadlineMs: opts.llm ? 600000 : undefined,
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
