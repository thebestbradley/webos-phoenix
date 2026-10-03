#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Writes media/packages/org.example.hello_1.0.0_all.ipk: a real, tiny webOS
// app package (a "Hello" web app with its icon), the .ipk the simulator's
// Files has in Downloads to install. Made with the Marketplace's own .ipk
// writer (apps/marketplace/service/lib/ipk.js); the icon is drawn here.
// Dedicated to the public domain (CC0 1.0), like the other samples.
//
//   node apps/media-samples/tools/make-sample-ipk.cjs

"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ipkLib = require(path.join(__dirname, "../../marketplace/service/lib/ipk.js"));
const OUT = path.join(__dirname, "../media/packages/org.example.hello_1.0.0_all.ipk");

// ---- A PNG: a rounded green square with a white "H" ----------------------------------
function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function png(size) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    const r = size * 0.18, s = size / 64;
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        for (let x = 0; x < size; x++) {
            const o = y * (size * 4 + 1) + 1 + x * 4;
            // Rounded square, 4 px margin.
            const m = 4 * s, dx = Math.max(m + r - x - 0.5, 0, x + 0.5 - (size - m - r)), dy = Math.max(m + r - y - 0.5, 0, y + 0.5 - (size - m - r));
            const inside = x >= m && y >= m && x < size - m && y < size - m && Math.hypot(dx, dy) <= r;
            if (!inside) continue;
            const t = y / size;
            let c = [Math.round(80 - 40 * t), Math.round(190 - 60 * t), Math.round(90 - 40 * t)];
            // "H": two bars and a crossbar.
            const X = x / s, Y = y / s;
            if ((Y >= 18 && Y < 46) && ((X >= 20 && X < 27) || (X >= 37 && X < 44) || (Y >= 29 && Y < 35 && X >= 20 && X < 44))) c = [255, 255, 255];
            raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
                          chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const ID = "org.example.hello";
const DIR = "usr/palm/applications/" + ID + "/";
const appinfo = { id: ID, version: "1.0.0", vendor: "Example", type: "web", main: "index.html", title: "Hello",
                  icon: "icon.png", splashicon: "icon-256x256.png", uiRevision: 2 };
const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hello</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center;
         font-family: "Prelude", "Open Sans", sans-serif; background: #e6e6e6; color: #333; }
  img { width: 128px; height: 128px; }
  h1 { font-weight: normal; margin: 16px 0 4px; }
</style>
</head>
<body>
<img src="icon-256x256.png" alt="">
<h1>Hello, webOS</h1>
<p>An app installed from a package.</p>
</body>
</html>
`;

const gzip = { gzip: async (b) => new Uint8Array(zlib.gzipSync(b, { level: 9 })), gunzip: async (b) => new Uint8Array(zlib.gunzipSync(b)) };
ipkLib.createIpk({ gzip }).write({
    control: { Package: ID, Version: "1.0.0", Section: "misc", Priority: "optional", Architecture: "all",
               Maintainer: "Example <hello@example.org>", Description: "Hello, a sample app for the simulator" },
    files: [
        { path: DIR + "appinfo.json", data: JSON.stringify(appinfo, null, 4) + "\n" },
        { path: DIR + "index.html", data: html },
        { path: DIR + "icon.png", data: new Uint8Array(png(64)) },
        { path: DIR + "icon-256x256.png", data: new Uint8Array(png(256)) }
    ]
}).then((bytes) => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, bytes);
    console.log("wrote " + path.relative(process.cwd(), OUT) + " (" + bytes.length + " bytes)");
});
