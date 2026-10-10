// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { AppMenu, BackProvider, CheckBox, Dialog, Group, ListSelector, PageHeader, Row, Slider, ToggleButton, useBack } from "./index";
import { iconSrcSet } from "./layout";

afterEach(cleanup);

describe("PageHeader", () => {
    it("offers the icon's larger sizes to dense screens", () => {
        render(<PageHeader title="Wi-Fi" icon="icons/wifi.png" />);
        const img = document.querySelector(".pui-header-icon") as HTMLImageElement;
        expect(img.getAttribute("src")).toBe("icons/wifi.png");
        expect(img.getAttribute("srcset")).toBe("icons/wifi.png 64w, icons/wifi-128x128.png 128w, icons/wifi-256x256.png 256w");
        expect(img.getAttribute("sizes")).toBe("32px");
    });

    it("is only given icons drawn at those sizes, in every app", () => {
        // Each PageHeader icon in the apps is a Phoenix icon with its 128
        // and 256 px files beside it in the app's public folder.
        const root = path.resolve(__dirname, "../../..");
        const missing: string[] = [];
        let seen = 0;
        for (const app of fs.readdirSync(root)) {
            const src = path.join(root, app, "src");
            if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
            const files = fs.readdirSync(src, { recursive: true }) as string[];
            for (const f of files.filter((n) => n.endsWith(".tsx"))) {
                const text = fs.readFileSync(path.join(src, f), "utf8");
                for (const m of text.matchAll(/<PageHeader\b[^>]*?\bicon=\{?[^"}]*"([^"]+\.png)"/g)) {
                    seen++;
                    for (const n of (iconSrcSet(m[1]) ?? "").split(", ").map((c) => c.split(" ")[0]))
                        if (!fs.existsSync(path.join(root, app, "public", n))) missing.push(`${app}: ${n}`);
                }
            }
        }
        expect(seen).toBeGreaterThan(20);
        expect(missing).toEqual([]);
    });
});

describe("ToggleButton", () => {
    it("shows its state and flips on tap", () => {
        const onChange = vi.fn();
        render(<ToggleButton value={false} onChange={onChange} label="Wi-Fi" />);
        const sw = screen.getByRole("switch", { name: "Wi-Fi" });
        expect(sw.getAttribute("aria-checked")).toBe("false");
        expect(sw.textContent).toBe("Off");
        expect(sw.className).toContain("off");
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("does not also tap the row it sits in", () => {
        const row = vi.fn();
        render(<Row title="Bluetooth" onClick={row}><ToggleButton value onChange={() => {}} /></Row>);
        fireEvent.click(screen.getByRole("switch"));
        expect(row).not.toHaveBeenCalled();
    });
});

describe("Slider", () => {
    function setup(onChange = vi.fn(), onChangeComplete = vi.fn()) {
        render(<Slider value={50} onChange={onChange} onChangeComplete={onChangeComplete} label="Brightness" />);
        const slider = screen.getByRole("slider", { name: "Brightness" });
        const track = slider.querySelector(".pui-slider-track") as HTMLElement;
        track.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 7, right: 300, bottom: 7, x: 100, y: 0, toJSON() {} });
        return { slider, onChange, onChangeComplete };
    }

    it("follows the finger and reports the value on release", () => {
        const { slider, onChange, onChangeComplete } = setup();
        fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(25);
        fireEvent.pointerMove(slider, { clientX: 290, pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(95);
        expect(slider.getAttribute("aria-valuenow")).toBe("95");
        fireEvent.pointerUp(slider, { pointerId: 1 });
        expect(onChangeComplete).toHaveBeenCalledWith(95);
    });

    it("clamps to its range and supports arrow keys", () => {
        const { slider, onChange, onChangeComplete } = setup();
        fireEvent.pointerDown(slider, { clientX: 20, pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(0);
        fireEvent.pointerUp(slider, { pointerId: 1 });
        fireEvent.keyDown(slider, { key: "ArrowRight" });
        expect(onChangeComplete).toHaveBeenLastCalledWith(55);
    });
});

describe("ListSelector", () => {
    it("opens a menu and picks a value", () => {
        function Demo() {
            const [v, setV] = useState(60);
            return (
                <Group label="Screen">
                    <ListSelector title="Turn off after" value={v} onChange={setV}
                                  options={[{ label: "30 seconds", value: 30 }, { label: "1 minute", value: 60 }, { label: "3 minutes", value: 180 }]} />
                </Group>
            );
        }
        render(<Demo />);
        expect(screen.getByText("1 minute")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Turn off after/ }));
        const options = screen.getAllByRole("option");
        expect(options).toHaveLength(3);
        expect(options[1].getAttribute("aria-selected")).toBe("true");
        fireEvent.click(screen.getByRole("option", { name: "3 minutes" }));
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(screen.getByText("3 minutes")).toBeTruthy();
    });

    it("takes the back gesture (Escape) that closes its popup, so the card stays", () => {
        function Picker() {
            const [v, setV] = useState(1);
            return <ListSelector title="Turn off after" value={v} onChange={setV}
                                 options={[{ label: "1 minute", value: 1 }, { label: "3 minutes", value: 3 }]} />;
        }
        render(<BackProvider><Picker /></BackProvider>);
        fireEvent.click(screen.getByRole("button", { name: /Turn off after/ }));
        expect(screen.getByRole("listbox")).toBeTruthy();
        const back = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
        act(() => { window.dispatchEvent(back); });
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(back.defaultPrevented).toBe(true);
    });
});

describe("BackProvider", () => {
    // runtime.back: a Back no view takes is left to the system, which
    // minimizes the card (the app's top level).
    it("leaves Back alone when no view takes it, and takes it for the view that does", () => {
        function View({ open }: { open: boolean }) {
            useBack(() => true, open);
            return null;
        }
        const press = () => {
            const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
            act(() => { window.dispatchEvent(e); });
            return e.defaultPrevented;
        };
        const { rerender } = render(<BackProvider><View open={false} /></BackProvider>);
        expect(press()).toBe(false);
        rerender(<BackProvider><View open /></BackProvider>);
        expect(press()).toBe(true);
    });
});

describe("Dialog", () => {
    it("renders when open and closes on Escape", () => {
        const onClose = vi.fn();
        const { rerender } = render(<Dialog open={false} title="Hi" onClose={onClose} />);
        expect(screen.queryByRole("dialog")).toBeNull();
        rerender(<Dialog open title="Enter password" message="Lab 5G" onClose={onClose} />);
        expect(screen.getByRole("dialog").textContent).toContain("Enter password");
        act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
        expect(onClose).toHaveBeenCalled();
    });
});

describe("CheckBox", () => {
    it("shows its state and toggles without tapping its row", () => {
        const onChange = vi.fn(), row = vi.fn();
        const { rerender } = render(<Row title="notes.txt" onClick={row}><CheckBox checked={false} onChange={onChange} label="Select" /></Row>);
        const box = screen.getByRole("checkbox", { name: "Select" });
        expect(box.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(box);
        expect(onChange).toHaveBeenCalledWith(true);
        expect(row).not.toHaveBeenCalled();
        rerender(<Row title="notes.txt" onClick={row}><CheckBox checked onChange={onChange} label="Select" /></Row>);
        expect(box.className).toContain("checked");
    });
});

describe("AppMenu", () => {
    const tapAppName = () => act(() => { document.dispatchEvent(new CustomEvent("phoenixAppMenu")); });

    it("opens when the app name is tapped and runs the chosen item", () => {
        const newItem = vi.fn();
        render(<AppMenu items={[{ label: "New Folder", onSelect: newItem }, { label: "Sort", onSelect: () => {}, disabled: true }]} />);
        expect(screen.queryByRole("menu")).toBeNull();
        tapAppName();
        expect(screen.getByRole("menu")).toBeTruthy();
        fireEvent.click(screen.getByText("Sort"));
        expect(screen.getByRole("menu")).toBeTruthy();
        fireEvent.click(screen.getByText("New Folder"));
        expect(newItem).toHaveBeenCalledOnce();
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("closes on a second tap of the app name, or a tap outside", () => {
        const { container } = render(<AppMenu items={[{ label: "Help", onSelect: () => {} }]} />);
        tapAppName();
        tapAppName();
        expect(screen.queryByRole("menu")).toBeNull();
        tapAppName();
        fireEvent.click(document.querySelector(".pui-popup-scrim")!);
        expect(screen.queryByRole("menu")).toBeNull();
        expect(container).toBeTruthy();
    });
    describe("Edit", () => {
        const g = globalThis as { __phoenixRuntime?: unknown };
        afterEach(() => { delete g.__phoenixRuntime; });

        it("comes first, opens its items, and runs the runtime's edit", () => {
            const edit = vi.fn(() => true);
            g.__phoenixRuntime = {
                editState: () => ({ editable: true, canSelectAll: true, canCut: false, canCopy: false, canPaste: true }),
                edit,
            };
            render(<AppMenu items={[{ label: "Help", onSelect: () => {} }]} />);
            tapAppName();
            const items = screen.getAllByRole("menuitem");
            expect(items[0].textContent).toBe("Edit");
            expect(screen.queryByText("Paste")).toBeNull();
            fireEvent.click(items[0]);
            expect(items[0].getAttribute("aria-expanded")).toBe("true");
            expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Edit", "Select All", "Cut", "Copy", "Paste", "Share", "Help"]);
            fireEvent.click(screen.getByText("Cut"));
            expect(edit).not.toHaveBeenCalled();
            expect(screen.getByRole("menu")).toBeTruthy();
            fireEvent.click(screen.getByText("Paste"));
            expect(edit).toHaveBeenCalledWith("paste");
            expect(screen.queryByRole("menu")).toBeNull();
        });

        it("keeps the focus where Edit acts", () => {
            render(<AppMenu items={[]} />);
            tapAppName();
            const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
            screen.getByText("Edit").dispatchEvent(press);
            expect(press.defaultPrevented).toBe(true);
        });

        it("can be left out", () => {
            render(<AppMenu edit={false} items={[{ label: "Help", onSelect: () => {} }]} />);
            tapAppName();
            expect(screen.queryByText("Edit")).toBeNull();
        });
    });

    describe("Share", () => {
        const g = globalThis as { __phoenixRuntime?: unknown };
        afterEach(() => { delete g.__phoenixRuntime; });

        it("comes after Edit and shares what the app says it shows", () => {
            const share = vi.fn(() => Promise.resolve({}));
            g.__phoenixRuntime = { share };
            render(<AppMenu share={() => ({ title: "Lake", files: [{ path: "/media/internal/a.jpg", mimeType: "image/jpeg" }] })}
                            items={[{ label: "Help", onSelect: () => {} }]} />);
            tapAppName();
            expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Edit", "Share", "Help"]);
            fireEvent.click(screen.getByText("Share"));
            expect(share).toHaveBeenCalledWith({ title: "Lake", files: [{ path: "/media/internal/a.jpg", mimeType: "image/jpeg" }] });
            expect(screen.queryByRole("menu")).toBeNull();
        });

        it("shares the selected text by default, and is dimmed without any", () => {
            const share = vi.fn(() => Promise.resolve({}));
            g.__phoenixRuntime = { share };
            render(<><p>Hello there</p><AppMenu items={[]} /></>);
            tapAppName();
            expect(screen.getByText("Share").getAttribute("aria-disabled")).toBe("true");
            fireEvent.click(screen.getByText("Share"));
            expect(share).not.toHaveBeenCalled();
            tapAppName();
            const range = document.createRange();
            range.selectNodeContents(screen.getByText("Hello there"));
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            tapAppName();
            fireEvent.click(screen.getByText("Share"));
            expect(share).toHaveBeenCalledWith({ text: "Hello there" });
            getSelection()!.removeAllRanges();
        });

        it("runs the app's own Share when it has one", () => {
            const share = vi.fn(() => Promise.resolve({}));
            const onShare = vi.fn();
            g.__phoenixRuntime = { share };
            render(<AppMenu share={{ text: "hi" }} onShare={onShare} items={[]} />);
            tapAppName();
            fireEvent.click(screen.getByText("Share"));
            expect(onShare).toHaveBeenCalledOnce();
            expect(share).not.toHaveBeenCalled();
        });

        it("can be left out", () => {
            render(<AppMenu share={false} items={[{ label: "Help", onSelect: () => {} }]} />);
            tapAppName();
            expect(screen.queryByText("Share")).toBeNull();
        });
    });
});
