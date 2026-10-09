// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// More about a place the user opened: its opening hours, phone and website
// from its OpenStreetMap tags, through the Overpass API (one request, for
// the place shown only):
//
//   POST {url}  data=[out:json][timeout:10];node(123);out tags;
//   -> {elements: [{type, id, tags: {opening_hours, phone, website, ...}}]}
//
// Search results carry the OSM element they came from (Photon's osm_type
// and osm_id, Nominatim's): "photon:N123", "nominatim:way456".
//
// opening_hours (https://wiki.openstreetmap.org/wiki/Key:opening_hours) is
// read for "open now" in its common forms: "24/7", "Mo-Fr 07:00-19:00;
// Sa,Su 08:00-17:00", "Mo-Su 06:30-22:00", "Tu off" (holiday rules, "PH
// off", left out: the device does not know the holidays); a later rule replaces
// an earlier one for the days it names, as the specification says. Anything
// else is shown as written, without "open now".

import type { Providers } from "./providers";
import type { Place } from "./search";

export interface PlaceDetails {
    hours?: string;
    /** true/false when the hours say; undefined when they cannot be read. */
    openNow?: boolean;
    phone?: string;
    website?: string;
    cuisine?: string;
}

/** The OSM element a result came from, or null. */
export function osmElement(p: Pick<Place, "id">): { type: "node" | "way" | "relation"; id: number } | null {
    const m = /^(?:photon|nominatim):(N|W|R|node|way|relation)(\d+)$/i.exec(p.id);
    if (!m) return null;
    const t = m[1].toLowerCase();
    return { type: t === "n" || t === "node" ? "node" : t === "w" || t === "way" ? "way" : "relation", id: Number(m[2]) };
}

export function overpassQuery(el: { type: string; id: number }): string {
    return `[out:json][timeout:10];${el.type}(${el.id});out tags;`;
}

export function detailsFromTags(tags: Record<string, string> | undefined, now = new Date()): PlaceDetails {
    if (!tags) return {};
    const d: PlaceDetails = {};
    const hours = tags.opening_hours?.trim();
    if (hours) {
        d.hours = hours;
        const open = openAt(hours, now);
        if (open !== null) d.openNow = open;
    }
    const phone = tags.phone ?? tags["contact:phone"];
    if (phone) d.phone = phone.split(";")[0].trim();
    const web = tags.website ?? tags["contact:website"];
    if (web && /^https?:\/\//i.test(web)) d.website = web;
    if (tags.cuisine) d.cuisine = tags.cuisine.split(";").map((c) => c.replace(/_/g, " ")).join(", ");
    return d;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function dayList(spec: string): number[] | null {
    const out: number[] = [];
    for (const part of spec.split(",")) {
        const r = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
        if (!r) return null;
        const a = DAYS.indexOf(r[1]), b = r[2] ? DAYS.indexOf(r[2]) : a;
        for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; }
    }
    return out;
}

const minutes = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/** Whether the place is open at a time by its opening_hours, or null when they cannot be read. */
export function openAt(hours: string, at: Date): boolean | null {
    const h = hours.trim();
    if (h === "24/7") return true;
    // Per day (0 = Monday): the spans [from, to) in minutes; to may pass midnight.
    const week: ([number, number][] | undefined)[] = new Array(7).fill(undefined);
    for (const raw of h.split(";")) {
        const rule = raw.trim();
        // Public holidays ("PH off"): not known here, so not applied.
        if (!rule || /^PH\b/.test(rule)) continue;
        const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/.exec(rule);
        if (!m) return null;
        const days = m[1] ? dayList(m[1]) : [0, 1, 2, 3, 4, 5, 6];
        const times = m[2].trim();
        if (!days) return null;
        let spans: [number, number][];
        if (/^(?:off|closed)$/i.test(times)) spans = [];
        else if (times === "24/7" || times === "00:00-24:00") spans = [[0, 1440]];
        else {
            spans = [];
            for (const t of times.split(",")) {
                const r = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(t.trim());
                if (!r) return null;
                const a = minutes(r[1]);
                let b = minutes(r[2]);
                if (b <= a) b += 1440;
                spans.push([a, b]);
            }
        }
        for (const d of days) week[d] = spans;
    }
    const day = (at.getDay() + 6) % 7, now = at.getHours() * 60 + at.getMinutes();
    const today = week[day] ?? [], yesterday = week[(day + 6) % 7] ?? [];
    return today.some(([a, b]) => now >= a && now < b) || yesterday.some(([, b]) => b > 1440 && now < b - 1440);
}

/** Readable hours: "Mo-Fr 07:00-19:00; Sa 08:00-17:00" -> "Mon–Fri 7:00–19:00 · Sat 8:00–17:00". */
export function hoursText(hours: string): string {
    const names: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "Holidays" };
    return hours.split(";").map((r) => r.trim()).filter(Boolean)
        .map((r) => r.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => names[d]).replace(/(\d)-(\d)/g, "$1–$2").replace(/([a-z])-([A-Z])/g, "$1–$2")
            .replace(/\b0(\d):/g, "$1:"))
        .join(" · ");
}

const cache = new Map<string, PlaceDetails>();

export async function placeDetails(p: Providers, place: Place, signal?: AbortSignal): Promise<PlaceDetails> {
    const el = osmElement(place);
    if (!el || p.details.kind !== "overpass" || !p.details.url) return {};
    const key = `${el.type}${el.id}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const r = await fetch(p.details.url, {
        method: "POST", signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: "data=" + encodeURIComponent(overpassQuery(el)),
    });
    if (!r.ok) throw new Error(`Details server: HTTP ${r.status}`);
    const json = (await r.json()) as { elements?: { tags?: Record<string, string> }[] };
    const d = detailsFromTags(json.elements?.[0]?.tags);
    cache.set(key, d);
    return d;
}
