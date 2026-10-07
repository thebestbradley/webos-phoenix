// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Advanced: one place for the power users' options (docs/M6-PLAN.md F4),
// as the community's Tweaks app gathered its patches' options (webOS
// Internals' Tweaks; LunaCE's Tweaks definitions in webOS CE 3.1.0,
// AddToImage/LunaCE-Tweaks/*.json). Each is a system preference
// (com.webos.service.systemservice get/setPreferences), LunaCE's own key
// where it had the option, and the shell follows at once (the runtime's
// systemStatus tweaks):
//   launcherGridDensity      the launcher's grid: Normal or Dense (the icon
//                            grid patches)
//   infiniteCardCyclingEnabled  card view wraps from the last card to the
//                            first (LunaCE abh_features.json; off)
//   sysUiEnableMaximizeEdges a tap on a side card maximizes it (LunaCE
//                            maximize-edges.json; off)
//   sysUiEnableWaveLauncher  a slide up from a side of the gesture area
//                            raises the wave launcher (LunaCE
//                            wave-launcher.json; off)
//   animationSpeed           the shell's animations: Normal or Fast (Faster
//                            Card Animations)
//   gestureSensitivity       how far a swipe or flick goes before it counts:
//                            Low, Normal or High (Buttah)
//   showReticleAnimation     the tap ripple (LunaCE tap-ripple.json; on)
//   hapticFeedback           a buzz on every tap (Haptic Feedback Manager)

import { system, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";

const KEYS: (keyof SystemPreferences)[] = ["launcherGridDensity", "infiniteCardCyclingEnabled", "sysUiEnableMaximizeEdges",
    "sysUiEnableWaveLauncher", "animationSpeed", "gestureSensitivity", "showReticleAnimation", "hapticFeedback"];

export function AdvancedPage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(KEYS, cb, err), []).value;
    const set = (p: SystemPreferences) => void system.setPreferences(p);
    const toggle = (key: keyof SystemPreferences, title: string, subtitle: string, fallback = false) => (
        <Row title={title} subtitle={subtitle} testId={`adv-row-${key}`}>
            <ToggleButton value={prefs ? (prefs[key] === undefined ? fallback : !!prefs[key]) : fallback} disabled={!prefs}
                          label={title} testId={`adv-${key}`} onChange={(v) => set({ [key]: v })} />
        </Row>
    );
    return (
        <Page>
            <PageHeader title="Advanced" icon="icons/advanced.png" />
            <Note>Options for the way the system looks and responds. They take effect at once.</Note>
            <Group label="Launcher">
                <ListSelector title="Icon grid" value={prefs?.launcherGridDensity ?? "normal"} testId="adv-launcherGridDensity"
                              options={[{ label: "Normal", value: "normal" as const }, { label: "Dense", value: "dense" as const }]}
                              onChange={(v) => set({ launcherGridDensity: v })} />
            </Group>
            <Group label="Cards">
                {toggle("infiniteCardCyclingEnabled", "Infinite card cycling", "Past the last card is the first")}
                {toggle("sysUiEnableMaximizeEdges", "Tap side cards to open", "A tap on a card at the edge opens it at once")}
            </Group>
            <Group label="Gestures">
                {toggle("sysUiEnableWaveLauncher", "Wave launcher", "Slide up from a side of the gesture area for your dock's apps")}
                <ListSelector title="Gesture sensitivity" value={prefs?.gestureSensitivity ?? "normal"} testId="adv-gestureSensitivity"
                              options={[{ label: "Low", value: "low" as const }, { label: "Normal", value: "normal" as const },
                                        { label: "High", value: "high" as const }]}
                              onChange={(v) => set({ gestureSensitivity: v })} />
                {toggle("showReticleAnimation", "Tap ripple", "A ripple where you tap", true)}
            </Group>
            <Group label="Feedback">
                <ListSelector title="Animation speed" value={prefs?.animationSpeed ?? "normal"} testId="adv-animationSpeed"
                              options={[{ label: "Normal", value: "normal" as const }, { label: "Fast", value: "fast" as const }]}
                              onChange={(v) => set({ animationSpeed: v })} />
                {toggle("hapticFeedback", "Vibrate on tap", "A short buzz with every tap, where the device can")}
            </Group>
        </Page>
    );
}
