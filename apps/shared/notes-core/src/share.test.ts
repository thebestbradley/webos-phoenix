// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { noteFromShare, shareOfNote } from "./share";

describe("sharing notes", () => {
    it("makes a note of a share", () => {
        expect(noteFromShare({ title: "Recipe", text: "Flour, eggs", url: "https://example.com/r" }))
            .toBe("# Recipe\n\nFlour, eggs\n\nhttps://example.com/r");
        expect(noteFromShare({ text: "see https://x.org", url: "https://x.org" })).toBe("see https://x.org");
        expect(noteFromShare({})).toBe("");
    });

    it("shares a note's title and Markdown", () => {
        expect(shareOfNote("# Shopping\n\n- milk")).toEqual({ title: "Shopping", text: "# Shopping\n\n- milk" });
    });
});
