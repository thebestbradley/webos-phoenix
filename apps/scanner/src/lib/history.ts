// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The scan history and the preferences, in the app's localStorage (on
// the device only). Authenticator keys are never kept (historyText()).

export interface Scan {
    id: string;
    /** The code's text as scanned (historyText: otpauth secrets removed). */
    text: string;
    /** zxing's format name ("QRCode", "EAN13", ...). */
    format: string;
    /** ms since the epoch. */
    at: number;
}

export interface Prefs {
    keepHistory: boolean;
}

export const MAX_HISTORY = 100;
const HISTORY_KEY = "org.webosphoenix.scanner.history";
const PREFS_KEY = "org.webosphoenix.scanner.prefs";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const ls = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

export function loadHistory(storage: Storage | undefined = ls()): Scan[] {
    try {
        const v = JSON.parse(storage?.getItem(HISTORY_KEY) ?? "[]");
        return Array.isArray(v)
            ? v.filter((s): s is Scan => !!s && typeof s.text === "string" && typeof s.at === "number" && typeof s.id === "string")
            : [];
    } catch {
        return [];
    }
}

export function saveHistory(list: readonly Scan[], storage: Storage | undefined = ls()): void {
    try { storage?.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch { /* full */ }
}

export function clearHistory(storage: Storage | undefined = ls()): void {
    try { storage?.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

/** Newest first; the same code scanned again moves to the top instead of repeating. */
export function addScan(list: readonly Scan[], scan: Omit<Scan, "id">): Scan[] {
    const rest = list.filter((s) => !(s.text === scan.text && s.format === scan.format));
    return [{ ...scan, id: `${scan.at.toString(36)}-${Math.random().toString(36).slice(2, 8)}` }, ...rest].slice(0, MAX_HISTORY);
}

export function loadPrefs(storage: Storage | undefined = ls()): Prefs {
    try {
        const p = JSON.parse(storage?.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
        return { keepHistory: p.keepHistory !== false };
    } catch {
        return { keepHistory: true };
    }
}

export function savePrefs(p: Prefs, storage: Storage | undefined = ls()): void {
    try { storage?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
