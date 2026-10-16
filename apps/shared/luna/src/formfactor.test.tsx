// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// useFormFactor: the shell's layout as apps read it (Files' and the file
// picker's columns are offered on a tablet or a desktop): the card's size
// by the shell's rule until the shell says, then getSystemStatus
// formFactor, followed as the adaptive simulator switches it.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useFormFactor } from "./react";

type Runtime = { applyHostStatus(st: object, opts?: object): void };
const runtime = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    localStorage.clear();
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
});
afterEach(cleanup);

function resize(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    act(() => { window.dispatchEvent(new Event("resize")); });
}

function Probe() {
    return <span data-testid="ff">{useFormFactor()}</span>;
}

describe("useFormFactor", () => {
    it("is the card's size by the shell's rule until the shell says, then the shell's layout, live", async () => {
        resize(1024, 740);
        render(<Probe />);
        expect(screen.getByTestId("ff").textContent).toBe("tablet");
        // The shorter side under 600: a phone's (a phone on its side too).
        resize(852, 393);
        expect(screen.getByTestId("ff").textContent).toBe("phone");
        // The shell's word wins over the card's size.
        act(() => { runtime().applyHostStatus({ formFactor: "tablet" }); });
        await waitFor(() => expect(screen.getByTestId("ff").textContent).toBe("tablet"));
        act(() => { runtime().applyHostStatus({ formFactor: "phone" }); });
        await waitFor(() => expect(screen.getByTestId("ff").textContent).toBe("phone"));
        act(() => { runtime().applyHostStatus({ formFactor: "desktop" }); });
        await waitFor(() => expect(screen.getByTestId("ff").textContent).toBe("desktop"));
        resize(1024, 768);
    });
});
