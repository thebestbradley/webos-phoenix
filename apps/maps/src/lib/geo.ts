// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Small geometry helpers: distances on the sphere, bearings, points on
// lines, Web Mercator tiles, polyline decoding and how distances and times
// read ("0.3 mi", "12 min").

/** [longitude, latitude], as in GeoJSON. */
export type LngLat = [number, number];

const R = 6371008.8; // mean Earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0-360). */
export function bearing(a: LngLat, b: LngLat): number {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed turn from bearing a to bearing b, -180..180 (positive: right). */
export function turnAngle(a: number, b: number): number {
    return ((b - a + 540) % 360) - 180;
}

/** Length of a line in metres. */
export function lineLength(line: readonly LngLat[]): number {
    let d = 0;
    for (let i = 1; i < line.length; i++) d += distance(line[i - 1], line[i]);
    return d;
}

/**
 * The closest point of a line to p: its index (the segment it starts),
 * the fraction along that segment, the point, the distance to p (m) and
 * how far along the line it is (m). Uses a local flat projection, which is
 * exact enough over a few kilometres.
 */
export function nearestOnLine(line: readonly LngLat[], p: LngLat) {
    const kx = Math.cos(rad(p[1])) * 111320;
    const ky = 110540;
    let best = { index: 0, t: 0, point: line[0] as LngLat, distance: Infinity, along: 0 };
    let along = 0;
    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1];
        const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
        const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const cx = ax + t * dx, cy = ay + t * dy;
        const d = Math.hypot(cx, cy);
        const seg = Math.sqrt(len2);
        if (d < best.distance) {
            best = { index: i, t, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], distance: d, along: along + seg * t };
        }
        along += seg;
    }
    if (line.length === 1) best.distance = distance(line[0], p);
    return best;
}

/** [west, south, east, north] around some points. */
export function bounds(points: readonly LngLat[]): [number, number, number, number] {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of points) {
        w = Math.min(w, x); e = Math.max(e, x);
        s = Math.min(s, y); n = Math.max(n, y);
    }
    return [w, s, e, n];
}

// ---- Web Mercator tiles ------------------------------------------------------------------

export function lngLatToTile(lon: number, lat: number, z: number): [number, number] {
    const n = 2 ** z;
    const r = rad(Math.max(-85.0511, Math.min(85.0511, lat)));
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** A point in a tile (x, y in tile units 0..extent) to [lon, lat]. */
export function tilePointToLngLat(z: number, tx: number, ty: number, x: number, y: number, extent: number): LngLat {
    const n = 2 ** z;
    const gx = (tx + x / extent) / n;
    const gy = (ty + y / extent) / n;
    const lat = deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * gy))));
    return [gx * 360 - 180, lat];
}

/** Every tile [z, x, y] of the zoom levels that covers a bounding box. */
export function tilesIn(b: readonly [number, number, number, number], zooms: readonly number[]): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const z of zooms) {
        const [x0, y0] = lngLatToTile(b[0], b[3], z);
        const [x1, y1] = lngLatToTile(b[2], b[1], z);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    }
    return out;
}

export function tileInBounds(z: number, x: number, y: number, b: readonly [number, number, number, number]): boolean {
    const [x0, y0] = lngLatToTile(b[0], b[3], z);
    const [x1, y1] = lngLatToTile(b[2], b[1], z);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// ---- Encoded polylines (Valhalla: precision 6, Google/OSRM: 5) ---------------------------

export function decodePolyline(s: string, precision = 6): LngLat[] {
    const f = 10 ** precision;
    const out: LngLat[] = [];
    let lat = 0, lon = 0, i = 0;
    const next = () => {
        let shift = 0, result = 0, b: number;
        do {
            b = s.charCodeAt(i++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20 && i < s.length);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (i < s.length) {
        lat += next();
        lon += next();
        out.push([lon / f, lat / f]);
    }
    return out;
}

// ---- Reading distances and times ---------------------------------------------------------

export type Units = "metric" | "imperial";

export function formatDistance(m: number, units: Units): string {
    if (units === "imperial") {
        const ft = m * 3.28084;
        if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
        const mi = m / 1609.344;
        return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
    }
    if (m < 1000) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
    const km = m / 1000;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Spoken form: "300 metres", "half a mile" is overkill; numbers and units in words. */
export function spokenDistance(m: number, units: Units): string {
    const t = formatDistance(m, units);
    return t.replace(/ ft$/, " feet").replace(/ mi$/, " miles").replace(/ km$/, " kilometres").replace(/ m$/, " metres");
}

export function formatDuration(s: number): string {
    const min = Math.max(1, Math.round(s / 60));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "37.33370, -121.89070" */
export function formatCoords(p: LngLat): string {
    return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
}
