// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The call log: db8 kind com.palm.phonecall:1, written by the phone app when
// a call ends, as the webOS phone app did. Record shape as in the LuneOS
// phone app's call history (webOS-ports/org.webosports.app.phone
// qml/model/CallHistory.qml addEndedCall and qml/test/phonecall.json):
//
//   { _kind: "com.palm.phonecall:1", type: "incoming" | "outgoing" | "missed" | "ignored",
//     timestamp, timestampInSecs, duration (ms),
//     from: {addr, name?, personId?, normalizedAddr, service}, to: [{addr, ...}] }
//
// (The call groups of com.palm.phonecallgroup:1 are not kept; the log view
// groups by day itself.)

import { db, matchNumber, normalizePhoneNumber, personDisplayName, type Call, type DbObject, type Person, type Subscription } from "@phoenix/luna";

export const PHONECALL_KIND = "com.palm.phonecall:1";

export type CallType = "incoming" | "outgoing" | "missed" | "ignored";

export interface CallParty {
    addr: string;
    name?: string;
    personId?: string;
    personAddressType?: string;
    normalizedAddr?: string;
    service?: string;
}

export interface PhoneCall extends DbObject {
    type: CallType;
    timestamp: number;
    timestampInSecs?: number;
    duration: number;
    from: CallParty;
    to: CallParty[];
}

/** How an ended call goes in the log. */
export function callType(c: Call): CallType {
    if (c.direction === "outgoing") return "outgoing";
    if (c.connectTime) return "incoming";
    return c.ignored ? "ignored" : "missed";
}

/** The log record for an ended call; the id is stable so a call is logged once. */
export function recordFor(c: Call, people: readonly Person[]): PhoneCall {
    const match = matchNumber(people, c.number);
    const party: CallParty = {
        addr: c.number,
        normalizedAddr: normalizePhoneNumber(c.number),
        service: "com.palm.telephony",
    };
    if (match) {
        party.name = personDisplayName(match.person);
        party.personId = match.person._id;
        party.personAddressType = match.number.type;
    } else if (c.name) {
        party.name = c.name;
    }
    const type = callType(c);
    const me: CallParty = { addr: "", service: "com.palm.telephony" };
    const end = c.endTime ?? Date.now();
    return {
        _id: `phonecall-${c.startTime}-${c.id}`,
        _kind: PHONECALL_KIND,
        type,
        timestamp: c.startTime,
        timestampInSecs: Math.floor(c.startTime / 1000),
        duration: c.connectTime ? Math.max(0, end - c.connectTime) : 0,
        from: type === "outgoing" ? me : party,
        to: type === "outgoing" ? [party] : [me],
    };
}

/** The other party of a logged call. */
export function otherParty(r: PhoneCall): CallParty {
    return r.type === "outgoing" ? (r.to[0] ?? { addr: "" }) : r.from;
}

export function isMissed(r: PhoneCall): boolean {
    return r.type === "missed" || r.type === "ignored";
}

export interface DayGroup<T> {
    day: number;     // start of the day, ms
    items: T[];
}

/** Split records (newest first) into calendar days. */
export function groupByDay<T extends { timestamp: number }>(records: readonly T[]): DayGroup<T>[] {
    const out: DayGroup<T>[] = [];
    for (const r of records) {
        const d = new Date(r.timestamp);
        d.setHours(0, 0, 0, 0);
        const day = d.getTime();
        const last = out[out.length - 1];
        if (last && last.day === day) last.items.push(r);
        else out.push({ day, items: [r] });
    }
    return out;
}

export const callLog = {
    /** The log, newest first; only missed and ignored calls with missedOnly. */
    watch(missedOnly: boolean, cb: (calls: PhoneCall[]) => void): Subscription {
        return db.watch<PhoneCall>({ from: PHONECALL_KIND, orderBy: "timestamp", desc: true, limit: 200 }, (all) =>
            cb(missedOnly ? all.filter(isMissed) : all));
    },
    add(r: PhoneCall) {
        return db.put([r]);
    },
    clear() {
        return db.delWhere({ from: PHONECALL_KIND });
    },
};
