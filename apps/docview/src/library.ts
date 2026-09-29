// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where each document was left, and the reading preferences, in the
// app's localStorage.

export interface Position {
    /** Chapter (EPUB), sheet (Excel) or slide (PowerPoint). */
    part: number;
    /** 0..1 through the part (pages or scrolling). */
    fraction: number;
    /** How many parts there are (for "34%"). */
    parts?: number;
    title?: string;
    at: number;
}

export interface Prefs {
    /** Text size in percent of the book's own. */
    fontScale: number;
    night: boolean;
    font: "book" | "serif" | "sans";
}

const POSITIONS_KEY = "org.webosphoenix.docview:positions";
const PREFS_KEY = "org.webosphoenix.docview:prefs";
const MAX_POSITIONS = 200;

export const FONT_SCALES = [80, 90, 100, 115, 130, 150, 175, 200];
export const DEFAULT_PREFS: Prefs = { fontScale: 100, night: false, font: "book" };

function read<T>(key: string, fallback: T): T {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
        return v ?? fallback;
    } catch {
        return fallback;
    }
}
function write(key: string, v: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full */ }
}

export function loadPositions(): Record<string, Position> {
    const v = read<Record<string, Position>>(POSITIONS_KEY, {});
    return v && typeof v === "object" ? v : {};
}

export function positionOf(target: string): Position | undefined {
    return loadPositions()[target];
}

export function savePosition(target: string, p: Omit<Position, "at">, now = Date.now()): void {
    const all = loadPositions();
    all[target] = { ...p, fraction: Math.max(0, Math.min(1, p.fraction || 0)), at: now };
    const keys = Object.keys(all);
    if (keys.length > MAX_POSITIONS) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_POSITIONS).forEach((k) => delete all[k]);
    write(POSITIONS_KEY, all);
}

/** How far through, 0..100 (whole parts plus the fraction of the current one). */
export function percentRead(p: Position | undefined): number {
    if (!p) return 0;
    const parts = Math.max(1, p.parts ?? 1);
    return Math.round(Math.min(1, (Math.min(p.part, parts - 1) + p.fraction) / parts) * 100);
}

export function loadPrefs(): Prefs {
    const p = read<Partial<Prefs>>(PREFS_KEY, {});
    return {
        fontScale: FONT_SCALES.includes(p.fontScale as number) ? (p.fontScale as number) : DEFAULT_PREFS.fontScale,
        night: !!p.night,
        font: p.font === "serif" || p.font === "sans" ? p.font : "book",
    };
}

export function savePrefs(p: Prefs): void {
    write(PREFS_KEY, p);
}

export function stepFont(scale: number, dir: 1 | -1): number {
    const i = FONT_SCALES.indexOf(scale);
    const at = i < 0 ? FONT_SCALES.indexOf(100) : i;
    return FONT_SCALES[Math.max(0, Math.min(FONT_SCALES.length - 1, at + dir))];
}

/** Page n (0-based) of `pages` from a fraction, and back. */
export function pageFromFraction(fraction: number, pages: number): number {
    if (pages <= 1) return 0;
    return Math.max(0, Math.min(pages - 1, Math.round(fraction * (pages - 1))));
}
export function fractionFromPage(page: number, pages: number): number {
    return pages <= 1 ? 0 : page / (pages - 1);
}
