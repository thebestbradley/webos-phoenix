// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// TouchPad-style panes (panes.tsx, after Enyo 1.0's SlidingPane): the two
// layouts and the switch between them as the window is resized, the
// detail sliding over the list and dragged back, the grip, a long press or
// right-click menu, and swipe to delete.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, GrabButton, SlidingPanes, Swipeable, useLongPress, useMultiView, type PaneView } from "./panes";

function resize(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    act(() => { window.dispatchEvent(new Event("resize")); });
}

function Panes({ initial = "list" as PaneView }) {
    const multi = useMultiView();
    const [view, setView] = useState<PaneView>(initial);
    return (
        <SlidingPanes testId="p" multiView={multi} selected={view} onSelect={setView}
                      list={<button type="button" onClick={() => setView("detail")}>open</button>}
                      detail={<div><GrabButton testId="grab" /><span>chat</span></div>} />
    );
}

// Pointer events with coordinates (jsdom has no PointerEvent).
function pointer(type: string, target: EventTarget, x: number) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0 });
    act(() => { target.dispatchEvent(e); });
}

describe("SlidingPanes", () => {
    let width = 0;
    beforeEach(() => { width = window.innerWidth; });
    afterEach(() => { resize(width); vi.useRealTimers(); });

    it("shows the list and the detail side by side wider than 500 px, one at a time narrower, switching live", () => {
        resize(1024);
        render(<Panes />);
        const root = screen.getByTestId("p");
        expect(root.className).toMatch(/\bmulti\b/);
        expect(screen.getByTestId("p-list").style.width).toBe("320px");
        expect(screen.getByTestId("p-list").hidden).toBe(false);
        expect(screen.getByTestId("p-detail").hidden).toBe(false);
        expect(screen.getByTestId("p-detail").style.transform).toBe("translateX(320px)");
        expect(screen.getByTestId("p-detail").style.width).toBe("calc(100% - 320px)");
        // The card made narrow (the simulator's adaptive layout): one at a
        // time, at once (no slide), the list in sight.
        resize(393);
        expect(root.className).toMatch(/\bsingle\b/);
        expect(root.className).not.toMatch(/\bmoving\b/);
        expect(screen.getByTestId("p-list").style.width).toBe("100%");
        expect(screen.getByTestId("p-detail").style.transform).toBe("translateX(100%)");
        expect(screen.getByTestId("p-detail").hidden).toBe(true);
        resize(501);
        expect(root.className).toMatch(/\bmulti\b/);
        resize(500);
        expect(root.className).toMatch(/\bsingle\b/);
    });

    it("slides the detail in over the list, then hides the list", () => {
        vi.useFakeTimers();
        resize(393);
        render(<Panes />);
        fireEvent.click(screen.getByText("open"));
        const root = screen.getByTestId("p");
        expect(root.className).toMatch(/\bmoving\b/);
        expect(root.dataset.selected).toBe("detail");
        expect(screen.getByTestId("p-detail").style.transform).toBe("none");
        expect(screen.getByTestId("p-list").hidden).toBe(false);
        act(() => { vi.advanceTimersByTime(700); });
        expect(root.className).not.toMatch(/\bmoving\b/);
        expect(screen.getByTestId("p-list").hidden).toBe(true);
    });

    it("lets the detail be dragged by its grip over the list and back, and a tap on the grip toggles", () => {
        resize(1024);
        render(<Panes />);
        const grab = screen.getByTestId("grab");
        const root = screen.getByTestId("p");
        // Dragged left past half the list: it covers the list.
        pointer("pointerdown", grab, 400);
        pointer("pointermove", window, 300);
        expect(screen.getByTestId("p-detail").style.transform).toBe("translateX(220px)");
        expect(screen.getByTestId("p-detail").style.width).toBe("100%");
        pointer("pointermove", window, 200);
        pointer("pointerup", window, 200);
        expect(root.dataset.selected).toBe("detail");
        // Not far enough back: it stays over the list.
        pointer("pointerdown", grab, 100);
        pointer("pointermove", window, 200);
        pointer("pointerup", window, 200);
        expect(root.dataset.selected).toBe("detail");
        // Far enough: the list again.
        pointer("pointerdown", grab, 100);
        pointer("pointermove", window, 300);
        pointer("pointerup", window, 300);
        expect(root.dataset.selected).toBe("list");
        // A tap toggles; so does the keyboard.
        pointer("pointerdown", grab, 100);
        pointer("pointerup", window, 100);
        expect(root.dataset.selected).toBe("detail");
        fireEvent.click(grab, { detail: 0 });
        expect(root.dataset.selected).toBe("list");
    });

    it("lets a narrow detail be dragged back by its edge past 100 px", () => {
        resize(393);
        render(<Panes initial="detail" />);
        const nub = screen.getByTestId("p-detail").querySelector(".pui-pane-nub")!;
        pointer("pointerdown", nub, 2);
        pointer("pointermove", window, 80);
        pointer("pointerup", window, 80);
        expect(screen.getByTestId("p").dataset.selected).toBe("detail");
        pointer("pointerdown", nub, 2);
        pointer("pointermove", window, 150);
        pointer("pointerup", window, 150);
        expect(screen.getByTestId("p").dataset.selected).toBe("list");
    });
});

function Held({ onMenu, onClick }: { onMenu: (el: HTMLElement) => void; onClick: () => void }) {
    const press = useLongPress(onMenu);
    return <div data-testid="held" onClick={onClick} {...press}>hold me</div>;
}

describe("long press and right-click", () => {
    afterEach(() => vi.useRealTimers());

    it("opens the menu on a right-click, and on a press held 500 ms, whose click then does nothing", () => {
        vi.useFakeTimers();
        const onMenu = vi.fn(), onClick = vi.fn();
        render(<Held onMenu={onMenu} onClick={onClick} />);
        const el = screen.getByTestId("held");
        fireEvent.contextMenu(el);
        expect(onMenu).toHaveBeenCalledTimes(1);
        expect(onMenu.mock.calls[0][0]).toBe(el);

        fireEvent.pointerDown(el, { button: 0 });
        act(() => { vi.advanceTimersByTime(499); });
        expect(onMenu).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(1); });
        expect(onMenu).toHaveBeenCalledTimes(2);
        // The long touch's own contextmenu: no second menu.
        fireEvent.contextMenu(el);
        expect(onMenu).toHaveBeenCalledTimes(2);
        fireEvent.pointerUp(el);
        fireEvent.click(el);
        expect(onClick).not.toHaveBeenCalled();
        // A short tap is a tap.
        fireEvent.pointerDown(el, { button: 0 });
        act(() => { vi.advanceTimersByTime(200); });
        fireEvent.pointerUp(el);
        fireEvent.click(el);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onMenu).toHaveBeenCalledTimes(2);
    });

    it("shows the items beside the element held", () => {
        const anchor = document.createElement("div");
        document.body.appendChild(anchor);
        const open = vi.fn(), close = vi.fn();
        render(<ContextMenu anchor={anchor} onClose={close} items={[{ label: "Open in New Card", testId: "nc", onSelect: open }, { label: "Copy", onSelect: () => {} }]} />);
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Open in New Card", "Copy"]);
        fireEvent.click(screen.getByTestId("nc"));
        expect(open).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
        anchor.remove();
    });
});

describe("Swipeable", () => {
    it("asks after a swipe past 35% of its width, and deletes on Delete; a short swipe springs back", () => {
        const onConfirm = vi.fn();
        render(<Swipeable testId="s" onConfirm={onConfirm}><div>item</div></Swipeable>);
        const item = screen.getByTestId("s").querySelector(".pui-swipeable-item") as HTMLElement;
        Object.defineProperty(item, "clientWidth", { configurable: true, value: 300 });
        pointer("pointerdown", item, 10);
        pointer("pointermove", window, 60);
        expect(item.style.transform).toBe("translateX(50px)");
        pointer("pointerup", window, 60);
        expect(item.style.transform).toBe("");
        expect(screen.queryByTestId("s-confirm")).toBeNull();
        pointer("pointerdown", item, 10);
        pointer("pointermove", window, 150);
        pointer("pointerup", window, 150);
        expect(screen.getByTestId("s-confirm")).toBeTruthy();
        fireEvent.click(screen.getByTestId("s-delete"));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("s-confirm")).toBeNull();
    });
});
