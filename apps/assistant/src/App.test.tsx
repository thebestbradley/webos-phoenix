// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant laid out as a TouchPad app (App.tsx, conversations.tsx):
// the list beside the conversation on a tablet, one at a time on a phone,
// switching as the card is resized; a conversation's or a message's menu
// (held or right-clicked) with Open in New Card, which launches another
// card of the app with {conversationId}; a card launched so shows that
// conversation and keeps to it. The service is a stand-in here; the real
// one, in Chromium: tools/test-assistant.cjs.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, AssistantThread } from "@phoenix/luna";

const T = (id: string, title: string): AssistantThread => ({ id, title, created: 1, updated: 1, provider: "", count: 2, last: "ok" });
const M = (id: string, threadId: string, role: "user" | "assistant", text: string): AssistantMessage => ({ id, threadId, role, text, time: 1 });
const THREADS = [T("t1", "Turn on the flashlight"), T("t2", "What's 2 plus 2?")];
const MESSAGES: Record<string, AssistantMessage[]> = {
    t1: [M("a", "t1", "user", "Turn on the flashlight"), M("b", "t1", "assistant", "The flashlight is on.")],
    t2: [M("c", "t2", "user", "What's 2 plus 2?"), M("d", "t2", "assistant", "4.")],
};
const state = { current: "t1" };
const sub = { cancel() {} };

const luna = vi.hoisted(() => ({
    launch: vi.fn(() => Promise.resolve({})),
    setCurrent: vi.fn((id: string) => { void id; return Promise.resolve(); }),
}));

vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return {
        ...real,
        apps: { ...real.apps, launch: luna.launch },
        dictation: { status: () => Promise.resolve({ available: false }) },
        assistant: {
            watchSettings: (cb: (s: object) => void) => { cb({ enabled: true, speak: false }); return sub; },
            watchThreads: (cb: (l: AssistantThread[], cur: string) => void) => { cb(THREADS, state.current); return sub; },
            watchThread: (id: string | undefined, cb: (t: AssistantThread | null, m: AssistantMessage[]) => void) => {
                const tid = id || state.current;
                cb(THREADS.find((t) => t.id === tid) ?? null, MESSAGES[tid] ?? []);
                return sub;
            },
            setCurrent: luna.setCurrent,
            markRead: () => Promise.resolve(),
            newThread: () => Promise.resolve(T("t3", "")),
            deleteThread: () => Promise.resolve(),
        },
    };
});

import { App } from "./App";

function resize(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    act(() => { window.dispatchEvent(new Event("resize")); });
}
const launchWith = (p: object | null) => {
    (globalThis as { PalmSystem?: { launchParams?: string } }).PalmSystem = p ? { launchParams: JSON.stringify(p) } : {};
};

describe("the Assistant as a TouchPad app", () => {
    let width = 0;
    beforeEach(() => { width = window.innerWidth; state.current = "t1"; luna.launch.mockClear(); luna.setCurrent.mockClear(); launchWith(null); });
    afterEach(() => { resize(width); launchWith(null); });

    it("shows the list beside the conversation on a tablet, and one at a time on a phone, as the card is resized", async () => {
        resize(1024);
        render(<App />);
        const panes = screen.getByTestId("as-panes");
        expect(panes.className).toMatch(/\bmulti\b/);
        expect(screen.getByTestId("as-panes-list").hidden).toBe(false);
        await screen.findByText("The flashlight is on.");
        // Titled by their first requests; this card's selected.
        expect(screen.getByTestId("as-thread-t1").getAttribute("aria-current")).toBe("true");
        expect(screen.getByTestId("as-thread-t2").textContent).toMatch(/What's 2 plus 2\?/);
        expect(screen.getByTestId("as-title").textContent).toBe("Turn on the flashlight");
        expect(screen.queryByTestId("as-conversations")).toBeNull();
        expect(screen.getByTestId("as-grab")).toBeTruthy();
        // A phone: the conversation, over the list; Conversations shows it.
        resize(393);
        expect(panes.className).toMatch(/\bsingle\b/);
        expect(panes.dataset.selected).toBe("detail");
        expect(screen.getByTestId("as-panes-list").hidden).toBe(true);
        expect(screen.queryByTestId("as-grab")).toBeNull();
        fireEvent.click(screen.getByTestId("as-conversations"));
        expect(panes.dataset.selected).toBe("list");
        // A conversation opened slides in.
        fireEvent.click(screen.getByTestId("as-thread-t2"));
        await waitFor(() => expect(panes.dataset.selected).toBe("detail"));
        expect(luna.setCurrent).toHaveBeenCalledWith("t2");
        await screen.findByText("4.");
        // Back on a tablet: both.
        resize(1180);
        expect(panes.className).toMatch(/\bmulti\b/);
        expect(panes.dataset.selected).toBe("list");
    });

    it("opens a conversation in a new card from its menu (right-click or held)", async () => {
        resize(1024);
        render(<App />);
        fireEvent.contextMenu(screen.getByTestId("as-thread-t2"));
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Open", "Open in New Card", "Delete"]);
        fireEvent.click(screen.getByTestId("as-menu-newcard"));
        expect(luna.launch).toHaveBeenCalledWith("org.webosphoenix.assistant", { conversationId: "t2" }, { newCard: true });
        // This card stays on its own.
        expect(screen.getByTestId("as-title").textContent).toBe("Turn on the flashlight");
    });

    it("opens a message's conversation in a new card, or copies the message", async () => {
        resize(1024);
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        render(<App />);
        const bubble = await screen.findByText("The flashlight is on.");
        fireEvent.contextMenu(bubble);
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Open in New Card", "Copy"]);
        fireEvent.click(screen.getByTestId("as-menu-copy"));
        expect(writeText).toHaveBeenCalledWith("The flashlight is on.");
        fireEvent.contextMenu(bubble);
        fireEvent.click(screen.getByTestId("as-menu-newcard"));
        expect(luna.launch).toHaveBeenCalledWith("org.webosphoenix.assistant", { conversationId: "t1" }, { newCard: true });
    });

    it("shows the conversation it is launched with ({conversationId}), and keeps to it", async () => {
        resize(1024);
        launchWith({ conversationId: "t2" });
        render(<App />);
        await screen.findByText("4.");
        expect(screen.getByTestId("as-thread-t2").getAttribute("aria-current")).toBe("true");
        expect(screen.queryByText("The flashlight is on.")).toBeNull();
        expect(luna.setCurrent).toHaveBeenCalledWith("t2");
    });
});
