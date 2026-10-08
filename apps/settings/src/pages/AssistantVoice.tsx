// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Voice: what the voice needs that this device does
// not have (org.webosphoenix.assistant voice: speech recognition, the wake
// word, spoken answers), each with one line on how to get it, so a missing
// part is said instead of the toggles quietly doing nothing. Nothing shows
// when everything is there, or where nobody knows (a browser).

import { useEffect, useState } from "react";
import { assistant, type VoicePart } from "@phoenix/luna";
import { Note } from "@phoenix/ui";

export function VoiceMissing() {
    const [parts, setParts] = useState<VoicePart[]>([]);
    useEffect(() => {
        let live = true;
        assistant.voice().then((p) => { if (live) setParts(p); }, () => {});
        return () => { live = false; };
    }, []);
    const missing = parts.filter((p) => !p.available);
    if (!missing.length) return null;
    return (
        <Note testId="as-voice-missing">
            {missing.map((p) => (
                <span key={p.id} data-testid={`as-voice-missing-${p.id}`} style={{ display: "block" }}>
                    {`Not installed here: ${p.name}. ${p.howToInstall}`}
                </span>
            ))}
        </Note>
    );
}
