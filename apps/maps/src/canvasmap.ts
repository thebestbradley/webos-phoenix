// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The map without WebGL: Leaflet (BSD-2-Clause) with a canvas tile layer
// that draws the same OpenMapTiles vector tiles with the 2D canvas, in the
// Phoenix style's colours (a simpler picture: fills, roads, rail and
// labels at points). Used when the web runtime has no WebGL 2 (MapLibre
// GL needs it) or when Settings asks for it. With a raster tile URL in
// Settings it shows those tiles instead.
//
// Pinch zoom and pan work; rotation does not (Leaflet has none).

import L from "leaflet";
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { COLORS } from "./lib/style";

const LANG = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").slice(0, 2).toLowerCase();
/** A label in the device's language where the tile has it (as lib/style.ts's labelField). */
function label(p: Record<string, unknown>): string {
    return String(p[`name:${LANG}`] ?? p["name:latin"] ?? p.name ?? "");
}

export type TileLoader = (z: number, x: number, y: number) => Promise<ArrayBuffer>;

type Style = { fill?: string; stroke?: string; width?: number; dash?: number[]; alpha?: number };

const MAX_DATA_ZOOM = 14;

function road(cls: string, z: number): [Style, Style] | null {
    const k = Math.pow(1.5, z - 14);
    const w = (base: number) => Math.max(0.6, base * k);
    switch (cls) {
        case "motorway": return [{ stroke: COLORS.motorwayCasing, width: w(7.5) }, { stroke: COLORS.motorway, width: w(6) }];
        case "trunk": case "primary": return [{ stroke: COLORS.primaryCasing, width: w(6.5) }, { stroke: COLORS.primary, width: w(5) }];
        case "secondary": case "tertiary": return z < 9 ? null : [{ stroke: COLORS.casing, width: w(5) }, { stroke: COLORS.tertiary, width: w(3.8) }];
        case "minor": case "service": return z < 12 ? null : [{ stroke: COLORS.casing, width: w(3) }, { stroke: COLORS.street, width: w(2) }];
        case "path": case "track": return z < 14 ? null : [{}, { stroke: COLORS.path, width: 1, dash: [3, 2] }];
        case "rail": case "transit": return z < 10 ? null : [{}, { stroke: COLORS.rail, width: 1.2, dash: [4, 3] }];
        default: return null;
    }
}

function fillFor(layer: string, cls: string): string | null {
    if (layer === "water") return COLORS.water;
    if (layer === "park") return COLORS.park;
    if (layer === "landcover") return cls === "wood" || cls === "forest" ? COLORS.wood : cls === "grass" ? COLORS.park : null;
    if (layer === "landuse") return cls === "residential" ? COLORS.residential : cls === "commercial" || cls === "retail" ? COLORS.commercial : cls === "industrial" ? COLORS.industrial : null;
    if (layer === "building") return COLORS.building;
    return null;
}

/** A point of interest a tile drew, in the tile's pixels: what a tap on it picks (poiAt). */
export interface DrawnPoi { x: number; y: number; name: string; category: string }

function draw(ctx: CanvasRenderingContext2D, vt: VectorTile, z: number, size: number, sub: { scale: number; dx: number; dy: number }, pois: DrawnPoi[] = []) {
    const tx = (f: VectorTileFeature) => {
        const s = (size / f.extent) * sub.scale;
        return (p: { x: number; y: number }): [number, number] => [p.x * s - sub.dx, p.y * s - sub.dy];
    };
    const path = (f: VectorTileFeature, close: boolean) => {
        const t = tx(f);
        ctx.beginPath();
        for (const ring of f.loadGeometry()) {
            ring.forEach((p, i) => { const [x, y] = t(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
            if (close) ctx.closePath();
        }
    };
    ctx.fillStyle = COLORS.land;
    ctx.fillRect(0, 0, size, size);
    for (const name of ["landuse", "landcover", "park", "water", ...(z >= 15 ? ["building"] : [])]) {
        const layer = vt.layers[name];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            const color = f.type === 3 ? fillFor(name, String(f.properties.class ?? "")) : null;
            if (!color) continue;
            path(f, true);
            ctx.fillStyle = color;
            ctx.fill("evenodd");
        }
    }
    const ww = vt.layers.waterway;
    if (ww && z >= 8) {
        for (let i = 0; i < ww.length; i++) {
            path(ww.feature(i), false);
            ctx.strokeStyle = COLORS.water;
            ctx.lineWidth = z >= 14 ? 2 : 1;
            ctx.stroke();
        }
    }
    const tr = vt.layers.transportation;
    if (tr) {
        const feats: { f: VectorTileFeature; s: [Style, Style] }[] = [];
        for (let i = 0; i < tr.length; i++) {
            const f = tr.feature(i);
            const s = f.type === 2 && f.properties.brunnel !== "tunnel" ? road(String(f.properties.class), z) : null;
            if (s) feats.push({ f, s });
        }
        const order = ["path", "track", "service", "minor", "tertiary", "secondary", "primary", "trunk", "motorway", "rail", "transit"];
        feats.sort((a, b) => order.indexOf(String(a.f.properties.class)) - order.indexOf(String(b.f.properties.class)));
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const pass of [0, 1] as const) {
            for (const { f, s } of feats) {
                const st = s[pass];
                if (!st.stroke) continue;
                path(f, false);
                ctx.setLineDash(st.dash ?? []);
                ctx.strokeStyle = st.stroke;
                ctx.lineWidth = st.width ?? 1;
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);
    }
    // Labels: places, and points of interest close in.
    const text = (label: string, x: number, y: number, font: string, color: string) => {
        if (x < -40 || y < -10 || x > size + 40 || y > size + 10) return;
        ctx.font = font;
        ctx.lineWidth = 3;
        ctx.strokeStyle = COLORS.halo;
        ctx.strokeText(label, x, y);
        ctx.fillStyle = color;
        ctx.fillText(label, x, y);
    };
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Labels do not overlap: each takes a box, and one that would cover
    // another is left out (one label per street per tile, on a long enough
    // stretch of it).
    const boxes: [number, number, number, number][] = [];
    const free = (x: number, y: number, w: number, h: number) => {
        const b: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
        boxes.push(b);
        return true;
    };
    const street = vt.layers.transportation_name;
    if (street && z >= 15) {
        const done = new Set<string>();
        ctx.font = "10px 'Noto Sans', 'Open Sans', sans-serif";
        for (let i = 0; i < street.length; i++) {
            const f = street.feature(i);
            const n = label(f.properties);
            if (!n || done.has(n)) continue;
            const t = tx(f);
            const ring = f.loadGeometry()[0];
            if (!ring || ring.length < 2) continue;
            // The longest segment, if the name fits on it.
            let best = -1, len = 0;
            for (let k = 0; k + 1 < ring.length; k++) {
                const [ax, ay] = t(ring[k]), [bx, by] = t(ring[k + 1]);
                const l = Math.hypot(bx - ax, by - ay);
                if (l > len) { len = l; best = k; }
            }
            const w = ctx.measureText(n).width;
            if (best < 0 || len < w + 8) continue;
            const [x0, y0] = t(ring[best]), [x1, y1] = t(ring[best + 1]);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
            if (!free(cx, cy, Math.max(w, 30), Math.max(w, 30) * 0.5)) continue;
            done.add(n);
            let a = Math.atan2(y1 - y0, x1 - x0);
            if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(a);
            text(n, 0, 0, "10px 'Noto Sans', 'Open Sans', sans-serif", COLORS.label);
            ctx.restore();
        }
    }
    const poi = vt.layers.poi;
    if (poi && z >= 16) {
        for (let i = 0; i < poi.length; i++) {
            const f = poi.feature(i);
            if (Number(f.properties.rank ?? 99) > (z >= 17 ? 40 : 15)) continue;
            const p = f.loadGeometry()[0]?.[0];
            if (!p) continue;
            const [x, y] = tx(f)(p);
            if (!free(x, y - 6, 90, 22)) continue;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.poi;
            ctx.fill();
            text(label(f.properties), x, y - 10, "10px 'Noto Sans', 'Open Sans', sans-serif", COLORS.poi);
            pois.push({ x, y, name: label(f.properties), category: String(f.properties.subclass ?? f.properties.class ?? "").replace(/_/g, " ") });
        }
    }
    const place = vt.layers.place;
    if (place) {
        for (let i = 0; i < place.length; i++) {
            const f = place.feature(i);
            const c = String(f.properties.class);
            const big = c === "city" || c === "town";
            if (!big && z < 12) continue;
            if (big && z > 15) continue;
            const p = f.loadGeometry()[0]?.[0];
            if (!p) continue;
            const [x, y] = tx(f)(p);
            if (!free(x, y, 110, 18)) continue;
            text(label(f.properties), x, y, big ? "bold 15px 'Noto Sans', sans-serif" : "bold 11px 'Noto Sans', sans-serif", big ? COLORS.label : "#6b645a");
        }
    }
}

/** A Leaflet layer drawing vector tiles with the 2D canvas. */
export function vectorCanvasLayer(load: TileLoader, attribution: string): L.GridLayer {
    const Layer = L.GridLayer.extend({
        createTile(coords: L.Coords, done: (err: Error | null, tile: HTMLElement) => void) {
            const tile = document.createElement("canvas");
            const size = 256;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            tile.width = size * dpr;
            tile.height = size * dpr;
            const ctx = tile.getContext("2d")!;
            ctx.scale(dpr, dpr);
            // Past zoom 14 draw the part of the zoom-14 tile under this one.
            const z = Math.min(coords.z, MAX_DATA_ZOOM);
            const k = 2 ** (coords.z - z);
            const x = Math.floor(coords.x / k), y = Math.floor(coords.y / k);
            const sub = { scale: k, dx: (coords.x - x * k) * size, dy: (coords.y - y * k) * size };
            const pois: DrawnPoi[] = [];
            (tile as HTMLCanvasElement & { pois?: DrawnPoi[] }).pois = pois;
            tile.classList.add("mp-canvas-tile");
            load(z, x, y).then((buf) => {
                if (buf.byteLength) draw(ctx, new VectorTile(new PbfReader(new Uint8Array(buf))), coords.z, size, sub, pois);
                else { ctx.fillStyle = COLORS.land; ctx.fillRect(0, 0, size, size); }
                done(null, tile);
            }, (e: Error) => done(e, tile));
            return tile;
        },
    });
    return new (Layer as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({ attribution, maxZoom: 19, maxNativeZoom: 19, tileSize: 256 });
}

/**
 * The point of interest drawn nearest a tap (client coordinates), within
 * r pixels, and where it is on the screen; null if none.
 */
export function poiAt(clientX: number, clientY: number, r = 14): (DrawnPoi & { clientX: number; clientY: number }) | null {
    let best: (DrawnPoi & { clientX: number; clientY: number }) | null = null, bestD = r;
    for (const el of Array.from(document.querySelectorAll<HTMLCanvasElement & { pois?: DrawnPoi[] }>("canvas.mp-canvas-tile"))) {
        const b = el.getBoundingClientRect();
        if (clientX < b.left - r || clientX > b.right + r || clientY < b.top - r || clientY > b.bottom + r || !el.pois?.length) continue;
        const k = b.width / 256;
        for (const p of el.pois) {
            const cx = b.left + p.x * k, cy = b.top + p.y * k;
            // The dot or its name above it.
            const d = Math.min(Math.hypot(clientX - cx, clientY - cy), Math.hypot(clientX - cx, clientY - (cy - 10 * k)));
            if (d < bestD) { bestD = d; best = { ...p, clientX: cx, clientY: cy }; }
        }
    }
    return best;
}

/** Does this runtime have WebGL 2 (what MapLibre GL 6 needs)? */
export function hasWebGL2(): boolean {
    try {
        const c = document.createElement("canvas");
        return !!c.getContext("webgl2");
    } catch {
        return false;
    }
}
