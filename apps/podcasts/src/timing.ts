// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Playback speed and the sleep timer.

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

export function nextSpeed(s: number): number {
    const i = SPEEDS.indexOf(s);
    return SPEEDS[(i < 0 ? 0 : i + 1) % SPEEDS.length];
}

/** "1×", "1.25×" */
export function speedLabel(s: number): string {
    return `${Number(s.toFixed(2))}×`;
}

/** Sleep timer choices: minutes, or "end" of the episode. */
export type SleepChoice = 0 | 5 | 15 | 30 | 45 | 60 | "end";
export const SLEEP_CHOICES: SleepChoice[] = [0, 5, 15, 30, 45, 60, "end"];

export interface SleepTimer {
    /** When to stop (ms), or null for the end of the episode. */
    until: number | null;
}

export function startSleep(choice: SleepChoice, now = Date.now()): SleepTimer | null {
    if (choice === 0) return null;
    return { until: choice === "end" ? null : now + choice * 60_000 };
}

export function sleepLabel(choice: SleepChoice): string {
    return choice === 0 ? "Off" : choice === "end" ? "End of episode" : `${choice} minutes`;
}

/** Time left on the timer: "14:59", "End", or "" when off. */
export function sleepRemaining(t: SleepTimer | null, now = Date.now()): string {
    if (!t) return "";
    if (t.until === null) return "End";
    const s = Math.max(0, Math.ceil((t.until - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function sleepDue(t: SleepTimer | null, now = Date.now()): boolean {
    return !!t && t.until !== null && now >= t.until;
}

/** "Sep 28", "Sep 28, 2025" (another year) */
export function episodeDate(ms: number, now = Date.now()): string {
    if (!ms) return "";
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "45 min", "1 h 5 min", "38 min left" */
export function durationText(seconds: number, position = 0): string {
    if (!seconds) return "";
    const left = position > 0 && position < seconds;
    const s = left ? seconds - position : seconds;
    const m = Math.max(1, Math.round(s / 60));
    const txt = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
    return left ? `${txt} left` : txt;
}
