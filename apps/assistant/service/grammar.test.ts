// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's command grammar (lib/grammar.js, lib/lang/en.js): each
// command in English, the times, durations and sums it reads, and commands
// apps declare in appinfo.json. Another language adds a block like the
// "English" one below with its own phrases.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/examples";

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

    it("finds places and the way there: what is looked for, never the whole sentence", () => {
        // The owner's report: Maps' search field got the whole question.
        const q = (t: string) => parse(t)?.args.query;
        expect(q("find coffee shops near me")).toBe("coffee shops");
        expect(q("Can you find coffee shops near me?")).toBe("coffee shops");
        expect(q("find me a coffee shop nearby")).toBe("coffee shop");
        expect(q("what coffee shops are near me")).toBe("coffee shops");
        expect(q("where can I get coffee")).toBe("coffee");
        expect(q("I need a pharmacy")).toBe("pharmacy");
        expect(q("nearest coffee shop")).toBe("coffee shop");
        expect(q("coffee shops")).toBe("coffee shops");
        expect(q("where's the closest Starbucks")).toBe("starbucks");
        expect(parse("where's the nearest coffee shop")).toEqual({ command: "nearby", args: { query: "coffee shop" } });
        expect(parse("find a file called coffee")?.command).toBe("findFiles");
        expect(parse("play coffee")?.command).toBe("play");
        expect(parse("directions to the nearest coffee shop")).toEqual({ command: "navigate", args: { destination: "nearest coffee shop" } });
        expect(parse("get me directions to the closest gas station")).toEqual({ command: "navigate", args: { destination: "closest gas station" } });
        expect(parse("how do I get to Starbucks")).toEqual({ command: "navigate", args: { destination: "starbucks" } });
        expect(parse("walk to the nearest coffee shop")).toEqual({ command: "navigate", args: { destination: "nearest coffee shop", mode: "walk" } });
        expect(parse("how do I get to the park by bike")).toEqual({ command: "navigate", args: { destination: "park", mode: "bike" } });
        expect(parse("navigate to 1 Infinite Loop")).toEqual({ command: "navigate", args: { destination: "1 infinite loop" } });
        expect(parse("how long to drive to the airport")).toEqual({ command: "travelTime", args: { place: "airport", mode: "drive", traffic: false } });
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

describe("what the assistant suggests", () => {
    const en = (grammar as unknown as { language(l: string): { say: { suggestions(): string[]; suggest(t: string): string[] } } }).language("en");
    it("suggests only requests it understands as they stand", () => {
        const list = en.say.suggestions();
        expect(list.length).toBeGreaterThan(20);
        for (const e of list) {
            const p = parse(e);
            expect(p, e).not.toBeNull();
            expect(p!.command, e).not.toBe("beyond");
        }
    });
    it("shows, on an empty conversation, things to ask it understands, the same in the app and the shell", () => {
        const qml = readFileSync(resolve(__dirname, "../../../shell/qml/Phoenix/Shell/AssistantOverlay.qml"), "utf8");
        const block = /readonly property var examples: \[([\s\S]*?)\n {4}\]/.exec(qml)![1];
        const shell = [...block.matchAll(/qsTr\("([^"]+)"\)/g)].map((m) => m[1]);
        expect(shell).toEqual(EXAMPLES);
        for (const e of EXAMPLES) {
            const p = parse(e);
            expect(p, e).not.toBeNull();
            expect(p!.command, e).not.toBe("beyond");
        }
    });
    it("help: every example it offers is understood, as the command it shows", () => {
        const { HELP_GROUPS } = req("./lib/commands.js") as { HELP_GROUPS: { title: string; examples: string[] }[] };
        expect(HELP_GROUPS.length).toBeGreaterThan(8);
        for (const g of HELP_GROUPS) for (const e of g.examples) {
            const p = parse(e);
            expect(p, e).not.toBeNull();
            expect(p!.command, e).not.toBe("beyond");
            if (g.title === "Using Phoenix") expect(p!.command, e).toBe("help");
            else expect(p!.command, e).not.toBe("help");
        }
        // And what fits now (commands.js helpNow).
        for (const e of ["What's my next meeting?", "Read my new messages", "Who called me?", "Do I have any new emails?", "What's the weather today?",
                         "What's on my calendar today?", "What's on my calendar tomorrow?", "Set an alarm for 7am", "Am I free at 4?", "Remind me to call Mom at 6"])
            expect(parse(e)?.command, e).toMatch(/^(?:agenda|readMessages|callLog|searchEmail|weather|alarm|freeTime|reminder)$/);
    });
    it("how-tos: each from its Help topic, which has what it says", () => {
        const { HOWTO } = req("./lib/lang/en-help.js") as { HOWTO: { id: string; topic: string; source: string[] }[] };
        for (const h of HOWTO) {
            if (!h.topic) continue;
            const md = readFileSync(resolve(__dirname, `../../help/topics/${h.topic}.md`), "utf8").toLowerCase().replace(/\*\*/g, "").replace(/\s+/g, " ");
            for (const w of h.source) expect(md, `${h.id}: "${w}" in ${h.topic}.md`).toContain(w);
        }
        const asks: [string, string][] = [["help", ""], ["what can you do", ""], ["give me some suggestions", ""], ["tips", ""], ["how do I use you", ""],
            ["how do I close an app", "close"], ["how do i go back", "back"], ["how do I switch apps", "switch"], ["what is just type", "justtype"],
            ["how do I delete an app", "rearrange"], ["how do I take a screenshot", "screenshot"], ["how do I set a passcode", "passcode"],
            ["how do i open the launcher", "launcher"], ["how do I see my notifications", "notifications"], ["how do I unlock my phone", "unlock"]];
        for (const [t, topic] of asks) expect(parse(t), t).toEqual({ command: "help", args: { topic } });
        // Not every "how do I": the world's questions go on to a model or the web.
        expect(parse("how do I make banana pudding")).toBeNull();
    });
    it("tells a question about the world, small talk and a request apart (what a model gets tools for)", () => {
        expect(en.say.context("how do you make banana pudding")).toEqual({ question: true, smallTalk: false, app: "" });
        expect(en.say.context("tell me a joke")).toMatchObject({ question: false, smallTalk: true });
        expect(en.say.context("can you put the torch on for me")).toMatchObject({ question: false, smallTalk: false });
        expect(en.say.context("make a playlist of my songs")).toEqual({ question: false, smallTalk: false, app: "Music" });
        expect(en.say.related("how do you make banana pudding", "Slice bananas.")[0]).toMatchObject({ label: "Save as Memo", run: { command: "note", args: { text: "Banana pudding\n\nSlice bananas." } } });
        expect(en.say.related("where is the eiffel tower", "In Paris.")).toEqual([{ label: "Show in Maps", map: "eiffel tower" }]);
    });
    it("finds the commands close to words it did not understand", () => {
        expect(en.say.suggest("something about my dentist appointment")).toEqual(["add a meeting with Sam tomorrow at 3", "what's on my calendar tomorrow"]);
        expect(en.say.suggest("the song that goes la la")).toEqual(["play some music by Miles Davis", "next song"]);
        expect(en.say.suggest("who wrote the odyssey")).toEqual([]);
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
