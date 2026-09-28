// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Number, time and duration formatting for Phone and Messaging (en-US for now,
// like the rest of Phoenix; the webOS phone app used the Globalization
// framework's phone number formatter).

/** Pretty-print a dialled string as the user types it: "4085550142" -> "(408) 555-0142". */
export function formatNumber(raw: string): string {
    const s = raw.trim();
    if (!s || /[^0-9+\-() .]/.test(s)) return s;     // *, #, pauses: leave as typed
    const plus = s.startsWith("+");
    const d = s.replace(/[^0-9]/g, "");
    if (plus) {
        if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
        return "+" + d;
    }
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length <= 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === "1") return `1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    return d;
}

/** Only what the phone can dial: digits, + * # and pauses. */
export function dialable(raw: string): string {
    return raw.replace(/[^0-9+*#,pw]/gi, "");
}

/** Call duration: "0:07", "4:12", "1:02:09". */
export function formatDuration(ms: number): string {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function uses24h(): boolean {
    return (globalThis as { PalmSystem?: { timeFormat?: string } }).PalmSystem?.timeFormat === "HH24";
}

/** "9:41 AM" (or "09:41" with the 24-hour clock preference). */
export function formatTime(ts: number, h24 = uses24h()): string {
    const d = new Date(ts);
    if (h24) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const h = d.getHours() % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Days between ts and now, by calendar day (0 = today). */
export function daysAgo(ts: number, now = Date.now()): number {
    return Math.round((startOfDay(now) - startOfDay(ts)) / 86400000);
}

/** Divider caption for a day: "Today", "Yesterday", "Monday", "Sep 12". */
export function dayLabel(ts: number, now = Date.now()): string {
    const n = daysAgo(ts, now);
    if (n <= 0) return "Today";
    if (n === 1) return "Yesterday";
    const d = new Date(ts);
    if (n < 7) return DAYS[d.getDay()];
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Compact time for a list row: today's time, else "Yesterday", weekday or date. */
export function shortWhen(ts: number, now = Date.now()): string {
    return daysAgo(ts, now) <= 0 ? formatTime(ts) : dayLabel(ts, now);
}
