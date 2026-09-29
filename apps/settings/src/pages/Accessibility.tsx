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

import { accessibility, type AccessibilityPrefs } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";

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
        </Page>
    );
}
