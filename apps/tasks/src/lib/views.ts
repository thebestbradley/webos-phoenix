// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the Tasks views show, apart from drawing: which tasks are due today,
// upcoming or overdue, the order they are listed in, the counts next to
// each list, and the date arithmetic behind the date and time pickers.
// Everything takes `now` so tests can pin the clock.

import { PRIORITY, type Task, type TaskList } from "@phoenix/luna";

export type ViewId = "today" | "upcoming" | "overdue";

/** What the right-hand (or only) pane shows. */
export type Selection = { kind: "view"; view: ViewId } | { kind: "list"; listId: string };

export const VIEWS: { id: ViewId; title: string }[] = [
    { id: "today", title: "Today" },
    { id: "upcoming", title: "Upcoming" },
    { id: "overdue", title: "Overdue" },
];

/** Local midnight of the day `ms` falls on. */
export function startOfDay(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight `days` days after the day of `ms` (DST safe). */
export function addDays(ms: number, days: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Past due and not done: an all-day task from the next day on, a timed one from its time. */
export function isOverdue(t: Task, now: number): boolean {
    if (t.completed || !t.due) return false;
    return t.allDay ? startOfDay(t.due) < startOfDay(now) : t.due < now;
}

export function isDueToday(t: Task, now: number): boolean {
    return !!t.due && startOfDay(t.due) === startOfDay(now);
}

/** Due after today. */
export function isUpcoming(t: Task, now: number): boolean {
    return !!t.due && startOfDay(t.due) > startOfDay(now);
}

export function inView(t: Task, view: ViewId, now: number): boolean {
    return view === "today" ? isDueToday(t, now) : view === "upcoming" ? isUpcoming(t, now) : isOverdue(t, now);
}

/** iCalendar priority for sorting: 1 (high) first, 0 (none) last. */
function rank(p: number): number {
    return p > 0 ? p : 10;
}

/** Open tasks first; then by due (undated last), priority, and when they were made. */
export function compareTasks(a: Task, b: Task): number {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const da = a.due ?? Infinity, dbb = b.due ?? Infinity;
    if (da !== dbb) return da < dbb ? -1 : 1;
    return rank(a.priority) - rank(b.priority) || (a.createdTime ?? 0) - (b.createdTime ?? 0)
        || a.summary.localeCompare(b.summary);
}

export function visibleTasks(all: readonly Task[], sel: Selection, opts: { hideCompleted: boolean; now: number }): Task[] {
    return all
        .filter((t) => (sel.kind === "list" ? t.listId === sel.listId : inView(t, sel.view, opts.now)))
        .filter((t) => !(opts.hideCompleted && t.completed))
        .sort(compareTasks);
}

export interface Counts {
    today: number;
    upcoming: number;
    overdue: number;
    /** Open tasks per list id. */
    lists: Record<string, number>;
}

/** Open (not completed) tasks in each view and list. */
export function countTasks(all: readonly Task[], now: number): Counts {
    const c: Counts = { today: 0, upcoming: 0, overdue: 0, lists: {} };
    for (const t of all) {
        if (t.completed) continue;
        c.lists[t.listId] = (c.lists[t.listId] ?? 0) + 1;
        if (isDueToday(t, now)) c.today++;
        if (isUpcoming(t, now)) c.upcoming++;
        if (isOverdue(t, now)) c.overdue++;
    }
    return c;
}

export function selectionTitle(sel: Selection, lists: readonly TaskList[]): string {
    if (sel.kind === "view") return VIEWS.find((v) => v.id === sel.view)!.title;
    return lists.find((l) => l._id === sel.listId)?.name ?? "Tasks";
}

export const PRIORITY_OPTIONS = [
    { label: "None", value: PRIORITY.none },
    { label: "Low", value: PRIORITY.low },
    { label: "Medium", value: PRIORITY.medium },
    { label: "High", value: PRIORITY.high },
];

/** "!!!" high, "!!" medium, "!" low (any iCalendar value: 1-4, 5, 6-9). */
export function priorityMarks(p: number): string {
    if (p <= 0) return "";
    return p < 5 ? "!!!" : p === 5 ? "!!" : "!";
}

/** The picker value for a stored priority (iCalendar 1-9 onto High / Medium / Low). */
export function priorityChoice(p: number): number {
    if (p <= 0) return PRIORITY.none;
    return p < 5 ? PRIORITY.high : p === 5 ? PRIORITY.medium : PRIORITY.low;
}

/**
 * Due date for a task added in a view: today in Today, tomorrow in
 * Upcoming (all day); nothing elsewhere.
 */
export function defaultDue(sel: Selection, now: number): number | null {
    if (sel.kind !== "view") return null;
    return sel.view === "today" ? startOfDay(now) : sel.view === "upcoming" ? addDays(now, 1) : null;
}

/** A first reminder time: the due time if that is still ahead, else the next full hour. */
export function defaultRemind(t: Pick<Task, "due" | "allDay">, now: number): number {
    if (t.due && !t.allDay && t.due > now) return t.due;
    if (t.due && t.allDay && startOfDay(t.due) > startOfDay(now)) return t.due + 9 * 3_600_000;
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
}

// ---- Picker arithmetic ---------------------------------------------------------------

export interface DateParts {
    y: number;
    /** 1-12 */
    mo: number;
    d: number;
    /** 0-23 */
    h: number;
    mi: number;
}

export function toParts(ms: number): DateParts {
    const x = new Date(ms);
    return { y: x.getFullYear(), mo: x.getMonth() + 1, d: x.getDate(), h: x.getHours(), mi: x.getMinutes() };
}

export function daysInMonth(y: number, mo: number): number {
    return new Date(y, mo, 0).getDate();
}

/** Back to ms; the day is clamped to the month (Jan 31 -> Feb gives Feb 28/29). */
export function fromParts(p: DateParts): number {
    return new Date(p.y, p.mo - 1, Math.min(p.d, daysInMonth(p.y, p.mo)), p.h, p.mi).getTime();
}

/**
 * The due time when "Due time" is switched on: the next whole hour, on the
 * task's own due day. After 11 PM that would be midnight of the next day,
 * so it stops at 11 PM instead of moving the due date.
 */
export function withDefaultTime(due: number, now: number): number {
    return fromParts({ ...toParts(due), h: Math.min(new Date(now).getHours() + 1, 23), mi: 0 });
}

/**
 * Text that Just Type passes along: its action launches with the typed
 * text URI-encoded (luna-applauncher app/LaunchAndSearch.js).
 */
export function launchText(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

export interface Prefs {
    hideCompleted: boolean;
}

const PREFS_KEY = "tasks:prefs";

export function loadPrefs(): Prefs {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
        return { hideCompleted: !!p.hideCompleted };
    } catch {
        return { hideCompleted: false };
    }
}

export function savePrefs(p: Prefs): void {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
        /* private mode: keep it for this session */
    }
}
