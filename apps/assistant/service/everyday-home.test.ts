// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The home through Home Assistant (lib/commands-home.js, lib/lang/en-home.js),
// against a stand-in Home Assistant (test/home-assistant.cjs: its REST API on
// a small house): lights, switches, the thermostat, locks, the garage door
// and scenes, each change read back from Home Assistant; unlocking and
// opening read back first; "undo" for what can be put back; the words only
// once it is connected, the phone's own words left alone.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const HA = req("./test/home-assistant.cjs") as { create(): any; URL: string; TOKEN: string };

function house() {
    const kept: { v?: any } = {};
    HA.create().connect({ set: (_k: string, v: any) => { kept.v = v; } });
    return kept.v.entities;
}
const parse = (t: string, home = true) => grammar.parse(t, { lang: "en", now: NOW, ...(home ? { home: { entities: house() } } : {}) });
function connected(opts: object = {}) {
    const d = device(opts);
    d.connectHome();
    return d;
}

describe("the words", () => {
    it("wait for Home Assistant: without it, other devices are what nothing here controls", () => {
        expect(parse("turn off the lights", false)).toEqual({ command: "beyond", args: { what: "home" } });
        expect(parse("lock the front door", false)).toEqual({ command: "beyond", args: { what: "home" } });
        expect(parse("activate movie night", false)).toBeNull();
    });
    it("name a device, a kind of device or a scene, once it is connected", () => {
        expect(parse("turn off the lights in the kitchen")).toEqual({ command: "home", args: { action: "off", target: "lights in the kitchen" } });
        expect(parse("kitchen lights off")?.args).toEqual({ action: "off", target: "kitchen lights" });
        expect(parse("turn on the light")?.args).toEqual({ action: "on", target: "light" });
        expect(parse("dim the living room lamp to 30%")?.args).toEqual({ action: "set", target: "living room lamp", value: 30 });
        expect(parse("set the thermostat to 70 degrees")?.args).toEqual({ action: "set", target: "thermostat", value: 70 });
        expect(parse("turn up the heat")?.args).toEqual({ action: "up", target: "heat" });
        expect(parse("it's too hot in here")?.args).toEqual({ action: "down", target: "thermostat" });
        expect(parse("unlock the front door")?.args).toEqual({ action: "unlock", target: "front door" });
        expect(parse("close the garage door")?.args).toEqual({ action: "close", target: "garage door" });
        expect(parse("is the front door locked")?.args).toEqual({ action: "status", target: "front door" });
        expect(parse("what's the temperature inside")?.args).toEqual({ action: "status", target: "thermostat" });
        expect(parse("start the coffee maker")?.args).toEqual({ action: "on", target: "coffee maker" });
        expect(parse("activate movie night")).toEqual({ command: "homeScene", args: { name: "Movie Night" } });
        expect(parse("turn on the good morning scene")).toEqual({ command: "homeScene", args: { name: "good morning" } });
        expect(parse("preheat the oven")).toEqual({ command: "beyond", args: { what: "homeOther" } });
    });
    it("leave the phone's own alone", () => {
        expect(parse("turn on the flashlight")?.command).toBe("toggle");
        expect(parse("turn on wifi")?.command).toBe("toggle");
        expect(parse("turn off do not disturb")?.command).toBe("toggle");
        expect(parse("lock the screen")?.command).toBe("lock");
        expect(parse("turn off the alarm")?.command).toBe("alarmManage");
        expect(parse("set the volume to 50")?.command).toBe("volume");
        expect(parse("set the brightness to 50")?.command).toBe("brightness");
        expect(parse("what's the temperature")?.command).toBe("weather");
        expect(parse("stop the music")?.command).toBe("media");
    });
});

describe("lights, switches and the thermostat", () => {
    it("turns one off, read back from Home Assistant, and puts it back on undo", async () => {
        const d = connected();
        const m = await d.ask("turn off the kitchen light");
        expect(m).toMatchObject({ command: "home", status: "done", text: "Turned off the Kitchen Light." });
        expect(d.homeAssistant.find("light.kitchen").state).toBe("off");
        expect(d.homeAssistant.calls.at(-1)).toEqual({ domain: "light", service: "turn_off", data: { entity_id: "light.kitchen" } });
        const undo = await d.ask("undo that");
        await d.confirm(undo);
        expect(d.homeAssistant.find("light.kitchen")).toMatchObject({ state: "on", attributes: { brightness: 255 } });
    });
    it("turns every light on for \"the lights\", and sets brightness", async () => {
        const d = connected();
        expect((await d.ask("turn on the lights")).text).toBe("Turned on the Kitchen Light, the Living Room Lamp and the Bedroom Light.");
        expect(d.homeAssistant.find("light.living_room").state).toBe("on");
        expect((await d.ask("dim the living room lamp to 30%")).text).toBe("Set the Living Room Lamp to 30%.");
        expect(d.homeAssistant.find("light.living_room").attributes.brightness).toBe(77);
        expect((await d.ask("start the coffee maker")).text).toBe("Turned on the Coffee Maker.");
        expect(d.homeAssistant.find("switch.coffee_maker").state).toBe("on");
    });
    it("sets the thermostat, a step up or down, and says how warm it is", async () => {
        const d = connected();
        expect((await d.ask("set the thermostat to 70")).text).toBe("Set the Thermostat to 70°.");
        expect(d.homeAssistant.find("climate.thermostat").attributes.temperature).toBe(70);
        expect((await d.ask("turn up the heat")).text).toBe("Set the Thermostat to 72°.");
        expect((await d.ask("what's the temperature inside")).text).toBe("The Thermostat is heating, set to 72°; it's 66° inside.");
        expect((await d.ask("is the kitchen light on")).text).toBe("The Kitchen Light is on, at 100%.");
    });
    it("says what Home Assistant does not have, and when it doesn't say a change was made", async () => {
        const d = connected({ http: (url: string) => url.endsWith("/api/states/light.bedroom") ? { status: 200, body: JSON.stringify({ entity_id: "light.bedroom", state: "off", attributes: {} }) } : null });
        expect((await d.ask("turn on the tv")).text).toBe("I couldn't find “tv” in your Home Assistant.");
        const m = await d.ask("turn on the bedroom light");
        expect(m.text).toBe("I asked Home Assistant to turn on the Bedroom Light, but it doesn't say it did. Check it in Home Assistant.");
    });
});

describe("locks, the garage door and scenes", () => {
    it("reads back unlocking first, and locks at once", async () => {
        const d = connected();
        const m = await d.ask("unlock the front door");
        expect(m).toMatchObject({ command: "home", status: "pending", text: expect.stringContaining("Unlock the Front Door?") });
        expect(d.homeAssistant.find("lock.front_door").state).toBe("locked");
        expect((await d.confirm(m)).text).toBe("Unlocked the Front Door.");
        expect(d.homeAssistant.find("lock.front_door").state).toBe("unlocked");
        expect((await d.ask("is the front door locked")).text).toBe("The Front Door is unlocked.");
        expect((await d.ask("lock the front door")).text).toBe("Locked the Front Door.");
        expect(d.homeAssistant.find("lock.front_door").state).toBe("locked");
    });
    it("opens the garage door only when the read-back is accepted", async () => {
        const d = connected();
        const m = await d.ask("open the garage");
        expect(m).toMatchObject({ status: "pending", text: expect.stringContaining("Open the Garage Door?") });
        await d.confirm(m, false);
        expect(d.homeAssistant.find("cover.garage_door").state).toBe("closed");
        expect(d.homeAssistant.calls).toEqual([]);
    });
    it("waits for the unlock when asked over the lock screen", async () => {
        const d = connected();
        expect(await d.ask("unlock the front door", { locked: true })).toMatchObject({ status: "locked", text: "Unlock your phone first, and I'll do that." });
        expect((await d.ask("turn off the kitchen light", { locked: true })).status).toBe("locked");
        expect(d.homeAssistant.calls).toEqual([]);
    });
    it("turns on a scene by its name", async () => {
        const d = connected();
        expect((await d.ask("activate movie night")).text).toBe("Turned on the Movie Night scene.");
        expect(d.homeAssistant.calls).toEqual([{ domain: "scene", service: "turn_on", data: { entity_id: "scene.movie_night" } }]);
    });
});

describe("connecting", () => {
    it("checks the address and the token before keeping them, the token sealed", async () => {
        const d = device();
        expect((await d.svc.homeAssistant({}))).toMatchObject({ connected: false, url: "" });
        expect((await d.svc.setHomeAssistant({ url: "homeassistant", token: "x" })).errorText).toMatch(/isn't a web address/);
        expect((await d.svc.setHomeAssistant({ url: HA.URL, token: "wrong" })).errorText).toMatch(/didn't take the access token/);
        const r = await d.svc.setHomeAssistant({ url: HA.URL + "/", token: HA.TOKEN });
        expect(r).toMatchObject({ returnValue: true, url: HA.URL, connected: true, entities: 10 });
        const kept = d.storage.get("assistant:homeAssistant");
        expect(kept.tokenEnc).toEqual({ sealed: HA.TOKEN });
        expect(JSON.stringify(kept)).not.toContain("\"token\"");
        expect((await d.ask("turn off the kitchen light")).text).toBe("Turned off the Kitchen Light.");
        await d.svc.removeHomeAssistant({});
        expect((await d.ask("turn off the lights")).text).toMatch(/With Home Assistant, I can: connect it in Settings > Assistant > Smart Home/);
    });
    it("lets only Settings, the system UI and the Assistant connect it", async () => {
        const d = device({ deps: { caller: () => "com.example.app" } });
        expect((await d.svc.setHomeAssistant({ url: HA.URL, token: HA.TOKEN })).returnValue).toBe(false);
        expect(d.storage.get("assistant:homeAssistant")).toBeNull();
    });
    it("says when Home Assistant can't be reached or the token is no longer taken", async () => {
        const d = connected({ offline: true });
        expect((await d.ask("turn off the lights")).text).toMatch(/^I couldn't reach your Home Assistant/);
        const e = connected();
        e.storage.set("assistant:homeAssistant", { ...e.storage.get("assistant:homeAssistant"), tokenEnc: { sealed: "revoked" } });
        expect((await e.ask("turn off the lights")).text).toMatch(/^Home Assistant didn't take the access token/);
    });
});
