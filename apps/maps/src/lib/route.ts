// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Directions: a route and its turn list, from Valhalla, OSRM or the
// offline router (offline.ts), in one shape the app draws and navigates.
//
// Valhalla (the default, FOSSGIS's public server or your own):
//   GET {url}/route?json={locations, costing: auto|pedestrian|bicycle, ...}
//   -> trip.legs[0].shape (polyline, precision 6) and maneuvers with
//      ready-made English instructions.
//   https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
// OSRM (your own, or the FOSSGIS demo for non-commercial use):
//   GET {url}/route/v1/{profile}/{lon,lat;lon,lat}?steps=true&geometries=geojson&overview=full
//   -> routes[0].legs[0].steps with maneuver {type, modifier}; we write
//      the instruction text. http://project-osrm.org/docs/v5.24.0/api/

import { decodePolyline, type LngLat } from "./geo";
import type { Providers } from "./providers";

export type TravelMode = "drive" | "walk" | "cycle";

/** How a step turns, for its arrow and its words. */
export type Modifier = "straight" | "slight right" | "right" | "sharp right" | "uturn" | "sharp left" | "left" | "slight left";

export interface Step {
    kind: "depart" | "turn" | "continue" | "roundabout" | "merge" | "ramp" | "arrive";
    modifier?: Modifier;
    /** The road this step goes along. */
    name: string;
    instruction: string;
    /** What to say ahead of the maneuver ("In 300 metres, turn left onto ..." is made from it). */
    spoken?: string;
    /** From here to the next step, m and s. */
    distance: number;
    duration: number;
    location: LngLat;
    /** Index of location in the route geometry. */
    index: number;
}

export interface Route {
    mode: TravelMode;
    distance: number;
    duration: number;
    geometry: LngLat[];
    steps: Step[];
    /** Who made it: "Valhalla", "OSRM", "Offline". */
    provider: string;
}

export class RoutingError extends Error {}

const VALHALLA_COSTING: Record<TravelMode, string> = { drive: "auto", walk: "pedestrian", cycle: "bicycle" };
const OSRM_PROFILE: Record<TravelMode, string> = { drive: "driving", walk: "foot", cycle: "bike" };
/** The FOSSGIS OSRM server has one server per profile (routed-car, ...). */
const FOSSGIS_OSRM: Record<TravelMode, string> = { drive: "routed-car", walk: "routed-foot", cycle: "routed-bike" };

// ---- Words -----------------------------------------------------------------------------------

export function modifierFromAngle(a: number): Modifier {
    const x = Math.abs(a);
    const side = a > 0 ? "right" : "left";
    if (x < 20) return "straight";
    if (x < 60) return `slight ${side}` as Modifier;
    if (x < 125) return side;
    if (x < 165) return `sharp ${side}` as Modifier;
    return "uturn";
}

const onto = (name: string) => (name ? ` onto ${name}` : "");

/** English instruction for a step (OSRM and offline steps; Valhalla brings its own). */
export function instructionFor(s: Pick<Step, "kind" | "modifier" | "name">, mode: TravelMode): string {
    const go = mode === "walk" ? "Walk" : mode === "cycle" ? "Cycle" : "Drive";
    switch (s.kind) {
        case "depart": return `${go}${s.name ? ` along ${s.name}` : ""}`;
        case "arrive": return "You have arrived at your destination";
        case "roundabout": return `Enter the roundabout${s.name ? ` and exit onto ${s.name}` : ""}`;
        case "merge": return `Merge${onto(s.name)}`;
        case "ramp": return `Take the ramp${onto(s.name)}`;
        default:
            if (!s.modifier || s.modifier === "straight") return `Continue${onto(s.name)}`;
            if (s.modifier === "uturn") return `Make a U-turn${onto(s.name)}`;
            return `Turn ${s.modifier}${onto(s.name)}`;
    }
}

// ---- Valhalla ---------------------------------------------------------------------------------

interface ValhallaManeuver {
    type: number;
    instruction: string;
    verbal_pre_transition_instruction?: string;
    street_names?: string[];
    length: number; // km (units: kilometers)
    time: number;
    begin_shape_index: number;
}

const VALHALLA_TYPES: Record<number, [Step["kind"], Modifier?]> = {
    1: ["depart"], 2: ["depart"], 3: ["depart"], 4: ["arrive"], 5: ["arrive"], 6: ["arrive"],
    7: ["continue", "straight"], 8: ["continue", "straight"], 9: ["turn", "slight right"], 10: ["turn", "right"],
    11: ["turn", "sharp right"], 12: ["turn", "uturn"], 13: ["turn", "uturn"], 14: ["turn", "sharp left"],
    15: ["turn", "left"], 16: ["turn", "slight left"], 17: ["ramp", "straight"], 18: ["ramp", "slight right"],
    19: ["ramp", "slight left"], 20: ["ramp", "slight right"], 21: ["ramp", "slight left"], 22: ["continue", "straight"],
    23: ["continue", "slight right"], 24: ["continue", "slight left"], 25: ["merge", "straight"], 26: ["roundabout"],
    27: ["roundabout"], 37: ["merge", "slight right"], 38: ["merge", "slight left"],
};

export function parseValhalla(json: unknown, mode: TravelMode): Route {
    const trip = (json as { trip?: { legs?: { shape: string; maneuvers: ValhallaManeuver[] }[]; summary?: { length: number; time: number } } }).trip;
    const leg = trip?.legs?.[0];
    if (!trip || !leg) throw new RoutingError("No route found");
    const geometry = decodePolyline(leg.shape, 6);
    const steps: Step[] = leg.maneuvers.map((m) => {
        const [kind, modifier] = VALHALLA_TYPES[m.type] ?? ["turn" as const];
        const index = Math.min(m.begin_shape_index, geometry.length - 1);
        return {
            kind, modifier, name: m.street_names?.[0] ?? "", instruction: m.instruction.replace(/\.$/, ""),
            spoken: m.verbal_pre_transition_instruction?.replace(/\.$/, ""),
            distance: m.length * 1000, duration: m.time, location: geometry[index], index,
        };
    });
    return { mode, distance: (trip.summary?.length ?? 0) * 1000, duration: trip.summary?.time ?? 0, geometry, steps, provider: "Valhalla" };
}

export function valhallaUrl(base: string, from: LngLat, to: LngLat, mode: TravelMode): string {
    const q = {
        locations: [{ lat: from[1], lon: from[0] }, { lat: to[1], lon: to[0] }],
        costing: VALHALLA_COSTING[mode],
        units: "kilometers",
        directions_options: { language: "en-US" },
    };
    return `${base}/route?json=${encodeURIComponent(JSON.stringify(q))}`;
}

// ---- OSRM -------------------------------------------------------------------------------------

interface OsrmStep {
    name: string;
    distance: number;
    duration: number;
    maneuver: { type: string; modifier?: string; location: LngLat };
    geometry: { coordinates: LngLat[] };
}

export function parseOsrm(json: unknown, mode: TravelMode): Route {
    const r = (json as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: LngLat[] }; legs: { steps: OsrmStep[] }[] }[] });
    const route = r.routes?.[0];
    if (r.code !== "Ok" || !route) throw new RoutingError("No route found");
    const geometry = route.geometry.coordinates;
    let cursor = 0;
    const steps: Step[] = route.legs[0].steps.map((s) => {
        const t = s.maneuver.type;
        const kind: Step["kind"] = t === "depart" ? "depart" : t === "arrive" ? "arrive" : t === "roundabout" || t === "rotary" ? "roundabout"
            : t === "merge" ? "merge" : t === "on ramp" || t === "off ramp" ? "ramp" : t === "new name" || t === "continue" ? "continue" : "turn";
        const modifier = (s.maneuver.modifier as Modifier | undefined) ?? (kind === "continue" ? "straight" : undefined);
        // Where the step starts in the overview geometry.
        const loc = s.maneuver.location;
        for (let i = cursor; i < geometry.length; i++) {
            if (Math.abs(geometry[i][0] - loc[0]) < 1e-6 && Math.abs(geometry[i][1] - loc[1]) < 1e-6) { cursor = i; break; }
        }
        const step: Step = { kind, modifier, name: s.name, instruction: "", distance: s.distance, duration: s.duration, location: loc, index: cursor };
        step.instruction = instructionFor(step, mode);
        return step;
    });
    return { mode, distance: route.distance, duration: route.duration, geometry, steps, provider: "OSRM" };
}

export function osrmUrl(base: string, from: LngLat, to: LngLat, mode: TravelMode): string {
    // routing.openstreetmap.de serves each profile under its own path.
    const prefix = /routing\.openstreetmap\.de$/.test(base) ? `${base}/${FOSSGIS_OSRM[mode]}` : base;
    return `${prefix}/route/v1/${OSRM_PROFILE[mode]}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true`;
}

// ---- Online routing ---------------------------------------------------------------------------

export async function routeOnline(p: Providers, from: LngLat, to: LngLat, mode: TravelMode, signal?: AbortSignal): Promise<Route> {
    const { kind, url, clientId } = p.routing;
    if (kind === "valhalla") {
        const r = await fetch(valhallaUrl(url, from, to, mode), { signal, headers: clientId ? { "X-Client-Id": clientId } : {} });
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new RoutingError((json as { error?: string } | null)?.error ?? `Routing server: HTTP ${r.status}`);
        return parseValhalla(json, mode);
    }
    if (kind === "osrm") {
        const r = await fetch(osrmUrl(url, from, to, mode), { signal });
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new RoutingError((json as { message?: string } | null)?.message ?? `Routing server: HTTP ${r.status}`);
        return parseOsrm(json, mode);
    }
    throw new RoutingError("Online routing is off");
}
