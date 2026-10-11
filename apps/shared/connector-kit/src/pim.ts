// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What connectors of calendars and tasks share (Microsoft 365, Google,
// Todoist, Zoom: docs/SYNERGY-CONNECTORS.md 1):
//
//   syncContainers(ctx, kind, list, opts)
//       one db8 object per calendar (com.palm.calendar:1's sub-kind) or task
//       list (com.palm.tasklist:1's) of the account, as apps/dav's
//       ensureCalendarObject keeps them: new ones put, names updated (the
//       user's colour and show/hide choices kept: createOnly), the ones gone
//       from the server deleted -> {remoteId: _id}
//   rruleOf(rule, {dtstart, tzId, allDay}) / rruleText(rrule, event)
//       an RFC 5545 RRULE ("FREQ=WEEKLY;BYDAY=MO") <-> the Calendar app's
//       rrule object, through @phoenix/synckit's iCalendar mapper
//   joinUrlOf(text) / meetingNote(note, joinUrl, provider)
//       a meeting's address (Teams, Zoom, Meet, Webex, Jitsi) found in an
//       event's text, and the note that carries it ("Join: <address>"), as
//       docs/SYNERGY-CONNECTORS.md 7 "Meetings and video calls" asks
//   answerChanged(change, address)
//       the user's own answer to an invitation, when the device changed it
//       (their attendee entry's participationStatus: ACCEPTED, DECLINED,
//       TENTATIVE, as Calendar or the Assistant sets it), else "": what a
//       provider sends as the attendee's reply, not as an edit of the event
//   taskPriority / todoistPriority ...: in the providers' own modules

import * as synckit from "@phoenix/synckit";
import type { AccountContext, Json } from "./types";

export interface Container {
    /** The server's id of the calendar or list. */
    remoteId: string;
    /** Its db8 fields (name, isReadOnly, ...). */
    fields: Record<string, Json>;
}

/** The account's calendars or task lists in db8, kept as the server lists them -> {remoteId: _id}. */
export async function syncContainers(ctx: AccountContext, kind: string, list: Container[],
                                     opts?: { createOnly?: string[] }): Promise<Record<string, string>> {
    const createOnly = (opts && opts.createOnly) || [];
    const have = await ctx.db.find({ from: kind, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    const byRemote: Record<string, Json> = {};
    have.forEach((o: Json) => { if (o.remoteId) byRemote[o.remoteId] = o; });
    const out: Record<string, string> = {};
    const listed: Record<string, boolean> = {};
    for (const c of list) {
        listed[c.remoteId] = true;
        const old = byRemote[c.remoteId];
        if (!old) {
            const r = await ctx.db.put([Object.assign({ _kind: kind }, c.fields, { accountId: ctx.accountId, remoteId: c.remoteId })]);
            out[c.remoteId] = r[0].id;
            continue;
        }
        out[c.remoteId] = old._id;
        const changed: Record<string, Json> = {};
        Object.keys(c.fields).forEach((k) => {
            if (createOnly.indexOf(k) >= 0) return;
            if (!synckit.sameValue(old[k], c.fields[k])) changed[k] = c.fields[k];
        });
        if (Object.keys(changed).length) await ctx.db.merge([Object.assign({ _id: old._id }, changed)]);
    }
    const gone = have.filter((o: Json) => o.remoteId && !listed[o.remoteId]).map((o: Json) => o._id as string);
    if (gone.length) await ctx.db.del(gone);
    return out;
}

/** {_id: remoteId} of the account's containers, for a push (a device object's calendarId -> the server's calendar). */
export async function containerRemoteIds(ctx: AccountContext, kind: string): Promise<Record<string, string>> {
    const have = await ctx.db.find({ from: kind, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    const out: Record<string, string> = {};
    have.forEach((o: Json) => { if (o.remoteId) out[o._id] = o.remoteId; });
    return out;
}

function pad(n: number, w?: number): string { let s = String(n); while (s.length < (w || 2)) s = "0" + s; return s; }

/** An RRULE value ("FREQ=WEEKLY;BYDAY=MO,WE", with or without "RRULE:") -> the Calendar app's rrule object. */
export function rruleOf(rule: string, ev: { dtstart: number; tzId?: string; allDay?: boolean }): Json | undefined {
    const value = String(rule || "").replace(/^RRULE:/i, "").trim();
    if (!/FREQ=/i.test(value)) return undefined;
    const tz = ev.tzId && synckit.datetime.isZone(ev.tzId) ? ev.tzId : "UTC";
    const w = synckit.datetime.wall(ev.dtstart, tz);
    const start = ev.allDay ? "DTSTART;VALUE=DATE:" + pad(w.year, 4) + pad(w.month) + pad(w.day)
        : "DTSTART;TZID=" + tz + ":" + pad(w.year, 4) + pad(w.month) + pad(w.day) + "T" + pad(w.hour) + pad(w.minute) + pad(w.second);
    const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:x", start, "RRULE:" + value, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const parsed = synckit.ical.toEvents(text, { localTz: tz });
    return parsed && parsed.master && parsed.master.rrule ? parsed.master.rrule : undefined;
}

/** The Calendar app's rrule object -> an RRULE value (without "RRULE:"). */
export function rruleText(rrule: Json, ev: { allDay?: boolean; tzId?: string }): string {
    return synckit.ical.rruleValue(rrule, ev, ev.tzId || "UTC");
}

/** A reminder this many minutes before the start, as the Calendar app keeps one (an iCalendar VALARM's trigger). */
export function alarmBefore(minutes: number | null | undefined): Json[] {
    if (minutes === null || minutes === undefined || !(minutes >= 0)) return [];
    const m = Math.round(minutes);
    const value = m === 0 ? "PT0M" : m % 1440 === 0 ? "-P" + m / 1440 + "D" : m % 60 === 0 ? "-PT" + m / 60 + "H" : "-PT" + m + "M";
    return [{ action: "display", alarmTrigger: { valueType: "DURATION", value } }];
}

/** The first reminder's minutes before the start, or null (an absolute or after-start trigger: none). */
export function alarmMinutes(alarm: Json): number | null {
    const a = (Array.isArray(alarm) ? alarm : []).find((x: Json) => x && x.alarmTrigger && x.alarmTrigger.valueType === "DURATION" && x.alarmTrigger.related !== "end");
    if (!a) return null;
    const ms = synckit.datetime.parseDuration(String(a.alarmTrigger.value || ""));
    if (ms === null || isNaN(ms) || ms > 0) return null;
    return Math.round(-ms / 60000) || 0;
}

/** "2026-10-12" (or "2026-10-12T00:00:00...") -> {year, month, day}. */
export function dateParts(s: string): { year: number; month: number; day: number } | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}

/**
 * An all-day event's span, from its first day and the day after its last
 * (exclusive, as Graph, Google and iCalendar give it) -> dtstart at local
 * midnight and dtend at 23:59:59 of the last day, as apps/dav writes them.
 */
export function allDaySpan(first: string, endExclusive: string, tz: string): { dtstart: number; dtend: number } | null {
    const a = dateParts(first);
    if (!a) return null;
    const b = dateParts(endExclusive) || a;
    const days = Math.max(1, Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000));
    const last = new Date(Date.UTC(a.year, a.month - 1, a.day + days - 1));
    return {
        dtstart: synckit.datetime.fromWall({ year: a.year, month: a.month, day: a.day, hour: 0, minute: 0, second: 0 }, tz),
        dtend: synckit.datetime.fromWall({ year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate(), hour: 23, minute: 59, second: 59 }, tz)
    };
}

/** An all-day event's days back: the first day and the day after the last ("YYYY-MM-DD"). */
export function allDayDates(dtstart: number, dtend: number, tz: string): { first: string; endExclusive: string } {
    const s = synckit.datetime.wall(dtstart, tz), e = synckit.datetime.wall(Math.max(dtstart, dtend), tz);
    const after = new Date(Date.UTC(e.year, e.month - 1, e.day + 1));
    const iso = (y: number, m: number, d: number) => y + "-" + pad(m) + "-" + pad(d);
    return { first: iso(s.year, s.month, s.day), endExclusive: iso(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate()) };
}

/** The text of an HTML body (an event's or a task's notes): tags dropped, entities decoded, blank lines kept short. */
export function plainText(html: string): string {
    return String(html || "")
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&")
        .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Meeting services whose addresses get a Join (docs/SYNERGY-CONNECTORS.md 7).
const MEETING = /https:\/\/(?:[a-z0-9-]+\.)*(?:teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|zoom\.us\/(?:j|my|w)|zoomgov\.com\/j|meet\.google\.com|[a-z0-9-]+\.webex\.com\/(?:meet|join|[a-z0-9-]+\/j\.php)|meet\.jit\.si)[^\s<>"')\]]*/i;

/** The first meeting address in a text (an event's location, note or url), or "". */
export function joinUrlOf(...texts: (string | undefined | null)[]): string {
    for (const t of texts) {
        const m = MEETING.exec(String(t || ""));
        if (m) return m[0];
    }
    return "";
}

/** The user's (address's) own attendee entry's answer in an event's fields, or "" when they are no guest. */
function answerIn(fields: Json, address: string): string {
    const me = String(address || "").toLowerCase();
    const a = ((fields && fields.attendees) || []).filter((x: Json) => x && !x.organizer && String(x.email || "").toLowerCase() === me)[0];
    return a ? String(a.participationStatus || "NEEDS-ACTION") : "";
}
/**
 * The user's answer to an invitation when the device changed it since the
 * last sync (ACCEPTED, DECLINED, TENTATIVE), else "". change: the engine's
 * push {op, fields, base}.
 */
export function answerChanged(change: Json, address: string): string {
    if (!change || change.op !== "update" || !change.base) return "";
    const now = answerIn(change.fields, address), was = answerIn(change.base, address);
    return now && now !== was && /^(?:ACCEPTED|DECLINED|TENTATIVE)$/.test(now) ? now : "";
}

/** The event's note with the meeting's address first ("Join Microsoft Teams meeting: <address>"), once. */
export function meetingNote(note: string, joinUrl: string, provider: string): string {
    const n = String(note || "").trim();
    if (!joinUrl || n.indexOf(joinUrl) >= 0) return n;
    return "Join " + provider + " meeting: " + joinUrl + (n ? "\n\n" + n : "");
}
