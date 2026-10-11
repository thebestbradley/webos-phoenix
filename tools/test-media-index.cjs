#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulated media indexer's extra metadata for a picture
// (com.webos.service.mediaindexer getImageMetadata; runtime/phoenix-runtime.js,
// "A picture's EXIF"), in headless Chromium: a JPEG with an EXIF block
// (written little-endian, and big-endian) is stored, scanned and asked for:
//
//   - getImageList gives the basic fields only, as OSE's (mediadb.cpp:872-884);
//   - getImageMetadata adds date_of_creation and geo_location_* as OSE's
//     indexer reads them through libexif (imageextractor.cpp:23-29, 313-345):
//     "2026:10:06 10:00:00", "N 52, 31, 12.00", "W  0,  7, 39.50", the
//     country and city empty;
//   - a picture without EXIF (a sample photo): every one empty.
//
//   node tools/test-media-index.cjs

"use strict";
const { spawn, execSync } = require("child_process");
const path = require("path");

async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await sleep(100);
    }
    throw new Error("server did not start");
}

// An APP1 segment with EXIF: IFD0's DateTime and a GPS IFD with the
// latitude and longitude, their references, in either byte order.
function exifSegment(littleEndian) {
    const tiff = Buffer.alloc(160);
    const u16 = (o, v) => (littleEndian ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
    const u32 = (o, v) => (littleEndian ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
    tiff.write(littleEndian ? "II" : "MM", 0, "latin1");
    u16(2, 42);
    u32(4, 8);
    const entry = (o, tag, type, count, value) => { u16(o, tag); u16(o + 2, type); u32(o + 4, count); u32(o + 8, value); };
    // IFD0 at 8: DateTime (ASCII 20 at 38), GPS IFD pointer (58).
    u16(8, 2);
    entry(10, 0x0132, 2, 20, 38);
    entry(22, 0x8825, 4, 1, 58);
    u32(34, 0);
    tiff.write("2026:10:06 10:00:00\0", 38, "latin1");
    // GPS IFD at 58: N, 52/1 31/1 1200/100 (at 112); W, 0/1 7/1 3950/100 (at 136).
    u16(58, 4);
    entry(60, 1, 2, 2, 0); tiff.write("N\0", 68, "latin1");
    entry(72, 2, 5, 3, 112);
    entry(84, 3, 2, 2, 0); tiff.write("W\0", 92, "latin1");
    entry(96, 4, 5, 3, 136);
    u32(108, 0);
    [[52, 1], [31, 1], [1200, 100]].forEach(([n, d], i) => { u32(112 + i * 8, n); u32(116 + i * 8, d); });
    [[0, 1], [7, 1], [3950, 100]].forEach(([n, d], i) => { u32(136 + i * 8, n); u32(140 + i * 8, d); });
    const head = Buffer.from([0xFF, 0xE1, 0, 0]);
    head.writeUInt16BE(2 + 6 + tiff.length, 2);
    return Buffer.concat([head, Buffer.from("Exif\0\0", "latin1"), tiff]);
}

async function main() {
    const { chromium } = loadPlaywright();
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const page = await (await browser.newContext()).newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${origin}/usr/palm/applications/org.webosphoenix.settings/index.html`);
        await page.waitForFunction(() => window.__phoenixRuntime, null, { timeout: 20000 });
        const call = (url, params) => page.evaluate(([u, p]) => new Promise((r) => __phoenixRuntime.dispatch(u, p, r, { cancelled: () => false })), [url, params]);
        const M = "luna://com.webos.service.mediaindexer/";

        // A small JPEG drawn in the page, with the EXIF block after its SOI.
        const plain = Buffer.from(await page.evaluate(() => new Promise((resolve) => {
            const c = document.createElement("canvas");
            c.width = 64; c.height = 48;
            const g = c.getContext("2d");
            g.fillStyle = "#3a6"; g.fillRect(0, 0, 64, 48);
            c.toBlob((b) => b.arrayBuffer().then((a) => resolve(Array.from(new Uint8Array(a)))), "image/jpeg", 0.9);
        })));
        const results = {};
        for (const [name, le] of [["exif-le.jpg", true], ["exif-be.jpg", false]]) {
            const jpeg = Buffer.concat([plain.subarray(0, 2), exifSegment(le), plain.subarray(2)]);
            const p = `/media/internal/DCIM/100PHNX/${name}`;
            const w = await call("luna://org.webosphoenix.service.mediafiles/write", { path: p, data: jpeg.toString("base64"), mimeType: "image/jpeg" });
            check(w.returnValue !== false, `${name}: stored`);
            await call(M + "requestMediaScan", { path: "/media/internal/DCIM" });
            const list = (await call(M + "getImageList", {})).imageList.results;
            const item = list.find((it) => it.file_path === p);
            check(item && item.width === 64 && item.height === 48 && !("date_of_creation" in item) && !("geo_location_latitude" in item),
                  `${name}: listed with the basic fields only (${item && item.width}x${item && item.height})`);
            const meta = item && (await call(M + "getImageMetadata", { uri: item.uri })).metadata;
            results[name] = meta;
            check(meta && meta.date_of_creation === "2026:10:06 10:00:00" && meta.geo_location_latitude === "N 52, 31, 12.00"
                  && meta.geo_location_longitude === "W  0,  7, 39.50" && meta.geo_location_country === "" && meta.geo_location_city === "",
                  `${name}: getImageMetadata reads its EXIF as libexif writes it (${JSON.stringify(meta && [meta.date_of_creation, meta.geo_location_latitude, meta.geo_location_longitude])})`);
        }
        const sample = (await call(M + "getImageList", {})).imageList.results.find((it) => /\/samples\/photos\//.test(it.file_path));
        const sm = sample && (await call(M + "getImageMetadata", { uri: sample.uri })).metadata;
        check(sm && sm.date_of_creation === "" && sm.geo_location_latitude === "" && sm.geo_location_longitude === "",
              `a picture without EXIF (${sample && sample.title}): the fields empty`);
        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
