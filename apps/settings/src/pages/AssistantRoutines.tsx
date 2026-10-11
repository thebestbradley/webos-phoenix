// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Routines (docs/AI-AND-MCP.md, "Everyday
// features"; the service's lib/commands-routines.js): a routine is a name,
// the words that start it ("good night"), its steps in turn (each a request
// as you would say it, picked from a list with what it needs filled in, or
// anything else you would ask), and when else it runs: at a time on some
// days (the activity manager wakes the Assistant then), when the phone is
// put on charge, when it connects to a car. "Good night" and "Good
// morning" are offered as starters, off until added. Steps never send,
// call or delete: the service checks each one when it is saved and says
// which cannot be a step. Launch params {page: "assistant", section:
// "routines"} open this list (the Assistant's "make a routine").

import { useEffect, useState } from "react";
import { assistant, type LunaError, type Routine, type RoutineTemplate } from "@phoenix/luna";
import { Button, Dialog, ErrorText, Group, ListSelector, Note, Page, PageHeader, PopupMenu, Row, TextField, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";

const errorText = (e: unknown) => (e as LunaError).errorText ?? (e instanceof Error ? e.message : String(e));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

function timeLabel(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function daysLabel(days: number[]): string {
    if (!days.length || days.length === 7) return "every day";
    const d = [...days].sort().join(",");
    if (d === "1,2,3,4,5") return "weekdays";
    if (d === "0,6") return "weekends";
    return days.map((x) => DAYS[x]).join(", ");
}
/** "Says “good night” · 10:30 PM weekdays · on charge" */
export function routineSummary(r: Routine): string {
    const parts = [`Say “${r.phrases[0] ?? r.name}”`];
    if (r.time) parts.push(`${timeLabel(r.time)} ${daysLabel(r.days)}`);
    if (r.events.includes("charging")) parts.push("on charge");
    if (r.events.includes("car")) parts.push("in the car");
    return parts.join(" · ");
}

// ---- One routine ----------------------------------------------------------------------------

function RoutineEditor({ start, templates, onDone }: { start: Routine; templates: RoutineTemplate[]; onDone: () => void }) {
    const [name, setName] = useState(start.name);
    const [phrases, setPhrases] = useState(start.phrases.join(", "));
    const [steps, setSteps] = useState(start.steps.map((s) => s.text));
    const [time, setTime] = useState(start.time);
    const [days, setDays] = useState<number[]>(start.days);
    const [events, setEvents] = useState(start.events);
    const [enabled, setEnabled] = useState(start.enabled);
    const [adding, setAdding] = useState<HTMLElement | null>(null);
    const [filling, setFilling] = useState<{ t: RoutineTemplate; values: Record<string, string> } | null>(null);
    const [error, setError] = useState("");
    const [ran, setRan] = useState("");
    const [busy, setBusy] = useState("");
    const [removing, setRemoving] = useState(false);
    useBack(() => { onDone(); return true; });

    const draft = (): Partial<Routine> => ({ ...(start.id ? { id: start.id } : {}), name, phrases: phrases.split(",").map((p) => p.trim()).filter(Boolean),
                                             steps: steps.map((text) => ({ text })), time, days, events, enabled, starter: start.starter });
    const save = () => {
        setBusy("save");
        setError("");
        assistant.setRoutine(draft()).then(onDone, (e) => setError(errorText(e))).finally(() => setBusy(""));
    };
    const runNow = () => {
        setBusy("run");
        setError("");
        assistant.setRoutine(draft()).then((r) => assistant.runRoutine(r.routine.id)).then(setRan, (e) => setError(errorText(e))).finally(() => setBusy(""));
    };
    const pick = (t: RoutineTemplate) => {
        setAdding(null);
        if (!t.fields || !Object.keys(t.fields).length) setSteps([...steps, t.text]);
        else setFilling({ t, values: { ...t.fields } });
    };
    const filled = (f: { t: RoutineTemplate; values: Record<string, string> }) =>
        f.t.text.replace(/\{(\w+)\}/g, (_, k: string) => (f.values[k] ?? "").trim());
    const move = (i: number, by: number) => {
        const next = [...steps];
        const [s] = next.splice(i, 1);
        next.splice(i + by, 0, s);
        setSteps(next);
    };
    const toggleDay = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
    const toggleEvent = (e: "charging" | "car", on: boolean) => setEvents(on ? [...events.filter((x) => x !== e), e] : events.filter((x) => x !== e));

    return (
        <Page>
            <PageHeader title={start.id ? name || "Routine" : "New Routine"} icon="icons/assistant.png" />
            <Group label="Routine">
                <div className="field-row"><TextField label="Name" value={name} onChange={setName} testId="rt-name" placeholder="Good night" /></div>
                <div className="field-row">
                    <TextField label="Words that start it" value={phrases} onChange={setPhrases} testId="rt-phrases"
                               placeholder={(name.toLowerCase() || "good night") + ", more, with commas"} />
                </div>
                <Row title="On" subtitle={enabled ? "Runs when you say it, and at the times below" : "Off: it doesn't run"}>
                    <ToggleButton value={enabled} label="Routine on" testId="rt-enabled" onChange={setEnabled} />
                </Row>
            </Group>
            <Group label="Steps, in turn">
                {steps.map((s, i) => (
                    <div key={i} className="rt-step" data-testid={`rt-step-${i}`}>
                        <div className="rt-step-text">{i + 1}. {s}</div>
                        <div className="rt-step-buttons">
                            <Button disabled={i === 0} onClick={() => move(i, -1)} data-testid={`rt-step-up-${i}`} aria-label="Move up">{"↑"}</Button>
                            <Button disabled={i === steps.length - 1} onClick={() => move(i, 1)} data-testid={`rt-step-down-${i}`} aria-label="Move down">{"↓"}</Button>
                            <Button variant="negative" onClick={() => setSteps(steps.filter((_, j) => j !== i))} data-testid={`rt-step-remove-${i}`} aria-label="Remove">{"×"}</Button>
                        </div>
                    </div>
                ))}
                {!steps.length && <Row title="No steps yet" subtitle="Add what it should do, in the order it should do it" />}
            </Group>
            {filling && (
                <Group label={filling.t.label}>
                    {Object.keys(filling.values).map((k) => (
                        <div key={k} className="field-row">
                            <TextField label={k === "request" ? "Ask" : k.charAt(0).toUpperCase() + k.slice(1)} value={filling.values[k]} testId={`rt-field-${k}`} autoFocus
                                       onChange={(v) => setFilling({ ...filling, values: { ...filling.values, [k]: v } })} />
                        </div>
                    ))}
                    <Button variant="affirmative" data-testid="rt-field-add" disabled={!filled(filling).trim()}
                            onClick={() => { setSteps([...steps, filled(filling)]); setFilling(null); }}>Add Step</Button>
                </Group>
            )}
            <Button data-testid="rt-add-step" disabled={steps.length >= 12} onClick={(e) => setAdding(e.currentTarget)}>Add a Step…</Button>
            <Note>Steps can do and tell anything you could ask, except send, call or delete: those always ask you first.</Note>
            <Group label="Also run it">
                <Row title="At a time" subtitle={time ? `${timeLabel(time)}, ${daysLabel(days)}` : "Only when you say it"}>
                    <ToggleButton value={!!time} label="At a time" testId="rt-timed" onChange={(v) => setTime(v ? time || "22:30" : "")} />
                </Row>
                {time && <ListSelector title="Time" value={time} testId="rt-time" options={TIMES.map((t) => ({ label: timeLabel(t), value: t }))} onChange={setTime} />}
                {time && (
                    <Row title="Days" subtitle={daysLabel(days)}>
                        <div className="rt-days">
                            {DAYS.map((d, i) => (
                                <Button key={d} variant={days.includes(i) ? "affirmative" : "default"} data-testid={`rt-day-${i}`} onClick={() => toggleDay(i)}>{d}</Button>
                            ))}
                        </div>
                    </Row>
                )}
                <Row title="When put on charge">
                    <ToggleButton value={events.includes("charging")} label="When put on charge" testId="rt-charging" onChange={(v) => toggleEvent("charging", v)} />
                </Row>
                <Row title="When connected to a car" subtitle="Its Bluetooth">
                    <ToggleButton value={events.includes("car")} label="When connected to a car" testId="rt-car" onChange={(v) => toggleEvent("car", v)} />
                </Row>
            </Group>
            {error && <ErrorText testId="rt-error">{error}</ErrorText>}
            {ran && <Note testId="rt-ran">{ran}</Note>}
            <Button variant="affirmative" data-testid="rt-save" busy={busy === "save"} disabled={!name.trim() || !steps.length} onClick={save}>Save</Button>
            <Button data-testid="rt-run" busy={busy === "run"} disabled={!name.trim() || !steps.length} onClick={runNow}>Save and Run Now</Button>
            {start.id && <Button variant="negative" data-testid="rt-delete" onClick={() => setRemoving(true)}>Delete Routine</Button>}
            {adding && (
                <PopupMenu anchor={adding} options={templates.map((t) => ({ label: t.label, value: t }))} onClose={() => setAdding(null)} onSelect={pick} />
            )}
            <Dialog open={removing} onClose={() => setRemoving(false)} testId="rt-delete-dialog" title="Delete this routine?" message={`“${name}” won't run again.`}>
                <Button variant="negative" data-testid="rt-delete-confirm" onClick={() => { void assistant.removeRoutine(start.id).then(onDone); }}>Delete</Button>
                <Button onClick={() => setRemoving(false)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}

// ---- The list ----------------------------------------------------------------------------------

type Lists = { routines: Routine[]; starters: Routine[]; templates: RoutineTemplate[] };
const EMPTY: Routine = { id: "", name: "", phrases: [], steps: [], time: "", days: [], events: [], enabled: true };

/** open: a routine's id to open in the editor at once (the Assistant's "change my good night routine"). */
export function RoutinesPage({ onDone, open }: { onDone: () => void; open?: string }) {
    const [lists, setLists] = useState<Lists | null>(null);
    const [editing, setEditing] = useState<Routine | null>(null);
    const [error, setError] = useState("");
    const load = () => { assistant.routines().then(setLists, (e) => setError(errorText(e))); };
    useEffect(load, []);
    const [opened, setOpened] = useState(false);
    useEffect(() => {
        if (!open || opened || !lists) return;
        setOpened(true);
        const r = lists.routines.find((x) => x.id === open);
        if (r) setEditing(r);
    }, [open, opened, lists]);
    useBack(() => { onDone(); return true; }, !editing);

    if (editing && lists) return <RoutineEditor start={editing} templates={lists.templates} onDone={() => { setEditing(null); load(); }} />;
    const added = new Set((lists?.routines ?? []).map((r) => r.starter).filter(Boolean));
    const flip = (r: Routine, on: boolean) => { void assistant.setRoutine({ ...r, enabled: on }).then(load, (e) => setError(errorText(e))); };
    return (
        <Page>
            <PageHeader title="Routines" icon="icons/assistant.png" />
            <Note>A routine does several things when you say its words, and at a time if you like: say “good night” to turn on Do Not Disturb, hear tomorrow’s first meeting and lock the phone. The Assistant tells you what it did.</Note>
            <Group label="Your routines">
                {(lists?.routines ?? []).map((r) => (
                    <Row key={r.id} testId={`rt-${r.id}`} title={r.name} subtitle={routineSummary(r)} chevron onClick={() => setEditing(r)}>
                        <ToggleButton value={r.enabled} label={r.name} testId={`rt-on-${r.id}`} onChange={(v) => flip(r, v)} />
                    </Row>
                ))}
                {lists && !lists.routines.length && <Row title="None yet" subtitle="Add one, or start from a suggestion below" />}
            </Group>
            <Button data-testid="rt-new" onClick={() => setEditing({ ...EMPTY })}>Add a Routine</Button>
            {lists && lists.starters.some((s) => !added.has(s.starter)) && (
                <Group label="Suggested">
                    {lists.starters.filter((s) => !added.has(s.starter)).map((s) => (
                        <Row key={s.starter} testId={`rt-starter-${s.starter}`} title={s.name} subtitle={s.steps.map((x) => x.text).join(", ")} chevron
                             onClick={() => setEditing({ ...EMPTY, ...s, id: "", enabled: true })} />
                    ))}
                </Group>
            )}
            {error && <ErrorText testId="rt-list-error">{error}</ErrorText>}
        </Page>
    );
}

/** Settings > Assistant's row that opens the list. */
export function RoutinesRow({ onOpen, off }: { onOpen: () => void; off: boolean }) {
    const [n, setN] = useState<number | null>(null);
    useEffect(() => { assistant.routines().then((r) => setN(r.routines.length), () => setN(0)); }, []);
    return (
        <Group label="Routines">
            <Row title="Routines" subtitle={n === null ? "" : n ? `${n} routine${n === 1 ? "" : "s"}` : "Several things at once, on a word or a time"}
                 chevron disabled={off} testId="as-routines" onClick={off ? undefined : onOpen} />
        </Group>
    );
}
