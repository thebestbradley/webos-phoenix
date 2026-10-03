// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes are plain Markdown: CommonMark with GitHub's extensions (tables,
// task lists, strikethrough, autolinks), rendered by marked. Nothing of our
// own is added to the syntax, so a note reads the same in any Markdown app.
// The HTML is sanitized with DOMPurify, since Markdown allows raw HTML.

import DOMPurify from "dompurify";
import { Marked, type Token, type Tokens } from "marked";

const lexOptions = { gfm: true, breaks: false } as const;

function makeRenderer(): Marked {
    let task = 0;
    return new Marked({
        ...lexOptions,
        hooks: {
            preprocess(src: string) {
                task = 0;
                return src;
            },
        },
        renderer: {
            // Task list boxes are live: data-task is the box's index in the
            // note, for toggleTask().
            checkbox({ checked }: Tokens.Checkbox) {
                return `<input type="checkbox" data-task="${task++}"${checked ? " checked" : ""}> `;
            },
            listitem(item: Tokens.ListItem) {
                const body = this.parser.parse(item.tokens);
                return item.task ? `<li class="task${item.checked ? " done" : ""}">${body}</li>\n` : `<li>${body}</li>\n`;
            },
        },
    });
}

const renderer = makeRenderer();
const lexer = new Marked(lexOptions);

/** The note as sanitized HTML. */
export function renderMarkdown(src: string): string {
    const html = renderer.parse(src, { async: false });
    return DOMPurify.sanitize(html, {
        ADD_ATTR: ["data-task"],
        FORBID_TAGS: ["style", "form", "button", "select", "textarea"],
    });
}

function tokens(src: string): Token[] {
    return lexer.lexer(src);
}

/** Every task list box in the note, in order: checked or not. */
export function taskStates(src: string): boolean[] {
    const out: boolean[] = [];
    lexer.walkTokens(tokens(src), (t) => {
        if (t.type === "list_item" && (t as Tokens.ListItem).task) out.push(!!(t as Tokens.ListItem).checked);
    });
    return out;
}

// A line that may hold a task box: list marker (inside any blockquotes),
// then [ ], [x] or [X]. Group 1 ends just before the box's inner character.
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)[ xX]\]/;

/**
 * Checks or unchecks the index-th task box (the data-task index from
 * renderMarkdown). The box is found by trying each candidate line and
 * keeping the change that marked itself reads as flipping exactly that box,
 * so code blocks and the like can never be edited by mistake.
 */
export function toggleTask(src: string, index: number): string {
    const before = taskStates(src);
    if (index < 0 || index >= before.length) return src;
    const want = before.slice();
    want[index] = !want[index];
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const m = TASK_LINE.exec(lines[i]);
        if (!m) continue;
        const at = m[1].length;
        const mark = lines[i][at] === " " ? "x" : " ";
        const changed = lines.slice();
        changed[i] = lines[i].slice(0, at) + mark + lines[i].slice(at + 1);
        const next = changed.join("\n");
        const after = taskStates(next);
        if (after.length === want.length && after.every((v, k) => v === want[k])) return next;
    }
    return src;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

function decode(s: string): string {
    return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]);
}

/** Inline Markdown as plain text ("**Buy** [milk](x)" -> "Buy milk"). */
export function inlineText(md: string): string {
    const t = lexer.parseInline(md, { async: false, renderer: new lexer.TextRenderer() as never });
    return decode(String(t)).replace(/\s+/g, " ").trim();
}

function blockLines(list: Token[], out: string[]): void {
    for (const t of list) {
        switch (t.type) {
            case "heading":
                out.push(inlineText((t as Tokens.Heading).text));
                break;
            case "paragraph":
                for (const line of (t as Tokens.Paragraph).text.split("\n")) out.push(inlineText(line));
                break;
            case "code":
                for (const line of (t as Tokens.Code).text.split("\n")) out.push(line.trim());
                break;
            case "blockquote":
                blockLines((t as Tokens.Blockquote).tokens, out);
                break;
            case "list":
                for (const item of (t as Tokens.List).items) blockLines(item.tokens, out);
                break;
            case "text":
                for (const line of (t as Tokens.Text).text.split("\n")) out.push(inlineText(line));
                break;
            case "table": {
                const tb = t as Tokens.Table;
                out.push(tb.header.map((c) => inlineText(c.text)).join(" "));
                for (const row of tb.rows) out.push(row.map((c) => inlineText(c.text)).join(" "));
                break;
            }
            case "html":
                out.push(decode((t as Tokens.HTML).text.replace(/<[^>]*>/g, " ")).trim());
                break;
            default:
                break;
        }
    }
}

/** The note's text, one line per paragraph line, heading, item or row. */
export function textLines(src: string): string[] {
    const out: string[] = [];
    blockLines(tokens(src), out);
    return out.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 0);
}

export interface Summary {
    /** The first line, as Apple Notes titles a note. */
    title: string;
    /** The text after it. */
    preview: string;
}

export function summarize(src: string): Summary {
    const lines = textLines(src);
    return {
        title: lines[0] ?? "New Note",
        preview: lines.slice(1).join(" ").slice(0, 200) || "No additional text",
    };
}

/** Words in the note (for the note's info). */
export function wordCount(src: string): number {
    return textLines(src).join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export type Feature = "checklist" | "table" | "link" | "code";

/** What a note contains, for the search filters (Apple's "Notes with Checklists"). */
export function noteFeatures(src: string): Set<Feature> {
    const out = new Set<Feature>();
    lexer.walkTokens(tokens(src), (t) => {
        if (t.type === "list_item" && (t as Tokens.ListItem).task) out.add("checklist");
        else if (t.type === "table") out.add("table");
        else if (t.type === "link") out.add("link");
        else if (t.type === "code" || t.type === "codespan") out.add("code");
    });
    return out;
}
