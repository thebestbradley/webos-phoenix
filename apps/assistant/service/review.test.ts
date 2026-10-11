// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The review's six bugs (11 October 2026), what each now does beyond what
// the evaluation's cases (eval/cases-a.json) can see: the sleep timer's
// activity, an emergency call's countdown, a reminder for a place.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const emergency = req("./lib/emergency.js") as { NUMBERS: string[]; NATIONAL: Record<string, string[]>; isEmergency(n: string, c?: string): boolean; primary(c: string): string; countryOf(l: string): string };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a sleep timer", () => {
    it("pauses the music when it ends and rings nothing", async () => {
        const d = device();
        const m = await d.ask("set a sleep timer for 30 minutes");
        expect(m).toMatchObject({ command: "timer", status: "done" });
        expect(m.text).toBe("Sleep timer set: the music stops in 30 minutes.");
        const act = [...d.state.activities.values()].at(-1);
        expect(act.callback).toEqual({ method: "luna://org.webosphoenix.system/mediaKey", params: { key: "pause" } });
        expect(new Date(act.schedule.start.replace(/^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/, "$1-$2-$3T$4:$5:$6Z")).getTime()).toBeGreaterThan(0);
        // A plain timer still rings in the Assistant.
        await d.ask("set a timer for 5 minutes");
        expect([...d.state.activities.values()].at(-1).callback.params.params.timerDone).toBeTruthy();
        // "Cancel the sleep timer" finds it.
        expect((await d.ask("cancel the sleep timer")).text).toMatch(/cancel/i);
    });
});

// An emergency call placed: Phone's emergency window, opened by the shell over everything (lib/commands.js call).
const placed = (d: { called(part: string): { params: any }[] }) => d.called("org.webosphoenix.system/emergencyCall").map((c) => c.params);

describe("an emergency call", () => {
    it("is placed after a countdown, with no yes needed", async () => {
        const d = device({ deps: { countdownMs: 30 } });
        const m = await d.ask("call 911");
        expect(m).toMatchObject({ command: "call", status: "pending", confirm: { countdown: 5, args: { number: "911", emergency: true } } });
        expect(m.text).toBe("Calling 911 in 5 seconds. Cancel to stop.");
        expect(placed(d)).toEqual([]);
        await wait(80);
        expect(placed(d)).toEqual([{ number: "911", countdown: 0 }]);
        const all = (await d.svc.thread({})).messages;
        expect(all.at(-1)).toMatchObject({ role: "assistant", command: "call", status: "done" });
    });
    it("is not placed once cancelled, by the button or the words", async () => {
        const d = device({ deps: { countdownMs: 30 } });
        const m = await d.ask("call 911");
        await d.confirm(m, false);
        const e = device({ deps: { countdownMs: 30 } });
        await e.ask("call the police");
        expect((await e.ask("cancel")).status).toBe("cancelled");
        await wait(80);
        expect(placed(d)).toEqual([]);
        expect(placed(e)).toEqual([]);
    });
    it("is placed once, when Call Now is tapped as the countdown ends", async () => {
        const d = device({ deps: { countdownMs: 0 } });
        const m = await d.ask("call 112");
        await d.svc.confirm({ threadId: d.thread(), messageId: m.id, accept: true });
        await wait(30);
        expect(placed(d)).toHaveLength(1);
    });
    it("in talk mode, is not asked again for unclear words, nor dropped by \"I'm done\"", async () => {
        // Talk mode asks a read-back again for words that are not a yes or a
        // no, and drops it at "I'm done": never an emergency call's countdown.
        const d = device({ deps: { countdownMs: 60 } });
        await d.ask("call 911", { voice: true });
        const m = await d.ask("uh please hurry", { voice: true });
        expect(m.text).not.toMatch(/should I make the call/i);
        await d.ask("I'm done", { voice: true });
        await wait(150);
        expect(placed(d)).toEqual([{ number: "911", countdown: 0 }]);
        // "No" still stops it.
        const e = device({ deps: { countdownMs: 60 } });
        await e.ask("call 911", { voice: true });
        expect((await e.ask("no", { voice: true })).status).toBe("cancelled");
        await wait(150);
        expect(placed(e)).toEqual([]);
    });
    it("may be asked for over the lock screen; another call may not", async () => {
        const d = device({ deps: { countdownMs: 10000 } });
        expect(await d.ask("call 911", { locked: true })).toMatchObject({ command: "call", status: "pending" });
        expect(await d.ask("call mom", { locked: true })).toMatchObject({ command: "call", status: "locked" });
    });
    it("goes to the region's number for \"the police\", and a model's choice of one is read back", async () => {
        const d = device({ deps: { countdownMs: 10000, locale: () => "en-GB" } });
        expect((await d.ask("call an ambulance")).confirm).toMatchObject({ args: { number: "999" } });
        expect(emergency.countryOf("en-US")).toBe("us");
        expect(emergency.primary("au")).toBe("000");
        expect(emergency.isEmergency("911")).toBe(true);
        expect(emergency.isEmergency("5550911")).toBe(false);
        expect(emergency.isEmergency("111", "nz")).toBe(true);
    });
    it("knows the numbers the Phone's emergency dialer knows (apps/shared/luna/src/setup.ts)", () => {
        const ts = readFileSync(path.join(__dirname, "..", "..", "shared", "luna", "src", "setup.ts"), "utf8");
        const list = /EMERGENCY_NUMBERS: readonly string\[\] = (\[[^\]]*\])/.exec(ts)![1];
        expect(JSON.parse(list)).toEqual(emergency.NUMBERS);
        for (const [cc, nums] of Object.entries(emergency.NATIONAL))
            expect(ts).toContain(`${cc}: ${JSON.stringify(nums).replace(/,/g, ", ")}`);
    });
});

describe("a time a model wrote", () => {
    it("is the grammar's reading of the words where it reads one", async () => {
        // Qwen3 0.6B set "I want an alarm at 5:30 tomorrow morning" for 6:30 (the held-out set).
        const llm = { status: () => Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }] }), ensure: () => Promise.resolve({ baseUrl: "http://127.0.0.1:9/v1" }) };
        const reply = (o: object) => ({ status: 200, body: JSON.stringify({ choices: [{ message: o }] }) });
        const llmRequest = async (r: { body: string }) => {
            const b = JSON.parse(r.body);
            const props = b.response_format?.json_schema?.schema?.properties || {};
            if (props.command) return reply({ content: JSON.stringify({ command: "alarm" }) });
            if (props.time) return reply({ content: JSON.stringify({ time: "6:30 am tomorrow" }) });
            return reply({ content: "An answer." });
        };
        const d = device({ llm, llmRequest, settings: { followUps: false } });
        const m = await d.ask("an alarm at 5:30 tomorrow morning would be great");
        expect(m).toMatchObject({ command: "alarm" });
        expect(m.trace.path).toBe("on-device");
        const made = d.of("com.palm.clock.alarm:1").filter((a) => a.hour === 5);
        expect(made).toHaveLength(1);
        expect(made[0].minute).toBe(30);
    });
});

describe("a sleep timer a model chose", () => {
    it("is a plain timer where the words say nothing of the music", async () => {
        // Qwen3 0.6B made "add 5 minutes to the timer" a sleep timer (the main set).
        const llm = { status: () => Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }] }), ensure: () => Promise.resolve({ baseUrl: "http://127.0.0.1:9/v1" }) };
        const reply = (o: object) => ({ status: 200, body: JSON.stringify({ choices: [{ message: o }] }) });
        const llmRequest = async (r: { body: string }) => {
            const props = JSON.parse(r.body).response_format?.json_schema?.schema?.properties || {};
            if (props.command) return reply({ content: JSON.stringify({ command: "timer" }) });
            if (props.seconds) return reply({ content: JSON.stringify({ seconds: 300, sleep: true, label: "sleep" }) });
            return reply({ content: "An answer." });
        };
        const d = device({ llm, llmRequest, settings: { followUps: false } });
        const m = await d.ask("timer thingy five minutes ok");
        expect(m).toMatchObject({ command: "timer", status: "done" });
        expect(m.text).not.toMatch(/sleep|music/i);
        expect([...d.state.activities.values()].at(-1).callback.params.params.timerDone).toBeTruthy();
        // Where they do, it stays one.
        const e = device({ llm, llmRequest, settings: { followUps: false } });
        expect((await e.ask("timer thingy for the music five minutes ok")).text).toMatch(/^Sleep timer set/);
    });
});

describe("a command switched off in Settings > Assistant", () => {
    it("is refused, every one of them, \"did you add it?\" too", async () => {
        // "Did you add it?" was answered by the router itself, past the
        // switch (tools/test-assistant.cjs saw it; so did this, before).
        const PHRASES = req("./test/phrases.cjs") as Record<string, string>;
        const harness = req("../../../tools/eval-assistant.cjs") as { APPS: { id: string; title: string }[] };
        const notOff: string[] = [];
        for (const [id, text] of Object.entries(PHRASES)) {
            if (!text) continue;
            const d = device({ apps: harness.APPS, settings: { followUps: false, localModel: "off", disabledCommands: [id] } });
            // A routine of the user's ("good night"), and Home Assistant connected, for the words that need them.
            if (/^routine/.test(id)) await d.svc.setRoutine({ routine: { name: "Good night", steps: [{ text: "turn on do not disturb" }] } });
            if (/^home/.test(id)) d.connectHome();
            const m = await d.ask(text);
            if (!/is turned off in Settings > Assistant\.$/.test(m.text)) notOff.push(`${id}: ${m.text}`);
        }
        expect(notOff).toEqual([]);
    });
});

describe("a reminder for a place", () => {
    // The place is kept: a reminder at a place (lib/commands-places.js,
    // everyday-places.test.ts) once home is known, else it asks where home is
    // and makes nothing that drops it.
    it("keeps the place, and asks where home is before making anything", async () => {
        const d = device();
        const q = await d.ask("remind me to buy milk when I get home");
        expect(q).toMatchObject({ command: "placeReminder" });
        expect(q.text).toBe("I don't know where your home is yet. Should I use where you are now?");
        expect(d.of("com.palm.task:1").filter((t) => /buy milk/i.test(t.summary))).toEqual([]);
        void NOW;
    });
    it("words that are another request are that request", async () => {
        const d = device();
        await d.ask("remind me to call mom when I leave work");
        expect(await d.ask("what's the weather")).toMatchObject({ command: "weather" });
    });
});
