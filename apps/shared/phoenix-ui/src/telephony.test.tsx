// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialpad, RadioToolGroup } from "./index";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("Dialpad", () => {
    it("has the twelve keys with their letters", () => {
        render(<Dialpad onKey={() => {}} />);
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("data-key")).join(""))
            .toBe("123456789*0#");
        expect(screen.getByRole("button", { name: "7" }).textContent).toBe("7PQRS");
        expect(screen.getByAltText("voicemail")).toBeTruthy();
    });

    it("reports taps", () => {
        const onKey = vi.fn();
        render(<Dialpad onKey={onKey} />);
        const five = screen.getByRole("button", { name: "5" });
        fireEvent.pointerDown(five);
        expect(five.className).toContain("down");
        fireEvent.pointerUp(five);
        expect(onKey).toHaveBeenCalledWith("5");
    });

    it("holding 0 gives + and holding 1 calls voicemail, without a tap", () => {
        vi.useFakeTimers();
        const onKey = vi.fn(), onHold = vi.fn();
        render(<Dialpad onKey={onKey} onHold={onHold} />);
        for (const k of ["0", "1"]) {
            const b = screen.getByRole("button", { name: k });
            fireEvent.pointerDown(b);
            act(() => { vi.advanceTimersByTime(600); });
            fireEvent.pointerUp(b);
        }
        expect(onHold.mock.calls).toEqual([["+"], ["voicemail"]]);
        expect(onKey).not.toHaveBeenCalled();
    });
});

describe("RadioToolGroup", () => {
    it("marks the selected button and reports changes", () => {
        const onChange = vi.fn();
        render(<RadioToolGroup value="b" onChange={onChange}
            options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C", badge: 2 }]} />);
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((t) => t.className.split(" ")[1])).toEqual(["first", "middle", "last"]);
        expect(tabs[1].getAttribute("aria-selected")).toBe("true");
        expect(tabs[1].className).toContain("depressed");
        expect(tabs[2].textContent).toBe("C2");
        fireEvent.click(tabs[0]);
        expect(onChange).toHaveBeenCalledWith("a");
    });
});
