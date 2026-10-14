// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReleaseNotes, VersionHistory, releaseDate, type ReleaseNotesEntry } from "./releasenotes";

const minor: ReleaseNotesEntry = {
    version: "2.1.0", date: "2026-11-02", summary: "Reminders for tasks with a due time.",
    new: ["Set a reminder on any task with a due time.", "Snooze a reminder from its banner."],
    improved: ["Lists with hundreds of tasks scroll smoothly."],
    fixed: ["A task moved to another list no longer shows in both."], known: ["Reminders do not repeat yet."],
};
const rebuild: ReleaseNotesEntry = {
    version: "2.0.0", date: "2026-10-12", summary: "Tasks, rebuilt for webOS Phoenix.", new: ["Lists sync with your calendar accounts."],
    improved: [], fixed: [], known: [], rebuild: true, replaces: "Tasks 1.0 (webOS 3.0.5)",
};

describe("ReleaseNotes", () => {
    it("shows the version, its date, the summary and the first items under their headings, then all with More", () => {
        render(<ReleaseNotes notes={minor} testId="wn" />);
        const box = screen.getByTestId("wn");
        expect(box.textContent).toContain(`Version 2.1.0 · ${releaseDate("2026-11-02")}`);
        expect(box.textContent).toContain("Reminders for tasks with a due time.");
        expect([...box.querySelectorAll(".pui-notes-head")].map((h) => h.textContent)).toEqual(["New", "Improved"]);
        expect(box.querySelectorAll("li")).toHaveLength(3);
        fireEvent.click(screen.getByTestId("wn-more"));
        expect([...box.querySelectorAll(".pui-notes-head")].map((h) => h.textContent)).toEqual(["New", "Improved", "Fixed", "Known Issues"]);
        expect(box.querySelectorAll("li")).toHaveLength(5);
        expect(screen.queryByTestId("wn-more")).toBeNull();
    });

    it("has no More when everything fits, and says what a rebuild replaces", () => {
        render(<ReleaseNotes notes={rebuild} testId="rb" />);
        expect(screen.queryByTestId("rb-more")).toBeNull();
        expect(screen.getByTestId("rb-rebuild").textContent).toBe("Rebuilt for webOS Phoenix, in place of Tasks 1.0 (webOS 3.0.5)");
    });

    it("writes the day as the device's language does", () => {
        expect(releaseDate("2026-11-02")).toBe(new Date(2026, 10, 2).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
        expect(releaseDate("soon")).toBe("soon");
    });
});

describe("VersionHistory", () => {
    it("lists every version, newest first, each opening its notes", () => {
        render(<div><VersionHistory versions={[minor, rebuild]} testId="vh" /></div>);
        expect(screen.getByTestId("vh-2.1.0").textContent).toContain("Version 2.1.0");
        expect(screen.getByTestId("vh-2.0.0").textContent).toContain("Tasks, rebuilt for webOS Phoenix.");
        expect(screen.queryByTestId("vh-2.1.0-notes")).toBeNull();
        fireEvent.click(screen.getByTestId("vh-2.1.0"));
        expect(screen.getByTestId("vh-2.1.0-notes").querySelectorAll("li")).toHaveLength(5);
        fireEvent.click(screen.getByTestId("vh-2.0.0"));
        expect(screen.queryByTestId("vh-2.1.0-notes")).toBeNull();
        expect(screen.getByTestId("vh-2.0.0-notes").textContent).toContain("in place of Tasks 1.0");
    });
});
