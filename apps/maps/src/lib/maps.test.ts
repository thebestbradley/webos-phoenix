// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Maps' pure pieces: geometry, launch params and geo: URIs, provider
// settings, search and routing replies, and navigation progress.

import { describe, expect, it } from "vitest";
import { bearing, decodePolyline, distance, formatDistance, formatDuration, lngLatToTile, nearestOnLine, tilesIn, turnAngle, type LngLat } from "./geo";
import { geoUri, osmLink, parseGeoUri, parseLaunch, parseMapLink } from "./launch";
import { ARRIVED_M, announcement, dueAnnouncement, progress, stepOffsets } from "./nav";
import { cleanUrl, DEFAULT_PROVIDERS, isValidUrl, mergeProviders } from "./providers";
import { instructionFor, modifierFromAngle, osrmUrl, parseOsrm, parseValhalla, valhallaUrl, type Route } from "./route";
import { parseCoords, parseNominatim, parsePhoton, searchUrl } from "./search";
import { findSaved, fromSaved, toSaved } from "./places";

describe("geometry", () => {
    it("measures distances and bearings", () => {
        // One degree of latitude is about 111 km.
        expect(distance([0, 0], [0, 1])).toBeCloseTo(111195, -2);
        expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
        expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
        expect(turnAngle(350, 10)).toBe(20);
        expect(turnAngle(10, 350)).toBe(-20);
    });

    it("finds the nearest point on a line", () => {
        const line: LngLat[] = [[0, 0], [0, 0.01], [0.01, 0.01]];
        const n = nearestOnLine(line, [0.0001, 0.005]);
        expect(n.index).toBe(0);
        expect(n.distance).toBeCloseTo(11, 0);
        expect(n.along).toBeCloseTo(556, -1);
    });

    it("maps points to tiles", () => {
        expect(lngLatToTile(0, 0, 1)).toEqual([1, 1]);
        expect(lngLatToTile(-121.8907, 37.3337, 14)).toEqual([2644, 6358]);
        expect(tilesIn([-121.915, 37.32, -121.87, 37.35], [14])).toHaveLength(6);
    });

    it("decodes polylines", () => {
        // Google's documented example, precision 5.
        expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
    });

    it("reads distances and times", () => {
        expect(formatDistance(120, "metric")).toBe("120 m");
        expect(formatDistance(2345, "metric")).toBe("2.3 km");
        expect(formatDistance(100, "imperial")).toBe("330 ft");
        expect(formatDistance(3218, "imperial")).toBe("2.0 mi");
        expect(formatDuration(50)).toBe("1 min");
        expect(formatDuration(3900)).toBe("1 h 5 min");
    });
});

describe("launch params", () => {
    it("reads geo: URIs", () => {
        expect(parseGeoUri("geo:37.786971,-122.399677")).toEqual({ kind: "show", lat: 37.786971, lon: -122.399677, zoom: undefined });
        expect(parseGeoUri("geo:37.78,-122.4;u=35?z=12")).toMatchObject({ kind: "show", lat: 37.78, lon: -122.4, zoom: 12 });
        expect(parseGeoUri("geo:0,0?q=1600+Amphitheatre+Parkway")).toEqual({ kind: "search", query: "1600 Amphitheatre Parkway" });
        expect(parseGeoUri("geo:0,0?q=34.99,-106.61(Treasure)")).toMatchObject({ kind: "show", lat: 34.99, lon: -106.61, label: "Treasure" });
        expect(parseGeoUri("geo:0,0")).toEqual({ kind: "none" });
        expect(parseGeoUri("geo:95,0")).toEqual({ kind: "none" });
    });

    it("reads the launches of the webOS apps", () => {
        // Contacts: {address}; Calendar: {address} or {route: {endAddress}}.
        expect(parseLaunch({ address: "100 Market Street\nSan Jose, CA" })).toEqual({ kind: "search", query: "100 Market Street, San Jose, CA" });
        expect(parseLaunch({ route: { endAddress: "42 Lakeview Avenue" } })).toEqual({ kind: "directions", to: "42 Lakeview Avenue", from: undefined });
        expect(parseLaunch({ target: "maploc:7 Orchard Lane, New York" })).toEqual({ kind: "search", query: "7 Orchard Lane, New York" });
        expect(parseLaunch({ target: "mapto://Bistro Verde" })).toEqual({ kind: "directions", to: "Bistro Verde" });
        expect(parseLaunch({ target: "geo:1,2" })).toMatchObject({ kind: "show", lat: 1, lon: 2 });
        expect(parseLaunch({ query: "coffee" })).toEqual({ kind: "search", query: "coffee" });
        expect(parseLaunch({ location: { latitude: 10, longitude: 20 } })).toMatchObject({ kind: "show", lat: 10, lon: 20 });
        expect(parseLaunch({ placeId: "abc" })).toEqual({ kind: "place", placeId: "abc" });
        expect(parseLaunch({})).toEqual({ kind: "none" });
        expect(parseLaunch(null)).toEqual({ kind: "none" });
    });

    it("reads map links", () => {
        expect(parseMapLink("https://www.openstreetmap.org/?mlat=37.33&mlon=-121.89#map=17/37.33/-121.89")).toMatchObject({ kind: "show", lat: 37.33, lon: -121.89, zoom: 17 });
        expect(parseMapLink("https://www.openstreetmap.org/#map=12/51.5/-0.12")).toMatchObject({ kind: "show", lat: 51.5, lon: -0.12, zoom: 12 });
        expect(parseMapLink("https://maps.google.com/?q=Eiffel+Tower")).toEqual({ kind: "search", query: "Eiffel Tower" });
        expect(parseMapLink("https://www.google.com/maps/@48.85,2.29,15z")).toMatchObject({ kind: "show", lat: 48.85, lon: 2.29, zoom: 15 });
        expect(parseMapLink("https://example.com/")).toEqual({ kind: "none" });
    });

    it("makes links to share", () => {
        expect(geoUri(37.3337, -121.8907)).toBe("geo:37.333700,-121.890700");
        expect(geoUri(1, 2, "A & B")).toBe("geo:1.000000,2.000000?q=1.000000,2.000000(A%20%26%20B)");
        expect(osmLink(37.3337, -121.8907)).toBe("https://www.openstreetmap.org/?mlat=37.333700&mlon=-121.890700#map=17/37.33370/-121.89070");
        const back = parseMapLink(osmLink(37.3337, -121.8907));
        expect(back).toMatchObject({ kind: "show", lat: 37.3337, lon: -121.8907 });
    });
});

describe("providers", () => {
    it("merges overrides over the defaults", () => {
        const p = mergeProviders(DEFAULT_PROVIDERS, { search: { kind: "nominatim", url: "https://geo.example.org" }, renderer: "canvas" });
        expect(p.search).toEqual({ kind: "nominatim", url: "https://geo.example.org" });
        expect(p.tiles).toEqual(DEFAULT_PROVIDERS.tiles);
        expect(p.renderer).toBe("canvas");
        expect(mergeProviders(DEFAULT_PROVIDERS, null)).toBe(DEFAULT_PROVIDERS);
    });

    it("defaults to keyless services whose terms allow an OS's users", () => {
        expect(DEFAULT_PROVIDERS.tiles.url).toMatch(/openfreemap\.org/);
        expect(DEFAULT_PROVIDERS.search.kind).toBe("photon");
        expect(DEFAULT_PROVIDERS.routing).toMatchObject({ kind: "valhalla", clientId: expect.any(String) });
        // Never the OSM Foundation's tile servers (their policy forbids apps' heavy use).
        expect(JSON.stringify(DEFAULT_PROVIDERS)).not.toMatch(/tile\.openstreetmap\.org/);
    });

    it("checks server addresses", () => {
        expect(isValidUrl("https://maps.example.org/planet")).toBe(true);
        expect(isValidUrl("pmtiles://https://maps.example.org/city.pmtiles")).toBe(true);
        expect(isValidUrl("ftp://x")).toBe(false);
        expect(isValidUrl("not a url")).toBe(false);
        expect(cleanUrl(" https://a.example/ ")).toBe("https://a.example");
    });
});

describe("search replies", () => {
    it("reads Photon", () => {
        const places = parsePhoton({ features: [
            { geometry: { coordinates: [-121.8907, 37.3337] }, properties: { osm_type: "N", osm_id: 1, osm_key: "tourism", osm_value: "museum", type: "house",
              name: "San José Museum of Art", housenumber: "110", street: "South Market Street", city: "San Jose", state: "California", country: "United States" } },
            { geometry: { coordinates: [-121.89, 37.33] }, properties: { osm_type: "W", osm_id: 2, type: "street", name: "Market Street", city: "San Jose" } },
        ] });
        expect(places[0]).toMatchObject({ name: "San José Museum of Art", detail: "110 South Market Street, San Jose, California, United States", kind: "poi", category: "museum", lon: -121.8907 });
        expect(places[1]).toMatchObject({ name: "Market Street", kind: "street" });
    });

    it("reads Nominatim", () => {
        const places = parseNominatim([{ osm_type: "way", osm_id: 3, lat: "37.3", lon: "-121.9", name: "", addresstype: "building",
            display_name: "100, South Market Street, San Jose, California, 95113, United States", address: { house_number: "100", road: "South Market Street" } }]);
        expect(places[0]).toMatchObject({ name: "100 South Market Street", kind: "address", lat: 37.3, lon: -121.9 });
        expect(places[0].detail).toBe("South Market Street, San Jose, California, 95113");
    });

    it("builds request URLs, never for offline", () => {
        const near: LngLat = [-121.89, 37.33];
        expect(searchUrl(DEFAULT_PROVIDERS, "a b", near)).toBe("https://photon.komoot.io/api?q=a%20b&limit=10&lang=en&lat=37.3300&lon=-121.8900");
        const nom = mergeProviders(DEFAULT_PROVIDERS, { search: { kind: "nominatim", url: "https://nominatim.openstreetmap.org" } });
        expect(searchUrl(nom, "x")).toContain("/search?q=x&format=jsonv2");
        expect(searchUrl(mergeProviders(DEFAULT_PROVIDERS, { search: { kind: "offline" } }), "x")).toBeNull();
    });

    it("recognises coordinates", () => {
        expect(parseCoords("37.3337, -121.8907")).toEqual([-121.8907, 37.3337]);
        expect(parseCoords("Market Street")).toBeNull();
    });
});

describe("routing replies", () => {
    // A trimmed Valhalla reply (FOSSGIS server), downtown San Jose.
    const valhalla = {
        trip: {
            summary: { length: 0.527, time: 153.809 },
            legs: [{
                shape: "{jtefA~zrngFk@ZoAz@qS|Mk@`@qK`HmM~IoBrAcBfA_LvHcOzJmOhKaEnCeEvCwP~K}AbAgTdOxBfGPh@b@pAt@xB|ChJz@hCpAcA~@mB?yAoCaHcAg@m@?eAViA~@pDxK|CdJu]hV",
                maneuvers: [
                    { type: 1, instruction: "Drive northwest on South Market Street.", street_names: ["South Market Street"], length: 0.328, time: 33.6, begin_shape_index: 0 },
                    { type: 15, instruction: "Turn left.", length: 0.051, time: 53.8, begin_shape_index: 16 },
                    { type: 15, instruction: "Turn left.", length: 0.148, time: 66.4, begin_shape_index: 22 },
                    { type: 6, instruction: "Your destination is on the left.", length: 0, time: 0, begin_shape_index: 33 },
                ],
            }],
        },
    };

    it("reads Valhalla", () => {
        const r = parseValhalla(valhalla, "drive");
        expect(r.provider).toBe("Valhalla");
        expect(r.distance).toBeCloseTo(527);
        expect(r.geometry[0][0]).toBeCloseTo(-121.8907, 3);
        expect(r.geometry[0][1]).toBeCloseTo(37.3337, 3);
        expect(r.steps.map((s) => [s.kind, s.modifier])).toEqual([["depart", undefined], ["turn", "left"], ["turn", "left"], ["arrive", undefined]]);
        expect(r.steps[0].instruction).toBe("Drive northwest on South Market Street");
        expect(r.steps[1].location).toEqual(r.geometry[16]);
    });

    it("reads OSRM and writes its instructions", () => {
        const r = parseOsrm({ code: "Ok", routes: [{ distance: 100, duration: 20,
            geometry: { coordinates: [[0, 0], [0, 0.0005], [0.0005, 0.0005]] },
            legs: [{ steps: [
                { name: "A Street", distance: 55, duration: 10, maneuver: { type: "depart", location: [0, 0] }, geometry: { coordinates: [] } },
                { name: "B Avenue", distance: 45, duration: 10, maneuver: { type: "turn", modifier: "right", location: [0, 0.0005] }, geometry: { coordinates: [] } },
                { name: "", distance: 0, duration: 0, maneuver: { type: "arrive", location: [0.0005, 0.0005] }, geometry: { coordinates: [] } },
            ] }] }] }, "walk");
        expect(r.steps.map((s) => s.instruction)).toEqual(["Walk along A Street", "Turn right onto B Avenue", "You have arrived at your destination"]);
        expect(r.steps[1].index).toBe(1);
    });

    it("builds request URLs", () => {
        expect(valhallaUrl("https://v.example", [1, 2], [3, 4], "cycle")).toContain(encodeURIComponent('"costing":"bicycle"'));
        expect(osrmUrl("https://routing.openstreetmap.de", [1, 2], [3, 4], "walk"))
            .toBe("https://routing.openstreetmap.de/routed-foot/route/v1/foot/1,2;3,4?overview=full&geometries=geojson&steps=true");
        expect(osrmUrl("https://osrm.example", [1, 2], [3, 4], "drive")).toContain("https://osrm.example/route/v1/driving/");
    });

    it("words turns", () => {
        expect(modifierFromAngle(5)).toBe("straight");
        expect(modifierFromAngle(-40)).toBe("slight left");
        expect(modifierFromAngle(95)).toBe("right");
        expect(modifierFromAngle(170)).toBe("uturn");
        expect(instructionFor({ kind: "turn", modifier: "sharp left", name: "Elm St" }, "drive")).toBe("Turn sharp left onto Elm St");
    });
});

describe("navigation", () => {
    // Straight north for ~1.1 km, then east ~0.9 km.
    const route: Route = {
        mode: "drive", distance: 2000, duration: 200, provider: "test",
        geometry: [[0, 0], [0, 0.01], [0.008, 0.01]],
        steps: [
            { kind: "depart", name: "North Road", instruction: "Drive north on North Road", distance: 1112, duration: 111, location: [0, 0], index: 0 },
            { kind: "turn", modifier: "right", name: "East Road", instruction: "Turn right onto East Road", distance: 890, duration: 89, location: [0, 0.01], index: 1 },
            { kind: "arrive", name: "", instruction: "You have arrived at your destination", distance: 0, duration: 0, location: [0.008, 0.01], index: 2 },
        ],
    };
    const offsets = stepOffsets(route);

    it("tracks the next maneuver", () => {
        const p = progress(route, [0, 0.005], offsets);
        expect(p.step).toBe(0);
        expect(p.toNext).toBeCloseTo(556, -1);
        expect(p.offRoute).toBe(false);
        const q = progress(route, [0.004, 0.01], offsets);
        expect(q.step).toBe(1);
        expect(q.arrived).toBe(false);
    });

    it("notices leaving the route and arriving", () => {
        expect(progress(route, [0.002, 0.005], offsets).offRoute).toBe(true);
        const end = progress(route, [0.008, 0.0101], offsets);
        expect(distance([0.008, 0.0101], [0.008, 0.01])).toBeLessThan(ARRIVED_M);
        expect(end.arrived).toBe(true);
    });

    it("says each announcement once", () => {
        const said = new Set<string>();
        const far = progress(route, [0, 0.004], offsets);
        expect(dueAnnouncement(route, far, "metric", said)).toMatch(/^In 6[67][05] metres, turn right onto East Road$/);
        expect(dueAnnouncement(route, far, "metric", said)).toBeNull();
        const near = progress(route, [0, 0.0095], offsets);
        expect(dueAnnouncement(route, near, "metric", said)).toMatch(/^In (55|60) metres, turn right onto East Road$/);
        expect(dueAnnouncement(route, near, "metric", said)).toBeNull();
        expect(announcement(route.steps[1], 20, "imperial")).toBe("Turn right onto East Road");
    });
});

describe("saved places", () => {
    it("round-trips through db8 objects", () => {
        const s = { ...toSaved({ id: "x", name: "Home", detail: "1 Main St", lon: 1, lat: 2, kind: "address" }, 5), _id: "abc" };
        expect(s).toMatchObject({ _kind: "org.webosphoenix.maps.place:1", created: 5, searchText: "home 1 main st" });
        expect(fromSaved(s)).toMatchObject({ id: "saved:abc", name: "Home", kind: "saved", lon: 1, lat: 2 });
        expect(findSaved([s], { lon: 1.000001, lat: 2, name: "x" })).toBe(s);
        expect(findSaved([s], { lon: 1.1, lat: 2, name: "x" })).toBeUndefined();
    });
});
