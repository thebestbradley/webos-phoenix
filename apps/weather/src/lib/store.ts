// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What Weather keeps on the device, in its localStorage (nothing leaves
// it): the saved places in their order, the place shown, the last
// forecast of each (the offline cache) and the preferences.

import { DEFAULT_SERVER, type Forecast, type Place } from "./openmeteo";
import type { UnitsPref } from "./units";

/** A forecast older than this is fetched again when it is shown. */
export const STALE_MS = 30 * 60 * 1000;
/** Shown offline, but not older than this: past it a forecast is no forecast. */
export const EXPIRED_MS = 3 * 24 * 60 * 60 * 1000;

export const CURRENT_ID = "current";

export interface Prefs {
    units: UnitsPref;
    /** Include "Current Location" (asks com.webos.service.location). */
    useLocation: boolean;
    /** Forecast server (Open-Meteo API compatible). */
    server: string;
}

export const DEFAULT_PREFS: Prefs = { units: "auto", useLocation: true, server: DEFAULT_SERVER };

export interface State {
    places: Place[];
    selected: string | null;
    cache: Record<string, Forecast>;
    prefs: Prefs;
}

const KEY = "org.webosphoenix.weather";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function load(storage: Storage | undefined = globalThis.localStorage): State {
    let raw: Partial<State> = {};
    try { raw = JSON.parse(storage?.getItem(KEY) ?? "{}") ?? {}; } catch { raw = {}; }
    const places = Array.isArray(raw.places)
        ? raw.places.filter((p): p is Place => !!p && typeof p.id === "string" && typeof p.name === "string"
            && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        : [];
    const p: Partial<Prefs> = raw.prefs ?? {};
    const prefs: Prefs = {
        units: p.units === "metric" || p.units === "imperial" ? p.units : "auto",
        useLocation: p.useLocation !== false,
        server: typeof p.server === "string" && /^https?:\/\/\S+$/.test(p.server) ? p.server : DEFAULT_SERVER,
    };
    const cache = raw.cache && typeof raw.cache === "object" ? raw.cache : {};
    return { places, selected: typeof raw.selected === "string" ? raw.selected : null, cache, prefs };
}

export function save(s: State, storage: Storage | undefined = globalThis.localStorage): void {
    // Only cache what is still a saved place.
    const ids = new Set(s.places.map((p) => p.id));
    const cache = Object.fromEntries(Object.entries(s.cache).filter(([id]) => ids.has(id)));
    try { storage?.setItem(KEY, JSON.stringify({ ...s, cache })); } catch { /* full or private mode: stay in memory */ }
}

/** Add a place (or move an existing one with the same id or coordinates to the end); returns the new list. */
export function addPlace(places: readonly Place[], p: Place): Place[] {
    const same = (q: Place) => q.id === p.id || (Math.abs(q.latitude - p.latitude) < 0.01 && Math.abs(q.longitude - p.longitude) < 0.01 && q.id !== CURRENT_ID);
    if (p.id !== CURRENT_ID && places.some(same)) return [...places];
    return p.id === CURRENT_ID ? [p, ...places.filter((q) => q.id !== CURRENT_ID)] : [...places, p];
}

export function removePlace(places: readonly Place[], id: string): Place[] {
    return places.filter((p) => p.id !== id);
}

/** Move a place one step up (-1) or down (+1). */
export function movePlace(places: readonly Place[], id: string, by: -1 | 1): Place[] {
    const i = places.findIndex((p) => p.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= places.length) return [...places];
    const out = [...places];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

export type Freshness = "fresh" | "stale" | "expired" | "none";

export function freshness(f: Forecast | undefined, now: number): Freshness {
    if (!f) return "none";
    const age = now - f.fetchedAt;
    return age < STALE_MS ? "fresh" : age < EXPIRED_MS ? "stale" : "expired";
}
