// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Flashlight's logic, apart from React: which light to use, what the
// status line says, and the preferences.

import type { TorchStatus } from "@phoenix/luna";

/** The flash LED (torchd) or the whole screen lit white. */
export type Mode = "led" | "screen";

export interface Prefs {
    /** The light the user picked last; "led" falls back to "screen" on a device without a torch. */
    mode: Mode;
    /** LED brightness to switch on at, 1-100. */
    brightness: number;
    /** Leave the LED on when the card is closed (off by default, as LuneOS's Torch app). */
    keepOn: boolean;
}

export const DEFAULT_PREFS: Prefs = { mode: "led", brightness: 100, keepOn: false };
const KEY = "org.webosphoenix.flashlight.prefs";

export function loadPrefs(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Prefs {
    try {
        const p = JSON.parse(storage?.getItem(KEY) ?? "{}") as Partial<Prefs>;
        return {
            mode: p.mode === "screen" ? "screen" : "led",
            brightness: typeof p.brightness === "number" && p.brightness >= 1 && p.brightness <= 100 ? Math.round(p.brightness) : 100,
            keepOn: p.keepOn === true,
        };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export function savePrefs(p: Prefs, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
    try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** The light in use: the LED only when the device has one. */
export function effectiveMode(pref: Mode, torch: TorchStatus | undefined): Mode {
    return pref === "led" && torch?.available !== false ? "led" : "screen";
}

/** Whether the light is on: the LED's status, or the white screen. */
export function isLit(mode: Mode, torch: TorchStatus | undefined, screenOn: boolean): boolean {
    return mode === "led" ? !!torch?.on : screenOn;
}

/** The line under the button. */
export function statusText(mode: Mode, torch: TorchStatus | undefined, screenOn: boolean): string {
    if (mode === "screen") return screenOn ? "Tap anywhere to turn off" : torch?.available === false ? "No flash LED: the screen lights up" : "Screen light";
    if (!torch) return "";
    return torch.on ? `LED on, ${torch.brightness}%` : "LED off";
}

/** Slider positions snap to 5% steps, never 0 (0 is off, which the button does). */
export function snapBrightness(v: number): number {
    return Math.max(5, Math.min(100, Math.round(v / 5) * 5));
}
