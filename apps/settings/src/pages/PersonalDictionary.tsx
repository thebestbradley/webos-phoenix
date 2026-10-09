// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist > Personal Dictionary (Phoenix; the owner, 9 October 2026):
// the words the keyboard knows besides its word list. The ones the user
// added (Add Word here, or "+ Add" in the keyboard's candidate bar after
// backspace put back a word a correction had replaced) and the ones it
// learned from the user's typing. Words in it are never corrected and are
// suggested; swipe one across (Onyx SwipeableItem, as the Assistant's
// conversations) or tap it to delete it, and a deleted learned word is no
// longer suggested. Forget Learned Words drops every learned word.
// webOS's Text Assist app (com.palm.app.textassist) was not in the
// open-source release; this page follows its Shortcuts list
// (x_palm_textinput, TextAssistShortcuts.tsx) and Android's and iOS's
// personal dictionaries. Stored in x_palm_textinput (dictionary.ts); the
// learned words come from the keyboard (getSystemStatus learnedWords).

import { useState } from "react";
import { system, systemStatus, withKeyboardPrefs, type SystemPreferences, type SystemStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, ErrorText, Group, Note, Page, PageHeader, Row, Swipeable, TextField } from "@phoenix/ui";
import { dictionaryEntries, withoutWord, withWord, wordProblem, WORD_MAX } from "./dictionary";
import { textInputPrefs } from "./shortcuts";

// Back (Text Assist's useBack) closes it; its dialogs take Back themselves.
export function PersonalDictionaryPage({ prefs }: { prefs: SystemPreferences }) {
    const learned = useLuna<SystemStatus>((cb, err) => systemStatus.watch(cb, err), []).value?.learnedWords ?? [];
    const ti = textInputPrefs(prefs.x_palm_textinput);
    // Deleted here, until the keyboard says it dropped them.
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [forgotten, setForgotten] = useState(false);
    const [adding, setAdding] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [shown, setShown] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);

    const entries = dictionaryEntries(ti.userWords ?? [], forgotten ? [] : learned, hidden);
    const add = async () => {
        if (adding === null) return;
        const problem = wordProblem(entries.map((e) => e.word), adding);
        if (problem) { setError(problem); return; }
        const w = adding.trim();
        setHidden((h) => { const n = new Set(h); n.delete(w.toLowerCase()); return n; });
        await system.setPreferences({ x_palm_textinput: withWord(ti, w) });
        setAdding(null);
    };
    const remove = async (word: string) => {
        setShown(null);
        setHidden((h) => new Set(h).add(word.toLowerCase()));
        await system.setPreferences({ x_palm_textinput: withoutWord(ti, word) });
    };
    const forget = async () => {
        setConfirm(false);
        await system.setPreferences({ x_palm_virtualkeyboard_prefs: withKeyboardPrefs(prefs.x_palm_virtualkeyboard_prefs, { ForgetWords: Date.now() }) });
        setForgotten(true);
    };

    return (
        <Page>
            <PageHeader title="Personal Dictionary" icon="icons/textassist.png" />
            <Group label="Words">
                {entries.map((e) => (
                    <Swipeable key={e.word.toLowerCase()} testId={`ta-dict-swipe-${e.word.toLowerCase()}`} onConfirm={() => void remove(e.word)}>
                        <Row title={e.word} subtitle={e.learned ? "Learned from your typing" : "Added"}
                             testId={`ta-dict-${e.word.toLowerCase()}`} onClick={() => setShown(e.word)} />
                    </Swipeable>
                ))}
                {entries.length === 0 && <Row title="No words yet" testId="ta-dict-empty" disabled />}
                <Row title="Add Word" chevron testId="ta-dict-add" onClick={() => { setError(null); setAdding(""); }} />
            </Group>
            <Note>
                The keyboard never corrects these words and suggests them as you type. Swipe one across to delete it.
            </Note>
            <Group label="Learned words">
                <Button onClick={() => setConfirm(true)} data-testid="ta-forget">Forget Learned Words</Button>
            </Group>
            <Note>
                <span data-testid="ta-learned-note">
                    {forgotten ? "Learned words forgotten." : "The keyboard learns the words you type, to suggest them. They stay on this device."}
                </span>
            </Note>

            {adding !== null && (
                <Dialog open title="Add Word" onClose={() => setAdding(null)} testId="ta-dict-dialog">
                    <TextField label="Word" value={adding} placeholder="Phoenix" maxLength={WORD_MAX} autoFocus testId="ta-dict-field"
                               onChange={(v) => { setError(null); setAdding(v); }} onSubmit={() => void add()} />
                    {error && <ErrorText testId="ta-dict-error">{error}</ErrorText>}
                    <Button variant="affirmative" onClick={() => void add()} data-testid="ta-dict-save">Add</Button>
                    <Button variant="dark" onClick={() => setAdding(null)}>Cancel</Button>
                </Dialog>
            )}
            {shown && (
                <Dialog open title={shown} onClose={() => setShown(null)} testId="ta-dict-word-dialog"
                        message="The keyboard will correct this word again, and stop suggesting it.">
                    <Button variant="negative" onClick={() => void remove(shown)} data-testid="ta-dict-delete">Delete Word</Button>
                    <Button variant="dark" onClick={() => setShown(null)}>Cancel</Button>
                </Dialog>
            )}
            {confirm && (
                <Dialog open title="Forget Learned Words?" onClose={() => setConfirm(false)} testId="ta-forget-dialog"
                        message="The keyboard forgets the words and phrases it learned from your typing.">
                    <Button variant="negative" onClick={() => void forget()} data-testid="ta-forget-confirm">Forget</Button>
                    <Button variant="dark" onClick={() => setConfirm(false)}>Cancel</Button>
                </Dialog>
            )}
        </Page>
    );
}
