// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist > Hardware Keyboard (GAPS V8 (5); the owner, 29 September
// 2026: "layout, repeat, modifier remapping, the shortcut list and the
// accessibility options" in one place). webOS had none of it.
//   Layout       system preference hardwareKeyboard.layout: "auto" (as the
//                keyboard sends its keys), "qwertz" or "azerty", from a US
//                keyboard's keys by their place (the shell's KeyboardAccess)
//   Key repeat   the accessibility preference's keyRepeatDelay /
//                keyRepeatInterval, the same as Settings > Accessibility's
//   Modifier keys  hardwareKeyboard.remap {capslock, control, alt, meta}:
//                another modifier, Escape, the keyboard key (the TouchPad
//                keyboard's: the on-screen keyboard up or down) or nothing,
//                as macOS's Modifier Keys
//   Shortcuts    keyboardShortcuts, "ipad" or "desktop", and their list
//                (the shell's KeyboardShortcuts.js)
// Sticky, slow and bounce keys stay in Settings > Accessibility.

import { accessibility, system, type AccessibilityPrefs, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row } from "@phoenix/ui";
import { REPEAT_OPTIONS, REPEATS, repeatChoice } from "./Accessibility";

export type HardwareLayout = "auto" | "qwertz" | "azerty";
export type RemapKey = "capslock" | "control" | "alt" | "meta";
export type RemapTarget = RemapKey | "escape" | "keyboard" | "none";
export interface HardwareKeyboardPrefs { layout?: HardwareLayout; remap?: Partial<Record<RemapKey, RemapTarget>> }

export const LAYOUTS: { label: string; value: HardwareLayout }[] = [
    { label: "As the keyboard sends it", value: "auto" },
    { label: "German (QWERTZ)", value: "qwertz" },
    { label: "French (AZERTY)", value: "azerty" },
];
const REMAP_KEYS: { key: RemapKey; title: string }[] = [
    { key: "capslock", title: "Caps Lock" },
    { key: "control", title: "Control (⌘ on a Mac)" },
    { key: "alt", title: "Alt (Option)" },
    { key: "meta", title: "Super (Windows key)" },
];
const TARGETS: { label: string; value: RemapTarget }[] = [
    { label: "Caps Lock", value: "capslock" },
    { label: "Control", value: "control" },
    { label: "Alt", value: "alt" },
    { label: "Super", value: "meta" },
    { label: "Escape", value: "escape" },
    { label: "Keyboard key (show or hide the on-screen keyboard)", value: "keyboard" },
    { label: "No action", value: "none" },
];
// The shortcuts of each scheme, as the shell's sheet lists them (KeyboardShortcuts.js).
export const SHORTCUTS: Record<"ipad" | "desktop", [string, string][]> = {
    ipad: [["Ctrl+Tab", "Next card"], ["Ctrl+Shift+Tab", "Previous card"], ["Ctrl+H", "Card view"],
           ["Ctrl+Space", "Just Type"], ["Ctrl+W", "Close the card"], ["Ctrl+↑", "Launcher"],
           ["Ctrl+↓", "Open the card"], ["Alt+N", "Notifications"], ["Ctrl+Alt+L", "Lock"]],
    desktop: [["Alt+Tab", "Next card"], ["Alt+Shift+Tab", "Previous card"], ["Alt+F4", "Close the card"],
              ["Super+Space", "Just Type"], ["Super+A", "Launcher"], ["Super+↑", "Open the card"],
              ["Super+↓", "Card view"], ["Super+N", "Notifications"], ["Super+L", "Lock"]],
};

/** The preference as the page shows it: known values only. */
export function hardwarePrefs(v: unknown): Required<HardwareKeyboardPrefs> {
    const h = v && typeof v === "object" ? v as HardwareKeyboardPrefs : {};
    const remap: Partial<Record<RemapKey, RemapTarget>> = {};
    for (const { key } of REMAP_KEYS) {
        const t = h.remap?.[key];
        if (t && TARGETS.some((x) => x.value === t) && t !== key)
            remap[key] = t;
    }
    return { layout: LAYOUTS.some((l) => l.value === h.layout) ? h.layout! : "auto", remap };
}

export function HardwareKeyboardPage({ prefs }: { prefs: SystemPreferences }) {
    const a11y = useLuna<AccessibilityPrefs>((cb, err) => accessibility.watch(cb, err), []).value;
    const hw = hardwarePrefs((prefs as Record<string, unknown>).hardwareKeyboard);
    const save = (next: HardwareKeyboardPrefs) =>
        void system.setPreferences({ hardwareKeyboard: { ...hw, ...next } } as Partial<SystemPreferences>);
    const scheme = prefs.keyboardShortcuts === "desktop" ? "desktop" : "ipad";
    return (
        <Page>
            <PageHeader title="Hardware Keyboard" icon="icons/textassist.png" />
            <Group label="Typing">
                <ListSelector<HardwareLayout> title="Layout" value={hw.layout} testId="hw-layout" options={LAYOUTS}
                    onChange={(v) => save({ layout: v })} />
                <ListSelector<string> title="Key repeat" value={repeatChoice(a11y)} testId="hw-keyRepeat" options={REPEAT_OPTIONS}
                    onChange={(v) => {
                        const r = REPEATS[v];
                        void accessibility.set({ keyRepeatDelay: r ? r[0] : undefined, keyRepeatInterval: r ? r[1] : undefined });
                    }} />
            </Group>
            <Note>The layout reads the keys of a US keyboard by their place; leave it as sent when the keyboard has its own.</Note>
            <Group label="Modifier keys">
                {REMAP_KEYS.map(({ key, title }) => (
                    <ListSelector<RemapTarget> key={key} title={title} value={hw.remap[key] ?? key} testId={`hw-remap-${key}`}
                        options={TARGETS} onChange={(v) => {
                            const remap = { ...hw.remap };
                            if (v === key) delete remap[key]; else remap[key] = v;
                            save({ remap });
                        }} />
                ))}
            </Group>
            <Group label="Shortcuts">
                <ListSelector<"ipad" | "desktop"> title="Shortcuts" value={scheme} testId="keyboard-shortcuts"
                    options={[{ label: "iPad style (Ctrl)", value: "ipad" }, { label: "Desktop style (Alt, Super)", value: "desktop" }]}
                    onChange={(v) => void system.setPreferences({ keyboardShortcuts: v })} />
                {SHORTCUTS[scheme].map(([keys, what]) => <Row key={keys} title={what} subtitle={keys} />)}
            </Group>
            <Note>
                Hold Ctrl (⌘ on a Mac) for iPad style, or Super for desktop style, for a moment to see them all. The
                keyboard key shows or hides the on-screen keyboard. Sticky, slow and bounce keys are in Accessibility.
            </Note>
        </Page>
    );
}
