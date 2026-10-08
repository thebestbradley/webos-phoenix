// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant app as a text-messaging chat (docs/AI-AND-MCP.md,
// "Follow-up questions"): the assistant's words come with a small bird as
// its avatar, the way Messaging shows a contact's picture beside their
// balloons; the bird in the header plays what the conversation is doing
// (thinking, done, asking while a follow-up question waits); a follow-up's
// answers are chips under it, replied to with a tap or in words, like a
// text. A question sent later (a notification) arrives in the conversation
// the thing was made in, and Conversations counts it unread there until it
// is opened.
//
// The bird is apps/assistant/src/bird's Bird, through its props only
// (pose, size, still), as the shell's view uses AssistantBird.

import type { AssistantMessage } from "@phoenix/luna";
import { cx } from "@phoenix/ui";
import { Bird } from "./bird/Bird";
import type { BirdPose } from "./bird/birdData";

/** The follow-up question the conversation waits on (its last word from the assistant), or null. */
export function waitingFollowUp(messages: readonly AssistantMessage[]): AssistantMessage | null {
    for (let i = messages.length - 1; i >= 0; --i) {
        const m = messages[i];
        if (m.role !== "assistant") continue;
        return m.followUp && !m.chosen ? m : null;
    }
    return null;
}

/** A reply's messages without its follow-up question, for the bird's beats
 *  (done, then it asks; not a shrug at the question's chips). */
export function withoutFollowUps(messages: readonly AssistantMessage[] | undefined): AssistantMessage[] {
    return (messages ?? []).filter((m) => !m.followUp || m.status === "failed");
}

/** The pose the conversation's bird holds when no beat plays: asking while a question waits. */
export function restingPose(pose: BirdPose, asking: boolean): BirdPose {
    return pose === "idle" && asking ? "asking" : pose;
}

/** The assistant's avatar beside its words: only the newest one moves. */
export function Avatar({ pose, live, speed, still }: { pose: BirdPose; live: boolean; speed: number; still: boolean }) {
    return (
        <div className={cx("as-avatar", live && "live")} aria-hidden="true">
            <Bird pose={live ? pose : "idle"} size={30} testId={live ? "as-avatar-live" : "as-avatar"} speed={speed} still={!live || still} />
        </div>
    );
}

/** A follow-up's answers as quick replies. */
export function QuickReplies({ m, busy, onChoose }: { m: AssistantMessage; busy: boolean; onChoose: (m: AssistantMessage, id: string) => void }) {
    return (
        <div className="as-replies" data-testid={`as-replies-${m.id}`}>
            {(m.choices ?? []).map((c) => (
                <button key={c.id} type="button" className={cx("as-chip", "as-reply", c.id === "fu:skip" && "skip")} disabled={busy}
                        data-testid={`as-choice-${c.id}`} onClick={() => onChoose(m, c.id)}>{c.label}</button>
            ))}
        </div>
    );
}

/** Conversations: how many follow-ups wait unread. */
export function Unread({ n }: { n?: number }) {
    return n ? <span className="as-unread" data-testid="as-unread" aria-label={`${n} unread`}>{n}</span> : null;
}
