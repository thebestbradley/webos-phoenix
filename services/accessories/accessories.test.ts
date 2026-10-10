// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Game controllers, USB drives, tethering and the battery's use on a device
// (accessories.js): the runtime's replies, over fakes of OSE's physical
// device manager, the connman adapter, connmanctl and /sys/class/power_supply.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const acc = require("./accessories.js") as Any;

const flush = () => new Promise((r) => setTimeout(r, 0));

function world(opts: Any = {}) {
    const subs: Record<string, Any[]> = {};
    const calls: Any[] = [];
    const runs: string[][] = [];
    const notes: Any[] = [];
    const ongoing: Any[] = [];
    let saved: Any = null;
    let t = 10 * 24 * 3600 * 1000;
    const sys: Record<string, string> = Object.assign({
        "/sys/class/power_supply/BAT0/type": "Battery", "/sys/class/power_supply/BAT0/capacity": "76",
        "/sys/class/power_supply/BAT0/status": "Discharging", "/sys/class/power_supply/BAT0/temp": "312",
        "/sys/class/power_supply/AC/type": "Mains", "/sys/class/power_supply/AC/online": "0"
    }, opts.sys || {});
    let gadget = false;
    const a = acc.createAccessories({
        call: (uri: string, params: Any) => {
            calls.push({ uri, params });
            if (uri.endsWith("/getAppInfo")) return Promise.resolve({ returnValue: true, appInfo: { title: { "com.palm.app.email": "Email" }[params.id as string] || params.id } });
            return Promise.resolve({ returnValue: true });
        },
        subscribe: (uri: string, params: Any, on: Any) => { (subs[uri] = subs[uri] || []).push(on); return () => {}; },
        readFile: (p: string) => (p in sys ? sys[p] : null),
        listDir: () => ["AC", "BAT0"],
        run: (cmd: string, args: string[]) => {
            runs.push([cmd, ...args]);
            if (args[0] === "tether") { gadget = args[2] === "on"; return Promise.resolve({ code: 0, stdout: "" }); }
            return Promise.resolve({ code: 0, stdout: "/net/connman/technology/wifi\n  Tethering = False\n/net/connman/technology/gadget\n  Powered = True\n  Tethering = " + (gadget ? "True" : "False") + "\n" });
        },
        statfs: (p: string) => (p === "/tmp/usb/sda/sda1" ? { size: 16000, used: 4000 } : null),
        store: { load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), save: (o: Any) => { saved = o; } },
        now: () => t, notify: (n: Any) => notes.push(n), ongoing: (o: Any) => ongoing.push(o)
    });
    const push = (uri: string, r: Any) => (subs[uri] || []).forEach((f) => f(r));
    const ask = (svc: string, method: string, p: Any = {}, caller = "org.webosphoenix.settings") => new Promise<Any>((resolve) => {
        const replies: Any[] = [];
        const box: Any = {};
        box.cancel = a.services[svc][method](p, caller, (r: Any) => {
            replies.push(r);
            if (replies.length === 1) setTimeout(() => resolve(Object.assign(r, { replies, cancel: box.cancel })), 0);
        });
    });
    return { a, push, ask, calls, runs, notes, ongoing, saved: () => saved, tick: (ms: number) => { t += ms; }, sys };
}

const PDM = "luna://com.webos.service.pdm";
const drive = { deviceNum: 3, deviceType: "USB_STORAGE", vendorName: "SanDisk", productName: "Cruzer Blade",
                storageDriveList: [{ driveName: "sda1", volumeLabel: "PHOENIX", fsType: "vfat", driveSize: 15625, isMounted: true, mountName: "/tmp/usb/sda/sda1" }] };

describe("accessories on a device", () => {
    it("lists the game controllers PDM sees", async () => {
        const w = world();
        const r = await w.ask("org.webosphoenix.gamepads", "list", { subscribe: true });
        expect(r.gamepads).toEqual([]);
        w.push(PDM + "/getAttachedNonStorageDeviceList", { returnValue: true, nonStorageDeviceList: [
            { deviceType: "XPAD", vendorName: "Microsoft", productName: "Xbox 360 Controller", deviceNum: 4 },
            { deviceType: "HID", productName: "Keyboard" }] });
        await flush();
        expect(r.replies[1].gamepads).toEqual([{ index: 0, id: "Xbox 360 Controller (Microsoft)", name: "Xbox 360 Controller",
                                                 connection: "usb", mapping: "standard", buttons: [], axes: [] }]);
    });

    it("lists PDM's drives, says when one goes in, and ejects it safely", async () => {
        const w = world();
        w.push(PDM + "/getAttachedStorageDeviceList", { returnValue: true, storageDeviceList: [] });
        const r = await w.ask("org.webosphoenix.usb", "listDrives", { subscribe: true });
        expect(r.drives).toEqual([]);
        w.push(PDM + "/getAttachedStorageDeviceList", { returnValue: true, storageDeviceList: [drive] });
        await flush();
        expect(r.replies[1].drives[0]).toEqual({ id: "sda1", label: "PHOENIX", vendor: "SanDisk Cruzer Blade", size: 16000, used: 4000,
                                                fs: "vfat", mounted: true, path: "/tmp/usb/sda/sda1", safeToRemove: false, deviceNum: 3 });
        expect(w.notes).toEqual([{ appId: "org.webosphoenix.settings", title: "PHOENIX connected", body: "Tap to see it or remove it safely",
                                   params: { page: "usb" } }]);
        await w.ask("org.webosphoenix.usb", "unmount", { id: "sda1" });
        expect(w.calls.find((c: Any) => c.uri === PDM + "/eject").params).toEqual({ deviceNum: 3 });
        expect((await w.ask("org.webosphoenix.usb", "unmount", { id: "nope" })).returnValue).toBe(false);
    });

    it("runs the hotspot through the connman adapter, USB tethering through connmanctl", async () => {
        const w = world();
        const st = await w.ask("org.webosphoenix.tethering", "getStatus", { subscribe: true });
        expect(st.available).toBe(false);
        expect((await w.ask("org.webosphoenix.tethering", "setWifi", { enabled: true })).errorText).toBe("This device has no mobile data to share");
        w.push("luna://com.webos.service.connectionmanager/getStatus", { returnValue: true, wired: { state: "connected" } });
        await flush();
        expect(st.replies[st.replies.length - 1].available).toBe(true);
        expect((await w.ask("org.webosphoenix.tethering", "setWifi", { enabled: true, passphrase: "short" })).errorText)
            .toBe("The password has 8 to 63 characters");
        const on = await w.ask("org.webosphoenix.tethering", "setWifi", { enabled: true, ssid: "Ada's Phoenix", passphrase: "correct horse" });
        expect(w.calls.filter((c: Any) => c.uri.endsWith("/tethering/setState")).pop().params)
            .toEqual({ enabled: true, ssid: "Ada's Phoenix", securityType: "psk", passPhrase: "correct horse" });
        expect(on.wifi).toMatchObject({ enabled: true, ssid: "Ada's Phoenix", passphrase: "correct horse", security: "wpa2" });
        await flush();
        expect(w.ongoing.pop()).toMatchObject({ id: "tethering", body: "Wi-Fi hotspot “Ada's Phoenix” on" });
        const usb = await w.ask("org.webosphoenix.tethering", "setUsb", { enabled: true });
        expect(w.runs).toContainEqual(["connmanctl", "tether", "gadget", "on"]);
        expect(usb.usb).toEqual({ enabled: true, connected: true });
    });

    it("keeps the battery's level and each app's share of the screen-on time", async () => {
        const w = world();
        w.a.sample();
        w.tick(60000);
        w.sys["/sys/class/power_supply/BAT0/capacity"] = "75";
        w.a.sample();
        const r = await w.ask("org.webosphoenix.battery", "usage", {});
        expect(r).toMatchObject({ percent: 75, charging: false, temperature: 31.2, screenOnMs: 0, apps: [] });
        expect(r.history.map((h: Any) => h.percent)).toEqual([76, 75]);
        // Only the shell says which app is in front.
        expect((await w.ask("org.webosphoenix.battery", "phoenix/usageTick", { appId: "com.palm.app.email", ms: 60000 })).returnValue).toBe(false);
        await w.ask("org.webosphoenix.battery", "phoenix/usageTick", { appId: "com.palm.app.email", ms: 90000 }, "com.webos.surfacemanager");
        await w.ask("org.webosphoenix.battery", "phoenix/usageTick", { appId: "", ms: 30000 }, "com.webos.surfacemanager");
        const u = await w.ask("org.webosphoenix.battery", "usage", {});
        expect(u.screenOnMs).toBe(120000);
        expect(u.apps).toEqual([{ appId: "com.palm.app.email", title: "Email", ms: 90000, share: 0.75 },
                                { appId: "", title: "Card view and launcher", ms: 30000, share: 0.25 }]);
        // Charging: the mains supply online.
        w.sys["/sys/class/power_supply/AC/online"] = "1";
        expect(w.a.power().charging).toBe(true);
    });

    it("has luna-service2 files for every method of the four names", () => {
        const api = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.accessories.api.json"), "utf8"));
        const listed = new Set(Object.values(api).flat());
        for (const [svc, methods] of Object.entries(acc.SERVICES) as [string, string[]][])
            for (const m of methods) expect(listed.has(svc + "/" + m)).toBe(true);
        const svc = fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.accessories.service"), "utf8");
        for (const n of Object.keys(acc.SERVICES)) expect(svc).toContain(n);
    });
});
