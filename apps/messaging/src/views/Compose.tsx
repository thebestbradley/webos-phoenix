// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A new message: the "To:" field suggests contacts (com.palm.person:1) as
// you type a name or number, like the webOS addressing widget, and the
// buddies of signed-in IM accounts; a typed number works too. A message to
// a buddy goes by their IM service; to a number, as a text, or a picture
// message with a picture attached. Sending opens the conversation it went
// to.

import { useState } from "react";
import { messaging, type ImBuddy, type ImLoginState, type MessagePart, type Person } from "@phoenix/luna";
import { Avatar, formatNumber } from "@phoenix/ui";
import { suggestBuddies, suggestRecipients, typedRecipient, type Recipient } from "../lib/threads";
import { Presence } from "../icons";
import { ComposeBar } from "./ComposeBar";

export function Compose({ people, buddies, accounts, onSent, initialTo, initialText, initialParts }: {
    people: readonly Person[];
    buddies: readonly ImBuddy[];
    accounts: readonly ImLoginState[];
    onSent: (threadId: string) => void;
    initialTo?: Recipient | null;
    /** Text to start with (launch param messageText, e.g. a location shared from Maps). */
    initialText?: string;
    /** Pictures to start with (shared from Photos or the share sheet). */
    initialParts?: MessagePart[];
}) {
    const [to, setTo] = useState<Recipient | null>(initialTo ?? null);
    const [typed, setTyped] = useState("");
    const [error, setError] = useState<string | null>(null);
    const suggestions = to ? [] : [...suggestRecipients(people, typed), ...suggestBuddies(buddies, accounts, typed)];
    const asTyped = to ? null : typedRecipient(typed);

    const send = (text: string, parts: MessagePart[]) => {
        const r = to ?? asTyped;
        if (!r) { setError("Choose who to send this to"); return; }
        setError(null);
        const addr = { addr: r.addr, name: r.name };
        const sent = r.service && r.account ? messaging.sendIm(r.service, r.account, addr, text, undefined, parts)
            : parts.length ? messaging.sendMms(addr, text, parts)
            : messaging.sendSms(addr, text);
        sent.then((ids) => { if (ids[0]) onSent(ids[0]); }, (e) => setError(e.errorText ?? e.message ?? "Could not send"));
    };
    const buddyOf = (r: Recipient) => r.service ? buddies.find((b) => b.username === r.addr && b.serviceName === r.service) : undefined;

    return (
        <div className="compose">
            <div className="msg-header"><div className="msg-header-inner">
                <div className="msg-header-text"><div className="msg-header-title">New Message</div></div>
            </div></div>
            <div className="to-field">
                <span className="to-label">To:</span>
                {to ? (
                    <button type="button" className="recipient-chip" data-testid="recipient-chip"
                            onClick={() => { setTo(null); setTyped(""); }} title="Remove">
                        {to.service && <Presence availability={buddyOf(to)?.availability} />}
                        {to.name ?? formatNumber(to.addr)}{to.label && <small> {to.label}</small>}
                        <span className="chip-x" aria-hidden="true">×</span>
                    </button>
                ) : (
                    <input data-testid="recipient-input" value={typed} autoFocus placeholder="Name, number or IM address"
                           autoComplete="off" spellCheck={false}
                           onChange={(e) => setTyped(e.target.value)}
                           onKeyDown={(e) => {
                               if (e.key === "Enter") {
                                   e.preventDefault();
                                   const pick = suggestions[0] ?? asTyped;
                                   if (pick) setTo(pick);
                               }
                           }} />
                )}
            </div>
            <div className="suggestions">
                {suggestions.map((r) => {
                    const p = people.find((x) => x._id === r.personId);
                    return (
                        <div key={(r.service ?? "tel") + r.personId + r.addr} className="suggestion" role="option" aria-selected={false} tabIndex={0}
                             data-testid="recipient-option" onClick={() => setTo(r)}
                             onKeyDown={(e) => { if (e.key === "Enter") setTo(r); }}>
                            <Avatar size={36} src={p?.photos?.localPathList} />
                            <div className="suggestion-body">
                                <div className="suggestion-name">{r.service && <Presence availability={buddyOf(r)?.availability} />}{r.name}</div>
                                <div className="suggestion-sub">{r.label} {r.service ? r.addr : formatNumber(r.addr)}</div>
                            </div>
                        </div>
                    );
                })}
                {asTyped && suggestions.length === 0 && (
                    <div className="suggestion" role="option" aria-selected={false} tabIndex={0} data-testid="recipient-option"
                         onClick={() => setTo(asTyped)}>
                        <Avatar size={36} />
                        <div className="suggestion-body">
                            <div className="suggestion-name">{formatNumber(asTyped.addr)}</div>
                            <div className="suggestion-sub">Send to this number</div>
                        </div>
                    </div>
                )}
                {error && <div className="compose-error" role="alert">{error}</div>}
            </div>
            <ComposeBar onSend={send} autoFocus={!!to} initialText={initialText} initialParts={initialParts} service={to?.service ?? "sms"} />
        </div>
    );
}
