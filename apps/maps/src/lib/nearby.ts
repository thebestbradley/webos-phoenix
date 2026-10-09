// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Coffee near me": places of a kind around the user, closest first.
//
// A free-text search for "coffee shops" finds places *named* like it
// anywhere (Photon's location bias only reorders: "coffee shops" from
// downtown San Jose gave ten copies of a Peet's in Berkeley, and with no
// bias at all "coffee" gave Iraq and Kenya). So a kind of place the
// words name (CATEGORIES) is asked for by its OpenStreetMap tag, inside a
// box around the user that grows until enough are found:
//
//   Photon:    GET {url}/api?include=osm.amenity.cafe&bbox=W,S,E,N&lat=&lon=&limit=
//              (no q: Photon's category filter; several include= are OR'd)
//   Nominatim: GET {url}/search?q=[cafe]&viewbox=W,N,E,S&bounded=1 (a special phrase)
//
// A name ("Starbucks") is searched as words, inside the same boxes.
// apps/assistant/service/lib/nearby.js has the same table for the
// Assistant's answers (maps.test.ts checks that they agree).

import { distance, type LngLat } from "./geo";
import type { Providers } from "./providers";
import { parseNominatim, parsePhoton, type Place } from "./search";

export interface Category {
    id: string;
    /** What a result is, said: "Coffee". */
    label: string;
    /** OpenStreetMap key.value pairs (Photon's include=osm.<key>.<value>). */
    tags: string[];
    /** Nominatim's special phrase. */
    phrase: string;
}

/** The kinds of place the words can name (the OSM tags as OSM's wiki defines them). */
export const CATEGORIES: (Category & { words: RegExp })[] = [
    { id: "cafe", label: "Coffee", tags: ["amenity.cafe"], phrase: "cafe",
      words: /^(?:coffee|coffees|coffee ?shops?|coffee ?houses?|cafes?|cafés?|espresso(?: bars?)?|coffee places?|places? (?:to|for|with) (?:get )?coffee)$/ },
    { id: "restaurant", label: "Restaurant", tags: ["amenity.restaurant", "amenity.fast_food"], phrase: "restaurant",
      words: /^(?:restaurants?|food|places? to eat|something to eat|somewhere to eat|(?:a )?bite to eat|dinner|lunch|breakfast|brunch|diners?)$/ },
    { id: "fast_food", label: "Fast food", tags: ["amenity.fast_food"], phrase: "fast food", words: /^(?:fast ?food|burgers?|burger (?:places?|joints?))$/ },
    { id: "pharmacy", label: "Pharmacy", tags: ["amenity.pharmacy", "shop.chemist"], phrase: "pharmacy",
      words: /^(?:pharmac(?:y|ies)|drug ?stores?|drugstores?|chemists?)$/ },
    { id: "fuel", label: "Gas station", tags: ["amenity.fuel"], phrase: "fuel",
      words: /^(?:gas|gas stations?|petrol(?: stations?)?|fuel(?: stations?)?|filling stations?|service stations?)$/ },
    { id: "charging", label: "EV charging", tags: ["amenity.charging_station"], phrase: "charging station",
      words: /^(?:(?:ev |electric car |car )?charg(?:ers?|ing stations?|ing points?))$/ },
    { id: "atm", label: "ATM", tags: ["amenity.atm"], phrase: "atm", words: /^(?:atms?|cash ?machines?|cashpoints?)$/ },
    { id: "bank", label: "Bank", tags: ["amenity.bank"], phrase: "bank", words: /^banks?$/ },
    { id: "hospital", label: "Hospital", tags: ["amenity.hospital"], phrase: "hospital", words: /^(?:hospitals?|emergency rooms?|e\.?r\.?)$/ },
    { id: "bar", label: "Bar", tags: ["amenity.bar", "amenity.pub"], phrase: "bar", words: /^(?:bars?|pubs?|places? (?:to|for) (?:a )?drinks?)$/ },
    { id: "supermarket", label: "Supermarket", tags: ["shop.supermarket"], phrase: "supermarket",
      words: /^(?:supermarkets?|grocer(?:y|ies)(?: stores?)?|grocery shops?|food stores?)$/ },
    { id: "convenience", label: "Convenience store", tags: ["shop.convenience"], phrase: "convenience store", words: /^(?:convenience stores?|corner shops?)$/ },
    { id: "bakery", label: "Bakery", tags: ["shop.bakery"], phrase: "bakery", words: /^(?:bakery|bakeries)$/ },
    { id: "parking", label: "Parking", tags: ["amenity.parking"], phrase: "parking", words: /^(?:parking(?: lots?| garages?| spaces?)?|car parks?|places? to park)$/ },
    { id: "hotel", label: "Hotel", tags: ["tourism.hotel", "tourism.motel"], phrase: "hotel", words: /^(?:hotels?|motels?|places? to stay)$/ },
    { id: "park", label: "Park", tags: ["leisure.park"], phrase: "park", words: /^parks?$/ },
    { id: "toilets", label: "Restroom", tags: ["amenity.toilets"], phrase: "toilets", words: /^(?:toilets?|restrooms?|bathrooms?|public toilets?|loos?)$/ },
    { id: "post", label: "Post office", tags: ["amenity.post_office"], phrase: "post office", words: /^post offices?$/ },
    { id: "library", label: "Library", tags: ["amenity.library"], phrase: "library", words: /^(?:library|libraries)$/ },
    { id: "gym", label: "Gym", tags: ["leisure.fitness_centre"], phrase: "gym", words: /^(?:gyms?|fitness (?:centers?|centres?))$/ },
];

/** The words of a nearby search without what only says "near": "the nearest coffee shop" -> "coffee shop". */
export function cleanNearby(q: string): string {
    return q.toLowerCase().trim()
        .replace(/[?.!]+$/, "")
        .replace(/\s+(?:near me|nearby|near here|around here|around me|close by|close to me|in the area|near my location)$/, "")
        .replace(/^(?:find|show(?: me)?|search for|look for|where(?:'s| is| are))\s+/, "")
        .replace(/^(?:an?|the|some|any)\s+/, "")
        .replace(/^(?:nearest|closest|nearby|good|best|local)\s+/, "")
        .trim();
}

export function categoryOf(q: string): Category | null {
    const w = cleanNearby(q);
    return CATEGORIES.find((c) => c.words.test(w)) ?? null;
}

/** Whether a typed search asks for places around the user ("coffee", "pharmacy near me"). */
export function isNearbyQuery(q: string): boolean {
    return !!categoryOf(q) || /\s(?:near me|nearby|near here|around here|around me|close by)\s*$/i.test(q.trim()) || /^(?:nearest|closest)\s/i.test(q.trim());
}

/** A box about km kilometres either way of p: [W, S, E, N]. */
export function boxAround(p: LngLat, km: number): [number, number, number, number] {
    const dLat = km / 111.2, dLon = km / (111.2 * Math.max(0.1, Math.cos((p[1] * Math.PI) / 180)));
    return [p[0] - dLon, p[1] - dLat, p[0] + dLon, p[1] + dLat];
}

/** The box sizes tried in turn (km either way) until enough places are found. */
export const RADII = [2, 8, 30];
const ENOUGH = 3;

export function nearbyUrl(p: Providers, q: string, near: LngLat, km: number, lang = "en"): string | null {
    const cat = categoryOf(q);
    const b = boxAround(near, km).map((v) => v.toFixed(4));
    const at = `&lat=${near[1].toFixed(4)}&lon=${near[0].toFixed(4)}`;
    if (p.search.kind === "photon") {
        const what = cat ? cat.tags.map((t) => `include=osm.${t}`).join("&") : `q=${encodeURIComponent(cleanNearby(q))}`;
        return `${p.search.url}/api?${what}&bbox=${b.join(",")}${at}&limit=20&lang=${lang}`;
    }
    if (p.search.kind === "nominatim") {
        const what = cat ? `[${cat.phrase}]` : cleanNearby(q);
        return `${p.search.url}/search?q=${encodeURIComponent(what)}&format=jsonv2&addressdetails=1&limit=20&bounded=1&viewbox=${b[0]},${b[3]},${b[2]},${b[1]}`;
    }
    return null;
}

/** Places sorted by distance from near, the same place listed twice (OSM has a shop's node and building) once. */
export function closest(places: readonly Place[], near: LngLat): Place[] {
    const sorted = [...places].sort((a, b) => distance(near, [a.lon, a.lat]) - distance(near, [b.lon, b.lat]));
    const out: Place[] = [];
    for (const p of sorted) {
        if (out.some((o) => o.name === p.name && distance([o.lon, o.lat], [p.lon, p.lat]) < 60)) continue;
        out.push(p);
    }
    return out;
}

export interface NearbyOutcome { places: Place[]; category: Category | null; radiusKm: number }

/** Places of the kind (or name) around near, closest first: the smallest box with enough of them. */
export async function searchNearby(p: Providers, q: string, near: LngLat, signal?: AbortSignal,
                                   fetchJson: (url: string) => Promise<unknown> = defaultFetch(signal)): Promise<NearbyOutcome> {
    const category = categoryOf(q);
    const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").slice(0, 2);
    let places: Place[] = [], radiusKm = RADII[0];
    for (const km of RADII) {
        const url = nearbyUrl(p, q, near, km, lang);
        if (!url) break;
        // Nominatim allows one request a second.
        if (km !== RADII[0] && p.search.kind === "nominatim") await new Promise((r) => setTimeout(r, 1100));
        radiusKm = km;
        const json = await fetchJson(url);
        places = closest(p.search.kind === "photon" ? parsePhoton(json) : parseNominatim(json), near)
            // Photon lists a closed shop's leftover "vacant" tag too.
            .filter((x) => x.category !== "vacant");
        if (places.length >= ENOUGH) break;
    }
    return { places, category, radiusKm };
}

function defaultFetch(signal?: AbortSignal) {
    return async (url: string) => {
        const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`Search server: HTTP ${r.status}`);
        return r.json();
    };
}
