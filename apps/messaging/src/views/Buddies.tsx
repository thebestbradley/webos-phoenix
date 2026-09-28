// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Buddies view of webOS Messaging listed instant-messaging contacts and
// their presence (com.palm.imbuddystatus:1, from the IM transports of the
// Accounts app). Phoenix has no IM transport yet, so it shows which ones
// webOS had, unavailable.

import { TRANSPORTS } from "@phoenix/luna";
import { Group, Note, Row } from "@phoenix/ui";

export function Buddies() {
    return (
        <div className="buddies">
            <Group label="Instant messaging">
                {TRANSPORTS.filter((t) => !t.available).map((t) => (
                    <Row key={t.id} title={t.label} subtitle="Not available yet" disabled className="disabled"
                         testId="im-account" icon={<span className="presence offline" />} />
                ))}
            </Group>
            <Note>
                Phoenix sends and receives text messages (SMS). Instant messaging accounts
                will appear here, with your buddies and their status, once Phoenix has IM
                transports.
            </Note>
        </div>
    );
}
