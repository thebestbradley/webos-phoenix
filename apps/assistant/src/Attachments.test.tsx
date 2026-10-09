// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What an answer found, under its words (Attachments.tsx): thumbnails with
// "+N more", cards, help's examples; a tap is "show:<index>", counted across them all.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@phoenix/luna";
import { Attachments } from "./Attachments";

const m = (data: object): AssistantMessage => ({ id: "m1", threadId: "t", role: "assistant", text: "Here", time: 1, data } as AssistantMessage);

describe("Attachments", () => {
    it("shows pictures, cards and examples; a tap gives its index across them, an example goes to the field", () => {
        const onShow = vi.fn(), onSuggest = vi.fn();
        render(<Attachments onShow={onShow} onSuggest={onSuggest} m={m({ attachments: [
            { type: "images", total: 5, items: [{ path: "/media/internal/DCIM/a.jpg" }, { path: "/media/internal/DCIM/b.jpg" }] },
            { type: "cards", items: [{ title: "Dentist", subtitle: "On Friday at 2:00 PM", open: { appId: "com.palm.app.calendar" } }] },
            { type: "examples", title: "Calendar", items: [{ text: "Am I free tomorrow at 3?" }] },
        ] })} />);
        expect(screen.getAllByRole("button").length).toBe(4);
        expect(screen.getByText("+3 more")).toBeTruthy();
        fireEvent.click(screen.getByTestId("as-thumb-1"));
        fireEvent.click(screen.getByTestId("as-card-2"));
        fireEvent.click(screen.getByText("Am I free tomorrow at 3?"));
        expect(onShow.mock.calls.map((c) => c[0])).toEqual([1, 2]);
        expect(onSuggest).toHaveBeenCalledWith("Am I free tomorrow at 3?");
        expect(screen.getByText("Calendar")).toBeTruthy();
    });
    it("nothing for a message without any, or the user's", () => {
        const { container } = render(<Attachments onShow={() => {}} m={{ ...m({ attachments: [{ type: "cards", items: [{ title: "x" }] }] }), role: "user" }} />);
        expect(container.innerHTML).toBe("");
    });
});
