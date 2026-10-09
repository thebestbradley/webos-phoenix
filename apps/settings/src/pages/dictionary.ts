// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist's personal dictionary (Phoenix): the words the user added,
// which the keyboard never corrects and suggests as they are written, kept
// in the system preference x_palm_textinput beside the shortcuts
// (shortcuts.ts) as `userWords`; and the learned words the user deleted,
// lower case -> when (`removedWords`), which the keyboard drops once
// (TextAssist.js removeLearned). The keyboard says which words it learned
// (getSystemStatus learnedWords).

import type { TextInputPrefs } from "@phoenix/luna";

/** One word, as the keyboard counts words (VirtualKeyboard.qml _trackKey): letters and apostrophes. */
const WORD_RE = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ']*$/;
export const WORD_MAX = 48;
/** The deletions kept: the keyboard applies each once, so only the latest matter. */
export const REMOVED_MAX = 200;

export type DictionaryEntry = { word: string; learned: boolean };

/** Why this word cannot be added, or null. */
export function wordProblem(words: string[], word: string): string | null {
    const w = word.trim();
    if (!w) return "Type the word.";
    if (!WORD_RE.test(w)) return "A word is letters only, no spaces or digits.";
    if (w.length > WORD_MAX) return `A word has at most ${WORD_MAX} letters.`;
    if (words.some((x) => x.toLowerCase() === w.toLowerCase())) return `"${w}" is in the dictionary already.`;
    return null;
}

/** What the page lists: the words added and the words learned, once each, sorted ignoring case. */
export function dictionaryEntries(userWords: string[], learned: string[], hidden: Set<string> = new Set()): DictionaryEntry[] {
    const seen = new Set<string>();
    const out: DictionaryEntry[] = [];
    for (const [list, isLearned] of [[userWords, false], [learned, true]] as const) {
        for (const w of list) {
            const k = w.toLowerCase();
            if (seen.has(k) || hidden.has(k)) continue;
            seen.add(k);
            out.push({ word: w, learned: isLearned });
        }
    }
    return out.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
}

/** The preference with this word added. */
export function withWord(ti: TextInputPrefs, word: string): TextInputPrefs {
    const w = word.trim();
    return { ...ti, userWords: [...(ti.userWords ?? []).filter((x) => x.toLowerCase() !== w.toLowerCase()), w] };
}

/**
 * The preference with this word deleted: out of the words added, and, if the
 * keyboard learned it, forgotten by the keyboard (removedWords).
 */
export function withoutWord(ti: TextInputPrefs, word: string, now = Date.now()): TextInputPrefs {
    const k = word.toLowerCase();
    const removed = { ...(ti.removedWords ?? {}), [k]: now };
    const kept = Object.entries(removed).sort((a, b) => b[1] - a[1]).slice(0, REMOVED_MAX);
    return {
        ...ti,
        userWords: (ti.userWords ?? []).filter((x) => x.toLowerCase() !== k),
        removedWords: Object.fromEntries(kept),
    };
}
