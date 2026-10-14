// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An app's update log in the Marketplace (docs/APP-STORE.md "Update logs"):
// its page shows What's New under the description and the Version History
// after it, each version opening its notes; an app without a log shows
// neither; Installed Apps shows what each update brings.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledApp, MarketApp, ReleaseNotes } from "@phoenix/luna";

const minor: ReleaseNotes = {
    version: "2.1.0", date: "2026-11-02", summary: "Reminders for tasks with a due time.",
    new: ["Set a reminder on any task with a due time.", "Snooze a reminder from its banner."],
    improved: ["Lists with hundreds of tasks scroll smoothly."], fixed: ["A task moved to another list no longer shows in both."], known: [],
};
const rebuild: ReleaseNotes = {
    version: "2.0.0", date: "2026-10-12", summary: "Tasks, rebuilt for webOS Phoenix.", new: ["Lists sync with your calendar accounts."],
    improved: [], fixed: [], known: [], rebuild: true, replaces: "Tasks 1.0 (webOS 3.0.5)",
};

const market = vi.hoisted(() => ({
    apps: [] as MarketApp[],
    details: {} as Record<string, Partial<MarketApp>>,
    installed: [] as InstalledApp[],
    opened: [] as string[],
}));
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    const sub = () => ({ cancel() {} });
    return {
        ...real,
        apps: { ...real.apps, open: (url: string) => { market.opened.push(url); return Promise.resolve(); } },
        localCatalog: { watch: () => sub(), start: () => Promise.resolve() },
        devMode: { watch: () => sub(), watchUnlocked: () => sub() },
        subscribe: () => sub(),
        call: () => Promise.resolve({ returnValue: true }),
        marketplace: {
            ...real.marketplace,
            refresh: () => Promise.resolve([]),
            sources: () => Promise.resolve([]),
            accountTypes: () => Promise.resolve([]),
            browse: () => Promise.resolve({ apps: market.apps, categories: [], more: false }),
            app: (_s: string, id: string) => Promise.resolve({ ...market.apps.find((a) => a.id === id)!, ...market.details[id] }),
            installed: () => Promise.resolve(market.installed),
        },
    };
});

import { App } from "./App";

function entry(id: string, o: Partial<MarketApp> = {}): MarketApp {
    return {
        id, sourceId: "phoenix", kind: "ipk", title: id === "com.example.tasks" ? "Tasks" : "Notes", developer: { name: "Example", url: "" },
        summary: "", description: "An app for lists.", categories: [], icon: "", screenshots: [], license: "", homepage: "", donation: "",
        featured: false, rating: null, version: "2.1.0", installed: null, update: null, ...o,
    };
}

async function openApp(id: string) {
    render(<App />);
    fireEvent.click(await screen.findByTestId(`app-${id}`));
    return screen.findByTestId("app-page");
}

beforeEach(() => {
    // jsdom has no scrolling (each view scrolls to its top).
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
    market.apps = [entry("com.example.tasks", { whatsNew: minor }), entry("com.example.notes", { version: "1.0.0" })];
    market.details = { "com.example.tasks": { versionHistory: [minor, rebuild] } };
    market.installed = [];
    market.opened = [];
});

describe("an app's update log", () => {
    it("shows What's New under the description, collapsed with More, then the Version History", async () => {
        const page = await openApp("com.example.tasks");
        const whatsNew = await within(page).findByTestId("whats-new");
        expect(whatsNew.textContent).toContain("Version 2.1.0");
        expect(whatsNew.textContent).toContain("Reminders for tasks with a due time.");
        expect(whatsNew.querySelectorAll("li")).toHaveLength(3);
        fireEvent.click(within(page).getByTestId("whats-new-more"));
        expect(whatsNew.querySelectorAll("li")).toHaveLength(4);
        // Under the description, before the Version History and the details.
        const order = [...page.querySelectorAll(".mk-desc, .pui-group-label")].map((e) => e.textContent);
        expect(order.slice(0, 4)).toEqual(["An app for lists.", "What's New", "Version History", "Details"]);

        await waitFor(() => expect(within(page).getByTestId("version-history-2.0.0")).toBeTruthy());
        fireEvent.click(within(page).getByTestId("version-history-2.0.0"));
        expect(within(page).getByTestId("version-history-2.0.0-notes").textContent).toContain("in place of Tasks 1.0 (webOS 3.0.5)");
    });

    it("shows neither for an app without a log", async () => {
        const page = await openApp("com.example.notes");
        await within(page).findByText("Details");
        expect(within(page).queryByTestId("whats-new")).toBeNull();
        expect(page.textContent).not.toContain("Version History");
    });

    it("links a hosted web app's upstream release notes", async () => {
        market.apps[1] = entry("com.example.notes", { releaseNotesUrl: "https://github.com/example/notes/releases/tag/v1.0.0" });
        const page = await openApp("com.example.notes");
        fireEvent.click(await within(page).findByTestId("app-release-notes"));
        expect(market.opened).toEqual(["https://github.com/example/notes/releases/tag/v1.0.0"]);
    });

    it("shows what each update brings in Installed Apps", async () => {
        market.installed = [
            { id: "com.example.tasks", catalogId: "com.example.tasks", title: "Tasks", icon: "", catalogIcon: "", version: "2.0.0", sourceId: "phoenix",
              kind: "ipk", installedAt: "", update: "2.1.0", whatsNew: minor },
            { id: "com.example.notes", catalogId: "com.example.notes", title: "Notes", icon: "", catalogIcon: "", version: "1.0.0", sourceId: "phoenix",
              kind: "ipk", installedAt: "", update: null },
        ];
        render(<App />);
        fireEvent.click(await screen.findByTestId("nav-installed"));
        const update = await screen.findByTestId("update-com.example.tasks");
        expect(within(update).getByTestId("installed-com.example.tasks").textContent).toContain("2.0.0 → 2.1.0");
        expect(within(update).getByTestId("update-notes-com.example.tasks").textContent).toContain("Reminders for tasks with a due time.");
        expect(screen.getByTestId("installed-com.example.notes")).toBeTruthy();
        expect(screen.queryByTestId("update-com.example.notes")).toBeNull();
    });
});
