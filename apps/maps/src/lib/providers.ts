// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where Maps gets its data. Every endpoint is configurable, so a user or an
// organisation can point Maps at its own servers (docs/MAPS.md shows how to
// host each piece). The defaults are public services whose terms allow an
// app used by many people without an API key:
//
// - Map tiles: OpenFreeMap (no key, no limits, commercial use allowed; the
//   OpenMapTiles schema). https://openfreemap.org/
// - Search: Photon by komoot (fair use; searching only when the user asks,
//   never as-you-type, and cached). Nominatim (1 request/s, no
//   autocomplete) is the alternative. https://photon.komoot.io/,
//   https://operations.osmfoundation.org/policies/nominatim/
// - Directions: Valhalla on the FOSSGIS server (fair use; apps identify
//   themselves with an X-Client-Id header). OSRM's demo server is for
//   non-commercial use only, so it is not the default.
//
// Defaults come from public/providers.json (an image or an organisation
// can replace that file), then the user's changes in Settings (local
// storage) win.

import { getLocal } from "./local";

export type TilesKind = "openmaptiles" | "style" | "offline";
export type SearchKind = "photon" | "nominatim" | "offline";
export type RoutingKind = "valhalla" | "osrm" | "offline";
export type RendererKind = "auto" | "vector" | "canvas";

export interface Providers {
    tiles: {
        /** openmaptiles: the Phoenix style over a TileJSON (or {z}/{x}/{y}) URL; style: somebody's whole style; offline: saved regions only. */
        kind: TilesKind;
        /** TileJSON URL or tile template of an OpenMapTiles-schema vector tile set (also pmtiles://https://...). */
        url: string;
        /** A MapLibre style JSON URL (kind "style"), e.g. a keyed MapTiler or Stadia style. */
        styleUrl: string;
        /** Glyphs for labels outside the bundled Latin ranges ({fontstack}, {range}). */
        glyphsUrl: string;
        /** Optional raster tiles ({z}/{x}/{y}) for the canvas renderer, instead of drawing the vector tiles. */
        rasterUrl: string;
        attribution: string;
    };
    search: { kind: SearchKind; url: string };
    routing: { kind: RoutingKind; url: string; clientId: string };
    renderer: RendererKind;
}

export const DEFAULT_PROVIDERS: Providers = {
    tiles: {
        kind: "openmaptiles",
        url: "https://tiles.openfreemap.org/planet",
        styleUrl: "",
        glyphsUrl: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        rasterUrl: "",
        attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    },
    search: { kind: "photon", url: "https://photon.komoot.io" },
    routing: { kind: "valhalla", url: "https://valhalla1.openstreetmap.de", clientId: "webos-phoenix-maps" },
    renderer: "auto",
};

/** Suggested endpoints per kind, for the Settings page. */
export const SEARCH_URLS: Record<SearchKind, string> = {
    photon: "https://photon.komoot.io",
    nominatim: "https://nominatim.openstreetmap.org",
    offline: "",
};
export const ROUTING_URLS: Record<RoutingKind, string> = {
    valhalla: "https://valhalla1.openstreetmap.de",
    osrm: "https://routing.openstreetmap.de",
    offline: "",
};

const KEY = "maps:providers";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeProviders(base: Providers, over: DeepPartial<Providers> | null | undefined): Providers {
    if (!over || typeof over !== "object") return base;
    return {
        tiles: { ...base.tiles, ...(over.tiles ?? {}) },
        search: { ...base.search, ...(over.search ?? {}) },
        routing: { ...base.routing, ...(over.routing ?? {}) },
        renderer: over.renderer ?? base.renderer,
    } as Providers;
}

let shipped: Providers = DEFAULT_PROVIDERS;

/** Read public/providers.json (the image's or organisation's defaults). */
export async function loadShippedProviders(): Promise<Providers> {
    try {
        shipped = mergeProviders(DEFAULT_PROVIDERS, (await getLocal("providers.json", "json")) as DeepPartial<Providers>);
    } catch { /* keep the built-in defaults */ }
    return shipped;
}

export function shippedProviders(): Providers {
    return shipped;
}

export function loadProviders(): Providers {
    try {
        const raw = localStorage.getItem(KEY);
        return mergeProviders(shipped, raw ? (JSON.parse(raw) as DeepPartial<Providers>) : null);
    } catch {
        return shipped;
    }
}

export function saveProviders(p: Providers): void {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export function resetProviders(): Providers {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    return shipped;
}

/** A URL a user typed: http(s) only, no trailing slash. */
export function cleanUrl(u: string): string {
    return u.trim().replace(/\/+$/, "");
}

export function isValidUrl(u: string): boolean {
    if (!u) return true;
    try {
        const x = new URL(u.replace(/^pmtiles:\/\//, ""));
        return x.protocol === "https:" || x.protocol === "http:";
    } catch {
        return false;
    }
}

// ---- App preferences ----------------------------------------------------------------------

export interface Prefs {
    units: "metric" | "imperial";
    voice: boolean;
    mode: "drive" | "walk" | "cycle";
    /** Last camera, to open where the user left off. */
    camera?: { center: [number, number]; zoom: number; bearing?: number };
}

const PREFS = "maps:prefs";

export function loadPrefs(): Prefs {
    const def: Prefs = { units: "imperial", voice: true, mode: "drive" };
    try {
        const raw = localStorage.getItem(PREFS);
        return raw ? { ...def, ...(JSON.parse(raw) as Partial<Prefs>) } : def;
    } catch {
        return def;
    }
}

export function savePrefs(p: Prefs): void {
    try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* ignore */ }
}
