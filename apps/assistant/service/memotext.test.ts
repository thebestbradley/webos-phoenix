// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A memo's text as the original Memos keeps it (lib/memotext.js): escaped
// as enyo.string.escapeHtml escapes, read back as Memos shows it, and text
// written unescaped (app/lib/DbApi.js:28-40) read as it was written.

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const req = createRequire(import.meta.url);
const memoText = req("./lib/memotext.js");
const ENYO = path.resolve(__dirname, "../../../third_party/enyo-1.0/framework/source/dom/util.js");

const SAID = ["Fish & chips <2 people>", "Mum's \"famous\" pie", "&lt; is a less-than", "a&nbsp;b &amp; c", "x > y && y < z", "", "plain words"];

describe("a memo's text", () => {
    it("is escaped as enyo.string.escapeHtml escapes, and read back as it was said", () => {
        expect(memoText.escape("Fish & chips <2 people>")).toBe("Fish &amp; chips &lt;2 people&gt;");
        // Quotes are left as they are (escapeHtml escapes only &, < and >).
        expect(memoText.escape("Mum's \"famous\" pie")).toBe("Mum's \"famous\" pie");
        expect(memoText.escape(null)).toBe("");
        expect(memoText.escape(undefined)).toBe("");
        for (const s of SAID) {
            expect(memoText.unescape(memoText.escape(s))).toBe(s);
            expect(memoText.plain(memoText.escape(s))).toBe(s);
        }
    });
    it("reads what Memos' editor writes: &nbsp; a space, quotes, &amp; last", () => {
        expect(memoText.unescape("Salt &amp; pepper&nbsp;&NBSP;mix")).toBe("Salt & pepper  mix");
        expect(memoText.unescape("Tom&#39;s &quot;special&quot;")).toBe("Tom's \"special\"");
        // "&amp;lt;": an "&lt;" a person typed.
        expect(memoText.unescape("&amp;lt;3")).toBe("&lt;3");
        // Lines stay lines.
        expect(memoText.plain("Grocery\nMilk &amp; eggs").split("\n")).toEqual(["Grocery", "Milk & eggs"]);
    });
    it("reads a memo written unescaped as Memos shows it", () => {
        // No entities: unchanged.
        expect(memoText.plain("Fish & chips")).toBe("Fish & chips");
        // A raw "<" or ">": Memos escapes it all when it reads it (DbApi.js:33-37), so it shows as written.
        expect(memoText.plain("Movie night <Friday> &amp; popcorn")).toBe("Movie night <Friday> &amp; popcorn");
        // The one difference: a literal "&amp;" with no "<" or ">" shows as "&", in Memos too.
        expect(memoText.plain("R&amp;D")).toBe("R&D");
        // Kept to write again: as stored, or escaped as Memos reads it.
        expect(memoText.kept("Fish &amp; chips")).toBe("Fish &amp; chips");
        expect(memoText.kept("Fish & chips")).toBe("Fish & chips");
        expect(memoText.kept("Movie night <Friday>")).toBe("Movie night &lt;Friday&gt;");
        expect(memoText.fields("Fish &amp; chips &lt;2 people&gt; and a long tail of words after")).toEqual({
            text: "Fish &amp; chips &lt;2 people&gt; and a long tail of words after", title: "Fish &amp; chips &lt;2 people&gt; and a long tail " });
    });
    // The original's own function, when the submodules are there (git submodule update --init).
    it.skipIf(!fs.existsSync(ENYO))("escapes exactly as Enyo 1's escapeHtml does", () => {
        const src = fs.readFileSync(ENYO, "utf8");
        const body = /escapeHtml: function\(inText\) \{([\s\S]*?)\n\t\}/.exec(src);
        expect(body).not.toBeNull();
        const enyoEscape = new Function("inText", body![1]) as (s: unknown) => string;
        for (const s of [...SAID, null, undefined, 42]) expect(memoText.escape(s)).toBe(enyoEscape(s));
    });
});
