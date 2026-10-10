// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Subtitles: SubRip (.srt) and WebVTT (.vtt) files beside the video, as
// desktop players find them ("film.srt", "film.en.srt", "film.es.vtt").
// They are parsed here and drawn over the video by the player, so SRT
// works as well as VTT (the <track> element only takes WebVTT) and the
// look is the same everywhere.

export interface Cue {
    /** Seconds. */
    start: number;
    end: number;
    /** Plain text; lines separated by "\n". */
    text: string;
}

export interface SubtitleTrack {
    path: string;
    /** "English", "Spanish (es)", or the file name when no language is given. */
    label: string;
    /** BCP 47 code from the file name ("es"), if any. */
    language?: string;
}

/** "00:01:02,500", "01:02.500", "1:02:03.5" -> seconds; NaN when it is not a time. */
export function parseTime(s: string): number {
    const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(s);
    if (!m) return NaN;
    const frac = m[4] ? Number(m[4].padEnd(3, "0")) / 1000 : 0;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

/** Drop markup the player does not draw: <i>, <b>, <c.class>, <v Speaker>, {\an8}. */
function plain(text: string): string {
    return text
        .replace(/<v\s+([^>]+)>/gi, "$1: ")
        .replace(/<[^>]*>/g, "")
        .replace(/\{\\[^}]*\}/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .trim();
}

/** Cues of an SRT or WebVTT file, sorted by start. Bad blocks are skipped. */
export function parseSubtitles(text: string): Cue[] {
    const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const blocks = src.split(/\n{2,}/);
    const cues: Cue[] = [];
    for (const block of blocks) {
        const lines = block.split("\n").filter((l, i) => i > 0 || l.trim() !== "");
        const at = lines.findIndex((l) => l.includes("-->"));
        if (at < 0) continue;   // WEBVTT header, NOTE, STYLE, REGION, or noise
        const [a, rest = ""] = lines[at].split("-->");
        const start = parseTime(a);
        const end = parseTime(rest.trim().split(/\s+/)[0] ?? "");
        if (!isFinite(start) || !isFinite(end) || end < start) continue;
        const body = plain(lines.slice(at + 1).join("\n"));
        if (body) cues.push({ start, end, text: body });
    }
    return cues.sort((x, y) => x.start - y.start || x.end - y.end);
}

/** The text on screen at `t` (several cues may overlap), or "". */
export function cueText(cues: Cue[], t: number): string {
    const on: string[] = [];
    for (const c of cues) {
        if (c.start > t) break;
        if (t < c.end) on.push(c.text);
    }
    return on.join("\n");
}

function languageName(code: string): string {
    try {
        const names = new Intl.DisplayNames(["en"], { type: "language" });
        const n = names.of(code);
        if (n && n.toLowerCase() !== code.toLowerCase()) return n;
    } catch { /* no Intl.DisplayNames */ }
    return code.toUpperCase();
}

const SUB_EXT = /\.(srt|vtt)$/i;

/**
 * The subtitle files for a video among the names in its folder:
 * "stem.srt", "stem.vtt", "stem.<lang>.srt" ... The untagged one first,
 * then by language name.
 */
export function subtitleTracks(videoPath: string, folderPaths: string[]): SubtitleTrack[] {
    const name = videoPath.replace(/^.*\//, "");
    const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
    const tracks: SubtitleTrack[] = [];
    for (const p of folderPaths) {
        const n = p.replace(/^.*\//, "");
        if (!SUB_EXT.test(n)) continue;
        const base = n.replace(SUB_EXT, "");
        if (base.toLowerCase() === stem) {
            tracks.push({ path: p, label: "Subtitles" });
        } else if (base.toLowerCase().startsWith(stem + ".")) {
            const tag = base.slice(stem.length + 1);
            const lang = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag) ? tag : undefined;
            tracks.push({ path: p, label: lang ? languageName(lang) : tag, language: lang });
        }
    }
    const untagged = (t: SubtitleTrack) => (t.label === "Subtitles" ? 0 : 1);
    return tracks.sort((a, b) => untagged(a) - untagged(b) || a.label.localeCompare(b.label));
}

/**
 * The track to show when a video opens: the language chosen last time
 * ("" off, "*" any), else one without a language, else (for "*") the
 * first. With Settings > Accessibility > Captions on (system preference
 * `accessibility.captions`), a video that has subtitles always shows some:
 * turned off in the player, or the language missing, the first is shown.
 */
export function pickTrack(found: SubtitleTrack[], want: string, captions = false): SubtitleTrack | null {
    if (want === "") return captions && found.length ? found[0] : null;
    return found.find((t) => (t.language ?? "*") === want) ?? found.find((t) => !t.language)
        ?? (want === "*" || captions ? found[0] : null) ?? null;
}
