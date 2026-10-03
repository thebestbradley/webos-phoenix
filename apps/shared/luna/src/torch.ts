// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosports.service.torch: the camera flash LED as a steady torch, for
// the Flashlight app. The API is LuneOS's torchd
// (github.com/webOS-ports/org.webosports.service.torch, Apache-2.0), which
// opens nyx's NYX_DEVICE_LED "Torch" module (nyx-modules src/led_torch: the
// kernel LED class under /sys/class/leds, qcom's current + switch nodes, or
// MediaTek's /dev/flashlight). Phoenix uses it unchanged on a device; the
// simulator implements it in runtime/phoenix-runtime.js (block "Torch").
//
//   getStatus {subscribe?} -> {available, on, brightness}   (brightness 0-100)
//   set {on} or {brightness: 0-100} -> the new status        (brightness wins)
//   toggle {} -> the new status
//
// Errors: returnValue false with an errorText ("no torch on this device",
// "need \"on\": boolean, or \"brightness\": 0-100"); torchd sends no
// errorCode. A device without a torch answers getStatus with
// available: false rather than failing.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

export interface TorchStatus {
    /** The device has a torch LED (and nyx could open it). */
    available: boolean;
    on: boolean;
    /** 0-100. Backends with only on/off (the hybris one) report 0 or 100. */
    brightness: number;
}

const SERVICE = "luna://org.webosports.service.torch";

declare module "./types" {
    interface LunaApi {
        "luna://org.webosports.service.torch/getStatus": { params: { subscribe?: boolean }; result: TorchStatus };
        "luna://org.webosports.service.torch/set": { params: { on: boolean } | { brightness: number }; result: TorchStatus };
        "luna://org.webosports.service.torch/toggle": { params: Record<string, never>; result: TorchStatus };
    }
}

const status = (r: TorchStatus): TorchStatus => ({ available: !!r.available, on: !!r.on, brightness: Number(r.brightness) || 0 });

export const torch = {
    async status(): Promise<TorchStatus> {
        return status(await call(`${SERVICE}/getStatus`, {}));
    },
    /** getStatus {subscribe}: the status now and after every change, from any app. */
    watch(cb: (s: TorchStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${SERVICE}/getStatus`, {}, (r) => cb(status(r)), onError);
    },
    async set(on: boolean): Promise<TorchStatus> {
        return status(await call(`${SERVICE}/set`, { on }));
    },
    /** 0 turns it off; the value is clamped to 0-100 and rounded. */
    async setBrightness(brightness: number): Promise<TorchStatus> {
        return status(await call(`${SERVICE}/set`, { brightness: clampBrightness(brightness) }));
    },
    async toggle(): Promise<TorchStatus> {
        return status(await call(`${SERVICE}/toggle`, {}));
    },
};

export function clampBrightness(b: number): number {
    return Math.max(0, Math.min(100, Math.round(Number.isFinite(b) ? b : 0)));
}
