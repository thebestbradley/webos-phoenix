// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The incoming-call popup alert. Like the webOS phone app, Phone does not
// take over the screen when a call comes in: it opens a popup alert
// window ("incoming-known" or "incoming-unknown", which the system ranks
// first in notificationPolicy.conf), shown under what the user is doing,
// with who is calling and Answer / Ignore. Answering brings the Phone card
// up for the call. The window closes itself once the call stops ringing.
//
// This is the same page as the app, opened with ?alert=incoming.

import { useEffect, useRef, useState } from "react";
import { matchNumber, phoneTypeLabel, ringingCall, primaryCall, telephony, type Call, type Person } from "@phoenix/luna";
import { Button, formatNumber, phoneArt } from "@phoenix/ui";
import { callerName, useCallStatus, usePeople } from "../lib/hooks";

/** Height of the alert, in legacy pixels. */
export const INCOMING_ALERT_HEIGHT = 150;

/** Is this page the incoming-call alert? */
export function isIncomingAlert(): boolean {
    return new URLSearchParams(location.search).get("alert") === "incoming";
}

/**
 * The app's own page: open the alert for each call that starts ringing,
 * and bring the Phone card up when one is answered.
 */
export function useIncomingAlert(calls: readonly Call[], people: readonly Person[]) {
    const opened = useRef(new Set<string>());
    const ringing = useRef(new Set<number>());
    const ring = ringingCall(calls);
    useEffect(() => {
        if (!ring) return;
        const key = `${ring.startTime}-${ring.id}`;
        ringing.current.add(ring.id);
        if (opened.current.has(key)) return;
        opened.current.add(key);
        const name = matchNumber(people, ring.number) ? "incoming-known" : "incoming-unknown";
        window.open("index.html?alert=incoming", name,
                    `height=${INCOMING_ALERT_HEIGHT}, attributes={"window":"popupalert"}`);
    }, [ring, people]);
    // Answered (here or in the alert): the card comes up for the call.
    const active = calls.find((c) => c.state === "active" && ringing.current.has(c.id));
    useEffect(() => {
        if (!active) return;
        ringing.current.delete(active.id);
        (globalThis as { PalmSystem?: { activate?: () => void } }).PalmSystem?.activate?.();
    }, [active]);
}

export function IncomingAlert() {
    const status = useCallStatus();
    const people = usePeople();
    const [pulse, setPulse] = useState(false);
    const seen = useRef(false);
    const call = ringingCall(status.calls);
    useEffect(() => {
        const t = setInterval(() => setPulse((p) => !p), 700);
        return () => clearInterval(t);
    }, []);
    // Close once the call stops ringing (answered, ignored or hung up).
    useEffect(() => {
        if (call) seen.current = true;
        else if (seen.current) window.close();
    }, [call]);
    if (!call)
        return <div className="incoming-alert" />;
    const waiting = !!primaryCall(status.calls);
    const match = matchNumber(people, call.number);
    const name = callerName(call, people);
    const answer = () => telephony.answer(call.id).catch(() => {});
    const ignore = () => telephony.ignore(call.id).catch(() => {});
    return (
        <div className="incoming-alert" data-testid="incoming-alert">
            <div className="incoming-alert-who">
                <img className="incoming-alert-glyph" src={pulse ? phoneArt.incomingOn : phoneArt.incomingOff} alt="" />
                <div className="incoming-alert-text">
                    <div className="incoming-alert-label">{waiting ? "Call Waiting" : "Incoming Call"}</div>
                    <div className="incoming-alert-name" data-testid="incoming-name">{name}</div>
                    <div className="incoming-alert-number">
                        {match ? `${phoneTypeLabel(match.number.type)} ${formatNumber(call.number)}`
                               : name !== formatNumber(call.number) ? formatNumber(call.number) : " "}
                    </div>
                </div>
            </div>
            <div className="incoming-alert-buttons">
                <Button variant="affirmative" data-testid="answer" onClick={answer}>{waiting ? "Hold & Answer" : "Answer"}</Button>
                <Button variant="negative" data-testid="ignore" onClick={ignore}>Ignore</Button>
            </div>
        </div>
    );
}
