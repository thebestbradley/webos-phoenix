// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { noteFeatures, textLines, type Feature } from "./markdown";
import type { Note } from "./model";

function fold(s: string): string {
    return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export interface Match {
    note: Note;
    /** The line holding the first match, for the result row. */
    context: string;
}

/**
 * Notes whose text holds every word of the query, ignoring case and
 * accents (as Apple Notes searches). Markdown syntax is not searched.
 */
export function searchNotes(notes: readonly Note[], query: string, features: readonly Feature[] = []): Match[] {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const having = features.length ? notes.filter((n) => {
        const f = noteFeatures(n.body);
        return features.every((x) => f.has(x));
    }) : notes;
    if (!words.length) return having.map((note) => ({ note, context: "" }));
    const out: Match[] = [];
    for (const note of having) {
        const lines = textLines(note.body);
        const folded = lines.map(fold);
        const all = folded.join("\n");
        if (!words.every((w) => all.includes(w))) continue;
        const at = folded.findIndex((l) => l.includes(words[0]));
        out.push({ note, context: at >= 0 ? lines[at] : "" });
    }
    return out;
}
