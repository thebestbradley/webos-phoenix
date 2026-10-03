#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Screenshot app's icon, apps/screenshot/public/icon.png: a
// screen in a capture frame's four corners with a flash of light, in the
// webOS 2.x style of the other Phoenix icons (apps/flashlight/tools/
// render-icon.cjs), 64x64, and at 256 px as icon-256x256.png. Original
// artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/screenshot/tools/render-icon.cjs
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
      <stop offset="0" stop-color="#3f6fa8"/><stop offset="1" stop-color="#173459"/>
    </linearGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e8f2ff"/><stop offset="1" stop-color="#8fb4e0"/>
    </linearGradient>
    <radialGradient id="flash" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff"/><stop offset="0.4" stop-color="#fffbe0" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#fff6c0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="6" y="6" width="52" height="52" rx="9" fill="url(#tile)" stroke="#0b1a2e" stroke-width="1"/>
  </g>
  <rect x="22" y="17" width="20" height="30" rx="2.5" fill="url(#screen)" stroke="#0b1a2e" stroke-width="1"/>
  <rect x="25" y="21" width="14" height="4" rx="1" fill="#5d8cc4" opacity="0.7"/>
  <rect x="25" y="27" width="14" height="2" rx="1" fill="#5d8cc4" opacity="0.5"/>
  <rect x="25" y="31" width="10" height="2" rx="1" fill="#5d8cc4" opacity="0.5"/>
  <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 20v-6h6"/><path d="M44 14h6v6"/><path d="M50 44v6h-6"/><path d="M20 50h-6v-6"/>
  </g>
  <circle cx="42" cy="20" r="9" fill="url(#flash)"/>
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
