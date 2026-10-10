// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist: the keyboard's word suggestions, auto-correction and swipe
// typing (GAPS V2, V3), as webOS's Text Assist app (com.palm.app.textassist)
// was the place for auto-correction. The settings are keys of the keyboard's
// preference, x_palm_virtualkeyboard_prefs (WordSuggestions, AutoCorrect,
// SwipeTyping, EmojiSuggestions, spaces2period; ForgetWords: when the learned words were
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
// once. Personal Dictionary (PersonalDictionary.tsx): the words the user
// added and the ones the keyboard learned, and Forget Learned Words.
// Keyboards (GAPS V7; the owner, 29 September 2026): whole keyboards side
// by side, as on iOS, x_palm_virtualkeyboard_prefs installed in the user's
// order: webOS Classic, Phoenix (Phoenix's own look over the same keys and
// Text Assist) and webOS OSE (OSE's own Maliit keyboard, on a device once
// the keyboard is the device's input method, V5). The globe key switches.
// Languages: the layouts and word lists every keyboard offers.
//
// Launch params {page: "textassist"}; com.palm.app.textassist opens it.

import { useState } from "react";
import { keyboardPrefs, system, withKeyboardPrefs, type SystemPreferences, type VirtualKeyboardPrefs } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";
import { ReorderList } from "../ReorderList";
import { PersonalDictionaryPage } from "./PersonalDictionary";
import { ShortcutsSection } from "./TextAssistShortcuts";
import { textInputPrefs } from "./shortcuts";

/** The keyboards there are: a layout and the language of its words ("none": no suggestions or corrections). */
export const KEYBOARDS = [
    { layout: "qwerty", language: "en", title: "English", subtitle: "QWERTY" },
    { layout: "qwertz", language: "de", title: "Deutsch", subtitle: "QWERTZ" },
    { layout: "azerty", language: "fr", title: "Français", subtitle: "AZERTY" },
    { layout: "qwerty", language: "none", title: "No language", subtitle: "QWERTY, no suggestions or corrections" },
];
const DEFAULT_KEYBOARDS = [{ layout: "qwerty", language: "en" }];

/** The whole keyboards there are (GAPS V7). */
export const WHOLE_KEYBOARDS: { id: string; title: string; subtitle: string; available: boolean }[] = [
    { id: "classic", title: "webOS Classic", subtitle: "The Pre's and TouchPad's keyboard", available: true },
    { id: "phoenix", title: "Phoenix", subtitle: "A new look, the same keys and Text Assist", available: true },
    { id: "ose", title: "webOS OSE", subtitle: "OSE's own keyboard, on a device (not yet: V5)", available: false },
];
/** The installed keyboards, known ids in order, at least webOS Classic's place taken by one. */
export const installedKeyboards = (v: unknown): string[] => {
    const ids = Array.isArray(v) ? v.filter((id, i, all): id is string =>
        typeof id === "string" && WHOLE_KEYBOARDS.some((k) => k.id === id) && all.indexOf(id) === i) : [];
    return ids.length ? ids : ["classic"];
};
/** The list with `id` moved to `to`. */
export const moveKeyboard = (ids: string[], id: string, to: number): string[] => {
    const rest = ids.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
    return rest;
};
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
    const [dictionary, setDictionary] = useState(false);
    useBack(() => { setDictionary(false); return true; }, dictionary);
    const save = (changes: Partial<VirtualKeyboardPrefs>) =>
        system.setPreferences({ x_palm_virtualkeyboard_prefs: withKeyboardPrefs(prefs.x_palm_virtualkeyboard_prefs, changes) });
    const set = (changes: Partial<VirtualKeyboardPrefs>) => void save(changes);

    // In the order of KEYBOARDS, at least one.
    const enabled = kb.keyboards && kb.keyboards.length ? kb.keyboards : DEFAULT_KEYBOARDS;
    const setKeyboard = (k: { layout: string; language: string }, on: boolean) => {
        const next = KEYBOARDS.filter((c) => (same(c, k) ? on : enabled.some((e) => same(e, c))))
            .map((c) => ({ layout: c.layout, language: c.language }));
        if (next.length)
            set({ keyboards: next });
    };

    const installed = installedKeyboards(kb.installed);
    const setInstalled = (id: string, on: boolean) => {
        const next = on ? installed.concat(installed.includes(id) ? [] : [id]) : installed.filter((x) => x !== id);
        if (next.length)
            set({ installed: next });
    };
    const byId = (id: string) => WHOLE_KEYBOARDS.find((k) => k.id === id)!;

    const toggle = (title: string, key: "WordSuggestions" | "AutoCorrect" | "SwipeTyping" | "EmojiSuggestions" | "spaces2period", testId: string, subtitle?: string) => (
        <Row title={title} subtitle={subtitle}>
            <ToggleButton value={kb[key] !== false} label={title} testId={testId} onChange={(v) => set({ [key]: v })} />
        </Row>
    );

    if (dictionary)
        return <PersonalDictionaryPage prefs={prefs} />;
    const added = textInputPrefs(prefs.x_palm_textinput).userWords?.length ?? 0;
    return (
        <Page>
            <PageHeader title="Text Assist" icon="icons/textassist.png" />
            <Group label="Typing">
                {toggle("Word suggestions", "WordSuggestions", "ta-suggestions", "Above the keys")}
                {toggle("Auto-correct", "AutoCorrect", "ta-autocorrect", "When you type a space")}
                {toggle("Swipe typing", "SwipeTyping", "ta-swipe", "Slide across the letters")}
                {toggle("Emoji suggestions", "EmojiSuggestions", "ta-emoji", "An emoji for words such as \"pizza\"")}
                {toggle("Quick period", "spaces2period", "ta-period", "Two spaces type \". \"")}
                <Row title="Personal Dictionary" subtitle={added === 1 ? "1 word added" : added ? `${added} words added` : "Your own words, and the ones it learned"}
                     chevron testId="ta-dictionary" onClick={() => setDictionary(true)} />
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
                <ReorderList items={installed} keyOf={(id) => id} testId="ta-installed" label={(id) => `Move ${byId(id).title}`}
                    onMove={(id, to) => set({ installed: moveKeyboard(installed, id, to) })}
                    render={(id) => (
                        <Row title={byId(id).title} subtitle={byId(id).subtitle}>
                            <ToggleButton value label={byId(id).title} testId={`ta-whole-${id}`}
                                          disabled={installed.length === 1} onChange={(v) => setInstalled(id, v)} />
                        </Row>
                    )} />
                {WHOLE_KEYBOARDS.filter((k) => !installed.includes(k.id)).map((k) => (
                    <Row key={k.id} title={k.title} subtitle={k.subtitle}>
                        <ToggleButton value={false} label={k.title} testId={`ta-whole-${k.id}`}
                                      disabled={!k.available} onChange={(v) => setInstalled(k.id, v)} />
                    </Row>
                ))}
            </Group>
            <Note>
                With more than one, the globe key (beside 123; on a phone, Shift on the 123 page) goes to the next
                language and then the next keyboard; hold it for the list. Drag a keyboard by its grip to order them.
            </Note>
            <Group label="Languages">
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
        </Page>
    );
}
