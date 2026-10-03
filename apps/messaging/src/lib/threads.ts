// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Conversation logic that has nothing to do with drawing: how messages are
// grouped under time stamps, and who the "To:" field suggests.

import { personDisplayName, phoneTypeLabel, presenceClass, serviceLabel, type ChatThread, type ImBuddy, type ImLoginState,
         type Message, type Person } from "@phoenix/luna";

/** A new time stamp goes above a message sent this long after the one before (ms). */
export const TIME_GAP = 15 * 60 * 1000;

export type ChatItem =
    | { kind: "time"; key: string; timestamp: number }
    | { kind: "message"; key: string; message: Message; incoming: boolean; last: boolean };

export function isIncoming(m: Message): boolean {
    return m.folder === "inbox";
}

/**
 * Messages (oldest first) interleaved with time stamps: one before the
 * first message and one after every quiet gap. `last` marks the final
 * message of a run from the same side (where the status goes).
 */
export function chatItems(messages: readonly Message[]): ChatItem[] {
    const out: ChatItem[] = [];
    let prev: Message | null = null;
    messages.forEach((m, i) => {
        if (!prev || m.localTimestamp - prev.localTimestamp > TIME_GAP)
            out.push({ kind: "time", key: `t${m._id ?? i}`, timestamp: m.localTimestamp });
        const next = messages[i + 1];
        const last = !next || isIncoming(next) !== isIncoming(m) || next.localTimestamp - m.localTimestamp > TIME_GAP;
        out.push({ kind: "message", key: m._id ?? String(i), message: m, incoming: isIncoming(m), last });
        prev = m;
    });
    return out;
}

export interface Recipient {
    addr: string;
    name?: string;
    /** "Mobile", "Work", ... when the address is a contact's. */
    label?: string;
    personId?: string;
    /** An IM buddy: the service ("type_jabber") and the account's own address. */
    service?: string;
    account?: string;
}

// ---- Instant messaging -----------------------------------------------------------

/** The buddy a conversation is with (its service and address). */
export function buddyFor(thread: Pick<ChatThread, "replyService" | "replyAddress"> | null | undefined,
                         buddies: readonly ImBuddy[]): ImBuddy | undefined {
    if (!thread?.replyAddress) return undefined;
    const addr = thread.replyAddress.toLowerCase();
    return buddies.find((b) => b.serviceName === thread.replyService && b.username.toLowerCase() === addr);
}

/** "Available", "Busy: In a meeting", "Offline". */
export function presenceText(b: Pick<ImBuddy, "availability" | "status"> | undefined): string {
    const cls = presenceClass(b?.availability);
    const word = cls === "available" ? "Available" : cls === "busy" ? "Busy" : "Offline";
    return b?.status && cls !== "offline" ? `${word}: ${b.status}` : word;
}

/** Buddies under Available, Busy and Offline, by name, as webOS's buddy list. */
export function groupBuddies(buddies: readonly ImBuddy[]): { label: string; buddies: ImBuddy[] }[] {
    const name = (b: ImBuddy) => (b.displayName || b.username).toLowerCase();
    const groups: { label: string; cls: string }[] = [
        { label: "Available", cls: "available" }, { label: "Busy", cls: "busy" }, { label: "Offline", cls: "offline" }];
    return groups.map((g) => ({
        label: g.label,
        buddies: buddies.filter((b) => presenceClass(b.availability) === g.cls).sort((a, b) => name(a).localeCompare(name(b))),
    })).filter((g) => g.buddies.length > 0);
}

/** A buddy as a message's recipient, from the account they are a buddy of. */
export function buddyRecipient(b: ImBuddy, accounts: readonly ImLoginState[]): Recipient | null {
    const account = accounts.find((a) => a.accountId === b.accountId);
    if (!account) return null;
    return { addr: b.username, name: b.displayName, personId: b.personId, service: b.serviceName,
             account: account.username, label: serviceLabel(b.serviceName) };
}

/** Buddies of signed-in accounts whose name or address starts with what was typed. */
export function suggestBuddies(buddies: readonly ImBuddy[], accounts: readonly ImLoginState[], typed: string, max = 4): Recipient[] {
    const q = typed.trim().toLowerCase();
    if (!q) return [];
    const online = new Set(accounts.filter((a) => a.state === "online").map((a) => a.accountId));
    return buddies.filter((b) => online.has(b.accountId) && (b.username.toLowerCase().startsWith(q) ||
            (b.displayName ?? "").toLowerCase().split(/\s+/).some((w) => w.startsWith(q))))
        .map((b) => buddyRecipient(b, accounts)).filter((r): r is Recipient => !!r).slice(0, max);
}

/**
 * Contacts matching what was typed in "To:": any word of the name starting
 * with it, or a number containing the digits typed. One entry per number.
 */
export function suggestRecipients(people: readonly Person[], typed: string, max = 8): Recipient[] {
    const q = typed.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/[^0-9]/g, "");
    const byDigits = digits.length >= 3 && /^[0-9()+\-. ]+$/.test(q);
    const out: Recipient[] = [];
    for (const p of people) {
        const name = personDisplayName(p);
        const nameHit = !byDigits && name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q) || name.toLowerCase().startsWith(q));
        for (const n of p.phoneNumbers ?? []) {
            const numberHit = byDigits && n.value.replace(/[^0-9]/g, "").includes(digits);
            if (nameHit || numberHit)
                out.push({ addr: n.value, name, label: phoneTypeLabel(n.type), personId: p._id });
        }
        if (out.length >= max) break;
    }
    return out.slice(0, max);
}

/** Something typed that can be texted as it is (a phone number). */
export function typedRecipient(typed: string): Recipient | null {
    const t = typed.trim();
    return /^\+?[0-9()\-. ]{3,}$/.test(t) && t.replace(/[^0-9]/g, "").length >= 3 ? { addr: t } : null;
}
