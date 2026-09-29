// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    blockStyleAt, codeBlock, continueList, indentLines, insertLink, insertTable, setBlockStyle, toggleInline,
    type TextState,
} from "./editing";

const at = (text: string, start: number, end = start): TextState => ({ text, start, end });

describe("paragraph styles", () => {
    it("reads the style of the cursor's line", () => {
        expect(blockStyleAt(at("# T", 1))).toBe("title");
        expect(blockStyleAt(at("## T", 1))).toBe("heading");
        expect(blockStyleAt(at("### T", 1))).toBe("subheading");
        expect(blockStyleAt(at("- a", 1))).toBe("bulleted");
        expect(blockStyleAt(at("3. a", 1))).toBe("numbered");
        expect(blockStyleAt(at("- [x] a", 1))).toBe("checklist");
        expect(blockStyleAt(at("> a", 1))).toBe("quote");
        expect(blockStyleAt(at("a", 1))).toBe("body");
    });

    it("switches a line between styles, keeping the cursor in its text", () => {
        const s = setBlockStyle(at("one\ntwo", 5), "heading");
        expect(s.text).toBe("one\n## two");
        expect(s.start).toBe(8);
        expect(setBlockStyle(at("## two", 4), "checklist").text).toBe("- [ ] two");
        expect(setBlockStyle(at("- [ ] two", 7), "body").text).toBe("two");
    });

    it("turns a style off when it is chosen again", () => {
        expect(setBlockStyle(at("- a", 2), "bulleted").text).toBe("a");
        expect(setBlockStyle(at("# a", 2), "title").text).toBe("a");
    });

    it("numbers a selection of lines", () => {
        const text = "a\nb\nc";
        const s = setBlockStyle(at(text, 0, text.length), "numbered");
        expect(s.text).toBe("1. a\n2. b\n3. c");
        expect([s.start, s.end]).toEqual([0, s.text.length]);
    });
});

describe("inline styles", () => {
    it("wraps and unwraps the selection", () => {
        const b = toggleInline(at("say hi", 4, 6), "bold");
        expect(b).toEqual({ text: "say **hi**", start: 6, end: 8 });
        expect(toggleInline(b, "bold")).toEqual({ text: "say hi", start: 4, end: 6 });
        expect(toggleInline(at("say **hi**", 4, 10), "bold").text).toBe("say hi");
    });

    it("puts the cursor between a new pair", () => {
        expect(toggleInline(at("x", 1), "strikethrough")).toEqual({ text: "x~~~~", start: 3, end: 3 });
    });

    it("does not take bold's markers for italic's", () => {
        const s = toggleInline(at("**hi**", 2, 4), "italic");
        expect(s.text).toBe("***hi***");
        expect(toggleInline(s, "italic").text).toBe("**hi**");
    });
});

describe("lists", () => {
    it("continues a list on Enter", () => {
        expect(continueList(at("- a", 3))).toEqual({ text: "- a\n- ", start: 6, end: 6 });
        expect(continueList(at("9. a", 4))!.text).toBe("9. a\n10. ");
        expect(continueList(at("  - [x] a", 9))!.text).toBe("  - [x] a\n  - [ ] ");
        expect(continueList(at("> q", 3))!.text).toBe("> q\n> ");
    });

    it("ends the list on an empty item, and ignores other lines", () => {
        expect(continueList(at("- a\n- ", 6))).toEqual({ text: "- a\n", start: 4, end: 4 });
        expect(continueList(at("plain", 5))).toBeNull();
        expect(continueList(at("- a", 1))).toBeNull();
    });

    it("indents and outdents list items", () => {
        expect(indentLines(at("- a", 3), false)).toEqual({ text: "    - a", start: 7, end: 7 });
        expect(indentLines(at("    - a", 7), true)).toEqual({ text: "- a", start: 3, end: 3 });
        expect(indentLines(at("text", 1), false)).toBeNull();
    });
});

describe("inserts", () => {
    it("inserts a table on lines of its own", () => {
        const s = insertTable(at("above", 5));
        expect(s.text).toBe("above\n\n| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n|   |   |");
        expect(s.start).toBe(9);
    });

    it("links the selection, or the address alone", () => {
        expect(insertLink(at("see docs", 4, 8), "https://x.org").text).toBe("see [docs](https://x.org)");
        expect(insertLink(at("", 0), "https://x.org").text).toBe("<https://x.org>");
    });

    it("fences the selected lines", () => {
        expect(codeBlock(at("a\nb", 0, 3)).text).toBe("```\na\nb\n```");
    });
});
