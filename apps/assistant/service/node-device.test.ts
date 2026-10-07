// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device side of the assistant (lib/node-device.js): files, the device
// key, and the on-device model's whole pipeline with stand-ins: a model
// "downloaded" from a local server through a redirect (as Hugging Face
// sends them) and checked against its SHA-256, then run by a fake
// llama-server (test/mock-providers.cjs, which speaks llama-server's
// Chat Completions) and asked through the router like the real one. With
// PHOENIX_TEST_LLAMA_SERVER and PHOENIX_TEST_GGUF set, the last test runs
// the real llama.cpp on a real model.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const req = createRequire(import.meta.url);
type Model = { id: string; name: string; url: string; sha256: string; size: number; file: string };
const device = req("./lib/node-device.js") as {
    fileStorage(dir: string): { get(k: string): unknown; set(k: string, v: unknown): void; remove(k: string): void; keys(p: string): string[] };
    fileSecrets(f: string): { seal(t: string): Promise<{ iv: string; data: string }>; unseal(e: object): Promise<string> };
    llamaServer(o: object): {
        status(): Promise<{ available: boolean; installed: { id: string }[]; downloading: object | null; error: string; running: boolean }>;
        download(m: Model): Promise<void>; cancel(id: string): Promise<void>; remove(m: Model): Promise<void>;
        ensure(m: Model): Promise<{ baseUrl: string }>; stop(): void;
    };
    speech(o: object): { speak(t: string, l?: string): Promise<void>; status(): Promise<{ available: boolean; engine: string }> };
};
const providers = req("./lib/providers.js") as { chatRequest(p: object, r: object, k: string): { url: string; body: string; headers: Record<string, string>; method: string }; parseChat(t: string, s: number, b: string): { text: string; toolCalls: { name: string }[] } };
const { createRequest } = req("./lib/node-http.js") as { createRequest(): (r: object) => Promise<{ status: number; body: string }> };

let dir: string, files: Server, base = "";
const FAKE_GGUF = Buffer.from("GGUF fake model for the tests\n".repeat(2000));
const model = (): Model => ({ id: "test-model", name: "Test Model", url: base + "/redirect/test.gguf",
    sha256: createHash("sha256").update(FAKE_GGUF).digest("hex"), size: FAKE_GGUF.length, file: "test.gguf" });

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "phoenix-assistant-"));
    files = createServer((rq, rs) => {
        if (rq.url === "/redirect/test.gguf") { rs.writeHead(302, { Location: "/files/test.gguf" }); return rs.end(); }
        if (rq.url === "/files/test.gguf") { rs.writeHead(200, { "Content-Length": FAKE_GGUF.length }); return rs.end(FAKE_GGUF); }
        rs.writeHead(404); rs.end();
    });
    await new Promise<void>((r) => files.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(files.address() as { port: number }).port}`;
});
afterAll(async () => {
    await new Promise((r) => files.close(r));
    rmSync(dir, { recursive: true, force: true });
});

describe("storage and the device key", () => {
    it("keeps one file per key", () => {
        const s = device.fileStorage(join(dir, "store"));
        s.set("assistant:thread:a", { id: "a" });
        s.set("assistant:msg:a:1", { id: "1" });
        expect(s.keys("assistant:msg:a:")).toEqual(["assistant:msg:a:1"]);
        expect(s.get("assistant:thread:a")).toEqual({ id: "a" });
        s.remove("assistant:thread:a");
        expect(s.get("assistant:thread:a")).toBeNull();
    });
    it("seals with a key kept in a private file", async () => {
        const sec = device.fileSecrets(join(dir, "key", "device.key"));
        const enc = await sec.seal("sk-secret");
        expect(JSON.stringify(enc)).not.toContain("sk-secret");
        expect(await sec.unseal(enc)).toBe("sk-secret");
        expect(readFileSync(join(dir, "key", "device.key")).length).toBe(32);
        // Another instance (a restarted service) reads it with the same key.
        expect(await device.fileSecrets(join(dir, "key", "device.key")).unseal(enc)).toBe("sk-secret");
    });
});

describe("the on-device model", () => {
    it("downloads a model through redirects, checks it, runs llama-server and answers", async () => {
        const bin = join(dir, "llama-server");
        writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${resolve(__dirname, "test/mock-providers.cjs")}" "$@"\n`);
        chmodSync(bin, 0o755);
        const llm = device.llamaServer({ modelsDir: join(dir, "models"), server: bin, idleMs: 60000, startTimeoutMs: 20000 });
        expect((await llm.status()).available).toBe(true);
        await llm.download(model());
        await vi.waitFor(async () => expect((await llm.status()).installed.map((m) => m.id)).toEqual(["test-model"]), { timeout: 5000 });
        expect(existsSync(join(dir, "models", "test-model.gguf.part"))).toBe(false);
        const { baseUrl } = await llm.ensure(model());
        expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
        const rq = providers.chatRequest({ type: "local", baseUrl, model: "test-model" },
            { system: "s", messages: [{ role: "user", text: "turn on the torch" }], tools: [{ name: "toggle", description: "t", parameters: { type: "object" } }] }, "");
        const r = await createRequest()(rq);
        expect(providers.parseChat("local", r.status, r.body).toolCalls[0].name).toBe("toggle");
        expect((await llm.status()).running).toBe(true);
        await llm.remove(model());
        expect((await llm.status()).installed).toEqual([]);
        expect((await llm.status()).running).toBe(false);
    });

    it("refuses a download whose SHA-256 is wrong, and says llama-server is missing", async () => {
        const llm = device.llamaServer({ modelsDir: join(dir, "models2"), server: join(dir, "nowhere", "llama-server") });
        await llm.download({ ...model(), sha256: "0".repeat(64) });
        await vi.waitFor(async () => expect((await llm.status()).error).toMatch(/damaged/), { timeout: 5000 });
        expect((await llm.status()).installed).toEqual([]);
        expect((await llm.status()).available).toBe(false);
        await expect(llm.ensure(model())).rejects.toThrow(/not downloaded|not installed/);
    });

    it.skipIf(!process.env.PHOENIX_TEST_LLAMA_SERVER || !process.env.PHOENIX_TEST_GGUF)(
        "runs the real llama-server on a real model", async () => {
            const gguf = process.env.PHOENIX_TEST_GGUF!;
            const modelsDir = join(dir, "real");
            req("node:fs").mkdirSync(modelsDir, { recursive: true });
            req("node:fs").symlinkSync(gguf, join(modelsDir, "real.gguf"));
            const llm = device.llamaServer({ modelsDir, server: process.env.PHOENIX_TEST_LLAMA_SERVER, startTimeoutMs: 120000 });
            const m = { ...model(), id: "real" };
            const { baseUrl } = await llm.ensure(m);
            const rq = providers.chatRequest({ type: "local", baseUrl, model: "real" },
                { system: "Use the tool when asked to act.", messages: [{ role: "user", text: "Turn on the flashlight." }],
                  tools: [{ name: "toggle", description: "Turn a device setting on or off.", parameters: { type: "object",
                      properties: { setting: { type: "string", enum: ["wifi", "flashlight"] }, state: { type: "string", enum: ["on", "off"] } },
                      required: ["setting", "state"] } }] }, "");
            const r = await createRequest()(rq);
            const out = providers.parseChat("local", r.status, r.body);
            llm.stop();
            expect(out.toolCalls[0]?.name ?? out.text).toBeTruthy();
        }, 180000);
});

describe("speech", () => {
    it("speaks through a program reading stdin", async () => {
        const out = join(dir, "spoken.txt");
        const sp = device.speech({ command: [process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(out)}, process.argv[1] + ":" + require("fs").readFileSync(0, "utf8"))`, "%l"] });
        await sp.speak("The flashlight is on.", "en");
        expect(readFileSync(out, "utf8")).toBe("en:The flashlight is on.");
        expect((await sp.status()).available).toBe(true);
    });
});
