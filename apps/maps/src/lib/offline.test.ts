// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The offline search index and router over the demo region's real tiles
// (public/regions/sample, downtown San Jose).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { distance, type LngLat } from "./geo";
import { buildGraph, buildIndex, routeOffline, searchIndex, tokens, type TileRef } from "./offline";

const DIR = join(__dirname, "../../public/regions/sample/14");
const tiles: TileRef[] = readdirSync(DIR).flatMap((x) => readdirSync(join(DIR, x)).map((f) => {
    const buf = gunzipSync(readFileSync(join(DIR, x, f)));
    return { z: 14, x: Number(x), y: Number(f.replace(".pbf", "")), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
}));

// Plaza de César Chávez and the San Jose Museum of Art, a few blocks apart.
const PLAZA: LngLat = [-121.8907, 37.3337];
const CITY_HALL: LngLat = [-121.8853, 37.3377];

describe("tokens", () => {
    it("folds case and accents and spells out abbreviations", () => {
        expect(tokens("100 S. Market St")).toEqual(["100", "south", "market", "street"]);
        expect(tokens("César Chávez")).toEqual(["cesar", "chavez"]);
    });
});

describe("offline search", () => {
    const index = buildIndex(tiles);

    it("indexes places, streets and addresses", () => {
        expect(index.length).toBeGreaterThan(500);
        expect(index.some((e) => e.kind === "street" && e.name === "South Market Street")).toBe(true);
        expect(index.some((e) => e.kind === "address")).toBe(true);
        expect(index.some((e) => e.kind === "place" && e.name === "San Jose")).toBe(true);
    });

    it("finds a street from part of its name", () => {
        const hits = searchIndex(index, "market st", PLAZA);
        expect(hits[0].name).toMatch(/Market Street/);
        expect(distance(PLAZA, [hits[0].lon, hits[0].lat])).toBeLessThan(2000);
    });

    it("finds a point of interest by a word it starts with", () => {
        const hits = searchIndex(index, "museum", PLAZA);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h) => /museum/i.test(h.name))).toBe(true);
    });

    it("finds the street of an address from Contacts", () => {
        const hits = searchIndex(index, "100 Market Street, San Jose, CA 95113", PLAZA);
        expect(hits[0].kind).toMatch(/street|address/);
        expect(hits[0].name).toMatch(/Market Street$/);
    });

    it("finds nothing for nonsense", () => {
        expect(searchIndex(index, "zzzqqq")).toEqual([]);
    });
});

describe("offline routing", () => {
    const graph = buildGraph(tiles);

    it("builds a connected road graph", () => {
        expect(graph.nodes.length).toBeGreaterThan(1000);
    });

    for (const mode of ["drive", "walk", "cycle"] as const) {
        it(`routes across downtown (${mode})`, () => {
            const r = routeOffline(graph, PLAZA, CITY_HALL, mode);
            const straight = distance(PLAZA, CITY_HALL);
            expect(r.distance).toBeGreaterThan(straight * 0.9);
            expect(r.distance).toBeLessThan(straight * 3);
            expect(r.steps[0].kind).toBe("depart");
            expect(r.steps[r.steps.length - 1].kind).toBe("arrive");
            expect(r.steps.length).toBeGreaterThan(2);
            expect(r.steps.some((s) => /Street|Avenue|Boulevard|Paseo|Plaza/.test(s.name))).toBe(true);
            expect(r.duration).toBeGreaterThan(0);
        });
    }

    it("walking takes longer than driving", () => {
        const walk = routeOffline(graph, PLAZA, CITY_HALL, "walk");
        const drive = routeOffline(graph, PLAZA, CITY_HALL, "drive");
        expect(walk.duration).toBeGreaterThan(drive.duration);
    });
});
