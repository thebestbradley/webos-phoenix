// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Finding text in a PDF: each page's text items (PDF.js getTextContent)
// joined into one string, searched without regard to case, accents or
// how the words were split into items and lines.

export interface TextItemLike {
    str: string;
    hasEOL?: boolean;
}

export interface PageText {
    /** The page's text, items joined (a space at line ends). */
    text: string;
    /** Where each item starts in `text`. */
    starts: number[];
}

export interface Match {
    /** 0-based page. */
    page: number;
    /** Offset in the page's normalised text. */
    offset: number;
    length: number;
    /** The parts of text items the match covers, for highlighting: item index and the covered fraction of its width. */
    items: ItemPart[];
}

export interface ItemPart {
    item: number;
    /** 0..1 of the item's width. */
    from: number;
    to: number;
}

/** Lower case, no accents, one space for any run of white space. */
export function fold(s: string): string {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
}

export function pageText(items: TextItemLike[]): PageText {
    let text = "";
    const starts: number[] = [];
    for (const it of items) {
        let s = fold(it.str);
        // One space between words, however the items split them.
        if (text.endsWith(" ") && s.startsWith(" ")) s = s.slice(1);
        starts.push(text.length);
        text += s;
        // PDF.js marks the ends of lines; they count as a space.
        if (it.hasEOL && !text.endsWith(" ")) text += " ";
    }
    return { text, starts };
}

function itemsCovering(p: PageText, from: number, to: number): ItemPart[] {
    const out: ItemPart[] = [];
    for (let i = 0; i < p.starts.length; ++i) {
        const s = p.starts[i];
        const e = i + 1 < p.starts.length ? p.starts[i + 1] : p.text.length;
        if (e > from && s < to && e > s)
            out.push({ item: i, from: (Math.max(from, s) - s) / (e - s), to: (Math.min(to, e) - s) / (e - s) });
    }
    return out;
}

/** Every match of `query` in the pages, in reading order. */
export function findMatches(pages: PageText[], query: string, limit = 1000): Match[] {
    const q = fold(query).trim();
    const out: Match[] = [];
    if (!q) return out;
    pages.forEach((p, page) => {
        let at = p.text.indexOf(q);
        while (at >= 0 && out.length < limit) {
            out.push({ page, offset: at, length: q.length, items: itemsCovering(p, at, at + q.length) });
            at = p.text.indexOf(q, at + q.length);
        }
    });
    return out;
}

/** "3 of 12", "No matches" */
export function matchLabel(index: number, total: number): string {
    return total ? `${index + 1} of ${total}` : "No matches";
}
