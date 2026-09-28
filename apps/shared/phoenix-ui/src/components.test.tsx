// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Dialog, Group, ListSelector, Row, Slider, ToggleButton } from "./index";

afterEach(cleanup);

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
