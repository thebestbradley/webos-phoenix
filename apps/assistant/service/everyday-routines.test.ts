// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Routines (lib/commands-routines.js, lib/lang/en-routines.js): made in
// Settings (setRoutine, every step checked), run on their phrase with what
// each step did said together, at their time through the activity manager
// (routineWake, then the next), on charge or in the car (routineEvent),
// listed, turned off and deleted by voice; the starters off until added.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };

function world() {
    const spoken: string[] = [], notes: any[] = [];
    const d = device({ deps: { tts: { speak: (t: string) => { spoken.push(t); return Promise.resolve(); }, stop: () => undefined },
                                notify: (n: object) => notes.push(n) } });
    return Object.assign(d, { spoken, notes });
}
async function starters(d: ReturnType<typeof world>) { return (await d.svc.routines({})).starters; }

describe("the words", () => {
    const ctx = { lang: "en", now: NOW, routines: [{ id: "r1", name: "Good night", phrases: ["good night", "bedtime"], on: true },
                                                  { id: "r2", name: "Workout", phrases: ["gym time"], on: false }] };
    it("runs a routine on its phrase, or by its name", () => {
        expect(grammar.parse("good night", ctx)).toEqual({ command: "routine", args: { name: "Good night", id: "r1" } });
        expect(grammar.parse("Bedtime!", ctx)).toEqual({ command: "routine", args: { name: "Good night", id: "r1" } });
        expect(grammar.parse("run my good night routine", ctx)).toEqual({ command: "routine", args: { name: "Good night", id: "r1" } });
        expect(grammar.parse("start the workout routine", ctx)).toEqual({ command: "routine", args: { name: "Workout", id: "r2" } });
        // A routine that is off is not run by its phrase alone.
        expect(grammar.parse("gym time", ctx)?.command).not.toBe("routine");
    });
    it("leaves the words alone without a routine of them", () => {
        expect(grammar.parse("good night", { lang: "en", now: NOW })?.command).toBe("chat");
        expect(grammar.parse("good morning", ctx)?.command).toBe("chat");
    });
    it("lists, turns off and deletes routines", () => {
        expect(grammar.parse("what routines do I have", ctx)).toEqual({ command: "routineList", args: { create: false } });
        expect(grammar.parse("make a routine", ctx)).toEqual({ command: "routineList", args: { create: true } });
        expect(grammar.parse("turn off my good night routine", ctx)).toEqual({ command: "routineManage", args: { name: "good night", action: "off" } });
        expect(grammar.parse("delete the workout routine", ctx)).toEqual({ command: "routineManage", args: { name: "workout", action: "delete" } });
        expect(grammar.parse("turn off wifi", ctx)?.command).toBe("toggle");
    });
});

describe("making one", () => {
    it("offers Good night and Good morning, off until added", async () => {
        const d = world();
        const r = await d.svc.routines({});
        expect(r.routines).toEqual([]);
        expect(r.starters.map((s: any) => s.name)).toEqual(["Good night", "Good morning"]);
        expect(r.templates.length).toBeGreaterThan(10);
        expect((await d.ask("good night")).command).toBe("chat");
    });
    it("checks every step: never one that sends, calls or deletes, nor words it can't do", async () => {
        const d = world();
        const bad = await d.svc.setRoutine({ routine: { name: "Bad", steps: [{ text: "text Sam hi" }, { text: "delete all my alarms" }, { text: "blorf" }] } });
        expect(bad.returnValue).toBe(false);
        expect(bad.errorText).toMatch(/“text Sam hi” sends, calls or deletes/);
        expect(bad.errorText).toMatch(/“delete all my alarms” sends, calls or deletes/);
        expect(bad.errorText).toMatch(/I couldn't do “blorf”/);
        expect((await d.svc.setRoutine({ routine: { name: "Empty", steps: [] } })).errorText).toBe("A routine needs at least one step.");
        expect((await d.svc.setRoutine({ routine: { name: "Loop", steps: [{ text: "run my loop routine" }] } })).returnValue).toBe(false);
        expect((await d.svc.routines({})).routines).toEqual([]);
    });
    it("keeps each step's command, and says when a phrase is another routine's", async () => {
        const d = world();
        const [night] = await starters(d);
        const r = await d.svc.setRoutine({ routine: night });
        expect(r.routine.steps.map((s: any) => s.command)).toEqual(["toggle", "alarmList", "agenda", "lock"]);
        const clash = await d.svc.setRoutine({ routine: { name: "Sleep", phrases: ["Good night"], steps: [{ text: "lock the screen" }] } });
        expect(clash).toMatchObject({ returnValue: false, errorText: "“good night” already starts your Good night routine." });
    });
    it("is Settings' and the system UI's to change", async () => {
        const d = device({ deps: { caller: () => "com.example.app" } });
        expect((await d.svc.setRoutine({ routine: { name: "X", steps: [{ text: "lock the screen" }] } })).returnValue).toBe(false);
    });
});

describe("running one", () => {
    it("does each step and says what each did", async () => {
        const d = world();
        await d.svc.setRoutine({ routine: (await starters(d))[0] });
        const m = await d.ask("good night");
        expect(m).toMatchObject({ command: "routine", status: "done" });
        expect(m.text).toBe("Good night. Do Not Disturb is on: the ringer and alerts are silent. You have 2 alarms: 7:00 AM on weekdays and 6:30 PM. " +
                            "Tomorrow you have 1 event: “Team stand-up” at 9:30 AM. Locked.");
        expect(d.state.ringtones).toBe(0);
        expect(d.called("com.palm.display/control/setState").at(-1)?.params).toEqual({ state: "off" });
    });
    it("reads a step's time when it runs, not when it was made", async () => {
        const d = world();
        await d.svc.setRoutine({ routine: { name: "Wake", phrases: ["wake routine"], steps: [{ text: "set an alarm for 7am" }] } });
        d.setNow(NOW + 2 * 86400e3);
        const m = await d.ask("wake routine");
        expect(m.text).toMatch(/^Wake\. /);
        const alarms = d.of("com.palm.clock.alarm:1").filter((a) => a.hour === 7 && a.occurs === "once");
        expect(alarms).toHaveLength(1);
    });
    it("says when a routine is off, with a way to turn it on", async () => {
        const d = world();
        await d.svc.setRoutine({ routine: { ...(await starters(d))[1], enabled: false } });
        const m = await d.ask("run my good morning routine");
        expect(m.text).toBe("Your Good morning routine is off.");
        expect(m.choices?.map((c) => c.label)).toContain("Turn It On");
    });
    it("lists them, turns one off and deletes one after asking", async () => {
        const d = world();
        const [night, morning] = await starters(d);
        await d.svc.setRoutine({ routine: night });
        await d.svc.setRoutine({ routine: morning });
        expect((await d.ask("what routines do I have")).text).toBe("You have 2 routines: Good night and Good morning.");
        expect((await d.ask("turn off my good morning routine")).text).toMatch(/^Your Good morning routine is off/);
        expect((await d.ask("what routines do I have")).text).toBe("You have 2 routines: Good night and Good morning (off).");
        const q = await d.ask("delete my good night routine");
        expect(q).toMatchObject({ command: "routineManage", status: "pending", text: "Delete your Good night routine?" });
        await d.confirm(q);
        expect((await d.svc.routines({})).routines.map((r: any) => r.name)).toEqual(["Good morning"]);
    });
});

describe("at a time, on charge, in the car", () => {
    it("wakes at its time through the activity manager, says what it did, and sets the next", async () => {
        const d = world();
        const morning = (await starters(d))[1];
        const r = await d.svc.setRoutine({ routine: { ...morning, time: "07:00", days: [1, 2, 3, 4, 5] } });
        // Wednesday 10:00: the next weekday 7:00 is Thursday's.
        expect(r.nextAt).toBe(new Date(2026, 9, 8, 7, 0).getTime());
        const act = d.state.activities.get("assistant.routine." + r.routine.id);
        expect(act).toMatchObject({ callback: { method: "luna://org.webosphoenix.assistant/routineWake", params: { id: r.routine.id } } });
        // Called early (another's call out of time): nothing runs.
        expect(await d.svc.routineWake({ id: r.routine.id, at: r.nextAt })).toMatchObject({ ran: false });
        d.setNow(r.nextAt + 2000);
        const w = await d.svc.routineWake(act.callback.params);
        expect(w).toMatchObject({ ran: true });
        expect(w.text).toMatch(/^Good morning\. Do Not Disturb is off/);
        expect(d.spoken.at(-1)).toBe(w.text);
        expect(d.notes.at(-1)).toMatchObject({ title: "Good morning", body: w.text });
        // Friday's next (the activity manager's UTC).
        const friday = new Date(2026, 9, 9, 7, 0);
        expect(d.state.activities.get("assistant.routine." + r.routine.id).schedule.start)
            .toBe(`${friday.getUTCFullYear()}-10-${String(friday.getUTCDate()).padStart(2, "0")} ${String(friday.getUTCHours()).padStart(2, "0")}:00:00Z`);
    });
    it("runs the routines waiting for the charger or the car", async () => {
        const d = world();
        await d.svc.setRoutine({ routine: { name: "Drive", phrases: ["drive time"], steps: [{ text: "turn on driving mode" }], events: ["car"] } });
        await d.svc.setRoutine({ routine: { name: "Charge", phrases: ["charge time"], steps: [{ text: "turn off wifi" }], events: ["charging"] } });
        expect(await d.svc.routineEvent({ event: "car" })).toMatchObject({ ran: 1 });
        expect(d.storage.get("assistant:driving")).toMatchObject({ on: true });
        expect(d.state.wifi).toBe(true);
        expect(await d.svc.routineEvent({ event: "charging" })).toMatchObject({ ran: 1 });
        expect(d.spoken.at(-1)).toMatch(/^Charge\. Wi-Fi is off/);
        expect((await d.svc.routineEvent({ event: "moon" })).returnValue).toBe(false);
    });
    it("cancels its time when it is turned off or deleted", async () => {
        const d = world();
        const r = await d.svc.setRoutine({ routine: { ...(await starters(d))[1], time: "07:00" } });
        const name = "assistant.routine." + r.routine.id;
        expect(d.state.activities.has(name)).toBe(true);
        await d.ask("turn off my good morning routine");
        expect(d.state.activities.has(name)).toBe(false);
        await d.ask("turn on my good morning routine");
        expect(d.state.activities.has(name)).toBe(true);
        await d.svc.removeRoutine({ id: r.routine.id });
        expect(d.state.activities.has(name)).toBe(false);
    });
});
