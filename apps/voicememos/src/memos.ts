// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Voice memos as db8 objects (org.webosphoenix.voicememo:1, the kind in
// public/configuration/db/kinds) and the rules for naming, listing and
// searching them. The audio is a WAV file under /media/internal/voicememos;
// the object holds its title, date, length and transcript, and searchText
// (title and transcript), which the app and Just Type (the "dbsearch" in
// appinfo.json) search.

import { MEDIA_ROOT, type DbObject, type Transcript } from "@phoenix/luna";
import { dayLabel } from "@phoenix/ui";

export const MEMO_KIND = "org.webosphoenix.voicememo:1";
export const MEMO_DIR = MEDIA_ROOT + "/voicememos";
export const MEMO_MIME = "audio/wav";

export interface MemoTranscript extends Transcript {
    /** When it was made (ISO). */
    time?: string;
}

export interface Memo extends DbObject {
    _id: string;
    title: string;
    /** The WAV file. */
    path: string;
    /** Seconds. */
    duration: number;
    /** Bytes. */
    size?: number;
    /** When it was recorded (ISO 8601, UTC); sorts by time as a string. */
    created: string;
    mimeType: string;
    transcript?: MemoTranscript;
    /** What the browser's speech recognition heard while recording (simulator). */
    liveText?: string;
    /** Title and transcript, lower-case: the Just Type search index. */
    searchText: string;
    /** One of the demo memos the app installs on first start. */
    sample?: boolean;
}

/** memo-20260928-101500.wav (local time), with -2, -3... if taken. */
export function memoFileName(date: Date, taken: Iterable<string>): string {
    const p = (n: number) => String(n).padStart(2, "0");
    const stem = `memo-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
    const names = new Set([...taken].map((t) => t.replace(/^.*\//, "")));
    let name = stem + ".wav";
    for (let i = 2; names.has(name); i++) name = `${stem}-${i}.wav`;
    return name;
}

/** "Memo 3": one more than the highest "Memo N" so far. */
export function nextTitle(memos: Pick<Memo, "title">[]): string {
    let max = 0;
    for (const m of memos) {
        const r = /^Memo (\d+)$/.exec(m.title.trim());
        if (r) max = Math.max(max, parseInt(r[1], 10));
    }
    return `Memo ${max + 1}`;
}

/** Transcript text worth showing and searching (not the simulator's placeholder). */
export function spokenText(t: Transcript | undefined): string {
    return t && !t.placeholder ? t.text : "";
}

/** The searchText of a memo: title and transcript, lower-case. */
export function searchTextOf(title: string, transcript?: Transcript): string {
    return [title, spokenText(transcript)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every word of the query starts a word of the title or transcript. */
export function matches(memo: Pick<Memo, "title" | "transcript">, query: string): boolean {
    const words = query.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    if (!words.length) return true;
    const have = searchTextOf(memo.title, memo.transcript).split(/[^\p{L}\p{N}']+/u);
    return words.every((w) => have.some((h) => h.startsWith(w)));
}

/** Newest first. */
export function sortMemos<T extends Pick<Memo, "created" | "_id">>(memos: T[]): T[] {
    return memos.slice().sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : a._id < b._id ? 1 : -1));
}

/** Memos under day dividers ("Today", "Yesterday", "Monday", "Sep 12"), newest first. */
export function byDay<T extends Pick<Memo, "created" | "_id">>(memos: T[], now = Date.now()): { day: string; memos: T[] }[] {
    const out: { day: string; memos: T[] }[] = [];
    for (const m of sortMemos(memos)) {
        const day = dayLabel(Date.parse(m.created), now);
        const last = out[out.length - 1];
        if (last && last.day === day) last.memos.push(m);
        else out.push({ day, memos: [m] });
    }
    return out;
}

/** A few words of the transcript around the first match of the query (or its start). */
export function snippet(text: string, query = "", length = 80): string {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= length) return t;
    const first = query.toLowerCase().split(/\s+/).filter(Boolean)[0];
    const at = first ? t.toLowerCase().indexOf(first) : -1;
    const start = at > length / 2 ? t.lastIndexOf(" ", at - length / 3) + 1 : 0;
    const cut = t.slice(start, start + length).replace(/\s+\S*$/, "");
    return (start > 0 ? "…" : "") + cut + "…";
}

// ---- Preferences (the app's localStorage, like Files') ------------------------------------

export interface Prefs {
    /** Transcribe each new recording as soon as it is saved. */
    autoTranscribe: boolean;
    /** Spoken language for the transcriber ("en", "de", ... or "auto"). */
    language: string;
}

const PREFS_KEY = "org.webosphoenix.voicememos.prefs";
export const DEFAULT_PREFS: Prefs = { autoTranscribe: false, language: "en" };

export function loadPrefs(): Prefs {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
        return {
            autoTranscribe: typeof p.autoTranscribe === "boolean" ? p.autoTranscribe : DEFAULT_PREFS.autoTranscribe,
            language: typeof p.language === "string" && /^(auto|[a-z]{2,3})$/.test(p.language) ? p.language : DEFAULT_PREFS.language,
        };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export function savePrefs(p: Prefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** The languages the preferences offer (whisper.cpp's multilingual models know them; base.en is English only). */
export const LANGUAGES: { value: string; label: string }[] = [
    { value: "en", label: "English" },
    { value: "auto", label: "Detect" },
    { value: "de", label: "Deutsch" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "it", label: "Italiano" },
];
