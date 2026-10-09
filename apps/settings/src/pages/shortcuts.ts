// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist's shortcuts: what the user types ("omw") and what the
// keyboard's space bar puts in for it ("On my way"). Kept in the system
// preference x_palm_textinput (LunaSysMgr's conf/defaultPreferences.txt key,
// whose shortcutChecking says whether they are used) as its `shortcuts`
// list; the runtime hands them to the shell's keyboard (systemStatus
// textAssist.shortcuts, TextAssist.js shortcut()).

import type { TextAssistShortcut, TextInputPrefs } from "@phoenix/luna";

/**
 * What the keyboard counts as one word, so what a shortcut may be: letters
 * (with Latin accents) and apostrophes (VirtualKeyboard.qml _trackKey).
 */
const SHORTCUT_RE = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ']*$/;

export const SHORTCUT_MAX = 24;
export const TEXT_MAX = 200;

/** The preference as stored, with its defaults (conf/defaultPreferences.txt). */
export function textInputPrefs(value: unknown): TextInputPrefs {
    const v = value && typeof value === "object" ? value as TextInputPrefs : {};
    return {
        spellChecking: v.spellChecking ?? "autoCorrect",
        grammarChecking: v.grammarChecking ?? "autoCorrect",
        shortcutChecking: v.shortcutChecking ?? "autoCorrect",
        shortcuts: Array.isArray(v.shortcuts) ? v.shortcuts.filter((s) => s && typeof s.shortcut === "string" && typeof s.text === "string") : [],
        // The personal dictionary (dictionary.ts), kept as it is.
        userWords: Array.isArray(v.userWords) ? v.userWords.filter((w) => typeof w === "string") : [],
        removedWords: v.removedWords && typeof v.removedWords === "object" ? v.removedWords : {},
    };
}

/** Sorted as the list shows them: by shortcut, ignoring case. */
export function sortedShortcuts(list: TextAssistShortcut[]): TextAssistShortcut[] {
    return [...list].sort((a, b) => a.shortcut.toLowerCase().localeCompare(b.shortcut.toLowerCase()));
}

/**
 * Why this shortcut cannot be saved, or null. `replacing` is the shortcut
 * being edited (it may keep its own name).
 */
export function shortcutProblem(list: TextAssistShortcut[], shortcut: string, text: string, replacing?: string): string | null {
    const s = shortcut.trim();
    if (!s) return "Type the shortcut.";
    if (!SHORTCUT_RE.test(s)) return "A shortcut is one word: letters only, no spaces or digits.";
    if (s.length > SHORTCUT_MAX) return `A shortcut has at most ${SHORTCUT_MAX} letters.`;
    if (!text.trim()) return "Type the text it stands for.";
    if (text.length > TEXT_MAX) return `The text has at most ${TEXT_MAX} characters.`;
    const lower = s.toLowerCase();
    if (lower !== replacing?.toLowerCase() && list.some((x) => x.shortcut.toLowerCase() === lower))
        return `There is a shortcut "${s}" already.`;
    return null;
}

/** The list with this shortcut added, or put in place of `replacing`. */
export function withShortcut(list: TextAssistShortcut[], shortcut: string, text: string, replacing?: string): TextAssistShortcut[] {
    const gone = (replacing ?? shortcut.trim()).toLowerCase();
    return sortedShortcuts([...list.filter((x) => x.shortcut.toLowerCase() !== gone && x.shortcut.toLowerCase() !== shortcut.trim().toLowerCase()),
                            { shortcut: shortcut.trim(), text: text.trim() }]);
}

/** The list without this shortcut. */
export function withoutShortcut(list: TextAssistShortcut[], shortcut: string): TextAssistShortcut[] {
    return list.filter((x) => x.shortcut.toLowerCase() !== shortcut.toLowerCase());
}
