// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Screen & Lock > Notifications > Phoenix announcements against the
// simulated system service: on by default, kept as the system preference
// phoenixAnnouncements that com.palm.update's notices read (docs/NOTICES.md).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { call, LunaError, settings } from "@phoenix/luna";
import { ScreenPage } from "./Screen";

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
});

const announcements = async () =>
    ((await call("luna://com.webos.service.systemservice/getPreferences", { keys: ["phoenixAnnouncements"] })) as { phoenixAnnouncements?: boolean })
        .phoenixAnnouncements;

describe("Phoenix announcements", () => {
    it("on by default; the switch turns them off and on", async () => {
        render(<ScreenPage />);
        const toggle = await screen.findByTestId("announcements-toggle");
        expect(await announcements()).toBe(true);
        await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
        fireEvent.click(toggle);
        await waitFor(() => expect(screen.getByTestId("announcements-toggle").getAttribute("aria-checked")).toBe("false"));
        expect(await announcements()).toBe(false);
        fireEvent.click(screen.getByTestId("announcements-toggle"));
        await waitFor(async () => expect(await announcements()).toBe(true));
    });
});

describe("Brightness", () => {
    afterEach(() => vi.restoreAllMocks());

    it("moves and sets picture.backlight before the service has a value (a device's first boot)", async () => {
        // OSE's settingsservice has no default for it: the get answers errorKey ["backlight"], no settings.
        vi.spyOn(settings, "watch").mockImplementation((_c, _k, _cb, onError) => {
            onError?.(new LunaError("luna://com.webos.settingsservice/getSystemSettings", { returnValue: false, errorKey: ["backlight"] }));
            return { cancel: () => {}, cancelled: false };
        });
        const set = vi.spyOn(settings, "set").mockResolvedValue({} as Awaited<ReturnType<typeof settings.set>>);
        render(<ScreenPage />);
        const slider = await screen.findByTestId("brightness");
        expect(slider.getAttribute("aria-disabled")).toBeNull();
        fireEvent.keyDown(slider, { key: "ArrowLeft" });
        await waitFor(() => expect(set).toHaveBeenLastCalledWith("picture", { backlight: 65 }));
        // shown as set, though no answer comes
        await waitFor(() => expect(screen.getByTestId("brightness").getAttribute("aria-valuenow")).toBe("65"));
    });
});
