// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where each vector tile comes from. Both renderers (MapLibre GL and the
// canvas fallback) ask getTile(z, x, y), which looks, in order, in
//
//   1. the demo region shipped with the app (public/regions/sample),
//   2. regions the user saved for offline use (IndexedDB),
//   3. PMTiles regions (a .pmtiles file on the device or on a web server),
//   4. the online tile server in Settings, unless Maps is set to offline.
//
// A missing tile is an empty tile, so the map simply shows less.
//
// Offline regions: "Save this area" fetches every tile of the visible area
// down to zoom 14 (OpenMapTiles' most detailed level; the map overzooms it)
// from the online server into IndexedDB, at most MAX_REGION_TILES tiles so
// one download stays polite. Bigger areas are better made once as a
// PMTiles file (docs/MAPS.md) and opened from Files or from a URL.

import { PMTiles, type Source, type RangeResponse } from "pmtiles";
import { tileInBounds, tilesIn } from "./geo";
import { getLocal } from "./local";
import type { Providers } from "./providers";

export interface Region {
    id: string;
    name: string;
    /** west, south, east, north */
    bounds: [number, number, number, number];
    zooms: number[];
    tiles: number;
    bytes: number;
    created?: number;
    kind: "bundled" | "saved" | "pmtiles";
    /** pmtiles: where the file is (http(s) URL, or a file: path turned into a URL). */
    url?: string;
}

export const MAX_REGION_TILES = 2500;
export const REGION_ZOOMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// ---- gzip ------------------------------------------------------------------------------------

function isGzip(b: Uint8Array): boolean {
    return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export async function inflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
    const u = new Uint8Array(buf);
    if (!isGzip(u)) return buf;
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([u]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
}

// ---- IndexedDB ------------------------------------------------------------------------------

const DB_NAME = "phoenix-maps";
let dbp: Promise<IDBDatabase> | null = null;

function idb(): Promise<IDBDatabase> {
    if (!dbp) {
        dbp = new Promise((resolve, reject) => {
            if (typeof indexedDB === "undefined") { reject(new Error("No IndexedDB")); return; }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains("tiles")) d.createObjectStore("tiles");
                if (!d.objectStoreNames.contains("regions")) d.createObjectStore("regions", { keyPath: "id" });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    return idb().then((d) => new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        t.oncomplete = () => resolve(r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    }));
}

// ---- Regions -------------------------------------------------------------------------------

let bundled: Region | null = null;
let saved: Region[] = [];
const pmtiles = new Map<string, PMTiles>();

/** A PMTiles source over a whole file fetched once (a file on the device has no HTTP ranges). */
class BlobSource implements Source {
    private blob: Promise<Blob> | null = null;
    constructor(private readonly url: string) {}
    getKey() { return this.url; }
    async getBytes(offset: number, length: number): Promise<RangeResponse> {
        if (!this.blob) {
            this.blob = getLocal(this.url, "arraybuffer").then((b) => {
                if (!b) throw new Error("File not found");
                return new Blob([b]);
            });
        }
        const b = await this.blob;
        return { data: await b.slice(offset, offset + length).arrayBuffer() };
    }
}

function pmtilesFor(url: string): PMTiles {
    let p = pmtiles.get(url);
    if (!p) {
        p = /^https?:/.test(url) ? new PMTiles(url) : new PMTiles(new BlobSource(url));
        pmtiles.set(url, p);
    }
    return p;
}

/** Load the demo region's description and the saved regions. */
export async function loadRegions(): Promise<Region[]> {
    if (!bundled) {
        try {
            const m = (await getLocal("regions/sample/region.json", "json")) as Omit<Region, "kind">;
            bundled = { ...m, kind: "bundled" };
        } catch { /* no demo region */ }
    }
    try {
        saved = ((await tx<Region[]>("regions", "readonly", (s) => s.getAll() as IDBRequest<Region[]>)) ?? []);
    } catch {
        saved = [];
    }
    return regions();
}

export function regions(): Region[] {
    return [...(bundled ? [bundled] : []), ...saved];
}

// ---- Online source -------------------------------------------------------------------------

let online: { key: string; template: Promise<string | null> } | null = null;

/** The {z}/{x}/{y} template of the configured online tiles (reads the TileJSON once). */
export function onlineTemplate(p: Providers): Promise<string | null> {
    const key = `${p.tiles.kind} ${p.tiles.url}`;
    if (online?.key === key) return online.template;
    let template: Promise<string | null>;
    if (p.tiles.kind !== "openmaptiles" || !p.tiles.url) template = Promise.resolve(null);
    else if (p.tiles.url.includes("{z}") || p.tiles.url.startsWith("pmtiles://")) template = Promise.resolve(p.tiles.url);
    else {
        template = fetch(p.tiles.url)
            .then((r) => (r.ok ? r.json() : null))
            .then((tj: { tiles?: string[] } | null) => tj?.tiles?.[0] ?? null)
            .catch(() => { online = null; return null; });
    }
    online = { key, template };
    return template;
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
    return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

async function fetchOnline(p: Providers, z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const t = await onlineTemplate(p);
    if (!t) return null;
    if (t.startsWith("pmtiles://")) {
        const r = await pmtilesFor(t.slice("pmtiles://".length)).getZxy(z, x, y, signal);
        return r?.data ?? null;
    }
    const r = await fetch(tileUrl(t, z, x, y), { signal });
    if (r.status === 204 || r.status === 404) return new ArrayBuffer(0);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
}

// ---- Tiles ---------------------------------------------------------------------------------

const EMPTY = new ArrayBuffer(0);

/** One vector tile, from wherever it is; always inflated. */
export async function getTile(p: Providers, z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    for (const r of regions()) {
        if (!r.zooms.includes(z) || !tileInBounds(z, x, y, r.bounds)) continue;
        try {
            let data: ArrayBuffer | undefined | null;
            if (r.kind === "bundled") {
                data = await getLocal(`regions/${r.id}/${z}/${x}/${y}.pbf`, "arraybuffer");
            } else if (r.kind === "saved") {
                data = await tx<ArrayBuffer>("tiles", "readonly", (s) => s.get(`${r.id}/${z}/${x}/${y}`) as IDBRequest<ArrayBuffer>);
            } else if (r.url) {
                data = (await pmtilesFor(r.url).getZxy(z, x, y, signal))?.data;
            }
            if (data && data.byteLength) return inflate(data);
        } catch { /* try the next place */ }
    }
    try {
        const data = await fetchOnline(p, z, x, y, signal);
        return data ? inflate(data) : EMPTY;
    } catch {
        return EMPTY;
    }
}

/** Is this tile in an offline region (or the demo region)? */
export function tileInBoundsAny(z: number, x: number, y: number): boolean {
    return regions().some((r) => r.zooms.includes(z) && tileInBounds(z, x, y, r.bounds));
}

/** Is any offline region (or the demo region) around this point? */
export function offlineCovers(lon: number, lat: number): Region | undefined {
    return regions().find((r) => lon >= r.bounds[0] && lon <= r.bounds[2] && lat >= r.bounds[1] && lat <= r.bounds[3]);
}

// ---- Saving regions ------------------------------------------------------------------------

export function regionTileCount(b: [number, number, number, number], zooms = REGION_ZOOMS): number {
    return tilesIn(b, zooms).length;
}

export interface DownloadProgress { done: number; total: number; bytes: number }

/** Save every tile of an area for offline use. */
export async function saveRegion(p: Providers, name: string, b: [number, number, number, number],
                                 onProgress: (d: DownloadProgress) => void, signal?: AbortSignal): Promise<Region> {
    const all = tilesIn(b, REGION_ZOOMS);
    if (all.length > MAX_REGION_TILES) throw new Error(`That area needs ${all.length} tiles; zoom in (at most ${MAX_REGION_TILES}).`);
    if (!(await onlineTemplate(p))) throw new Error("Saving an area needs an online tile server (Settings).");
    const id = `r${Date.now().toString(36)}`;
    let done = 0, bytes = 0;
    const queue = all.slice();
    const worker = async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
            if (signal?.aborted) throw new Error("Cancelled");
            const [z, x, y] = t;
            const data = await fetchOnline(p, z, x, y, signal);
            if (data && data.byteLength) {
                await tx("tiles", "readwrite", (s) => { s.put(data, `${id}/${z}/${x}/${y}`); });
                bytes += data.byteLength;
            }
            onProgress({ done: ++done, total: all.length, bytes });
        }
    };
    try {
        await Promise.all([worker(), worker(), worker(), worker()]);
    } catch (e) {
        await deleteTiles(id);
        throw e;
    }
    const region: Region = { id, name, bounds: b, zooms: REGION_ZOOMS, tiles: all.length, bytes, created: Date.now(), kind: "saved" };
    await tx("regions", "readwrite", (s) => { s.put(region); });
    saved = [...saved, region];
    return region;
}

async function deleteTiles(id: string): Promise<void> {
    await tx("tiles", "readwrite", (s) => { s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)); });
}

export async function deleteRegion(id: string): Promise<void> {
    await deleteTiles(id);
    await tx("regions", "readwrite", (s) => { s.delete(id); });
    saved = saved.filter((r) => r.id !== id);
}

/** Add a PMTiles file (OpenMapTiles schema, e.g. made with Planetiler) as an offline region. */
export async function addPmtilesRegion(url: string, name: string): Promise<Region> {
    const p = pmtilesFor(url);
    const h = await p.getHeader();
    const zooms: number[] = [];
    for (let z = h.minZoom; z <= h.maxZoom; z++) zooms.push(z);
    const region: Region = {
        id: `p${Date.now().toString(36)}`, name, kind: "pmtiles", url,
        bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat], zooms, tiles: h.numAddressedTiles, bytes: 0, created: Date.now(),
    };
    await tx("regions", "readwrite", (s) => { s.put(region); });
    saved = [...saved, region];
    return region;
}
