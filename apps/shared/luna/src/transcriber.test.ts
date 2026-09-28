// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The transcriber client against the simulated org.webosphoenix.transcriber
// in runtime/phoenix-runtime.js ("Voice memos"): the demo memos get their
// known scripts, any other recording only the placeholder.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, LunaError } from "./bridge";
import { mediaFiles } from "./media";
import { TRANSCRIBE_ERRORS, transcriber, type TranscribeProgress } from "./transcriber";

const SAMPLES = resolve(__dirname, "../../../voicememos/public/samples");
const samples = JSON.parse(readFileSync(resolve(SAMPLES, "samples.json"), "utf8")) as {
    memos: { file: string; path: string; text: string; segments: { start: number; end: number; text: string }[] }[];
};

beforeAll(() => {
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
    // jsdom has no rootfs to read the app's samples.json from.
    const ps = (window as unknown as { PalmSystem: { getResource(p: string): string | undefined } }).PalmSystem;
    const base = ps.getResource.bind(ps);
    ps.getResource = (p) => p === "/usr/palm/applications/org.webosphoenix.voicememos/samples/samples.json"
        ? readFileSync(resolve(SAMPLES, "samples.json"), "utf8") : base(p);
});

beforeEach(() => localStorage.clear());

const wav = (file: string) => new Blob([readFileSync(resolve(SAMPLES, file))], { type: "audio/wav" });

describe("simulated org.webosphoenix.transcriber", () => {
    it("knows the demo memos' scripts, under any name, with progress", async () => {
        const demo = samples.memos[0];
        const path = "/media/internal/voicememos/renamed.wav";
        await mediaFiles.write(path, wav(demo.file));
        const steps: TranscribeProgress[] = [];
        const t = await transcriber.transcribe(path, "en", (p) => steps.push(p));
        expect(t.text).toBe(demo.text);
        expect(t.text).toMatch(/^Welcome to Voice Memos\./);
        expect(t.segments).toEqual(demo.segments);
        expect(t).toMatchObject({ language: "en", engine: "simulator" });
        expect(t.placeholder).toBeUndefined();
        expect(steps[0]).toEqual({ state: "queued", progress: 0 });
        expect(steps.map((s) => s.progress)).toEqual([0, 20, 45, 70, 90]);
    });

    it("never makes up a transcript of a recording", async () => {
        const path = "/media/internal/voicememos/memo-20260928-101500.wav";
        const bytes = new Uint8Array(readFileSync(resolve(SAMPLES, samples.memos[1].file)));
        bytes[bytes.length - 1] ^= 1;   // one sample different: not the demo any more
        await mediaFiles.write(path, new Blob([bytes], { type: "audio/wav" }));
        const t = await transcriber.transcribe(path);
        expect(t).toMatchObject({ text: "(transcription runs on the device with whisper.cpp)", segments: [], placeholder: true, engine: "simulator" });
        // Without subscribe there is one reply, the result.
        const r = await call("luna://org.webosphoenix.transcriber/transcribe", { path });
        expect(r).toMatchObject({ returnValue: true, state: "done", placeholder: true });
    });

    it("reports a missing file and bad parameters", async () => {
        const missing = await transcriber.transcribe("/media/internal/voicememos/none.wav").catch((e) => e as LunaError);
        expect(missing).toBeInstanceOf(LunaError);
        expect((missing as LunaError).errorCode).toBe(TRANSCRIBE_ERRORS.NOT_FOUND);
        const bad = await call("luna://org.webosphoenix.transcriber/transcribe", { path: "memo.wav" }).catch((e) => e as LunaError);
        expect((bad as LunaError).errorCode).toBe(TRANSCRIBE_ERRORS.BAD_PARAMS);
    });

    it("says it is the simulator", async () => {
        expect(await transcriber.status()).toMatchObject({ engine: "simulator", installed: true, live: false });
        // jsdom has no speech recognition: listen fails at once.
        const err = await new Promise<LunaError>((res) => { transcriber.listen("en", () => {}, res); });
        expect(err.errorCode).toBe(TRANSCRIBE_ERRORS.ENGINE_NOT_INSTALLED);
    });
});
