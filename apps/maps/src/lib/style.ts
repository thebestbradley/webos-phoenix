// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix map style: a MapLibre style over OpenMapTiles-schema vector
// tiles (https://openmaptiles.org/schema/), in the soft palette of the
// maps phones showed around webOS's time: cream land, blue water, white
// streets with grey casings, yellow and orange main roads. Original work
// (no third-party style is copied). The canvas renderer (canvasmap.ts)
// uses the same colours.
//
// Tiles come through the app's "phx://" protocol (tiles.ts decides where
// each tile comes from); glyphs too (bundled Noto Sans for Latin text, the
// provider's glyph server for other scripts).

import type { StyleSpecification, ExpressionSpecification, LayerSpecification } from "maplibre-gl";

export const COLORS = {
    land: "#f2efe6",
    water: "#a8cbe8",
    waterLine: "#86b2da",
    park: "#cfe5b4",
    wood: "#bcd9a0",
    residential: "#ece7dc",
    commercial: "#efe3dc",
    industrial: "#e7e2e9",
    building: "#e0d9cc",
    buildingLine: "#cbbfae",
    casing: "#b8b0a2",
    street: "#ffffff",
    tertiary: "#fffbe3",
    primary: "#fbdc86",
    primaryCasing: "#d7ac4a",
    motorway: "#f5a55c",
    motorwayCasing: "#c9793a",
    path: "#9c8f7c",
    rail: "#a9a39a",
    boundary: "#a88fb3",
    label: "#3d3a35",
    halo: "rgba(255,255,255,0.9)",
    poi: "#7b5d9e",
    route: "#2f7fd6",
    routeCasing: "#1d4f8a",
};

const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];

/** Interpolated line width by zoom, from [zoom, width] pairs. */
const width = (...stops: [number, number][]): ExpressionSpecification =>
    ["interpolate", ["exponential", 1.5], ["zoom"], ...stops.flat()] as ExpressionSpecification;

const cls = (...names: string[]): ExpressionSpecification => ["match", ["get", "class"], names, true, false] as ExpressionSpecification;

/** Points of interest: the most important first, more as you zoom in; bus stops only close in. */
const POI_FILTER = ["all",
    ["<=", ["get", "rank"], ["step", ["zoom"], 3, 16, 12, 17, 40]],
    ["any", [">=", ["zoom"], 18], ["!=", ["get", "class"], "bus"]],
] as ExpressionSpecification;

const name: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]] as ExpressionSpecification;

function roads(): LayerSpecification[] {
    const layers: LayerSpecification[] = [];
    const road = (id: string, filter: ExpressionSpecification, color: string, w: [number, number][], minzoom = 5, extra: Record<string, unknown> = {}) =>
        layers.push({
            id, type: "line", source: "omt", "source-layer": "transportation", minzoom,
            filter: ["all", filter, ["!=", ["get", "brunnel"], "tunnel"]] as ExpressionSpecification,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": color, "line-width": width(...w), ...extra },
        } as LayerSpecification);
    // Casings first, then fills, from small roads to big ones.
    road("road-minor-casing", cls("minor", "service"), COLORS.casing, [[12, 0.5], [14, 3], [18, 22]], 12);
    road("road-tertiary-casing", cls("tertiary", "secondary"), COLORS.casing, [[10, 0.8], [14, 5], [18, 28]], 9);
    road("road-primary-casing", cls("primary", "trunk"), COLORS.primaryCasing, [[7, 0.8], [14, 6.5], [18, 32]], 6);
    road("road-motorway-casing", cls("motorway"), COLORS.motorwayCasing, [[5, 0.8], [14, 7.5], [18, 36]], 5);
    road("road-path", cls("path", "track"), COLORS.path, [[14, 0.6], [18, 2]], 14, { "line-dasharray": [2, 1.5] });
    road("road-minor", cls("minor", "service"), COLORS.street, [[12, 0.3], [14, 2], [18, 19]], 12);
    road("road-tertiary", cls("tertiary", "secondary"), COLORS.tertiary, [[10, 0.5], [14, 3.8], [18, 25]], 9);
    road("road-primary", cls("primary", "trunk"), COLORS.primary, [[7, 0.5], [14, 5], [18, 29]], 6);
    road("road-motorway", cls("motorway"), COLORS.motorway, [[5, 0.5], [14, 6], [18, 33]], 5);
    road("rail", cls("rail", "transit"), COLORS.rail, [[10, 0.5], [16, 1.6]], 10, { "line-dasharray": [3, 2] });
    return layers;
}

export interface StyleOptions {
    /** Absolute base URL of the app (for nothing yet; the phx:// protocol resolves files). */
    attribution: string;
}

export function phoenixStyle(o: StyleOptions): StyleSpecification {
    return {
        version: 8,
        name: "Phoenix",
        glyphs: "phx://glyphs/{fontstack}/{range}",
        sources: {
            omt: { type: "vector", tiles: ["phx://tiles/{z}/{x}/{y}"], minzoom: 0, maxzoom: 14, attribution: o.attribution },
        },
        layers: [
            { id: "background", type: "background", paint: { "background-color": COLORS.land } },
            { id: "landuse-residential", type: "fill", source: "omt", "source-layer": "landuse", filter: cls("residential", "suburb", "neighbourhood"),
              paint: { "fill-color": COLORS.residential, "fill-opacity": 0.7 } },
            { id: "landuse-commercial", type: "fill", source: "omt", "source-layer": "landuse", filter: cls("commercial", "retail"),
              paint: { "fill-color": COLORS.commercial, "fill-opacity": 0.6 } },
            { id: "landuse-industrial", type: "fill", source: "omt", "source-layer": "landuse", filter: cls("industrial", "railway"),
              paint: { "fill-color": COLORS.industrial, "fill-opacity": 0.6 } },
            { id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wood", "forest"),
              paint: { "fill-color": COLORS.wood, "fill-opacity": 0.7 } },
            { id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("grass", "farmland", "wetland"),
              paint: { "fill-color": COLORS.park, "fill-opacity": 0.6 } },
            { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": COLORS.park, "fill-opacity": 0.8 } },
            { id: "water", type: "fill", source: "omt", "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"] as ExpressionSpecification,
              paint: { "fill-color": COLORS.water } },
            { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 8,
              paint: { "line-color": COLORS.water, "line-width": width([8, 0.5], [14, 2], [18, 6]) } },
            { id: "aeroway", type: "fill", source: "omt", "source-layer": "aeroway", minzoom: 11, filter: ["==", ["geometry-type"], "Polygon"] as ExpressionSpecification,
              paint: { "fill-color": "#e4e0ea" } },
            { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14,
              paint: { "fill-color": COLORS.building, "fill-outline-color": COLORS.buildingLine,
                       "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1] as ExpressionSpecification } },
            ...roads(),
            { id: "boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]] as ExpressionSpecification,
              paint: { "line-color": COLORS.boundary, "line-width": width([2, 0.6], [10, 1.6]), "line-dasharray": [3, 2] } },
            { id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 10,
              layout: { "text-field": name, "text-font": REGULAR, "text-size": 12, "symbol-placement": "point" },
              paint: { "text-color": "#3c6e9e", "text-halo-color": COLORS.halo, "text-halo-width": 1 } },
            { id: "waterway-name", type: "symbol", source: "omt", "source-layer": "waterway", minzoom: 14,
              layout: { "text-field": name, "text-font": REGULAR, "text-size": 11, "symbol-placement": "line" },
              paint: { "text-color": "#3c6e9e", "text-halo-color": COLORS.halo, "text-halo-width": 1 } },
            { id: "road-name", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 13,
              filter: ["!", cls("path", "track", "rail", "transit")] as ExpressionSpecification,
              layout: { "text-field": name, "text-font": REGULAR, "symbol-placement": "line", "text-rotation-alignment": "map",
                        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 13] as ExpressionSpecification },
              paint: { "text-color": COLORS.label, "text-halo-color": COLORS.halo, "text-halo-width": 1.4 } },
            { id: "road-shield", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 8, maxzoom: 15,
              filter: ["all", ["has", "ref"], cls("motorway", "trunk", "primary")] as ExpressionSpecification,
              layout: { "text-field": ["get", "ref"] as ExpressionSpecification, "text-font": BOLD, "text-size": 10, "symbol-placement": "line",
                        "symbol-spacing": 400, "text-rotation-alignment": "viewport" },
              paint: { "text-color": "#fff", "text-halo-color": COLORS.motorwayCasing, "text-halo-width": 3 } },
            { id: "housenumber", type: "symbol", source: "omt", "source-layer": "housenumber", minzoom: 17,
              layout: { "text-field": ["get", "housenumber"] as ExpressionSpecification, "text-font": REGULAR, "text-size": 10 },
              paint: { "text-color": "#8a8173" } },
            { id: "poi-dot", type: "circle", source: "omt", "source-layer": "poi", minzoom: 15,
              filter: POI_FILTER,
              paint: { "circle-radius": 3.5, "circle-color": COLORS.poi, "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 } },
            { id: "poi-label", type: "symbol", source: "omt", "source-layer": "poi", minzoom: 15,
              filter: POI_FILTER,
              layout: { "text-field": name, "text-font": REGULAR, "text-size": 11, "text-anchor": "left", "text-offset": [0.6, 0],
                        "text-max-width": 8, "text-optional": false },
              paint: { "text-color": COLORS.poi, "text-halo-color": COLORS.halo, "text-halo-width": 1.2 } },
            { id: "place-small", type: "symbol", source: "omt", "source-layer": "place", minzoom: 11,
              filter: cls("suburb", "neighbourhood", "quarter", "hamlet", "village"),
              layout: { "text-field": name, "text-font": BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 13] as ExpressionSpecification,
                        "text-transform": "uppercase", "text-letter-spacing": 0.1, "text-max-width": 7 },
              paint: { "text-color": "#6b645a", "text-halo-color": COLORS.halo, "text-halo-width": 1.5 } },
            { id: "place-city", type: "symbol", source: "omt", "source-layer": "place", filter: cls("city", "town"), maxzoom: 15,
              layout: { "text-field": name, "text-font": BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 12, 18] as ExpressionSpecification },
              paint: { "text-color": COLORS.label, "text-halo-color": COLORS.halo, "text-halo-width": 2 } },
            { id: "place-country", type: "symbol", source: "omt", "source-layer": "place", filter: cls("country", "state"), maxzoom: 8,
              layout: { "text-field": name, "text-font": BOLD, "text-size": 13, "text-transform": "uppercase" },
              paint: { "text-color": "#5d5670", "text-halo-color": COLORS.halo, "text-halo-width": 2 } },
        ],
    };
}
