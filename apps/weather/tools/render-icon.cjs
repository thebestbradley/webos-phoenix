#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Weather launcher icon, apps/weather/public/icon.png: a sun
// behind a glossy cloud, in the webOS 2.x style of the other Phoenix icons
// (apps/tasks/tools/render-icon.cjs): a soft shadow and a glossy
// highlight, 64x64, and the same drawing at 256 px as icon-256x256.png
// (the "splashicon", docs/spec/hidpi-art.md). Original artwork; the PNGs
// are committed. Rerun after a change:
//
//   node apps/weather/tools/render-icon.cjs
//
// Needs Playwright with Chromium (the same one tools/test-apps.cjs uses).

"use strict";
const path = require("path");
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* fall back to the global install */ }
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
}
const { chromium } = loadPlaywright();

const SIZE = 64;
const OUT = path.join(__dirname, "..", "public", "icon.png");

const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, cx = 24, cy = 23;
    const p = (r) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
    return `<path d="M${p(15)} L${p(21)}" stroke="#f5a300" stroke-width="3.6" stroke-linecap="round"/>`;
}).join("");

const ICON = `
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <radialGradient id="sun" cx="0.4" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#fff6b0"/><stop offset="0.6" stop-color="#ffd21f"/><stop offset="1" stop-color="#f08c00"/>
    </radialGradient>
    <linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c5cfdb"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    ${rays}
    <circle cx="24" cy="23" r="12" fill="url(#sun)" stroke="#c77800" stroke-width="1"/>
    <path d="M17 54h32a11 11 0 0 0 1.2-21.9A14 14 0 0 0 23.6 28 10 10 0 0 0 8 37.5 8.5 8.5 0 0 0 17 54z"
          fill="url(#cloud)" stroke="#7d8a99" stroke-width="1.2"/>
  </g>
  <path d="M12 44c1-6 6-9 11-8 2-6 9-9 15-6 4-4 11-3 14 2-10-1-16 1-20 6-6-2-13 0-20 6z" fill="url(#gloss)" opacity="0.8"/>`;

// icon.png at `scale` times its size: icon-256x256.png.
const sized = (file, scale) => scale === 1 ? file : file.replace(/\.png$/, `-${SIZE * scale}x${SIZE * scale}.png`);

(async () => {
    const browser = await chromium.launch();
    for (const scale of [1, 4]) {
        const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: scale });
        await page.setContent(`<html><body style="margin:0;background:transparent">
            <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${ICON}</svg></body></html>`);
        await page.locator("svg").screenshot({ path: sized(OUT, scale), omitBackground: true });
        console.log("wrote", path.relative(process.cwd(), sized(OUT, scale)));
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
