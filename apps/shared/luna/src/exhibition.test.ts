// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Exhibitions (dock mode) against the simulated services in
// runtime/phoenix-runtime.js: getDockModeStatus, the exhibition launch
// points, the preferences the shell hears, and the Touchstone charger.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, subscribe } from "./bridge";
import { DOCK_MODE_MAX_APPS, dockMode, isExhibitionLaunch } from "./exhibition";
import { system } from "./services";

const REPO = resolve(__dirname, "../../../..");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

// Installed apps as phoenix-sim / serve-rootfs.py report them: three can be
// exhibitions (appinfo.json exhibitionMode), one cannot.
const APPS = [
    { id: "org.webosphoenix.photos", launchPointId: "org.webosphoenix.photos_default", title: "Photos",
      icon: "/usr/palm/applications/org.webosphoenix.photos/icon.png", exhibitionMode: true, dockMode: true, exhibitionModeTitle: "Photos" },
    { id: "org.webosphoenix.agenda", launchPointId: "org.webosphoenix.agenda_default", title: "Agenda", hidden: true,
      icon: "/usr/palm/applications/org.webosphoenix.agenda/icon.png", exhibitionMode: true, dockMode: true, exhibitionModeTitle: "Agenda" },
    { id: "com.example.weatherwall", launchPointId: "com.example.weatherwall_default", title: "Weather Wall",
      icon: "/usr/palm/applications/com.example.weatherwall/icon.png", exhibitionMode: true, dockMode: true, exhibitionModeTitle: "Weather" },
    { id: "com.example.lamp", launchPointId: "com.example.lamp_default", title: "Night Lamp",
      icon: "/usr/palm/applications/com.example.lamp/icon.png", exhibitionMode: true, dockMode: true, exhibitionModeTitle: "Lamp" },
    { id: "org.webosphoenix.tasks", launchPointId: "org.webosphoenix.tasks_default", title: "Tasks" },
];

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const files: Record<string, string> = { "/usr/share/phoenix/apps.json": JSON.stringify(APPS) };
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) => files[p];
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});

const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload;
const runtime = () => (window as unknown as { __phoenixRuntime: Record<string, (x: unknown) => unknown> }).__phoenixRuntime;

describe("getDockModeStatus", () => {
    it("says what the shell last said, and tells subscribers", async () => {
        expect(await dockMode.status()).toBe(false);
        const seen: boolean[] = [];
        const sub = dockMode.watch((on) => seen.push(on));
        await new Promise((r) => setTimeout(r, 0));
        runtime().applyHostStatus({ dockMode: true });
        expect(await dockMode.status()).toBe(true);
        runtime().applyHostStatus({ dockMode: false });
        sub.cancel();
        expect(seen).toEqual([false, true, false]);
        const r = await call("luna://com.palm.systemmanager/getDockModeStatus", { subscribe: false });
        expect(r).toMatchObject({ returnValue: true, enabled: false });
    });
});

describe("exhibition launch points", () => {
    it("lists the apps that can be exhibitions; Photos is on at first", async () => {
        const points = await dockMode.launchPoints();
        expect(points.map((p) => p.id)).toEqual(["org.webosphoenix.photos", "org.webosphoenix.agenda", "com.example.weatherwall", "com.example.lamp"]);
        expect(points.find((p) => p.id === "org.webosphoenix.photos")).toMatchObject({ enabled: true, exhibitionModeTitle: "Photos" });
        expect(points.find((p) => p.id === "com.example.weatherwall")).toMatchObject({ enabled: false, exhibitionModeTitle: "Weather" });
    });

    it("turns them on and off, at most three, and tells the shell their order", async () => {
        await dockMode.enable("com.example.weatherwall");
        expect(lastStatus()?.exhibitionApps).toEqual(["org.webosphoenix.photos", "com.example.weatherwall"]);
        await dockMode.enable("org.webosphoenix.agenda");
        await expect(dockMode.enable("com.example.lamp")).rejects.toThrow(/At most 3/);
        expect(DOCK_MODE_MAX_APPS).toBe(3);
        await expect(dockMode.enable("org.webosphoenix.tasks")).rejects.toThrow(/Not an exhibition/);
        await dockMode.disable("org.webosphoenix.photos");
        expect(lastStatus()?.exhibitionApps).toEqual(["com.example.weatherwall", "org.webosphoenix.agenda"]);
        await dockMode.setEnabled(["org.webosphoenix.agenda", "org.webosphoenix.photos"]);
        expect(lastStatus()?.exhibitionApps).toEqual(["org.webosphoenix.agenda", "org.webosphoenix.photos"]);
        // The original's ids are Phoenix's apps now.
        await dockMode.enable("com.palm.app.agendaview");
        expect(lastStatus()?.exhibitionApps).toEqual(["org.webosphoenix.photos", "org.webosphoenix.agenda"]);
    });

    it("tells a subscribed list of every change", async () => {
        const seen: string[][] = [];
        const sub = dockMode.watchLaunchPoints((points) => seen.push(points.filter((p) => p.enabled).map((p) => p.id)));
        await new Promise((r) => setTimeout(r, 0));
        await dockMode.enable("com.example.lamp");
        sub.cancel();
        expect(seen).toEqual([["org.webosphoenix.photos"], ["org.webosphoenix.photos", "com.example.lamp"]]);
    });
});

describe("Settings > Exhibition preferences", () => {
    it("reaches the shell with its defaults filled in", async () => {
        await system.setPreferences({ exhibition: { enabled: false, startAfter: 30, nightMode: true, nightStart: "23:00", nightEnd: "6:00" } });
        expect(lastStatus()).toMatchObject({
            exhibition: { enabled: false, startAfter: 30, nightMode: true, nightStart: "23:00", nightEnd: "07:00" },
        });
        await system.setPreferences({ dockModeSoundPref: "mute", dockwallpaper: { wallpaperName: "Dawn", wallpaperFile: "/usr/palm/applications/org.webosphoenix.settings/wallpapers/dawn.jpg" } });
        expect(lastStatus()).toMatchObject({
            dockModeSound: "mute",
            dockWallpaperFile: "/usr/palm/applications/org.webosphoenix.settings/wallpapers/dawn.jpg",
        });
        const p = await new Promise<Record<string, unknown>>((res) => {
            const sub = subscribe("luna://com.webos.service.systemservice/getPreferences", { keys: ["dockModeSoundPref"] }, (r) => { sub.cancel(); res(r); });
        });
        expect(p.dockModeSoundPref).toBe("mute");
    });
});

describe("the Touchstone", () => {
    it("is a dock with power and its serial number, not USB", async () => {
        const signals: Record<string, unknown>[] = [];
        const sub = subscribe("luna://com.palm.bus/signal/addmatch", { category: "/com/palm/power", method: "USBDockStatus" },
                              (r) => { if ("DockConnected" in r) signals.push(r); });
        await new Promise((r) => setTimeout(r, 0));
        runtime().setPower({ charger: "inductive", puckId: "TS-0001" });
        runtime().setPower({ charger: "none", puckId: "" });
        sub.cancel();
        expect(signals[0]).toMatchObject({ Charging: true, DockConnected: true, DockPower: true, DockSerialNo: "TS-0001", USBConnected: false, type: "inductive" });
        expect(signals[1]).toMatchObject({ Charging: false, DockConnected: false, USBConnected: false });
    });

    it("tells exhibition launches apart", () => {
        expect(isExhibitionLaunch({ dockMode: true, windowType: "dockModeWindow" })).toBe(true);
        expect(isExhibitionLaunch({ windowType: "dockModeWindow" })).toBe(true);
        expect(isExhibitionLaunch({ dockMode: "yes" })).toBe(false);
        expect(isExhibitionLaunch(undefined)).toBe(false);
    });
});
