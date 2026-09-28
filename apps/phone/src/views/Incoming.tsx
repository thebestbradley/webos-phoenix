// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Incoming call: who is calling, the pulsing green handset of the webOS
// lock screen's incoming-call alert, and Answer / Ignore in a popup panel
// at the bottom, like the webOS incoming-call popup. With a call already
// up, Answer holds it ("Hold & Answer").

import { useEffect, useState } from "react";
import { matchNumber, phoneTypeLabel, telephony, type Call, type Person } from "@phoenix/luna";
import { Button, formatNumber, phoneArt } from "@phoenix/ui";
import { callerName } from "../lib/hooks";

export function Incoming({ call, people, waiting }: { call: Call; people: readonly Person[]; waiting: boolean }) {
    const [pulse, setPulse] = useState(false);
    useEffect(() => {
        const t = setInterval(() => setPulse((p) => !p), 700);
        return () => clearInterval(t);
    }, []);
    const match = matchNumber(people, call.number);
    const name = callerName(call, people);
    return (
        <div className="incoming" data-testid="incoming">
            <div className="incoming-label">{waiting ? "Call Waiting" : "Incoming Call"}</div>
            <div className="incoming-who">
                <div className="incoming-glyph">
                    <img src={pulse ? phoneArt.incomingOn : phoneArt.incomingOff} alt="" />
                </div>
                <div className="incall-name" data-testid="incoming-name">{name}</div>
                <div className="incall-number">
                    {match ? `${phoneTypeLabel(match.number.type)} ${formatNumber(call.number)}` : name !== formatNumber(call.number) ? formatNumber(call.number) : " "}
                </div>
            </div>
            <div className="incoming-popup">
                <Button variant="affirmative" data-testid="answer" onClick={() => telephony.answer(call.id).catch(() => {})}>
                    {waiting ? "Hold & Answer" : "Answer"}
                </Button>
                <Button variant="negative" data-testid="ignore" onClick={() => telephony.ignore(call.id).catch(() => {})}>
                    Ignore
                </Button>
            </div>
        </div>
    );
}
