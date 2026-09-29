// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What other apps ask Maps to show, from its launch params:
//
// - {target: "geo:37.78,-122.41?z=15"} and "geo:0,0?q=1 Main St" (RFC 5870,
//   with the q= and z= parameters Android made common); the system hands
//   geo: links to Maps (compat/rootfs/usr/palm/command-resource-handlers.json).
// - {target: "maploc:ADDRESS"} and {target: "mapto:ADDRESS"}: webOS's own
//   schemes for "show" and "directions to" (Contacts and Calendar, see
//   third_party/core-apps .../PseudoDetailsInApp.js and LunaAppManager.js).
// - {address: "..."}: Contacts' and Calendar's launch of com.palm.app.maps,
//   and {route: {startAddress?, endAddress}}: Calendar's "Directions".
// - {query: "..."}: Just Type's "Search Maps"; {location: {lat, lon}}.
// - An openstreetmap.org or Google Maps link, e.g. from the browser.

export type Intent =
    | { kind: "show"; lat: number; lon: number; zoom?: number; label?: string }
    | { kind: "search"; query: string }
    | { kind: "directions"; to: string | { lat: number; lon: number; label?: string }; from?: string }
    | { kind: "place"; placeId: string }
    | { kind: "none" };

export interface MapsLaunchParams {
    target?: string;
    address?: string;
    query?: string;
    route?: { startAddress?: string; endAddress?: string };
    location?: { lat?: number; lon?: number; latitude?: number; longitude?: number; label?: string };
    placeId?: string;
}

const num = (s: string | null | undefined) => (s === null || s === undefined || s.trim() === "" ? NaN : Number(s));
const valid = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** geo:lat,lon[,alt][;params][?q=...&z=...] */
export function parseGeoUri(uri: string): Intent {
    const m = /^geo:([^?]*)(?:\?(.*))?$/i.exec(uri.trim());
    if (!m) return { kind: "none" };
    const [coords] = m[1].split(";");
    const [latS, lonS] = coords.split(",");
    const lat = num(decodeURIComponent(latS ?? "")), lon = num(decodeURIComponent(lonS ?? ""));
    // q is form-encoded: "+" is a space (as Android writes it).
    const qs = new URLSearchParams(m[2] ?? "");
    const q = qs.get("q")?.trim();
    const z = num(qs.get("z"));
    const zoom = Number.isFinite(z) ? Math.max(1, Math.min(21, z)) : undefined;
    if (q) {
        // geo:0,0?q=lat,lon(Label)
        const pt = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:\((.*)\))?\s*$/.exec(q);
        if (pt && valid(Number(pt[1]), Number(pt[2]))) return { kind: "show", lat: Number(pt[1]), lon: Number(pt[2]), zoom, label: pt[3] || undefined };
        return { kind: "search", query: q };
    }
    if (valid(lat, lon) && !(lat === 0 && lon === 0)) return { kind: "show", lat, lon, zoom };
    return { kind: "none" };
}

/** openstreetmap.org/#map=z/lat/lon, ?mlat=&mlon=; google.com/maps?q=; maps.google.com/?q= */
export function parseMapLink(url: string): Intent {
    let u: URL;
    try { u = new URL(url); } catch { return { kind: "none" }; }
    if (/(^|\.)openstreetmap\.org$/.test(u.hostname)) {
        const mlat = num(u.searchParams.get("mlat")), mlon = num(u.searchParams.get("mlon"));
        const hash = /map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(u.hash);
        if (valid(mlat, mlon)) return { kind: "show", lat: mlat, lon: mlon, zoom: hash ? Number(hash[1]) : undefined };
        if (hash) return { kind: "show", lat: Number(hash[2]), lon: Number(hash[3]), zoom: Number(hash[1]) };
        const q = u.searchParams.get("query");
        if (q) return { kind: "search", query: q };
    }
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && (u.hostname.startsWith("maps.") || u.pathname.startsWith("/maps"))) {
        const q = u.searchParams.get("q") ?? u.searchParams.get("query") ?? u.searchParams.get("daddr");
        if (q) return parseGeoUri(`geo:0,0?q=${encodeURIComponent(q)}`);
        const at = /@(-?[\d.]+),(-?[\d.]+),(\d+(?:\.\d+)?)z/.exec(u.pathname);
        if (at) return { kind: "show", lat: Number(at[1]), lon: Number(at[2]), zoom: Number(at[3]) };
    }
    return { kind: "none" };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").replace(/(, )+/g, ", ").trim();

export function parseLaunch(p: MapsLaunchParams | null | undefined): Intent {
    if (!p || typeof p !== "object") return { kind: "none" };
    if (p.placeId) return { kind: "place", placeId: p.placeId };
    if (p.route?.endAddress) {
        return { kind: "directions", to: oneLine(p.route.endAddress), from: p.route.startAddress ? oneLine(p.route.startAddress) : undefined };
    }
    if (p.location) {
        const lat = p.location.lat ?? p.location.latitude, lon = p.location.lon ?? p.location.longitude;
        if (lat !== undefined && lon !== undefined && valid(lat, lon)) return { kind: "show", lat, lon, label: p.location.label };
    }
    if (typeof p.address === "string" && p.address.trim()) return { kind: "search", query: oneLine(p.address) };
    if (typeof p.query === "string" && p.query.trim()) return { kind: "search", query: oneLine(p.query) };
    const t = typeof p.target === "string" ? p.target.trim() : "";
    if (!t) return { kind: "none" };
    if (/^geo:/i.test(t)) return parseGeoUri(t);
    const legacy = /^(maploc|mapto):(?:\/\/)?(.*)$/i.exec(t);
    if (legacy) {
        const text = oneLine(decodeURIComponent(legacy[2]));
        if (!text) return { kind: "none" };
        return legacy[1].toLowerCase() === "mapto" ? { kind: "directions", to: text } : { kind: "search", query: text };
    }
    if (/^https?:/i.test(t)) return parseMapLink(t);
    return { kind: "search", query: oneLine(t) };
}

// ---- Sharing -------------------------------------------------------------------------------------

/** A geo: URI (RFC 5870), readable by other phones' map apps. */
export function geoUri(lat: number, lon: number, label?: string): string {
    const base = `geo:${lat.toFixed(6)},${lon.toFixed(6)}`;
    return label ? `${base}?q=${lat.toFixed(6)},${lon.toFixed(6)}(${encodeURIComponent(label)})` : base;
}

/** A link anyone can open in a browser. */
export function osmLink(lat: number, lon: number, zoom = 17): string {
    return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=${Math.round(zoom)}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

export function shareText(name: string, detail: string, lat: number, lon: number): string {
    return [name, detail, osmLink(lat, lon)].filter(Boolean).join("\n");
}
