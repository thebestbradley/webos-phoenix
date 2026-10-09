// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Apps > Opening a running app: the appRelaunch preference
// reaches the shell, and a relaunch asking for fresh data ("Refresh")
// starts a Phoenix app's root again (Refreshed): its subscriptions and
// loads anew, for the launch params it was relaunched with.

import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Refreshed, useLaunchParams, useLuna, useRefresh } from "./react";
import { system } from "./services";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
type Runtime = { relaunch(params: object, refresh?: boolean): boolean };
const runtime = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});
afterEach(cleanup);

const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload;

describe("appRelaunch", () => {
    it("is front by default and reaches the shell", async () => {
        const p = await new Promise<{ appRelaunch?: string }>((res) => {
            const sub = system.watchPreferences(["appRelaunch"], (v) => { sub.cancel(); res(v); });
        });
        expect(p.appRelaunch).toBe("front");
        await system.setPreferences({ appRelaunch: "new" });
        expect(lastStatus()?.appRelaunch).toBe("new");
        await system.setPreferences({ appRelaunch: "refresh" });
        expect(lastStatus()?.appRelaunch).toBe("refresh");
    });
});

describe("a relaunch", () => {
    let opened = 0;
    function Probe() {
        const v = useLuna<number>((cb) => {
            opened++;
            cb(opened);
            return { cancel() {}, cancelled: false };
        }, []);
        const params = useLaunchParams<{ page?: string }>();
        return <div data-testid="probe">{`${v.value}:${params.page ?? ""}`}</div>;
    }
    function Count() {
        return <div data-testid="count">{useRefresh()}</div>;
    }
    const app = () => render(<><Count /><Refreshed><Probe /></Refreshed></>);

    it("with params tells them, keeping the subscriptions (front)", () => {
        opened = 0;
        app();
        expect(screen.getByTestId("probe").textContent).toBe("1:");
        act(() => { runtime().relaunch({ page: "wifi" }); });
        expect(screen.getByTestId("probe").textContent).toBe("1:wifi");
        expect(screen.getByTestId("count").textContent).toBe("0");
        expect(opened).toBe(1);
    });

    it("to refresh starts the app again, for its params (Refresh)", () => {
        opened = 0;
        app();
        act(() => { runtime().relaunch({ page: "sounds" }, true); });
        expect(screen.getByTestId("count").textContent).toBe("1");
        expect(screen.getByTestId("probe").textContent).toBe("2:sounds");
        expect(opened).toBe(2);
    });
});
