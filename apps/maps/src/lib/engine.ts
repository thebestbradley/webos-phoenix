// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Search and directions as the app uses them: the online provider first
// (unless Settings says offline), the offline index and router over the
// saved regions' tiles when the provider fails or is off.

import { distance, lngLatToTile, type LngLat } from "./geo";
import { buildGraph, buildIndex, GRAPH_ZOOM, routeOffline, searchIndex, type Graph, type IndexEntry, type TileRef } from "./offline";
import type { Providers } from "./providers";
import { routeOnline, RoutingError, type Route, type TravelMode } from "./route";
import { parseCoords, coordsPlace, reverseOnline, searchOnline, type Place } from "./search";
import { getTile, regions, tileInBoundsAny } from "./tiles";

/** Offline search reads at most this many zoom-14 tiles around the map (a few km). */
const INDEX_TILES = 64;
/** The offline router reads at most this many zoom-14 tiles (a route of ~15 km). */
const GRAPH_TILES = 100;

async function loadTiles(p: Providers, list: [number, number][], offlineOnly: boolean): Promise<TileRef[]> {
    const out: TileRef[] = [];
    await Promise.all(list.map(async ([x, y]) => {
        if (offlineOnly && !tileInBoundsAny(GRAPH_ZOOM, x, y)) return;
        const data = await getTile(p, GRAPH_ZOOM, x, y);
        if (data.byteLength) out.push({ z: GRAPH_ZOOM, x, y, data });
    }));
    return out;
}

/** Zoom-14 tiles around a point, nearest first. */
function tilesAround(c: LngLat, n: number): [number, number][] {
    const [cx, cy] = lngLatToTile(c[0], c[1], GRAPH_ZOOM);
    const r = Math.ceil(Math.sqrt(n) / 2);
    const out: [number, number][] = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) out.push([cx + dx, cy + dy]);
    out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    return out.slice(0, n);
}

let indexCache: { key: string; index: Promise<IndexEntry[]> } | null = null;

/** The offline index of the saved regions around a point. */
export function offlineIndex(p: Providers, near: LngLat): Promise<IndexEntry[]> {
    const tiles = tilesAround(near, INDEX_TILES).filter(([x, y]) => tileInBoundsAny(GRAPH_ZOOM, x, y));
    const key = regions().map((r) => r.id).join(",") + "|" + tiles.map((t) => t.join("/")).sort().join(",");
    if (indexCache?.key !== key) indexCache = { key, index: loadTiles(p, tiles, true).then(buildIndex) };
    return indexCache.index;
}

export interface SearchOutcome { places: Place[]; offline: boolean; error?: string }

export async function findPlaces(p: Providers, q: string, near: LngLat, signal?: AbortSignal): Promise<SearchOutcome> {
    const pt = parseCoords(q);
    if (pt) return { places: [coordsPlace(pt, q.trim())], offline: false };
    let error: string | undefined;
    if (p.search.kind !== "offline") {
        try {
            const places = await searchOnline(p, q, near, signal);
            if (places.length) return { places, offline: false };
        } catch (e) {
            if (signal?.aborted) throw e;
            error = e instanceof Error ? e.message : String(e);
        }
    }
    const index = await offlineIndex(p, near);
    const places = searchIndex(index, q, near);
    return { places, offline: true, error: places.length ? undefined : error };
}

/** What is at a point: the nearest offline entry within 60 m, else the provider's reverse geocoding. */
export async function whatIsHere(p: Providers, at: LngLat): Promise<Place | null> {
    if (p.search.kind !== "offline") {
        try {
            const r = await reverseOnline(p, at);
            if (r) return r;
        } catch { /* offline next */ }
    }
    const index = await offlineIndex(p, at);
    let best: IndexEntry | null = null, bestD = 60;
    for (const e of index) {
        if (e.kind === "place") continue;
        const d = distance(at, [e.lon, e.lat]);
        if (d < bestD) { bestD = d; best = e; }
    }
    return best;
}

let graphCache: { key: string; graph: Promise<Graph> } | null = null;

export async function offlineRoute(p: Providers, from: LngLat, to: LngLat, mode: TravelMode): Promise<Route> {
    const pad = 0.01; // ~1 km around both ends
    const [x0, y0] = lngLatToTile(Math.min(from[0], to[0]) - pad, Math.max(from[1], to[1]) + pad, GRAPH_ZOOM);
    const [x1, y1] = lngLatToTile(Math.max(from[0], to[0]) + pad, Math.min(from[1], to[1]) - pad, GRAPH_ZOOM);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > GRAPH_TILES) throw new RoutingError("Too far for offline directions");
    const list: [number, number][] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push([x, y]);
    const key = regions().map((r) => r.id).join(",") + `|${x0},${y0},${x1},${y1}`;
    if (graphCache?.key !== key) {
        graphCache = { key, graph: loadTiles(p, list, p.routing.kind === "offline" || p.tiles.kind === "offline").then(buildGraph) };
    }
    return routeOffline(await graphCache.graph, from, to, mode);
}

export interface RouteOutcome { route: Route; note?: string }

export async function directions(p: Providers, from: LngLat, to: LngLat, mode: TravelMode, signal?: AbortSignal): Promise<RouteOutcome> {
    if (p.routing.kind !== "offline") {
        try {
            return { route: await routeOnline(p, from, to, mode, signal) };
        } catch (e) {
            if (signal?.aborted) throw e;
            try {
                return { route: await offlineRoute(p, from, to, mode), note: "The routing server did not answer: offline directions." };
            } catch {
                throw e;
            }
        }
    }
    return { route: await offlineRoute(p, from, to, mode) };
}
