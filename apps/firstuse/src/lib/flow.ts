// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The order of First Use's steps, after webOS's First Use app (language,
// Wi-Fi, the Palm Profile, backup restore; then the "how to use cards and
// gestures" tutorial) with the Palm Profile replaced by accounts, the backup
// restore from the USB drive or a WebDAV server, and the passcode and
// privacy choices added. Hardware (after Wi-Fi, so downloads work) offers
// the firmware and drivers the device's hardware needs and the system image
// does not carry (docs/HARDWARE.md, "First boot"); it is left out when
// nothing needs any. The Phoenix Account step (sign in, optional) comes
// before Restore when an account server is set up.

export type StepId = "welcome" | "wifi" | "hardware" | "account" | "restore" | "datetime" | "accounts" | "passcode" | "privacy" | "tutorial" | "done";

export interface StepInfo {
    id: StepId;
    title: string;
    /** Can be skipped with the step's Skip button (everything but the ends). */
    skippable: boolean;
}

export const STEPS: StepInfo[] = [
    { id: "welcome", title: "Welcome", skippable: false },
    { id: "wifi", title: "Wi-Fi", skippable: true },
    { id: "hardware", title: "Hardware", skippable: true },
    // The Phoenix Account (docs/PLATFORM.md 6.3: after Wi-Fi, before Restore,
    // which then lists the account's cloud backups); left out when no
    // account server is set up (servers.json) or the device is offline.
    { id: "account", title: "Phoenix Account", skippable: true },
    { id: "restore", title: "Restore", skippable: true },
    { id: "datetime", title: "Date & Time", skippable: true },
    { id: "accounts", title: "Accounts", skippable: true },
    { id: "passcode", title: "Passcode", skippable: true },
    { id: "privacy", title: "Privacy", skippable: true },
    { id: "tutorial", title: "Cards & Gestures", skippable: true },
    { id: "done", title: "All Set", skippable: false },
];

export function stepIndex(id: StepId): number {
    return STEPS.findIndex((s) => s.id === id);
}

/** The steps shown: hidden ones (nothing to do in them) left out. */
export function shownSteps(hidden: StepId[] = []): StepInfo[] {
    return STEPS.filter((s) => !hidden.includes(s.id));
}

export function nextStep(id: StepId, hidden: StepId[] = []): StepId {
    const steps = shownSteps(hidden.filter((h) => h !== id));
    const i = steps.findIndex((s) => s.id === id);
    return steps[Math.min(steps.length - 1, i + 1)].id;
}

export function previousStep(id: StepId, hidden: StepId[] = []): StepId | null {
    const steps = shownSteps(hidden.filter((h) => h !== id));
    const i = steps.findIndex((s) => s.id === id);
    return i > 0 ? steps[i - 1].id : null;
}

// ---- The tutorial ------------------------------------------------------------------

export interface Lesson {
    id: string;
    title: string;
    text: string;
}

/** What the gesture tutorial shows; tablets have no gesture area (and no back gesture). */
export function lessons(tablet: boolean): Lesson[] {
    const up = tablet ? "Flick up from the bottom edge of the screen" : "Swipe up in the gesture area below the screen";
    return [
        { id: "cardview", title: "Your apps are cards", text: `${up} to see every open app as a card.` },
        { id: "open", title: "Switch apps", text: "Slide the cards sideways and tap one to open it full screen." },
        { id: "close", title: "Close an app", text: "Flick its card up and off the top of the screen." },
        ...(tablet ? [] : [{ id: "back", title: "Go back", text: "Swipe left (right to left) in the gesture area to go back one step." }]),
        { id: "launcher", title: "All your apps", text: `From card view, ${tablet ? "flick up from the bottom edge" : "swipe up"} again for the launcher.` },
        { id: "justtype", title: "Just Type", text: "In card view, just start typing to find apps, people and things to do." },
    ];
}

// ---- Choices ---------------------------------------------------------------------

export const LANGUAGES = [
    { label: "English (United States)", value: "en-US" },
    { label: "English (United Kingdom)", value: "en-GB" },
    { label: "Deutsch", value: "de-DE" },
    { label: "Español", value: "es-ES" },
    { label: "Français", value: "fr-FR" },
    { label: "Italiano", value: "it-IT" },
    { label: "Nederlands", value: "nl-NL" },
    { label: "Português (Brasil)", value: "pt-BR" },
    { label: "日本語", value: "ja-JP" },
    { label: "한국어", value: "ko-KR" },
    { label: "中文 (简体)", value: "zh-CN" },
];

/** A PIN is 4 or more digits; a password 4 or more characters. null when fine. */
export function passcodeProblem(kind: "pin" | "password", code: string, confirm: string): string | null {
    if (kind === "pin" && !/^\d{4,}$/.test(code)) return "A PIN needs at least 4 digits.";
    if (kind === "password" && code.length < 4) return "A password needs at least 4 characters.";
    if (code !== confirm) return `The ${kind === "pin" ? "PINs" : "passwords"} do not match.`;
    return null;
}
