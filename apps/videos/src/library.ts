// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The video library (com.webos.service.mediaindexer getVideoList) and where
// each video was left off. Positions are kept in the app's localStorage,
// by path, as the webOS 2.x video player kept its bookmark.

import type { VideoItem } from "@phoenix/luna";

export type SortKey = "date" | "name";

export interface Resume {
    /** Seconds. */
    position: number;
    duration: number;
    /** Played to the end (a check mark in the library). */
    watched?: boolean;
    /** When it was last played (ms). */
    at: number;
}

const POSITIONS_KEY = "org.webosphoenix.videos:positions";
const PREFS_KEY = "org.webosphoenix.videos:prefs";
/** Resuming within this many seconds of the start or the end starts over instead. */
export const RESUME_MARGIN = 5;
/** Remembered positions kept. */
const MAX_POSITIONS = 200;

export function titleOf(v: Pick<VideoItem, "title" | "file_path">): string {
    return v.title || v.file_path.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
}

const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { sensitivity: "base", numeric: true }) : null;

export function sortVideos(items: VideoItem[], key: SortKey): VideoItem[] {
    const date = (v: VideoItem) => Date.parse(v.last_modified_date ?? "") || 0;
    const name = (a: VideoItem, b: VideoItem) => (collator ? collator.compare(titleOf(a), titleOf(b)) : titleOf(a).localeCompare(titleOf(b)));
    return [...items].sort((a, b) => (key === "date" ? date(b) - date(a) || name(a, b) : name(a, b)));
}

function readAll(): Record<string, Resume> {
    try {
        const v = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}") as Record<string, Resume>;
        return v && typeof v === "object" ? v : {};
    } catch {
        return {};
    }
}

export function loadPositions(): Record<string, Resume> {
    return readAll();
}

export function savePosition(path: string, position: number, duration: number, now = Date.now()): Resume {
    const all = readAll();
    const watched = duration > 0 && position >= duration - RESUME_MARGIN;
    const r: Resume = { position: watched ? 0 : position, duration, watched: watched || all[path]?.watched, at: now };
    all[path] = r;
    const keys = Object.keys(all);
    if (keys.length > MAX_POSITIONS) {
        keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_POSITIONS).forEach((k) => delete all[k]);
    }
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(all)); } catch { /* full */ }
    return r;
}

export function forgetPosition(path: string): void {
    const all = readAll();
    delete all[path];
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/** Where to start: the saved position, unless it is too close to either end. */
export function resumeAt(r: Resume | undefined, duration = r?.duration ?? 0): number {
    if (!r || r.position < RESUME_MARGIN) return 0;
    if (duration > 0 && r.position > duration - RESUME_MARGIN) return 0;
    return r.position;
}

/** 0..1 of the way through, for the library's progress bar (0 when not started or watched). */
export function progressOf(r: Resume | undefined, duration?: number): number {
    const d = duration || r?.duration || 0;
    if (!r || !d || r.position <= 0) return 0;
    return Math.max(0, Math.min(1, r.position / d));
}

export interface Prefs {
    sort: SortKey;
    /** Fill the screen (crop) instead of fitting the whole picture. */
    fill: boolean;
    /** Subtitle language last chosen ("" off, "*" the untagged file). */
    subtitles: string;
}

export function loadPrefs(): Prefs {
    const base: Prefs = { sort: "date", fill: false, subtitles: "*" };
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
        if (!p) return base;
        return { sort: p.sort === "name" ? "name" : "date", fill: !!p.fill, subtitles: typeof p.subtitles === "string" ? p.subtitles : "*" };
    } catch {
        return base;
    }
}

export function savePrefs(p: Prefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** "20 s", "1:05", "1:02:03" for the library. */
export function durationLabel(seconds?: number): string {
    if (!seconds || !isFinite(seconds)) return "";
    const s = Math.round(seconds);
    if (s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + ":" + String(r).padStart(2, "0");
}
