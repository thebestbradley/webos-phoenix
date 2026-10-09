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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
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
    speech(o: object): { speak(t: string, l?: string, v?: string): Promise<void>; status(): Promise<{ available: boolean; engine: string; voices: string[] }> };
    voiceStatus(o: object): () => Promise<{ id: string; available: boolean; engine?: string; howToInstall: string }[]>;
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
        writeFileSync(bin, `#!/bin/sh\necho "$@" > "${join(dir, "llama-args")}"\nexec "${process.execPath}" "${resolve(__dirname, "test/mock-providers.cjs")}" "$@"\n`);
        chmodSync(bin, 0o755);
        const llm = device.llamaServer({ modelsDir: join(dir, "models"), server: bin, idleMs: 60000, startTimeoutMs: 20000 });
        expect((await llm.status()).available).toBe(true);
        await llm.download(model());
        await vi.waitFor(async () => expect((await llm.status()).installed.map((m) => m.id)).toEqual(["test-model"]), { timeout: 5000 });
        expect(existsSync(join(dir, "models", "test-model.gguf.part"))).toBe(false);
        const { baseUrl } = await llm.ensure(model());
        expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
        // Prompts read 512 tokens at a time: a request given up on ends soon (lib/node-device.js).
        expect(readFileSync(join(dir, "llama-args"), "utf8")).toMatch(/ -np 1 .* -b 512\b/);
        const rq = providers.chatRequest({ type: "local", baseUrl, model: "test-model" },
            { system: "s", messages: [{ role: "user", text: "turn on the torch" }], tools: [{ name: "toggle", description: "t", parameters: { type: "object" } }] }, "");
        const r = await createRequest()(rq);
        expect(providers.parseChat("local", r.status, r.body).toolCalls[0].name).toBe("toggle");
        expect((await llm.status()).running).toBe(true);
        await llm.remove(model());
        expect((await llm.status()).installed).toEqual([]);
        expect((await llm.status()).running).toBe(false);
    });

    // The service gone, its llama-server goes too (lib/node-device.js):
    // on SIGTERM; killed outright, through phoenix-pdeath (services/pdeath,
    // built here with cc) or setpriv, or else by the next service, from the
    // pid it kept.
    it("ends llama-server with the service, however the service ends", async () => {
        const bin = join(dir, "llama-server");
        writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${resolve(__dirname, "test/mock-providers.cjs")}" "$@"\n`);
        chmodSync(bin, 0o755);
        const script = join(dir, "service-child.cjs");
        writeFileSync(script, `const d = require(${JSON.stringify(resolve(__dirname, "lib/node-device.js"))});
const [models, pidFile, pdeath] = process.argv.slice(2);
const llm = d.llamaServer({ modelsDir: models, pidFile, server: ${JSON.stringify(bin)}, startTimeoutMs: 20000,
                            pdeath: pdeath === "none" ? false : pdeath === "default" ? undefined : pdeath });
llm.ensure({ id: "test-model", name: "Test Model" }).then(() => { console.log("ready " + require("fs").readFileSync(pidFile, "utf8").split(" ")[0]); }, (e) => { console.log("failed " + e.message); });
setInterval(() => {}, 1000);
`);
        const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        const service = async (pidFile: string, pdeath: string) => {
            const child = spawn(process.execPath, [script, join(dir, "models"), pidFile, pdeath], { stdio: ["ignore", "pipe", "inherit"] });
            const line: string = await new Promise((r) => child.stdout.on("data", (d) => r(String(d).trim())));
            expect(line).toMatch(/^ready \d+$/);
            return { child, server: Number(line.split(" ")[1]) };
        };
        const gone = (pid: number) => vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
        mkdirSync(join(dir, "models"), { recursive: true });
        writeFileSync(join(dir, "models", "test-model.gguf"), FAKE_GGUF);
        // SIGTERM (run-js-service stopping it).
        let s = await service(join(dir, "a.pid"), "none");
        expect(alive(s.server)).toBe(true);
        s.child.kill("SIGTERM");
        await gone(s.server);
        expect(existsSync(join(dir, "a.pid"))).toBe(false);
        // Killed outright, without setpriv: left, until the next service starts.
        s = await service(join(dir, "b.pid"), "none");
        s.child.kill("SIGKILL");
        await new Promise((r) => setTimeout(r, 300));
        expect(alive(s.server)).toBe(true);
        device.llamaServer({ modelsDir: join(dir, "models"), pidFile: join(dir, "b.pid"), server: bin });
        await gone(s.server);
        // Killed outright, through phoenix-pdeath: ended by the kernel.
        const helper = join(dir, "phoenix-pdeath");
        execFileSync("cc", ["-O2", "-o", helper, resolve(__dirname, "../../../services/pdeath/pdeath.c")]);
        s = await service(join(dir, "c.pid"), helper);
        expect(readFileSync(`/proc/${s.server}/cmdline`, "utf8")).toContain("mock-providers.cjs");
        s.child.kill("SIGKILL");
        await gone(s.server);
        // ... or through setpriv, where there is one and no phoenix-pdeath.
        if (existsSync("/usr/bin/setpriv") || existsSync("/bin/setpriv")) {
            s = await service(join(dir, "d.pid"), "default");
            s.child.kill("SIGKILL");
            await gone(s.server);
        }
    }, 30000);

    it("ships the same built-in model everywhere: lib/models.js, ./phoenix's fetcher, meta-phoenix's recipe", () => {
        const models = req("./lib/models.js") as { BUILT_IN: string; find(id: string): { url: string; sha256: string; size: number; builtIn: boolean } };
        const m = models.find(models.BUILT_IN);
        expect(m.builtIn).toBe(true);
        const repo = resolve(__dirname, "../../..");
        const fetcher = readFileSync(join(repo, "tools/get-base-model.py"), "utf8");
        const value = (name: string) => (fetcher.match(new RegExp(`^${name} = "?([^"\\n]+)"?$`, "m")) || [])[1];
        expect([value("ID"), value("URL"), value("SHA256"), Number(value("SIZE"))]).toEqual([models.BUILT_IN, m.url, m.sha256, m.size]);
        const recipe = readFileSync(join(repo, "meta-phoenix/recipes-support/qwen3-gguf/qwen3-0.6b-gguf.bb"), "utf8");
        expect(recipe).toContain(m.sha256);
        expect(recipe).toContain(m.url.replace(/\/[^/]+$/, ""));
        expect(recipe).toContain(models.BUILT_IN + ".gguf");
    });

    it("runs a built-in model where the image keeps it, and never removes it", async () => {
        const bin = join(dir, "llama-server");
        const shipped = join(dir, "usr-share-phoenix-models");
        mkdirSync(shipped, { recursive: true });
        writeFileSync(join(shipped, "built-in.gguf"), FAKE_GGUF);
        const llm = device.llamaServer({ modelsDir: join(dir, "models3"), builtInDirs: [shipped], server: bin, startTimeoutMs: 20000 });
        expect((await llm.status()).installed).toEqual([{ id: "built-in", file: join(shipped, "built-in.gguf"), size: FAKE_GGUF.length, builtIn: true }]);
        const m = { ...model(), id: "built-in" };
        expect((await llm.ensure(m)).baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
        await llm.remove(m);
        expect(existsSync(join(shipped, "built-in.gguf"))).toBe(true);
        llm.stop();
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

    // phoenix-tts and Flite stood in for by scripts (the real ones: tts-test).
    function standIns(noSound: boolean) {
        const bin = join(dir, noSound ? "tts-bin-nosound" : "tts-bin");
        mkdirSync(bin, { recursive: true });
        const kitten = join(bin, "phoenix-tts"), flite = join(bin, "flite");
        writeFileSync(kitten, `#!/bin/sh
if [ "$1" = --check ]; then echo '{"ok":true,"voices":["expr-voice-3-f","expr-voice-5-m"]}'; exit 0; fi
echo "$*:$(cat)" > "${bin}/kitten.txt"
${noSound ? "exit 4" : "exit 0"}
`);
        writeFileSync(flite, `#!/bin/sh
echo "$(cat)" > "${bin}/flite.txt"
`);
        chmodSync(kitten, 0o755);
        chmodSync(flite, 0o755);
        return { bin, kitten, flite };
    }

    it("speaks with Kitten TTS by default, with the voice asked for", async () => {
        const { bin, kitten, flite } = standIns(false);
        const sp = device.speech({ kitten, fallback: [flite] });
        expect(await sp.status()).toEqual({ available: true, engine: "Kitten TTS", voices: ["expr-voice-3-f", "expr-voice-5-m"] });
        await sp.speak("The flashlight is on.", "en", "expr-voice-5-m");
        expect(readFileSync(join(bin, "kitten.txt"), "utf8").trim()).toBe("--voice expr-voice-5-m:The flashlight is on.");
        // Another language: Kitten speaks English only.
        await sp.speak("Bonjour.", "fr");
        expect(readFileSync(join(bin, "flite.txt"), "utf8").trim()).toBe("Bonjour.");
    });

    it("goes on to Flite when Kitten cannot speak", async () => {
        const { bin, kitten, flite } = standIns(true);
        const said: string[] = [];
        const sp = device.speech({ kitten, fallback: [flite], log: (m: string) => said.push(m) });
        await sp.speak("Bluetooth is off.", "en");
        expect(readFileSync(join(bin, "flite.txt"), "utf8").trim()).toBe("Bluetooth is off.");
        expect(said.join("\n")).toMatch(/Kitten TTS could not speak; flite instead/);
        const none = device.speech({ kitten: join(dir, "nowhere", "phoenix-tts"), fallback: [flite] });
        expect(await none.status()).toEqual({ available: true, engine: "flite", voices: [] });
    });
});

describe("what the voice needs (voiceStatus)", () => {
    const luna = (reply: object | null) => ({ call: () => (reply ? Promise.resolve(reply) : Promise.reject(new Error("no service"))) });
    const tts = (available: boolean) => ({ status: () => Promise.resolve({ available, engine: available ? "flite" : "" }) });

    it("says what is missing from the image and which package has it", async () => {
        const parts = await device.voiceStatus({
            luna: luna({ returnValue: true, engine: "whisper.cpp", installed: false, binary: "/usr/bin/whisper-cli",
                         model: "/usr/share/whisper/ggml-base.en.bin", modelInstalled: false }),
            tts: tts(false), libDirs: [dir], wakeModel: join(dir, "no-model"),
        })();
        const by = Object.fromEntries(parts.map((p) => [p.id, p]));
        expect(by.recognition.available).toBe(false);
        expect(by.recognition.howToInstall).toMatch(/ggml-base\.en\.bin is not installed.*whisper-cpp-model-base-en/);
        expect(by.wakeWord.available).toBe(false);
        expect(by.wakeWord.howToInstall).toMatch(/packagegroup-phoenix-assistant/);
        expect(by.speech).toMatchObject({ available: false });
        expect(by.speech.howToInstall).toMatch(/Flite or espeak-ng/);
        // No transcriber at all.
        const none = await device.voiceStatus({ luna: luna(null), tts: tts(true), libDirs: [dir] })();
        expect(none[0]).toMatchObject({ id: "recognition", available: false });
        expect(none[2]).toMatchObject({ id: "speech", available: true, engine: "flite", howToInstall: "" });
    });

    it("finds the wake word's program, library and model", async () => {
        const bin = join(dir, "bin"), lib = join(dir, "lib"), wakeModel = join(dir, "vosk-model");
        for (const d of [bin, lib, wakeModel]) mkdirSync(d, { recursive: true });
        writeFileSync(join(bin, "phoenix-wakeword"), "#!/bin/sh\n");
        chmodSync(join(bin, "phoenix-wakeword"), 0o755);
        writeFileSync(join(lib, "libvosk.so"), "");
        const path = process.env.PATH;
        process.env.PATH = bin + ":" + path;
        try {
            const parts = await device.voiceStatus({ luna: luna({ returnValue: true, installed: true, binary: "/x", modelInstalled: true }),
                                                     tts: tts(true), libDirs: [lib], wakeModel })();
            expect(parts.map((p) => [p.id, p.available, p.howToInstall])).toEqual([
                ["recognition", true, ""], ["wakeWord", true, ""], ["speech", true, ""]]);
        } finally {
            process.env.PATH = path;
        }
    });
});
