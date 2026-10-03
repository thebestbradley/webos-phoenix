#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Podcasts launcher icon, apps/podcasts/public/icon.png: a microphone sending out radio waves on a purple disc, in
// the webOS 2.x style of the other Phoenix icons (apps/photos/tools/render-icons.cjs):
// a soft shadow and a glossy highlight, 64x64, and the same drawing at
// 256 px as icon-256x256.png (appinfo.json "splashicon"; docs/spec/hidpi-art.md).
// Original artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/podcasts/tools/render-icon.cjs
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

const ICON = `
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="disc" cx="0.4" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#b98be6"/><stop offset="0.5" stop-color="#7a3fa8"/><stop offset="1" stop-color="#3a1557"/>
    </radialGradient>
    <linearGradient id="mic" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c9cdd3"/><stop offset="0.35" stop-color="#ffffff"/><stop offset="1" stop-color="#9aa0a8"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <circle cx="32" cy="32" r="27" fill="url(#disc)" stroke="#2a0e40" stroke-width="1"/>
    <g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3" opacity="0.9">
      <path d="M17 20a19 19 0 0 0 0 20"/><path d="M47 20a19 19 0 0 1 0 20"/>
      <path d="M22 24a12 12 0 0 0 0 12" opacity="0.8"/><path d="M42 24a12 12 0 0 1 0 12" opacity="0.8"/>
    </g>
    <rect x="27" y="14" width="10" height="20" rx="5" fill="url(#mic)" stroke="#4a4f55" stroke-width="0.8"/>
    <path d="M24 29v1a8 8 0 0 0 16 0v-1" fill="none" stroke="#e8eaee" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="30.8" y="38" width="2.4" height="7" fill="#e8eaee"/>
    <rect x="26" y="44.5" width="12" height="2.6" rx="1.3" fill="#e8eaee"/>
  </g>
  <ellipse cx="32" cy="18" rx="20" ry="11" fill="url(#gloss)" opacity="0.55"/>`;

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
