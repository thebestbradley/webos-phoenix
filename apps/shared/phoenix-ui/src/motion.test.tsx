// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Enyo widgets' animations (docs/spec/ANIMATIONS.md): their times as
// Enyo 1.0 set them, at the page's speed (Reduce motion, Animation speed).

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppMenu, DIALOG_SLIDE_MS, DRAWER_CLOSE_MS, DRAWER_OPEN_MS, Dialog, Drawer, motion, motionScale } from "./index";

afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-phoenix-motion");
    vi.useRealTimers();
});

const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

describe("motion", () => {
    it("follows the runtime's setting on the root element", () => {
        expect(motionScale()).toBe(1);
        document.documentElement.setAttribute("data-phoenix-motion", "fast");
        expect(motion(350)).toBe(210);
        document.documentElement.setAttribute("data-phoenix-motion", "reduce");
        expect(motion(350)).toBe(0);
        // The stylesheet's scale for the CSS animations.
        expect(css).toMatch(/:root\[data-phoenix-motion="fast"\] \{ --pui-motion: 0\.6; \}/);
        expect(css).toMatch(/:root\[data-phoenix-motion="reduce"\] \{ --pui-motion: 0; \}/);
    });
});

describe("Drawer", () => {
    it("opens over 250 ms and closes over 100, cubicOut (BasicDrawer)", () => {
        expect([DRAWER_OPEN_MS, DRAWER_CLOSE_MS]).toEqual([250, 100]);
        expect(css).toMatch(/\.pui-drawer \{[^}]*transition: height 250ms cubic-bezier\(0\.215, 0\.61, 0\.355, 1\)/);
        const { rerender } = render(<Drawer open={false}><p>Inside</p></Drawer>);
        const drawer = document.querySelector(".pui-drawer") as HTMLElement;
        rerender(<Drawer open><p>Inside</p></Drawer>);
        expect(drawer.style.transitionDuration).toBe("250ms");
        rerender(<Drawer open={false}><p>Inside</p></Drawer>);
        expect(drawer.style.transitionDuration).toBe("100ms");
        document.documentElement.setAttribute("data-phoenix-motion", "reduce");
        rerender(<Drawer open><p>Inside</p></Drawer>);
        expect(drawer.style.transitionDuration).toBe("0ms");
        expect(drawer.style.height).toBe("auto");
    });

    it("makes a lazy drawer's content only while it is open or closing", () => {
        vi.useFakeTimers();
        const { rerender } = render(<Drawer open={false} lazy><p>Inside</p></Drawer>);
        expect(screen.queryByText("Inside")).toBeNull();
        rerender(<Drawer open lazy><p>Inside</p></Drawer>);
        expect(screen.getByText("Inside")).toBeTruthy();
        rerender(<Drawer open={false} lazy><p>Inside</p></Drawer>);
        expect(screen.getByText("Inside")).toBeTruthy();
        act(() => { vi.advanceTimersByTime(DRAWER_CLOSE_MS); });
        expect(screen.queryByText("Inside")).toBeNull();
    });
});

describe("Dialog", () => {
    it("slides up over 350 ms and back down before it goes (Toaster)", () => {
        vi.useFakeTimers();
        expect(DIALOG_SLIDE_MS).toBe(350);
        expect(css).toMatch(/\.pui-dialog \{[^}]*animation: pui-toast-in 350ms cubic-bezier\(0\.215, 0\.61, 0\.355, 1\) both/);
        expect(css).toMatch(/@keyframes pui-toast-in \{ from \{ transform: translateY\(100%\); \}/);
        expect(css).toMatch(/\.pui-scrim \{[^}]*animation: pui-scrim-in calc\(500ms \* var\(--pui-motion\)\) ease/);
        const { rerender } = render(<Dialog open title="Delete?" />);
        const dialog = screen.getByRole("dialog");
        expect(dialog.style.animationDuration).toBe("350ms");
        rerender(<Dialog open={false} title="Delete?" />);
        // Gone for the page (no dialog role, the scrim lets taps through),
        // still drawn sliding down.
        expect(screen.queryByRole("dialog")).toBeNull();
        const leaving = document.querySelector(".pui-dialog.leaving") as HTMLElement;
        expect(leaving).toBeTruthy();
        expect(leaving.textContent).toBe("Delete?");
        expect(document.querySelector(".pui-scrim.leaving")).toBeTruthy();
        act(() => { vi.advanceTimersByTime(DIALOG_SLIDE_MS); });
        expect(document.querySelector(".pui-dialog")).toBeNull();
    });

    it("goes at once with Reduce motion", () => {
        document.documentElement.setAttribute("data-phoenix-motion", "reduce");
        const { rerender } = render(<Dialog open title="Delete?" />);
        rerender(<Dialog open={false} title="Delete?" />);
        expect(document.querySelector(".pui-dialog")).toBeNull();
    });
});

describe("AppMenu", () => {
    it("opens Edit's items as a drawer", () => {
        render(<AppMenu items={[]} />);
        act(() => { document.dispatchEvent(new Event("phoenixAppMenu")); });
        fireEvent.click(screen.getByText("Edit"));
        const items = screen.getByText("Select All").closest(".pui-drawer") as HTMLElement;
        expect(items).toBeTruthy();
        expect(items.style.transitionDuration).toBe(`${DRAWER_OPEN_MS}ms`);
    });
});
