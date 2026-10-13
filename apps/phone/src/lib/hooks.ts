// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import { contacts, personDisplayName, matchNumber, postNotification, primaryCall, removeNotificationGroup, telephony, type Call, type CallStatus,
         type Person, type VoicemailStatus } from "@phoenix/luna";
import { formatNumber, formatTime } from "@phoenix/ui";
import { callLog, recordFor, type PhoneCall } from "./calllog";

export const PHONE_APP_ID = "org.webosphoenix.phone";
/**
 * The missed calls' notifications: one stack (the shell's
 * NotificationStacks.js), newest on top with the count, as an app's
 * notifications of one kind were one dashboard of layers on webOS (Enyo's
 * enyo.Dashboard; Calendar's reminders, ReminderManager.js:694-722). A tap
 * opens the call log on the missed calls ({action: "missedcalls"}); seeing
 * the log takes the stack away.
 */
export const MISSED_CALLS_GROUP = "missed-calls";

/** A missed call's notification, on the missed calls' stack. */
export function notifyMissedCall(name: string, at: number): void {
    postNotification({ appId: PHONE_APP_ID, title: name, body: `Missed call, ${formatTime(at)}`,
                       params: { action: "missedcalls" }, group: MISSED_CALLS_GROUP });
}

/** The missed calls' stack gone: the call log has been seen. */
export function clearMissedCalls(): void {
    removeNotificationGroup(PHONE_APP_ID, MISSED_CALLS_GROUP);
}

const NO_CALLS: CallStatus = { calls: [], muted: false, speaker: false };

/** Calls, mute and speaker (com.palm.telephony/callStatusQuery); null until the service first answers. */
export function useCallStatusReply(): CallStatus | null {
    const [s, setS] = useState<CallStatus | null>(null);
    useEffect(() => {
        const sub = telephony.watchCalls(setS, () => setS(NO_CALLS));
        return () => sub.cancel();
    }, []);
    return s;
}

/** Calls, mute and speaker (com.palm.telephony/callStatusQuery); none until the service answers. */
export function useCallStatus(): CallStatus {
    return useCallStatusReply() ?? NO_CALLS;
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
 * incoming-call popup), a missed call's notification (its banner, and a
 * layer on the missed calls' stack), and the call log entry when a call
 * ends.
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
                if (rec.type === "missed") notifyMissedCall(name, rec.timestamp || Date.now());
            }
        }
    }, [calls]);
}

type ActiveCallBannerApi = {
    addActiveCallBanner?: (icon: string, message: string, startTime: number) => void;
    updateActiveCallBanner?: (icon: string, message: string, startTime: number) => void;
    removeActiveCallBanner?: () => void;
};
const palm = () => (globalThis as { PalmSystem?: ActiveCallBannerApi }).PalmSystem;

/**
 * The active-call banner: while a call is connected, the phone's banner
 * strip shows who it is with and for how long, and a tap brings the call
 * back ({action: "activecall"}), as the webOS phone app had LunaSysMgr do
 * (PalmSystem.addActiveCallBanner(icon, message, startTime in seconds);
 * ActiveCallBanner.cpp).
 */
export function useActiveCallBanner(calls: readonly Call[], people: readonly Person[]) {
    const shown = useRef<string | null>(null);
    const call = primaryCall(calls);
    const connected = call && (call.state === "active" || call.state === "held") && call.connectTime ? call : null;
    const message = connected ? callerName(connected, people) : "";
    const start = connected ? Math.floor((connected.connectTime ?? 0) / 1000) : 0;
    useEffect(() => {
        const api = palm();
        const key = connected ? `${message}|${start}` : null;
        if (key === shown.current) return;
        try {
            if (key === null) api?.removeActiveCallBanner?.();
            else if (shown.current === null) api?.addActiveCallBanner?.("icon.png", message, start);
            else api?.updateActiveCallBanner?.("icon.png", message, start);
        } catch { /* not in a webOS runtime */ }
        shown.current = key;
    }, [connected, message, start]);
    // The page going away takes it along.
    useEffect(() => () => { if (shown.current !== null) palm()?.removeActiveCallBanner?.(); }, []);
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
