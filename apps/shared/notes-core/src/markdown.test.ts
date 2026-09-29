// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { inlineText, renderMarkdown, summarize, taskStates, textLines, toggleTask, wordCount } from "./markdown";
import { WELCOME_NOTE } from "./sample";

describe("renderMarkdown", () => {
    it("renders CommonMark and GitHub's extensions", () => {
        const html = renderMarkdown("# Title\n\n**b** *i* ~~s~~ `c`\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<https://x.org>");
        expect(html).toContain("<h1>Title</h1>");
        expect(html).toContain("<strong>b</strong>");
        expect(html).toContain("<em>i</em>");
        expect(html).toContain("<del>s</del>");
        expect(html).toContain("<code>c</code>");
        expect(html).toContain("<table>");
        expect(html).toContain('<a href="https://x.org">');
    });

    it("renders task boxes that can be checked, numbered in order", () => {
        const html = renderMarkdown("- [ ] one\n- [x] two\n  - [ ] nested");
        expect(html).toMatch(/<input type="checkbox" data-task="0">/);
        expect(html).toMatch(/<input type="checkbox" data-task="1" checked="">/);
        expect(html).toMatch(/data-task="2"/);
        expect(html).not.toContain("disabled");
        // The counter starts again for every note.
        expect(renderMarkdown("- [ ] again")).toContain('data-task="0"');
    });

    it("removes scripts and event handlers from raw HTML", () => {
        const html = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>\n\n[x](javascript:alert(3))');
        expect(html).not.toContain("onerror");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("javascript:");
    });
});

describe("toggleTask", () => {
    it("checks and unchecks the chosen box", () => {
        const src = "- [ ] a\n- [x] b\n- [ ] c";
        expect(toggleTask(src, 0)).toBe("- [x] a\n- [x] b\n- [ ] c");
        expect(toggleTask(src, 1)).toBe("- [ ] a\n- [ ] b\n- [ ] c");
        expect(toggleTask(src, 2)).toBe("- [ ] a\n- [x] b\n- [x] c");
    });

    it("never edits a look-alike inside a code block", () => {
        const src = "```\n- [ ] not a task\n```\n\n- [ ] real";
        expect(taskStates(src)).toEqual([false]);
        expect(toggleTask(src, 0)).toBe("```\n- [ ] not a task\n```\n\n- [x] real");
    });

    it("handles numbered, nested and quoted tasks", () => {
        const src = "1. [ ] first\n   - [ ] inner\n\n> - [ ] quoted";
        expect(taskStates(src)).toEqual([false, false, false]);
        expect(taskStates(toggleTask(src, 1))).toEqual([false, true, false]);
        expect(taskStates(toggleTask(src, 2))).toEqual([false, false, true]);
    });

    it("leaves the note alone for an index out of range", () => {
        expect(toggleTask("- [ ] a", 3)).toBe("- [ ] a");
    });
});

describe("summaries", () => {
    it("titles a note by its first line, without Markdown", () => {
        expect(summarize("# **Shopping** list\n\n- [ ] milk\n- eggs")).toEqual({
            title: "Shopping list",
            preview: "milk eggs",
        });
        expect(summarize("")).toEqual({ title: "New Note", preview: "No additional text" });
        expect(summarize("Just a title").preview).toBe("No additional text");
    });

    it("reads links, tables and code as text", () => {
        expect(inlineText("see [the site](https://x.org) &amp; more")).toBe("see the site & more");
        expect(textLines("| a | b |\n| - | - |\n| 1 | 2 |")).toEqual(["a b", "1 2"]);
        expect(textLines("```\ncode  here\n```")).toEqual(["code here"]);
    });

    it("counts words", () => {
        expect(wordCount("# Hello world\n\n- [ ] one, two")).toBe(4);
        expect(wordCount(WELCOME_NOTE)).toBeGreaterThan(50);
    });
});
