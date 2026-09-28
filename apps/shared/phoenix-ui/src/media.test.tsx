// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatDuration, GroupedToolButtons, Slider, ToolButton, Toolbar } from "./index";

describe("media components", () => {
    it("tool buttons fire and show their pressed state", () => {
        const onClick = vi.fn();
        render(<Toolbar><ToolButton icon="play" label="Play" depressed onClick={onClick} testId="tb" /></Toolbar>);
        const b = screen.getByTestId("tb");
        expect(b.getAttribute("aria-pressed")).toBe("true");
        expect(b.className).toContain("depressed");
        fireEvent.click(b);
        expect(onClick).toHaveBeenCalledOnce();
        expect(screen.getByRole("toolbar")).toBeTruthy();
    });

    it("grouped buttons hold one down and report changes", () => {
        const onChange = vi.fn();
        render(<GroupedToolButtons value="b" onChange={onChange} options={[
            { value: "a", caption: "A", testId: "a" }, { value: "b", caption: "B", testId: "b" }, { value: "c", caption: "C", testId: "c" },
        ]} />);
        expect(screen.getByTestId("a").className).toContain("first");
        expect(screen.getByTestId("b").className).toContain("middle depressed");
        expect(screen.getByTestId("c").className).toContain("last");
        fireEvent.click(screen.getByTestId("b"));
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("c"));
        expect(onChange).toHaveBeenCalledWith("c");
    });

    it("the progress slider fills up to the knob", () => {
        render(<Slider progress value={25} max={100} testId="s" />);
        const fill = screen.getByTestId("s").querySelector(".pui-slider-fill") as HTMLElement;
        expect(fill.style.width).toBe("calc(25% + 12px)");
    });

    it("formats durations", () => {
        expect(formatDuration(0)).toBe("0:00");
        expect(formatDuration(83.7)).toBe("1:23");
        expect(formatDuration(3725)).toBe("1:02:05");
        expect(formatDuration(NaN)).toBe("0:00");
    });
});
