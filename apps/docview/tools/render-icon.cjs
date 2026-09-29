#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Doc View launcher icon, apps/docview/public/icon.png: an open book in front of a blue document, in
// the webOS 2.x style of the other Phoenix icons (apps/photos/tools/render-icons.cjs):
// a soft shadow and a glossy highlight, 64x64, and the same drawing at
// 256 px as icon-256x256.png (appinfo.json "splashicon"; docs/spec/hidpi-art.md).
// Original artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/docview/tools/render-icon.cjs
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
    <linearGradient id="doc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6b9ee0"/><stop offset="1" stop-color="#1f4f94"/>
    </linearGradient>
    <linearGradient id="pageL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e9e3d4"/><stop offset="1" stop-color="#fffdf7"/>
    </linearGradient>
    <linearGradient id="pageR" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#e3dccb"/>
    </linearGradient>
    <linearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a5a33"/><stop offset="1" stop-color="#4a2b14"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="16" y="4" width="34" height="42" rx="3" fill="url(#doc)" stroke="#173a6c" stroke-width="1"/>
    <g fill="#fff" opacity="0.85"><rect x="21" y="10" width="24" height="2.4" rx="1.2"/><rect x="21" y="15" width="20" height="2.4" rx="1.2"/><rect x="21" y="20" width="24" height="2.4" rx="1.2"/></g>
    <path d="M5 30c9-3 18-3 27 1 9-4 18-4 27-1v27c-9-3-18-3-27 1-9-4-18-4-27-1z" fill="url(#cover)" stroke="#2e1a0b" stroke-width="1"/>
    <path d="M7 28c8-2.5 16-2.5 25 1v26c-9-3.5-17-3.5-25-1z" fill="url(#pageL)" stroke="#9c9480" stroke-width="0.8"/>
    <path d="M32 29c9-3.5 17-3.5 25-1v26c-8-2-16-2-25 1z" fill="url(#pageR)" stroke="#9c9480" stroke-width="0.8"/>
    <g stroke="#b3ab98" stroke-width="1.2" stroke-linecap="round">
      <path d="M11 34c5-1.3 10-1.3 17 .5M11 39c5-1.3 10-1.3 17 .5M11 44c5-1.3 10-1.3 17 .5"/>
      <path d="M36 34.5c7-1.8 12-1.8 17-.5M36 39.5c7-1.8 12-1.8 17-.5M36 44.5c7-1.8 12-1.8 17-.5"/>
    </g>
  </g>
  <path d="M17 5h32v12c-11 2-21 2-32 0z" fill="url(#gloss)" opacity="0.55"/>`;

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
