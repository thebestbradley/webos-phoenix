// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Apple Notes' note list: Pinned first, then sections by date (Today,
// Yesterday, Previous 7 Days, Previous 30 Days, then months of this year,
// then years), and its short dates (a time today, a weekday this week).

import { summarize } from "./markdown";
import type { Note, SortOrder } from "./model";

export interface Section {
    title: string;
    notes: Note[];
}

function dayStart(t: number): number {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function dateOf(n: Note, sort: SortOrder): number {
    return sort === "created" ? n.createdAt : n.modifiedAt;
}

export function sortNotes(notes: readonly Note[], sort: SortOrder): Note[] {
    const out = notes.slice();
    if (sort === "title") {
        const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
        const titles = new Map(out.map((n) => [n._id, summarize(n.body).title]));
        out.sort((a, b) => collator.compare(titles.get(a._id)!, titles.get(b._id)!) || b.modifiedAt - a.modifiedAt);
    } else {
        out.sort((a, b) => dateOf(b, sort) - dateOf(a, sort));
    }
    return out;
}

function sectionTitle(t: number, now: number, locale?: string): string {
    const today = dayStart(now);
    const day = dayStart(t);
    const days = Math.round((today - day) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return "Previous 7 Days";
    if (days < 30) return "Previous 30 Days";
    const d = new Date(t);
    if (d.getFullYear() === new Date(now).getFullYear())
        return d.toLocaleDateString(locale, { month: "long" });
    return String(d.getFullYear());
}

/**
 * The list's sections. Sorted by title there are no date sections, as in
 * Apple Notes: only Pinned and Notes.
 */
export function groupNotes(notes: readonly Note[], sort: SortOrder, now: number, byDate = true, locale?: string): Section[] {
    const sorted = sortNotes(notes, sort);
    const pinned = sorted.filter((n) => n.pinned);
    const rest = sorted.filter((n) => !n.pinned);
    const out: Section[] = [];
    if (pinned.length) out.push({ title: "Pinned", notes: pinned });
    if (sort === "title" || !byDate) {
        if (rest.length) out.push({ title: pinned.length ? "Notes" : "", notes: rest });
        return out;
    }
    for (const n of rest) {
        const title = sectionTitle(dateOf(n, sort), now, locale);
        const last = out[out.length - 1];
        if (last && last.title === title && last.title !== "Pinned") last.notes.push(n);
        else out.push({ title, notes: [n] });
    }
    return out;
}

/** The date in a list row: 9:41 AM today, Yesterday, a weekday, then a date. */
export function shortDate(t: number, now: number, locale?: string): string {
    const days = Math.round((dayStart(now) - dayStart(t)) / 86400000);
    if (days <= 0) return new Date(t).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    if (days === 1) return "Yesterday";
    if (days < 7) return new Date(t).toLocaleDateString(locale, { weekday: "long" });
    return new Date(t).toLocaleDateString(locale, { year: "2-digit", month: "numeric", day: "numeric" });
}

/** The date above the note: "29 September 2026 at 9:41 PM". */
export function longDate(t: number, locale?: string): string {
    const d = new Date(t);
    const date = d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
    const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    return `${date} at ${time}`;
}
