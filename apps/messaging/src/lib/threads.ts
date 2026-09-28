// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Conversation logic that has nothing to do with drawing: how messages are
// grouped under time stamps, and who the "To:" field suggests.

import { personDisplayName, phoneTypeLabel, type Message, type Person } from "@phoenix/luna";

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
