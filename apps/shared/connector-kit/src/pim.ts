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

/** The event's note with the meeting's address first ("Join Microsoft Teams meeting: <address>"), once. */
export function meetingNote(note: string, joinUrl: string, provider: string): string {
    const n = String(note || "").trim();
    if (!joinUrl || n.indexOf(joinUrl) >= 0) return n;
    return "Join " + provider + " meeting: " + joinUrl + (n ? "\n\n" + n : "");
}
