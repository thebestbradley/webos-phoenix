// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The on-device model never slows down what the grammar can do (the
// owner, 11 October 2026: "some of the commands now are taking a long time
// because the language model is doing it; shouldn't it go through our tool
// first"; docs/AI-AND-MCP.md "Speed"). Every request of the evaluation's
// main set that the grammar answers alone is asked again with a model
// installed: none of them may wait for it, but for what the user asked to
// have written. And the model is started when the Assistant opens.

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(t: string, ctx: object): { command: string } | null };
type Turn = { say: string; replies: { path: string }[] };
type Case = { id: string; say?: string; turns?: { say: string; silence?: boolean; voice?: boolean }[]; settings?: object; deviceState?: object; locationAllowed?: boolean | null; put?: object[]; voice?: boolean };
const harness = req("../../../tools/eval-assistant.cjs") as {
    loadCases(f?: string): Case[];
    runCase(c: Case, o: object): Promise<{ turns: Turn[] }>;
    seed(put: (o: object) => string): void;
    APPS: { id: string; title: string }[];
};

// A stand-in for llama-server that answers at once and keeps what it was asked.
function model(opts: { ramBytes?: number } = {}) {
    const asked: { words: string; body: any }[] = [];
    let ensured = 0;
    const llm = {
        status: () => Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }], ramBytes: opts.ramBytes ?? 0 }),
        ensure: () => { ensured++; return Promise.resolve({ baseUrl: "http://127.0.0.1:9/v1" }); },
    };
    const reply = (o: object) => ({ status: 200, body: JSON.stringify({ choices: [{ message: o }] }) });
    let words = "";
    const llmRequest = async (r: { body: string }) => {
        const b = JSON.parse(r.body);
        asked.push({ words, body: b });
        if (b.response_format?.json_schema?.schema?.properties?.command) return reply({ content: JSON.stringify({ command: "none" }) });
        if (b.response_format) return reply({ content: "{}" });
        return reply({ content: "An answer." });
    };
    return { llm, llmRequest, asked, ensured: () => ensured, saying: (w: string) => { words = w; } };
}
// What the on-device model was asked to write (assistant.js compose).
const composing = (b: any) => !b.response_format && /^Write /.test(String(b.messages?.find((m: any) => m.role === "user")?.content ?? ""));

describe("what the grammar does never waits for the model", () => {
    it("asks none of the requests the grammar answers alone, but what the user asked to have written", async () => {
        const slowed: string[] = [];
        const heldOut = harness.loadCases(path.join(__dirname, "..", "eval", "held-out.json"));
        for (const c of harness.loadCases().concat(heldOut)) {
            const alone = await harness.runCase(c, {});
            const m = model();
            const d = device({ seed: (put) => { harness.seed(put); for (const o of c.put ?? []) put(JSON.parse(JSON.stringify(o))); }, apps: harness.APPS, llm: m.llm, llmRequest: m.llmRequest,
                               settings: { followUps: false, ...(c.settings ?? {}) },
                               locationAllowed: c.locationAllowed === undefined ? true : c.locationAllowed });
            if (c.deviceState) Object.assign(d.state, c.deviceState);
            const turns = c.turns ?? [{ say: c.say! }];
            // Once the model answered a turn (rightly), the next one follows
            // its answer, not the grammar's: not compared.
            let diverged = false;
            for (let i = 0; i < turns.length && !diverged; ++i) {
                const before = m.asked.length;
                // As the evaluation asks it: spoken (talk mode), or the voice
                // session's wait running out (the check-in).
                if (turns[i].silence) { await d.svc.sessionPhrase({ kind: "checkIn", threadId: d.thread(), speak: false }); continue; }
                m.saying(turns[i].say);
                await d.askAll(turns[i].say, turns[i].voice || c.voice ? { voice: true } : undefined);
                // What the grammar answered alone: no "nothing here can", and
                // no web search for words it did not take ("Search the web
                // automatically", which a model answers instead).
                const replies = alone.turns[i] ? alone.turns[i].replies : [];
                const parsed = grammar.parse(turns[i].say, { lang: "en", now: NOW }) as { command: string } | null;
                const searchedForIt = replies.some((r) => r.command === "search") && (!parsed || parsed.command === "beyond");
                const grammarDid = !!alone.turns[i] && !replies.some((r) => r.path === "fallback") && !searchedForIt;
                const waited = m.asked.slice(before).filter((a) => !(composing(a.body) && /\b(?:write|draft|compose|make me|create me)\b/i.test(a.words)));
                if (grammarDid && waited.length) slowed.push(c.id + ": " + turns[i].say);
                if (m.asked.length > before) diverged = true;
            }
        }
        expect(slowed).toEqual([]);
    }, 240000);

    it("asks for a missing time at once instead of waiting for the model's reading", async () => {
        const m = model();
        const d = device({ llm: m.llm, llmRequest: m.llmRequest });
        const r = await d.ask("add an event called dentist");
        expect(r).toMatchObject({ command: "event", status: "ask" });
        expect(r.text).toMatch(/^When is it\?/);
        expect(m.asked).toEqual([]);
        expect(m.ensured()).toBe(0);
    });

    it("tells a joke and talks without the model; a conversation it does not know is the model's", async () => {
        const m = model();
        const d = device({ llm: m.llm, llmRequest: m.llmRequest });
        expect(await d.ask("tell me a joke")).toMatchObject({ command: "chat" });
        expect(await d.ask("talk to me")).toMatchObject({ command: "chat" });
        expect(m.asked).toEqual([]);
        const r = await d.ask("you're great at this");
        expect(r.trace.path).toBe("on-device");
        expect(m.asked.length).toBeGreaterThan(0);
    });

    it("writes a memo or an email only when asked to write one", async () => {
        const m = model();
        const d = device({ llm: m.llm, llmRequest: m.llmRequest });
        const take = await d.ask("take a note about the parking spot");
        expect(take).toMatchObject({ command: "note", status: "ask" });
        expect(m.asked).toEqual([]);
        const email = await d.ask("email Sam I'm running late");
        expect(email).toMatchObject({ command: "email", status: "pending" });
        expect(m.asked).toEqual([]);
        const write = await d.ask("write me a memo about the trip to Lisbon");
        expect(write).toMatchObject({ command: "note", status: "done" });
        expect(m.asked.filter((a) => composing(a.body))).toHaveLength(1);
        const draft = await d.ask("draft an email announcing the bake sale");
        expect(draft).toMatchObject({ command: "email", status: "done" });
        expect(m.asked.filter((a) => composing(a.body))).toHaveLength(2);
    });
});

describe("warming the model as the Assistant opens", () => {
    it("starts it in the background and answers at once", async () => {
        const m = model();
        let release: (v: object) => void = () => {};
        const slow = new Promise<object>((r) => { release = r; });
        let ensured = 0;
        const llm = { ...m.llm, ensure: () => { ensured++; return slow; } };
        const d = device({ llm, llmRequest: m.llmRequest });
        const r = await d.svc.warm({});
        expect(r).toMatchObject({ returnValue: true, warming: true });
        expect(ensured).toBe(1);
        // A grammar answer meanwhile does not wait for it.
        expect(await d.ask("set a timer for 5 minutes")).toMatchObject({ command: "timer", status: "done" });
        release({ baseUrl: "http://127.0.0.1:9/v1" });
    });
    it("not where the model does not fit the memory, nor with no model chosen", async () => {
        const small = model({ ramBytes: 1024 * 1024 * 1024 });
        const d = device({ llm: small.llm, llmRequest: small.llmRequest });
        expect(await d.svc.warm({})).toMatchObject({ warming: false, why: "memory" });
        expect(small.ensured()).toBe(0);
        const off = model();
        const e = device({ llm: off.llm, llmRequest: off.llmRequest, settings: { followUps: false, localModel: "off" } });
        expect(await e.svc.warm({})).toMatchObject({ warming: false });
        expect(off.ensured()).toBe(0);
    });
});
