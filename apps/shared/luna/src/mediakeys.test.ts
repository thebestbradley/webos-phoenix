// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The players' headset and media keys (mediakeys.ts): what each
// com.palm.keys event does, and the whole path from the shell's key through
// the runtime's com.palm.keys (runtime/phoenix-runtime.js) to a player, in
// the order luna-sysmgr's InputManager sends them (single_click, then
// double_click for a second press, InputManager.cpp:254-331).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaKeyCommands, runMediaCommand, watchMediaKeys, type HeadsetClicks, type MediaKeyTarget } from "./mediakeys";
import type { KeyEvent } from "./device";

const k = (key: string, state: KeyEvent["state"]): KeyEvent => ({ key, state });

describe("mediaKeyCommands", () => {
    it("plays or pauses on a single click of the headset button", () => {
        expect(mediaKeyCommands("headset", k("headset_button", "single_click"), true, {})).toEqual(["pause"]);
        expect(mediaKeyCommands("headset", k("headset_button", "single_click"), false, {})).toEqual(["play"]);
    });

    it("goes to the next track on a double click, undoing the single click before it", () => {
        const clicks: HeadsetClicks = {};
        // Playing: the first click pauses, the second puts it back and skips.
        expect(mediaKeyCommands("headset", k("headset_button", "single_click"), true, clicks)).toEqual(["pause"]);
        expect(mediaKeyCommands("headset", k("headset_button", "double_click"), false, clicks)).toEqual(["play", "next"]);
        // Paused, it stays paused on the next track.
        expect(mediaKeyCommands("headset", k("headset_button", "single_click"), false, clicks)).toEqual(["play"]);
        expect(mediaKeyCommands("headset", k("headset_button", "double_click"), true, clicks)).toEqual(["pause", "next"]);
    });

    it("ignores the button's down, up and hold (hold is the phone's)", () => {
        for (const s of ["down", "up", "hold"] as const)
            expect(mediaKeyCommands("headset", k("headset_button", s), true, {})).toEqual([]);
    });

    it("pauses when the headset comes out, with or without its microphone", () => {
        expect(mediaKeyCommands("headset", k("headset", "up"), true, {})).toEqual(["unplugged"]);
        expect(mediaKeyCommands("headset", k("headset-mic", "up"), true, {})).toEqual(["unplugged"]);
        expect(mediaKeyCommands("headset", k("headset-mic", "down"), false, {})).toEqual([]);
    });

    it("takes the media keys when they go down", () => {
        expect(mediaKeyCommands("media", k("togglePausePlay", "down"), true, {})).toEqual(["pause"]);
        expect(mediaKeyCommands("media", k("togglePausePlay", "down"), false, {})).toEqual(["play"]);
        expect(mediaKeyCommands("media", k("togglePausePlay", "up"), false, {})).toEqual([]);
        expect(mediaKeyCommands("media", k("play", "down"), false, {})).toEqual(["play"]);
        expect(mediaKeyCommands("media", k("pause", "down"), true, {})).toEqual(["pause"]);
        expect(mediaKeyCommands("media", k("stop", "down"), true, {})).toEqual(["pause"]);
        expect(mediaKeyCommands("media", k("next", "down"), true, {})).toEqual(["next"]);
        expect(mediaKeyCommands("media", k("prev", "down"), true, {})).toEqual(["prev"]);
        expect(mediaKeyCommands("media", k("repeat-all", "down"), true, {})).toEqual([]);
    });
});

class FakePlayer implements MediaKeyTarget {
    log: string[] = [];
    on = false;
    focus = true;
    active() { return this.focus; }
    playing() { return this.on; }
    play() { this.on = true; this.log.push("play"); }
    pause() { this.on = false; this.log.push("pause"); }
    next() { this.log.push("next"); }
    prev() { this.log.push("prev"); }
}

describe("runMediaCommand", () => {
    it("only the player with the audio focus takes the buttons; unplugging pauses any player", () => {
        const p = new FakePlayer();
        p.focus = false;
        runMediaCommand(p, "play");
        runMediaCommand(p, "next");
        expect(p.log).toEqual([]);
        p.on = true;
        runMediaCommand(p, "unplugged");
        expect(p.log).toEqual(["pause"]);
        runMediaCommand(p, "unplugged");
        expect(p.log).toEqual(["pause"]);
    });
});

// ---- Through the runtime's com.palm.keys --------------------------------------------

type Runtime = { devices: { hostEvent(ev: Record<string, unknown>): void } };
const shell = (ev: Record<string, unknown>) => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime.devices.hostEvent(ev);
const key = (category: string, k: string, state: string) => shell({ key: { category, key: k, state } });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("watchMediaKeys", () => {
    beforeAll(() => {
        const w = window as unknown as Record<string, unknown>;
        w.phoenixHost = { postToHost: () => undefined };
        const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
        new Function(src).call(window);
    });
    beforeEach(() => localStorage.clear());

    it("plays, pauses, skips and pauses on unplug from the keys InputManager sends", async () => {
        const p = new FakePlayer();
        const sub = watchMediaKeys(p);
        await tick();
        // A single click: down, up, single_click (headsetStateMachine).
        key("/headset", "headset_button", "down");
        key("/headset", "headset_button", "up");
        key("/headset", "headset_button", "single_click");
        await tick();
        expect(p.log).toEqual(["play"]);
        // A double click while playing: the first click pauses, the second skips and plays on.
        for (const s of ["down", "up", "single_click", "down", "up", "double_click"]) key("/headset", "headset_button", s);
        await tick();
        expect(p.log).toEqual(["play", "pause", "play", "next"]);
        expect(p.on).toBe(true);
        // The media keys.
        key("/media", "togglePausePlay", "down");
        key("/media", "togglePausePlay", "up");
        await tick();
        expect(p.on).toBe(false);
        key("/media", "next", "down");
        key("/media", "prev", "down");
        key("/media", "play", "down");
        await tick();
        expect(p.log.slice(4)).toEqual(["pause", "next", "prev", "play"]);
        // The headset out.
        key("/headset", "headset-mic", "up");
        await tick();
        expect(p.on).toBe(false);
        expect(p.log[p.log.length - 1]).toBe("pause");
        sub.cancel();
        key("/media", "play", "down");
        await tick();
        expect(p.on).toBe(false);
    });
});
