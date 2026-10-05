// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// LunaSysMgr's device services in runtime/phoenix-runtime.js
// (com.palm.display, com.palm.keys, com.palm.vibrate,
// com.palm.ambientLightSensor), against luna-sysmgr's replies, with the
// shell played by the test: its events come in through
// __phoenixRuntime.devices.hostEvent, its requests go out as host messages.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, LunaError, subscribe } from "./bridge";
import { display, keys, lightSensor, vibrator, type DisplayStatus, type KeyEvent, type LightReading } from "./device";

type HostEvent = Record<string, unknown>;
type Runtime = { devices: { hostEvent(ev: HostEvent): void } };
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
const shell = (ev: HostEvent) => rt().devices.hostEvent(ev);

const host: { type: string; payload: Record<string, unknown> }[] = [];
const sent = (type: string) => host.filter((m) => m.type === type).map((m) => m.payload);
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

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

describe("com.palm.display", () => {
    it("reports the shell's display: less on the public bus (controlStatus)", async () => {
        shell({ display: { state: "on", timeout: 90, blockDisplay: false, active: true } });
        expect(await call("luna://com.palm.display/status", {})).toEqual(
            { returnValue: true, event: "request", state: "on", subscribed: false });
        expect(await call("luna://com.palm.display/control/status", {})).toEqual(
            { returnValue: true, event: "request", state: "on", timeout: 90, blockDisplay: "false", active: true, subscribed: false });
        shell({ display: { state: "dim" } });
        expect((await display.status()).state).toBe("dimmed");
    });

    it("tells subscribers what changes, the public ones only the display's own events", async () => {
        shell({ display: { state: "on", timeout: 60, blockDisplay: false, active: true } });
        const priv: DisplayStatus[] = [], pub: Record<string, unknown>[] = [];
        const a = display.watch((s) => priv.push(s));
        const b = subscribe("luna://com.palm.display/status", {}, (r) => pub.push(r));
        await tick();
        shell({ display: { state: "dim" } });
        shell({ display: { state: "off", active: false } });
        shell({ display: { state: "on", timeout: 120, blockDisplay: true, active: true } });
        shell({ display: { state: "on", dockMode: true } });
        a.cancel();
        b.cancel();
        shell({ display: { state: "off" } });
        expect(priv.map((s) => s.event)).toEqual(["request", "displayDimmed", "displayOff", "displayInactive", "displayOn",
            "changedTimeout", "blockedDisplay", "displayActive", "displayOn"]);
        expect(priv.find((s) => s.event === "changedTimeout")?.timeout).toBe(120);
        expect(priv.at(-1)).toMatchObject({ event: "displayOn", dockMode: true });
        expect(pub.map((s) => s.event)).toEqual(["request", "displayDimmed", "displayOff", "displayOn", "displayOn"]);
    });

    it("asks the shell to change the display, and refuses a state it does not know", async () => {
        await display.setState("off");
        await display.setState("unlock");
        expect(sent("displayState")).toEqual([{ state: "off" }, { state: "unlock" }]);
        const e = await call("luna://com.palm.display/control/setState", { state: "bright" }).catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorText).toBe("call failed");
    });

    it("holds the display on until the call is cancelled (requestBlock), with a client", async () => {
        const e = await call("luna://com.palm.display/control/setProperty", { requestBlock: true }).catch((x) => x);
        expect(e.errorCode).toBe(22);
        expect(e.errorText).toBe("'requestBlock' needs 'client' string");
        const hold = display.keepOn("com.palm.app.clock");
        await tick();
        expect(sent("displayHolds").at(-1)).toMatchObject({ requestBlock: 1, clients: ["com.palm.app.clock"] });
        // The shell adds every page's up and says so; getProperty reads it.
        shell({ holds: { requestBlock: 1 }, display: { state: "on", blockDisplay: true } });
        expect(await display.getProperties(["requestBlock", "proximityEnabled"])).toMatchObject({ requestBlock: true, proximityEnabled: false });
        hold.cancel();
        expect(sent("displayHolds").at(-1)).toMatchObject({ requestBlock: 0, clients: [] });
    });

    it("keeps the Power key to itself while blocked", async () => {
        const presses: number[] = [];
        const block = display.blockPowerKey("com.palm.app.phone", () => presses.push(1));
        await tick();
        expect(sent("displayHolds").at(-1)).toMatchObject({ powerKeyBlock: 1 });
        shell({ holds: { powerKeyBlock: 1 } });
        expect(await display.getProperties(["powerKeyBlock"])).toMatchObject({ powerKeyBlock: true });
        shell({ powerKey: "released" });
        block.cancel();
        shell({ powerKey: "released" });
        expect(presses).toEqual([1]);
        expect(sent("displayHolds").at(-1)).toMatchObject({ powerKeyBlock: 0 });
    });

    it("gets and sets the timeout, brightness and onWhenConnected as the system's preferences", async () => {
        await display.setProperties({ timeout: 30, maximumBrightness: 140, onWhenConnected: true });
        await tick();
        expect((await call("luna://com.palm.systemservice/getPreferences", { keys: ["screenTimeout"] }) as { screenTimeout?: number }).screenTimeout).toBe(30);
        const status = sent("systemStatus").at(-1);
        expect(status).toMatchObject({ screenTimeout: 30, brightness: 100, displayOnWhenConnected: true });
        expect(await display.getProperties(["maximumBrightness", "onWhenConnected"])).toMatchObject({ maximumBrightness: 100, onWhenConnected: true });
        // DisplayManager::setTimeout: 0 or less is the default, 120 s.
        await display.setProperties({ timeout: 0 });
        await tick();
        expect(sent("systemStatus").at(-1)).toMatchObject({ screenTimeout: 120 });
        const e = await call("luna://com.palm.display/control/getProperty", { properties: ["colour"] }).catch((x) => x);
        expect(e.errorCode).toBe(1);
        expect(e.errorText).toBe("failed to get property");
    });
});

describe("com.palm.keys", () => {
    it("takes only subscriptions for audio, media and headset (processSubscription)", async () => {
        const r = await call("luna://com.palm.keys/audio/status", {}).catch((x) => x);
        expect(r).toBeInstanceOf(LunaError);
        expect(r.errorCode).toBe(-1);
        expect(r.errorText).toBe("We were expecting a subscribe type message, but we did not recieve one.");
    });

    it("posts each category's keys to its subscribers", async () => {
        const audio: KeyEvent[] = [], media: KeyEvent[] = [], headset: KeyEvent[] = [];
        const subs = [keys.watch("audio", (k) => audio.push(k)), keys.watch("media", (k) => media.push(k)),
                      keys.watch("headset", (k) => headset.push(k))];
        await tick();
        shell({ key: { category: "/audio", key: "volume_up", state: "down" } });
        shell({ key: { category: "/audio", key: "volume_up", state: "up" } });
        shell({ key: { category: "/media", key: "togglePausePlay", state: "down" } });
        shell({ key: { category: "/headset", key: "headset_button", state: "single_click" } });
        shell({ key: { category: "/headset", key: "headset", state: "down" } });
        subs.forEach((s) => s.cancel());
        shell({ key: { category: "/audio", key: "volume_down", state: "down" } });
        expect(audio).toEqual([{ key: "volume_up", state: "down" }, { key: "volume_up", state: "up" }]);
        expect(media).toEqual([{ key: "togglePausePlay", state: "down" }]);
        expect(headset.map((k) => k.state)).toEqual(["single_click", "down"]);
        // The headset is in: its state reads "down".
        expect(await keys.get("headset")).toBe("down");
    });

    it("answers a switch's state, and follows the ringer switch", async () => {
        expect(await call("luna://com.palm.keys/switches/status", { get: "ringer" })).toEqual({ key: "ringer", state: "up", returnValue: true });
        expect(await keys.get("slider")).toBe("down");
        expect(await keys.get("mystery")).toBe("unknown");
        const seen: KeyEvent[] = [];
        const sub = keys.watch("switches", (k) => seen.push(k));
        await tick();
        shell({ key: { category: "/switches", key: "ringer", state: "down" } });
        sub.cancel();
        expect(seen).toEqual([{ key: "ringer", state: "down" }]);
        expect(await keys.get("ringer")).toBe("down");
        // The Clock asks audiod whether the ringer is on.
        expect(await call("palm://com.palm.audio/system/status", {})).toMatchObject({ "ringer switch": false });
    });
});

describe("com.palm.vibrate", () => {
    it("vibrates for a duration, or until cancelled", async () => {
        await call("luna://com.palm.vibrate/vibrate", { period: 200, duration: 600 });
        const endless = vibrator.vibrate(250);
        await tick();
        endless.cancel();
        const v = sent("vibrate");
        expect(v[0]).toMatchObject({ on: true, period: 200, duration: 600 });
        expect(v[1]).toMatchObject({ on: true, period: 250, duration: 0 });
        expect(v[2]).toEqual({ id: v[1].id, on: false });
        expect(v).toHaveLength(3);
        const e = await call("luna://com.palm.vibrate/vibrate", { duration: 100 }).catch((x) => x);
        expect(e.errorText).toBe("Invalid arguments");
    });

    it("plays the named effects the Castle knew, and no others", async () => {
        await vibrator.effect("notification");
        expect(sent("vibrate").at(-1)).toMatchObject({ on: true, name: "notification", continous: false });
        const e = await vibrator.effect("purr" as never).catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorText).toBe("Unable to vibrate");
        const ring = subscribe("luna://com.palm.vibrate/vibrateNamedEffect", { name: "ringtone", continous: true }, () => undefined);
        await tick();
        ring.cancel();
        expect(sent("vibrate").at(-1)).toMatchObject({ on: false });
    });
});

describe("com.palm.ambientLightSensor", () => {
    it("gives the reading, then every reading with its region", async () => {
        shell({ light: { current: 300, region: 3 } });
        const seen: LightReading[] = [];
        const sub = lightSensor.watch((r) => seen.push(r));
        await tick();
        shell({ light: { current: 4, region: 1 } });
        shell({ light: { current: 20000, region: 4 } });
        sub.cancel();
        expect(seen[0]).toMatchObject({ current: 300, average: 300, disabled: false, subscribed: true });
        expect(seen.slice(1)).toEqual([{ returnValue: true, current: 4, region: 1 }, { returnValue: true, current: 20000, region: 4 }]);
        expect(await lightSensor.read()).toMatchObject({ current: 20000, subscribed: false });
    });

    it("holds the sensor off while a disableALS subscription lasts", async () => {
        const sub = subscribe("luna://com.palm.ambientLightSensor/control/status", { disableALS: true }, () => undefined);
        await tick();
        expect(sent("displayHolds").at(-1)).toMatchObject({ alsDisabled: 1 });
        expect(await lightSensor.read()).toMatchObject({ disabled: true });
        sub.cancel();
        expect(sent("displayHolds").at(-1)).toMatchObject({ alsDisabled: 0 });
    });
});
