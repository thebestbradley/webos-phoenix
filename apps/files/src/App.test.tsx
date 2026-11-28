// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Files' Drives follow the drive accounts while Files is open: one added
// or removed in Accounts shows or goes at once. Seen in phoenix-sim: a card
// of Files left open kept a removed Google Drive and never showed the
// Dropbox added after it (the list was read at start and on a visibility
// change, which a card in the card view does not get). The services are
// stand-ins here; the real ones, in Chromium: tools/test-drives.cjs.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@phoenix/luna";

const drive = (id: string, title: string, account: string): FileEntry =>
    ({ name: id, path: "/media/drives/" + id, type: "folder", drive: { title, account } }) as unknown as FileEntry;

const fake = vi.hoisted(() => ({
    drives: [] as unknown[],
    watchers: [] as Array<(r: unknown[]) => void>,
}));

vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return {
        ...real,
        fileManager: {
            ...real.fileManager,
            list: () => Promise.resolve([]),
            drives: () => Promise.resolve(fake.drives.slice()),
            transfers: () => Promise.resolve([]),
        },
        db: {
            ...real.db,
            watch: (_q: unknown, cb: (r: unknown[]) => void) => { fake.watchers.push(cb); return { cancel: () => undefined }; },
        },
    };
});

import { App } from "./App";

// The drives as Favorites (the star) lists them on a phone.
const listedDrives = () => {
    fireEvent.click(screen.getByTestId("favorites"));
    const names = screen.queryAllByRole("option").map((o) => o.textContent ?? "").filter((t) => /\(/.test(t));
    fireEvent.keyDown(document, { key: "Escape" });
    return names;
};

describe("Files' drives", () => {
    beforeEach(() => {
        fake.drives = [drive("a1", "Google Drive", "phoenix@gdrive.test")];
        fake.watchers = [];
        // A phone's width: the drives are in Favorites (the star).
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    });

    it("follow the drive accounts while Files is open", async () => {
        render(<App />);
        await act(async () => { await Promise.resolve(); });
        expect(listedDrives()).toEqual(["Google Drive (phoenix@gdrive.test)"]);
        // Accounts: Google Drive removed, Dropbox added.
        fake.drives = [drive("a2", "Dropbox", "phoenix@dropbox.test")];
        await act(async () => { fake.watchers.forEach((cb) => cb([])); await Promise.resolve(); await Promise.resolve(); });
        expect(listedDrives()).toEqual(["Dropbox (phoenix@dropbox.test)"]);
    });
});
