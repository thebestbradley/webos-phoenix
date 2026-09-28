// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Search and directions without a server, from the same OpenMapTiles
// vector tiles the map draws (zoom 14, the most detailed level):
//
// - Search: named places (poi, place, park), streets (transportation_name)
//   and house numbers (housenumber, given the name of the nearest street,
//   since the tiles do not say which street a number is on).
// - Directions: a road graph from the transportation layer. Lines are
//   clipped to their tile, cut where they cross (unless one is a bridge or
//   tunnel), joined across tile edges by snapping ends within a few metres,
//   and named from the nearest transportation_name line. A* finds the
//   fastest way for the travel mode (drive: roads, respecting one-way
//   streets; walk: all but motorways; cycle: all but motorways and steps).
//
// It is a fallback, not a replacement for Valhalla: no turn restrictions,
// no access tags beyond the class, and the tiles simplify geometry. It is
// what makes Maps work in a saved region with no network at all, and what
// the tests use (tools/test-maps.cjs).

import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { bearing, distance, lineLength, tilePointToLngLat, turnAngle, type LngLat } from "./geo";
import { instructionFor, modifierFromAngle, RoutingError, type Route, type Step, type TravelMode } from "./route";
import type { Place } from "./search";

export const GRAPH_ZOOM = 14;

export interface TileRef { z: number; x: number; y: number; data: ArrayBuffer }

type XY = [number, number];

function decode(t: TileRef): VectorTile | null {
    if (!t.data.byteLength) return null;
    try { return new VectorTile(new PbfReader(new Uint8Array(t.data))); } catch { return null; }
}

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

// ---- Search index -------------------------------------------------------------------------------

const ABBREV: Record<string, string> = {
    st: "street", ave: "avenue", av: "avenue", rd: "road", blvd: "boulevard", dr: "drive", ln: "lane", ct: "court",
    pl: "place", hwy: "highway", pkwy: "parkway", sq: "square", n: "north", s: "south", e: "east", w: "west",
    ter: "terrace", cir: "circle", mt: "mount", ft: "fort", sta: "station",
};

/** Lower-case words, accents folded and abbreviations spelled out. */
export function tokens(s: string): string[] {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/).filter(Boolean).map((w) => ABBREV[w] ?? w);
}

export interface IndexEntry extends Place { words: string[] }

function nearestName(names: { line: XY[]; name: string }[], p: XY, max: number): string {
    let best = "", bestD = max;
    for (const n of names) {
        for (let i = 0; i + 1 < n.line.length; i++) {
            const d = segDist(p, n.line[i], n.line[i + 1]);
            if (d < bestD) { bestD = d; best = n.name; }
        }
    }
    return best;
}

function segDist(p: XY, a: XY, b: XY): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function nameLines(layer: VectorTileLayer | undefined): { line: XY[]; name: string }[] {
    const out: { line: XY[]; name: string }[] = [];
    if (!layer) return out;
    for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const name = str(f.properties.name);
        if (!name) continue;
        for (const ring of f.loadGeometry()) out.push({ line: ring.map((q) => [q.x, q.y] as XY), name });
    }
    return out;
}

/** The places in some tiles. `city` names the area in the second line of results. */
export function buildIndex(tiles: readonly TileRef[]): IndexEntry[] {
    const out: IndexEntry[] = [];
    const seen = new Set<string>();
    const decoded = tiles.map((t) => ({ t, vt: decode(t) }));
    let anyCity = "";
    for (const { vt } of decoded) {
        const pl = vt?.layers.place;
        for (let i = 0; pl && i < pl.length && !anyCity; i++) {
            const f = pl.feature(i);
            if (f.properties.class === "city" || f.properties.class === "town") anyCity = str(f.properties.name);
        }
    }
    for (const { t, vt } of decoded) {
        if (!vt) continue;
        const extent = (Object.values(vt.layers)[0]?.extent) ?? 4096;
        const ll = (q: { x: number; y: number }) => tilePointToLngLat(t.z, t.x, t.y, q.x, q.y, extent);
        const inside = (q: { x: number; y: number }) => q.x >= 0 && q.y >= 0 && q.x < extent && q.y < extent;
        const places = vt.layers.place;
        let city = "";
        if (places) {
            for (let i = 0; i < places.length; i++) {
                const f = places.feature(i);
                const name = str(f.properties.name);
                const q = f.loadGeometry()[0]?.[0];
                if (!name || !q) continue;
                if (f.properties.class === "city" || f.properties.class === "town") city ||= name;
                if (!inside(q)) continue;
                add({ name, detail: str(f.properties.class), kind: "place", category: str(f.properties.class), at: ll(q) });
            }
        }
        // Tiles hold the label of the nearest city, not always their own:
        // else the first one seen in any tile.
        city ||= anyCity;
        const streets = nameLines(vt.layers.transportation_name);
        const poi = vt.layers.poi;
        if (poi) {
            for (let i = 0; i < poi.length; i++) {
                const f = poi.feature(i);
                const name = str(f.properties.name);
                const q = f.loadGeometry()[0]?.[0];
                if (!name || !q || !inside(q)) continue;
                const street = nearestName(streets, [q.x, q.y], 40);
                const category = str(f.properties.subclass || f.properties.class).replace(/_/g, " ");
                add({ name, detail: [street, city].filter(Boolean).join(", "), kind: "poi", category, at: ll(q) });
            }
        }
        const park = vt.layers.park;
        if (park) {
            for (let i = 0; i < park.length; i++) {
                const f = park.feature(i);
                const name = str(f.properties.name);
                const q = f.type === 1 ? f.loadGeometry()[0]?.[0] : undefined;
                if (!name || !q || !inside(q)) continue;
                add({ name, detail: city, kind: "poi", category: "park", at: ll(q) });
            }
        }
        // A street: once per tile, at the middle of its longest piece.
        const longest = new Map<string, XY[]>();
        for (const s of streets) {
            const cur = longest.get(s.name);
            if (!cur || s.line.length > cur.length) longest.set(s.name, s.line);
        }
        for (const [name, line] of longest) {
            const mid = line[Math.floor(line.length / 2)];
            if (!inside({ x: mid[0], y: mid[1] })) continue;
            add({ name, detail: city, kind: "street", category: "street", at: ll({ x: mid[0], y: mid[1] }), dedupe: 1500 });
        }
        const hn = vt.layers.housenumber;
        if (hn) {
            for (let i = 0; i < hn.length; i++) {
                const f = hn.feature(i);
                const num = str(f.properties.housenumber);
                const q = f.loadGeometry()[0]?.[0];
                if (!num || !q || !inside(q)) continue;
                const street = nearestName(streets, [q.x, q.y], 60);
                if (!street) continue;
                add({ name: `${num} ${street}`, detail: city, kind: "address", at: ll(q) });
            }
        }
    }
    return out;

    function add(e: { name: string; detail: string; kind: Place["kind"]; category?: string; at: LngLat; dedupe?: number }) {
        const key = `${e.kind}:${e.name}`;
        if (e.dedupe && seen.has(key)) {
            // Same street in a neighbouring tile: keep one unless far apart.
            if (out.some((o) => o.kind === e.kind && o.name === e.name && distance([o.lon, o.lat], e.at) < e.dedupe!)) return;
        }
        seen.add(key);
        out.push({
            id: `offline:${e.kind}:${e.at[0].toFixed(5)},${e.at[1].toFixed(5)}:${e.name}`, name: e.name, detail: e.detail,
            lon: e.at[0], lat: e.at[1], kind: e.kind, category: e.category, source: "Offline", words: tokens(e.name),
        });
    }
}

/**
 * Best matches for a query. The part before the first comma must match:
 * every word starts a word of the name (or is the area's name). Words
 * after it ("San Jose, CA") only help when they match exactly. Whole words
 * and house numbers rank first, then the nearest.
 */
export function searchIndex(index: readonly IndexEntry[], q: string, near?: LngLat, limit = 10): Place[] {
    const [head, ...rest] = q.split(",");
    const qw = tokens(head);
    const extra = tokens(rest.join(" "));
    if (!qw.length) return [];
    const hits = matchWords(index, qw, extra, near, limit, false);
    // "100 Market Street" with no such number in the tiles: the street.
    if (!hits.length && /^\d/.test(qw[0]) && qw.length > 1) return matchWords(index, qw.slice(1), extra, near, limit, true);
    return hits;
}

function matchWords(index: readonly IndexEntry[], qw: string[], extra: string[], near: LngLat | undefined, limit: number,
                    address: boolean): Place[] {
    const scored: { e: IndexEntry; score: number }[] = [];
    for (const e of index) {
        let score = 0, matched = 0;
        const detail = tokens(e.detail);
        for (const w of qw) {
            if (e.words.includes(w)) { score += 3; matched++; }
            else if (e.words.some((x) => x.startsWith(w))) { score += 2; matched++; }
            else if (detail.includes(w)) { score += 0.5; matched++; }
        }
        if (matched < qw.length) continue;
        for (const w of extra) if (detail.includes(w) || e.words.includes(w)) score += 0.5;
        // Words of the name the query did not mention make it a worse match
        // ("North Market Street" for "Market Street" is still fine).
        score -= 0.5 * Math.max(0, e.words.length - qw.length);
        // An address asked for: streets and addresses before shops and stops.
        if (address && (e.kind === "street" || e.kind === "address")) score += 4;
        if (e.kind === "address" && /^\d/.test(qw[0]) && e.words[0] === qw[0]) score += 2;
        scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score
        || (near ? distance(near, [a.e.lon, a.e.lat]) - distance(near, [b.e.lon, b.e.lat]) : 0));
    return scored.slice(0, limit).map(({ e }) => {
        const { words: _words, ...place } = e;
        void _words;
        return place;
    });
}

// ---- Road graph ---------------------------------------------------------------------------------

interface Edge { to: number; len: number; cls: string; sub: string; name: string; oneway: 0 | 1 | -1; forward: boolean }

export interface Graph {
    nodes: LngLat[];
    edges: Edge[][];
    /** Per mode: each node's connected component, and the biggest one (lazily). */
    components?: Partial<Record<TravelMode, { of: Int32Array; main: number }>>;
}

const SPEED: Record<TravelMode, Record<string, number>> = {
    // km/h by OpenMapTiles transportation class.
    drive: { motorway: 100, trunk: 80, primary: 55, secondary: 50, tertiary: 45, minor: 35, service: 15, track: 10 },
    walk: { default: 5 },
    cycle: { default: 16, path: 12 },
};
const ROAD_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track", "path", "busway"]);

function allowed(e: Edge, mode: TravelMode): boolean {
    if (mode === "drive") return e.cls !== "path" && e.cls !== "busway" && !(e.oneway === 1 && !e.forward) && !(e.oneway === -1 && e.forward);
    if (e.cls === "motorway" || e.cls === "trunk") return false;
    if (mode === "cycle") return e.sub !== "steps" && !(e.oneway === 1 && !e.forward && e.cls !== "path") && !(e.oneway === -1 && e.forward);
    return true;
}

function speed(e: Edge, mode: TravelMode): number {
    const t = SPEED[mode];
    return (t[e.cls] ?? t.default ?? 30) / 3.6;
}

/** Liang-Barsky: the part of segment a-b inside [0, size]^2, or null. */
function clip(a: XY, b: XY, size: number): [XY, XY] | null {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy], q = [a[0], size - a[0], a[1], size - a[1]];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; continue; }
        const r = q[i] / p[i];
        if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

/** Where segments a-b and c-d cross: t along a-b and u along c-d, or null. */
function cross(a: XY, b: XY, c: XY, d: XY): [number, number] | null {
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))] : null;
}

interface Piece { pts: XY[]; cls: string; sub: string; oneway: 0 | 1 | -1; level: string; name: string; cuts: number[][] }

export function buildGraph(tiles: readonly TileRef[]): Graph {
    const nodes: LngLat[] = [];
    const edges: Edge[][] = [];
    const grid = new Map<string, number[]>();
    const SNAP = 3; // m

    const nodeAt = (p: LngLat): number => {
        const cx = Math.round(p[0] * 1e4), cy = Math.round(p[1] * 1e4);
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                for (const n of grid.get(`${cx + i},${cy + j}`) ?? []) if (distance(nodes[n], p) < SNAP) return n;
            }
        }
        nodes.push(p);
        edges.push([]);
        const key = `${cx},${cy}`;
        const cell = grid.get(key);
        if (cell) cell.push(nodes.length - 1); else grid.set(key, [nodes.length - 1]);
        return nodes.length - 1;
    };

    for (const t of tiles) {
        const vt = decode(t);
        const layer = vt?.layers.transportation;
        if (!vt || !layer) continue;
        const extent = layer.extent;
        const names = nameLines(vt.layers.transportation_name);
        const pieces: Piece[] = [];
        for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            const cls = str(f.properties.class);
            if (f.type !== 2 || !ROAD_CLASSES.has(cls)) continue;
            const ow = Number(f.properties.oneway ?? 0);
            const level = `${str(f.properties.brunnel)}${f.properties.layer ?? ""}`;
            for (const ring of f.loadGeometry()) {
                // Clip to the tile: its neighbours draw the rest.
                let cur: XY[] = [];
                for (let k = 0; k + 1 < ring.length; k++) {
                    const s = clip([ring[k].x, ring[k].y], [ring[k + 1].x, ring[k + 1].y], extent);
                    if (!s) { if (cur.length > 1) pieces.push(mk(cur)); cur = []; continue; }
                    if (cur.length && (cur[cur.length - 1][0] !== s[0][0] || cur[cur.length - 1][1] !== s[0][1])) {
                        if (cur.length > 1) pieces.push(mk(cur));
                        cur = [];
                    }
                    if (!cur.length) cur.push(s[0]);
                    cur.push(s[1]);
                }
                if (cur.length > 1) pieces.push(mk(cur));
            }
            function mk(pts: XY[]): Piece {
                const mid = pts[Math.floor(pts.length / 2)];
                const a = pts[Math.max(0, Math.floor(pts.length / 2) - 1)];
                const probe: XY = [(mid[0] + a[0]) / 2, (mid[1] + a[1]) / 2];
                // Sidewalks are mapped as their own footways beside the
                // street: they take the street's name from a little further.
                const sub = str(f.properties.subclass);
                const reach = cls === "path" && (sub === "footway" || sub === "sidewalk" || sub === "cycleway") ? 20 : 10;
                return { pts, cls, sub, oneway: (ow === 1 ? 1 : ow === -1 ? -1 : 0), level, name: nearestName(names, probe, reach), cuts: pts.map(() => []) };
            }
        }
        // Cut pieces where they cross (a grid of cells keeps it near-linear).
        const CELL = 256;
        const cells = new Map<string, [number, number][]>();
        pieces.forEach((pc, pi) => {
            for (let k = 0; k + 1 < pc.pts.length; k++) {
                const a = pc.pts[k], b = pc.pts[k + 1];
                const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
                const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
                for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
                    const key = `${x},${y}`;
                    const c = cells.get(key);
                    if (c) c.push([pi, k]); else cells.set(key, [[pi, k]]);
                }
            }
        });
        for (const list of cells.values()) {
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const [pi, k] = list[i], [pj, m] = list[j];
                    if (pi === pj && Math.abs(k - m) < 2) continue;
                    const A = pieces[pi], B = pieces[pj];
                    if (A.level !== B.level) continue;
                    const x = cross(A.pts[k], A.pts[k + 1], B.pts[m], B.pts[m + 1]);
                    if (!x) continue;
                    if (!A.cuts[k].includes(x[0])) A.cuts[k].push(x[0]);
                    if (!B.cuts[m].includes(x[1])) B.cuts[m].push(x[1]);
                }
            }
        }
        const ll = (p: XY) => tilePointToLngLat(t.z, t.x, t.y, p[0], p[1], extent);
        for (const pc of pieces) {
            const pts: XY[] = [];
            for (let k = 0; k + 1 < pc.pts.length; k++) {
                const a = pc.pts[k], b = pc.pts[k + 1];
                pts.push(a);
                for (const tt of pc.cuts[k].filter((v) => v > 0 && v < 1).sort((u, v) => u - v)) {
                    pts.push([a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1])]);
                }
            }
            pts.push(pc.pts[pc.pts.length - 1]);
            let prev = nodeAt(ll(pts[0]));
            for (let k = 1; k < pts.length; k++) {
                const n = nodeAt(ll(pts[k]));
                if (n === prev) continue;
                const len = distance(nodes[prev], nodes[n]);
                const base = { len, cls: pc.cls, sub: pc.sub, name: pc.name, oneway: pc.oneway };
                edges[prev].push({ ...base, to: n, forward: true });
                edges[n].push({ ...base, to: prev, forward: false });
                prev = n;
            }
        }
    }
    return { nodes, edges };
}

// ---- A* -----------------------------------------------------------------------------------------

class Heap {
    private a: [number, number][] = [];
    get size() { return this.a.length; }
    push(n: number, f: number) {
        const a = this.a;
        a.push([n, f]);
        for (let i = a.length - 1; i > 0;) {
            const p = (i - 1) >> 1;
            if (a[p][1] <= a[i][1]) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop(): number {
        const a = this.a;
        const top = a[0][0];
        const last = a.pop()!;
        if (a.length) {
            a[0] = last;
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && a[l][1] < a[m][1]) m = l;
                if (r < a.length && a[r][1] < a[m][1]) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

/**
 * Connected parts of the network for a mode (ignoring one-way streets).
 * Ends of a route snap to the biggest, so a stray footpath or a parking
 * aisle cut off at the tile edge is never picked.
 */
function components(g: Graph, mode: TravelMode) {
    g.components ??= {};
    const known = g.components[mode];
    if (known) return known;
    const of = new Int32Array(g.nodes.length).fill(-1);
    const sizes: number[] = [];
    for (let i = 0; i < g.nodes.length; i++) {
        if (of[i] >= 0) continue;
        const c = sizes.length;
        let size = 0;
        const stack = [i];
        of[i] = c;
        while (stack.length) {
            const n = stack.pop()!;
            size++;
            for (const e of g.edges[n]) {
                if (of[e.to] >= 0 || !(allowed(e, mode) || allowed({ ...e, forward: !e.forward }, mode))) continue;
                of[e.to] = c;
                stack.push(e.to);
            }
        }
        sizes.push(size);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    return (g.components[mode] = { of, main });
}

/** The graph node nearest a point that the mode can use, within `max` metres. */
export function nearestNode(g: Graph, p: LngLat, mode: TravelMode, max = 300): number {
    const comp = components(g, mode);
    let best = -1, bestD = max;
    for (let i = 0; i < g.nodes.length; i++) {
        if (comp.of[i] !== comp.main || !g.edges[i].some((e) => allowed(e, mode))) continue;
        const d = distance(g.nodes[i], p);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

export function routeOffline(g: Graph, from: LngLat, to: LngLat, mode: TravelMode): Route {
    const s = nearestNode(g, from, mode), t = nearestNode(g, to, mode);
    if (s < 0 || t < 0) throw new RoutingError("No roads near there in the offline map");
    const vmax = Math.max(...Object.values(SPEED[mode])) / 3.6;
    const cost = new Float64Array(g.nodes.length).fill(Infinity);
    const via = new Int32Array(g.nodes.length).fill(-1);
    const viaEdge: (Edge | null)[] = new Array(g.nodes.length).fill(null);
    const heap = new Heap();
    cost[s] = 0;
    heap.push(s, 0);
    const done = new Uint8Array(g.nodes.length);
    while (heap.size) {
        const n = heap.pop();
        if (done[n]) continue;
        done[n] = 1;
        if (n === t) break;
        for (const e of g.edges[n]) {
            if (!allowed(e, mode)) continue;
            const c = cost[n] + e.len / speed(e, mode);
            if (c < cost[e.to]) {
                cost[e.to] = c;
                via[e.to] = n;
                viaEdge[e.to] = e;
                heap.push(e.to, c + distance(g.nodes[e.to], g.nodes[t]) / vmax);
            }
        }
    }
    if (!Number.isFinite(cost[t])) throw new RoutingError("No route found in the offline map");
    const path: number[] = [];
    const pathEdges: Edge[] = [];
    for (let n = t; n !== -1; n = via[n]) {
        path.push(n);
        if (viaEdge[n]) pathEdges.push(viaEdge[n]!);
    }
    path.reverse();
    pathEdges.reverse();
    const geometry: LngLat[] = [from, ...path.map((n) => g.nodes[n]), to];
    return { mode, distance: lineLength(geometry), duration: cost[t] + (distance(from, g.nodes[s]) + distance(to, g.nodes[t])) / (5 / 3.6),
             geometry, steps: stepsFor(g, path, pathEdges, mode, geometry), provider: "Offline" };
}

/** Group the path into steps: a new step where the road's name changes or it turns sharply. */
function stepsFor(g: Graph, path: number[], pathEdges: Edge[], mode: TravelMode, geometry: LngLat[]): Step[] {
    const label = (e: Edge) => e.name || (e.cls === "path" ? (e.sub === "cycleway" ? "the cycleway" : e.sub === "steps" ? "the steps" : "the path")
        : e.cls === "service" ? "the service road" : "");
    const steps: Step[] = [];
    let cur: Step | null = null;
    for (let i = 0; i < pathEdges.length; i++) {
        const e = pathEdges[i];
        const a = g.nodes[path[i]], b = g.nodes[path[i + 1]];
        const dur = e.len / speed(e, mode);
        const name = label(e);
        let turn = 0;
        if (i > 0) turn = turnAngle(bearing(g.nodes[path[i - 1]], a), bearing(a, b));
        const newName = cur && name !== cur.name && !(name === "" && e.len < 30);
        const sharp = cur && Math.abs(turn) > 60 && (cur.distance > 25);
        if (!cur || newName || sharp) {
            const kind: Step["kind"] = !cur ? "depart" : "turn";
            const step: Step = { kind, modifier: cur ? modifierFromAngle(turn) : undefined, name, instruction: "",
                distance: 0, duration: 0, location: a, index: i + 1 };
            if (step.kind === "turn" && step.modifier === "straight") step.kind = "continue";
            steps.push(step);
            cur = step;
        }
        cur.distance += e.len;
        cur.duration += dur;
    }
    // Tidy up: a step shorter than a crossing folds into the one before,
    // then neighbours on the same road become one.
    for (let i = steps.length - 1; i > 0; i--) {
        const s = steps[i], prev = steps[i - 1];
        if (s.distance < 20 || s.name === prev.name) {
            prev.distance += s.distance;
            prev.duration += s.duration;
            steps.splice(i, 1);
        }
    }
    const end = geometry[geometry.length - 1];
    steps.push({ kind: "arrive", name: "", instruction: "", distance: 0, duration: 0, location: end, index: geometry.length - 1 });
    if (!pathEdges.length) steps.unshift({ kind: "depart", name: "", instruction: "", distance: lineLength(geometry), duration: 0, location: geometry[0], index: 0 });
    for (const s of steps) s.instruction = instructionFor(s, mode);
    return steps;
}
