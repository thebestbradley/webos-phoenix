// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Call log: all calls or just the missed ones, by day, newest first. A tap
// calls the number back. Voicemail sits at the top (a stub for now: it
// dials the voicemail number, as the webOS voicemail key did).

import { useState } from "react";
import { matchNumber, personDisplayName, phoneTypeLabel, type Person, type VoicemailStatus } from "@phoenix/luna";
import { RadioToolGroup, dayLabel, formatDuration, formatNumber, shortWhen } from "@phoenix/ui";
import { groupByDay, isMissed, otherParty, type PhoneCall } from "../lib/calllog";
import { useCallLog } from "../lib/hooks";
import { Incoming, Missed, Outgoing, Voicemail } from "../icons";

export interface CallLogProps {
    people: readonly Person[];
    voicemail: VoicemailStatus | null;
    onCall: (number: string) => void;
    onVoicemail: () => void;
}

function Row({ r, people, onCall }: { r: PhoneCall; people: readonly Person[]; onCall: (n: string) => void }) {
    const p = otherParty(r);
    const match = p.addr ? matchNumber(people, p.addr) : null;
    const name = match ? personDisplayName(match.person) : p.name || formatNumber(p.addr) || "Unknown";
    const missed = isMissed(r);
    // A contact's number shows its type; a stranger's number is already the title.
    const detail = match || p.personAddressType ? phoneTypeLabel(match?.number.type ?? p.personAddressType)
        : p.name ? formatNumber(p.addr) : "";
    const what = missed ? (r.type === "ignored" ? "Ignored" : "Missed")
        : formatDuration(r.duration) + (r.type === "outgoing" ? " · Outgoing" : "");
    return (
        <div className={`phone-row call-row${missed ? " missed" : ""}`} role="button" tabIndex={0} data-testid="call-row"
             onClick={() => p.addr && onCall(p.addr)}
             onKeyDown={(e) => { if (e.key === "Enter" && p.addr) onCall(p.addr); }}>
            <span className={`call-kind ${r.type}`} title={r.type}>
                {missed ? <Missed /> : r.type === "outgoing" ? <Outgoing /> : <Incoming />}
            </span>
            <div className="phone-row-body">
                <div className="phone-row-title">{name}</div>
                <div className="phone-row-sub">{[detail, what].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="phone-row-when">{shortWhen(r.timestamp)}</div>
        </div>
    );
}

export function CallLog({ people, voicemail, onCall, onVoicemail }: CallLogProps) {
    const [filter, setFilter] = useState<"all" | "missed">("all");
    const calls = useCallLog(filter === "missed");
    return (
        <div className="phone-list-view">
            <div className="phone-header">
                <div className="phone-header-title" role="heading" aria-level={1}>Call Log</div>
                <RadioToolGroup testId="log-filter" value={filter} onChange={setFilter} className="small"
                                options={[{ value: "all", label: "All" }, { value: "missed", label: "Missed" }]} />
            </div>
            <div className="phone-scroll">
                {voicemail && (
                    <div className="phone-row voicemail-row" role="button" tabIndex={0} data-testid="voicemail"
                         onClick={onVoicemail} onKeyDown={(e) => { if (e.key === "Enter") onVoicemail(); }}>
                        <span className="call-kind voicemail"><Voicemail /></span>
                        <div className="phone-row-body">
                            <div className="phone-row-title">Voicemail</div>
                            <div className="phone-row-sub">{formatNumber(voicemail.number)}</div>
                        </div>
                        {voicemail.count > 0 && <span className="phone-count">{voicemail.count} new</span>}
                    </div>
                )}
                {calls && calls.length === 0 && (
                    <div className="phone-empty">{filter === "missed" ? "No missed calls" : "No recent calls"}</div>
                )}
                {calls && groupByDay(calls).map((g) => (
                    <section key={g.day}>
                        <div className="phone-divider"><span>{dayLabel(g.day)}</span></div>
                        {g.items.map((r) => <Row key={r._id} r={r} people={people} onCall={onCall} />)}
                    </section>
                ))}
            </div>
        </div>
    );
}
