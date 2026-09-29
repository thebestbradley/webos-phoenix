// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { clampZoom, forgetRecent, loadRecents, pageInView, recentFor, saveRecent, stepZoom } from "./library";
import { findMatches, fold, matchLabel, pageText } from "./search";

describe("search", () => {
    it("folds case, accents and white space", () => {
        expect(fold("Café  CRÈME\n")).toBe("cafe creme ");
    });

    it("joins a page's text items, a space at line ends", () => {
        const p = pageText([{ str: "The harbor at", hasEOL: true }, { str: "dusk." }, { str: " A " }, { str: " boat" }]);
        expect(p.text).toBe("the harbor at dusk. a boat");
        expect(p.starts).toEqual([0, 14, 19, 22]);
    });

    it("finds matches across pages and item boundaries, with the parts to mark", () => {
        const pages = [
            pageText([{ str: "Nothing here" }]),
            pageText([{ str: "Try the Har" }, { str: "bor walk; harbor" }]),
            pageText([{ str: "HARBOR", hasEOL: true }]),
        ];
        const m = findMatches(pages, "harbor");
        expect(m.map((x) => x.page)).toEqual([1, 1, 2]);
        expect(m[0].items.map((p) => p.item)).toEqual([0, 1]);
        expect(m[0].items[0].from).toBeCloseTo(8 / 11);
        expect(m[0].items[1]).toMatchObject({ item: 1, from: 0 });
        expect(findMatches(pages, "  ")).toEqual([]);
        expect(matchLabel(1, 3)).toBe("2 of 3");
        expect(matchLabel(0, 0)).toBe("No matches");
    });
});

describe("pages and zoom", () => {
    beforeEach(() => localStorage.clear());

    it("steps and clamps the zoom", () => {
        expect(stepZoom(1, 1)).toBe(1.25);
        expect(stepZoom(1, -1)).toBe(0.75);
        expect(stepZoom(4, 1)).toBe(4);
        expect(stepZoom(1.1, -1)).toBe(1);
        expect(clampZoom(9)).toBe(4);
        expect(clampZoom(0.1)).toBe(0.5);
    });

    it("knows which page is in view", () => {
        const tops = [8, 500, 1000, 1500];
        expect(pageInView(tops, 0, 450)).toBe(0);
        expect(pageInView(tops, 420, 450)).toBe(1);
        expect(pageInView(tops, 1400, 450)).toBe(3);
    });

    it("remembers recent documents, newest first", () => {
        saveRecent({ target: "/a.pdf", title: "A", page: 3, pages: 9, zoom: 1.5 }, 1);
        saveRecent({ target: "/b.pdf", title: "B", page: 1, zoom: 1 }, 2);
        saveRecent({ target: "/a.pdf", title: "A", page: 4, pages: 9, zoom: 1.5 }, 3);
        expect(loadRecents().map((r) => [r.target, r.page])).toEqual([["/a.pdf", 4], ["/b.pdf", 1]]);
        expect(recentFor("/a.pdf")?.zoom).toBe(1.5);
        forgetRecent("/a.pdf");
        expect(recentFor("/a.pdf")).toBeUndefined();
    });
});
