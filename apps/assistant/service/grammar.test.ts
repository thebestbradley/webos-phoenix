// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's command grammar (lib/grammar.js, lib/lang/en.js): each
// command in English, the times, durations and sums it reads, and commands
// apps declare in appinfo.json. Another language adds a block like the
// "English" one below with its own phrases.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Parsed = { command: string; args: Record<string, unknown> } | null;
const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as {
    parse(text: string, ctx?: object): Parsed;
    compileAppCommands(apps: object[], lang?: string): { key: string; phrases: string[]; title: string; risk: string }[];
    LANGUAGES: string[];
};
const arith = req("./lib/arith.js") as { evaluate(e: string): number; format(v: number): string };

// Wednesday 7 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();
const APPS = [
    { id: "org.webosphoenix.maps", title: "Maps",
      universalSearch: { action: { displayName: "Search Maps", url: "org.webosphoenix.maps", launchParam: "query" } } },
    { id: "org.webosphoenix.voicememos", title: "Voice Memos", keywords: ["recorder"] },
    { id: "com.palm.app.calculator", title: "Calculator" },
    { id: "org.webosphoenix.tasks", title: "Tasks",
      universalSearch: { action: { displayName: "New Task", url: "org.webosphoenix.tasks", launchParam: "text" } } },
    { id: "org.example.notes", title: "Notes",
      assistant: { commands: [{ id: "note", displayName: "New Note", url: "org.example.notes", launchParam: "text",
                                phrases: { en: ["take a note {text}", "note that {text}"] } },
                              { id: "wipe", displayName: "Delete Notes", url: "org.example.notes", launchParam: "text", risk: "delete",
                                phrases: { en: ["delete my notes about {text}"] } }] } },
];
const CTX = { lang: "en", now: NOW, apps: APPS, names: ["Sam", "Mary Spetzler", "Mary"], appCommands: grammar.compileAppCommands(APPS, "en") };
const parse = (t: string) => grammar.parse(t, CTX);

describe("English", () => {
    it("calls a contact or a number, with the line", () => {
        expect(parse("Call Mum")).toEqual({ command: "call", args: { who: "mum", label: "" } });
        expect(parse("call Sam on his mobile")).toEqual({ command: "call", args: { who: "sam", label: "mobile" } });
        expect(parse("phone Mary at work")).toEqual({ command: "call", args: { who: "mary", label: "work" } });
        expect(parse("dial 555 123 4567")).toEqual({ command: "call", args: { number: "5551234567", label: "" } });
        expect(parse("Hey Phoenix, could you please call Sam?")?.command).toBe("call");
    });

    it("texts a contact, splitting the name from the words", () => {
        expect(parse("text Sam I'm late")).toEqual({ command: "text", args: { who: "sam", message: "I'm late" } });
        expect(parse("text Mary Spetzler see you at 6")).toEqual({ command: "text", args: { who: "mary spetzler", message: "see you at 6" } });
        expect(parse("send a message to Sam saying on my way")).toEqual({ command: "text", args: { who: "sam", message: "on my way" } });
        expect(parse("tell Mary that dinner is ready")).toEqual({ command: "text", args: { who: "mary", message: "dinner is ready" } });
        expect(parse("text Sam")).toEqual({ command: "text", args: { who: "sam", message: "" } });
        expect(parse("tell me a joke")).toBeNull();
    });

    it("sets timers", () => {
        expect(parse("set a timer for 10 minutes")).toEqual({ command: "timer", args: { seconds: 600, label: "" } });
        expect(parse("timer for an hour and a half")).toEqual({ command: "timer", args: { seconds: 5400, label: "" } });
        expect(parse("start a twenty five minute timer")).toEqual({ command: "timer", args: { seconds: 1500, label: "" } });
        expect(parse("set a 3 minute timer for the eggs")).toEqual({ command: "timer", args: { seconds: 180, label: "eggs" } });
        expect(parse("set a timer for 90 seconds")?.args.seconds).toBe(90);
        expect(parse("timer for half an hour")?.args.seconds).toBe(1800);
        expect(parse("set a timer")).toBeNull();
    });

    it("sets alarms for the next time it comes", () => {
        expect(parse("wake me at 7")).toEqual({ command: "alarm", args: { time: at(8, 7), label: "" } });
        expect(parse("set an alarm for 6:30 pm")).toEqual({ command: "alarm", args: { time: at(7, 18, 30), label: "" } });
        expect(parse("set an alarm for 11")).toEqual({ command: "alarm", args: { time: at(7, 11), label: "" } });
        expect(parse("alarm at half past six tomorrow")?.args.time).toBe(at(8, 6, 30));
        expect(parse("wake me up at seven thirty")?.args.time).toBe(at(8, 7, 30));
        expect(parse("set an alarm for 7am called gym")?.args).toEqual({ time: at(8, 7), label: "gym" });
    });

    it("adds reminders, with a time when one is said", () => {
        expect(parse("remind me to call the dentist")).toEqual({ command: "reminder", args: { text: "call the dentist", due: null } });
        expect(parse("remind me to buy milk at 5")).toEqual({ command: "reminder", args: { text: "buy milk", due: at(7, 17) } });
        expect(parse("remind me to water the plants tomorrow")?.args).toEqual({ text: "water the plants", due: at(8, 9) });
        expect(parse("remind me to stretch in 20 minutes")?.args).toEqual({ text: "stretch", due: NOW + 20 * 60000 });
        expect(parse("remind me at 3 pm to pick up the kids")?.args).toEqual({ text: "pick up the kids", due: at(7, 15) });
        expect(parse("remind me to pay rent on friday at 9")?.args).toEqual({ text: "pay rent", due: at(9, 9) });
    });

    it("turns Wi-Fi, Bluetooth, airplane mode, the flashlight and the ringer on and off", () => {
        expect(parse("turn off Wi-Fi")).toEqual({ command: "toggle", args: { setting: "wifi", state: "off" } });
        expect(parse("turn the wifi on")).toEqual({ command: "toggle", args: { setting: "wifi", state: "on" } });
        expect(parse("enable bluetooth")).toEqual({ command: "toggle", args: { setting: "bluetooth", state: "on" } });
        expect(parse("switch on airplane mode")).toEqual({ command: "toggle", args: { setting: "airplane", state: "on" } });
        expect(parse("flight mode off")).toEqual({ command: "toggle", args: { setting: "airplane", state: "off" } });
        expect(parse("turn on the flashlight")).toEqual({ command: "toggle", args: { setting: "flashlight", state: "on" } });
        expect(parse("toggle the torch")).toEqual({ command: "toggle", args: { setting: "flashlight", state: "toggle" } });
        expect(parse("silence the phone")).toEqual({ command: "toggle", args: { setting: "ringer", state: "off" } });
        expect(parse("turn the ringer back on")).toBeNull();
        expect(parse("turn the ringer on")).toEqual({ command: "toggle", args: { setting: "ringer", state: "on" } });
    });

    it("opens installed apps by name or keyword, and only those", () => {
        expect(parse("open maps")).toEqual({ command: "open", args: { appId: "org.webosphoenix.maps", title: "Maps" } });
        expect(parse("launch the voice memos app")).toEqual({ command: "open", args: { appId: "org.webosphoenix.voicememos", title: "Voice Memos" } });
        expect(parse("open the recorder")?.args.appId).toBe("org.webosphoenix.voicememos");
        expect(parse("open calc")?.args.appId).toBe("com.palm.app.calculator");
        expect(parse("open the pod bay doors")).toBeNull();
    });

    it("navigates, plays music, searches", () => {
        expect(parse("navigate home")).toEqual({ command: "navigate", args: { destination: "home" } });
        expect(parse("directions to the Eiffel Tower")).toEqual({ command: "navigate", args: { destination: "eiffel tower" } });
        expect(parse("take me to 1 Main Street")).toEqual({ command: "navigate", args: { destination: "1 main street" } });
        expect(parse("play Daft Punk")).toEqual({ command: "play", args: { query: "daft punk" } });
        expect(parse("play some music by Miles Davis")).toEqual({ command: "play", args: { query: "miles davis" } });
        expect(parse("play music")).toEqual({ command: "play", args: { query: "" } });
        expect(parse("search the web for palm pre")).toEqual({ command: "search", args: { query: "palm pre" } });
        expect(parse("look up webos history")).toEqual({ command: "search", args: { query: "webos history" } });
    });

    it("asks about the weather, here or somewhere, today or tomorrow", () => {
        expect(parse("what's the weather")).toEqual({ command: "weather", args: { place: "", day: "" } });
        expect(parse("What's the weather like in Paris?")).toEqual({ command: "weather", args: { place: "paris", day: "" } });
        expect(parse("weather tomorrow")).toEqual({ command: "weather", args: { place: "", day: "tomorrow" } });
        expect(parse("what is the forecast for London tomorrow")).toEqual({ command: "weather", args: { place: "london", day: "tomorrow" } });
        expect(parse("will it rain tomorrow")).toEqual({ command: "weather", args: { place: "", day: "tomorrow", about: "rain" } });
        expect(parse("do I need an umbrella")?.command).toBe("weather");
    });

    it("works out sums and percentages", () => {
        const sum = (t: string) => {
            const p = parse(t);
            expect(p?.command).toBe("calculate");
            return arith.format(arith.evaluate(String(p!.args.expression)));
        };
        expect(sum("what's 15% of 80")).toBe("12");
        expect(sum("15 percent of 80")).toBe("12");
        expect(sum("twelve times seven")).toBe("84");
        expect(sum("10 divided by 4")).toBe("2.5");
        expect(sum("what is 2 to the power of 10")).toBe("1024");
        expect(sum("the square root of 81")).toBe("9");
        expect(sum("80 + 15%")).toBe("92");
        expect(sum("(3 + 4) * 2")).toBe("14");
        expect(sum("1,250 minus 50")).toBe("1200");
        expect(parse("what is 5")).toBeNull();
        expect(() => arith.evaluate("1 / 0")).toThrow(/zero/);
    });

    it("tells the time and the date", () => {
        expect(parse("what time is it")).toEqual({ command: "time", args: { what: "time" } });
        expect(parse("what's the date")).toEqual({ command: "time", args: { what: "date" } });
    });

    it("leaves free-form questions to the next layer", () => {
        for (const t of ["who wrote the odyssey", "explain quantum computing simply", "why is the sky blue", "hello"])
            expect(parse(t)).toBeNull();
    });
});

describe("commands apps declare", () => {
    it("compiles appinfo.json phrases, and Quick Actions as '<name> {text}'", () => {
        const c = CTX.appCommands;
        expect(c.map((x) => x.key)).toEqual(["org.webosphoenix.maps#quickAction", "org.webosphoenix.tasks#quickAction", "org.example.notes#note", "org.example.notes#wipe"]);
        expect(c.find((x) => x.key === "org.example.notes#wipe")?.risk).toBe("delete");
    });
    it("matches them with what follows as the text", () => {
        // A Quick Action comes after the built-in commands, which do the
        // thing rather than open the app on it.
        expect(parse("search maps coffee")).toEqual({ command: "app", args: { key: "org.webosphoenix.maps#quickAction", text: "coffee" } });
        expect(parse("new task buy milk")).toEqual({ command: "task", args: { text: "Buy milk", list: "", due: null } });
        expect(parse("Take a note the gate code is 1234")).toEqual({ command: "app", args: { key: "org.example.notes#note", text: "the gate code is 1234" } });
        expect(parse("note that milk is low")).toEqual({ command: "app", args: { key: "org.example.notes#note", text: "milk is low" } });
    });
    it("has phrases per language: none for a language the app did not write", () => {
        expect(grammar.compileAppCommands([{ id: "x", title: "X", assistant: { commands: [{ phrases: { de: ["notiz {text}"] } }] } }], "en")).toEqual([]);
        expect(grammar.LANGUAGES).toContain("en");
    });
});
