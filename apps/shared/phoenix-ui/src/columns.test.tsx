// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The column view (columnmodel.ts, columns.tsx): the folders a path shows
// as columns, where the keyboard is and what each key does (as the
// Finder's columns), what a tap and a hold do (select mode included), and
// the view itself: its marks, the keys it takes from the window (not from
// a field or a dialog over it), the newest column kept in sight, and the
// List / Columns switch.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnCursor, columnHold, columnKey, columnTap, folderChain, keyIsForColumns, shownView, type ColumnState } from "./columnmodel";
import { ColumnRow, ColumnView, useColumnsWidth, ViewSwitch } from "./columns";

const F = (key: string) => ({ key, folder: true });
const D = (key: string) => ({ key, folder: false });

// /m: a (folder: a/x folder, a/y.txt), b (folder), c.txt, d.txt
const M = [F("/m/a"), F("/m/b"), D("/m/c.txt"), D("/m/d.txt")];
const A = [F("/m/a/x"), D("/m/a/y.txt")];
const at = (path: string, peek: string | null = null, selecting = false): ColumnState => {
    const folders = folderChain("/m", path);
    const lists: Record<string, typeof M> = { "/m": M, "/m/a": A, "/m/a/x": [], "/m/b": [] };
    return { folders, items: folders.map((f) => lists[f] ?? []), peek, selecting };
};

describe("folderChain", () => {
    it("gives one column a folder from the root down to the path", () => {
        expect(folderChain("/media/internal", "/media/internal/Documents/Work"))
            .toEqual(["/media/internal", "/media/internal/Documents", "/media/internal/Documents/Work"]);
        expect(folderChain("/media/internal", "/media/internal")).toEqual(["/media/internal"]);
        expect(folderChain("/", "/")).toEqual(["/"]);
        expect(folderChain("/", "/etc/palm")).toEqual(["/", "/etc", "/etc/palm"]);
        // Outside the root, or a name that only starts like it: the folder alone.
        expect(folderChain("/media/internal", "/etc")).toEqual(["/etc"]);
        expect(folderChain("/media/internal", "/media/internal2/x")).toEqual(["/media/internal2/x"]);
    });
});

describe("shownView", () => {
    it("is columns where they are offered unless the list was chosen, the list elsewhere", () => {
        expect(shownView(undefined, true)).toBe("columns");
        expect(shownView("columns", true)).toBe("columns");
        expect(shownView("list", true)).toBe("list");
        expect(shownView(undefined, false)).toBe("list");
        expect(shownView("columns", false)).toBe("list");
    });
});

describe("the keyboard", () => {
    it("is on the current folder in its parent's column, on a file previewed, or nowhere at the root", () => {
        expect(columnCursor(at("/m"))).toBeNull();
        expect(columnCursor(at("/m/a"))).toEqual({ column: 0, key: "/m/a" });
        expect(columnCursor(at("/m", "/m/c.txt"))).toEqual({ column: 0, key: "/m/c.txt" });
        expect(columnCursor(at("/m/a", "/m/a/y.txt"))).toEqual({ column: 1, key: "/m/a/y.txt" });
        // A file no longer there (deleted, hidden): back on the folder.
        expect(columnCursor(at("/m/a", "/m/a/gone.txt"))).toEqual({ column: 0, key: "/m/a" });
    });

    it("moves down and up a column: a folder opens beside it, a file shows its preview", () => {
        expect(columnKey(at("/m"), "ArrowDown")).toEqual({ kind: "open", key: "/m/a" });
        expect(columnKey(at("/m"), "ArrowUp")).toEqual({ kind: "peek", key: "/m/d.txt", folder: "/m" });
        expect(columnKey(at("/m/a"), "ArrowDown")).toEqual({ kind: "open", key: "/m/b" });
        expect(columnKey(at("/m/b"), "ArrowDown")).toEqual({ kind: "peek", key: "/m/c.txt", folder: "/m" });
        expect(columnKey(at("/m", "/m/c.txt"), "ArrowUp")).toEqual({ kind: "open", key: "/m/b" });
        expect(columnKey(at("/m", "/m/d.txt"), "ArrowDown")).toBeNull();
        expect(columnKey(at("/m/a"), "ArrowUp")).toBeNull();
        expect(columnKey(at("/m/b"), "Home")).toEqual({ kind: "open", key: "/m/a" });
        expect(columnKey(at("/m/a"), "End")).toEqual({ kind: "peek", key: "/m/d.txt", folder: "/m" });
    });

    it("goes into a folder with Right or Enter, back with Left or Backspace, up a folder with Backspace in the first column", () => {
        expect(columnKey(at("/m/a"), "ArrowRight")).toEqual({ kind: "open", key: "/m/a/x" });
        expect(columnKey(at("/m/a"), "Enter")).toEqual({ kind: "open", key: "/m/a/x" });
        expect(columnKey(at("/m/a/x"), "ArrowRight")).toBeNull();            // an empty folder
        expect(columnKey(at("/m/a", "/m/a/y.txt"), "ArrowRight")).toBeNull(); // a file
        expect(columnKey(at("/m/a", "/m/a/y.txt"), "ArrowLeft")).toEqual({ kind: "open", key: "/m/a" });
        expect(columnKey(at("/m/a/x"), "ArrowLeft")).toEqual({ kind: "open", key: "/m/a" });
        expect(columnKey(at("/m/a/x"), "Backspace")).toEqual({ kind: "open", key: "/m/a" });
        expect(columnKey(at("/m/a"), "ArrowLeft")).toBeNull();
        expect(columnKey(at("/m/a"), "Backspace")).toEqual({ kind: "up" });
        expect(columnKey(at("/m"), "Backspace")).toEqual({ kind: "up" });
        expect(columnKey(at("/m"), "ArrowRight")).toEqual({ kind: "open", key: "/m/a" });
    });

    it("opens a file with Enter", () => {
        expect(columnKey(at("/m/a", "/m/a/y.txt"), "Enter")).toEqual({ kind: "launch", key: "/m/a/y.txt" });
        expect(columnKey(at("/m", "/m/c.txt"), "Enter")).toEqual({ kind: "launch", key: "/m/c.txt" });
        expect(columnKey(at("/m/a"), "x")).toBeNull();
        expect(columnKey(at("/m/a"), "Escape")).toBeNull();
    });

    it("keeps to the current folder's column in select mode: the arrows move without opening, Enter and Space tick", () => {
        expect(columnKey(at("/m", null, true), "ArrowDown")).toEqual({ kind: "peek", key: "/m/a", folder: "/m" });
        expect(columnKey(at("/m", "/m/a", true), "ArrowDown")).toEqual({ kind: "peek", key: "/m/b", folder: "/m" });
        expect(columnKey(at("/m", "/m/d.txt", true), "ArrowDown")).toEqual({ kind: "peek", key: "/m/d.txt", folder: "/m" });
        expect(columnKey(at("/m", null, true), "ArrowUp")).toEqual({ kind: "peek", key: "/m/d.txt", folder: "/m" });
        expect(columnKey(at("/m", "/m/b", true), "Enter")).toEqual({ kind: "toggle", key: "/m/b" });
        expect(columnKey(at("/m", "/m/c.txt", true), " ")).toEqual({ kind: "toggle", key: "/m/c.txt" });
        expect(columnKey(at("/m", null, true), "Enter")).toBeNull();
        expect(columnKey(at("/m/a", "/m/a/x", true), "ArrowLeft")).toBeNull();
        expect(columnKey(at("/m/a", "/m/a/x", true), "Backspace")).toBeNull();
    });
});

describe("taps and holds", () => {
    it("opens a folder, marks a file and opens it on a second tap", () => {
        expect(columnTap(at("/m/a"), 0, F("/m/b"))).toEqual({ kind: "open", key: "/m/b" });
        expect(columnTap(at("/m/a"), 1, D("/m/a/y.txt"))).toEqual({ kind: "peek", key: "/m/a/y.txt", folder: "/m/a" });
        expect(columnTap(at("/m/a", "/m/a/y.txt"), 1, D("/m/a/y.txt"))).toEqual({ kind: "launch", key: "/m/a/y.txt" });
        // A file of an earlier column: its folder becomes the current one.
        expect(columnTap(at("/m/a", "/m/a/y.txt"), 0, D("/m/c.txt"))).toEqual({ kind: "peek", key: "/m/c.txt", folder: "/m" });
    });

    it("ticks rows of the current folder in select mode, and goes elsewhere from another column", () => {
        expect(columnTap(at("/m/a", null, true), 1, D("/m/a/y.txt"))).toEqual({ kind: "toggle", key: "/m/a/y.txt" });
        expect(columnTap(at("/m/a", null, true), 1, F("/m/a/x"))).toEqual({ kind: "toggle", key: "/m/a/x" });
        expect(columnTap(at("/m/a", null, true), 0, F("/m/b"))).toEqual({ kind: "open", key: "/m/b" });
    });

    it("holds a row to select it, in its own folder", () => {
        expect(columnHold(at("/m/a"), 1, D("/m/a/y.txt"))).toEqual({ kind: "select", key: "/m/a/y.txt", folder: "/m/a" });
        expect(columnHold(at("/m/a"), 0, D("/m/c.txt"))).toEqual({ kind: "select", key: "/m/c.txt", folder: "/m" });
    });
});

describe("keys for the columns", () => {
    const key = (k: string, target: EventTarget | null, mods: Partial<KeyboardEvent> = {}) =>
        ({ key: k, target, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, ...mods });
    it("are not typed in a field, held with a modifier, with a menu open, or in a dialog over the view", () => {
        document.body.innerHTML = `<div id="v"><div id="row" role="button"></div></div><input id="i"><button id="b"></button>
            <div class="pui-dialog" role="dialog"><button id="d"></button></div><div role="dialog" id="sheet"><div id="v2"></div><button id="sb"></button></div>`;
        const $ = (id: string) => document.getElementById(id);
        const view = $("v");
        expect(keyIsForColumns(key("ArrowDown", document.body), view)).toBe(true);
        expect(keyIsForColumns(key("Enter", $("row")), view)).toBe(true);
        expect(keyIsForColumns(key("ArrowDown", $("i")), view)).toBe(false);
        expect(keyIsForColumns(key("ArrowDown", document.body, { ctrlKey: true }), view)).toBe(false);
        expect(keyIsForColumns(key("ArrowDown", document.body, { defaultPrevented: true }), view)).toBe(false);
        expect(keyIsForColumns(key("ArrowDown", $("d")), view)).toBe(false);
        // A button outside the view takes its own Enter, not the arrows.
        expect(keyIsForColumns(key("Enter", $("b")), view)).toBe(false);
        expect(keyIsForColumns(key("ArrowDown", $("b")), view)).toBe(true);
        // The picker's sheet is a dialog the view is in.
        expect(keyIsForColumns(key("ArrowDown", $("sb")), $("v2"))).toBe(true);
        // A menu open (the app menu, a popup menu) has the keys.
        const menu = document.createElement("div");
        menu.className = "pui-appmenu";
        document.body.appendChild(menu);
        expect(keyIsForColumns(key("ArrowLeft", document.body), view)).toBe(false);
        menu.className = "pui-popup";
        expect(keyIsForColumns(key("Backspace", document.body), view)).toBe(false);
        menu.remove();
        expect(keyIsForColumns(key("ArrowLeft", document.body), view)).toBe(true);
        document.body.innerHTML = "";
    });
});

describe("ColumnView", () => {
    afterEach(() => vi.restoreAllMocks());

    function Tree({ onKey }: { onKey?: (k: string) => boolean }) {
        const [tapped, setTapped] = useState("");
        return (
            <>
                <ColumnView testId="cols" cursor="/m/a" onKey={onKey}
                            columns={[
                                { key: "/m", testId: "c0", content: <>
                                    <ColumnRow label="a" folder open cursor path="/m/a" testId="row-a" onTap={() => setTapped("a")} />
                                    <ColumnRow label="c.txt" path="/m/c.txt" testId="row-c" onTap={() => setTapped("c")} onHold={() => setTapped("held c")} />
                                </> },
                                { key: "/m/a", testId: "c1", content: <ColumnRow label="y.txt" path="/m/a/y.txt" selected dim onTap={() => {}} testId="row-y" /> },
                            ]}
                            preview={<div>preview</div>} />
                <span data-testid="tapped">{tapped}</span>
                <input data-testid="field" />
            </>
        );
    }

    it("shows a column a folder, the marks, and the preview after the last", () => {
        render(<Tree />);
        expect(screen.getByTestId("c0").getAttribute("data-folder")).toBe("/m");
        expect(screen.getByTestId("c1").getAttribute("data-folder")).toBe("/m/a");
        const a = screen.getByTestId("row-a");
        expect(a.className).toContain("open");
        expect(a.className).toContain("cursor");
        expect(a.getAttribute("aria-current")).toBe("location");
        expect(a.querySelector(".pui-row-chevron")).not.toBeNull();
        expect(screen.getByTestId("row-c").querySelector(".pui-row-chevron")).toBeNull();
        expect(screen.getByTestId("row-y").className).toMatch(/selected.*dim|dim.*selected/);
        expect(screen.getByTestId("cols-preview").textContent).toBe("preview");
        fireEvent.click(screen.getByTestId("row-c"));
        expect(screen.getByTestId("tapped").textContent).toBe("c");
    });

    it("holds a row (or right-clicks it) for its menu, without the tap", () => {
        vi.useFakeTimers();
        render(<Tree />);
        const c = screen.getByTestId("row-c");
        fireEvent.pointerDown(c, { button: 0, clientX: 5, clientY: 5 });
        act(() => { vi.advanceTimersByTime(600); });
        fireEvent.pointerUp(c);
        fireEvent.click(c);
        expect(screen.getByTestId("tapped").textContent).toBe("held c");
        vi.useRealTimers();
    });

    it("takes the keys from the window while it listens, not those typed in a field", () => {
        const keys: string[] = [];
        render(<Tree onKey={(k) => { keys.push(k); return k.startsWith("Arrow"); }} />);
        const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
        act(() => { document.body.dispatchEvent(down); });
        expect(keys).toEqual(["ArrowDown"]);
        expect(down.defaultPrevented).toBe(true);
        const other = new KeyboardEvent("keydown", { key: "q", bubbles: true, cancelable: true });
        act(() => { document.body.dispatchEvent(other); });
        expect(other.defaultPrevented).toBe(false);
        act(() => { fireEvent.keyDown(screen.getByTestId("field"), { key: "ArrowUp" }); });
        expect(keys).toEqual(["ArrowDown", "q"]);
    });

    it("scrolls to its newest column when the columns change", () => {
        const scrollTo = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
        const sizes = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
        const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ key: "/c" + i, content: null }));
        const { rerender } = render(<ColumnView columns={cols(2)} />);
        expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 400 }));
        scrollTo.mockClear();
        rerender(<ColumnView columns={cols(2)} />);
        expect(scrollTo).not.toHaveBeenCalled();
        sizes.mockReturnValue(1150);
        rerender(<ColumnView columns={cols(3)} />);
        expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 650 }));
        delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    });
});

describe("ViewSwitch and useColumnsWidth", () => {
    it("switches between the list and columns", () => {
        function Switch() {
            const [v, setV] = useState<"list" | "columns">("list");
            return <><ViewSwitch value={v} onChange={setV} /><span data-testid="v">{v}</span></>;
        }
        render(<Switch />);
        expect(screen.getByTestId("view-switch-list").getAttribute("aria-checked")).toBe("true");
        fireEvent.click(screen.getByTestId("view-switch-columns"));
        expect(screen.getByTestId("v").textContent).toBe("columns");
        expect(screen.getByTestId("view-switch-columns").className).toContain("depressed");
        expect(screen.getByTestId("view-switch-list").getAttribute("aria-checked")).toBe("false");
    });

    it("says whether the card is wide enough, following the window", () => {
        const width = window.innerWidth;
        const resize = (w: number) => {
            Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
            act(() => { window.dispatchEvent(new Event("resize")); });
        };
        function Fits() { return <span data-testid="fits">{String(useColumnsWidth())}</span>; }
        resize(1024);
        render(<Fits />);
        expect(screen.getByTestId("fits").textContent).toBe("true");
        resize(599);
        expect(screen.getByTestId("fits").textContent).toBe("false");
        resize(600);
        expect(screen.getByTestId("fits").textContent).toBe("true");
        resize(width);
    });
});
