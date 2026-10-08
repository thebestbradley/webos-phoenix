// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist: the keyboard's word suggestions, auto-correction and swipe
// typing (GAPS V2, V3), as webOS's Text Assist app (com.palm.app.textassist)
// was the place for auto-correction. The settings are keys of the keyboard's
// preference, x_palm_virtualkeyboard_prefs (WordSuggestions, AutoCorrect,
// SwipeTyping, spaces2period; ForgetWords: when the learned words were
// forgotten), which the shell's keyboard follows. Keyboards: which layouts
// and languages the keyboard offers (its "keyboards" combos, as
// VirtualKeyboardPreferences kept them); with two or more its language key
// goes from one to the next. Hardware keyboard: the shell's shortcuts,
// iPad-style (Ctrl / Command) or desktop-style (Alt, Super), system
// preference keyboardShortcuts. Shortcuts: the user's text replacements
// (TextAssistShortcuts.tsx; x_palm_textinput). Number row (Phoenix; the
// community's keyboard layout patches, docs/M6-PLAN.md F4): digits above
// the phone keyboard's letters, system preference keyboardNumberRow, off by
// default (the tablet keyboard has its own number row). Keyboard style
// (Phoenix; the owner, 8 October 2026): the keys' look, system preference
// keyboardStyle: "auto" (the phone's black keys on a phone, the TouchPad's on
// a tablet), "black" or "touchpad" on every device; the keyboard changes at
// once.
//
// Launch params {page: "textassist"}; com.palm.app.textassist opens it.

import { useState } from "react";
import { keyboardPrefs, system, withKeyboardPrefs, type SystemPreferences, type VirtualKeyboardPrefs } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";
import { ShortcutsSection } from "./TextAssistShortcuts";

/** The keyboards there are: a layout and the language of its words ("none": no suggestions or corrections). */
export const KEYBOARDS = [
    { layout: "qwerty", language: "en", title: "English", subtitle: "QWERTY" },
    { layout: "qwertz", language: "de", title: "Deutsch", subtitle: "QWERTZ" },
    { layout: "azerty", language: "fr", title: "Français", subtitle: "AZERTY" },
    { layout: "qwerty", language: "none", title: "No language", subtitle: "QWERTY, no suggestions or corrections" },
];
const DEFAULT_KEYBOARDS = [{ layout: "qwerty", language: "en" }];
const same = (a: { layout: string; language: string }, b: { layout: string; language: string }) =>
    a.layout === b.layout && a.language === b.language;

/** The keyboard's looks (system preference keyboardStyle). */
export const KEYBOARD_STYLES: { label: string; value: KeyboardStyle }[] = [
    { label: "Automatic (phone: black, tablet: TouchPad)", value: "auto" },
    { label: "Black", value: "black" },
    { label: "TouchPad", value: "touchpad" },
];
type KeyboardStyle = "auto" | "black" | "touchpad";
export const keyboardStyle = (v: unknown): KeyboardStyle => (v === "black" || v === "touchpad" ? v : "auto");

export function TextAssistPage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["x_palm_virtualkeyboard_prefs", "keyboardShortcuts", "x_palm_textinput", "keyboardNumberRow", "keyboardStyle"], cb, err), []).value ?? {};
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

    // In the order of KEYBOARDS, at least one.
    const enabled = kb.keyboards && kb.keyboards.length ? kb.keyboards : DEFAULT_KEYBOARDS;
    const setKeyboard = (k: { layout: string; language: string }, on: boolean) => {
        const next = KEYBOARDS.filter((c) => (same(c, k) ? on : enabled.some((e) => same(e, c))))
            .map((c) => ({ layout: c.layout, language: c.language }));
        if (next.length)
            set({ keyboards: next });
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
            <ShortcutsSection prefs={prefs} />
            <Group label="Layout">
                <ListSelector<KeyboardStyle> title="Keyboard style" value={keyboardStyle(prefs.keyboardStyle)} testId="ta-keyboard-style"
                    options={KEYBOARD_STYLES} onChange={(v) => void system.setPreferences({ keyboardStyle: v })} />
                <Row title="Number row" subtitle="Numbers above the letters on a phone" testId="ta-numberrow-row">
                    <ToggleButton value={!!prefs.keyboardNumberRow} label="Number row" testId="ta-numberrow"
                                  onChange={(v) => void system.setPreferences({ keyboardNumberRow: v })} />
                </Row>
            </Group>
            <Group label="Keyboards">
                {KEYBOARDS.map((k) => {
                    const on = enabled.some((e) => same(e, k));
                    return (
                        <Row key={k.layout + k.language} title={k.title} subtitle={k.subtitle}>
                            <ToggleButton value={on} label={k.title} testId={`ta-kb-${k.layout}-${k.language}`}
                                          disabled={on && enabled.length === 1} onChange={(v) => setKeyboard(k, v)} />
                        </Row>
                    );
                })}
            </Group>
            <Note>
                With more than one, the key beside 123 (on a phone, Shift on the 123 page) switches between them;
                hold it for the list.
            </Note>
            <Note>
                Backspace right after a correction puts back what you typed. Dictation: tap the microphone above the
                keys and speak; it is turned into text on this device.
            </Note>
            <Group label="Hardware keyboard">
                <ListSelector<"ipad" | "desktop"> title="Shortcuts" value={prefs.keyboardShortcuts === "desktop" ? "desktop" : "ipad"} testId="keyboard-shortcuts"
                    options={[{ label: "iPad style (Ctrl)", value: "ipad" }, { label: "Desktop style (Alt, Super)", value: "desktop" }]}
                    onChange={(v) => void system.setPreferences({ keyboardShortcuts: v })} />
                <Note>Hold Ctrl (⌘ on a Mac) for iPad style, or Super for desktop style, for a moment to see them all.</Note>
            </Group>

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
