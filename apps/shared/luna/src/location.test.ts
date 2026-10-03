// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Location, the per-app permission and the setup preferences against the
// simulated services in runtime/phoenix-runtime.js.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, subscribe } from "./bridge";
import { formatCoordinates, location, LOCATION_ERRORS, locationPermissions, type LocationPermission } from "./location";
import {
    accessibility, emergencyInfo, firstUse, hasEmergencyInfo, isEmergencyNumber, primaryEmergencyNumber,
} from "./setup";

type Runtime = {
    location: { reset(): void; setPosition(p: { latitude: number; longitude: number }): void; answer(id: string, a: string): void };
    applyHostStatus(s: object): void;
};
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => {
    localStorage.clear();
    rt().location.reset();
});

const until = <T,>(start: (cb: (v: T) => void) => { cancel(): void }, pred: (v: T) => boolean) =>
    new Promise<T>((res) => {
        const sub = start((v) => { if (pred(v)) { sub.cancel(); res(v); } });
    });

describe("location service", () => {
    it("gives a GPS fix with both handlers on", async () => {
        const fix = await location.currentPosition();
        expect(fix.handler).toBe("gps");
        expect(fix.latitude).toBeCloseTo(37.3337, 3);
        expect(fix.longitude).toBeCloseTo(-121.8907, 3);
        expect(fix.horizAccuracy).toBeLessThan(20);
        expect(fix.timestamp).toBeGreaterThan(1.7e12);
    });

    it("falls back to the network handler, and fails with location off", async () => {
        await location.setHandler("gps", false);
        const fix = await location.currentPosition();
        expect(fix.handler).toBe("network");
        expect(fix.horizAccuracy).toBeGreaterThan(100);
        await location.setHandler("network", false);
        const e = await location.currentPosition().catch((x) => x);
        expect(e.errorCode).toBe(LOCATION_ERRORS.LOCATION_OFF);
        const h = await until<Record<string, boolean>>((cb) => location.watchHandlers(cb), () => true);
        expect(h).toEqual({ gps: false, network: false });
        await location.setEnabled(true);
        expect(await until<Record<string, boolean>>((cb) => location.watchHandlers(cb), () => true)).toEqual({ gps: true, network: true });
    });

    it("rejects setState without the capital-H Handler, as the OSE service does", async () => {
        const e = await call("luna://com.webos.service.location/setState", { handler: "gps", state: false }).catch((x) => x);
        expect(e.errorCode).toBe(10);
    });

    it("follows a moved position and names the place", async () => {
        rt().location.setPosition({ latitude: 52.37, longitude: 4.9 });
        const fix = await until<{ latitude: number }>((cb) => location.watch(cb as never), () => true);
        expect(fix.latitude).toBeCloseTo(52.37, 2);
        const place = await location.reverse(52.37, 4.9);
        expect(place.locality).toBe("Amsterdam");
        expect(formatCoordinates(37.3888, -122.0301, 2)).toBe("37.39° N, 122.03° W");
    });

    it("answers navigator.geolocation from the same service", async () => {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
        expect(pos.coords.latitude).toBeCloseTo(37.3337, 3);
        await location.setEnabled(false);
        const err = await new Promise<GeolocationPositionError>((res) => navigator.geolocation.getCurrentPosition(() => {}, res));
        expect(err.code).toBe(2);
    });
});

describe("location permissions", () => {
    it("asks through the system UI and remembers the answer", async () => {
        // Stand in for luna-systemui: it hears the request and the user taps Don't Allow.
        const asked: unknown[] = [];
        const sui = subscribe("luna://com.palm.systemmanager/subscribeToSystemUI", {}, (r) => {
            const ev = r as { event?: string; message?: { appId: string } };
            if (ev.event !== "registerForLocationServiceNotifications") return;
            asked.push(ev.message);
            void call("luna://com.palm.location/rejectLocationRequest", { appId: ev.message!.appId });
        });
        await new Promise((r) => setTimeout(r, 20));
        const e = await location.currentPosition().catch((x) => x);
        expect(asked).toEqual([{ appId: "com.webos.phoenix.unknown" }]);
        expect(e.errorCode).toBe(LOCATION_ERRORS.PERMISSION_DENIED);
        const list = await until<LocationPermission[]>((cb) => locationPermissions.watch(cb), (l) => l.length > 0);
        expect(list[0]).toMatchObject({ appId: "com.webos.phoenix.unknown", allowed: false });
        // Asked once: the next request is refused at once.
        expect((await location.currentPosition().catch((x) => x)).errorCode).toBe(LOCATION_ERRORS.PERMISSION_DENIED);
        expect(asked.length).toBe(1);
        // Settings allows it.
        await locationPermissions.set("com.webos.phoenix.unknown", true);
        expect((await location.currentPosition()).latitude).toBeCloseTo(37.3337, 3);
        await locationPermissions.remove("com.webos.phoenix.unknown");
        sui.cancel();
        localStorage.removeItem("phoenix:systemui:listening");
        // With no system UI to ask, the simulator allows and lists the app.
        await location.currentPosition();
        const again = await until<LocationPermission[]>((cb) => locationPermissions.watch(cb), (l) => l.length > 0);
        expect(again[0].allowed).toBe(true);
    });
});

describe("setup preferences", () => {
    it("keeps the medical ID", async () => {
        expect(hasEmergencyInfo(await emergencyInfo.get())).toBe(false);
        await emergencyInfo.set({ name: "Alex Doe", bloodType: "O+", contacts: [{ name: "Sam", number: "555-0100" }] });
        const got = await until((cb: (v: { name?: string }) => void) => emergencyInfo.watch(cb), (v) => !!v.name);
        expect(got.name).toBe("Alex Doe");
        expect(hasEmergencyInfo(got)).toBe(true);
    });

    it("tracks First Use and the shell's minimal UI", async () => {
        expect(await firstUse.isComplete()).toBe(false);
        rt().applyHostStatus({ firstUse: true });
        expect(await firstUse.running()).toBe(true);
        await firstUse.complete();
        expect(await firstUse.isComplete()).toBe(true);
        rt().applyHostStatus({ firstUse: false });
        expect(await firstUse.running()).toBe(false);
    });

    it("merges accessibility changes", async () => {
        await accessibility.set({ reduceMotion: true });
        await accessibility.set({ highContrast: true });
        const a = await until((cb: (v: { reduceMotion?: boolean; highContrast?: boolean }) => void) => accessibility.watch(cb), () => true);
        expect(a).toMatchObject({ reduceMotion: true, highContrast: true, monoAudio: false });
    });

    it("knows the emergency numbers", () => {
        expect(isEmergencyNumber("911")).toBe(true);
        expect(isEmergencyNumber("112")).toBe(true);
        expect(isEmergencyNumber("111")).toBe(false);
        expect(isEmergencyNumber("111", "nz")).toBe(true);
        expect(isEmergencyNumber("555-0100")).toBe(false);
        expect(isEmergencyNumber("*911")).toBe(false);
        expect(primaryEmergencyNumber("us")).toBe("911");
        expect(primaryEmergencyNumber("de")).toBe("112");
    });
});
