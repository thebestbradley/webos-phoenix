// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings' list of panes and a pane are scenes with their own scroll
// position: a pane opens at its top, whatever the list's, and the back
// gesture brings the list back where it was.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./pages/DeviceInfo", () => ({ DeviceInfoPage: () => null }));

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) =>
        p === "/usr/share/phoenix/apps.json" ? "[]" : undefined;
});

describe("Settings' scenes", () => {
    it("opens a pane at its top and brings the list back where it was", async () => {
        let y = 0;
        Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
        const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(((_x: number, top: number) => { y = top; }) as typeof window.scrollTo);
        render(<App />);
        await waitFor(() => expect(screen.getByTestId("hub-screen")).toBeTruthy());
        y = 640;            // the list scrolled down to Screen & Lock
        fireEvent.click(screen.getByTestId("hub-screen"));
        await waitFor(() => expect(screen.queryByTestId("hub-screen")).toBeNull());
        expect(y).toBe(0);
        fireEvent.keyDown(window, { key: "Escape" });
        await waitFor(() => expect(screen.getByTestId("hub-screen")).toBeTruthy());
        expect(y).toBe(640);
        scrollTo.mockRestore();
    });
});
