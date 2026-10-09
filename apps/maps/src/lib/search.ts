// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Finding places: Photon or Nominatim online, and the offline index of the
// saved regions (offline.ts). Searches run only when the user submits a
// query (Nominatim's policy forbids search-as-you-type; we treat Photon's
// fair use the same way), identical queries come from a cache, and
// Nominatim gets at most one request a second.
//
//   Photon:    GET {url}/api?q=&lat=&lon=&limit=   -> GeoJSON features
//              GET {url}/reverse?lat=&lon=
//   Nominatim: GET {url}/search?q=&format=jsonv2&addressdetails=1&limit=
//              GET {url}/reverse?lat=&lon=&format=jsonv2

import { distance, type LngLat } from "./geo";
import type { Providers } from "./providers";

export interface Place {
    /** Stable enough to key a list: provider and id, or coordinates. */
    id: string;
    name: string;
    /** Second line: street, city, country. */
    detail: string;
    lon: number;
    lat: number;
    kind: "poi" | "street" | "address" | "place" | "coords" | "saved" | "contact";
    category?: string;
    /** Where it came from, for the attribution line. */
    source?: string;
}

export const placePoint = (p: Pick<Place, "lon" | "lat">): LngLat => [p.lon, p.lat];

export function coordsPlace(p: LngLat, name = "Dropped pin"): Place {
    return { id: `pt:${p[0].toFixed(6)},${p[1].toFixed(6)}`, name, detail: "", lon: p[0], lat: p[1], kind: "coords" };
}

/** A query that is just coordinates: "37.33, -121.89" (lat, lon). */
export function parseCoords(q: string): LngLat | null {
    const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

// ---- Photon -----------------------------------------------------------------------------------

interface PhotonFeature {
    geometry: { coordinates: LngLat };
    properties: {
        osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; type?: string;
        name?: string; housenumber?: string; street?: string; locality?: string; district?: string;
        city?: string; state?: string; country?: string; postcode?: string;
    };
}

export function parsePhoton(json: unknown): Place[] {
    const feats = ((json as { features?: PhotonFeature[] })?.features ?? []);
    return feats.map((f) => {
        const p = f.properties;
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const name = p.name || street || p.city || p.state || p.country || "Unnamed place";
        const detail = [p.name ? street : "", p.city ?? p.locality ?? p.district, p.state, p.country]
            .filter((x, i, a) => x && a.indexOf(x) === i && x !== name).join(", ");
        const kind: Place["kind"] = p.type === "street" ? "street" : p.type === "house" && !p.name ? "address"
            : ["city", "district", "locality", "state", "country", "county"].includes(p.type ?? "") ? "place" : "poi";
        return {
            id: `photon:${p.osm_type ?? ""}${p.osm_id ?? `${f.geometry.coordinates}`}`, name, detail,
            lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], kind,
            category: p.osm_value?.replace(/_/g, " "), source: "Photon",
        };
    });
}

// ---- Nominatim --------------------------------------------------------------------------------

interface NominatimResult {
    place_id?: number; osm_type?: string; osm_id?: number; lat: string; lon: string;
    name?: string; display_name: string; category?: string; type?: string; addresstype?: string;
    address?: Record<string, string>;
}

export function parseNominatim(json: unknown): Place[] {
    const list = Array.isArray(json) ? (json as NominatimResult[]) : json && typeof json === "object" && "lat" in json ? [json as NominatimResult] : [];
    return list.map((r) => {
        const parts = r.display_name.split(",").map((s) => s.trim());
        const a = r.address ?? {};
        const street = [a.house_number, a.road].filter(Boolean).join(" ");
        const name = r.name || street || parts[0];
        const detail = parts.filter((s) => s !== name && s !== a.house_number).slice(0, 4).join(", ");
        const kind: Place["kind"] = r.addresstype === "road" ? "street" : a.house_number && !r.name ? "address"
            : ["city", "town", "village", "state", "country", "suburb", "county"].includes(r.addresstype ?? "") ? "place" : "poi";
        return {
            id: `nominatim:${r.osm_type ?? ""}${r.osm_id ?? r.place_id}`, name, detail, lon: Number(r.lon), lat: Number(r.lat), kind,
            category: r.type?.replace(/_/g, " "), source: "Nominatim",
        };
    });
}

// ---- Requests, cached and paced -----------------------------------------------------------------

const cache = new Map<string, Place[]>();
const CACHE_MAX = 100;
let lastNominatim = 0;

async function paced(kind: string): Promise<void> {
    if (kind !== "nominatim") return;
    const wait = lastNominatim + 1100 - Date.now();
    lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getJson(url: string, kind: string, signal?: AbortSignal): Promise<unknown> {
    await paced(kind);
    const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Search server: HTTP ${r.status}`);
    return r.json();
}

function remember(key: string, v: Place[]): Place[] {
    cache.set(key, v);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return v;
}

export function searchUrl(p: Providers, q: string, near?: LngLat): string | null {
    const { kind, url } = p.search;
    const bias = near ? `&lat=${near[1].toFixed(4)}&lon=${near[0].toFixed(4)}` : "";
    if (kind === "photon") return `${url}/api?q=${encodeURIComponent(q)}&limit=10&lang=en${bias}`;
    if (kind === "nominatim") return `${url}/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=10`;
    return null;
}

export async function searchOnline(p: Providers, q: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
    const url = searchUrl(p, q, near);
    if (!url) return [];
    // The same words near somewhere else are another search (the bias
    // changes the answer); a few hundred metres apart are the same.
    const key = `${url}`.replace(/&lat=[^&]*&lon=[^&]*/, "") + (near ? `@${near[0].toFixed(2)},${near[1].toFixed(2)}` : "");
    const hit = cache.get(key);
    if (hit) return hit;
    const json = await getJson(url, p.search.kind, signal);
    const places = p.search.kind === "photon" ? parsePhoton(json) : parseNominatim(json);
    if (near) places.sort((a, b) => rank(a, near) - rank(b, near));
    return remember(key, places);
}

/** Nearby results first, but a far city match still beats nothing. */
function rank(p: Place, near: LngLat): number {
    return Math.log10(1 + distance(near, placePoint(p)));
}

export async function reverseOnline(p: Providers, at: LngLat, signal?: AbortSignal): Promise<Place | null> {
    const { kind, url } = p.search;
    let u: string;
    if (kind === "photon") u = `${url}/reverse?lat=${at[1]}&lon=${at[0]}&limit=1&lang=en`;
    else if (kind === "nominatim") u = `${url}/reverse?lat=${at[1]}&lon=${at[0]}&format=jsonv2&addressdetails=1`;
    else return null;
    const key = `rev:${kind}:${at[0].toFixed(5)},${at[1].toFixed(5)}`;
    const hit = cache.get(key);
    if (hit) return hit[0] ?? null;
    const json = await getJson(u, kind, signal);
    const places = kind === "photon" ? parsePhoton(json) : parseNominatim(json);
    return remember(key, places)[0] ?? null;
}
