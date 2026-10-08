// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's bird reacting to the user in the app, as the shell's view
// does (AssistantOverlay.qml, docs/ASSISTANT-CHARACTER.md, Reactions): it
// watches the words typed (its eyes on the caret) and pecks as each comes,
// winces at a deletion, ponders a pause after typing, glances along a
// scroll; a tap waves (the first) or giggles or spins (motion.reactions).

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { BIRD } from "./birdData";
import type { MoveName } from "./Bird";

const R = BIRD.motion.reactions;

/** The reaction to the field's words changing length: a peck as one comes, a wince as one goes. */
export function reactionFor(before: number, after: number): MoveName | null {
    if (after === before) return null;
    return (after > before ? R.type : R.erase) as MoveName;
}

/** A tap's: the wave first, then the wave or a tap reaction at random, never the same twice running. */
export function pickTap(taps: number, last: string, random: number): "wave" | MoveName {
    if (taps === 0) return "wave";
    const all = (["wave"] as string[]).concat(R.tap as readonly string[]).filter((n) => n !== last);
    return all[Math.min(all.length - 1, Math.floor(random * all.length))] as "wave" | MoveName;
}

export interface BirdReactions {
    /** For the bird: the reaction to play, where it looks, whether it idles. */
    react: { name: MoveName; n: number } | null;
    gaze: readonly [number, number];
    fidgety: boolean;
    /** The field's words changed (the caret where it is, of how many). */
    typed: (text: string, caret?: number | null) => void;
    /** The conversation scrolled. */
    scrolled: (e: UIEvent<HTMLElement>) => void;
    /** A tap on the bird: "wave" (the caller waves) or a reaction it plays. */
    tap: () => "wave" | MoveName;
    /** A request was sent: the field cleared is no deletion. */
    sent: () => void;
}

export function useBirdReactions({ speed }: { speed: number }): BirdReactions {
    const [react, setReact] = useState<{ name: MoveName; n: number } | null>(null);
    const [gaze, setGaze] = useState<readonly [number, number]>([0, 0]);
    const [typing, setTyping] = useState(false);
    const length = useRef(0);
    const quiet = useRef(false);
    const n = useRef(0);
    const pause = useRef(0);
    const glance = useRef(0);
    const scrollTop = useRef(0);
    const taps = useRef(0);
    const lastTap = useRef("");
    const play = useCallback((name: MoveName) => setReact({ name, n: ++n.current }), []);
    useEffect(() => () => { window.clearTimeout(pause.current); window.clearTimeout(glance.current); }, []);

    const typed = useCallback((text: string, caret?: number | null) => {
        const was = length.current;
        length.current = text.length;
        setTyping(text.length > 0);
        // Its eyes on the caret: along the field (below it) by how far in it is.
        const at = caret ?? text.length;
        setGaze(text.length > 0 ? [Math.max(-1, Math.min(1, (Math.min(at, 40) / 40) * 2 - 1)), 1] : [0, 0]);
        if (quiet.current) { quiet.current = false; return; }
        const r = reactionFor(was, text.length);
        if (r) play(r);
        window.clearTimeout(pause.current);
        if (text.length > 0) pause.current = window.setTimeout(() => play(R.pause as MoveName), R.pauseAfter * speed);
    }, [play, speed]);

    const scrolled = useCallback((e: UIEvent<HTMLElement>) => {
        const top = e.currentTarget.scrollTop;
        const dir = top > scrollTop.current ? -1 : top < scrollTop.current ? 1 : 0;
        scrollTop.current = top;
        if (!dir) return;
        setGaze([0, dir]);
        window.clearTimeout(glance.current);
        glance.current = window.setTimeout(() => setGaze(length.current > 0 ? [0, 1] : [0, 0]), 300);
    }, []);

    const tap = useCallback(() => {
        const pick = pickTap(taps.current++, lastTap.current, Math.random());
        lastTap.current = pick;
        if (pick !== "wave") play(pick);
        return pick;
    }, [play]);

    const sent = useCallback(() => {
        quiet.current = true;
        window.clearTimeout(pause.current);
    }, []);

    return { react, gaze, fidgety: !typing, typed, scrolled, tap, sent };
}
