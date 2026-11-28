// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The lists' headings name their accounts, also an account added while
// Tasks is open. Seen in phoenix-sim: a Tasks card left open showed a
// Google account's lists under "Account" (the accounts were read once, at
// start). The services are stand-ins here; the real ones, in Chromium:
// tools/test-tasks.cjs.

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
    accounts: [] as Array<{ _kind: string; _id: string; alias?: string; username?: string }>,
    lists: [] as Array<Record<string, unknown>>,
    watchers: [] as Array<(r: unknown[]) => void>,
}));

vi.mock("./lib/hooks", () => ({
    useLists: () => ({ lists: fake.lists, error: "", retry: () => undefined }),
    useTasks: () => [],
    useNow: () => Date.parse("2026-11-28T12:00:00Z"),
    useWide: () => true,
}));

vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return {
        ...real,
        db: {
            ...real.db,
            find: () => Promise.resolve(fake.accounts.slice()),
            watch: (_q: unknown, cb: (r: unknown[]) => void) => {
                fake.watchers.push(cb);
                Promise.resolve().then(() => cb(fake.accounts.slice()));
                return { cancel: () => undefined };
            },
        },
    };
});

import { App } from "./App";

describe("Tasks' account headings", () => {
    it("name an account added while Tasks is open", async () => {
        fake.accounts = [{ _kind: "com.palm.account:1", _id: "acc-ms", alias: "Microsoft" }];
        fake.lists = [
            { _id: "inbox", name: "Inbox", isDefault: true },
            { _id: "l-ms", name: "Tasks", accountId: "acc-ms" },
        ];
        const { rerender } = render(<App />);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.getByText("Microsoft")).toBeTruthy();

        // Accounts: Google added, with its lists.
        fake.accounts = fake.accounts.concat({ _kind: "com.palm.account:1", _id: "acc-g", alias: "Google" });
        fake.lists = fake.lists.concat({ _id: "l-g", name: "My Tasks", accountId: "acc-g" });
        await act(async () => { fake.watchers.forEach((cb) => cb(fake.accounts.slice())); await Promise.resolve(); });
        rerender(<App />);
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByText("Google")).toBeTruthy();
        expect(screen.queryByText("Account")).toBeNull();
    });
});
