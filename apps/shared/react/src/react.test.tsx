// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeTo } from "@phoenix/sdk";
import { installFakeBus, type FakeBus } from "@phoenix/sdk/testing";
import { AppMenu, useAssistantCommand, useBack, useJustTypeAction, useLaunchParams, useShareReceiver, useWatch } from "./index";

type G = { PalmSystem?: { launchParams: string; appIdentifier: string } };
const g = globalThis as G;
let bus: FakeBus;

function relaunch(params: object) {
    g.PalmSystem!.launchParams = JSON.stringify(params);
    act(() => { document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: params })); });
}

function escape(): boolean {
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => { window.dispatchEvent(e); });
    return e.defaultPrevented;
}

beforeEach(() => {
    bus = installFakeBus();
    g.PalmSystem = { launchParams: JSON.stringify({ page: "a" }), appIdentifier: "com.example.react" };
});

afterEach(() => {
    bus.uninstall();
    delete g.PalmSystem;
});

describe("@phoenix/react", () => {
    it("useLaunchParams follows relaunches", () => {
        function P() { return <span data-testid="p">{useLaunchParams<{ page?: string }>().page}</span>; }
        render(<P />);
        expect(screen.getByTestId("p").textContent).toBe("a");
        relaunch({ page: "b" });
        expect(screen.getByTestId("p").textContent).toBe("b");
    });

    it("useBack takes the gesture while active, the innermost first", () => {
        const outer = vi.fn(() => true);
        const inner = vi.fn(() => true);
        function Pane({ open }: { open: boolean }) { useBack(inner, open); return null; }
        function Root({ open }: { open: boolean }) { useBack(outer); return <Pane open={open} />; }
        const { rerender, unmount } = render(<Root open />);
        expect(escape()).toBe(true);
        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
        rerender(<Root open={false} />);
        escape();
        expect(outer).toHaveBeenCalledTimes(1);
        unmount();
        expect(escape()).toBe(false);
    });

    it("AppMenu draws the menu with the latest items", () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender, unmount } = render(<AppMenu share={false} items={[{ label: "One", onSelect: first }]} />);
        rerender(<AppMenu share={false} items={[{ label: "Two", onSelect: second }]} />);
        act(() => { document.dispatchEvent(new CustomEvent("phoenixAppMenu")); });
        const items = [...document.querySelectorAll(".phx-appmenu-item")].map((e) => e.textContent);
        expect(items).toEqual(["Edit", "Two"]);
        act(() => { ([...document.querySelectorAll(".phx-appmenu-item")][1] as HTMLElement).click(); });
        expect(second).toHaveBeenCalled();
        unmount();
        act(() => { document.dispatchEvent(new CustomEvent("phoenixAppMenu")); });
        expect(document.querySelector(".phx-appmenu")).toBeNull();
    });

    it("hands over shares, Just Type actions and Assistant commands", () => {
        const got: string[] = [];
        function R() {
            useShareReceiver((s) => got.push("share:" + s.text));
            useJustTypeAction("newNote", (t) => got.push("type:" + t));
            useAssistantCommand("dictate", (t) => got.push("say:" + t));
            return null;
        }
        render(<R />);
        relaunch({ share: { text: "hello" } });
        relaunch({ newNote: "milk" });
        relaunch({ dictate: "call mum" });
        expect(got).toEqual(["share:hello", "type:milk", "say:call mum"]);
    });

    it("useWatch keeps a subscription's latest value and cancels it on unmount", async () => {
        bus.handle("luna://s/w", () => ({ n: 1 }));
        function W() {
            const { value } = useWatch<{ n: number }>((v, e) => subscribeTo<{ n: number }>("luna://s/w", {}, v, e), []);
            return <span data-testid="w">{value?.n ?? "-"}</span>;
        }
        const { unmount } = render(<W />);
        expect(await screen.findByText("1")).toBeTruthy();
        act(() => bus.emit("luna://s/w", { n: 2 }));
        expect(screen.getByTestId("w").textContent).toBe("2");
        unmount();
        expect(bus.calls[0].subscribed).toBe(false);
    });
});
