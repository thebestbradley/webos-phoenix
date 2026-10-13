// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The incoming-call popup alert against the simulated telephony
// (runtime/phoenix-runtime.js): it closes once the call stops ringing,
// and also when the call had stopped ringing before the alert's page was
// up (a caller who gave up while a busy device loaded it), but never before
// the service has answered.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "@phoenix/luna";
import { IncomingAlert } from "./IncomingAlert";

type Runtime = { simulateIncomingCall(o: { number?: string; ringMs?: number }): number };
const runtime = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
type Status = { calls?: { id: number; state: string }[] };
const status = async () => (await call("luna://com.palm.telephony/callStatusQuery", {})) as unknown as Status;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    (w.PalmSystem as { getResource(p: string): string | undefined }).getResource = () => undefined;
});
afterEach(async () => {
    vi.restoreAllMocks();
    for (const c of (await status()).calls ?? []) await call("luna://com.palm.telephony/hangup", { id: c.id }).catch(() => undefined);
});

describe("the incoming call's alert", () => {
    it("closes when the call stops ringing", async () => {
        const close = vi.spyOn(window, "close").mockImplementation(() => {});
        const id = runtime().simulateIncomingCall({ number: "(510) 555-0177" });
        render(<IncomingAlert />);
        await waitFor(() => expect(screen.getByTestId("incoming-alert")).toBeTruthy());
        expect(close).not.toHaveBeenCalled();
        await call("luna://com.palm.telephony/ignore", { id });
        await waitFor(() => expect(close).toHaveBeenCalled());
    });

    it("closes when the call stopped ringing before it was up (the caller gave up while it loaded), once the service says so", async () => {
        const close = vi.spyOn(window, "close").mockImplementation(() => {});
        const id = runtime().simulateIncomingCall({ number: "(510) 555-0177", ringMs: 1 });
        await waitFor(async () => expect((await status()).calls?.find((c) => c.id === id)?.state).toBe("disconnected"));
        render(<IncomingAlert />);
        expect(close).not.toHaveBeenCalled();   // callStatusQuery has not answered yet
        await waitFor(() => expect(close).toHaveBeenCalled());
        expect(screen.queryByTestId("incoming-alert")).toBeNull();
    });
});
