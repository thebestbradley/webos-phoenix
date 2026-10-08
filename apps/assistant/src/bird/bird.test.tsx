// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant app's bird (docs/ASSISTANT-CHARACTER.md): which pose a
// request's reply plays (as the shell's view does: AssistantOverlay.qml
// outcomeOf, beatsFor; tst_assistant.qml), and the drawing a pose makes
// from the shared source (art/assistant-bird/bird.json).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@phoenix/luna";
import { Bird } from "./Bird";
import { BIRD, BIRD_POSES } from "./birdData";
import { beatsFor, birdPose, outcomeOf } from "./pose";

const msg = (o: Partial<AssistantMessage>): AssistantMessage => ({ id: "m", threadId: "t", role: "assistant", text: "", time: 0, ...o });

describe("the bird's poses", () => {
    it("are the twelve of the source, in its order", () => {
        expect(BIRD_POSES).toEqual(["asleep", "hello", "idle", "listening", "thinking", "working", "speaking", "done",
                                    "asking", "confused", "proud", "shy"]);
        const source = JSON.parse(readFileSync(resolve(__dirname, "../../../../art/assistant-bird/bird.json"), "utf8"));
        expect(Object.keys(source.poses)).toEqual(BIRD_POSES);
        expect(BIRD.parts.body.d).toBe(source.parts.body.d);
    });

    it("read a reply's outcome from its last assistant message", () => {
        expect(outcomeOf([msg({ role: "user", text: "turn on the flashlight" }), msg({ command: "flashlight", status: "done" })])).toBe("done");
        expect(outcomeOf([msg({ command: "flashlight", status: "failed" })])).toBe("failed");
        expect(outcomeOf([msg({ command: "text", status: "pending", confirm: { command: "text", args: {} } })])).toBe("asking");
        expect(outcomeOf([msg({ choices: [{ id: "web", label: "Search the web" }] })])).toBe("choices");
        // A command done that offers its app is done.
        expect(outcomeOf([msg({ command: "event", status: "done", choices: [{ id: "open", label: "Open Calendar" }] })])).toBe("done");
        expect(outcomeOf([msg({ choices: [{ id: "web", label: "Search the web" }], chosen: "web" })])).toBe("answer");
        expect(outcomeOf([msg({ status: "cancelled" })])).toBe("cancelled");
        expect(outcomeOf([msg({ text: "Paris." })])).toBe("answer");
        // A reply without a command is no "done".
        expect(outcomeOf([msg({ status: "done" })])).toBe("answer");
        expect(outcomeOf([])).toBe("answer");
        expect(outcomeOf(undefined)).toBe("answer");
    });

    it("play working then done for a command, oops for a failure, a shrug for choices", () => {
        expect(beatsFor("done").map((b) => b.pose)).toEqual(["working", "done"]);
        expect(beatsFor("failed").map((b) => b.pose)).toEqual(["shy"]);
        expect(beatsFor("choices").map((b) => b.pose)).toEqual(["confused"]);
        expect(beatsFor("answer")).toEqual([]);
        expect(beatsFor("asking")).toEqual([]);
    });

    it("think while loading or waiting, then the beat, then hello or idle", () => {
        expect(birdPose({ loading: true, busy: false, beat: null, greeting: false })).toBe("thinking");
        expect(birdPose({ loading: false, busy: true, beat: "done", greeting: true })).toBe("thinking");
        expect(birdPose({ loading: false, busy: false, beat: "done", greeting: true })).toBe("done");
        expect(birdPose({ loading: false, busy: false, beat: null, greeting: true })).toBe("hello");
        expect(birdPose({ loading: false, busy: false, beat: null, greeting: false })).toBe("idle");
    });
});

describe("the drawing", () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it("shows each pose's lids and extras, and only those", () => {
        for (const pose of BIRD_POSES) {
            const { getByTestId, unmount } = render(<Bird pose={pose} still speed={1} />);
            const svg = getByTestId("as-bird");
            expect(svg.getAttribute("data-pose")).toBe(pose);
            const p = BIRD.poses[pose];
            for (const g of svg.querySelectorAll<SVGGElement>("[data-extra]"))
                expect(g.style.opacity, `${pose} ${g.dataset.extra}`).toBe((p.extras as readonly string[]).includes(g.dataset.extra!) ? "1" : "0");
            for (const g of svg.querySelectorAll<SVGGElement>("[data-overlay]"))
                expect(g.style.opacity, `${pose} ${g.dataset.overlay}`).toBe((BIRD.eyes[p.eyes].overlays as readonly string[]).includes(g.dataset.overlay!) ? "1" : "0");
            unmount();
        }
    });

    it("moves only when it may: no animation classes held still", () => {
        const moving = render(<Bird pose="speaking" still={false} speed={1} />);
        expect(moving.container.querySelector(".ab-flicker-crest")).not.toBeNull();
        expect(moving.container.querySelector(".ab-talk-jaw")).not.toBeNull();
        expect(moving.container.querySelector(".ab-breath")).not.toBeNull();
        moving.unmount();
        const still = render(<Bird pose="speaking" still speed={1} />);
        expect(still.container.querySelector(".ab-bird.ab-still")).not.toBeNull();
        expect(still.container.querySelector("[class*='ab-flicker'], .ab-talk-jaw, .ab-breath")).toBeNull();
        still.unmount();
    });

    it("acts every pose: each part its loop names plays it, the others not", () => {
        const acting = BIRD.motion.acting.poses as Record<string, { period: number; every?: readonly number[]; tracks: Record<string, unknown> }>;
        expect(Object.keys(acting).length).toBeGreaterThanOrEqual(10);
        for (const pose of BIRD_POSES) {
            const a = acting[pose];
            const { container, unmount } = render(<Bird pose={pose} still={false} speed={1} />);
            for (const g of container.querySelectorAll<SVGGElement>("[data-act]")) {
                const ch = g.dataset.act!;
                const loops = !!a && ch in a.tracks && !a.every;
                expect(g.firstElementChild!.getAttribute("class"), `${pose} ${ch}`).toBe(loops ? `ab-act-${pose}-${ch}` : null);
            }
            unmount();
        }
        // Every loop has its keyframes and class in the generated CSS.
        const css = readFileSync(resolve(__dirname, "bird.generated.css"), "utf8");
        for (const [pose, a] of Object.entries(acting))
            for (const ch of Object.keys(a.tracks)) {
                expect(css).toContain(`@keyframes ab-act-${pose}-${ch} {`);
                expect(css).toMatch(new RegExp(`\\.ab-act-${pose}-${ch} \\{ animation: ab-act-${pose}-${ch} calc\\(${a.period}ms \\* var\\(--ab-speed, 1\\)\\) [^;]* ${a.every ? "1" : "infinite"};`));
            }
    });

    it("looks around now and then when idle, after a random gap", () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const idle = BIRD.motion.acting.poses.idle;
        const gap = idle.every[0] + 0.5 * (idle.every[1] - idle.every[0]);
        const { container, unmount } = render(<Bird pose="idle" still={false} speed={1} />);
        const body = () => container.querySelector("[data-act='body'] > g")!.getAttribute("class");
        expect(body()).toBeNull();
        act(() => { vi.advanceTimersByTime(gap - 10); });
        expect(body()).toBeNull();
        act(() => { vi.advanceTimersByTime(20); });
        expect(body()).toBe("ab-act-idle-body");
        act(() => { vi.advanceTimersByTime(idle.period + 1); });
        expect(body()).toBeNull();
        unmount();
    });

    it("blends a pose change from wherever the loop is", () => {
        const drawn = "matrix(0.95, -0.3, 0.3, 0.95, 12, 4)";
        vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ transform: drawn }) as CSSStyleDeclaration);
        const { container, rerender } = render(<Bird pose="hello" still={false} speed={0.6} />);
        const outer = () => container.querySelector<SVGGElement>("[data-act='wingR']")!;
        rerender(<Bird pose="idle" still={false} speed={0.6} />);
        // It started from the part as drawn, and eases back to none.
        expect(outer().style.transition).toBe(`transform ${Math.round(BIRD.motion.acting.lead * 0.6)}ms cubic-bezier(0.33, 1, 0.68, 1)`);
        expect(outer().style.transform).toBe("");
        // Held still: no acting, no blend.
        const still = render(<Bird pose="hello" still speed={1} />);
        expect(still.container.querySelector("[class*='ab-act-']")).toBeNull();
        still.rerender(<Bird pose="idle" still speed={1} />);
        expect(still.container.querySelector<SVGGElement>("[data-act='wingR']")!.style.transition).toBe("");
    });

    it("follows the animation speed", () => {
        const { getByTestId } = render(<Bird pose="idle" speed={0.6} />);
        expect(getByTestId("as-bird").style.getPropertyValue("--ab-speed")).toBe("0.6");
    });
});
