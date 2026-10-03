// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Accessibility: reduce motion, high contrast, mono audio, captions
// (docs/APP-GAPS.md "Other settings"). Legacy webOS had none of these.
// Kept as the system preference accessibility
// (com.webos.service.systemservice set/getPreferences):
//   reduceMotion  the shell drops its card, launcher and lock screen
//                 animations (Theme.reduceMotion, through the systemStatus
//                 the runtime reports)
//   highContrast  Phoenix apps draw darker text and stronger outlines (the
//                 runtime puts phoenix-high-contrast on every page's <html>;
//                 @phoenix/ui styles.css)
//   monoAudio, captions  stored for the audio service and the media apps;
//                 nothing reads them yet (see the notes on the page)
//   stickyKeys, slowKeys, bounceKeys, keyRepeatDelay, keyRepeatInterval
//                 a hardware keyboard's accessibility, as iOS's (GAPS V8 (4)):
//                 the shell's KeyboardAccess applies them to every key

import { accessibility, type AccessibilityPrefs } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";

const DELAYS = [{ label: "Off", value: "0" }, { label: "0.3 seconds", value: "300" },
                { label: "0.6 seconds", value: "600" }, { label: "1 second", value: "1000" }];
// Key repeat: [delay, interval] in ms; "keyboard" leaves it to the keyboard.
const REPEATS: Record<string, [number, number] | null> = {
    keyboard: null, off: [0, 50], slow: [1000, 100], normal: [500, 50], fast: [250, 30],
};
function repeatChoice(p?: AccessibilityPrefs): string {
    if (typeof p?.keyRepeatDelay !== "number")
        return "keyboard";
    const hit = Object.entries(REPEATS).find(([, v]) => v && v[0] === p.keyRepeatDelay && v[1] === (p.keyRepeatInterval ?? 50));
    return hit ? hit[0] : "normal";
}

export function AccessibilityPage() {
    const prefs = useLuna<AccessibilityPrefs>((cb, err) => accessibility.watch(cb, err), []).value;
    const set = (p: AccessibilityPrefs) => void accessibility.set(p);
    const toggle = (key: keyof AccessibilityPrefs, title: string, subtitle: string) => (
        <Row title={title} subtitle={subtitle}>
            <ToggleButton value={!!prefs?.[key]} disabled={!prefs} label={title} testId={`a11y-${key}`}
                          onChange={(v) => set({ [key]: v })} />
        </Row>
    );
    return (
        <Page>
            <PageHeader title="Accessibility" icon="icons/accessibility.png" />
            <Group label="Vision">
                {toggle("highContrast", "High contrast", "Darker text and stronger outlines in the apps")}
                {toggle("reduceMotion", "Reduce motion", "Cards, the launcher and the lock screen appear without animating")}
            </Group>
            <Group label="Hearing">
                {toggle("monoAudio", "Mono audio", "The same sound in both ears")}
                {toggle("captions", "Captions", "Show captions on videos that have them")}
            </Group>
            <Note>Mono audio and captions are saved for the audio service and the video player, which do not use them yet.</Note>
            <Group label="Keyboard">
                {toggle("stickyKeys", "Sticky keys", "Press Shift, Ctrl or Alt, then the key; twice to keep it down")}
                <ListSelector<string> title="Slow keys" value={String(prefs?.slowKeys ?? 0)} testId="a11y-slowKeys"
                    options={DELAYS} onChange={(v) => set({ slowKeys: Number(v) })} />
                <ListSelector<string> title="Bounce keys" value={String(prefs?.bounceKeys ?? 0)} testId="a11y-bounceKeys"
                    options={DELAYS} onChange={(v) => set({ bounceKeys: Number(v) })} />
                <ListSelector<string> title="Key repeat" value={repeatChoice(prefs)} testId="a11y-keyRepeat"
                    options={[{ label: "As the keyboard does", value: "keyboard" }, { label: "Off", value: "off" },
                              { label: "Slow", value: "slow" }, { label: "Normal", value: "normal" }, { label: "Fast", value: "fast" }]}
                    onChange={(v) => {
                        const r = REPEATS[v];
                        set({ keyRepeatDelay: r ? r[0] : undefined, keyRepeatInterval: r ? r[1] : undefined });
                    }} />
            </Group>
            <Note>
                For a hardware keyboard. Slow keys: a key counts only once held that long. Bounce keys: a key pressed
                again that soon after it was let go is ignored.
            </Note>
        </Page>
    );
}
