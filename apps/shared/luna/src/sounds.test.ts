// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System sounds in runtime/phoenix-runtime.js: what the apps hand the shell
// (banner sounds, playSoundNotification, popup alerts' sound attributes),
// the simulated audiod (playSound, controlPlayback, playFeedback), the
// ringtone list and the sound preferences the shell follows.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { audio, keyboardPrefs, system, withTapSounds } from "./services";

const REPO = resolve(__dirname, "../../../..");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
const opened: { url: string; name: string; features: string }[] = [];

interface FakeAudio {
    url: string; loop: boolean; volume: number; playing: boolean;
    listeners: Record<string, (() => void)[]>;
    addEventListener(type: string, fn: () => void): void;
    play(): Promise<void>; pause(): void;
    fire(type: string): void;
}
const audios: FakeAudio[] = [];

interface Sounds {
    log: { playbackId: string; fileName: string; sink: string; loop: boolean; duration: number; volume: number }[];
    active: Record<string, unknown>;
    createAudio: (url: string) => FakeAudio;
}
type W = Record<string, unknown> & {
    __phoenixRuntime: { sounds: Sounds; hostStatus(): Record<string, unknown> };
    PalmSystem: {
        appIdentifier: string;
        addBannerMessage(...a: unknown[]): string;
        playSoundNotification(...a: unknown[]): void;
        getResource(p: string): string | undefined;
    };
};
const w = () => window as unknown as W;

beforeAll(() => {
    const win = window as unknown as Record<string, unknown>;
    win.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    // The runtime wraps window.open (browsers do not pass window features on).
    win.open = (url: string, name: string, features: string) => { opened.push({ url, name, features }); return null; };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const files: Record<string, string> = {
        "/media/internal/samples/index.json": readFileSync(resolve(REPO, "apps/media-samples/media/index.json"), "utf8"),
    };
    w().PalmSystem.getResource = (p: string) => files[p];
    w().__phoenixRuntime.sounds.createAudio = (url: string) => {
        const a: FakeAudio = {
            url, loop: false, volume: 1, playing: false, listeners: {},
            addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
            play() { this.playing = true; return Promise.resolve(); },
            pause() { this.playing = false; },
            fire(type) { (this.listeners[type] || []).forEach((fn) => fn()); },
        };
        audios.push(a);
        return a;
    };
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
    opened.length = 0;
    audios.length = 0;
    w().__phoenixRuntime.sounds.log.length = 0;
});

afterEach(() => { vi.useRealTimers(); });

const flush = () => new Promise((r) => setTimeout(r, 0));
const sounds = () => w().__phoenixRuntime.sounds;

describe("what apps hand the shell", () => {
    it("a banner carries its sound class, file and duration", () => {
        w().PalmSystem.addBannerMessage("Charging Battery", "{}", "/usr/lib/luna/system/luna-systemui/images/notification-small-charging.png",
                                        "notifications", "/usr/palm/sounds/charging.mp3");
        const m = hostMessages.find((x) => x.type === "banner")!;
        expect(m.payload).toMatchObject({ message: "Charging Battery", soundClass: "notifications",
                                          soundFile: "/usr/palm/sounds/charging.mp3", duration: 0 });
    });

    it("a banner without a sound says so", () => {
        w().PalmSystem.addBannerMessage("Syncing accounts", "{}");
        expect(hostMessages.find((x) => x.type === "banner")!.payload).toMatchObject({ soundClass: "", soundFile: "" });
    });

    it("playSoundNotification asks the shell for a sound (Email's new-mail sound)", () => {
        w().PalmSystem.playSoundNotification("alerts", "/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3", 3000);
        expect(hostMessages).toContainEqual({ type: "sound", payload: expect.objectContaining({
            soundClass: "alerts", soundFile: "/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3", duration: 3000 }) });
        w().PalmSystem.playSoundNotification("vibrate");
        expect(hostMessages[hostMessages.length - 1].payload).toMatchObject({ soundClass: "vibrate", soundFile: "" });
    });

    it("a popup alert's sound attributes reach the shell in its URL", () => {
        window.open("app/PowerdAlerts/powerdalerts.html", "LowBatteryAlert",
                    'height=150, attributes={"window":"popupalert","sound":"/usr/palm/sounds/battery_low.mp3","soundclass":"alerts"}');
        const url = opened[0].url;
        expect(url).toContain("phoenixWindow=popupalert");
        expect(url).toContain("phoenixSound=" + encodeURIComponent("/usr/palm/sounds/battery_low.mp3"));
        expect(url).toContain("phoenixSoundClass=alerts");
    });

    it("a popup alert without sound attributes has none in its URL", () => {
        window.open("index.html?alert=incoming", "incoming-known", 'height=150, attributes={"window":"popupalert"}');
        expect(opened[0].url).not.toContain("phoenixSound");
    });
});

describe("the simulated audiod", () => {
    it("plays a file on a stream at the stream's volume, and stops it", async () => {
        const id = await audio.playSound("/usr/palm/sounds/alert.wav", "palerts");
        await flush();
        expect(audios).toHaveLength(1);
        expect(audios[0].url).toBe("/usr/palm/sounds/alert.wav");
        expect(audios[0].playing).toBe(true);
        // Master 60 %, alerts 70 % (the simulator's defaults).
        expect(audios[0].volume).toBeCloseTo(0.42, 5);
        expect(sounds().log[0]).toMatchObject({ playbackId: id, fileName: "/usr/palm/sounds/alert.wav", sink: "palerts", loop: false });
        await audio.stopSound(id);
        expect(audios[0].playing).toBe(false);
        expect(sounds().active[id]).toBeUndefined();
        await expect(audio.stopSound(id)).rejects.toThrow();
    });

    it("takes the shell's loop, volume and duration", async () => {
        vi.useFakeTimers();
        sounds().log.length = 0;
        const res: string[] = [];
        (w().__phoenixRuntime as unknown as { dispatch: (u: string, p: object, r: (x: { playbackId: string }) => void, c: object) => void })
            .dispatch("luna://com.webos.service.audio/playSound", { fileName: "/usr/palm/sounds/phone.wav", sink: "pringtones",
                                                                    loop: true, volume: 0.5, duration: 5000 },
                      (r) => res.push(r.playbackId), { cancelled: () => false });
        await vi.advanceTimersByTimeAsync(0);
        expect(audios[0]).toMatchObject({ loop: true, volume: 0.5, playing: true });
        await vi.advanceTimersByTimeAsync(5000);
        expect(audios[0].playing).toBe(false);
        expect(sounds().active[res[0]]).toBeUndefined();
    });

    it("plays the fallback when the file cannot be played (SoundPlayer::healthCheck)", async () => {
        (w().__phoenixRuntime as unknown as { dispatch: (u: string, p: object, r: () => void, c: object) => void })
            .dispatch("luna://com.webos.service.audio/playSound", { fileName: "/media/internal/ringtones/gone.mp3", sink: "pringtones",
                                                                    fallback: "/usr/palm/sounds/notification.wav" },
                      () => {}, { cancelled: () => false });
        await flush();
        audios[0].fire("error");
        await flush();
        expect(audios.map((a) => a.url)).toEqual(["/media/internal/ringtones/gone.mp3", "/usr/palm/sounds/notification.wav"]);
        expect(audios[1].playing).toBe(true);
    });

    it("is silent while muted", async () => {
        await audio.setMuted(true);
        await audio.playSound("/usr/palm/sounds/alert.wav", "palerts");
        await flush();
        expect(audios).toHaveLength(0);
        expect(sounds().log[0].volume).toBe(0);
    });

    it("plays feedback sounds by name unless System Sounds is off", async () => {
        await audio.playFeedback("key");
        expect(sounds().log.map((e) => [e.fileName, e.sink])).toEqual([["/usr/share/phoenix/sounds/feedback/key.wav", "pfeedback"]]);
        // No such sound ships: nothing.
        await audio.playFeedback("carddrag");
        expect(sounds().log).toHaveLength(1);
        await system.setPreferences({ systemSounds: false });
        await audio.playFeedback("key");
        expect(sounds().log).toHaveLength(1);
    });
});

describe("ringtones and preferences", () => {
    it("lists the system ringtones, then the user's", async () => {
        const list = await system.ringtones();
        expect(list.slice(0, 2)).toEqual([
            { name: "Ringtone", fullPath: "/usr/palm/sounds/ringtone.mp3", system: true },
            { name: "Phone", fullPath: "/usr/palm/sounds/phone.wav", system: true },
        ]);
        // The user's: a demo song, and Phoenix's Flurry.mp3, the Clock's default alarm.
        expect(list.slice(2)).toEqual([{ name: "Arcade Ring", fullPath: "/media/internal/ringtones/Arcade Ring.ogg" },
                                       { name: "Flurry", fullPath: "/media/internal/ringtones/Flurry.mp3" }]);
    });

    it("defaults to Open webOS's tones", async () => {
        const p = await new Promise<Record<string, unknown>>((res) => {
            const sub = system.watchPreferences(["ringtone", "alerttone", "notificationtone", "systemSounds"], (v) => { sub.cancel(); res(v); });
        });
        expect(p).toMatchObject({
            ringtone: { fullPath: "/usr/palm/sounds/ringtone.mp3" },
            alerttone: { fullPath: "/usr/palm/sounds/alert.wav" },
            notificationtone: { fullPath: "/usr/palm/sounds/notification.wav" },
            systemSounds: true,
        });
    });

    it("tells the shell what its sounds follow", async () => {
        expect(w().__phoenixRuntime.hostStatus()).toMatchObject({
            muted: false, volume: 60, streams: { pringtones: 80, palerts: 70, pfeedback: 50 },
            systemSounds: true, tapSounds: true, ringtone: "/usr/palm/sounds/ringtone.mp3",
            alerttone: "/usr/palm/sounds/alert.wav", notificationtone: "/usr/palm/sounds/notification.wav",
        });
        await system.setPreferences({ ringtone: { name: "Phone", fullPath: "/usr/palm/sounds/phone.wav" } });
        expect([...hostMessages].reverse().find((m) => m.type === "systemStatus")!.payload).toMatchObject({ ringtone: "/usr/palm/sounds/phone.wav" });
        await system.setPreferences({ x_palm_virtualkeyboard_prefs: withTapSounds(undefined, false) });
        expect([...hostMessages].reverse().find((m) => m.type === "systemStatus")!.payload).toMatchObject({ tapSounds: false });
        await system.setPreferences({ systemSounds: false });
        expect(w().__phoenixRuntime.hostStatus()).toMatchObject({ systemSounds: false });
        await audio.setStreamVolume("pfeedback", 20);
        expect(w().__phoenixRuntime.hostStatus()).toMatchObject({ streams: { pfeedback: 20 } });
    });

    it("keeps the keyboard's other preferences when switching its clicks", () => {
        const stored = JSON.stringify({ keyboards: [{ layout: "QWERTY", language: "en" }], TapSounds: true, spaces2period: false });
        expect(JSON.parse(withTapSounds(stored, false))).toEqual({ keyboards: [{ layout: "QWERTY", language: "en" }], TapSounds: false, spaces2period: false });
        expect(keyboardPrefs(undefined)).toEqual({});
        expect(keyboardPrefs("not json")).toEqual({});
        expect(keyboardPrefs('{"TapSounds":false}').TapSounds).toBe(false);
    });
});
