// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The torch and location clients against the simulated
// org.webosports.service.torch (LuneOS torchd's API) and
// com.webos.service.location in runtime/phoenix-runtime.js.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, LunaError } from "./bridge";
import { location } from "./location";
import { clampBrightness, torch, type TorchStatus } from "./torch";

type Runtime = {
    torch: { setAvailable(a: boolean): void; state(): TorchStatus };
    location: { set(p: object | null | undefined): void };
};
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => localStorage.clear());

describe("simulated org.webosports.service.torch", () => {
    it("starts off, turns on and off", async () => {
        expect(await torch.status()).toEqual({ available: true, on: false, brightness: 0 });
        expect(await torch.set(true)).toEqual({ available: true, on: true, brightness: 100 });
        expect(await torch.toggle()).toMatchObject({ on: false, brightness: 0 });
        expect(await torch.toggle()).toMatchObject({ on: true, brightness: 100 });
    });

    it("takes a brightness, which wins over on (torchd's cb_set)", async () => {
        expect(await torch.setBrightness(40)).toMatchObject({ on: true, brightness: 40 });
        expect(await call("luna://org.webosports.service.torch/set", { on: true, brightness: 0 } as never)).toMatchObject({ on: false, brightness: 0 });
        const e = await call("luna://org.webosports.service.torch/set", { brightness: 101 }).catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorText).toBe("need \"on\": boolean, or \"brightness\": 0-100");
        expect(clampBrightness(140.2)).toBe(100);
        expect(clampBrightness(-3)).toBe(0);
        expect(clampBrightness(NaN)).toBe(0);
    });

    it("tells subscribers about every change", async () => {
        const seen: TorchStatus[] = [];
        const sub = torch.watch((s) => seen.push(s));
        await new Promise((r) => setTimeout(r, 10));
        await torch.setBrightness(60);
        await torch.set(false);
        sub.cancel();
        await torch.set(true);
        expect(seen.map((s) => s.brightness)).toEqual([0, 60, 0]);
    });

    it("says when there is no torch", async () => {
        rt().torch.setAvailable(false);
        expect(await torch.status()).toEqual({ available: false, on: false, brightness: 0 });
        const e = await torch.set(true).catch((x) => x);
        expect(e.errorText).toBe("no torch on this device");
        expect((await torch.toggle().catch((x) => x)).errorText).toBe("no torch on this device");
    });
});

describe("simulated com.webos.service.location", () => {
    it("gives the simulated position, a set one, or an error when location is off", async () => {
        expect(await location.currentPosition()).toMatchObject({ latitude: 37.3688, longitude: -122.0363 });
        rt().location.set({ latitude: 51.5, longitude: -0.12 });
        expect(await location.currentPosition()).toMatchObject({ latitude: 51.5, longitude: -0.12 });
        rt().location.set(null);
        const e = await location.currentPosition().catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorText).toBe("Location services are off");
    });
});
