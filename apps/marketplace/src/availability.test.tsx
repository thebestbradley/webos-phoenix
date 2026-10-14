// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Which apps a device is offered, in the Marketplace (docs/APP-STORE.md
// 3.17): the line under the tabs says for which device and the kinds hidden
// here; an app not offered here says why and does not download (installed,
// it says it stays); Classics with classic apps hidden offers to show them;
// Catalogs > Kinds of Apps shows or hides each kind, saying which the
// catalog does not offer on this class.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Availability, InstalledApp, MarketApp } from "@phoenix/luna";

const market = vi.hoisted(() => ({
    apps: [] as MarketApp[],
    installed: [] as InstalledApp[],
    hidden: [] as string[],
    deviceClass: "phone",
    classicsOff: null as null | { reason: string; text: string },
    setKinds: [] as [string, boolean][],
}));
function availability(): Availability {
    return {
        deviceClass: market.deviceClass,
        deviceClasses: [{ id: "phone", name: "Phone" }, { id: "tablet", name: "Tablet" }, { id: "desktop", name: "Desktop" }],
        kinds: [
            { id: "phoenix", name: "Phoenix apps", about: "Made by webOS Phoenix", hidden: market.hidden.includes("phoenix"), offByCatalog: false },
            { id: "legacy", name: "Classic webOS apps", about: "The original webOS apps", hidden: market.hidden.includes("legacy"), offByCatalog: true },
            { id: "web", name: "Web apps", about: "Websites", hidden: market.hidden.includes("web"), offByCatalog: false },
        ],
        feeds: [],
    };
}
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    const sub = () => ({ cancel() {} });
    return {
        ...real,
        localCatalog: { watch: () => sub(), start: () => Promise.resolve() },
        devMode: { watch: () => sub(), watchUnlocked: () => sub() },
        systemStatus: { watch: () => sub() },
        subscribe: () => sub(),
        call: () => Promise.resolve({ returnValue: true }),
        marketplace: {
            ...real.marketplace,
            refresh: () => Promise.resolve([]),
            sources: () => Promise.resolve([]),
            accountTypes: () => Promise.resolve([]),
            browse: (section: string) => Promise.resolve(section === "classics" && market.classicsOff
                ? { apps: [], categories: [], more: false, offHere: market.classicsOff }
                : { apps: market.apps, categories: [], more: false }),
            app: (_s: string, id: string) => Promise.resolve(market.apps.find((a) => a.id === id)!),
            installed: () => Promise.resolve(market.installed),
            availability: () => Promise.resolve(availability()),
            setKind: (kind: string, enabled: boolean) => {
                market.setKinds.push([kind, enabled]);
                market.hidden = enabled ? market.hidden.filter((k) => k !== kind) : [...market.hidden, kind];
                return Promise.resolve(availability());
            },
        },
    };
});

import { App } from "./App";

function entry(id: string, o: Partial<MarketApp> = {}): MarketApp {
    return {
        id, sourceId: "phoenix", kind: "ipk", title: "Sketchpad", developer: { name: "Example", url: "" }, summary: "", description: "Draw.",
        categories: [], icon: "", screenshots: [], license: "", homepage: "", donation: "", featured: false, rating: null, version: "1.0.0",
        installed: null, update: null, appKind: "web", ...o,
    };
}

describe("the Marketplace offers each device what is on for it", () => {
    beforeEach(() => {
        // jsdom has no scrolling: each view starts at its top (App.tsx).
        if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
        market.apps = [];
        market.installed = [];
        market.hidden = [];
        market.deviceClass = "phone";
        market.classicsOff = null;
        market.setKinds = [];
    });

    it("says for which device the lists are, and the kinds hidden here", async () => {
        market.hidden = ["legacy"];
        render(<App />);
        const line = await screen.findByTestId("device-line");
        expect(line.textContent).toContain("Apps for this phone · Classic webOS apps hidden");
        fireEvent.click(within(line).getByTestId("device-settings"));
        expect(await screen.findByTestId("kind-legacy")).toBeTruthy();
    });

    it("an app not offered here says why and does not download; the classes it is for", async () => {
        market.apps = [entry("com.example.sketchpad", { deviceClasses: ["tablet", "desktop"],
                                                         offHere: { reason: "app", text: "Not offered on phones: made for tablets and desktops" } })];
        render(<App />);
        fireEvent.click(await screen.findByTestId("app-com.example.sketchpad"));
        expect((await screen.findByTestId("off-here")).textContent).toBe("Not offered on phones: made for tablets and desktops.");
        expect((screen.getByTestId("install-app") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId("app-kind").textContent).toContain("Web apps");
        expect(screen.getByTestId("app-classes").textContent).toContain("Tablet, Desktop");
    });

    it("installed, it stays: its page says so, it opens, and Installed Apps says it is not offered here", async () => {
        market.apps = [entry("com.example.sketchpad", { installed: { version: "1.0.0", sourceId: "phoenix" }, deviceClasses: ["tablet"],
                                                         offHere: { reason: "app", text: "Not offered on phones: made for tablets" } })];
        market.installed = [{ id: "com.example.sketchpad", catalogId: "com.example.sketchpad", title: "Sketchpad", icon: "", catalogIcon: "",
                              version: "1.0.0", sourceId: "phoenix", kind: "ipk", installedAt: "", update: null, appKind: "web",
                              offHere: { reason: "app", text: "Not offered on phones: made for tablets" } }];
        render(<App />);
        fireEvent.click(await screen.findByTestId("app-com.example.sketchpad"));
        expect((await screen.findByTestId("off-here")).textContent).toContain("It stays installed on this device, and gets its updates.");
        expect(screen.getByTestId("open-app")).toBeTruthy();
        fireEvent.click(screen.getByTestId("back"));
        fireEvent.click(await screen.findByTestId("nav-installed"));
        expect((await screen.findByTestId("installed-com.example.sketchpad")).textContent).toContain("not offered on this phone");
    });

    it("Classics with classic apps hidden here offers to show them again", async () => {
        market.hidden = ["legacy"];
        market.classicsOff = { reason: "hidden", text: "You hid classic webOS apps on this device (Catalogs > Kinds of Apps)" };
        render(<App />);
        fireEvent.click(await screen.findByTestId("tab-classics"));
        const card = await screen.findByTestId("classics-off-here");
        expect(card.textContent).toContain("You hid classic webOS apps on this device");
        expect(screen.queryByTestId("classics-on")).toBeNull();
        fireEvent.click(within(card).getByTestId("classics-show"));
        await waitFor(() => expect(market.setKinds).toEqual([["legacy", true]]));
    });

    it("Kinds of Apps: this device's class, each kind on or off, and what the catalog does not offer here", async () => {
        render(<App />);
        fireEvent.click(await screen.findByTestId("nav-settings"));
        expect((await screen.findByTestId("device-class")).textContent).toContain("Phone");
        expect(screen.getByTestId("kind-legacy").textContent).toContain("The Marketplace does not offer these on phones");
        const web = screen.getByTestId("kind-toggle-web");
        expect(web.getAttribute("aria-checked")).toBe("true");
        fireEvent.click(web);
        await waitFor(() => expect(screen.getByTestId("kind-toggle-web").getAttribute("aria-checked")).toBe("false"));
        expect(market.setKinds).toEqual([["web", false]]);
    });
});
