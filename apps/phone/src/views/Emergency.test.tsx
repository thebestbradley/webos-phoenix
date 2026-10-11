// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phone's emergency window opened by the Assistant's "call 911" ({emergency,
// number, countdown}: Shell openEmergency), against the simulated
// telephony: counted down with Cancel, then the call; Cancel closes the
// window and calls no one; a number that is not an emergency one is never
// counted down to.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "@phoenix/luna";
import { EmergencyPhone } from "./Emergency";

type PS = { launchParams?: string; getResource(p: string): string | undefined };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    ps().getResource = () => undefined;
});
afterEach(async () => {
    ps().launchParams = "{}";
    vi.restoreAllMocks();
    const st = (await call("luna://com.palm.telephony/callStatusQuery", {})) as unknown as { calls?: { id: number }[] };
    for (const c of st.calls ?? []) await call("luna://com.palm.telephony/hangup", { id: c.id }).catch(() => undefined);
});

describe("the Assistant's emergency call", () => {
    it("counts down, then calls the emergency number", async () => {
        ps().launchParams = JSON.stringify({ emergency: true, number: "911", countdown: 2 });
        render(<EmergencyPhone />);
        expect(screen.getByTestId("emergency-countdown").textContent).toContain("Calling 911 in");
        expect(screen.getByTestId("emergency-countdown-number").textContent).toBe("2");
        await waitFor(() => expect(screen.queryByTestId("emergency-countdown")).toBeNull(), { timeout: 4000 });
        await waitFor(async () => {
            const st = (await call("luna://com.palm.telephony/callStatusQuery", {})) as unknown as { calls?: { number?: string; address?: string }[] };
            expect(JSON.stringify(st.calls ?? [])).toContain("911");
        }, { timeout: 3000 });
    });
    it("Cancel closes the window, calling no one", async () => {
        const close = vi.spyOn(window, "close").mockImplementation(() => {});
        ps().launchParams = JSON.stringify({ emergency: true, number: "911", countdown: 5 });
        render(<EmergencyPhone />);
        fireEvent.click(screen.getByTestId("emergency-countdown-cancel"));
        expect(close).toHaveBeenCalled();
        expect(screen.queryByTestId("emergency-countdown")).toBeNull();
    });
    it("never counts down to a number that is not an emergency one", () => {
        ps().launchParams = JSON.stringify({ emergency: true, number: "4085550100", countdown: 5 });
        render(<EmergencyPhone />);
        expect(screen.queryByTestId("emergency-countdown")).toBeNull();
        expect(screen.getByTestId("emergency")).toBeTruthy();
    });
});
