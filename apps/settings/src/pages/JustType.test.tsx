// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Just Type against the simulated com.palm.universalsearch: what
// it changes is what Just Type (com.palm.launcher) reads, in getUniversalSearchList
// and getAllSearchPreference; and Just Type's Preferences item
// (com.palm.app.searchpreferences) opens it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call, universalSearch, type SearchList } from "@phoenix/luna";
import { customEngineProblem, JustTypePage } from "./JustType";
import { dropIndex } from "../ReorderList";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
const REPO = resolve(__dirname, "../../../..");

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    // The installed apps' content searches and actions (apps.json).
    const apps = JSON.stringify([
        { id: "org.webosphoenix.tasks", launchPointId: "org.webosphoenix.tasks_default", title: "Tasks", icon: "/usr/palm/applications/org.webosphoenix.tasks/icon.png",
          universalSearch: JSON.parse(readFileSync(resolve(REPO, "apps/tasks/public/appinfo.json"), "utf8")).universalSearch },
        { id: "org.webosphoenix.help", launchPointId: "org.webosphoenix.help_default", title: "Help", icon: "/usr/palm/applications/org.webosphoenix.help/icon.png",
          universalSearch: { dbsearch: { displayName: "Help", url: "org.webosphoenix.help" } } },
    ]);
    const ps = (window as unknown as { PalmSystem: { getResource(p: string): string | undefined } }).PalmSystem;
    const get = ps.getResource;
    ps.getResource = (p: string) => (p === "/usr/share/phoenix/apps.json" ? apps : get.call(ps, p));
});

const list = () => new Promise<SearchList>((res) => { const s = universalSearch.watchList((l) => { s.cancel(); res(l); }); });

describe("com.palm.universalsearch", () => {
    it("orders, enables and picks the default engine as luna-universalsearchmgr's methods say", async () => {
        expect((await list()).engines.map((e) => e.id)).toEqual(["google", "wikipedia", "amazon", "imdb", "cnn"]);
        // Phoenix's others stay out of the list (docs/M6-PLAN.md F4).
        expect((await list()).optional.map((e) => e.id)).toEqual(["duckduckgo", "bing", "startpage"]);
        await universalSearch.move("search", "imdb", 0);
        await universalSearch.move("search", "google", 4);
        expect((await list()).engines.map((e) => e.id)).toEqual(["imdb", "wikipedia", "amazon", "cnn", "google"]);
        await universalSearch.setDefaultEngine("imdb");
        const l = await list();
        expect(l.defaultSearchEngine).toBe("imdb");
        expect(l.engines[0]).toMatchObject({ id: "imdb", enabled: true });
        await universalSearch.setAllEnabled("search", false);
        expect((await list()).engines.every((e) => !e.enabled)).toBe(true);
        await universalSearch.setAllEnabled("search", true);
        await expect(universalSearch.move("search", "nope", 1)).rejects.toThrow();
        await expect(universalSearch.setEnabled("search", "nope", true)).rejects.toThrow();
        // Back to the shipped order for the page's test.
        for (const [i, id] of ["google", "wikipedia", "amazon", "imdb", "cnn"].entries()) await universalSearch.move("search", id, i);
        await universalSearch.setDefaultEngine("google");
        for (const id of ["amazon", "imdb", "cnn"]) await universalSearch.setEnabled("search", id, false);
    });

    it("keeps the user's own engine, with %s where the words go (Phoenix)", async () => {
        await expect(universalSearch.setCustomEngine("Bad", "ftp://example.com/?q=%s")).rejects.toThrow();
        await expect(universalSearch.setCustomEngine("Bad", "https://example.com/")).rejects.toThrow();
        await universalSearch.setCustomEngine("Phoenix Search", "https://search.example.org/?q=%s&lang=en");
        const custom = (await list()).optional.find((e) => e.id === "custom")!;
        expect(custom).toMatchObject({ displayName: "Phoenix Search", url: "https://search.example.org/?q=#{searchTerms}&lang=en", enabled: true });
        expect(custom.iconFilePath).toBe("/usr/share/phoenix/runtime/search-icons/search-icon-web.svg");
        expect((await list()).engines.some((e) => e.id === "custom")).toBe(false);
        // The default: it joins the end of Just Type's list, which shows only engines from it.
        await universalSearch.setDefaultEngine("custom");
        expect((await list()).defaultSearchEngine).toBe("custom");
        expect((await list()).engines.map((e) => e.id)).toEqual(["google", "wikipedia", "amazon", "imdb", "cnn", "custom"]);
        // Removed: Google is the default again.
        await universalSearch.setCustomEngine("", "");
        const l = await list();
        expect(l.engines.map((e) => e.id)).toEqual(["google", "wikipedia", "amazon", "imdb", "cnn"]);
        expect(l.optional.some((e) => e.id === "custom")).toBe(false);
        expect(l.defaultSearchEngine).toBe("google");
        expect(customEngineProblem("https://x.org/?q=%s")).toBeNull();
        expect(customEngineProblem("x.org/?q=%s")).toMatch(/http/);
        expect(customEngineProblem("https://x.org/")).toMatch(/%s/);
    });

    it("opens from Just Type's Preferences (com.palm.app.searchpreferences)", async () => {
        await call("luna://com.palm.applicationManager/launch", { id: "com.palm.app.searchpreferences" });
        expect(hostMessages.filter((m) => m.type === "launch").pop()!.payload)
            .toEqual({ id: "org.webosphoenix.settings", params: { page: "justtype" } });
    });

    it("opens its Help (Enyo's HelpMenu: com.palm.app.help) at the Just Type topic", async () => {
        await call("luna://com.palm.applicationManager/open",
                   { id: "com.palm.app.help", params: { target: "http://help.palm.com/universalsearch/index.html" } });
        expect(hostMessages.filter((m) => m.type === "launch").pop()!.payload)
            .toEqual({ id: "org.webosphoenix.help", params: { topic: "justtype" } });
        await call("luna://com.palm.applicationManager/open", { id: "com.palm.app.help", params: { target: "http://help.palm.com/somewhere/index.html" } });
        expect(hostMessages.filter((m) => m.type === "launch").pop()!.payload).toEqual({ id: "org.webosphoenix.help", params: {} });
    });
});

describe("Settings > Just Type", () => {
    it("finds a row's place from how far it was dragged", () => {
        expect(dropIndex([50, 50, 50, 50], 0, 80)).toBe(2);
        expect(dropIndex([50, 50, 50, 50], 0, 20)).toBe(0);
        expect(dropIndex([50, 50, 50, 50], 3, -60)).toBe(2);
        expect(dropIndex([50, 50, 50, 50], 1, -500)).toBe(0);
        expect(dropIndex([50, 50, 50, 50], 1, 500)).toBe(3);
    });

    it("turns searches on and off, orders them and sets the preferences", async () => {
        render(<JustTypePage />);
        const amazon = await screen.findByTestId("jt-engine-amazon");
        expect(amazon.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(amazon);
        await waitFor(async () => expect((await list()).engines.find((e) => e.id === "amazon")!.enabled).toBe(true));
        // The grip moves Amazon up one place.
        fireEvent.keyDown(screen.getByTestId("grip-amazon"), { key: "ArrowUp" });
        await waitFor(async () => expect((await list()).engines.map((e) => e.id).slice(0, 3)).toEqual(["google", "amazon", "wikipedia"]));
        // Dragged down two rows.
        const grip = screen.getByTestId("grip-google");
        fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
        fireEvent.pointerMove(grip, { clientY: 210, pointerId: 1 });
        fireEvent.pointerUp(grip, { clientY: 210, pointerId: 1 });
        await waitFor(async () => expect((await list()).engines.map((e) => e.id).slice(0, 3)).toEqual(["amazon", "wikipedia", "google"]));
        // Contacts off.
        fireEvent.click(screen.getByTestId("jt-ContactSearch"));
        await waitFor(() => expect(screen.getByTestId("jt-ContactSearch").getAttribute("aria-checked")).toBe("false"));
        const prefs = await new Promise<Record<string, string>>((res) => { const s = universalSearch.watchPreferences((p) => { s.cancel(); res(p); }); });
        expect(prefs.ContactSearch).toBe("false");
        // The apps' content and actions.
        expect(screen.getByTestId("jt-content-org.webosphoenix.tasks")).toBeTruthy();
        expect(screen.getByTestId("jt-action-org.webosphoenix.tasks")).toBeTruthy();
        fireEvent.click(screen.getByTestId("jt-content-org.webosphoenix.help"));
        await waitFor(async () => expect((await list()).content.find((c) => c.id === "org.webosphoenix.help")!.enabled).toBe(false));
    });
});
