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

describe("an emergency call", () => {
    it("is placed after a countdown, with no yes needed", async () => {
        const d = device({ deps: { countdownMs: 30 } });
        const m = await d.ask("call 911");
        expect(m).toMatchObject({ command: "call", status: "pending", confirm: { countdown: 5, args: { number: "911", emergency: true } } });
        expect(m.text).toBe("Calling 911 in 5 seconds. Cancel to stop.");
        expect(d.state.launched).toEqual([]);
        await wait(80);
        expect(d.state.launched).toHaveLength(1);
        expect(d.state.launched[0]).toMatchObject({ id: "org.webosphoenix.phone", params: { number: "911", dial: true } });
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
        expect(d.state.launched).toEqual([]);
        expect(e.state.launched).toEqual([]);
    });
    it("is placed once, when Call Now is tapped as the countdown ends", async () => {
        const d = device({ deps: { countdownMs: 0 } });
        const m = await d.ask("call 112");
        await d.svc.confirm({ threadId: d.thread(), messageId: m.id, accept: true });
        await wait(30);
        expect(d.state.launched).toHaveLength(1);
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

describe("a reminder for a place", () => {
    it("asks for a time instead of dropping the place, and the time said makes it", async () => {
        const d = device();
        const q = await d.ask("remind me to buy milk when I get home");
        expect(q).toMatchObject({ command: "reminder", status: "ask" });
        expect(q.text).toBe("I can't remind you when you get home yet, only at a time. When should I remind you to buy milk?");
        expect(d.of("com.palm.task:1").filter((t) => /buy milk/i.test(t.summary))).toEqual([]);
        const r = await d.ask("tomorrow morning");
        expect(r).toMatchObject({ command: "reminder", status: "done" });
        const made = d.of("com.palm.task:1").filter((t) => /buy milk/i.test(t.summary));
        expect(made).toHaveLength(1);
        expect(made[0].summary).toBe("buy milk");
        expect(made[0].dueDate ?? made[0].due ?? made[0].reminder).toBeTruthy();
        void NOW;
    });
    it("words that are another request are that request", async () => {
        const d = device();
        await d.ask("remind me to call mom when I leave work");
        expect(await d.ask("what's the weather")).toMatchObject({ command: "weather" });
    });
});
