// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Recently opened documents and where each was left (page and zoom), in
// the app's localStorage.

export interface Recent {
    /** File path or web address. */
    target: string;
    title: string;
    /** 1-based. */
    page: number;
    pages?: number;
    zoom: number;
    at: number;
}

const KEY = "org.webosphoenix.pdfview:recents";
const MAX = 30;

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function loadRecents(): Recent[] {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Recent[];
        return Array.isArray(v) ? v.filter((r) => r && typeof r.target === "string") : [];
    } catch {
        return [];
    }
}

export function recentFor(target: string): Recent | undefined {
    return loadRecents().find((r) => r.target === target);
}

export function saveRecent(r: Omit<Recent, "at">, now = Date.now()): Recent[] {
    const list = [{ ...r, at: now }, ...loadRecents().filter((x) => x.target !== r.target)].slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full */ }
    return list;
}

export function forgetRecent(target: string): Recent[] {
    const list = loadRecents().filter((x) => x.target !== target);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
    return list;
}

export function clampZoom(z: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 100) / 100));
}

/** The next zoom step in or out from `z`. */
export function stepZoom(z: number, dir: 1 | -1): number {
    if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.01) ?? MAX_ZOOM;
    return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.01) ?? MIN_ZOOM;
}

/** The page most in view: the last one whose top is above the middle of the view. */
export function pageInView(tops: number[], scrollTop: number, viewHeight: number): number {
    const mid = scrollTop + viewHeight / 3;
    let page = 0;
    for (let i = 0; i < tops.length; ++i) if (tops[i] <= mid) page = i;
    return page;
}
