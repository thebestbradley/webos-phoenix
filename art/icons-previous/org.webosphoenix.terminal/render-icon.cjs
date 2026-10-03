#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Terminal launcher icon, apps/terminal/public/icon.png: a dark
// glass screen in a brushed metal bezel with a green prompt and a block
// cursor, in the webOS 2.x style of the other Phoenix icons
// (apps/voicememos/tools/render-icon.cjs): a soft shadow and a glossy
// highlight, 64x64, and the same drawing at 256 px (icon-256x256.png, the
// appinfo.json "splashicon"; docs/spec/hidpi-art.md). Original artwork;
// the PNGs are committed. Rerun after a change:
//
//   node apps/terminal/tools/render-icon.cjs
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
    <linearGradient id="bezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f1f3f5"/><stop offset="0.45" stop-color="#b9bec4"/>
      <stop offset="0.55" stop-color="#a3a9b0"/><stop offset="1" stop-color="#6c737b"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2e33"/><stop offset="1" stop-color="#0c0d0f"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#5dff7a" stop-opacity="0.25"/><stop offset="1" stop-color="#5dff7a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="5" y="8" width="54" height="46" rx="7" fill="url(#bezel)" stroke="#4d535a" stroke-width="1"/>
    <rect x="9.5" y="12.5" width="45" height="37" rx="3.5" fill="url(#glass)" stroke="#1b1d20" stroke-width="1"/>
    <rect x="9.5" y="12.5" width="45" height="37" rx="3.5" fill="url(#glow)"/>
    <path d="M15 22l7 5.5-7 5.5" fill="none" stroke="#6cff86" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="25" y="31" width="10" height="3.4" rx="0.8" fill="#6cff86"/>
    <rect x="15" y="39" width="17" height="2.2" rx="1" fill="#6cff86" opacity="0.45"/>
    <rect x="35" y="39" width="8" height="2.2" rx="1" fill="#6cff86" opacity="0.3"/>
    <rect x="5.5" y="8.5" width="53" height="45" rx="6.5" fill="none" stroke="#fff" stroke-opacity="0.5"/>
  </g>
  <path d="M10 16a3.5 3.5 0 0 1 3.5-3.5h37a3.5 3.5 0 0 1 3.5 3.5v6c-14 3-30 3-44 0z" fill="url(#gloss)"/>`;

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
