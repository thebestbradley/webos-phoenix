// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The task editor, a Mojo-style scene: the summary and notes, then groups
// for the list and priority, the due date (with or without a time) and the
// reminder, drawn with the Heritage date and time pickers. Like the webOS
// 1.x apps it saves on the way out (Done or the back gesture); a new task
// left without a summary is dropped. Opened from a reminder it offers
// "Snooze 10 min" and "Done".

import { useState } from "react";
import { SNOOZE_MINUTES, type Task, type TaskInput, type TaskList } from "@phoenix/luna";
import { Button, Dialog, Group, ListSelector, PageHeader, Picker, Row, ToggleButton, useBack } from "@phoenix/ui";
import {
    daysInMonth, defaultRemind, fromParts, PRIORITY_OPTIONS, priorityChoice, startOfDay, toParts, type DateParts,
} from "./lib/views";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Month, day and year pickers, and hour, minute and AM/PM when withTime. */
function DateTimePickers({ value, withTime, onChange, testId }: {
    value: number; withTime: boolean; onChange: (ms: number) => void; testId: string;
}) {
    const p = toParts(value);
    const set = (x: Partial<DateParts>) => onChange(fromParts({ ...p, ...x }));
    const thisYear = new Date().getFullYear();
    const years = Array.from({ length: 12 }, (_, i) => thisYear - 1 + i);
    if (!years.includes(p.y)) years.unshift(p.y);
    return (
        <>
            <div className="tk-picker-row" data-testid={`${testId}-date`}>
                <Picker label="Month" value={p.mo} testId={`${testId}-month`}
                        options={MONTHS.map((m, i) => ({ label: m, value: i + 1 }))} onChange={(mo) => set({ mo })} />
                <Picker label="Day" value={p.d} testId={`${testId}-day`}
                        options={Array.from({ length: daysInMonth(p.y, p.mo) }, (_, i) => ({ label: String(i + 1), value: i + 1 }))}
                        onChange={(d) => set({ d })} />
                <Picker label="Year" value={p.y} testId={`${testId}-year`}
                        options={years.map((y) => ({ label: String(y), value: y }))} onChange={(y) => set({ y })} />
            </div>
            {withTime && (
                <div className="tk-picker-row" data-testid={`${testId}-time`}>
                    <Picker label="Hour" value={p.h % 12 || 12} testId={`${testId}-hour`}
                            options={Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))}
                            onChange={(h) => set({ h: (h % 12) + (p.h >= 12 ? 12 : 0) })} />
                    <Picker label="Minute" value={p.mi} testId={`${testId}-minute`}
                            options={Array.from({ length: 60 }, (_, i) => ({ label: pad(i), value: i }))} onChange={(mi) => set({ mi })} />
                    <Picker label="" value={p.h >= 12 ? "PM" : "AM"} testId={`${testId}-ampm`}
                            options={[{ label: "AM", value: "AM" }, { label: "PM", value: "PM" }]}
                            onChange={(ap) => set({ h: (p.h % 12) + (ap === "PM" ? 12 : 0) })} />
                </div>
            )}
        </>
    );
}

export interface EditorProps {
    /** The task to edit, or the start of a new one (no _id). */
    task: TaskInput;
    lists: TaskList[];
    /** Opened from its reminder notification. */
    fromReminder?: boolean;
    onSave: (t: TaskInput) => Promise<void>;
    onDelete: (t: Task) => Promise<void>;
    onSnooze: (t: TaskInput) => Promise<void>;
    onClose: () => void;
}

export function Editor({ task, lists, fromReminder, onSave, onDelete, onSnooze, onClose }: EditorProps) {
    const [draft, setDraft] = useState<TaskInput>(task);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const set = (x: Partial<TaskInput>) => setDraft((d) => ({ ...d, ...x }));
    const isNew = !task._id;
    const now = Date.now();

    const finish = async () => {
        if (!draft.summary.trim()) {
            onClose();
            return;
        }
        await onSave(draft);
        onClose();
    };
    useBack(() => { void finish(); return true; });

    const setDue = (on: boolean) => set(on ? { due: startOfDay(now), allDay: true } : { due: null, allDay: false });
    const setTimed = (on: boolean) => {
        if (!draft.due) return;
        const d = toParts(draft.due);
        set(on ? { allDay: false, due: fromParts({ ...d, h: new Date(now).getHours() + 1, mi: 0 }) }
               : { allDay: true, due: startOfDay(draft.due) });
    };

    return (
        <div className="tk-editor" data-testid="editor">
            <PageHeader icon="icon.png" title={isNew ? "New Task" : "Task"}>
                <button type="button" className="tk-header-button" data-testid="edit-done" onClick={() => void finish()}>Done</button>
            </PageHeader>
            <div className="tk-scroll tk-editor-body">
                {fromReminder && !isNew && (
                    <div className="tk-reminder-bar" data-testid="reminder-bar">
                        <div className="tk-reminder-text">Reminder</div>
                        <Button data-testid="reminder-snooze" onClick={async () => { await onSnooze(draft); onClose(); }}>
                            Snooze {SNOOZE_MINUTES} min
                        </Button>
                        <Button variant="affirmative" data-testid="reminder-done"
                                onClick={async () => { await onSave({ ...draft, completed: true }); onClose(); }}>
                            Done
                        </Button>
                    </div>
                )}
                <div className="tk-field">
                    <input className="tk-summary" value={draft.summary} placeholder="Task" autoFocus={isNew}
                           data-testid="edit-summary" onChange={(e) => set({ summary: e.target.value })}
                           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void finish(); } }} />
                </div>
                <div className="tk-field">
                    <textarea className="tk-notes" value={draft.notes ?? ""} placeholder="Notes" rows={3}
                              data-testid="edit-notes" onChange={(e) => set({ notes: e.target.value })} />
                </div>

                <Group>
                    <ListSelector title="List" value={draft.listId} testId="edit-list"
                                  options={lists.map((l) => ({ label: l.name, value: l._id! }))}
                                  onChange={(listId) => set({ listId, accountId: lists.find((l) => l._id === listId)?.accountId ?? "" })} />
                    <ListSelector title="Priority" value={priorityChoice(draft.priority)} testId="edit-priority"
                                  options={PRIORITY_OPTIONS} onChange={(priority) => set({ priority })} />
                    <Row title="Completed">
                        <ToggleButton value={draft.completed} label="Completed" testId="edit-completed"
                                      onLabel="Yes" offLabel="No" onChange={(completed) => set({ completed })} />
                    </Row>
                </Group>

                <Group label="Due">
                    <Row title="Due date">
                        <ToggleButton value={!!draft.due} label="Due date" testId="due-toggle" onChange={setDue} />
                    </Row>
                    {!!draft.due && (
                        <Row title="Time">
                            <ToggleButton value={!draft.allDay} label="Due time" testId="due-time-toggle" onChange={setTimed} />
                        </Row>
                    )}
                </Group>
                {!!draft.due && <DateTimePickers value={draft.due} withTime={!draft.allDay} testId="due"
                                                 onChange={(due) => set({ due })} />}

                <Group label="Reminder">
                    <Row title="Remind me">
                        <ToggleButton value={!!draft.remind} label="Remind me" testId="remind-toggle"
                                      onChange={(on) => set({ remind: on ? defaultRemind(draft, now) : null })} />
                    </Row>
                </Group>
                {!!draft.remind && (
                    <>
                        <DateTimePickers value={draft.remind} withTime testId="remind" onChange={(remind) => set({ remind })} />
                        {draft.remind <= now && <div className="tk-hint">This time has passed; pick a later one to be reminded.</div>}
                    </>
                )}

                {!isNew && (
                    <Button variant="negative" className="tk-delete" data-testid="edit-delete" onClick={() => setConfirmDelete(true)}>
                        Delete Task
                    </Button>
                )}
            </div>

            <Dialog open={confirmDelete} title="Delete Task" message={`Delete "${draft.summary}"?`}
                    onClose={() => setConfirmDelete(false)} testId="delete-task-dialog">
                <div className="tk-dialog-buttons">
                    <Button variant="negative" data-testid="delete-task-confirm"
                            onClick={async () => { await onDelete(task as Task); setConfirmDelete(false); onClose(); }}>
                        Delete
                    </Button>
                    <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </div>
            </Dialog>
        </div>
    );
}
