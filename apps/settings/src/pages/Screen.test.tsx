// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Screen & Lock > Notifications > Phoenix announcements against the
// simulated system service: on by default, kept as the system preference
// phoenixAnnouncements that com.palm.update's notices read (docs/NOTICES.md).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call } from "@phoenix/luna";
import { ScreenPage } from "./Screen";

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
});

const announcements = async () =>
    (await call<{ phoenixAnnouncements?: boolean }>("luna://com.webos.service.systemservice/getPreferences", { keys: ["phoenixAnnouncements"] }))
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
