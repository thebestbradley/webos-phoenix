// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Turn-by-turn: where the user is along the route, the next maneuver and
// how far it is, whether they left the route (then Maps asks for a new
// one), and what to say when. Pure functions over a Route and positions,
// so tests can drive them with made-up fixes.

import { distance, nearestOnLine, spokenDistance, type LngLat, type Units } from "./geo";
import type { Route, Step } from "./route";

export interface Progress {
    /** The step being followed; the next maneuver is steps[step + 1]. */
    step: number;
    /** Metres to the next maneuver. */
    toNext: number;
    /** Metres and seconds left in the route. */
    remaining: number;
    remainingTime: number;
    /** Where the user is snapped to the route. */
    snapped: LngLat;
    offRoute: boolean;
    arrived: boolean;
}

export const OFF_ROUTE_M = 50;
export const ARRIVED_M = 25;

/** Distance along the route to each step's start. */
export function stepOffsets(route: Route): number[] {
    const along: number[] = [0];
    for (let i = 1; i < route.geometry.length; i++) along.push(along[i - 1] + distance(route.geometry[i - 1], route.geometry[i]));
    return route.steps.map((s) => along[Math.min(s.index, along.length - 1)]);
}

export function progress(route: Route, at: LngLat, offsets = stepOffsets(route)): Progress {
    const near = nearestOnLine(route.geometry, at);
    const total = offsets.length ? Math.max(route.distance, offsets[offsets.length - 1]) : route.distance;
    let step = 0;
    for (let i = 0; i < offsets.length; i++) if (offsets[i] <= near.along + 1) step = i;
    // Past the last maneuver's point means following the last step to the end.
    const last = route.steps.length - 1;
    if (step >= last) step = Math.max(0, last - 1);
    const toNext = Math.max(0, (offsets[step + 1] ?? total) - near.along);
    const remaining = Math.max(0, total - near.along);
    const end = route.geometry[route.geometry.length - 1];
    const arrived = distance(at, end) < ARRIVED_M || (remaining < ARRIVED_M && near.distance < OFF_ROUTE_M);
    return {
        step, toNext, remaining,
        remainingTime: route.distance > 0 ? (route.duration * remaining) / route.distance : 0,
        snapped: near.point, offRoute: near.distance > OFF_ROUTE_M && !arrived, arrived,
    };
}

/** "In 300 feet, turn left onto Market Street" */
export function announcement(next: Step, toNext: number, units: Units): string {
    const what = (next.spoken ?? next.instruction).replace(/\.$/, "");
    if (next.kind === "arrive") return toNext < 60 ? "You have arrived at your destination" : `In ${spokenDistance(toNext, units)}, you will arrive at your destination`;
    const lower = what.charAt(0).toLowerCase() + what.slice(1);
    return toNext < 40 ? what : `In ${spokenDistance(toNext, units)}, ${lower}`;
}

/**
 * Announcements are made at a few distances before each maneuver: one
 * well ahead (depending on speed: 800 m driving, 150 m walking) and one
 * just before. `said` remembers what was said, so each is said once.
 */
export function dueAnnouncement(route: Route, p: Progress, units: Units, said: Set<string>): string | null {
    const next = route.steps[p.step + 1];
    if (!next) return null;
    if (p.arrived) {
        const key = "arrived";
        if (said.has(key)) return null;
        said.add(key);
        return "You have arrived at your destination";
    }
    const far = route.mode === "drive" ? 800 : route.mode === "cycle" ? 300 : 150;
    const near = route.mode === "drive" ? 150 : 40;
    for (const [band, limit] of [["near", near], ["far", far]] as const) {
        const key = `${p.step + 1}:${band}`;
        if (p.toNext <= limit && !said.has(key)) {
            said.add(key);
            if (band === "far") said.add(`${p.step + 1}:far`);
            // Nothing "far" once we are already near.
            if (band === "near") said.add(`${p.step + 1}:far`);
            return announcement(next, p.toNext, units);
        }
    }
    return null;
}
