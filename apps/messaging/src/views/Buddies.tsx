// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Buddies: the instant messaging accounts and their buddies, as webOS
// Messaging's Buddies view had them. Each account says how you appear
// (Available, Busy, Offline: tap to change it, as webOS's status menu);
// the buddies of signed-in accounts follow under Available, Busy and
// Offline, with their status message, and a tap starts or opens the
// conversation with them. Accounts are added in Accounts (Jabber (XMPP),
// the simulated server's in the simulator). The closed networks webOS
// reached (AIM, Google Talk, ...) are listed as not available.

import { apps, AVAILABILITY, IM_SERVICES, presenceClass, serviceLabel, type ImBuddy, type ImLoginState,
         type Person } from "@phoenix/luna";
import { Avatar, Button, Divider, Group, ListSelector, Note, Row } from "@phoenix/ui";
import { buddyRecipient, groupBuddies, presenceText, type Recipient } from "../lib/threads";
import { Presence } from "../icons";

const ACCOUNTS_APP = "com.palm.app.accounts";

const MY_STATUS = [
    { label: "Available", value: AVAILABILITY.AVAILABLE },
    { label: "Busy", value: AVAILABILITY.BUSY },
    { label: "Offline", value: AVAILABILITY.OFFLINE },
];

export function Buddies({ accounts, buddies, people, onSetPresence, onOpen }: {
    accounts: readonly ImLoginState[];
    buddies: readonly ImBuddy[];
    people: readonly Person[];
    onSetPresence: (accountId: string, availability: number) => void;
    onOpen: (r: Recipient) => void;
}) {
    const online = accounts.filter((a) => a.state === "online");
    const shown = buddies.filter((b) => online.some((a) => a.accountId === b.accountId));
    const groups = groupBuddies(shown);
    const photoOf = (b: ImBuddy) => {
        const p = b.personId ? people.find((x) => x._id === b.personId) : undefined;
        return p?.photos?.localPathList || p?.photos?.localPathSquare;
    };
    return (
        <div className="buddies">
            {accounts.length > 0 && (
                <Group label="My Status">
                    {accounts.map((a) => (
                        <ListSelector key={a.accountId} testId={"im-account-" + a.username}
                                      title={<span className="buddy-account"><Presence availability={a.state === "online" ? a.availability : 4} />
                                          <span><span className="buddy-account-name">{a.username}</span>
                                          <small>{serviceLabel(a.serviceName)}</small></span></span>}
                                      value={a.state === "online" ? (presenceClass(a.availability) === "busy" ? AVAILABILITY.BUSY : AVAILABILITY.AVAILABLE)
                                                                  : AVAILABILITY.OFFLINE}
                                      options={MY_STATUS} onChange={(v) => onSetPresence(a.accountId, v)} />
                    ))}
                </Group>
            )}
            {groups.map((g) => (
                <div key={g.label} data-testid={"buddy-group-" + g.label.toLowerCase()}>
                    <Divider caption={g.label} />
                    <Group>
                        {g.buddies.map((b) => (
                            <Row key={b.accountId + b.username} testId="buddy" title={b.displayName || b.username}
                                 subtitle={presenceText(b)} icon={<Avatar size={36} src={photoOf(b)} />}
                                 onClick={() => { const r = buddyRecipient(b, accounts); if (r) onOpen(r); }}>
                                <Presence availability={b.availability} title={presenceText(b)} />
                            </Row>
                        ))}
                    </Group>
                </div>
            ))}
            {accounts.length === 0 ? (
                <Note>Add an instant messaging account to see your buddies and chat with them here.</Note>
            ) : online.length === 0 ? (
                <Note>Please sign in to an IM service to see your buddies.</Note>
            ) : null}
            <Button onClick={() => void apps.launch(ACCOUNTS_APP).catch(() => undefined)} data-testid="add-im-account">
                {accounts.length ? "Accounts" : "Add an IM Account"}
            </Button>
            <Group label="Other networks">
                {IM_SERVICES.filter((t) => !t.available).map((t) => (
                    <Row key={t.id} title={t.label} subtitle="Not available" disabled className="disabled"
                         testId="im-network" icon={<span className="presence offline" />} />
                ))}
            </Group>
        </div>
    );
}
