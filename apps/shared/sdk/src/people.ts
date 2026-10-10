// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Synergy's data and apps: contacts, calendar, accounts, and composing a
// message or an email in the system's apps.
//
//   Contacts: db8 kind com.palm.person:1, the linked people the contacts
//       linker builds from every account (@phoenix/luna contacts.ts).
//   Calendar: db8 com.palm.calendar:1 and com.palm.calendarevent:1 (dtstart
//       and dtend in ms); the Calendar app opens with {newEvent: {...}}
//       ("New Calendar Event" on webOS Developer Network; core-apps
//       com.palm.app.calendar app/AppView.js:287) or {showEventDetail: id}.
//   Accounts: com.palm.service.accounts listAccounts {capability}.
//   Email: the Email app's compose, with the SDK email API's launch params
//       {summary, text, recipients: [{value, contactDisplay, role}],
//       attachments: [{fullPath, mimeType}]} (core-apps com.palm.app.email
//       compose/source/Composition.js:430-500; role 1 To, 2 Cc, 3 Bcc:
//       EmailRecipient.js:30-34).
//   Messaging: Phoenix's Messaging with {to, name, messageText,
//       attachment}; elsewhere an sms: link (RFC 5724).
//
// Reading another app's db8 kinds needs the permission to: on a device a
// third-party app may be refused (PhoenixError code "permission-denied").

import { app } from "./app";
import { guard, request, toPhoenixError, watchLuna, type OnError, type OnValue, type Watch } from "./core";
import { contacts as lunaContacts, personDisplayName, type Person } from "../../luna/src/contacts";
import { db } from "../../luna/src/db8";

export type { Person };

export interface PersonSummary {
    id: string;
    name: string;
    phoneNumbers: { value: string; type?: string }[];
    emails: { value: string; type?: string }[];
    /** A picture's path, if any. */
    photo?: string;
    favorite: boolean;
}

function summary(p: Person): PersonSummary {
    return {
        id: p._id ?? "",
        name: personDisplayName(p),
        phoneNumbers: (p.phoneNumbers ?? []).map((n) => ({ value: n.value, type: n.type })),
        emails: (p.emails ?? []).map((n) => ({ value: n.value, type: n.type })),
        photo: p.photos?.localPathSquare || p.photos?.localPathList || p.photos?.localPathBig || undefined,
        favorite: !!p.favorite,
    };
}

export const contacts = {
    /** Everyone, by name. */
    async list(): Promise<PersonSummary[]> {
        return (await guard(lunaContacts.all(), "luna://com.palm.db/find")).map(summary);
    },
    /** Everyone, kept up to date. */
    watch(onValue?: OnValue<PersonSummary[]>, onError?: OnError): Watch<PersonSummary[]> {
        return watchLuna<PersonSummary[]>((cb, err) => lunaContacts.watchAll((people) => cb(people.map(summary)), err), onValue, onError);
    },
    /** People whose name, number or email contains the words (case and spacing ignored). */
    async search(text: string): Promise<PersonSummary[]> {
        const q = text.trim().toLowerCase();
        const digits = q.replace(/\D/g, "");
        return (await contacts.list()).filter((p) =>
            p.name.toLowerCase().includes(q)
            || p.emails.some((e) => e.value.toLowerCase().includes(q))
            || (digits.length >= 3 && p.phoneNumbers.some((n) => n.value.replace(/\D/g, "").includes(digits))));
    },
    /** The full db8 record (com.palm.person:1). */
    async get(id: string): Promise<Person | null> {
        return (await guard(db.get<Person>([id]), "luna://com.palm.db/get"))[0] ?? null;
    },
    /** Show a person in Contacts. */
    show(id: string): Promise<void> {
        return app.launch("com.palm.app.contacts", { launchType: "showPerson", id });
    },
};

// ---- Calendar ----------------------------------------------------------------------------

export interface CalendarInfo {
    id: string;
    name: string;
    color?: string;
    accountId?: string;
    readOnly: boolean;
}

export interface CalendarEvent {
    id: string;
    calendarId: string;
    subject: string;
    /** ms since the epoch. */
    start: number;
    end: number;
    allDay: boolean;
    location?: string;
    note?: string;
    /** RFC 5545 RRULE, as Calendar keeps it (repeats are not expanded here). */
    rrule?: unknown;
}

export interface NewEvent {
    subject: string;
    start?: Date | number;
    end?: Date | number;
    allDay?: boolean;
    location?: string;
    note?: string;
}

interface RawEvent { _id?: string; calendarId?: string; subject?: string; dtstart?: number | string; dtend?: number | string;
                     allDay?: boolean; location?: string; note?: string; rrule?: unknown }

export const calendar = {
    /** The calendars of every account. */
    async calendars(): Promise<CalendarInfo[]> {
        const r = await guard(db.find<{ _kind: string; _id?: string; name?: string; color?: string; accountId?: string; isReadOnly?: boolean }>(
            { from: "com.palm.calendar:1" }), "luna://com.palm.db/find");
        return r.map((c) => ({ id: c._id ?? "", name: c.name ?? "", color: c.color, accountId: c.accountId, readOnly: !!c.isReadOnly }));
    },
    /** Events that overlap [from, to) (repeating events by their first occurrence). */
    async events(range: { from: Date | number; to: Date | number }): Promise<CalendarEvent[]> {
        const from = +range.from, to = +range.to;
        const raw = await guard(db.find<RawEvent & { _kind: string }>({ from: "com.palm.calendarevent:1" }), "luna://com.palm.db/find");
        return raw.map((e) => ({
            id: e._id ?? "", calendarId: e.calendarId ?? "", subject: e.subject ?? "",
            start: Number(e.dtstart), end: Number(e.dtend ?? e.dtstart), allDay: !!e.allDay,
            location: e.location, note: e.note, rrule: e.rrule,
        })).filter((e) => e.start < to && e.end >= from).sort((a, b) => a.start - b.start);
    },
    /** Open Calendar on a new event, filled in for the user to save. */
    newEvent(ev: NewEvent): Promise<void> {
        const start = ev.start !== undefined ? +ev.start : undefined;
        const end = ev.end !== undefined ? +ev.end : start !== undefined ? start + 3600_000 : undefined;
        return app.launch("com.palm.app.calendar", {
            newEvent: { subject: ev.subject, ...(start !== undefined ? { dtstart: String(start), dtend: String(end) } : {}),
                        ...(ev.allDay ? { allDay: true } : {}), ...(ev.location ? { location: ev.location } : {}),
                        ...(ev.note ? { note: ev.note } : {}) },
        });
    },
    /** Show an event in Calendar. */
    showEvent(id: string): Promise<void> {
        return app.launch("com.palm.app.calendar", { showEventDetail: id });
    },
};

// ---- Accounts ----------------------------------------------------------------------------

export interface Account {
    id: string;
    templateId: string;
    username: string;
    alias?: string;
    /** What it syncs: "CONTACTS", "CALENDAR", "MAIL", "MESSAGING", ... */
    capabilities: string[];
}

/** Account capabilities as the accounts service names them (capabilityProviders[].capability). */
export type AccountCapability = "CONTACTS" | "CALENDAR" | "MAIL" | "MESSAGING" | "TASKS" | "MEMOS" | "PHOTO.UPLOAD" | "VIDEO.UPLOAD" | string;

export const accounts = {
    /** The user's accounts, or those that offer a capability ("CONTACTS", "MAIL", ...). */
    async list(capability?: AccountCapability): Promise<Account[]> {
        const r = await request<{ results?: { _id?: string; templateId?: string; username?: string; alias?: string;
                                               capabilityProviders?: { capability?: string }[] }[] }>(
            "luna://com.palm.service.accounts/listAccounts", capability ? { capability } : {});
        return (r.results ?? []).map((a) => ({
            id: a._id ?? "", templateId: a.templateId ?? "", username: a.username ?? "", alias: a.alias,
            capabilities: (a.capabilityProviders ?? []).map((c) => c.capability ?? "").filter(Boolean),
        }));
    },
    /** Open Accounts in Settings (to add one). */
    manage(): Promise<void> {
        return app.launch("com.palm.app.accounts", {});
    },
};

// ---- Compose -----------------------------------------------------------------------------

export interface EmailDraft {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
    /** Plain text (default) or HTML. */
    html?: boolean;
    attachments?: { path: string; mimeType?: string }[];
}

export const email = {
    /** Open Email's compose with the draft, for the user to send. */
    async compose(d: EmailDraft): Promise<void> {
        const recipients = [
            ...(d.to ?? []).map((value) => ({ value, type: "email", role: 1 })),
            ...(d.cc ?? []).map((value) => ({ value, type: "email", role: 2 })),
            ...(d.bcc ?? []).map((value) => ({ value, type: "email", role: 3 })),
        ];
        try {
            await app.launch("com.palm.app.email", {
                ...(d.subject ? { summary: d.subject } : {}),
                ...(d.body !== undefined ? { text: d.body, isHtml: !!d.html } : {}),
                ...(recipients.length ? { recipients } : {}),
                ...(d.attachments?.length ? { attachments: d.attachments.map((a) => ({ fullPath: a.path, mimeType: a.mimeType ?? "" })) } : {}),
            });
        } catch (e) {
            if (toPhoenixError(e).code !== "unavailable" && toPhoenixError(e).code !== "not-found") throw e;
            const q = new URLSearchParams();
            if (d.subject) q.set("subject", d.subject);
            if (d.body) q.set("body", d.body);
            if (d.cc?.length) q.set("cc", d.cc.join(","));
            if (d.bcc?.length) q.set("bcc", d.bcc.join(","));
            const url = `mailto:${(d.to ?? []).map(encodeURIComponent).join(",")}${q.toString() ? "?" + q.toString().replace(/\+/g, "%20") : ""}`;
            await app.open(url).catch(() => { if (typeof location !== "undefined") location.href = url; });
        }
    },
};

export interface MessageDraft {
    /** A phone number (or an IM address). */
    to?: string;
    /** The person's name, shown until Contacts matches the number. */
    name?: string;
    text?: string;
    /** A picture's path (an MMS). */
    attachment?: string;
}

export const messaging = {
    /** Open Messaging's compose with the draft, for the user to send. */
    async compose(d: MessageDraft): Promise<void> {
        try {
            await app.launch("org.webosphoenix.messaging", {
                ...(d.to ? { to: d.to } : {}), ...(d.name ? { name: d.name } : {}),
                ...(d.text ? { messageText: d.text } : {}), ...(d.attachment ? { attachment: d.attachment } : {}),
            });
        } catch (e) {
            if (toPhoenixError(e).code !== "unavailable" && toPhoenixError(e).code !== "not-found") throw e;
            await app.open(`sms:${encodeURIComponent(d.to ?? "")}${d.text ? "?body=" + encodeURIComponent(d.text) : ""}`);
        }
    },
};
