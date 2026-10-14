// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's release notes in Settings (docs/APP-STORE.md "Update logs"):
// Updates shows an available update's notes before Download and Install,
// "What's New in This Version" for the running system and its Version
// History; Device Info's What's New opens the same notes; a system or a
// feed without notes shows the lines, or nothing.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseNotes, UpdateStatus } from "@phoenix/luna";

const v010: ReleaseNotes = {
    version: "0.1.0", date: "2026-10-14", summary: "The first release of webOS Phoenix.",
    new: ["Every app runs in its own card.", "Just Type finds apps.", "The Marketplace."], improved: [], fixed: [],
    known: ["Calls use simulated telephony."],
};
const v009: ReleaseNotes = { version: "0.0.9", date: "2026-09-01", summary: "A preview.", new: ["The launcher."], improved: [], fixed: [], known: [] };
const v020: ReleaseNotes = { version: "0.2.0", date: "2026-11-02", summary: "Reminders.", new: ["Set a reminder."], improved: [],
                             fixed: ["Banners no longer show twice."], known: [] };

const sys = vi.hoisted(() => ({ status: null as unknown, versions: [] as unknown[], missing: false }));
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return {
        ...real,
        systemUpdates: {
            ...real.systemUpdates,
            watchStatus: (cb: (s: unknown) => void) => { setTimeout(() => cb(sys.status), 0); return { cancel() {} }; },
            releaseNotes: () => (sys.missing ? Promise.reject(new Error("Unknown method")) : Promise.resolve(sys.versions)),
        },
        system: {
            ...real.system,
            deviceInfo: () => Promise.resolve({ device_name: "Phoenix Simulator" }),
            osInfo: () => Promise.resolve({ webos_name: "webOS Phoenix", webos_release: "0.1.0", webos_build_id: "1" }),
        },
        telephony: { ...real.telephony, platform: () => Promise.reject(new Error("no modem")) },
        call: () => Promise.reject(new Error("not here")),
    };
});

// Device Info shows the checkout's NOTICE and LICENSE, outside what the tests' server reads.
vi.mock("../../../../NOTICE?raw", () => ({ default: "" }));
vi.mock("../../../../LICENSE?raw", () => ({ default: "" }));

import { UpdatesPage } from "./Updates";
import { DeviceInfoPage } from "./DeviceInfo";
import { BackProvider } from "../nav";

function status(o: Partial<UpdateStatus> = {}): UpdateStatus {
    return {
        state: "idle", current: { name: "webOS Phoenix", version: "0.1.0", build: 1, releaseNotes: v010 }, available: null, progress: null,
        lastChecked: null, error: null, autoDownload: true, channel: "stable", channels: ["stable"], configured: true, verified: false,
        rollout: null, battery: null, minBattery: 20, deferred: false, ...o,
    };
}

beforeEach(() => {
    sys.status = status();
    sys.versions = [v010, v009];
    sys.missing = false;
});

describe("Settings > Updates", () => {
    it("shows What's New in This Version, and the Version History behind it", async () => {
        render(<BackProvider><UpdatesPage /></BackProvider>);
        const wn = await screen.findByTestId("update-whats-new");
        expect(wn.textContent).toContain("The first release of webOS Phoenix.");
        expect(screen.getByText("What's New in This Version")).toBeTruthy();
        fireEvent.click(screen.getByTestId("update-history"));
        expect((await screen.findByTestId("release-notes-current")).textContent).toContain("Calls use simulated telephony.");
        fireEvent.click(screen.getByTestId("release-notes-history-0.0.9"));
        expect(screen.getByTestId("release-notes-history-0.0.9-notes").textContent).toContain("The launcher.");
        // Back: the Updates page again.
        fireEvent.keyDown(window, { key: "Escape" });
        expect(await screen.findByTestId("update-whats-new")).toBeTruthy();
    });

    it("shows an available update's notes before Download, else its lines", async () => {
        sys.status = status({ available: { name: "webOS Phoenix", version: "0.2.0", build: 2, date: "2026-11-02", notes: ["Reminders."], size: 1024,
                                           releaseNotes: v020 } });
        render(<BackProvider><UpdatesPage /></BackProvider>);
        const notes = await screen.findByTestId("update-release-notes");
        expect(notes.textContent).toContain("Version 0.2.0");
        expect(notes.textContent).toContain("Banners no longer show twice.");
        expect(screen.queryByTestId("update-notes")).toBeNull();
        const group = notes.closest(".pui-group") as HTMLElement;
        expect(within(group).getByTestId("update-download")).toBeTruthy();
    });

    it("an older feed's lines, and a system without notes shows no What's New", async () => {
        sys.status = status({ current: { name: "webOS Phoenix", version: "0.1.0", build: 1 },
                              available: { name: "webOS Phoenix", version: "0.2.0", build: 2, date: "", notes: ["Faster cards"], size: 1024 } });
        render(<BackProvider><UpdatesPage /></BackProvider>);
        expect((await screen.findByTestId("update-notes")).textContent).toBe("Faster cards");
        expect(screen.queryByTestId("update-whats-new")).toBeNull();
        expect(screen.queryByText("What's New in This Version")).toBeNull();
    });
});

describe("Settings > Device Info", () => {
    it("shows the version with What's New, which opens the release notes", async () => {
        render(<BackProvider><DeviceInfoPage /></BackProvider>);
        fireEvent.click(await screen.findByTestId("release-notes"));
        expect(await screen.findByText("What's New in webOS Phoenix 0.1.0")).toBeTruthy();
        expect(screen.getByTestId("release-notes-history-0.1.0")).toBeTruthy();
    });

    it("a system without getReleaseNotes says it has no notes", async () => {
        sys.missing = true;
        render(<BackProvider><DeviceInfoPage /></BackProvider>);
        fireEvent.click(await screen.findByTestId("release-notes"));
        await waitFor(() => expect(screen.getByTestId("release-notes-none")).toBeTruthy());
    });
});
