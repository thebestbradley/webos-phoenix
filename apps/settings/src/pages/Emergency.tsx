// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergency Info: the medical ID and the people to call, shown from the
// lock screen without unlocking (the PIN pad's Emergency Call, then
// Medical ID: Phone's restricted mode, apps/phone/src/views/Emergency.tsx).
// Legacy webOS had no such pane; the fields are the usual medical ID ones.
// Kept as the system preference emergencyInfo
// (com.webos.service.systemservice set/getPreferences) so the lock screen
// can read it with the device locked. Saved as you type, as webOS
// preference panes were.

import { useEffect, useRef, useState } from "react";
import {
    BLOOD_TYPES, emergencyInfo, contacts, personDisplayName, phoneTypeLabel,
    type EmergencyContact, type EmergencyInfo, type Person,
} from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Divider, Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton, formatNumber } from "@phoenix/ui";
import { useBack } from "../nav";

const RELATIONS = ["Spouse", "Partner", "Parent", "Child", "Sibling", "Friend", "Doctor", "Other"];

function FieldRow({ label, value, onChange, multiline, placeholder, testId, type }: {
    label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; testId: string; type?: string;
}) {
    return (
        <div className="pui-row emergency-field">
            <div className="emergency-field-label">{label}</div>
            {multiline ? (
                <textarea className="emergency-input" rows={2} value={value} placeholder={placeholder} data-testid={testId}
                          onChange={(e) => onChange(e.target.value)} />
            ) : (
                <input className="emergency-input" value={value} placeholder={placeholder} data-testid={testId} type={type ?? "text"}
                       autoComplete="off" onChange={(e) => onChange(e.target.value)} />
            )}
        </div>
    );
}

/** Pick a person, then (if they have several) one of their numbers. */
function ContactPicker({ open, onPick, onClose }: { open: boolean; onPick: (c: EmergencyContact) => void; onClose: () => void }) {
    const people = useLuna<Person[]>((cb, err) => (open ? contacts.watchAll(cb, err) : null), [open]).value ?? [];
    const [person, setPerson] = useState<Person | null>(null);
    useEffect(() => { if (!open) setPerson(null); }, [open]);
    const withNumbers = people.filter((p) => (p.phoneNumbers ?? []).length > 0);
    const pick = (p: Person, n: string) => onPick({ personId: p._id, name: personDisplayName(p), number: n, relation: "Other" });
    return (
        <Dialog open={open} title={person ? personDisplayName(person) : "Emergency contact"} onClose={onClose} testId="contact-picker">
            <div className="emergency-picker">
                {!person && withNumbers.length === 0 && <Note>No contacts with a phone number.</Note>}
                {!person && withNumbers.map((p) => (
                    <button key={p._id} type="button" className="emergency-pick" data-testid={`pick-${personDisplayName(p)}`}
                            onClick={() => (p.phoneNumbers!.length === 1 ? pick(p, p.phoneNumbers![0].value) : setPerson(p))}>
                        {personDisplayName(p)}
                    </button>
                ))}
                {person && person.phoneNumbers!.map((n) => (
                    <button key={n.value} type="button" className="emergency-pick" onClick={() => pick(person, n.value)}>
                        {formatNumber(n.value)} <span className="emergency-pick-type">{phoneTypeLabel(n.type)}</span>
                    </button>
                ))}
            </div>
            <Button variant="dark" onClick={person ? () => setPerson(null) : onClose}>{person ? "Back" : "Cancel"}</Button>
        </Dialog>
    );
}

export function EmergencyPage() {
    const saved = useLuna<EmergencyInfo>((cb, err) => emergencyInfo.watch(cb, err), []).value;
    const [info, setInfo] = useState<EmergencyInfo | null>(null);
    const [picking, setPicking] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const latest = useRef<EmergencyInfo | null>(null);
    useBack(() => { setPicking(false); return true; }, picking);

    // The first answer fills the form; after that the form is the truth.
    useEffect(() => { if (saved && !info) setInfo(saved); }, [saved, info]);
    // Save what is pending when the page goes.
    useEffect(() => () => {
        if (timer.current && latest.current) {
            clearTimeout(timer.current);
            void emergencyInfo.set(latest.current);
        }
    }, []);

    if (!info) return <Page><PageHeader title="Emergency Info" icon="icons/emergency.png" /></Page>;

    const update = (changes: Partial<EmergencyInfo>, now = false) => {
        const next = { ...info, ...changes };
        setInfo(next);
        latest.current = next;
        clearTimeout(timer.current);
        const save = () => { timer.current = undefined; void emergencyInfo.set(next); };
        if (now) save();
        else timer.current = setTimeout(save, 400);
    };
    const people = info.contacts ?? [];
    const setContact = (i: number, c: EmergencyContact | null) => {
        const list = [...people];
        if (c) list[i] = c; else list.splice(i, 1);
        update({ contacts: list }, true);
    };

    return (
        <Page>
            <PageHeader title="Emergency Info" icon="icons/emergency.png" />
            <Note>
                Anyone holding your phone can read this without unlocking it: on the lock screen, tap Emergency Call on the
                PIN pad, then Medical ID. Emergency workers look for it there.
            </Note>
            <Group>
                <Row title="Show when locked">
                    <ToggleButton value={info.showWhenLocked !== false} label="Show when locked" testId="show-when-locked"
                                  onChange={(v) => update({ showWhenLocked: v }, true)} />
                </Row>
            </Group>

            <Group label="Medical ID">
                <FieldRow label="Name" value={info.name ?? ""} onChange={(v) => update({ name: v })} testId="ice-name"
                          placeholder="Your name" />
                <FieldRow label="Born" value={info.birthDate ?? ""} onChange={(v) => update({ birthDate: v })} testId="ice-born"
                          type="date" />
                <ListSelector<string> title="Blood type" value={info.bloodType ?? ""} testId="ice-blood"
                                      options={[{ label: "Unknown", value: "" }, ...BLOOD_TYPES.map((b) => ({ label: b, value: b }))]}
                                      onChange={(v) => update({ bloodType: v }, true)} />
                <Row title="Organ donor">
                    <ToggleButton value={!!info.organDonor} label="Organ donor" testId="ice-donor" onLabel="Yes" offLabel="No"
                                  onChange={(v) => update({ organDonor: v }, true)} />
                </Row>
            </Group>

            <Group label="Health">
                <FieldRow label="Medical conditions" multiline value={info.conditions ?? ""} testId="ice-conditions"
                          onChange={(v) => update({ conditions: v })} placeholder="Asthma, diabetes, ..." />
                <FieldRow label="Allergies and reactions" multiline value={info.allergies ?? ""} testId="ice-allergies"
                          onChange={(v) => update({ allergies: v })} placeholder="Penicillin, peanuts, ..." />
                <FieldRow label="Medications" multiline value={info.medications ?? ""} testId="ice-medications"
                          onChange={(v) => update({ medications: v })} />
                <FieldRow label="Notes" multiline value={info.notes ?? ""} testId="ice-notes"
                          onChange={(v) => update({ notes: v })} placeholder="Anything a medic should know" />
            </Group>

            <Divider caption="Emergency contacts" />
            <Group>
                {people.map((c, i) => (
                    <div key={`${c.number}-${i}`} className="emergency-contact" data-testid={`ice-contact-${i}`}>
                        <ListSelector<string> title={<>{c.name}<div className="pui-row-subtitle">{formatNumber(c.number)}</div></>}
                                              value={c.relation ?? "Other"}
                                              options={RELATIONS.map((r) => ({ label: r, value: r }))}
                                              onChange={(r) => setContact(i, { ...c, relation: r })} />
                        <button type="button" className="emergency-remove" aria-label={`Remove ${c.name}`}
                                data-testid={`ice-remove-${i}`} onClick={() => setContact(i, null)} />
                    </div>
                ))}
                <Row title="Add a contact" chevron onClick={() => setPicking(true)} testId="ice-add-contact" />
            </Group>
            <Note>They can be called from the lock screen too.</Note>

            <ContactPicker open={picking} onClose={() => setPicking(false)}
                           onPick={(c) => { setPicking(false); update({ contacts: [...people, c] }, true); }} />
        </Page>
    );
}
