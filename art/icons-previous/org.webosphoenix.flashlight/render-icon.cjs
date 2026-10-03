#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Flashlight launcher icon, apps/flashlight/public/icon.png: a
// brushed-metal torch throwing a warm beam, in the webOS 2.x style of the
// other Phoenix icons (apps/tasks/tools/render-icon.cjs): a soft shadow and
// a glossy highlight, 64x64, and the same drawing at 256 px as
// icon-256x256.png (the "splashicon", docs/spec/hidpi-art.md). Original
// artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/flashlight/tools/render-icon.cjs
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
      <stop offset="0" stop-color="#fff" stop-opacity="0.65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4a4a"/><stop offset="1" stop-color="#0c0c0c"/>
    </linearGradient>
    <radialGradient id="beam" gradientUnits="userSpaceOnUse" cx="32" cy="24" r="40">
      <stop offset="0" stop-color="#fffbe8" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#ffe08a" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffcf4a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5d6167"/><stop offset="0.35" stop-color="#e9ecef"/>
      <stop offset="0.6" stop-color="#9ba1a8"/><stop offset="1" stop-color="#3c4046"/>
    </linearGradient>
    <linearGradient id="grip" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1a1a1a"/><stop offset="0.4" stop-color="#555"/><stop offset="1" stop-color="#111"/>
    </linearGradient>
    <radialGradient id="lens" cx="0.5" cy="0.4" r="0.6">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#fff2b8"/><stop offset="1" stop-color="#e0a93a"/>
    </radialGradient>
    <clipPath id="tileclip"><rect x="6.5" y="6.5" width="51" height="51" rx="8.5"/></clipPath>
  </defs>
  <g filter="url(#shadow)">
    <rect x="6" y="6" width="52" height="52" rx="9" fill="url(#tile)" stroke="#000" stroke-width="1"/>
  </g>
  <g clip-path="url(#tileclip)"><g transform="rotate(-28 32 34)">
    <path d="M23 24 L-2 -14 L66 -14 L41 24 Z" fill="url(#beam)"/>
    <path d="M22 24h20l-3 9h-14z" fill="url(#metal)" stroke="#2c2f33" stroke-width="0.8"/>
    <ellipse cx="32" cy="24" rx="10" ry="2.6" fill="url(#lens)" stroke="#6b5a2a" stroke-width="0.6"/>
    <rect x="25" y="33" width="14" height="22" rx="2" fill="url(#grip)" stroke="#000" stroke-width="0.8"/>
    <rect x="25" y="37" width="14" height="1.2" fill="#000" opacity="0.6"/>
    <rect x="25" y="41" width="14" height="1.2" fill="#000" opacity="0.6"/>
    <rect x="25" y="45" width="14" height="1.2" fill="#000" opacity="0.6"/>
    <rect x="29" y="49" width="6" height="4" rx="1" fill="#c9a33a" stroke="#6b5a2a" stroke-width="0.5"/>
  </g></g>
  <path d="M7 15a8 8 0 0 1 8-8h34a8 8 0 0 1 8 8v6c-15 4-35 4-50 0z" fill="url(#gloss)" opacity="0.35"/>`;

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
