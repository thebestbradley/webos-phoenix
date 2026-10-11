// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings by voice (lib/commands-settings.js, lib/lang/en-settings.js):
// Settings' switches the toggle command does not have, each set in the
// system preference Settings reads (an object one keeping its other
// fields), read back, and taken back by "undo"; previews on the lock screen
// read back first; the screen timeout to Settings' nearest choice; and no
// dark mode, said so.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });

describe("the words", () => {
    it("names each setting, on, off or asked", () => {
        expect(parse("turn off keyboard clicks")).toEqual({ command: "deviceSetting", args: { setting: "keyboardClicks", state: "off" } });
        expect(parse("hide previews on the lock screen")?.args).toEqual({ setting: "previews", state: "off" });
        expect(parse("turn off the notification light")?.args).toEqual({ setting: "blink", state: "off" });
        expect(parse("turn off animations")?.args).toEqual({ setting: "reduceMotion", state: "on" });
        expect(parse("stop listening for hey phoenix")?.args).toEqual({ setting: "wakeWord", state: "off" });
        expect(parse("is dropshare on")?.args).toEqual({ setting: "dropShare", state: "status" });
        expect(parse("set the screen timeout to 2 minutes")?.args).toEqual({ setting: "screenTimeout", state: "set", seconds: 120 });
        expect(parse("turn on dark mode")?.args).toEqual({ setting: "darkMode", state: "on" });
    });
    it("leaves the toggle command's and the lights alone", () => {
        expect(parse("turn on wifi")?.command).toBe("toggle");
        expect(parse("turn on the flashlight")?.command).toBe("toggle");
        expect(parse("turn on the light")?.command).not.toBe("deviceSetting");
    });
});

describe("the switches", () => {
    it("sets a preference where Settings reads it, keeping an object preference's other fields, and takes it back", async () => {
        const d = device();
        d.state.prefs.x_palm_virtualkeyboard_prefs = { TapSounds: true, Layout: "qwerty" };
        const m = await d.ask("turn off keyboard clicks");
        expect(m).toMatchObject({ command: "deviceSetting", status: "done", text: "Keyboard clicks are off." });
        expect(d.state.prefs.x_palm_virtualkeyboard_prefs).toEqual({ TapSounds: false, Layout: "qwerty" });
        expect((await d.ask("turn off keyboard clicks")).text).toBe("Keyboard clicks are already off.");
        const undo = await d.ask("undo that");
        await d.confirm(undo);
        expect(d.state.prefs.x_palm_virtualkeyboard_prefs).toEqual({ TapSounds: true, Layout: "qwerty" });
    });
    it("turns accessibility's on, and says how it is", async () => {
        const d = device();
        expect((await d.ask("turn on high contrast")).text).toBe("High contrast is on.");
        expect(d.state.prefs.accessibility).toEqual({ highContrast: true });
        expect((await d.ask("turn off animations")).text).toBe("Reduce motion is on.");
        expect(d.state.prefs.accessibility).toEqual({ highContrast: true, reduceMotion: true });
        expect((await d.ask("is high contrast on")).text).toBe("Yes, high contrast is on.");
    });
    it("reads back showing previews on the lock screen; hiding them is at once", async () => {
        const d = device();
        d.state.prefs.lockScreenPreviews = false;
        const m = await d.ask("show previews on the lock screen");
        expect(m).toMatchObject({ status: "pending", text: expect.stringMatching(/^Show what your messages say on the lock screen, to anyone holding the phone\?/) });
        expect(d.state.prefs.lockScreenPreviews).toBe(false);
        expect((await d.confirm(m)).text).toBe("Previews on the lock screen are on.");
        expect(d.state.prefs.lockScreenPreviews).toBe(true);
        expect((await d.ask("hide previews on the lock screen")).text).toBe("Previews on the lock screen are off.");
    });
    it("turns the Assistant's own off: Hey Phoenix", async () => {
        const d = device({ settings: { followUps: false, wakeWord: true } });
        expect((await d.ask("stop listening for hey phoenix")).text).toBe("Listening for “Hey Phoenix” is off.");
        expect((await d.svc.getSettings({})).settings.wakeWord).toBe(false);
    });
    it("sets the screen timeout to Settings' nearest choice", async () => {
        const d = device();
        expect((await d.ask("set the screen timeout to 2 minutes")).text).toBe("The screen turns off after 2 minutes now.");
        expect(d.state.prefs.screenTimeout).toBe(120);
        expect((await d.ask("keep the screen on for 10 minutes")).text).toBe("The screen turns off after 5 minutes now. (That's the nearest Settings has.)");
    });
    it("says there is no dark mode, and offers high contrast", async () => {
        const d = device();
        const m = await d.ask("turn on dark mode");
        expect(m.text).toBe("Phoenix doesn't have a dark mode yet: webOS's look has none, and the 2.0 design brings light and dark. Should I turn on high contrast instead, for darker text?");
        expect((await d.ask("yes")).text).toBe("High contrast is on.");
    });
});
