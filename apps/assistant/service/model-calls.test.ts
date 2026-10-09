// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The on-device model's whole answer on the evaluation set
// (test/model-eval.json): each phrasing asked of a stand-in device that
// keeps what is saved (test/device.ts: alarms, reminders, tasks, events,
// memos are there to read back), with a real llama-server. A read-back
// waits are confirmed. Scored: the command it ends in (right), and whether
// that command ran (done: its arguments were good enough to do it and to
// find again), with the call step's time and tokens. A measurement, not a
// gate: docs/AI-AND-MCP.md records it. Runs only with
//
//   PHOENIX_TEST_LLAMA_URL=http://127.0.0.1:PORT/v1  (llama-server -c 4096 -np 1 -fa on -b 512, the built-in model)
//   PHOENIX_TEST_EVAL_N=80                            (the first N; all by default)
//   PHOENIX_TEST_EVAL_OUT=file.json                   (each answer)

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { device } from "./test/device";

const req = createRequire(import.meta.url);
const { createRequest } = req("./lib/node-http.js") as { createRequest(o: object): (r: object) => Promise<{ status: number; body: string }> };
const URL = process.env.PHOENIX_TEST_LLAMA_URL;
const APPS = [{ id: "com.palm.app.camera", title: "Camera" }, { id: "com.palm.app.notes", title: "Memos" }, { id: "org.webosphoenix.maps", title: "Maps" },
              { id: "org.webosphoenix.photos", title: "Photos" }, { id: "com.palm.app.clock", title: "Clock" }];

describe.skipIf(!URL)("the on-device model on the evaluation set", () => {
    it("answers each phrasing on a device that keeps what it saves", async () => {
        const set = (req("./test/model-eval.json") as { text: string; command: string }[]).slice(0, Number(process.env.PHOENIX_TEST_EVAL_N) || undefined);
        const http = createRequest({ timeoutMs: 600000 });
        const llm = { status: () => Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }] }), ensure: () => Promise.resolve({ baseUrl: URL }) };
        const rows: object[] = [];
        let right = 0, done = 0, rightDone = 0, calls = 0, callMs = 0, callTokens = 0;
        for (const e of set) {
            let call: { ms: number; tokens: number } | null = null;
            const llmRequest = (r: { body: string }) => http(r).then((res) => {
                const b = JSON.parse(r.body), schema = b.response_format?.json_schema?.schema;
                if (schema && !schema.properties?.command && !/Fill in the arguments/.test(b.messages[0].content)) {
                    const t = JSON.parse(res.body).timings || {};
                    call = { ms: Math.round((t.prompt_ms || 0) + (t.predicted_ms || 0)), tokens: t.predicted_n || 0 };
                }
                return res;
            });
            const d = device({ llm, llmRequest, apps: APPS });
            let m = await d.ask(e.text);
            if (m.status === "pending" && m.confirm) m = await d.confirm(m);
            const got = m.command || "none", ran = m.status === "done";
            if (got === e.command) right++;
            if (ran) done++;
            if (ran && got === e.command) rightDone++;
            if (call) { calls++; callMs += call.ms; callTokens += call.tokens; }
            rows.push({ text: e.text, want: e.command, got, status: m.status || "", call, reply: m.text });
        }
        const summary = { total: set.length, right, done, rightDone, calls, meanCallMs: Math.round(callMs / (calls || 1)), meanCallTokens: Math.round(callTokens / (calls || 1)) };
        console.log(JSON.stringify(summary));
        if (process.env.PHOENIX_TEST_EVAL_OUT) writeFileSync(process.env.PHOENIX_TEST_EVAL_OUT, JSON.stringify({ summary, rows }, null, 1));
        expect(rows).toHaveLength(set.length);
    }, 4 * 3600e3);
});
