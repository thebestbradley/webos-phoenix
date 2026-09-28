// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import { contacts, personDisplayName, matchNumber, telephony, type Call, type CallStatus, type Person, type VoicemailStatus } from "@phoenix/luna";
import { formatNumber } from "@phoenix/ui";
import { callLog, recordFor, type PhoneCall } from "./calllog";

/** Calls, mute and speaker (com.palm.telephony/callStatusQuery). */
export function useCallStatus(): CallStatus {
    const [s, setS] = useState<CallStatus>({ calls: [], muted: false, speaker: false });
    useEffect(() => {
        const sub = telephony.watchCalls(setS);
        return () => sub.cancel();
    }, []);
    return s;
}

export function useVoicemail(): VoicemailStatus | null {
    const [v, setV] = useState<VoicemailStatus | null>(null);
    useEffect(() => {
        const sub = telephony.watchVoicemail(setV, () => setV(null));
        return () => sub.cancel();
    }, []);
    return v;
}

/** Everyone in com.palm.person:1, kept up to date. */
export function usePeople(): Person[] {
    const [p, setP] = useState<Person[]>([]);
    useEffect(() => {
        const sub = contacts.watchAll(setP);
        return () => sub.cancel();
    }, []);
    return p;
}

export function useCallLog(missedOnly: boolean): PhoneCall[] | null {
    const [calls, setCalls] = useState<PhoneCall[] | null>(null);
    useEffect(() => {
        const sub = callLog.watch(missedOnly, setCalls);
        return () => sub.cancel();
    }, [missedOnly]);
    return calls;
}

/** Re-render every second while on (call timers). */
export function useTick(on: boolean): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!on) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [on]);
    return now;
}

/** Who a number is: the contact's name, the network's caller name, or the number. */
export function callerName(c: { number: string; name?: string }, people: readonly Person[]): string {
    const m = matchNumber(people, c.number);
    return m ? personDisplayName(m.person) : c.name || formatNumber(c.number) || "Unknown";
}

function banner(message: string) {
    try {
        (globalThis as { PalmSystem?: { addBannerMessage?: (m: string, p: string) => void } })
            .PalmSystem?.addBannerMessage?.(message, JSON.stringify({ source: "phone" }));
    } catch { /* not in a webOS runtime */ }
}

/**
 * What the phone app does in the background as calls come and go: an
 * incoming-call banner (webOS showed a banner and dashboard next to the
 * incoming-call popup), a "missed call" banner, and the call log entry
 * when a call ends.
 */
export function useCallBookkeeping(calls: readonly Call[], people: readonly Person[]) {
    const seen = useRef(new Map<number, string>());
    const peopleRef = useRef(people);
    peopleRef.current = people;
    useEffect(() => {
        for (const c of calls) {
            const key = `${c.startTime}-${c.id}`;
            const before = seen.current.get(c.id);
            if (before === `${key}:${c.state}`) continue;
            seen.current.set(c.id, `${key}:${c.state}`);
            const name = callerName(c, peopleRef.current);
            if ((c.state === "incoming" || c.state === "waiting") && !before?.startsWith(key))
                banner(`Incoming call: ${name}`);
            if (c.state === "disconnected") {
                const rec = recordFor(c, peopleRef.current);
                callLog.add(rec).catch(() => { /* logged next time */ });
                if (rec.type === "missed") banner(`Missed call: ${name}`);
            }
        }
    }, [calls]);
}

/** matchMedia wrapper: the two-pane tablet layout. */
export function useWide(query = "(min-width: 700px)"): boolean {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
    const [wide, setWide] = useState(!!mq?.matches);
    useEffect(() => {
        if (!mq) return;
        const on = () => setWide(mq.matches);
        mq.addEventListener("change", on);
        return () => mq.removeEventListener("change", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);
    return wide;
}
