// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { call, LunaError, setBridgeFactory, subscribe, type ServiceBridge } from "./bridge";

// A fake bridge that records calls and lets the test reply.
class FakeBridge implements ServiceBridge {
    static made: FakeBridge[] = [];
    onservicecallback: ((json: string) => void) | null = null;
    uri = "";
    params: Record<string, unknown> = {};
    cancelled = false;
    constructor() { FakeBridge.made.push(this); }
    call(uri: string, json: string) { this.uri = uri; this.params = JSON.parse(json); return 1; }
    cancel() { this.cancelled = true; }
    reply(r: object) { this.onservicecallback?.(JSON.stringify(r)); }
}

afterEach(() => {
    setBridgeFactory(null);
    FakeBridge.made = [];
});

describe("call", () => {
    it("sends the params and resolves with the reply", async () => {
        setBridgeFactory(() => new FakeBridge());
        const p = call("luna://com.webos.service.wifi/setstate", { state: "enabled" });
        const b = FakeBridge.made[0];
        expect(b.uri).toBe("luna://com.webos.service.wifi/setstate");
        expect(b.params).toEqual({ state: "enabled" });
        b.reply({ returnValue: true });
        await expect(p).resolves.toEqual({ returnValue: true });
    });

    it("rejects with a LunaError when returnValue is false", async () => {
        setBridgeFactory(() => new FakeBridge());
        const p = call("luna://com.webos.service.wifi/connect", { ssid: "x" });
        FakeBridge.made[0].reply({ returnValue: false, errorCode: 10, errorText: "The supplied password is incorrect" });
        const e = await p.catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorCode).toBe(10);
        expect(e.errorText).toMatch(/password/);
        expect(e.uri).toBe("luna://com.webos.service.wifi/connect");
    });

    it("rejects on malformed JSON", async () => {
        setBridgeFactory(() => new FakeBridge());
        const p = call("luna://x/y", {});
        FakeBridge.made[0].onservicecallback?.("{nope");
        await expect(p).rejects.toBeInstanceOf(LunaError);
    });

    it("times out and cancels the bridge", async () => {
        vi.useFakeTimers();
        setBridgeFactory(() => new FakeBridge());
        const p = call("luna://x/y", {}, { timeoutMs: 100 });
        vi.advanceTimersByTime(150);
        await expect(p).rejects.toMatchObject({ errorCode: -2 });
        expect(FakeBridge.made[0].cancelled).toBe(true);
        vi.useRealTimers();
    });

    it("rejects when there is no PalmServiceBridge", async () => {
        await expect(call("luna://x/y", {})).rejects.toBeInstanceOf(LunaError);
    });
});

describe("subscribe", () => {
    it("adds subscribe: true, delivers every reply and stops after cancel", () => {
        setBridgeFactory(() => new FakeBridge());
        const got: unknown[] = [];
        const errors: LunaError[] = [];
        const sub = subscribe("luna://com.webos.service.wifi/getstatus", {}, (r) => got.push(r.status), (e) => errors.push(e));
        const b = FakeBridge.made[0];
        expect(b.params).toEqual({ subscribe: true });
        b.reply({ returnValue: true, status: "serviceEnabled" });
        b.reply({ returnValue: false, errorText: "boom" });
        b.reply({ returnValue: true, status: "connectionStateChanged" });
        sub.cancel();
        b.reply({ returnValue: true, status: "serviceDisabled" });
        expect(got).toEqual(["serviceEnabled", "connectionStateChanged"]);
        expect(errors.map((e) => e.errorText)).toEqual(["boom"]);
        expect(b.cancelled).toBe(true);
        expect(sub.cancelled).toBe(true);
    });
});
