// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Which pose the Assistant's bird takes in the app (docs/ASSISTANT-CHARACTER.md),
// as the shell's view decides it (AssistantOverlay.qml outcomeOf, beatsFor):
// a request's reply is read from its new messages, and its outcome plays a
// few poses before the bird goes back to what is going on.

import type { AssistantMessage } from "@phoenix/luna";
import type { BirdPose } from "./birdData";

export type Outcome = "done" | "failed" | "asking" | "choices" | "cancelled" | "answer";

/** What a request's reply was, from its new messages (the last of the assistant's). */
export function outcomeOf(messages: readonly AssistantMessage[] | undefined): Outcome {
    const last = [...(messages ?? [])].reverse().find((m) => m.role === "assistant");
    if (!last) return "answer";
    if (last.status === "failed") return "failed";
    if (last.status === "pending" && last.confirm) return "asking";
    // A command done may offer its app ("Open Calendar"): still done.
    if (last.status === "done" && last.command) return "done";
    if (last.choices?.length && !last.chosen) return "choices";
    if (last.status === "cancelled") return "cancelled";
    return "answer";
}

export interface Beat { pose: BirdPose; ms: number }

/** The poses an outcome plays, each for a time (ms at normal speed): working
 *  on it then done's hop; a shrug; an oops. */
export function beatsFor(outcome: Outcome): Beat[] {
    switch (outcome) {
        case "done": return [{ pose: "working", ms: 450 }, { pose: "done", ms: 700 }];
        case "failed": return [{ pose: "shy", ms: 1500 }];
        case "choices": return [{ pose: "confused", ms: 1500 }];
        default: return [];
    }
}

/** The bird's pose: loading the conversation or waiting for an answer it
 *  thinks; then the beat playing; else as it greets (hello) or idles. */
export function birdPose(s: { loading: boolean; busy: boolean; beat: BirdPose | null; greeting: boolean }): BirdPose {
    if (s.loading || s.busy) return "thinking";
    if (s.beat) return s.beat;
    return s.greeting ? "hello" : "idle";
}
