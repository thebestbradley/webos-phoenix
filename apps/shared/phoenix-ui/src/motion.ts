// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How fast the page's own animations run: Settings > Accessibility > Reduce
// motion stops them, Settings > Advanced > Animation speed "Fast" runs them
// in 60% of the time, as the shell's (Theme.motion). The web runtime puts
// the setting on the page's root element (data-phoenix-motion: "reduce",
// "fast" or "normal"); the stylesheet reads it as --pui-motion. The
// browser's own reduced-motion setting counts as Reduce motion.

/** 0 (no animation), 0.6 (fast) or 1. */
export function motionScale(): number {
    const root = typeof document !== "undefined" ? document.documentElement : null;
    const m = root?.getAttribute("data-phoenix-motion");
    if (m === "reduce")
        return 0;
    try {
        if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
            return 0;
    } catch { /* no media queries */ }
    return m === "fast" ? 0.6 : 1;
}

/** An animation's time in ms, at the page's speed. */
export function motion(ms: number): number {
    return Math.round(ms * motionScale());
}
