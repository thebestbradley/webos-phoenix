// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Messages & Driving (docs/AI-AND-MCP.md, "Everyday
// features"; the service's lib/commands-notify.js):
//
//   Announce Messages   messages read aloud as they come while headphones
//                       are in (a wired headset, a Bluetooth headset); off
//                       by default ("announce my messages on my headphones")
//   Driving Mode        messages read aloud as they come, the reply
//                       listened for and read back before it is sent, the
//                       rest quiet (Do Not Disturb, back as it was after);
//                       "I'm driving", "I'm done driving"
//
// Both through org.webosphoenix.assistant: getSettings / setSettings
// (announceMessages) and driving.

import { useEffect, useState } from "react";
import { assistant, type AssistantSettings } from "@phoenix/luna";
import { Group, Row, ToggleButton } from "@phoenix/ui";

export function MessagesAndDriving({ settings: s, set, off }: { settings: AssistantSettings; set: (c: Partial<AssistantSettings>) => void; off: boolean }) {
    const [driving, setDriving] = useState<boolean | null>(null);
    useEffect(() => {
        let live = true;
        assistant.driving().then((r) => { if (live) setDriving(r.on); }, () => { if (live) setDriving(false); });
        return () => { live = false; };
    }, []);
    const drive = (on: boolean) => {
        setDriving(on);
        assistant.driving(on).then((r) => setDriving(r.on), () => setDriving(!on));
    };
    return (
        <Group label="Messages & Driving">
            <Row title="Announce Messages" subtitle="Read messages aloud as they come while headphones are in" disabled={off} testId="as-announce">
                <ToggleButton value={!!s.announceMessages} label="Announce Messages" testId="as-announce-toggle" disabled={off}
                              onChange={(v) => set({ announceMessages: v })} />
            </Row>
            <Row title="Driving Mode" subtitle="Read messages aloud, take replies by voice, and keep everything else quiet" disabled={off} testId="as-driving">
                <ToggleButton value={!!driving} label="Driving Mode" testId="as-driving-toggle" disabled={off || driving === null}
                              onChange={drive} />
            </Row>
        </Group>
    );
}
