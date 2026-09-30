// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The formatting commands of the editor (Apple Notes' Aa menu and
// checklist button), as edits of the Markdown text and its selection.

export interface TextState {
    text: string;
    /** Selection start and end (textarea selectionStart / selectionEnd). */
    start: number;
    end: number;
}

/** Apple Notes' paragraph styles, and the Markdown each one writes. */
export type BlockStyle = "title" | "heading" | "subheading" | "body" | "bulleted" | "numbered" | "checklist" | "quote";

export type InlineStyle = "bold" | "italic" | "strikethrough" | "code";

const INLINE_MARK: Record<InlineStyle, string> = { bold: "**", italic: "*", strikethrough: "~~", code: "`" };

const HEADING = /^(#{1,6})[ \t]+/;
const LIST = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(\[[ xX]\][ \t]+)?/;
const QUOTE = /^[ \t]*>[ \t]?/;

function lineRange(text: string, start: number, end: number): [number, number] {
    // (lastIndexOf with -1 would look at index 0: a note opening with an
    // empty line would give a range starting after the caret.)
    const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    let to = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
    if (to < 0) to = text.length;
    return [from, to];
}

/** The style of the line holding the cursor. */
export function blockStyleAt(state: TextState): BlockStyle {
    const [from, to] = lineRange(state.text, state.start, state.start);
    const line = state.text.slice(from, to);
    const h = HEADING.exec(line);
    if (h) return h[1].length === 1 ? "title" : h[1].length === 2 ? "heading" : "subheading";
    const l = LIST.exec(line);
    if (l) return l[5] ? "checklist" : l[3] ? "numbered" : "bulleted";
    if (QUOTE.test(line)) return "quote";
    return "body";
}

function stripBlock(line: string): string {
    return line.replace(HEADING, "").replace(LIST, "$1").replace(QUOTE, "");
}

/**
 * Applies a paragraph style to every line in the selection. Choosing the
 * style a line already has turns it back into body text, as in Apple Notes.
 */
export function setBlockStyle(state: TextState, style: BlockStyle): TextState {
    const [from, to] = lineRange(state.text, state.start, state.end);
    const lines = state.text.slice(from, to).split("\n");
    const toggleOff = style !== "body" && blockStyleAt(state) === style;
    let n = 0;
    const out = lines.map((line) => {
        if (!line.trim() && lines.length > 1) return line;
        const indent = /^[ \t]*/.exec(line)![0];
        const bare = stripBlock(line).replace(/^[ \t]*/, "");
        if (toggleOff) return indent + bare;
        switch (style) {
            case "title": return "# " + bare;
            case "heading": return "## " + bare;
            case "subheading": return "### " + bare;
            case "bulleted": return indent + "- " + bare;
            case "numbered": return indent + `${++n}. ` + bare;
            case "checklist": return indent + "- [ ] " + bare;
            case "quote": return "> " + bare;
            default: return indent + bare;
        }
    });
    const replaced = out.join("\n");
    const text = state.text.slice(0, from) + replaced + state.text.slice(to);
    if (state.start === state.end) {
        // Keep the cursor at the same place in the line's own text.
        const delta = replaced.length - (to - from);
        const pos = Math.max(from, state.start + (lines.length === 1 ? delta : 0));
        return { text, start: Math.min(pos, from + replaced.length), end: Math.min(pos, from + replaced.length) };
    }
    return { text, start: from, end: from + replaced.length };
}

/**
 * Bold, italic, strikethrough or code around the selection; with the
 * markers already around it, removes them. With no selection, inserts the
 * pair and puts the cursor between them.
 */
export function toggleInline(state: TextState, style: InlineStyle): TextState {
    const mark = INLINE_MARK[style];
    const { text, start, end } = state;
    const before = text.slice(start - mark.length, start);
    const after = text.slice(end, end + mark.length);
    // Italic's "*" must not match the inside of bold's "**" (but "***x***"
    // is bold and italic, so its inner "*" pair is italic).
    const insideBold = style === "italic" && text[start - 2] === "*" && text[end + 1] === "*" && text[start - 3] !== "*";
    const wrapped = before === mark && after === mark && !insideBold;
    if (wrapped) {
        return {
            text: text.slice(0, start - mark.length) + text.slice(start, end) + text.slice(end + mark.length),
            start: start - mark.length,
            end: end - mark.length,
        };
    }
    const sel = text.slice(start, end);
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
        const inner = sel.slice(mark.length, sel.length - mark.length);
        return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
    }
    return {
        text: text.slice(0, start) + mark + sel + mark + text.slice(end),
        start: start + mark.length,
        end: end + mark.length,
    };
}

/** Inserts text at the selection, on lines of its own when block is set. */
export function insert(state: TextState, snippet: string, block = false, cursorOffset = snippet.length): TextState {
    const { text, start, end } = state;
    let pre = "";
    let post = "";
    if (block) {
        if (start > 0 && text[start - 1] !== "\n") pre = "\n\n";
        else if (start > 1 && text[start - 2] !== "\n") pre = "\n";
        if (end < text.length && text[end] !== "\n") post = "\n\n";
        else if (end < text.length - 1 && text[end + 1] !== "\n") post = "\n";
    }
    const at = start + pre.length + cursorOffset;
    return { text: text.slice(0, start) + pre + snippet + post + text.slice(end), start: at, end: at };
}

/** A GitHub-style table with a header row and two empty rows. */
export function insertTable(state: TextState, columns = 2): TextState {
    const head = "| " + Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(" | ") + " |";
    const rule = "|" + Array.from({ length: columns }, () => " --- ").join("|") + "|";
    const row = "|" + Array.from({ length: columns }, () => "   ").join("|") + "|";
    return insert(state, [head, rule, row, row].join("\n"), true, 2);
}

/** [selection](url), or the url in angle brackets with nothing selected. */
export function insertLink(state: TextState, url: string): TextState {
    const sel = state.text.slice(state.start, state.end);
    const snippet = sel ? `[${sel}](${url})` : `<${url}>`;
    return insert(state, snippet);
}

/** A fenced code block (Apple's Monostyled) around the selected lines. */
export function codeBlock(state: TextState): TextState {
    const [from, to] = lineRange(state.text, state.start, state.end);
    const body = state.text.slice(from, to);
    const fenced = "```\n" + body + "\n```";
    const text = state.text.slice(0, from) + fenced + state.text.slice(to);
    const cursor = from + 4 + body.length;
    return { text, start: cursor, end: cursor };
}

/**
 * Enter at the end of a list item continues the list with the same kind of
 * item (the next number, an unchecked box); Enter on an empty item ends the
 * list. Returns null when Enter should just insert a newline.
 */
export function continueList(state: TextState): TextState | null {
    const { text, start, end } = state;
    if (start !== end) return null;
    const [from, to] = lineRange(text, start, start);
    const line = text.slice(from, to);
    const m = LIST.exec(line);
    const q = !m && QUOTE.exec(line);
    if (!m && !q) return null;
    const marker = m ? m[0] : (q as RegExpExecArray)[0];
    if (start < from + marker.length) return null;
    if (line.slice(marker.length).trim() === "") {
        // An empty item: end the list, leaving an empty line.
        const out = text.slice(0, from) + text.slice(to);
        return { text: out, start: from, end: from };
    }
    let next: string;
    if (m) {
        const [, indent, bullet, num, delim, box] = m;
        next = indent + (bullet ? bullet : `${Number(num) + 1}${delim}`) + " " + (box ? "[ ] " : "");
    } else {
        next = marker;
    }
    const out = text.slice(0, start) + "\n" + next + text.slice(start);
    const at = start + 1 + next.length;
    return { text: out, start: at, end: at };
}

/** Tab and Shift+Tab in a list: nest the items, or bring them back out. */
export function indentLines(state: TextState, outdent: boolean): TextState | null {
    const [from, to] = lineRange(state.text, state.start, state.end);
    const lines = state.text.slice(from, to).split("\n");
    if (!lines.every((l) => !l.trim() || LIST.test(l))) return null;
    const out = lines.map((l) => (outdent ? l.replace(/^(?: {1,4}|\t)/, "") : l.trim() ? "    " + l : l));
    const replaced = out.join("\n");
    const text = state.text.slice(0, from) + replaced + state.text.slice(to);
    const delta = out[0].length - lines[0].length;
    if (state.start === state.end) {
        const pos = Math.max(from, state.start + delta);
        return { text, start: pos, end: pos };
    }
    return { text, start: from, end: from + replaced.length };
}
