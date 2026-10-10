// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Messaging's conversation menu (ThreadList.tsx: held or right-clicked)
// with Open, Open in New Card and Delete; Open in New Card launches another
// card of Messaging with {threadId}, the launch param a message's
// notification opens the conversation with; a card launched so (cold, or
// relaunched) shows that conversation. The app menu offers Open in New
// Card while a conversation is open. The services are stand-ins here; the
// real ones, in Chromium: tools/test-messaging.cjs.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "@phoenix/luna";

const THREADS: ChatThread[] = [
    { _id: "t1", displayName: "Ada Palmer", replyAddress: "(650) 555-0101", replyService: "sms", summary: "See you at noon", timestamp: 1 },
    { _id: "t2", displayName: "Lena Okafor", replyAddress: "(650) 555-0102", replyService: "sms", summary: "Call me", timestamp: 2 },
] as ChatThread[];

const luna = vi.hoisted(() => ({
    launch: vi.fn(() => Promise.resolve({})),
    deleteThread: vi.fn(() => Promise.resolve()),
}));

vi.mock("./lib/hooks", () => ({
    usePeople: () => [],
    useThreads: () => THREADS,
    useBuddies: () => [],
    useImAccounts: () => [],
    useMessages: () => [],
    useWide: () => false,
}));

vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return {
        ...real,
        apps: { ...real.apps, launch: luna.launch },
        db: { ...real.db, get: (ids: string[]) => Promise.resolve(ids.map((id) => THREADS.find((t) => t._id === id))) },
        messaging: { ...real.messaging, deleteThread: luna.deleteThread, markRead: () => Promise.resolve() },
    };
});

import { App } from "./App";

const launchWith = (p: object | null) => {
    (globalThis as { PalmSystem?: { launchParams?: string } }).PalmSystem = p ? { launchParams: JSON.stringify(p) } : {};
};
const row = (id: string) => screen.getAllByTestId("thread-row").find((r) => r.dataset.thread === id)!;
const title = async () => (await screen.findByTestId("thread-title")).textContent;

describe("Open in New Card", () => {
    beforeEach(() => { luna.launch.mockClear(); luna.deleteThread.mockClear(); launchWith(null); });
    afterEach(() => launchWith(null));

    it("opens a conversation in a new card from its menu (right-click or held)", () => {
        render(<App />);
        fireEvent.contextMenu(row("t2"));
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Open", "Open in New Card", "Delete"]);
        fireEvent.click(screen.getByTestId("thread-menu-newcard"));
        expect(luna.launch).toHaveBeenCalledWith("org.webosphoenix.messaging", { threadId: "t2" }, { newCard: true });
        // This card stays on its list.
        expect(screen.queryByTestId("thread-title")).toBeNull();
    });

    it("opens a held conversation after a long press", async () => {
        vi.useFakeTimers();
        try {
            render(<App />);
            fireEvent.pointerDown(row("t1"), { button: 0, clientX: 10, clientY: 10 });
            act(() => { vi.advanceTimersByTime(1000); });
            expect(screen.getByTestId("thread-menu-open")).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
        fireEvent.click(screen.getByTestId("thread-menu-open"));
        expect(await title()).toContain("Ada Palmer");
    });

    it("asks before Delete from the menu", () => {
        render(<App />);
        fireEvent.contextMenu(row("t1"));
        fireEvent.click(screen.getByTestId("thread-menu-delete"));
        expect(luna.deleteThread).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("thread-delete-ok"));
        expect(luna.deleteThread).toHaveBeenCalledWith("t1");
    });

    it("shows the conversation it is launched with ({threadId}), and the list on Back", async () => {
        launchWith({ threadId: "t2" });
        render(<App />);
        expect(await title()).toContain("Lena Okafor");
        // Back (the gesture, Escape in a browser) goes to the list in this card.
        act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(screen.queryByTestId("thread-title")).toBeNull();
        expect(row("t1")).toBeTruthy();
    });

    it("goes to the conversation a relaunch names", async () => {
        render(<App />);
        expect(screen.queryByTestId("thread-title")).toBeNull();
        act(() => { document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { threadId: "t1" } })); });
        expect(await title()).toContain("Ada Palmer");
    });

    it("offers Open in New Card in the app menu while a conversation is open", async () => {
        launchWith({ threadId: "t1" });
        render(<App />);
        await title();
        act(() => { document.dispatchEvent(new Event("phoenixAppMenu")); });
        fireEvent.click(screen.getByText("Open in New Card"));
        expect(luna.launch).toHaveBeenCalledWith("org.webosphoenix.messaging", { threadId: "t1" }, { newCard: true });
    });
});
