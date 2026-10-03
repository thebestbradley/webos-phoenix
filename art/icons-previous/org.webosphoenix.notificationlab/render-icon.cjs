#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Notification Lab's icon, apps/notificationlab/public/icon.png:
// a bell with a badge over a progress arc (a notification and a live
// activity), in the webOS 2.x style of the other Phoenix icons
// (apps/flashlight/tools/render-icon.cjs), 64x64, and at 256 px as
// icon-256x256.png. Original artwork; the PNGs are committed. Rerun after
// a change:
//
//   node apps/notificationlab/tools/render-icon.cjs
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
      <stop offset="0" stop-color="#4a525d"/><stop offset="1" stop-color="#1c2027"/>
    </linearGradient>
    <linearGradient id="bell" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6d6"/><stop offset="1" stop-color="#f2c14e"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="6" y="6" width="52" height="52" rx="9" fill="url(#tile)" stroke="#0e1014" stroke-width="1"/>
  </g>
  <circle cx="32" cy="33" r="17" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="4"/>
  <path d="M32 16a17 17 0 1 1 -16.2 22.2" fill="none" stroke="#4aa3ff" stroke-width="4" stroke-linecap="round"/>
  <path d="M32 21c-5.5 0-8.5 4-8.5 9.5v5.5l-3 3.5v1.5h23v-1.5l-3-3.5v-5.5c0-5.5-3-9.5-8.5-9.5z"
        fill="url(#bell)" stroke="#6b4e10" stroke-width="1" stroke-linejoin="round"/>
  <path d="M28.5 42.5a3.5 3.5 0 0 0 7 0z" fill="#f2c14e" stroke="#6b4e10" stroke-width="1"/>
  <circle cx="43" cy="20" r="6" fill="#e0412f" stroke="#fff" stroke-width="1.5"/>
  <path d="M7 15a8 8 0 0 1 8-8h34a8 8 0 0 1 8 8v6c-15 4-35 4-50 0z" fill="url(#gloss)" opacity="0.3"/>`;

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
