// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Maps' own glyphs (32x32, currentColor), drawn for Phoenix: the locate
// crosshair, directions, travel modes, the compass and turn arrows.

import type { Modifier, Step } from "./lib/route";

const P: Record<string, string> = {
    locate: "M15 2h2v4.1A10 10 0 0 1 25.9 15H30v2h-4.1A10 10 0 0 1 17 25.9V30h-2v-4.1A10 10 0 0 1 6.1 17H2v-2h4.1A10 10 0 0 1 15 6.1zm1 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    directions: "M16 2l14 14-14 14L2 16zm-3 9v5h-1v6h3v-5h5v3l4-4.5-4-4.5v3z",
    drive: "M8 7h16l3 8h1a2 2 0 0 1 2 2v6h-3v3h-4v-3H9v3H5v-3H2v-6a2 2 0 0 1 2-2h1zm1.8 3L8 15h16l-1.8-5zM7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm18 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    walk: "M17.5 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM14 8.5l4-.5 2 5 4 2-1 2-5-2.5-1-2-1.5 5 3.5 4 1 8h-2.5l-1-6.5-3-3-1.5 4-4 5.5L8 28l3.5-5 2-9.5-2 1.3V19H9v-5.5z",
    cycle: "M7 16a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM25 16a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM19.5 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM12 11l5-3 3 4h4v2.4h-5.2l-1.7-2.2-2.6 1.8 3.5 3v7h-2.4v-6l-4-3.2a1.8 1.8 0 0 1 .4-2.8z",
    compass: "M16 2a14 14 0 1 1 0 28 14 14 0 0 1 0-28zm0 3l-4 11h8zm-4 11l4 11 4-11z",
    layers: "M16 3l14 7-14 7-14-7zm-11 11.5l11 5.5 11-5.5 3 1.5-14 7-14-7zm0 6l11 5.5 11-5.5 3 1.5-14 7-14-7z",
    swap: "M9 4l6 6h-4v12H7V10H3zm14 24l-6-6h4V10h4v12h4z",
    speaker: "M4 12h5l7-6v20l-7-6H4zm15.5-1.8a8 8 0 0 1 0 11.6l-2-2a5.2 5.2 0 0 0 0-7.6zm3.5-3.5a13 13 0 0 1 0 18.6l-2-2a10.2 10.2 0 0 0 0-14.6z",
    mute: "M4 12h5l7-6v20l-7-6H4zm15 .5l2-2 3.5 3.5 3.5-3.5 2 2-3.5 3.5 3.5 3.5-2 2-3.5-3.5-3.5 3.5-2-2 3.5-3.5z",
    pin: "M16 2a9 9 0 0 1 9 9c0 7-9 19-9 19S7 18 7 11a9 9 0 0 1 9-9zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    search: "M13 3a10 10 0 0 1 8.2 15.7l7.6 7.6-2.5 2.5-7.6-7.6A10 10 0 1 1 13 3zm0 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z",
    download: "M13 3h6v11h5l-8 9-8-9h5zM4 25h24v4H4z",
};

export function MapGlyph({ name, size = 32, className }: { name: keyof typeof P; size?: number; className?: string }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
            <path d={P[name]} fillRule="evenodd" />
        </svg>
    );
}

const ROT: Record<Modifier, number> = {
    straight: 0, "slight right": 45, right: 90, "sharp right": 135, uturn: 180, "sharp left": -135, left: -90, "slight left": -45,
};

/** The arrow for a step: a bent arrow turning by the step's angle. */
export function TurnArrow({ step, size = 32 }: { step: Pick<Step, "kind" | "modifier">; size?: number }) {
    if (step.kind === "arrive") {
        return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><path d={P.pin} fillRule="evenodd" /></svg>;
    }
    if (step.kind === "depart") {
        return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><circle cx="16" cy="24" r="4" /><path d="M14 20V9H9l7-7 7 7h-5v11z" /></svg>;
    }
    const a = ROT[step.modifier ?? "straight"];
    if (step.modifier === "uturn") {
        return (
            <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                <path d="M20 29V13a6 6 0 0 0-12 0v6" /><path d="M3 15l5 6 5-6" strokeLinejoin="round" />
            </svg>
        );
    }
    // A stem from the bottom, then the head turned by the angle at the middle.
    const rad = (a * Math.PI) / 180;
    const ex = 16 + Math.sin(rad) * 11, ey = 15 - Math.cos(rad) * 11;
    const hx = Math.sin(rad), hy = -Math.cos(rad), px = -hy, py = hx;
    const head = `M${ex + hx * 3} ${ey + hy * 3}L${ex - hx * 4 + px * 6} ${ey - hy * 4 + py * 6}L${ex - hx * 4 - px * 6} ${ey - hy * 4 - py * 6}Z`;
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
            <path d={`M16 30V15L${ex - hx * 2} ${ey - hy * 2}`} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
            <path d={head} fill="currentColor" />
        </svg>
    );
}
