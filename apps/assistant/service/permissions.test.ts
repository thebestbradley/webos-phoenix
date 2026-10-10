// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Every command the assistant can run, through the service against a
// recording stand-in of the device: each Luna method it calls must be one
// its luna-service2 client permissions allow (sysbus/*.perm.json, by the
// called service's API groups: OSE's own files where the service is OSE's,
// listed below with their source), and each db8 kind it reads or changes
// must be granted to it (public/configuration/db/permissions, installed to
// /etc/palm/db/permissions; the kinds belong to the apps). Every command in
// the catalogue has a request here, so a new one cannot go unchecked.
// The simulator's own permission paths (the location permission, a command
// turned off in Settings) are tools/test-assistant.cjs's.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Reply = { returnValue: boolean; errorText?: string; [k: string]: any };
const req = createRequire(import.meta.url);
const { createAssistantService } = req("./assistant.js") as { createAssistantService(d: object): Record<string, (p?: object) => Promise<Reply>> };
const { BUILT_IN } = req("./lib/commands.js") as { BUILT_IN: { id: string; internal?: boolean }[] };

// The API group of each method the assistant calls. OSE's are from its
// services' sysbus files (github.com/webosose: db8
// files/sysbus/dynamic/com.webos.service.db.api.json, activitymanager,
// sam com.webos.sam.api.json, com.webos.service.location, audiod-pro,
// com.webos.service.bluetooth2, luna-sysservice
// com.webos.service.systemservice.api.json); Phoenix's from this
// repository's sysbus files; the rest (legacy names Phoenix answers on a
// device, groups not yet checked against a device) as perm.json names them.
const GROUPS: [RegExp, string][] = [
    [/^com\.palm\.db\//, "database.operation"],
    [/^com\.palm\.activitymanager\/(?:create|cancel)$/, "activity.operation"],
    [/^com\.palm\.applicationManager\/(?:launch|open)$/, "phoenix.appmanager.launch"],                 // services/appmanager
    [/^com\.palm\.applicationManager\/listLaunchPoints$/, "phoenix.appmanager.query"],
    [/^com\.webos\.service\.location\/(?:getLocationUpdates|getAllLocationHandlers)$/, "location.query"],
    [/^com\.webos\.service\.location\/setState$/, "location.operation"],
    [/^com\.webos\.service\.audio\/(?:master\/getVolume|getInputVolume)$/, "audio.query"],
    [/^com\.webos\.service\.audio\/(?:master\/setVolume|master\/muteVolume|setInputVolume)$/, "audio.operation"],
    [/^com\.webos\.service\.bluetooth2\/adapter\/getStatus$/, "bluetooth.query"],
    [/^com\.webos\.service\.bluetooth2\/adapter\/setState$/, "bluetooth.management"],
    [/^com\.webos\.service\.systemservice\/(?:getPreferences|deviceInfo\/query)$/, "systemsettings.query"],
    [/^com\.webos\.service\.systemservice\/setPreferences$/, "systemsettings.management"],
    [/^com\.palm\.display\/control\/(?:getProperty|setProperty|setState)$/, "devices.display.control"],   // services/devices
    [/^org\.webosphoenix\.service\.packages\/search$/, "marketplace.management"],                         // apps/marketplace/service
    [/^org\.webosphoenix\.transcriber\//, "transcriber.operation"],                                       // apps/voicememos/service
    [/^org\.webosphoenix\.filemanager\/search$/, "filemanager.operation"],                               // apps/files/service
    [/^org\.webosphoenix\.tethering\/getStatus$/, "phoenix.accessories.query"],                       // services/accessories
    [/^org\.webosphoenix\.tethering\/(?:setWifi|setUsb)$/, "phoenix.accessories.management"],
    [/^org\.webosphoenix\.clipboard\/add$/, "phoenix.clipboard"],
    [/^com\.webos\.service\.vpn\//, "vpn.management"],                                                     // LuneOS's luneos-vpn-adapter
    [/^org\.webosphoenix\.service\.location\//, "phoenix.location.permissions"],
    [/^org\.webosphoenix\.system\/mediaKey$/, "phoenix.system.media"],
    [/^com\.webos\.service\.wifi\//, "wifi.management"],
    [/^com\.webos\.service\.connectionmanager\//, "networkconnection"],
    [/^org\.webosports\.service\.torch\//, "torch.operation"],
    [/^org\.webosports\.service\.messaging\//, "messaging.operation"],
    [/^com\.palm\.smtp\//, "messaging.operation"],
    [/^com\.palm\.telephony\//, "telephony.query"],
    [/^com\.palm\.universalsearch\//, "systemui.searchprovider"],
    [/^com\.palm\.systemmanager\/takeScreenShot$/, "devices.display.control"],
    [/^com\.palm\.power\/com\/palm\/power\//, "devices.power.query"],                                  // services/devices
];
const PERM = JSON.parse(readFileSync(resolve(__dirname, "sysbus/org.webosphoenix.assistant.perm.json"), "utf8"))["org.webosphoenix.assistant"] as string[];
const DB_PERMS = JSON.parse(readFileSync(resolve(__dirname, "../public/configuration/db/permissions/org.webosphoenix.assistant"), "utf8")) as
    { object: string; caller: string; operations: Record<string, string> }[];

// A request for each command (test/phrases.cjs); confirm: accept the read-back.
const PHRASES = req("./test/phrases.cjs") as Record<string, string>;
// Commands run as another one's action (locationAccess: the Allow button).
const ACTIONS: Record<string, true> = { locationAccess: true, copyText: true };

const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0).getTime();

function device() {
    const db = new Map<string, any>();
    let n = 0;
    const put = (o: any) => { const id = o._id || "db" + ++n; db.set(id, { ...o, _id: id }); return id; };
    put({ _kind: "com.palm.account:1", templateId: "com.palm.palmprofile" });
    put({ _kind: "com.palm.calendar:1", syncSource: "Local", isReadOnly: false });
    put({ _id: "ev", _kind: "com.palm.calendarevent:1", subject: "Dentist", dtstart: at(9, 14), dtend: at(9, 15) });
    put({ _kind: "com.palm.person:1", name: { givenName: "Sam", familyName: "Delgado" }, phoneNumbers: [{ value: "(303) 555-0135", type: "type_mobile" }],
          emails: [{ value: "sam@example.com" }] });
    put({ _kind: "com.palm.tasklist:1", name: "Shopping" });
    put({ _kind: "com.palm.tasklist:1", name: "Inbox", isDefault: true });
    put({ _kind: "com.palm.task:1", summary: "Milk", listId: "db5", completed: false });
    put({ _kind: "com.palm.note:1", text: "Wifi code", position: "m" });
    put({ _kind: "com.palm.clock.alarm:1", key: "a1", hour: 18, minute: 30, occurs: "once", enabled: true });
    put({ _kind: "com.palm.mail.account:1", accountId: "acct", email: "me@example.com" });
    put({ _kind: "com.palm.email:1", subject: "Hi", flags: { read: false }, from: { addr: "alex@example.com", name: "Alex" }, timestamp: NOW - 1000 });
    put({ _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "Hi", from: { addr: "3035550135" }, localTimestamp: NOW - 1000 });
    put({ _kind: "com.palm.phonecall:1", type: "missed", timestamp: NOW - 1000, from: { addr: "3035550135" }, to: [] });
    put({ _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/a.jpg", createdTime: at(6, 12) });
    // What it did: [method, kind, operation].
    const used: [string, string, string][] = [];
    // eslint-disable-next-line prefer-const
    let dev: { allowed: boolean | null; lose: string } = { allowed: true, lose: "" };
    const kindOf = (o: any) => o && (o._kind || db.get(o._id)?._kind);
    const ok = (o: object = {}) => Promise.resolve({ returnValue: true, ...o });
    const luna = {
        call(uri: string, p: any): Promise<any> {
            const m = uri.replace(/^luna:\/\//, "");
            const record = (kind: string, op: string) => used.push([m, kind, op]);
            if (m === "com.palm.db/find") { record(p.query.from, "read"); return ok({ results: [...db.values()].filter((o) => o._kind === p.query.from) }); }
            if (m === "com.palm.db/get") { p.ids.forEach((id: string) => record(kindOf({ _id: id }), "read")); return ok({ results: p.ids.map((id: string) => db.get(id)).filter(Boolean) }); }
            if (m === "com.palm.db/put") {
                p.objects.forEach((o: any) => record(o._kind, db.has(o._id) ? "update" : "create"));
                // dev.lose: a kind db8 answers for but does not keep (what the read-back catches).
                return ok({ results: p.objects.map((o: any) => (o._kind === dev.lose ? { id: "lost" + ++n } : { id: put(o) })) });
            }
            if (m === "com.palm.db/merge") { p.objects.forEach((o: any) => { record(kindOf(o), "update"); db.set(o._id, { ...db.get(o._id), ...o }); }); return ok(); }
            if (m === "com.palm.db/del") { (p.ids || []).forEach((id: string) => { record(kindOf({ _id: id }), "delete"); db.delete(id); }); return ok(); }
            if (m === "com.palm.db/reserveIds") { used.push([m, "", ""]); return ok({ ids: Array.from({ length: p.count }, () => "r" + ++n) }); }
            used.push([m, "", ""]);
            if (m.endsWith("/listLaunchPoints")) return ok({ launchPoints: [{ id: "org.webosphoenix.maps", title: "Maps" }] });
            if (m === "org.webosphoenix.service.location/getPermissions")
                return ok({ permissions: dev.allowed === null ? [] : [{ appId: "org.webosphoenix.assistant", allowed: dev.allowed }] });
            if (m === "org.webosphoenix.service.location/setPermission") { dev.allowed = p.allowed; return ok(); }
            if (m === "com.webos.service.location/getAllLocationHandlers") return ok({ handlers: [{ name: "gps", state: true }] });
            if (m === "com.webos.service.location/getLocationUpdates") return ok({ latitude: 37, longitude: -122 });
            if (m === "com.webos.service.audio/master/getVolume") return ok({ volumeStatus: { volume: 50 } });
            if (m === "com.palm.display/control/getProperty") return ok({ maximumBrightness: 50 });
            if (m === "com.palm.power/com/palm/power/batteryStatusQuery") return ok({ percent: 50 });
            if (m === "com.palm.telephony/voicemailQuery") return ok({ number: "5550100", count: 1, waiting: true });
            if (m === "com.webos.service.vpn/getProfileList") return ok({ vpnProfiles: [{ vpnProfileName: "Work" }] });
            if (m === "org.webosphoenix.filemanager/search") return ok({ entries: [{ name: "budget.ods", path: "/media/internal/Documents/budget.ods", type: "file", size: 100, mtime: NOW }] });
            if (m === "org.webosphoenix.service.packages/search") return ok({ apps: [{ id: "doom", sourceId: "s", title: "Doom" }] });
            if (m === "com.webos.service.wifi/getstatus") return ok({ status: "connected" });
            return ok();
        },
    };
    const data = new Map<string, unknown>([["assistant:settings", { followUps: false }]]);
    const storage = {
        get: (k: string) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null),
        set: (k: string, v: unknown) => { data.set(k, JSON.parse(JSON.stringify(v))); },
        remove: (k: string) => { data.delete(k); },
        keys: (prefix: string) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    };
    const request = (r: { url: string }) => Promise.resolve(r.url.includes("geocoding")
        ? { status: 200, body: JSON.stringify({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris" }] }) }
        : { status: 200, body: JSON.stringify({ current: { temperature_2m: 20, weather_code: 0 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12] } }) });
    const svc = createAssistantService({ luna, storage, request, now: () => NOW, caller: () => "com.palm.systemui", locale: () => "en-US",
                                         secrets: { seal: () => Promise.resolve({}), unseal: () => Promise.resolve("") } });
    return Object.assign(dev, { svc, used });
}

describe("what each command may do on a device", () => {
    it("has a request for every command in the catalogue", () => {
        expect(BUILT_IN.map((c) => c.id).filter((id) => !(id in PHRASES)), "commands without a request here").toEqual([]);
    });

    // The settings toggle reaches through services of their own.
    for (const text of ["turn on the hotspot", "turn on vpn", "turn off vpn", "turn on location services", "turn on rotation lock"]) {
        it(`toggle "${text}": its Luna calls are in its client permissions`, async () => {
            const d = device();
            const r = await d.svc.ask({ text, newThread: true });
            expect(r.messages.at(-1)).toMatchObject({ command: "toggle", status: "done" });
            for (const [method] of d.used) {
                const g = GROUPS.find(([re]) => re.test(method));
                expect(g, `${text}: ${method}`).toBeTruthy();
                expect(PERM, `${text}: ${method}`).toContain(g![1]);
            }
        });
    }

    for (const c of BUILT_IN) {
        it(`${c.id}: its Luna calls are in its client permissions, its db8 kinds granted`, async () => {
            const d = device();
            let thread = "";
            const ask = async (text: string) => {
                const r = await d.svc.ask({ text, ...(thread ? { threadId: thread } : { newThread: true }) });
                expect(r.returnValue, r.errorText).toBe(true);
                thread = r.thread.id;
                return r.messages.at(-1);
            };
            if (c.id === "undo") await ask("new note: something");
            let m: any;
            if (c.id === "locationAccess") {
                // Run as its button: the Assistant asks before it uses the location; Allow.
                d.allowed = null;
                m = await ask("what's the weather");
                const r = await d.svc.choose({ threadId: thread, messageId: m.id, choice: "do:0" });
                expect(r.messages.map((x: Reply) => x.command)).toContain(c.id);
                expect(r.messages.at(-1).text).toMatch(/°/);
            } else if (c.id === "copyText") {
                // Run as its button: a memo db8 took but does not have; Copy It Instead.
                d.lose = "com.palm.note:1";
                m = await ask("new note: buy flowers");
                expect(m).toMatchObject({ status: "failed", text: "I couldn't save it to Memos: it isn't there when I check." });
                const r = await d.svc.choose({ threadId: thread, messageId: m.id, choice: "do:0" });
                expect(r.messages.at(-1)).toMatchObject({ command: "copyText", text: "Copied. You can paste it anywhere." });
            } else {
                m = await ask(PHRASES[c.id]);
                expect(m.command, `"${PHRASES[c.id]}" runs ${c.id}`).toBe(c.id);
                if (m.status === "pending") {
                    const r = await d.svc.confirm({ threadId: thread, messageId: m.id, accept: true });
                    m = r.messages.at(-1);
                }
                expect(m.status, `${c.id}: ${m.text}`).not.toBe("failed");
            }
            for (const [method, kind, op] of d.used) {
                const g = GROUPS.find(([re]) => re.test(method));
                expect(g, `${c.id} calls ${method}: which API group?`).toBeTruthy();
                expect(PERM, `${c.id} calls ${method} (${g![1]})`).toContain(g![1]);
                if (kind) {
                    const grant = DB_PERMS.find((x) => x.object === kind && x.caller === "org.webosphoenix.assistant");
                    expect(grant?.operations[op], `${c.id}: ${op} ${kind}`).toBe("allow");
                }
            }
        });
    }
});
