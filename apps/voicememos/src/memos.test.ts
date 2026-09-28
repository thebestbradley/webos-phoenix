// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
    byDay, DEFAULT_PREFS, loadPrefs, matches, memoFileName, nextTitle, savePrefs, searchTextOf, snippet, sortMemos, spokenText, type Memo,
} from "./memos";
import { encodeWav, levelOf, wavInfo } from "./wav";

const memo = (over: Partial<Memo>): Memo => ({
    _id: "m", _kind: "org.webosphoenix.voicememo:1", title: "Memo 1", path: "/media/internal/voicememos/a.wav",
    duration: 3, created: "2026-09-28T10:00:00.000Z", mimeType: "audio/wav", searchText: "", ...over,
});

describe("memos", () => {
    it("names files by the time they were recorded", () => {
        const d = new Date(2026, 8, 28, 10, 15, 3);
        expect(memoFileName(d, [])).toBe("memo-20260928-101503.wav");
        expect(memoFileName(d, ["/media/internal/voicememos/memo-20260928-101503.wav"])).toBe("memo-20260928-101503-2.wav");
        expect(memoFileName(d, ["memo-20260928-101503.wav", "memo-20260928-101503-2.wav"])).toBe("memo-20260928-101503-3.wav");
    });

    it("titles a new memo one past the highest \"Memo N\"", () => {
        expect(nextTitle([])).toBe("Memo 1");
        expect(nextTitle([{ title: "Memo 2" }, { title: "Shopping list" }, { title: "Memo 9" }, { title: "Memo 10 draft" }])).toBe("Memo 10");
    });

    it("searches titles and transcripts, but not the simulator's placeholder", () => {
        const t = { text: "Remember to pick up coffee beans and batteries.", segments: [] };
        expect(searchTextOf("Shopping list", t)).toBe("shopping list remember to pick up coffee beans and batteries.");
        const m = memo({ title: "Shopping list", transcript: t });
        expect(matches(m, "")).toBe(true);
        expect(matches(m, "coffee")).toBe(true);
        expect(matches(m, "SHOP batt")).toBe(true);
        expect(matches(m, "offee")).toBe(false);
        expect(matches(m, "coffee tea")).toBe(false);
        const placeholder = { text: "(transcription runs on the device with whisper.cpp)", segments: [], placeholder: true };
        expect(spokenText(placeholder)).toBe("");
        expect(searchTextOf("Memo 3", placeholder)).toBe("memo 3");
        expect(matches(memo({ transcript: placeholder }), "whisper")).toBe(false);
    });

    it("lists newest first under day dividers", () => {
        const now = new Date(2026, 8, 28, 12, 0).getTime();
        const a = memo({ _id: "a", created: new Date(2026, 8, 28, 9, 0).toISOString() });
        const b = memo({ _id: "b", created: new Date(2026, 8, 27, 18, 0).toISOString() });
        const c = memo({ _id: "c", created: new Date(2026, 8, 28, 11, 0).toISOString() });
        const d = memo({ _id: "d", created: new Date(2026, 8, 1, 8, 0).toISOString() });
        expect(sortMemos([a, b, c, d]).map((m) => m._id)).toEqual(["c", "a", "b", "d"]);
        expect(byDay([a, b, c, d], now).map((g) => [g.day, g.memos.map((m) => m._id).join("")])).toEqual([
            ["Today", "ca"], ["Yesterday", "b"], ["Sep 1", "d"],
        ]);
    });

    it("cuts a snippet around the search", () => {
        const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen coffee sixteen seventeen";
        expect(snippet("short text")).toBe("short text");
        expect(snippet(long, "", 30)).toBe("one two three four five six…");
        const s = snippet(long, "coffee", 30);
        expect(s.startsWith("…")).toBe(true);
        expect(s).toContain("coffee");
    });

    describe("preferences", () => {
        beforeEach(() => localStorage.clear());
        it("default to manual transcription in English and are kept", () => {
            expect(loadPrefs()).toEqual(DEFAULT_PREFS);
            savePrefs({ autoTranscribe: true, language: "de" });
            expect(loadPrefs()).toEqual({ autoTranscribe: true, language: "de" });
            localStorage.setItem("org.webosphoenix.voicememos.prefs", JSON.stringify({ autoTranscribe: "yes", language: "x; rm" }));
            expect(loadPrefs()).toEqual(DEFAULT_PREFS);
        });
    });
});

describe("wav", () => {
    it("writes 16 kHz mono 16-bit PCM that reads back", () => {
        const samples = new Float32Array(16000 * 2);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 10) * 0.5;
        samples[0] = 2;       // clipped
        samples[1] = -2;
        const wav = encodeWav(samples);
        expect(wav.length).toBe(44 + samples.length * 2);
        expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
        expect(wavInfo(wav)).toEqual({ rate: 16000, channels: 1, bits: 16, duration: 2 });
        const v = new DataView(wav.buffer);
        expect(v.getInt16(44, true)).toBe(32767);
        expect(v.getInt16(46, true)).toBe(-32768);
        expect(wavInfo(new Uint8Array(10))).toBeNull();
    });

    it("measures the level on a decibel scale", () => {
        expect(levelOf(new Float32Array(512))).toBe(0);
        const loud = new Float32Array(512).fill(1);
        expect(levelOf(loud)).toBe(1);
        const quiet = new Float32Array(512).fill(0.01);   // -40 dBFS
        expect(levelOf(quiet)).toBeCloseTo(14 / 54, 2);
    });
});
