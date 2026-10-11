// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The community's options in runtime/phoenix-runtime.js (docs/M6-PLAN.md
// F4): Settings > Advanced's preferences reach the shell as the
// systemStatus tweaks; the airplaneMode preference (luna-systemui's power
// menu sets it) turns the radios off; the display's powerKeyPressed signal
// reaches com.palm.bus/signal/addmatch listeners (luna-systemui's
// PowerdService.js); the power menu's services answer.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, subscribe } from "./bridge";

type Msg = { type: string; payload: Record<string, unknown> };
const host: Msg[] = [];
const last = (type: string) => host.filter((m) => m.type === type).pop()?.payload;
type Runtime = { displaySignal(method: string, payload: Record<string, unknown>): void };
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => host.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => {
    localStorage.clear();
    host.length = 0;
});

describe("Settings > Advanced", () => {
    it("sends the tweaks to the shell, LunaCE's keys and defaults", async () => {
        await call("luna://com.webos.service.systemservice/setPreferences", { infiniteCardCyclingEnabled: true, launcherGridDensity: "dense" });
        expect(last("systemStatus")?.tweaks).toEqual({
            infiniteCardCycling: true, maximizeEdges: false, waveLauncher: true, tapRipple: true, animationSpeed: "normal",
            gestureSensitivity: "normal", haptics: false, gridDensity: "dense", batteryPercent: false, numberRow: false,
            keyboardStyle: "auto", startupAnimation: "phoenix",
            keyboardButton: true, keyboardButtonSide: "right", keyboardButtonY: 1,
            keyboardButtonHintShown: false, glassBlur: "live",
        });
        await call("luna://com.webos.service.systemservice/setPreferences", { showReticleAnimation: false, animationSpeed: "warp" });
        const t = last("systemStatus")?.tweaks as Record<string, unknown>;
        expect(t.tapRipple).toBe(false);
        expect(t.animationSpeed).toBe("normal");
        await call("luna://com.webos.service.systemservice/setPreferences", { startupAnimation: "classic" });
        expect((last("systemStatus")?.tweaks as Record<string, unknown>).startupAnimation).toBe("classic");
        await call("luna://com.webos.service.systemservice/setPreferences", { startupAnimation: "fireworks" });
        expect((last("systemStatus")?.tweaks as Record<string, unknown>).startupAnimation).toBe("phoenix");
    });
    // Phoenix 2.0 (docs/SYSTEM-UI-2.md): the shell's look, only once chosen
    // (the shell's own default otherwise), and Ember Glass's live blur.
    it("the look and live blur reach the shell; a look that is none is left out", async () => {
        await call("luna://com.webos.service.systemservice/setPreferences", { look: "ember-glass", glassBlur: "none" });
        expect(last("systemStatus")?.tweaks).toMatchObject({ look: "ember-glass", glassBlur: "none" });
        await call("luna://com.webos.service.systemservice/setPreferences", { look: "aurora", glassBlur: "sometimes" });
        const t = last("systemStatus")?.tweaks as Record<string, unknown>;
        expect(t.look).toBeUndefined();
        expect(t.glassBlur).toBe("live");
    });
    it("the shell's look gives Ember Glass's default wallpaper while none is chosen", async () => {
        const wallpaper = async () => ((await call("luna://com.webos.service.systemservice/getPreferences", { keys: ["wallpaper"] })) as
            { wallpaper: { wallpaperFile: string } }).wallpaper.wallpaperFile;
        expect(await wallpaper()).toMatch(/northern-lights\.jpg$/);
        expect(last("systemStatus")).toBeUndefined();
        (window as unknown as { __phoenixRuntime: { applyHostStatus(s: Record<string, unknown>): void } }).__phoenixRuntime.applyHostStatus({ look: "ember-glass" });
        expect(await wallpaper()).toMatch(/phoenix\.jpg$/);
        expect(last("systemStatus")).toMatchObject({ wallpaperDefault: true });
        expect(last("systemStatus")?.wallpaperFile).toMatch(/phoenix\.jpg$/);
        await call("luna://com.webos.service.systemservice/setPreferences",
                   { wallpaper: { wallpaperName: "Silk", wallpaperFile: "/usr/palm/applications/org.webosphoenix.settings/wallpapers/silk.jpg" } });
        expect(await wallpaper()).toMatch(/silk\.jpg$/);
        expect(last("systemStatus")).toMatchObject({ wallpaperDefault: false });
    });
    it("the keyboard button's place and Hide reach the shell, anything else read as the defaults", async () => {
        await call("luna://com.webos.service.systemservice/setPreferences", { keyboardButton: false, keyboardButtonSide: "left", keyboardButtonY: 0.25, keyboardButtonHintShown: true });
        expect(last("systemStatus")?.tweaks).toMatchObject({ keyboardButton: false, keyboardButtonSide: "left", keyboardButtonY: 0.25, keyboardButtonHintShown: true });
        await call("luna://com.webos.service.systemservice/setPreferences", { keyboardButton: true, keyboardButtonSide: "top", keyboardButtonY: 7 });
        expect(last("systemStatus")?.tweaks).toMatchObject({ keyboardButton: true, keyboardButtonSide: "right", keyboardButtonY: 1 });
    });
});

describe("the power menu", () => {
    it("airplaneMode as a preference turns the radios off and back", async () => {
        await call("luna://com.webos.service.systemservice/setPreferences", { airplaneMode: true });
        expect(last("systemStatus")?.airplaneMode).toBe(true);
        expect(last("systemStatus")?.wifiEnabled).toBe(false);
        await call("luna://com.webos.service.systemservice/setPreferences", { airplaneMode: false });
        expect(last("systemStatus")?.airplaneMode).toBe(false);
        expect(last("systemStatus")?.wifiEnabled).toBe(true);
    });

    it("signals powerKeyPressed to the display's listeners", async () => {
        const got: Record<string, unknown>[] = [];
        const sub = subscribe("luna://com.palm.bus/signal/addmatch", { category: "/com/palm/display", method: "powerKeyPressed" },
                              (r) => got.push(r as Record<string, unknown>));
        await new Promise((r) => setTimeout(r, 5));
        rt().displaySignal("powerKeyPressed", { showDialog: true });
        expect(got.some((r) => r.showDialog === true)).toBe(true);
        sub.cancel();
    });

    it("answers Shut Down and Luna Restart", async () => {
        expect((await call("luna://com.palm.power/shutdown/machineOff" as never, { reason: "test" } as never) as { returnValue: boolean }).returnValue).toBe(true);
        expect((await call("luna://org.webosphoenix.system/restartUi" as never, {} as never) as { returnValue: boolean }).returnValue).toBe(true);
    });
});
