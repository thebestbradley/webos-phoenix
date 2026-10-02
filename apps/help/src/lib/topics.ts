// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Help topics: one Markdown file each in apps/help/topics, with a front
// matter block:
//
//   ---
//   id: cards               (the file name without .md if left out)
//   title: Cards
//   category: Basics        (Basics, Apps, Settings; the list's sections)
//   order: 2                (within the category)
//   summary: One line for lists and Just Type
//   keywords: minimize, card view, close, stack
//   app: org.webosphoenix.phone   (optional: offers "Open Phone")
//   ---
//
// The app bundles them (import.meta.glob); vite.config.ts also writes
// dist/help-index.json from them, which is put into db8 for Just Type.

import { frontMatter, plainText } from "./markdown.ts";

export interface Topic {
    id: string;
    title: string;
    category: string;
    order: number;
    summary: string;
    keywords: string[];
    app?: string;
    /** The Markdown after the front matter. */
    body: string;
}

export const CATEGORIES = ["Basics", "Apps", "Settings"];

export function parseTopic(file: string, src: string): Topic {
    const { meta, body } = frontMatter(src);
    const id = meta.id || file.replace(/^.*\//, "").replace(/\.md$/, "");
    return {
        id,
        title: meta.title || id,
        category: meta.category || "Basics",
        order: Number(meta.order) || 99,
        summary: meta.summary || "",
        keywords: (meta.keywords || "").split(",").map((k) => k.trim()).filter(Boolean),
        app: meta.app || undefined,
        body,
    };
}

export function sortTopics(topics: Topic[]): Topic[] {
    const cat = (c: string) => (CATEGORIES.indexOf(c) < 0 ? CATEGORIES.length : CATEGORIES.indexOf(c));
    return [...topics].sort((a, b) => cat(a.category) - cat(b.category) || a.order - b.order || a.title.localeCompare(b.title));
}

const words = (s: string) => s.toLowerCase().split(/[^0-9a-zÀ-￿]+/).filter(Boolean);

/** Everything a search may match, lower case: title, summary, keywords and the text. */
export function searchText(t: Topic): string {
    return [t.title, t.summary, t.keywords.join(" "), plainText(t.body)].join(" ").toLowerCase();
}

/**
 * Topics matching every word of the query (each a word prefix), best
 * first: title hits, then keyword and summary hits, then the text.
 */
export function search(topics: Topic[], query: string): Topic[] {
    const q = words(query);
    if (!q.length) return sortTopics(topics);
    const scored: { t: Topic; score: number }[] = [];
    for (const t of topics) {
        const title = words(t.title), meta = words(t.summary + " " + t.keywords.join(" ")), text = words(plainText(t.body));
        let score = 0;
        let all = true;
        for (const w of q) {
            const pre = (list: string[]) => list.some((x) => x.startsWith(w));
            if (pre(title)) score += 10;
            else if (pre(meta)) score += 4;
            else if (pre(text)) score += 1;
            else { all = false; break; }
        }
        if (all) scored.push({ t, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title)).map((x) => x.t);
}

export interface HelpIndex {
    /** Changes whenever a topic changes. */
    version: string;
    topics: { id: string; title: string; summary: string; category: string; searchText: string }[];
}

/** FNV-1a, for the index version. */
function hash(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

export function buildIndex(topics: Topic[]): HelpIndex {
    const list = sortTopics(topics).map((t) => ({
        id: t.id, title: t.title, summary: t.summary, category: t.category, searchText: searchText(t),
    }));
    return { version: hash(JSON.stringify(list)), topics: list };
}
