// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { crumbs, DEFAULT_FAVORITES, folderTitle, kindLabel, loadPrefs, planPaste, savePrefs, shortDate } from "./browse";

beforeEach(() => localStorage.clear());

describe("Files helpers", () => {
    it("splits a path into the path bar", () => {
        expect(crumbs("/media/internal/Documents")).toEqual([
            { label: "/", path: "/" },
            { label: "media", path: "/media" },
            { label: "internal", path: "/media/internal" },
            { label: "Documents", path: "/media/internal/Documents" },
        ]);
        expect(crumbs("/")).toEqual([{ label: "/", path: "/" }]);
        expect(folderTitle("/media/internal")).toBe("Internal storage");
        expect(folderTitle("/")).toBe("Device");
        expect(folderTitle("/media/internal/Music")).toBe("Music");
    });

    it("plans a paste: free names for copies, nothing for a cut in place, no folder into itself", () => {
        const copy = planPaste({ mode: "copy", paths: ["/m/Docs/a.txt", "/m/Docs/b.txt"] }, "/m/Docs", ["a.txt", "b.txt", "a 2.txt"]);
        expect(copy.steps).toEqual([
            { from: "/m/Docs/a.txt", to: "/m/Docs/a 3.txt", move: false },
            { from: "/m/Docs/b.txt", to: "/m/Docs/b 2.txt", move: false },
        ]);
        const cut = planPaste({ mode: "cut", paths: ["/m/Docs/a.txt", "/m/Other/c.txt"] }, "/m/Docs", ["a.txt"]);
        expect(cut.steps).toEqual([{ from: "/m/Other/c.txt", to: "/m/Docs/c.txt", move: true }]);
        const into = planPaste({ mode: "copy", paths: ["/m/Docs"] }, "/m/Docs/Sub", []);
        expect(into).toEqual({ steps: [], skipped: ["/m/Docs"] });
    });

    it("dates rows by time today, day this year, and year before", () => {
        const now = new Date(2026, 8, 28, 15, 0).getTime();
        expect(shortDate(new Date(2026, 8, 28, 9, 5).getTime(), now)).toBe("9:05 AM");
        expect(shortDate(new Date(2026, 8, 3).getTime(), now)).toBe("Sep 3");
        expect(shortDate(new Date(2025, 11, 24).getTime(), now)).toBe("Dec 24, 2025");
        expect(kindLabel({ name: "a.ipk", type: "file" })).toBe("webOS package");
        expect(kindLabel({ name: "x", type: "directory" })).toBe("Folder");
    });

    it("keeps preferences, with /media/internal and its folders as the first favourites", () => {
        expect(loadPrefs()).toEqual({ sort: "name", showHidden: false, favorites: DEFAULT_FAVORITES });
        expect(DEFAULT_FAVORITES).toEqual(["/media/internal", "/media/internal/Downloads", "/media/internal/Documents",
                                           "/media/internal/Pictures", "/media/internal/Music"]);
        savePrefs({ sort: "date", showHidden: true, favorites: ["/tmp"] });
        expect(loadPrefs()).toEqual({ sort: "date", showHidden: true, favorites: ["/tmp"] });
        localStorage.setItem("org.webosphoenix.files:prefs", "{bad json");
        expect(loadPrefs().sort).toBe("name");
    });
});
