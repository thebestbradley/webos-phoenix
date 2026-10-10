// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A connector package's page in Connections (ConnectorPackage.tsx): a
// third-party connector installs only in Developer Mode (the owner's
// decision, until the connector tier), and without it Install explains
// and leads to Settings > Developer Mode; a pre-installed one (Phoenix's
// own) installs again without it; Remove says it takes the accounts, and
// takes them.

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountType, InstallProgress } from "@phoenix/luna";

const luna = vi.hoisted(() => ({
    devModeOn: false,
    unlocked: true,
    installed: [] as { id: string; version: string; update: string | null }[],
    accounts: [] as { _id: string; templateId: string; username?: string }[],
    calls: [] as { uri: string; params: unknown }[],
    installs: [] as string[],
    removed: [] as string[],
    progress: [] as InstallProgress[],
    launch: vi.fn((..._a: unknown[]) => Promise.resolve({ returnValue: true })),
}));
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    const sub = () => ({ cancel() {} });
    return {
        ...real,
        apps: { ...real.apps, launch: luna.launch },
        devMode: {
            watch: (cb: (on: boolean) => void) => { setTimeout(() => cb(luna.devModeOn), 0); return sub(); },
            watchUnlocked: (cb: (on: boolean) => void) => { setTimeout(() => cb(luna.unlocked), 0); return sub(); },
        },
        call: (uri: string, params: unknown) => {
            luna.calls.push({ uri, params });
            if (/listAccounts$/.test(uri)) return Promise.resolve({ returnValue: true, results: luna.accounts });
            if (/getDevMode$/.test(uri)) return Promise.resolve({ returnValue: true, status: luna.devModeOn ? "enabled" : "disabled" });
            if (/deleteAccount$/.test(uri)) {
                luna.accounts = luna.accounts.filter((a) => a._id !== (params as { accountId: string }).accountId);
                return Promise.resolve({ returnValue: true });
            }
            return Promise.resolve({ returnValue: true });
        },
        marketplace: {
            ...real.marketplace,
            installed: () => Promise.resolve(luna.installed.map((a) => ({ ...a, catalogId: a.id, title: a.id, icon: "", catalogIcon: "", sourceId: "phoenix", kind: "connector" }))),
            app: () => Promise.resolve({}),
            accountTypes: () => Promise.resolve([]),
            install: (_s: string, id: string, onProgress: (p: InstallProgress) => void) => {
                luna.installs.push(id);
                setTimeout(() => {
                    if (luna.progress.some((p) => p.state === "installed")) luna.installed.push({ id, version: "0.1.0", update: null });
                    luna.progress.forEach((p) => onProgress(p));
                }, 0);
                return sub();
            },
            remove: (id: string) => { luna.removed.push(id); luna.installed = luna.installed.filter((a) => a.id !== id); return Promise.resolve({}); },
        },
    };
});

// Developer Mode found (Just Type's Konami code) or not: the way to it, or the hint.
vi.mock("@phoenix/luna/react", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna/react")>();
    return { ...real, useDevModeShown: () => luna.unlocked || luna.devModeOn };
});

import { ConnectorPackage, needsDevMode, removeAccountsText } from "./ConnectorPackage";
import { AccountTypePage } from "./Connections";

function type(templateId: string, o: Partial<AccountType> = {}): AccountType {
    return {
        templateId, sourceId: "phoenix", title: templateId, provider: "", icon: "", summary: "", capabilities: [{ capability: "FEEDS" }], protocols: [],
        auth: { type: "none", registration: "none" }, server: "user",
        privacy: { dataGoesTo: "nowhere", e2ee: false, phoenixServers: "none" },
        push: "poll", status: "experimental", package: { id: templateId, builtin: false }, help: "", featured: false, ...o,
    };
}
const FEEDS = type("org.example.feeds", { title: "News Feed (example)" });
const FEDI = type("com.webosphoenix.fediverse", { title: "Fediverse", package: { id: "org.webosphoenix.fediverse", builtin: false, preinstalled: true } });

beforeEach(() => {
    Object.assign(luna, { devModeOn: false, unlocked: true, installed: [], accounts: [], calls: [], installs: [], removed: [], progress: [] });
    luna.launch.mockClear();
});

describe("the Developer Mode gate", () => {
    it("third-party connectors need Developer Mode; Phoenix's own and built-in types do not", () => {
        expect(needsDevMode(FEEDS, false)).toBe(true);
        expect(needsDevMode(FEEDS, true)).toBe(false);
        expect(needsDevMode(FEDI, false)).toBe(false);
        expect(needsDevMode(type("x.y.z", { package: { id: "x", builtin: true } }), false)).toBe(false);
    });

    it("without Developer Mode, Install explains why and leads to Settings > Developer Mode; nothing is installed", async () => {
        const page = render(<AccountTypePage t={FEEDS} added={false} />);
        const install = await page.findByTestId("connector-install");
        expect(page.getByTestId("connector-third-party").textContent).toMatch(/installs in Developer Mode/);
        await waitFor(() => expect(luna.calls.length).toBeGreaterThan(0));
        fireEvent.click(install);
        const card = await page.findByTestId("devmode-needed");
        expect(card.textContent).toMatch(/Developer Mode needed/);
        expect(card.textContent).toMatch(/install only in Developer Mode/);
        expect(luna.installs).toEqual([]);
        fireEvent.click(page.getByTestId("open-devmode"));
        expect(luna.launch).toHaveBeenCalledWith("org.webosphoenix.settings", { page: "devmode" });
    });

    it("hidden Developer Mode: the Konami code hint instead of the button", async () => {
        luna.unlocked = false;
        const page = render(<ConnectorPackage t={FEEDS} added={false} />);
        fireEvent.click(await page.findByTestId("connector-install"));
        await page.findByTestId("devmode-hint");
        expect(page.queryByTestId("open-devmode")).toBeNull();
    });

    it("with Developer Mode on it installs through the Marketplace, then Set up opens Accounts at the template", async () => {
        luna.devModeOn = true;
        luna.progress = [{ id: "org.example.feeds", state: "downloading", progress: 10 }, { id: "org.example.feeds", state: "installed", progress: 100 }];
        const page = render(<ConnectorPackage t={FEEDS} added={false} />);
        const install = await page.findByTestId("connector-install");
        await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
        fireEvent.click(install);
        fireEvent.click(await page.findByTestId("set-up"));
        expect(luna.installs).toEqual(["org.example.feeds"]);
        expect(page.queryByTestId("devmode-needed")).toBeNull();
        expect(luna.launch).toHaveBeenCalledWith("com.palm.app.accounts", { templateId: "org.example.feeds" });
    });

    it("the service's NEEDS_DEVMODE (Developer Mode turned off meanwhile) shows the same card", async () => {
        luna.devModeOn = true;
        luna.progress = [{ id: "org.example.feeds", state: "failed", progress: 0, errorCode: "NEEDS_DEVMODE", errorText: "turn on Developer Mode" }];
        const page = render(<ConnectorPackage t={FEEDS} added={false} />);
        const install = await page.findByTestId("connector-install");
        await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
        fireEvent.click(install);
        await page.findByTestId("devmode-needed");
        expect(page.queryByTestId("install-error")).toBeNull();
    });
});

describe("a connector Phoenix comes with (pre-installed)", () => {
    it("is installed, removable: the confirmation says its accounts go, and they go before the package", async () => {
        luna.installed = [{ id: "org.webosphoenix.fediverse", version: "0.1.0", update: null }];
        luna.accounts = [{ _id: "a1", templateId: "com.webosphoenix.fediverse", username: "@me@example.social" }, { _id: "a2", templateId: "com.webosphoenix.dav" }];
        const page = render(<ConnectorPackage t={FEDI} added={true} />);
        await page.findByTestId("open-accounts");
        expect(page.getByTestId("connector-installed").textContent).toMatch(/comes with Phoenix/);
        fireEvent.click(page.getByTestId("connector-remove"));
        const dialog = await page.findByTestId("connector-remove-dialog");
        expect(dialog.textContent).toMatch(/Its account on this device \(@me@example\.social\) is removed with it/);
        expect(dialog.textContent).toMatch(/install it again from Connections/);
        fireEvent.click(page.getByTestId("connector-remove-confirm"));
        await page.findByTestId("connector-install");
        const order = luna.calls.filter((c) => /deleteAccount$/.test(c.uri)).map((c) => (c.params as { accountId: string }).accountId);
        expect(order).toEqual(["a1"]);
        expect(luna.removed).toEqual(["org.webosphoenix.fediverse"]);
        expect(luna.accounts.map((a) => a._id)).toEqual(["a2"]);
    });

    it("installs again without Developer Mode", async () => {
        luna.progress = [{ id: "org.webosphoenix.fediverse", state: "installed", progress: 100 }];
        const page = render(<ConnectorPackage t={FEDI} added={false} />);
        const install = await page.findByTestId("connector-install");
        expect(page.queryByTestId("connector-third-party")).toBeNull();
        fireEvent.click(install);
        await page.findByTestId("set-up");
        expect(luna.installs).toEqual(["org.webosphoenix.fediverse"]);
        expect(page.queryByTestId("devmode-needed")).toBeNull();
    });

    it("the words for what Remove takes", () => {
        expect(removeAccountsText([])).toBe("");
        expect(removeAccountsText([{ username: "a" }, { alias: "B" }])).toBe("Its 2 accounts on this device (a, B) are removed with it, and the data they brought.");
    });
});
