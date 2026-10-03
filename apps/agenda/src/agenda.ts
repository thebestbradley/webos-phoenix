// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The agenda: the calendar's events of the next days, as the Agenda
// exhibition shows them (the original com.palm.app.agendaview, webOS 3.0).
// Events are db8 com.palm.calendarevent:1 objects as the Calendar app saves
// them: dtstart / dtend in ms, allDay, a Palm rrule ({freq, interval, count,
// until, rules: [{ruleType: "BYDAY" | "BYMONTHDAY" | "BYMONTH", ruleValue}]}),
// exdates, and exceptions (an event with parentId and parentDtstart replaces
// that occurrence of its parent). Calendars (com.palm.calendar:1) give the
// colour, one of the Calendar app's eight (CalendarsManager.js colorList) or
// a #rrggbb a synced calendar brought.

export interface CalendarEvent {
    _id?: string;
    calendarId?: string;
    subject?: string;
    location?: string;
    dtstart: number;
    dtend?: number;
    allDay?: boolean;
    rrule?: Rrule | null;
    exdates?: string[];
    parentId?: string;
    parentDtstart?: number;
}

export interface Rrule {
    freq?: string;
    interval?: number;
    count?: number;
    until?: number | string;
    wkst?: number;
    rules?: { ruleType: string; ruleValue: { day?: number; ord?: number }[] | number[] | { ord: number }[] }[];
}

export interface Calendar {
    _id?: string;
    color?: string;
    name?: string;
    /** The user hid it in Calendar ("visible" in the Calendar app's prefs). */
    visible?: boolean;
}

export interface Occurrence {
    key: string;
    eventId: string;
    subject: string;
    location: string;
    start: number;
    end: number;
    allDay: boolean;
    color: string;
}

export interface AgendaDay {
    /** Midnight, local time. */
    date: number;
    /** "Today", "Tomorrow", or the weekday. */
    label: string;
    items: Occurrence[];
}


/** The Calendar app's colours (AppView.css .theme-<name>:after border colour). */
export const CALENDAR_COLORS: Record<string, string> = {
    blue: "#0d71d7", green: "#52b400", orange: "#ff7200", pink: "#ff00a2",
    purple: "#9a00c7", red: "#ff0000", teal: "#00a6c9", yellow: "#f4d400",
};

export function calendarColor(color: string | undefined): string {
    if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
    return CALENDAR_COLORS[color ?? ""] ?? CALENDAR_COLORS.blue;
}

export function startOfDay(t: number): number {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function addDays(t: number, n: number): number {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}
function addMonths(t: number, n: number): number {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

/** An exdate ("20110315T093000Z", "20110315T093000", "20110315") as ms. */
export function parseIcalDate(s: string): number {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(s.trim());
    if (!m) return NaN;
    const [y, mo, d, h = "0", mi = "0", se = "0"] = m.slice(1, 7);
    return m[7] ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) : new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
}

function untilOf(r: Rrule): number {
    if (typeof r.until === "number") return r.until;
    if (typeof r.until === "string") {
        const t = parseIcalDate(r.until);
        return isNaN(t) ? Infinity : t;
    }
    return Infinity;
}

function byDay(r: Rrule): { day: number; ord?: number }[] {
    const rule = r.rules?.find((x) => x.ruleType === "BYDAY");
    return ((rule?.ruleValue ?? []) as { day?: number; ord?: number }[])
        .filter((v) => typeof v.day === "number").map((v) => ({ day: v.day as number, ord: v.ord }));
}
function byMonthDay(r: Rrule): number[] {
    const rule = r.rules?.find((x) => x.ruleType === "BYMONTHDAY");
    return ((rule?.ruleValue ?? []) as ({ ord?: number } | number)[])
        .map((v) => (typeof v === "number" ? v : v.ord)).filter((v): v is number => typeof v === "number");
}

/** The nth (ord, 1-based; -1 the last) weekday `day` of the month of t, at t's time. */
function nthWeekday(t: number, day: number, ord: number): number {
    const d = new Date(t);
    const first = new Date(d.getFullYear(), d.getMonth(), 1, d.getHours(), d.getMinutes(), d.getSeconds());
    if (ord > 0) {
        const date = 1 + ((day - first.getDay() + 7) % 7) + (ord - 1) * 7;
        const r = new Date(d.getFullYear(), d.getMonth(), date, d.getHours(), d.getMinutes(), d.getSeconds());
        return r.getMonth() === d.getMonth() ? r.getTime() : NaN;
    }
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, d.getHours(), d.getMinutes(), d.getSeconds());
    const date = last.getDate() - ((last.getDay() - day + 7) % 7) + (ord + 1) * 7;
    const r = new Date(d.getFullYear(), d.getMonth(), date, d.getHours(), d.getMinutes(), d.getSeconds());
    return r.getMonth() === d.getMonth() ? r.getTime() : NaN;
}

/**
 * The start times of an event's occurrences that begin before `to`, in
 * order (at most 1000 looked at): one for a plain event, the series for a
 * repeating one.
 */
export function occurrenceStarts(e: CalendarEvent, to: number): number[] {
    const r = e.rrule;
    if (!r || !r.freq) return e.dtstart < to ? [e.dtstart] : [];
    const interval = Math.max(1, r.interval ?? 1);
    const until = untilOf(r);
    const count = r.count && r.count > 0 ? r.count : Infinity;
    const out: number[] = [];
    let n = 0;
    const take = (t: number) => {
        if (isNaN(t) || t < e.dtstart || t > until || t >= to || n >= count) return false;
        n++;
        out.push(t);
        return true;
    };
    const freq = r.freq.toUpperCase();
    for (let i = 0; i < 1000 && n < count; i++) {
        let period: number;
        if (freq === "DAILY") period = addDays(e.dtstart, i * interval);
        else if (freq === "WEEKLY") period = addDays(e.dtstart, i * 7 * interval);
        // Monthly: the month's first day, at the event's time (a 31st has no
        // February).
        else if (freq === "MONTHLY") {
            const s = new Date(e.dtstart);
            period = new Date(s.getFullYear(), s.getMonth() + i * interval, 1, s.getHours(), s.getMinutes(), s.getSeconds()).getTime();
        }
        else if (freq === "YEARLY") period = addMonths(e.dtstart, i * 12 * interval);
        else break;
        // The week (from wkst) or month holding `period`: once it starts at
        // or after `to` (or the end of the series), nothing more.
        const pd = new Date(period);
        const weekStart = addDays(period, -((pd.getDay() - (r.wkst ?? 0) + 7) % 7));
        const periodStart = freq === "WEEKLY" ? startOfDay(weekStart)
            : freq === "MONTHLY" ? new Date(pd.getFullYear(), pd.getMonth(), 1).getTime() : period;
        if (periodStart >= to || periodStart > until) break;
        const candidates: number[] = [];
        if (freq === "WEEKLY") {
            const days = byDay(r);
            if (!days.length) candidates.push(period);
            else for (const d of days) candidates.push(addDays(weekStart, (d.day - (r.wkst ?? 0) + 7) % 7));
        } else if (freq === "MONTHLY") {
            const days = byDay(r);
            const monthDays = byMonthDay(r).length ? byMonthDay(r) : [new Date(e.dtstart).getDate()];
            if (days.length) for (const d of days) candidates.push(nthWeekday(period, d.day, d.ord ?? 1));
            else {
                const p = new Date(period);
                const last = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate();
                for (const md of monthDays) {
                    const date = md > 0 ? md : last + md + 1;
                    if (date >= 1 && date <= last)
                        candidates.push(new Date(p.getFullYear(), p.getMonth(), date, p.getHours(), p.getMinutes(), p.getSeconds()).getTime());
                }
            }
        } else candidates.push(period);
        candidates.sort((a, b) => a - b);
        for (const c of candidates) take(c);
    }
    return out;
}

/**
 * Every occurrence that overlaps [from, to), with its calendar's colour,
 * sorted by start. Exceptions replace their parent's occurrence; exdates and
 * hidden calendars are left out.
 */
export function occurrences(events: CalendarEvent[], calendars: Calendar[], from: number, to: number): Occurrence[] {
    const cal = new Map(calendars.map((c) => [c._id ?? "", c]));
    const replaced = new Set<string>();
    for (const e of events)
        if (e.parentId && typeof e.parentDtstart === "number") replaced.add(`${e.parentId}@${e.parentDtstart}`);
    const out: Occurrence[] = [];
    for (const e of events) {
        const c = cal.get(e.calendarId ?? "");
        if (c && c.visible === false) continue;
        const length = Math.max(0, (e.dtend ?? e.dtstart) - e.dtstart);
        const ex = new Set((e.exdates ?? []).map(parseIcalDate).filter((t) => !isNaN(t)));
        for (const start of occurrenceStarts(e, to)) {
            const end = start + length;
            if (end <= from && !(length === 0 && start >= from)) continue;
            if (ex.has(start) || replaced.has(`${e._id}@${start}`)) continue;
            out.push({
                key: `${e._id ?? e.subject}@${start}`, eventId: e._id ?? "", subject: e.subject || "No Subject",
                location: e.location ?? "", start, end, allDay: !!e.allDay, color: calendarColor(c?.color),
            });
        }
    }
    return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.subject.localeCompare(b.subject));
}

/**
 * The agenda from now: `days` days from today's midnight, each with what
 * happens that day (all-day events first). Today leaves out what is over;
 * an event that runs past midnight shows on the days it covers. Days with
 * nothing are left out but for today.
 */
export function agenda(occ: Occurrence[], now: number, days = 7, locale?: string): AgendaDay[] {
    const today = startOfDay(now);
    const out: AgendaDay[] = [];
    for (let i = 0; i < days; i++) {
        const date = addDays(today, i), next = addDays(today, i + 1);
        const items = occ.filter((o) => o.start < next && (o.end > date || (o.end === o.start && o.start >= date)))
            .filter((o) => i > 0 || o.allDay || o.end > now || (o.end === o.start && o.start >= now))
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Math.max(a.start, date) - Math.max(b.start, date));
        if (!items.length && i > 0) continue;
        const label = i === 0 ? "Today" : i === 1 ? "Tomorrow"
            : new Date(date).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
        out.push({ date, label, items });
    }
    return out;
}

/** "9:30 AM" or "09:30", as the device's clock is set. */
export function formatTime(t: number, twentyFour: boolean, locale?: string): string {
    return new Date(t).toLocaleTimeString(locale, { hour: twentyFour ? "2-digit" : "numeric", minute: "2-digit", hour12: !twentyFour });
}

/** What the agenda row says for when: "All day", "9:30 AM – 10:00 AM", or the time it began on an earlier day. */
export function whenLabel(o: Occurrence, day: number, twentyFour: boolean, locale?: string): string {
    if (o.allDay) return "All day";
    const from = o.start < day ? "Until" : formatTime(o.start, twentyFour, locale);
    if (o.start < day) return `${from} ${formatTime(o.end, twentyFour, locale)}`;
    return o.end > o.start ? `${from} – ${formatTime(o.end, twentyFour, locale)}` : from;
}
