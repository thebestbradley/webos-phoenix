// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist > Shortcuts: the user's text replacements, as webOS's Text
// Assist had them (x_palm_textinput shortcutChecking): type the shortcut and
// a space, and the keyboard puts in what it stands for ("omw" -> "On my
// way"; "Omw" capitalized). The switch is shortcutChecking ("autoCorrect" or
// "off"); the list is x_palm_textinput.shortcuts (see shortcuts.ts). Tap one
// to change or delete it.

import { useState } from "react";
import { system, type SystemPreferences, type TextAssistShortcut } from "@phoenix/luna";
import { Button, Dialog, ErrorText, Group, Note, Row, TextField, ToggleButton } from "@phoenix/ui";
import { shortcutProblem, sortedShortcuts, textInputPrefs, withShortcut, withoutShortcut, SHORTCUT_MAX, TEXT_MAX } from "./shortcuts";

type Editing = { replacing?: string; shortcut: string; text: string };

export function ShortcutsSection({ prefs }: { prefs: SystemPreferences }) {
    const ti = textInputPrefs(prefs.x_palm_textinput);
    const list = sortedShortcuts(ti.shortcuts ?? []);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [error, setError] = useState<string | null>(null);
    const save = (changes: Partial<typeof ti>) =>
        system.setPreferences({ x_palm_textinput: { ...ti, ...changes } });

    const open = (e: Editing) => { setError(null); setEditing(e); };
    const done = async () => {
        if (!editing) return;
        const problem = shortcutProblem(list, editing.shortcut, editing.text, editing.replacing);
        if (problem) { setError(problem); return; }
        await save({ shortcuts: withShortcut(list, editing.shortcut, editing.text, editing.replacing) });
        setEditing(null);
    };
    const remove = async (s: TextAssistShortcut) => {
        await save({ shortcuts: withoutShortcut(list, s.shortcut) });
        setEditing(null);
    };
    const on = ti.shortcutChecking !== "off";

    return (
        <>
            <Group label="Shortcuts">
                <Row title="Use shortcuts" subtitle="When you type a space">
                    <ToggleButton value={on} label="Use shortcuts" testId="ta-shortcuts-on"
                                  onChange={(v) => void save({ shortcutChecking: v ? "autoCorrect" : "off" })} />
                </Row>
                {list.map((s) => (
                    <Row key={s.shortcut.toLowerCase()} title={s.shortcut} subtitle={s.text} chevron disabled={!on}
                         testId={`ta-shortcut-${s.shortcut.toLowerCase()}`}
                         onClick={() => open({ replacing: s.shortcut, shortcut: s.shortcut, text: s.text })} />
                ))}
                <Row title="Add Shortcut" chevron testId="ta-shortcut-add" onClick={() => open({ shortcut: "", text: "" })} />
            </Group>
            <Note>Type a shortcut and a space, and the keyboard writes what it stands for.</Note>
            {editing && (
                <Dialog open title={editing.replacing ? "Edit Shortcut" : "Add Shortcut"} onClose={() => setEditing(null)} testId="ta-shortcut-dialog">
                    <TextField label="Shortcut" value={editing.shortcut} placeholder="omw" maxLength={SHORTCUT_MAX} autoFocus
                               testId="ta-shortcut-field" onChange={(v) => { setError(null); setEditing({ ...editing, shortcut: v }); }}
                               onSubmit={() => void done()} />
                    <TextField label="Text" value={editing.text} placeholder="On my way" maxLength={TEXT_MAX}
                               testId="ta-shortcut-text" onChange={(v) => { setError(null); setEditing({ ...editing, text: v }); }}
                               onSubmit={() => void done()} />
                    {error && <ErrorText testId="ta-shortcut-error">{error}</ErrorText>}
                    <Button variant="affirmative" onClick={() => void done()} data-testid="ta-shortcut-save">Done</Button>
                    {editing.replacing && (
                        <Button variant="negative" data-testid="ta-shortcut-delete"
                                onClick={() => void remove({ shortcut: editing.replacing!, text: editing.text })}>Delete Shortcut</Button>
                    )}
                    <Button variant="dark" onClick={() => setEditing(null)}>Cancel</Button>
                </Dialog>
            )}
        </>
    );
}
