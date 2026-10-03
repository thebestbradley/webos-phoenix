#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Help launcher icon, apps/help/public/icon.png (64 px) and
// icon-256x256.png (its "splashicon"; docs/spec/hidpi-art.md): a white
// question mark in a speech balloon on a glossy blue tile, in the webOS 2.x
// style of the Settings icons (apps/settings/tools/render-icons.cjs).
// Original artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/help/tools/render-icon.cjs
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
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#58aef0"/><stop offset="1" stop-color="#17579c"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="glyph" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="-0.8" stdDeviation="0.4" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="5" y="5" width="54" height="54" rx="12" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="5.5" y="5.5" width="53" height="53" rx="11.5" fill="none" stroke="#000" stroke-opacity="0.35"/>
  <g filter="url(#glyph)">
    <path d="M32 13c10.5 0 19 7 19 16s-8.5 16-19 16c-1.6 0-3.1-.2-4.6-.5L18.5 50l2.2-8.6C16.1 38.5 13 34 13 29c0-9 8.5-16 19-16z" fill="#fff"/>
    <path d="M26.2 25.2c.3-3.6 2.8-5.7 6.2-5.7 3.6 0 6.1 2.2 6.1 5.3 0 2.4-1.3 3.7-3.2 4.9-1.5.9-2 1.6-2 3v.9" fill="none"
          stroke="url(#bg)" stroke-width="3.6" stroke-linecap="round"/>
    <circle cx="33.2" cy="38" r="2.3" fill="url(#bg)"/>
  </g>
  <path d="M6 17a11 11 0 0 1 11-11h30a11 11 0 0 1 11 11v8c-8 4-17 5.5-26 5.5S14 29 6 25z" fill="url(#gloss)"/>
  <rect x="6.5" y="6.5" width="51" height="51" rx="10.5" fill="none" stroke="#fff" stroke-opacity="0.25"/>`;

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
