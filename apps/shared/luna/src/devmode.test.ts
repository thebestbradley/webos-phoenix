// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Developer Mode against the simulated services in runtime/phoenix-runtime.js:
// developer apps (appinfo.json "phoenix": {"developer": true}) only while it
// is on, Settings' Developer Mode once Just Type's Konami code revealed it
// (com.palm.app.devmodeswitcher), and what the shell hears.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, subscribe } from "./bridge";
import { devMode } from "./services";

const REPO = resolve(__dirname, "../../../..");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

// As phoenix-sim / serve-rootfs.py report them (developer: "devmode" | "unlock" | "").
const APPS = [
    { id: "org.webosphoenix.tasks", launchPointId: "org.webosphoenix.tasks_default", title: "Tasks", developer: "" },
    { id: "org.webosphoenix.terminal", launchPointId: "org.webosphoenix.terminal_default", title: "Terminal", developer: "devmode" },
    { id: "org.webosphoenix.notificationlab", launchPointId: "org.webosphoenix.notificationlab_default", title: "Notification Lab", developer: "devmode" },
    { id: "org.webosphoenix.settings", launchPointId: "org.webosphoenix.settings_default", title: "Settings", hidden: true, developer: "" },
    { id: "org.webosphoenix.settings", launchPointId: "org.webosphoenix.settings.devmode", title: "Developer Mode",
      params: { page: "devmode" }, hidden: false, developer: "unlock" },
    { id: "org.webosphoenix.settings", launchPointId: "org.webosphoenix.settings.wifi", title: "Wi-Fi",
      params: { page: "wifi" }, hidden: false, developer: "" },
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

const shown = async () => ((await call("luna://com.palm.applicationManager/listLaunchPoints", {})) as unknown as
    { launchPoints: { launchPointId: string }[] }).launchPoints.map((lp) => lp.launchPointId);
const search = async (keyword: string) => ((await call("luna://com.palm.applicationManager/searchApps", { keyword })) as unknown as
    { apps: { launchPoint: string }[] }).apps.map((a) => a.launchPoint);
const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload;

describe("developer apps", () => {
    it("are left out of the launch points and the search until Developer Mode is on", async () => {
        expect(await shown()).toEqual(["org.webosphoenix.tasks_default", "org.webosphoenix.settings.wifi"]);
        expect(await search("term")).toEqual([]);
        await devMode.set(true);
        expect(await shown()).toEqual(["org.webosphoenix.tasks_default", "org.webosphoenix.terminal_default",
            "org.webosphoenix.notificationlab_default", "org.webosphoenix.settings.devmode", "org.webosphoenix.settings.wifi"]);
        expect(await search("term")).toEqual(["org.webosphoenix.terminal_default"]);
        // The shell hears it (its launcher follows).
        expect(lastStatus()).toMatchObject({ devMode: true });
        await devMode.set(false);
        expect(await search("term")).toEqual([]);
        expect(lastStatus()).toMatchObject({ devMode: false });
    });

    it("come and go in launchPointChanges as Developer Mode turns on and off", async () => {
        const changes: { change: string; launchPointId: string }[] = [];
        const sub = subscribe("luna://com.palm.applicationManager/launchPointChanges", { subscribe: true }, (r) => {
            const c = r as unknown as { change?: string; launchPointId: string };
            if (c.change) changes.push({ change: c.change, launchPointId: c.launchPointId });
        });
        await new Promise((r) => setTimeout(r, 0));
        await devMode.set(true);
        await devMode.set(false);
        sub.cancel();
        expect(changes).toEqual([
            { change: "added", launchPointId: "org.webosphoenix.terminal_default" },
            { change: "added", launchPointId: "org.webosphoenix.notificationlab_default" },
            { change: "added", launchPointId: "org.webosphoenix.settings.devmode" },
            { change: "removed", launchPointId: "org.webosphoenix.terminal_default" },
            { change: "removed", launchPointId: "org.webosphoenix.notificationlab_default" },
            { change: "removed", launchPointId: "org.webosphoenix.settings.devmode" },
        ]);
    });
});

describe("Just Type's Konami code", () => {
    it("answers the search for it, so the original Just Type shows its Developer Mode Enabler", async () => {
        // LaunchPointSearch.js:132-139 adds its own result to any reply with apps.
        const r = await call("luna://com.palm.applicationManager/searchApps", { keyword: "upupdowndownleftrightleftrightbastart" });
        expect(r).toMatchObject({ returnValue: true, apps: [] });
    });

    it("launching the Developer Mode Enabler reveals Settings' Developer Mode for good and opens it", async () => {
        expect(await shown()).not.toContain("org.webosphoenix.settings.devmode");
        await call("luna://com.palm.applicationManager/launch", { id: "com.palm.app.devmodeswitcher", params: {} });
        const launch = hostMessages.find((m) => m.type === "launch")?.payload;
        expect(launch).toMatchObject({ id: "org.webosphoenix.settings", params: { page: "devmode" } });
        expect(await shown()).toContain("org.webosphoenix.settings.devmode");
        // The developer apps still need Developer Mode itself.
        expect(await shown()).not.toContain("org.webosphoenix.terminal_default");
        expect(lastStatus()).toMatchObject({ devModeUnlocked: true, devMode: false });
        const seen: boolean[] = [];
        const sub = devMode.watchUnlocked((u) => seen.push(u));
        await new Promise((r) => setTimeout(r, 0));
        // Hidden again from the pane (Hide Developer Mode).
        await devMode.setUnlocked(false);
        sub.cancel();
        expect(seen).toEqual([true, false]);
        expect(await shown()).not.toContain("org.webosphoenix.settings.devmode");
        expect(lastStatus()).toMatchObject({ devModeUnlocked: false });
    });
});
