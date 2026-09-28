// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The dial pad view: the number being dialled (with the contact it belongs
// to), the webOS dial pad and the dial button. Hold 0 for +, hold 1 for
// voicemail; an empty dial button recalls the last number dialled, as on
// webOS. A hardware keyboard types into it too.

import { useEffect } from "react";
import { matchNumber, personDisplayName, phoneTypeLabel, type Person } from "@phoenix/luna";
import { BackspaceButton, DialButton, Dialpad, formatNumber } from "@phoenix/ui";

export interface DialerProps {
    number: string;
    setNumber: (n: string) => void;
    people: readonly Person[];
    error: string | null;
    onDial: (number: string) => void;
    onVoicemail: () => void;
    /** The last number dialled, for the empty dial button. */
    lastDialed?: string;
    /** Listen to the hardware keyboard (only while the dial pad is showing). */
    keyboard: boolean;
}

export function Dialer({ number, setNumber, people, error, onDial, onVoicemail, lastDialed, keyboard }: DialerProps) {
    const digits = number.replace(/[^0-9]/g, "");
    const match = digits.length >= 7 ? matchNumber(people, number) : null;
    const shown = formatNumber(number);

    const dial = () => {
        if (!number) {
            if (lastDialed) setNumber(lastDialed);
            return;
        }
        onDial(number);
    };

    useEffect(() => {
        if (!keyboard) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (/^[0-9*#+]$/.test(e.key)) setNumber(number + e.key);
            else if (e.key === "Backspace") setNumber(number.slice(0, -1));
            else if (e.key === "Enter") dial();
            else return;
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    return (
        <div className="dialer">
            <div className="dialer-display">
                <div className="dialer-contact" data-testid="dialer-contact">
                    {error ? <span className="dialer-error" role="alert">{error}</span>
                        : match ? `${personDisplayName(match.person)} · ${phoneTypeLabel(match.number.type)}` : " "}
                </div>
                <div className="dialer-number-row">
                    <div className={`dialer-number${shown.length > 16 ? " long" : shown.length > 11 ? " mid" : ""}${number ? "" : " empty"}`}
                         data-testid="number-display">
                        {shown || "Enter a number"}
                    </div>
                    {number && <BackspaceButton testId="backspace" onClick={() => setNumber(number.slice(0, -1))} onHold={() => setNumber("")} />}
                </div>
            </div>
            <Dialpad testId="dialpad"
                     onKey={(k) => setNumber(number.length < 40 ? number + k : number)}
                     onHold={(what) => (what === "+" ? setNumber(number + "+") : onVoicemail())} />
            <div className="dialer-dial">
                <DialButton testId="dial-button" onClick={dial} label={number ? `Call ${shown}` : "Call"} />
            </div>
        </div>
    );
}
