// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Developer Mode against the simulated services: out of sight
// (the list of panes, a launch straight into it) until Just Type's Konami
// code revealed it (the devModeUnlocked preference), and Hide Developer
// Mode while it is off. tools/test-settings.cjs drives it in Chromium.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "@phoenix/luna";
import { App } from "../App";
import { BackProvider } from "../nav";
import { DevModePage } from "./DevMode";
import { Hub } from "./Hub";

// Device Info shows the NOTICE and LICENSE files, which the test server
// does not serve; the router needs none of it.
vi.mock("./DeviceInfo", () => ({ DeviceInfoPage: () => null }));

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) =>
        p === "/usr/share/phoenix/apps.json" ? "[]" : undefined;
});

beforeEach(() => localStorage.clear());
afterEach(() => { (window as unknown as { PalmSystem: { launchParams?: string } }).PalmSystem.launchParams = "{}"; });

const unlocked = async () => ((await call("luna://com.webos.service.systemservice/getPreferences", { keys: ["devModeUnlocked"] })) as
    { devModeUnlocked?: boolean }).devModeUnlocked;

describe("Settings > Developer Mode, out of sight", () => {
    it("is not in the list of panes until revealed", async () => {
        const { unmount } = render(<Hub onOpen={() => {}} />);
        await waitFor(() => expect(screen.getByTestId("hub-advanced")).toBeTruthy());
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(screen.queryByTestId("hub-devmode")).toBeNull();
        unmount();
        await call("luna://com.webos.service.systemservice/setPreferences", { devModeUnlocked: true });
        render(<Hub onOpen={() => {}} />);
        await waitFor(() => expect(screen.getByTestId("hub-devmode")).toBeTruthy());
    });

    it("shows the list instead when launched straight into it before it was revealed", async () => {
        (window as unknown as { PalmSystem: { launchParams?: string } }).PalmSystem.launchParams = JSON.stringify({ page: "devmode" });
        render(<App />);
        await waitFor(() => expect(screen.getByTestId("hub-advanced")).toBeTruthy());
        expect(screen.queryByTestId("devmode-toggle")).toBeNull();
    });

    it("opens when launched straight into it once revealed", async () => {
        await call("luna://com.webos.service.systemservice/setPreferences", { devModeUnlocked: true });
        (window as unknown as { PalmSystem: { launchParams?: string } }).PalmSystem.launchParams = JSON.stringify({ page: "devmode" });
        render(<App />);
        await waitFor(() => expect(screen.getByTestId("devmode-toggle")).toBeTruthy());
    });
});

describe("Hide Developer Mode", () => {
    it("is offered while Developer Mode is off, and hides the pane again", async () => {
        await call("luna://com.webos.service.systemservice/setPreferences", { devModeUnlocked: true });
        render(<BackProvider><DevModePage /></BackProvider>);
        const hide = await screen.findByTestId("devmode-hide");
        fireEvent.click(hide);
        await waitFor(async () => expect(await unlocked()).toBe(false));
    });

    it("is not offered while Developer Mode is on", async () => {
        await call("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        render(<BackProvider><DevModePage /></BackProvider>);
        await waitFor(() => expect(screen.getByTestId("devmode-fps")).toBeTruthy());
        expect(screen.queryByTestId("devmode-hide")).toBeNull();
    });

    it("turning it off keeps the pane in sight when it was on without being revealed", async () => {
        await call("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        render(<BackProvider><DevModePage /></BackProvider>);
        const toggle = await screen.findByTestId("devmode-toggle");
        await waitFor(() => expect(toggle.getAttribute("aria-checked") ?? toggle.querySelector("input")?.checked).toBeTruthy());
        await act(async () => { fireEvent.click(toggle.querySelector("input") ?? toggle); });
        await waitFor(async () => expect(await unlocked()).toBe(true));
        expect((await call("luna://com.webos.service.devmode/getDevMode", {})).status).toBe("disabled");
    });
});
