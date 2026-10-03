// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device service's methods (transcriber.js) with stand-ins for
// whisper-cli and ffmpeg: small scripts that answer like the real programs
// (the -oj JSON and the -pp progress lines of whisper-cli). With
// PHOENIX_TEST_WHISPER_CLI and PHOENIX_TEST_WHISPER_MODEL set, the last test
// also runs the real whisper.cpp on the demo memo.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Reply = { returnValue: boolean; errorCode?: number; errorText?: string; [k: string]: unknown };
type Options = { whisper?: string; model?: string; ffmpeg?: string; configFile?: string; env?: Record<string, string> };
const lib = createRequire(import.meta.url)("./transcriber.js") as {
    createTranscriber(o: Options): {
        transcribe(p: object, onProgress?: (r: Reply) => void): Promise<Reply>;
        getStatus(): Promise<Reply>;
    };
    ERRORS: Record<string, number>;
    METHODS: string[];
    DEFAULT_MODEL: string;
    isWhisperWav(b: Buffer): boolean;
    parseProgress(s: string): number | null;
};
const { createTranscriber, ERRORS } = lib;

const DEMO = resolve(__dirname, "../public/samples/memo-20260901-081000.wav");

let dir: string, bin: string, model: string, memo: string;

function script(name: string, body: string): string {
    const p = join(bin, name);
    writeFileSync(p, `#!${process.execPath}\n` + body);
    chmodSync(p, 0o755);
    return p;
}

// Writes -of <base>.json and progress lines like whisper-cli -oj -pp, and
// records its arguments; refuses input that is not 16 kHz WAV, as old
// whisper-cli builds do.
const FAKE_WHISPER = `
const fs = require("fs");
const a = process.argv.slice(2), arg = (k) => a[a.indexOf(k) + 1];
fs.writeFileSync(process.env.FAKE_LOG || "/dev/null", JSON.stringify(a));
const wav = fs.readFileSync(arg("-f"));
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.readUInt32LE(24) !== 16000) { console.error("error: failed to read WAV file"); process.exit(10); }
for (const p of [0, 35, 70, 100]) process.stderr.write("whisper_print_progress_callback: progress = " + String(p).padStart(3) + "%\\n");
fs.writeFileSync(arg("-of") + ".json", JSON.stringify({ result: { language: "en" }, transcription: [
    { offsets: { from: 0, to: 1980 }, text: " Welcome to Voice Memos." },
    { offsets: { from: 2000, to: 2400 }, text: " [BLANK_AUDIO]" },
    { offsets: { from: 2430, to: 7550 }, text: " Record a memo." } ] }));
`;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "phoenix-transcriber-"));
    bin = join(dir, "bin");
    mkdirSync(bin);
    model = join(dir, "ggml-base.en.bin");
    writeFileSync(model, "model");
    memo = join(dir, "memo.wav");
    writeFileSync(memo, readFileSync(DEMO));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noConfig = () => join(dir, "none.json");

describe("org.webosphoenix.transcriber (device service)", () => {
    it("has transcribe and getStatus", () => {
        expect(lib.METHODS).toEqual(["transcribe", "getStatus"]);
        expect(lib.DEFAULT_MODEL).toBe("/usr/share/whisper/ggml-base.en.bin");
    });

    it("says clearly when whisper.cpp or its model is not installed", async () => {
        const none = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin } });
        const r = await none.transcribe({ path: memo });
        expect(r).toMatchObject({ returnValue: false, errorCode: ERRORS.ENGINE_NOT_INSTALLED });
        expect(r.errorText).toMatch(/not installed.*whisper-cli/);
        expect(await none.getStatus()).toMatchObject({ returnValue: true, engine: "whisper.cpp", installed: false, modelInstalled: true });

        script("whisper-cli", FAKE_WHISPER);
        const noModel = createTranscriber({ configFile: noConfig(), env: { PATH: bin, PHOENIX_WHISPER_MODEL: join(dir, "missing.bin") } });
        const m = await noModel.transcribe({ path: memo });
        expect(m).toMatchObject({ returnValue: false, errorCode: ERRORS.MODEL_NOT_INSTALLED });
        expect(m.errorText).toContain("missing.bin");
    });

    it("checks its parameters and the file", async () => {
        script("whisper-cli", FAKE_WHISPER);
        const t = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin } });
        expect(await t.transcribe({ path: "memo.wav" })).toMatchObject({ errorCode: ERRORS.BAD_PARAMS });
        expect(await t.transcribe({ path: memo, language: "english; rm -rf" })).toMatchObject({ errorCode: ERRORS.BAD_PARAMS });
        expect(await t.transcribe({ path: join(dir, "nope.wav") })).toMatchObject({ errorCode: ERRORS.NOT_FOUND });
        expect(await t.transcribe({ path: dir })).toMatchObject({ errorCode: ERRORS.NOT_FOUND });
    });

    it("runs whisper-cli on a 16 kHz WAV and reports progress and segments", async () => {
        const log = join(dir, "args.json");
        const whisper = script("whisper-cli", FAKE_WHISPER);
        const t = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin, FAKE_LOG: log } });
        expect(await t.getStatus()).toMatchObject({ installed: true, binary: whisper, model, converter: false });
        const steps: Reply[] = [];
        const r = await t.transcribe({ path: memo, language: "de" }, (s) => steps.push(s));
        expect(r).toMatchObject({ returnValue: true, state: "done", progress: 100, engine: "whisper.cpp", language: "en",
                                  text: "Welcome to Voice Memos. Record a memo." });
        expect(r.segments).toEqual([{ start: 0, end: 1.98, text: "Welcome to Voice Memos." }, { start: 2.43, end: 7.55, text: "Record a memo." }]);
        // Lines that arrive together count once (the latest), so only the order is certain.
        const shown = steps.map((s) => `${s.state} ${s.progress}`);
        expect(shown.slice(0, 2)).toEqual(["queued 0", "transcribing 0"]);
        expect(shown[shown.length - 1]).toBe("transcribing 100");
        const pcts = steps.slice(1).map((s) => Number(s.progress));
        expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
        // The WAV goes in unconverted; an English-only model is always asked for English.
        const args = JSON.parse(readFileSync(log, "utf8")) as string[];
        expect(args.slice(0, 6)).toEqual(["-m", model, "-f", memo, "-l", "en"]);
        expect(args).toContain("-oj");
        expect(args).toContain("-pp");
        expect(args).not.toContain("--prompt");
    });

    it("passes a prompt (words to expect) to whisper-cli as one argument", async () => {
        const log = join(dir, "args.json");
        script("whisper-cli", FAKE_WHISPER);
        const t = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin, FAKE_LOG: log } });
        const prompt = "Call Ada Palmer. Call Lena Okafor; $(rm -rf /)";
        expect(await t.transcribe({ path: memo, prompt })).toMatchObject({ returnValue: true });
        const args = JSON.parse(readFileSync(log, "utf8")) as string[];
        expect(args.slice(args.indexOf("--prompt"), args.indexOf("--prompt") + 2)).toEqual(["--prompt", prompt]);
        expect(await t.transcribe({ path: memo, prompt: "x".repeat(1001) })).toMatchObject({ errorCode: ERRORS.BAD_PARAMS });
        expect(await t.transcribe({ path: memo, prompt: 42 as unknown as string })).toMatchObject({ errorCode: ERRORS.BAD_PARAMS });
    });

    it("converts other audio with ffmpeg, or says it needs it", async () => {
        script("whisper-cli", FAKE_WHISPER);
        const webm = join(dir, "memo.webm");
        writeFileSync(webm, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]));
        const without = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin } });
        const r = await without.transcribe({ path: webm });
        expect(r).toMatchObject({ returnValue: false, errorCode: ERRORS.UNSUPPORTED_FORMAT });
        expect(r.errorText).toMatch(/ffmpeg is not installed/);

        // A stand-in ffmpeg that "converts" to the demo WAV (the last argument is the output).
        script("ffmpeg", `require("fs").copyFileSync(${JSON.stringify(DEMO)}, process.argv[process.argv.length - 1]);`);
        const withFfmpeg = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin } });
        const steps: string[] = [];
        const ok = await withFfmpeg.transcribe({ path: webm }, (s) => steps.push(String(s.state)));
        expect(ok).toMatchObject({ returnValue: true, text: "Welcome to Voice Memos. Record a memo." });
        expect(steps.slice(0, 3)).toEqual(["queued", "converting", "transcribing"]);
    });

    it("reports a failing engine", async () => {
        script("whisper-cli", `console.error("error: failed to initialize whisper context"); process.exit(3);`);
        const t = createTranscriber({ model, configFile: noConfig(), env: { PATH: bin } });
        const r = await t.transcribe({ path: memo });
        expect(r).toMatchObject({ returnValue: false, errorCode: ERRORS.FAILED });
        expect(r.errorText).toMatch(/exit 3.*failed to initialize/);
    });

    it("reads its configuration file", async () => {
        const whisper = script("whisper", FAKE_WHISPER);
        const cfg = join(dir, "transcriber.json");
        writeFileSync(cfg, JSON.stringify({ whisper, model }));
        const t = createTranscriber({ configFile: cfg, env: { PATH: "" } });
        expect(await t.getStatus()).toMatchObject({ installed: true, binary: whisper, model });
    });

    it("knows the WAV whisper-cli reads and its progress lines", () => {
        expect(lib.isWhisperWav(readFileSync(DEMO))).toBe(true);
        const wav44k = Buffer.from(readFileSync(DEMO));
        wav44k.writeUInt32LE(44100, 24);
        expect(lib.isWhisperWav(wav44k)).toBe(false);
        expect(lib.isWhisperWav(Buffer.from("OggS"))).toBe(false);
        expect(lib.parseProgress("whisper_print_progress_callback: progress =  5%\nwhisper_print_progress_callback: progress =  40%")).toBe(40);
        expect(lib.parseProgress("whisper_print_timings: total time")).toBeNull();
    });

    const realCli = process.env.PHOENIX_TEST_WHISPER_CLI, realModel = process.env.PHOENIX_TEST_WHISPER_MODEL;
    it.skipIf(!realCli || !realModel)("transcribes the demo memo with the real whisper.cpp", async () => {
        const t = createTranscriber({ whisper: realCli, model: realModel, configFile: noConfig(), env: { PATH: process.env.PATH ?? "" } });
        const r = await t.transcribe({ path: memo });
        expect(r.returnValue).toBe(true);
        expect(String(r.text)).toMatch(/welcome to voice memos/i);
    }, 60000);
});
