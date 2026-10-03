// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    // The system clipboard refused (a web view without permission): the
    // fallback selects a hidden field, and must give the keyboard focus back
    // to the terminal, or the keys typed next go nowhere.
    it("keeps the keyboard focus where it was when it falls back", async () => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: () => Promise.reject(new Error("not allowed")), readText: () => Promise.reject(new Error("no")) },
        });
        const term = document.createElement("textarea");
        document.body.appendChild(term);
        term.focus();
        expect(document.activeElement).toBe(term);
        await copyText("see");
        expect(document.activeElement).toBe(term);
        expect(document.querySelectorAll("textarea").length).toBe(1);
        expect(localStorage.getItem("org.webosphoenix.terminal.clipboard")).toBe("see");
    });
});
