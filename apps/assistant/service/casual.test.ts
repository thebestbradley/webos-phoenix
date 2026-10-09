// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Casual words (lib/lang/en.js CASUAL, tried by lib/grammar.js when no rule
// took the words as said): talk, not dictation, reaches the commands
// directly, without a language model. The first group is the phrasings
// the grammar missed in the on-device model's measurement
// (docs/AI-AND-MCP.md, "Built in: Qwen3 0.6B"); then more of each kind;
// then words that must stay as they were (no command, or the one before).

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Parsed = { command: string; args: Record<string, any> } | null;
const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): Parsed; compileAppCommands(a: object[], l?: string): object[] };

// Wednesday 7 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();
const APPS = [
    { id: "com.palm.app.calendar", title: "Calendar" }, { id: "com.palm.app.camera", title: "Camera" },
    { id: "org.webosphoenix.settings", title: "Settings" }, { id: "com.palm.app.notes", title: "Memos" },
];
const CTX = { lang: "en", now: NOW, apps: APPS, names: ["Sam", "Mary", "Mom", "Alex"], appCommands: grammar.compileAppCommands(APPS, "en") };
const parse = (t: string) => grammar.parse(t, CTX);

describe("the phrasings the grammar missed", () => {
    it("takes each as its command", () => {
        const cases: [string, string, Record<string, unknown>][] = [
            ["it's pitch dark in here, I need some light", "toggle", { setting: "flashlight", state: "on" }],
            ["light me up, I can't see my keys", "toggle", { setting: "flashlight", state: "on" }],
            ["get the bluetooth going", "toggle", { setting: "bluetooth", state: "on" }],
            ["kill the wifi for now", "toggle", { setting: "wifi", state: "off" }],
            ["I don't want any calls for a while, go silent", "toggle", { setting: "ringer", state: "off" }],
            ["please set up a wake up call at 6 tomorrow morning", "alarm", { time: at(8, 6), label: "" }],
            ["I need to be up by 5:45", "alarm", { time: at(8, 5, 45), label: "" }],
            ["count down three minutes for the eggs", "timer", { seconds: 180, label: "eggs" }],
            ["don't let me forget to water the plants tonight at 8", "reminder", { text: "water the plants", due: at(7, 20) }],
            ["ping me about the rent on friday", "reminder", { text: "the rent", due: at(9, 9) }],
            ["pencil in a dentist visit next tuesday at 3", "event", { title: "Dentist visit", start: at(13, 15) }],
            ["drop Sam a line saying I'm on my way", "text", { who: "sam", message: "I'm on my way" }],
            ["let Mary know I'll be late via sms", "text", { who: "mary", message: "I'll be late" }],
            ["it's way too loud, quieter please", "volume", { action: "down" }],
            ["the screen is too bright, tone it down", "brightness", { action: "down" }],
            ["throw on some tunes", "play", { query: "" }],
            ["what's the forecast looking like for the weekend", "weather", { place: "", day: "this weekend" }],
            ["fire up the camera", "open", { appId: "com.palm.app.camera" }],
        ];
        for (const [said, command, args] of cases) {
            const r = parse(said);
            expect(r?.command, said).toBe(command);
            expect(r?.args, said).toMatchObject(args);
        }
    });
});

describe("casual words for every kind of command", () => {
    const cases: [string, string, Record<string, unknown>][] = [
        // Switches.
        ["fire up the bluetooth", "toggle", { setting: "bluetooth", state: "on" }],
        ["get the wifi back on", "toggle", { setting: "wifi", state: "on" }],
        ["cut the wifi", "toggle", { setting: "wifi", state: "off" }],
        ["shut off the hotspot", "toggle", { setting: "hotspot", state: "off" }],
        ["nix the location", "toggle", { setting: "location", state: "off" }],
        ["yo kill the wifi", "toggle", { setting: "wifi", state: "off" }],
        ["it's too dark, I need a light", "toggle", { setting: "flashlight", state: "on" }],
        ["I need some light", "toggle", { setting: "flashlight", state: "on" }],
        ["hold my calls", "toggle", { setting: "ringer", state: "off" }],
        ["put my phone on silent", "toggle", { setting: "ringer", state: "off" }],
        // Alarms.
        ["set up a wake-up call for 7", "alarm", { time: at(8, 7) }],
        ["wake-up call at 6:30", "alarm", { time: at(8, 6, 30) }],
        ["I have to be up at 7 tomorrow", "alarm", { time: at(8, 7) }],
        ["gotta get up at 6", "alarm", { time: at(8, 6) }],
        // Timers.
        ["let me know in 15 minutes", "timer", { seconds: 900 }],
        ["countdown 5 minutes for the pasta", "timer", { seconds: 300, label: "pasta" }],
        // Reminders.
        ["don't forget to call the bank tomorrow", "reminder", { text: "call the bank", due: at(8, 9) }],
        ["make sure I take my pills at 9pm", "reminder", { text: "take my pills", due: at(7, 21) }],
        ["I mustn't forget about the parcel on monday", "reminder", { text: "the parcel", due: at(12, 9) }],
        ["nudge me to stretch in an hour", "reminder", { text: "stretch", due: at(7, 11) }],
        ["bug me about the report tomorrow morning", "reminder", { text: "the report", due: at(8, 9) }],
        // Calendar.
        ["slot in coffee with Alex friday at 10", "event", { title: "Coffee with Alex", start: at(9, 10), invitees: ["alex"] }],
        ["squeeze in a haircut tomorrow at 4", "event", { title: "Haircut", start: at(8, 16) }],
        ["block out time for gym tomorrow at 7am", "event", { title: "Gym", start: at(8, 7) }],
        // Messages.
        ["shoot Alex a text saying running late", "text", { who: "alex", message: "running late" }],
        ["send Mom a message saying call me back", "text", { who: "mom", message: "call me back" }],
        ["let Sam know that I'm here", "text", { who: "sam", message: "I'm here" }],
        ["hit up Alex and say what's up", "text", { who: "alex", message: "what's up" }],
        // Volume and brightness.
        ["it's too quiet", "volume", { action: "up" }],
        ["I can't hear anything", "volume", { action: "up" }],
        ["crank it up", "volume", { action: "up" }],
        ["keep it down", "volume", { action: "down" }],
        ["the screen is way too dark", "brightness", { action: "up" }],
        ["dim the screen", "brightness", { action: "down" }],
        // Music.
        ["spin some jams", "play", { query: "" }],
        ["blast some Daft Punk", "play", { query: "daft punk" }],
        ["let me hear some jazz", "play", { query: "jazz" }],
        // Weather.
        ["what's the weather looking like", "weather", { place: "", day: "" }],
        ["how's the forecast for tomorrow", "weather", { day: "tomorrow" }],
        ["what's it going to be like today", "weather", { day: "today" }],
        // Apps.
        ["take me to settings", "settings", {}],
    ];
    for (const [said, command, args] of cases) {
        it(said, () => {
            const r = parse(said);
            expect(r?.command).toBe(command);
            expect(r?.args).toMatchObject(args);
        });
    }
});

describe("what casual words leave alone", () => {
    it("takes nothing that is not a request it knows", () => {
        for (const said of ["thanks for that", "let me know what you think", "drop it", "I have a headache", "tell me about palm",
                            "get the kids from school", "kill time", "drop me a line", "shoot me an email", "hmm, where was I"])
            expect(parse(said), said).toBeNull();
    });
    it("changes nothing the rules already took", () => {
        expect(parse("turn off the wifi")).toEqual({ command: "toggle", args: { setting: "wifi", state: "off" } });
        expect(parse("remind me to call Mom at 6")?.command).toBe("reminder");
        expect(parse("text Sam I'm late")).toEqual({ command: "text", args: { who: "sam", message: "I'm late" } });
        expect(parse("play some music")).toEqual({ command: "play", args: { query: "" } });
    });
});

describe("one event by its name", () => {
    // "I need the dentist appointment thing" was said again as "open
    // dentist appointment thing", which the agenda read as today's.
    it("is found, not the day read", () => {
        expect(parse("I need the dentist appointment thing")).toEqual({ command: "agenda", args: { range: "find", query: "dentist" } });
        expect(parse("pull up the meeting with Sam")).toEqual({ command: "agenda", args: { range: "find", query: "sam" } });
        expect(parse("show me the dentist appointment")).toEqual({ command: "agenda", args: { range: "find", query: "dentist" } });
        expect(parse("check the meeting with Sam")).toEqual({ command: "agenda", args: { range: "find", query: "sam" } });
        expect(parse("show me my appointments")?.args).toMatchObject({ range: "day" });
        expect(parse("show me my meeting tomorrow")?.args).toMatchObject({ range: "day", from: at(8, 0) });
    });
});
