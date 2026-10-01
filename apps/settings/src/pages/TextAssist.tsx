// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist: the keyboard's word suggestions, auto-correction and swipe
// typing (GAPS V2, V3), as webOS's Text Assist app (com.palm.app.textassist)
// was the place for auto-correction. The settings are keys of the keyboard's
// preference, x_palm_virtualkeyboard_prefs (WordSuggestions, AutoCorrect,
// SwipeTyping, spaces2period; ForgetWords: when the learned words were
// forgotten), which the shell's keyboard follows.
//
// Launch params {page: "textassist"}; com.palm.app.textassist opens it.

import { useState } from "react";
import { keyboardPrefs, system, withKeyboardPrefs, type SystemPreferences, type VirtualKeyboardPrefs } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Group, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";

export function TextAssistPage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["x_palm_virtualkeyboard_prefs"], cb, err), []).value ?? {};
    const kb = keyboardPrefs(prefs.x_palm_virtualkeyboard_prefs);
    const [confirm, setConfirm] = useState(false);
    const [forgotten, setForgotten] = useState(false);
    const save = (changes: Partial<VirtualKeyboardPrefs>) =>
        system.setPreferences({ x_palm_virtualkeyboard_prefs: withKeyboardPrefs(prefs.x_palm_virtualkeyboard_prefs, changes) });
    const set = (changes: Partial<VirtualKeyboardPrefs>) => void save(changes);
    // Said once it is saved.
    const forget = async () => {
        setConfirm(false);
        await save({ ForgetWords: Date.now() });
        setForgotten(true);
    };

    const toggle = (title: string, key: "WordSuggestions" | "AutoCorrect" | "SwipeTyping" | "spaces2period", testId: string, subtitle?: string) => (
        <Row title={title} subtitle={subtitle}>
            <ToggleButton value={kb[key] !== false} label={title} testId={testId} onChange={(v) => set({ [key]: v })} />
        </Row>
    );

    return (
        <Page>
            <PageHeader title="Text Assist" icon="icons/textassist.png" />
            <Group label="Typing">
                {toggle("Word suggestions", "WordSuggestions", "ta-suggestions", "Above the keys")}
                {toggle("Auto-correct", "AutoCorrect", "ta-autocorrect", "When you type a space")}
                {toggle("Swipe typing", "SwipeTyping", "ta-swipe", "Slide across the letters")}
                {toggle("Quick period", "spaces2period", "ta-period", "Two spaces type \". \"")}
            </Group>
            <Note>
                Backspace right after a correction puts back what you typed. Dictation: tap the microphone above the
                keys and speak; it is turned into text on this device.
            </Note>
            <Group label="Learned words">
                <Button onClick={() => setConfirm(true)} data-testid="ta-forget">Forget Learned Words</Button>
            </Group>
            <Note>
                <span data-testid="ta-learned-note">
                    {forgotten ? "Learned words forgotten." : "The keyboard learns the words you type, to suggest them. They stay on this device."}
                </span>
            </Note>
            {confirm && (
                <Dialog open title="Forget Learned Words?" onClose={() => setConfirm(false)} testId="ta-forget-dialog"
                        message="The keyboard forgets the words and phrases it learned from your typing.">
                    <Button variant="negative" onClick={() => void forget()}
                            data-testid="ta-forget-confirm">Forget</Button>
                    <Button variant="dark" onClick={() => setConfirm(false)}>Cancel</Button>
                </Dialog>
            )}
        </Page>
    );
}
