// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { frontMatter, parseInline, parseMarkdown, plainText } from "./markdown";
import { buildIndex, CATEGORIES, parseTopic, search, sortTopics, type Topic } from "./topics";

const DIR = resolve(__dirname, "../../topics");
const all: Topic[] = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => parseTopic(f, readFileSync(resolve(DIR, f), "utf8")));

describe("markdown", () => {
    it("reads the front matter", () => {
        const { meta, body } = frontMatter("---\ntitle: Cards\norder: 2\n---\nHello");
        expect(meta).toEqual({ title: "Cards", order: "2" });
        expect(body).toBe("Hello");
    });

    it("parses blocks and inline markup", () => {
        const b = parseMarkdown("## Tips\n\nOne **two**\nthree.\n\n- a *b*\n- `c`\n  wrapped\n\n1. first\n2. [x](topic:y)\n\n> **Tip:** go");
        expect(b.map((x) => x.t)).toEqual(["h2", "p", "ul", "ol", "quote"]);
        expect(b[1]).toEqual({ t: "p", children: [{ t: "text", text: "One " }, { t: "strong", children: [{ t: "text", text: "two" }] }, { t: "text", text: " three." }] });
        expect(b[2]).toMatchObject({ items: [[{ text: "a " }, { t: "em" }], [{ t: "code", text: "c" }, { text: " wrapped" }]] });
        expect(b[3]).toMatchObject({ items: [[{ text: "first" }], [{ t: "link", href: "topic:y" }]] });
    });

    it("keeps markup out of the text and HTML as text", () => {
        expect(parseInline("<b>hi</b>")).toEqual([{ t: "text", text: "<b>hi</b>" }]);
        expect(plainText("**Bold** and [a link](topic:x), `code`")).toBe("Bold and a link, code");
    });
});

describe("the topics", () => {
    it("are complete and link to topics that exist", () => {
        expect(all.length).toBeGreaterThanOrEqual(20);
        const ids = new Set(all.map((t) => t.id));
        for (const t of all) {
            expect(t.title, t.id).not.toBe(t.id);
            expect(t.summary, t.id).not.toBe("");
            expect(CATEGORIES, t.id).toContain(t.category);
            for (const m of t.body.matchAll(/\]\(topic:([^)]+)\)/g)) expect(ids.has(m[1]), `${t.id} -> ${m[1]}`).toBe(true);
        }
        // The shell's basics and each Phoenix app have one.
        for (const id of ["gestures", "cards", "launcher", "notifications", "justtype", "lockscreen", "phone", "messaging",
            "camera", "photos", "music", "files", "tasks", "voicememos", "emergency", "location"])
            expect(ids.has(id), id).toBe(true);
    });

    it("sort by category and order", () => {
        const s = sortTopics(all);
        expect(s[0].id).toBe("gestures");
        expect(s.findIndex((t) => t.category === "Apps")).toBeGreaterThan(s.findIndex((t) => t.id === "lockscreen"));
    });

    it("are found by title first, then keywords and text", () => {
        expect(search(all, "card")[0].id).toBe("cards");
        expect(search(all, "back")[0].id).toBe("gestures");
        expect(search(all, "blood type").map((t) => t.id)).toContain("emergency");
        expect(search(all, "zzzz")).toEqual([]);
        expect(search(all, "").length).toBe(all.length);
    });

    it("make an index for Just Type whose version follows the content", () => {
        const a = buildIndex(all);
        expect(a.topics.length).toBe(all.length);
        expect(a.topics.find((t) => t.id === "gestures")!.searchText).toContain("gesture area");
        const b = buildIndex(all.map((t) => (t.id === "cards" ? { ...t, body: t.body + " more" } : t)));
        expect(b.version).not.toBe(a.version);
    });
});
