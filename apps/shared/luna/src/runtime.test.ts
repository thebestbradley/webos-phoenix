// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The client against the simulated services in runtime/phoenix-runtime.js,
// loaded into jsdom the way phoenix-sim injects it into a page.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LunaError } from "./bridge";
import { audio, bluetooth, connection, deviceLock, settings, system, wifi, WIFI_ERROR_INVALID_KEY } from "./services";
import type { BluetoothDevice, ConnectionStatus, SystemSettings, WifiStatus } from "./types";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});

const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload;
const next = <T,>(start: (cb: (v: T) => void) => { cancel(): void }, pred: (v: T) => boolean) =>
    new Promise<T>((res) => {
        const sub = start((v) => { if (pred(v)) { sub.cancel(); res(v); } });
    });

describe("simulated OSE services", () => {
    it("turns Wi-Fi off and on and reports it to the shell", async () => {
        await wifi.setEnabled(false);
        expect(lastStatus()).toMatchObject({ wifiEnabled: false, wifiBars: -1 });
        await wifi.setEnabled(true);
        expect(lastStatus()).toMatchObject({ wifiEnabled: true, wifiConnected: true, wifiBars: 3 });
    });

    it("rejects a wrong Wi-Fi password and joins with the right one", async () => {
        const e = await wifi.connect("Lab 5G", "psk", "nope").catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorCode).toBe(WIFI_ERROR_INVALID_KEY);
        await wifi.connect("Lab 5G", "psk", "webos2009");
        const s = await next<WifiStatus>((cb) => wifi.watchStatus(cb), () => true);
        expect(s.networkInfo).toMatchObject({ ssid: "Lab 5G", connectState: "ipConfigured" });
        const nets = await next<{ ssid: string; profileId?: number }[]>((cb) => wifi.watchNetworks(cb), () => true);
        expect(nets.find((n) => n.ssid === "Lab 5G")?.profileId).toBeGreaterThan(0);
    });

    it("airplane mode switches the radios off and restores them", async () => {
        await bluetooth.setPowered(true);
        await connection.setAirplaneMode(true);
        expect(lastStatus()).toMatchObject({ airplaneMode: true, wifiEnabled: false, bluetoothOn: false });
        const st = await next<ConnectionStatus>((cb) => connection.watchStatus(cb), () => true);
        expect(st.offlineMode).toBe("enabled");
        await connection.setAirplaneMode(false);
        expect(lastStatus()).toMatchObject({ airplaneMode: false, wifiEnabled: true, bluetoothOn: true });
    });

    it("discovers and pairs Bluetooth devices", async () => {
        await bluetooth.setPowered(true);
        await bluetooth.startDiscovery();
        const found = await next<BluetoothDevice[]>((cb) => bluetooth.watchDevices(cb), (d) => d.length >= 2);
        await bluetooth.pair(found[0].address);
        const paired = await next<BluetoothDevice[]>((cb) => bluetooth.watchDevices(cb), (d) => d.some((x) => x.paired));
        expect(paired.find((x) => x.paired)?.address).toBe(found[0].address);
    });

    it("stores brightness in the settings service and tells the shell", async () => {
        await settings.set("picture", { backlight: 35 });
        expect(lastStatus()).toMatchObject({ brightness: 35 });
        const v = await next<SystemSettings>((cb) => settings.watch("picture", ["backlight"], cb), () => true);
        expect(v.backlight).toBe(35);
    });

    it("applies status from the shell and answers once with the result", async () => {
        const rt = (window as unknown as { __phoenixRuntime: { applyHostStatus(s: object): void } }).__phoenixRuntime;
        const seen: boolean[] = [];
        const sub = wifi.watchStatus((s) => seen.push(s.status !== "serviceDisabled"));
        await new Promise((r) => setTimeout(r, 10));
        rt.applyHostStatus({ wifiEnabled: false, muted: true, brightness: 20 });
        const sent = hostMessages.filter((m) => m.type === "systemStatus");
        expect(sent).toHaveLength(1);
        expect(sent[0].payload).toMatchObject({ wifiEnabled: false, wifiBars: -1, muted: true, brightness: 20 });
        hostMessages.length = 0;
        rt.applyHostStatus({ airplaneMode: true });
        expect(lastStatus()).toMatchObject({ airplaneMode: true, wifiEnabled: false, bluetoothOn: false });
        await new Promise((r) => setTimeout(r, 10));
        expect(seen[seen.length - 1]).toBe(false);
        sub.cancel();
        const m = await next<{ volume: number; muted: boolean }>((cb) => audio.watchMaster(cb), () => true);
        expect(m.muted).toBe(true);
    });

    it("sets, checks and clears a PIN", async () => {
        await deviceLock.set("pin", "1234");
        expect(await deviceLock.mode()).toBe("pin");
        expect(await deviceLock.matches("1234")).toBe(true);
        expect(await deviceLock.matches("0000")).toBe(false);
        await expect(deviceLock.set("none", undefined, "9999")).rejects.toBeInstanceOf(LunaError);
        await deviceLock.set("none", undefined, "1234");
        expect(await deviceLock.mode()).toBe("none");
    });

    it("lists time zones and reports OS info", async () => {
        const zones = await system.timeZones();
        expect(zones.find((z) => z.ZoneID === "Europe/London")).toBeTruthy();
        const os = await system.osInfo(["webos_name", "webos_release"]);
        expect(os.webos_name).toBe("webOS Phoenix");
        expect(os.core_os_name).toBeUndefined();
    });
});

describe("orientation", () => {
    type Runtime = {
        screenOrientationChanged(o: string): void;
        applyHostStatus(s: object): void;
        dispatch(uri: string, params: object, reply: (r: Record<string, unknown>) => void, ctx: object): void;
    };
    const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
    const palm = () => (window as unknown as {
        PalmSystem: { screenOrientation: string; windowOrientation: string; setWindowOrientation(o: string): void };
    }).PalmSystem;

    it("passes the app's orientation request to the shell", () => {
        palm().setWindowOrientation("left");
        expect(hostMessages.find((m) => m.type === "windowOrientation")?.payload).toMatchObject({ orientation: "left" });
    });

    it("tells the page how its window is turned, with a resize event", () => {
        let resizes = 0;
        const onResize = () => { resizes++; };
        window.addEventListener("resize", onResize);
        rt().screenOrientationChanged("down");
        expect(palm().screenOrientation).toBe("down");
        expect(palm().windowOrientation).toBe("down");
        expect(resizes).toBe(1);
        // Unchanged or unknown: nothing happens.
        rt().screenOrientationChanged("down");
        rt().screenOrientationChanged("sideways");
        expect(resizes).toBe(1);
        expect(palm().screenOrientation).toBe("down");
        rt().screenOrientationChanged("up");
        window.removeEventListener("resize", onResize);
    });

    it("reports the UI and device orientation in getSystemStatus", async () => {
        const status = () => new Promise<Record<string, unknown>>((res) =>
            rt().dispatch("luna://com.palm.systemmanager/getSystemStatus", {}, res, { cancelled: () => false, onCancel: null }));
        expect(await status()).toMatchObject({ returnValue: true, orientation: { ui: "up", device: "up" } });
        rt().applyHostStatus({ orientation: { ui: "left", device: "left" } });
        expect(await status()).toMatchObject({ orientation: { ui: "left", device: "left" } });
    });
});
