// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The bird reacting to the user in the app (reactions.ts), as the shell's
// view does (tst_assistant.qml test_birdReactsToTheUser).

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BIRD } from "./birdData";
import { pickTap, reactionFor, useBirdReactions } from "./reactions";

describe("the bird's reactions", () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it("peck as a character comes, wince as one goes", () => {
        expect(reactionFor(0, 1)).toBe("peck");
        expect(reactionFor(5, 4)).toBe("wince");
        expect(reactionFor(3, 3)).toBeNull();
    });

    it("wave at the first tap, then never the same twice running", () => {
        expect(pickTap(0, "", 0.9)).toBe("wave");
        for (const r of [0, 0.3, 0.6, 0.99]) {
            const pick = pickTap(1, "wave", r);
            expect(BIRD.motion.reactions.tap as readonly string[]).toContain(pick);
            expect(pickTap(2, "giggle", r)).not.toBe("giggle");
        }
    });

    it("plays each as it happens: typing, deleting, a pause, a scroll, a request sent", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useBirdReactions({ speed: 1 }));
        act(() => result.current.typed("h", 1));
        expect(result.current.react).toEqual({ name: "peck", n: 1 });
        expect(result.current.fidgety).toBe(false);
        expect(result.current.gaze[1]).toBe(1);
        act(() => result.current.typed("he", 2));
        expect(result.current.react).toEqual({ name: "peck", n: 2 });
        act(() => result.current.typed("h", 1));
        expect(result.current.react).toEqual({ name: "wince", n: 3 });
        act(() => { vi.advanceTimersByTime(BIRD.motion.reactions.pauseAfter + 1); });
        expect(result.current.react).toEqual({ name: "ponder", n: 4 });
        // Sent: the field cleared is no deletion, and no pause follows.
        act(() => { result.current.sent(); result.current.typed(""); });
        expect(result.current.react!.n).toBe(4);
        expect(result.current.fidgety).toBe(true);
        expect(result.current.gaze).toEqual([0, 0]);
        act(() => { vi.advanceTimersByTime(BIRD.motion.reactions.pauseAfter * 2); });
        expect(result.current.react!.n).toBe(4);
        // A scroll down: a glance up the way the words go, then ahead again.
        act(() => result.current.scrolled({ currentTarget: { scrollTop: 40 } } as never));
        expect(result.current.gaze).toEqual([0, -1]);
        act(() => { vi.advanceTimersByTime(400); });
        expect(result.current.gaze).toEqual([0, 0]);
        // Taps: the wave (the caller's), then a reaction it plays.
        let pick = "";
        act(() => { pick = result.current.tap(); });
        expect(pick).toBe("wave");
        act(() => { pick = result.current.tap(); });
        expect(result.current.react!.name).toBe(pick);
    });
});
