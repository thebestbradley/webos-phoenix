// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The small part of Markdown the help topics use, parsed into blocks the
// app renders as React elements (never as HTML, so a topic cannot inject
// markup):
//
//   ## Heading, ### Subheading
//   paragraphs (lines joined), blank lines between blocks
//   - bullets, 1. numbered steps
//   > a tip (a block quote)
//   **bold**, *italic*, `a key or a name`, [text](url)
//
// Links: topic:ID goes to another topic, app:APP_ID opens an app,
// anything else opens in the browser.

export type Inline =
    | { t: "text"; text: string }
    | { t: "strong"; children: Inline[] }
    | { t: "em"; children: Inline[] }
    | { t: "code"; text: string }
    | { t: "link"; href: string; children: Inline[] };

export type Block =
    | { t: "h2" | "h3" | "p" | "quote"; children: Inline[] }
    | { t: "ul" | "ol"; items: Inline[][] };

export interface FrontMatter {
    [key: string]: string;
}

/** Split "---\nkey: value\n---\nbody" into its fields and body. */
export function frontMatter(src: string): { meta: FrontMatter; body: string } {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
    if (!m) return { meta: {}, body: src };
    const meta: FrontMatter = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (kv) meta[kv[1]] = kv[2].trim();
    }
    return { meta, body: src.slice(m[0].length) };
}

export function parseInline(src: string): Inline[] {
    const out: Inline[] = [];
    let text = "";
    const flush = () => { if (text) { out.push({ t: "text", text }); text = ""; } };
    let i = 0;
    while (i < src.length) {
        const rest = src.slice(i);
        let m: RegExpExecArray | null;
        if ((m = /^`([^`]+)`/.exec(rest))) {
            flush();
            out.push({ t: "code", text: m[1] });
        } else if ((m = /^\*\*(.+?)\*\*/.exec(rest))) {
            flush();
            out.push({ t: "strong", children: parseInline(m[1]) });
        } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
            flush();
            out.push({ t: "em", children: parseInline(m[1]) });
        } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
            flush();
            out.push({ t: "link", href: m[2], children: parseInline(m[1]) });
        } else if (rest[0] === "\\" && rest.length > 1) {
            text += rest[1];
            i += 2;
            continue;
        } else {
            text += rest[0];
            i += 1;
            continue;
        }
        i += m[0].length;
    }
    flush();
    return out;
}

export function parseMarkdown(src: string): Block[] {
    const blocks: Block[] = [];
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    let para: string[] = [];
    let list: { t: "ul" | "ol"; items: string[] } | null = null;
    let quote: string[] = [];
    const flush = () => {
        if (para.length) blocks.push({ t: "p", children: parseInline(para.join(" ")) });
        if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) });
        if (quote.length) blocks.push({ t: "quote", children: parseInline(quote.join(" ")) });
        para = [];
        list = null;
        quote = [];
    };
    for (const raw of lines) {
        const line = raw.trimEnd();
        let m: RegExpExecArray | null;
        if (!line.trim()) {
            flush();
        } else if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
            flush();
            blocks.push({ t: m[1].length === 2 ? "h2" : "h3", children: parseInline(m[2]) });
        } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
            if (para.length || quote.length || (list && list.t !== "ul")) flush();
            list = list ?? { t: "ul", items: [] };
            list.items.push(m[1]);
        } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
            if (para.length || quote.length || (list && list.t !== "ol")) flush();
            list = list ?? { t: "ol", items: [] };
            list.items.push(m[1]);
        } else if ((m = /^>\s?(.*)$/.exec(line))) {
            if (para.length || list) flush();
            quote.push(m[1]);
        } else if (list && /^\s{2,}\S/.test(raw)) {
            // A wrapped list item.
            list.items[list.items.length - 1] += " " + line.trim();
        } else {
            if (list || quote.length) flush();
            para.push(line.trim());
        }
    }
    flush();
    return blocks;
}

/** The words of some Markdown, without its markup (for search). */
export function plainText(src: string): string {
    return src
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_>#]/g, " ")
        .replace(/^\s*(\d+[.)]|-)\s+/gm, "")
        .replace(/\s+/g, " ")
        .trim();
}
