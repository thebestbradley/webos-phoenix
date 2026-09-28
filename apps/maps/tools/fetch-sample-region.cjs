#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Downloads the demo map region Maps ships with (apps/maps/public/regions/
// sample): the OpenMapTiles vector tiles of downtown San Jose, zoom 0-14,
// from OpenFreeMap, and the Noto Sans glyphs the Phoenix map style labels
// with (apps/maps/public/fonts). The files are committed, so the simulator,
// the screenshots and tools/test-maps.cjs draw a real map without the
// network. Rerun only to refresh the data:
//
//   node apps/maps/tools/fetch-sample-region.cjs
//
// Data: (c) OpenStreetMap contributors, ODbL 1.0; tiles (c) OpenMapTiles
// (schema CC-BY 4.0) served by OpenFreeMap. Glyphs: Noto Sans, SIL Open
// Font License 1.1. See docs/LEGAL.md.

"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..", "public");
const REGION = {
    id: "sample",
    name: "Downtown San Jose (demo)",
    // west, south, east, north
    bounds: [-121.915, 37.320, -121.870, 37.350],
    // The world tile, for a view from afar, then the city (zooms 10-14;
    // the map overzooms 14 for closer views, as OpenMapTiles is made for).
    zooms: [0, 10, 11, 12, 13, 14],
    minzoom: 0,
    maxzoom: 14,
};
const TILEJSON = "https://tiles.openfreemap.org/planet";
const FONTS = "https://tiles.openfreemap.org/fonts";
const STACKS = ["Noto Sans Regular", "Noto Sans Bold"];
const RANGES = ["0-255", "256-511", "8192-8447"];
const UA = { "User-Agent": "webOS-Phoenix-Maps/0.1 (+https://github.com/thebestbradley/webos-phoenix)" };

function tileXY(lon, lat, z) {
    const n = 2 ** z;
    const r = (lat * Math.PI) / 180;
    return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
}

async function get(url) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

(async () => {
    const tj = JSON.parse((await get(TILEJSON)).toString());
    const template = tj.tiles[0];
    const out = path.join(ROOT, "regions", REGION.id);
    fs.rmSync(out, { recursive: true, force: true });
    let count = 0, bytes = 0;
    const [w, s, e, n] = REGION.bounds;
    for (const z of REGION.zooms) {
        const [x0, y0] = tileXY(w, n, z);
        const [x1, y1] = tileXY(e, s, z);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                // Stored gzipped, as in an MBTiles/PMTiles file; the app's
                // tile protocol (src/lib/offline.ts) inflates them.
                const data = zlib.gzipSync(await get(template.replace("{z}", z).replace("{x}", x).replace("{y}", y)), { level: 9 });
                const file = path.join(out, String(z), String(x), `${y}.pbf`);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, data);
                count++;
                bytes += data.length;
            }
        }
    }
    const meta = {
        ...REGION,
        center: [(w + e) / 2, (s + n) / 2],
        tiles: count,
        bytes,
        schema: "openmaptiles",
        source: TILEJSON,
        attribution: "© OpenMapTiles © OpenStreetMap contributors",
        fetched: new Date().toISOString().slice(0, 10),
    };
    fs.writeFileSync(path.join(out, "region.json"), JSON.stringify(meta, null, 4) + "\n");
    console.log(`region ${REGION.id}: ${count} tiles, ${(bytes / 1024).toFixed(0)} KiB`);

    for (const stack of STACKS) {
        for (const range of RANGES) {
            const data = await get(`${FONTS}/${encodeURIComponent(stack)}/${range}.pbf`);
            // Directory names without spaces: not every web server unescapes %20.
            const file = path.join(ROOT, "fonts", stack.replace(/\s+/g, "-"), `${range}.pbf`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, data);
        }
    }
    console.log(`glyphs: ${STACKS.join(", ")} (${RANGES.join(", ")})`);
})().catch((e) => { console.error(e); process.exit(1); });
