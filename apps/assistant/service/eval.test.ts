// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How well the grammar understands (docs/AI-AND-MCP.md "How well it
// understands"): the evaluation set (test/eval-phrasings.cjs) and its
// held-out part, and the set for the on-device model (test/model-eval.json:
// words the grammar does not take, for tools/eval-assistant.cjs). The
// model's part needs llama-server and a model: opt-in, not here.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js");
const evals = req("./test/eval.cjs") as {
    SET: [string, string, object | null][]; HELD_OUT: [string, string, object | null][]; NOW: number; APPS: object[]; NAMES: string[];
    grammarOnly(g: unknown, set?: unknown[]): { total: number; hit: number; misses: [string, string | null, string][] };
};
const modelSet = req("./test/model-eval.json") as { text: string; command: string }[];
const examples = req("./lib/examples.js") as Record<string, string[]>;
const commands = req("./lib/commands.js") as { BUILT_IN: { id: string; internal?: boolean; examples?: string[] }[] };

describe("the grammar on the evaluation set", () => {
    it("takes all 150 phrasings to their command", () => {
        const r = evals.grammarOnly(grammar);
        expect(r.total).toBe(150);
        expect(r.misses).toEqual([]);
    });
    it("takes at least 35 of the 40 held-out phrasings (measured 9 October 2026)", () => {
        const r = evals.grammarOnly(grammar, evals.HELD_OUT);
        expect(r.total).toBe(40);
        expect(r.hit).toBeGreaterThanOrEqual(35);
    });
});

describe("the on-device model's set", () => {
    const ctx = { lang: "en", now: evals.NOW, apps: evals.APPS, names: evals.NAMES, appCommands: grammar.compileAppCommands(evals.APPS, "en") };
    it("has 150 or more words the grammar does not take, questions and chat among them", () => {
        expect(modelSet.length).toBeGreaterThanOrEqual(150);
        expect(modelSet.filter((x) => x.command === "none").length).toBeGreaterThanOrEqual(20);
        // A phrasing the grammar learns leaves the set (it is the grammar's then): never a wrong take.
        const taken = modelSet.map((x) => [x.text, grammar.parse(x.text, ctx)?.command ?? null, x.command]).filter((x) => x[1] !== null);
        expect(taken.filter((x) => x[1] !== x[2])).toEqual([]);
    });
    it("names only commands there are, and repeats no example", () => {
        const ids = new Set(commands.BUILT_IN.map((c) => c.id).concat(["none"]));
        expect(modelSet.filter((x) => !ids.has(x.command))).toEqual([]);
        const said = new Set(Object.values(examples).flat().map((s) => s.toLowerCase()));
        expect(modelSet.filter((x) => said.has(x.text.toLowerCase()))).toEqual([]);
    });
});

describe("examples for the model's choice", () => {
    it("every command people ask for has two to four, in other words than the sets'", () => {
        const sets = new Set(evals.SET.concat(evals.HELD_OUT).map((x) => x[0].toLowerCase()));
        for (const c of commands.BUILT_IN.filter((x) => !x.internal)) {
            expect(c.examples?.length ?? 0, c.id).toBeGreaterThanOrEqual(2);
            expect(c.examples!.length, c.id).toBeLessThanOrEqual(4);
        }
        const repeated = Object.values(examples).flat().filter((s) => sets.has(s.toLowerCase()));
        expect(repeated).toEqual([]);
    });
});
