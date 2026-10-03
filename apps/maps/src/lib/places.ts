// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Saved places, in db8 (org.webosphoenix.maps.place:1, see
// public/configuration/db/kinds), so they back up with the rest of the
// user's data and Just Type finds them (appinfo.json "dbsearch" opens
// Maps with {placeId}).

import { db, type DbObject, type Subscription } from "@phoenix/luna";
import type { Place } from "./search";

export const PLACE_KIND = "org.webosphoenix.maps.place:1";

export interface SavedPlace extends DbObject {
    name: string;
    detail: string;
    lon: number;
    lat: number;
    category?: string;
    created: number;
    /** Name and detail, lower-case, for Just Type. */
    searchText: string;
}

export function toSaved(p: Place, now = Date.now()): SavedPlace {
    return {
        _kind: PLACE_KIND, name: p.name, detail: p.detail, lon: p.lon, lat: p.lat, category: p.category, created: now,
        searchText: `${p.name} ${p.detail}`.toLowerCase(),
    };
}

export function fromSaved(s: SavedPlace): Place {
    return { id: `saved:${s._id}`, name: s.name, detail: s.detail, lon: s.lon, lat: s.lat, kind: "saved", category: s.category };
}

/** The saved place at (about) the same spot as p, if any. */
export function findSaved(list: readonly SavedPlace[], p: Pick<Place, "lon" | "lat" | "name">): SavedPlace | undefined {
    return list.find((s) => Math.abs(s.lon - p.lon) < 1e-5 && Math.abs(s.lat - p.lat) < 1e-5);
}

export const places = {
    watch(cb: (list: SavedPlace[]) => void): Subscription {
        return db.watch<SavedPlace>({ from: PLACE_KIND, orderBy: "created", desc: true }, cb, () => cb([]));
    },
    async save(p: Place): Promise<string> {
        const [r] = await db.put([toSaved(p)]);
        return r?.id ?? "";
    },
    async rename(id: string, name: string): Promise<void> {
        const [cur] = await db.get<SavedPlace>([id]);
        if (!cur) return;
        await db.merge([{ _id: id, name, searchText: `${name} ${cur.detail}`.toLowerCase() }]);
    },
    async remove(id: string): Promise<void> {
        await db.del([id]);
    },
    async get(id: string): Promise<SavedPlace | undefined> {
        return (await db.get<SavedPlace>([id]))[0];
    },
};
