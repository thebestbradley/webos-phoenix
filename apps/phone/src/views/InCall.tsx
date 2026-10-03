// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The active call screen: who, the call timer, mute / speaker / keypad /
// hold, and the red end button. The keypad sends touch tones (sendDtmf).
// A second call on hold shows as a bar that swaps the calls when tapped.

import { useState, type ReactNode } from "react";
import { matchNumber, phoneTypeLabel, telephony, type Call, type CallStatus, type Person } from "@phoenix/luna";
import { Avatar, Button, Dialpad, formatDuration, formatNumber, useBack } from "@phoenix/ui";
import { callerName, useTick } from "../lib/hooks";
import { HangUp, Keypad, MicOff, Pause, Speaker } from "../icons";

function statusText(c: Call, now: number): string {
    switch (c.state) {
    case "dialing": return "Dialing…";
    case "alerting": return "Calling…";
    case "held": return "On Hold";
    case "active": return formatDuration(now - (c.connectTime ?? now));
    case "disconnected": return "Call Ended";
    default: return "";
    }
}

function Control({ label, on, onClick, disabled, testId, children }: {
    label: string; on?: boolean; onClick: () => void; disabled?: boolean; testId: string; children: ReactNode;
}) {
    return (
        <button type="button" className={`call-control${on ? " on" : ""}`} onClick={onClick} disabled={disabled}
                aria-pressed={on} data-testid={testId}>
            {children}
            <span>{label}</span>
        </button>
    );
}

export function InCall({ status, call, people, onEnd }: { status: CallStatus; call: Call; people: readonly Person[]; onEnd?: () => void }) {
    const [keypad, setKeypad] = useState(false);
    const [tones, setTones] = useState("");
    const now = useTick(call.state === "active");
    useBack(() => { setKeypad(false); return true; }, keypad);
    const match = matchNumber(people, call.number);
    const name = callerName(call, people);
    const other = status.calls.find((c) => c.id !== call.id && c.state === "held");
    const connected = call.state === "active" || call.state === "held";
    const ended = call.state === "disconnected";

    const hangup = () => {
        telephony.hangup(call.id).catch(() => {});
        onEnd?.();
    };
    const toggleHold = () => {
        (call.state === "held" ? telephony.unhold(call.id) : telephony.hold(call.id)).catch(() => {});
    };
    const tone = (k: string) => {
        setTones((t) => (t + k).slice(-24));
        telephony.sendDtmf(k).catch(() => {});
    };

    return (
        <div className={`incall${keypad ? " with-keypad" : ""}`} data-testid="incall" data-state={call.state}>
            {other && (
                <button type="button" className="incall-held-bar" data-testid="swap"
                        onClick={() => telephony.unhold(other.id).catch(() => {})}>
                    <Pause /> <span>On hold: {callerName(other, people)}</span> <span className="swap">Swap</span>
                </button>
            )}
            <div className="incall-who">
                {!keypad && <Avatar size={96} src={match?.person.photos?.localPathBig} className="incall-avatar" />}
                <div className="incall-name" data-testid="incall-name">{name}</div>
                <div className="incall-number">
                    {match ? `${phoneTypeLabel(match.number.type)} ${formatNumber(call.number)}` : name !== formatNumber(call.number) ? formatNumber(call.number) : " "}
                </div>
                <div className={`incall-status ${call.state}`} data-testid="call-status">
                    {keypad && tones ? tones : statusText(call, now)}
                </div>
            </div>
            {keypad ? (
                <Dialpad onKey={tone} lettersHidden voicemailKey={false} testId="dtmf-pad" />
            ) : (
                <div className="call-controls">
                    <Control label="Mute" testId="mute" on={status.muted} disabled={ended}
                             onClick={() => telephony.setMuted(!status.muted).catch(() => {})}><MicOff /></Control>
                    <Control label="Speaker" testId="speaker" on={status.speaker} disabled={ended}
                             onClick={() => telephony.setSpeaker(!status.speaker).catch(() => {})}><Speaker /></Control>
                    <Control label="Keypad" testId="keypad" disabled={!connected} onClick={() => setKeypad(true)}><Keypad /></Control>
                    <Control label={call.state === "held" ? "Resume" : "Hold"} testId="hold" on={call.state === "held"}
                             disabled={!connected} onClick={toggleHold}><Pause /></Control>
                </div>
            )}
            <div className="incall-actions">
                {keypad && <Button variant="dark" className="incall-hide" onClick={() => setKeypad(false)}>Hide</Button>}
                <Button variant="negative" className="incall-end" data-testid="end-call" disabled={ended} onClick={hangup}
                        aria-label="End call">
                    <HangUp /> <span>End</span>
                </Button>
            </div>
        </div>
    );
}
