// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { groupNotes, shortDate, sortNotes } from "./dates";
import { NOTE_KIND, daysLeft, expiredNotes, folderNameProblem, notesInFolder, type Folder, type Note } from "./model";
import { searchNotes } from "./search";

const NOW = new Date(2026, 8, 29, 21, 0).getTime();
const DAY = 86400000;

function note(id: string, body: string, ago: number, extra: Partial<Note> = {}): Note {
    return {
        _id: id, _kind: NOTE_KIND, folderId: "notes", body, pinned: false,
        createdAt: NOW - ago - DAY, modifiedAt: NOW - ago, deletedAt: null, ...extra,
    };
}

describe("groupNotes", () => {
    const notes = [
        note("today", "Today", 60_000),
        note("yday", "Yesterday", DAY),
        note("week", "Week", 3 * DAY),
        note("month", "Month", 20 * DAY),
        note("aug", "August", 45 * DAY),
        note("old", "Old", 400 * DAY),
        note("pin", "Pinned", 10 * DAY, { pinned: true }),
    ];

    it("sections by date like Apple Notes, pinned first", () => {
        const s = groupNotes(notes, "modified", NOW, true, "en-US");
        expect(s.map((x) => x.title)).toEqual(["Pinned", "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "August", "2025"]);
        expect(s[0].notes.map((n) => n._id)).toEqual(["pin"]);
    });

    it("has no date sections when sorted by title", () => {
        const s = groupNotes(notes, "title", NOW);
        expect(s.map((x) => x.title)).toEqual(["Pinned", "Notes"]);
        expect(s[1].notes.map((n) => n._id)).toEqual(["aug", "month", "old", "today", "week", "yday"]);
    });

    it("sorts by creation date", () => {
        const a = note("a", "a", 5 * DAY, { createdAt: NOW - 1000 });
        const b = note("b", "b", 0, { createdAt: NOW - 50 * DAY });
        expect(sortNotes([b, a], "created").map((n) => n._id)).toEqual(["a", "b"]);
    });
});

describe("dates", () => {
    it("shortens dates as the list shows them", () => {
        expect(shortDate(NOW - DAY, NOW, "en-US")).toBe("Yesterday");
        expect(shortDate(NOW - 2 * DAY, NOW, "en-US")).toBe("Sunday");
        expect(shortDate(NOW - 30 * DAY, NOW, "en-US")).toBe("8/30/26");
        expect(shortDate(NOW - 60_000, NOW, "en-US")).toMatch(/8:59\s?PM/);
    });
});

describe("folders", () => {
    const notes = [
        note("a", "a", 0),
        note("b", "b", 0, { folderId: "f1" }),
        note("c", "c", 0, { deletedAt: NOW - 31 * DAY }),
        note("d", "d", 0, { deletedAt: NOW - DAY }),
    ];

    it("filters the built-in and user folders", () => {
        expect(notesInFolder(notes, "all").map((n) => n._id)).toEqual(["a", "b"]);
        expect(notesInFolder(notes, "notes").map((n) => n._id)).toEqual(["a"]);
        expect(notesInFolder(notes, "f1").map((n) => n._id)).toEqual(["b"]);
        expect(notesInFolder(notes, "deleted").map((n) => n._id)).toEqual(["c", "d"]);
    });

    it("keeps deleted notes 30 days", () => {
        expect(expiredNotes(notes, NOW).map((n) => n._id)).toEqual(["c"]);
        expect(daysLeft(notes[3], NOW)).toBe(29);
    });

    it("checks folder names", () => {
        const folders: Folder[] = [{ _id: "f1", _kind: "org.webosphoenix.enactnotes.folder:1", name: "Work", createdAt: 0 }];
        expect(folderNameProblem(" ", folders)).toBe("Enter a name.");
        expect(folderNameProblem("work", folders)).toMatch(/already exists/);
        expect(folderNameProblem("work", folders, "f1")).toBeNull();
        expect(folderNameProblem("Recently Deleted", folders)).toMatch(/reserved/);
        expect(folderNameProblem("Home", folders)).toBeNull();
    });
});

describe("searchNotes", () => {
    it("matches every word, ignoring case, accents and Markdown", () => {
        const notes = [note("a", "# Café\n\nBuy **beans**", 0), note("b", "Tea", 0)];
        expect(searchNotes(notes, "cafe BEANS").map((m) => m.note._id)).toEqual(["a"]);
        expect(searchNotes(notes, "beans")[0].context).toBe("Buy beans");
        expect(searchNotes(notes, "**")).toEqual([]);
        expect(searchNotes(notes, "  ")).toHaveLength(2);
    });

    it("filters by what notes contain", () => {
        const notes = [note("a", "- [ ] x\n\n<https://x.org>", 0), note("b", "| a |\n| - |\n| 1 |", 0), note("c", "`x`", 0)];
        expect(searchNotes(notes, "", ["checklist"]).map((m) => m.note._id)).toEqual(["a"]);
        expect(searchNotes(notes, "", ["checklist", "link"]).map((m) => m.note._id)).toEqual(["a"]);
        expect(searchNotes(notes, "", ["table"]).map((m) => m.note._id)).toEqual(["b"]);
        expect(searchNotes(notes, "", ["code"]).map((m) => m.note._id)).toEqual(["c"]);
    });
});
