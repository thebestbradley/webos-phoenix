// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, effectiveMode, isLit, loadPrefs, savePrefs, snapBrightness, statusText } from "./light";

const led = { available: true, on: true, brightness: 60 };
const off = { available: true, on: false, brightness: 0 };
const none = { available: false, on: false, brightness: 0 };

function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("flashlight logic", () => {
    it("uses the LED when there is one, else the screen", () => {
        expect(effectiveMode("led", led)).toBe("led");
        expect(effectiveMode("led", undefined)).toBe("led");
        expect(effectiveMode("led", none)).toBe("screen");
        expect(effectiveMode("screen", led)).toBe("screen");
    });

    it("knows when it is lit", () => {
        expect(isLit("led", led, false)).toBe(true);
        expect(isLit("led", off, true)).toBe(false);
        expect(isLit("screen", led, false)).toBe(false);
        expect(isLit("screen", off, true)).toBe(true);
    });

    it("says what is on", () => {
        expect(statusText("led", led, false)).toBe("LED on, 60%");
        expect(statusText("led", off, false)).toBe("LED off");
        expect(statusText("screen", none, false)).toBe("No flash LED: the screen lights up");
        expect(statusText("screen", off, false)).toBe("Screen light");
        expect(statusText("screen", off, true)).toBe("Tap anywhere to turn off");
    });

    it("snaps the brightness to 5% steps and never to off", () => {
        expect(snapBrightness(0)).toBe(5);
        expect(snapBrightness(52)).toBe(50);
        expect(snapBrightness(98)).toBe(100);
        expect(snapBrightness(140)).toBe(100);
    });

    it("keeps its preferences and ignores bad ones", () => {
        const s = memory();
        expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
        savePrefs({ mode: "screen", brightness: 40, keepOn: true }, s);
        expect(loadPrefs(s)).toEqual({ mode: "screen", brightness: 40, keepOn: true });
        s.setItem("org.webosphoenix.flashlight.prefs", JSON.stringify({ mode: "laser", brightness: 900, keepOn: "yes" }));
        expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
        s.setItem("org.webosphoenix.flashlight.prefs", "{not json");
        expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    });
});
