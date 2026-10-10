// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { VideoItem } from "@phoenix/luna";
import { durationLabel, forgetPosition, loadPositions, loadPrefs, progressOf, resumeAt, savePosition, savePrefs, sortVideos, titleOf } from "./library";
import { cueText, parseSubtitles, parseTime, pickTrack, subtitleTracks } from "./subtitles";
import { isBlank } from "./Poster";

const SAMPLES = resolve(__dirname, "../../media-samples/media/videos");

describe("subtitles", () => {
    it("reads times in SRT and WebVTT form", () => {
        expect(parseTime("00:01:02,500")).toBe(62.5);
        expect(parseTime("01:02.25")).toBe(62.25);
        expect(parseTime("1:00:00.000")).toBe(3600);
        expect(parseTime("nonsense")).toBeNaN();
    });

    it("parses the demo WebVTT and SRT files", () => {
        const vtt = parseSubtitles(readFileSync(resolve(SAMPLES, "harbor-timelapse.en.vtt"), "utf8"));
        expect(vtt).toHaveLength(4);
        expect(vtt[0]).toEqual({ start: 1, end: 4.5, text: "The harbor at dusk." });
        const srt = parseSubtitles(readFileSync(resolve(SAMPLES, "card-shuffle.srt"), "utf8"));
        expect(srt.map((c) => c.text)).toEqual(["Every app is a card.", "Drag cards together to stack them,", "and flick one up to close it."]);
    });

    it("drops markup, cue settings, notes and bad cues, and handles CRLF", () => {
        const cues = parseSubtitles("﻿WEBVTT\r\n\r\nNOTE hello\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n" +
            "intro\r\n00:00.000 --> 00:02.000 align:start position:10%\r\n<v Ada>Hello <i>there</i> &amp; welcome\r\n\r\n" +
            "00:05.000 --> 00:03.000\r\nbackwards\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Top line\r\nSecond line\r\n");
        expect(cues).toEqual([
            { start: 0, end: 2, text: "Ada: Hello there & welcome" },
            { start: 3, end: 4, text: "Top line\nSecond line" },
        ]);
    });

    it("finds the text on screen at a time, overlapping cues together", () => {
        const cues = [{ start: 0, end: 3, text: "one" }, { start: 2, end: 5, text: "two" }, { start: 6, end: 7, text: "three" }];
        expect(cueText(cues, 2.5)).toBe("one\ntwo");
        expect(cueText(cues, 5.5)).toBe("");
        expect(cueText(cues, 6)).toBe("three");
    });

    it("finds the subtitle files beside a video, by language", () => {
        const dir = "/media/internal/Movies/";
        const tracks = subtitleTracks(dir + "Trip.mp4", [dir + "Trip.mp4", dir + "trip.srt", dir + "Trip.es.vtt", dir + "Trip.de.srt", dir + "Trip.forced.srt", dir + "Other.srt", dir + "Trip.txt"]);
        expect(tracks.map((t) => [t.label, t.language])).toEqual([["Subtitles", undefined], ["forced", undefined], ["German", "de"], ["Spanish", "es"]]);
    });

    it("picks the track to show, and Captions keeps one on", () => {
        const dir = "/media/internal/Movies/";
        const es = subtitleTracks(dir + "Trip.mp4", [dir + "Trip.es.vtt", dir + "Trip.de.srt"]);
        expect(pickTrack(es, "de")?.language).toBe("de");
        expect(pickTrack(es, "*")?.language).toBe("de");
        expect(pickTrack(es, "")).toBeNull();
        expect(pickTrack(es, "fr")).toBeNull();
        // Settings > Accessibility > Captions.
        expect(pickTrack(es, "", true)?.language).toBe("de");
        expect(pickTrack(es, "fr", true)?.language).toBe("de");
        expect(pickTrack(es, "es", true)?.language).toBe("es");
        expect(pickTrack([], "", true)).toBeNull();
    });
});

describe("library and resume", () => {
    beforeEach(() => localStorage.clear());
    const v = (file: string, title: string | undefined, date: string, duration = 60): VideoItem =>
        ({ uri: "storage://" + file, file_path: file, title, last_modified_date: date, duration });

    it("sorts by date or name and names untitled videos after their file", () => {
        const items = [v("/m/b.webm", "Beach", "2024-01-01T00:00:00Z"), v("/m/clip-2.mp4", undefined, "2025-01-01T00:00:00Z"), v("/m/a.webm", "Alps", "2023-01-01T00:00:00Z")];
        expect(sortVideos(items, "date").map(titleOf)).toEqual(["clip-2", "Beach", "Alps"]);
        expect(sortVideos(items, "name").map(titleOf)).toEqual(["Alps", "Beach", "clip-2"]);
    });

    it("remembers where a video was left, and starts over near either end", () => {
        savePosition("/m/a.webm", 42, 100, 1000);
        expect(resumeAt(loadPositions()["/m/a.webm"])).toBe(42);
        expect(progressOf(loadPositions()["/m/a.webm"])).toBeCloseTo(0.42);
        savePosition("/m/b.webm", 3, 100);
        expect(resumeAt(loadPositions()["/m/b.webm"])).toBe(0);
        savePosition("/m/c.webm", 98, 100);
        const c = loadPositions()["/m/c.webm"];
        expect(c.watched).toBe(true);
        expect(resumeAt(c)).toBe(0);
        forgetPosition("/m/a.webm");
        expect(loadPositions()["/m/a.webm"]).toBeUndefined();
    });

    it("keeps preferences", () => {
        expect(loadPrefs()).toEqual({ sort: "date", fill: false, subtitles: "*" });
        savePrefs({ sort: "name", fill: true, subtitles: "es" });
        expect(loadPrefs()).toEqual({ sort: "name", fill: true, subtitles: "es" });
    });

    it("labels lengths", () => {
        expect(durationLabel(20)).toBe("20 s");
        expect(durationLabel(65)).toBe("1:05");
        expect(durationLabel(3723)).toBe("1:02:03");
        expect(durationLabel(undefined)).toBe("");
    });
});

describe("posters", () => {
    const pixels = (r: number, g: number, b: number) => {
        const d = new Uint8ClampedArray(4 * 16);
        for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
        return d;
    };
    it("takes an undecoded (black) frame for blank, so it is drawn again and not kept", () => {
        expect(isBlank(pixels(0, 0, 0))).toBe(true);
        expect(isBlank(pixels(1, 2, 1))).toBe(true);
        expect(isBlank(pixels(40, 30, 60))).toBe(false);
    });
});
