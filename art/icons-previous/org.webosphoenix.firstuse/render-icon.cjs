#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the First Use icon, apps/firstuse/public/icon.png (64 px) and
// icon-256x256.png (its "splashicon", shown on the loading card;
// docs/spec/hidpi-art.md): a phone with a rising sun on a glossy orange tile, in the webOS 2.x
// style of the Settings icons (apps/settings/tools/render-icons.cjs).
// Original artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/firstuse/tools/render-icon.cjs
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
      <stop offset="0" stop-color="#f7a54a"/><stop offset="1" stop-color="#b44d12"/>
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
    <rect x="21" y="11" width="22" height="42" rx="4.5" fill="#fff"/>
    <rect x="24" y="16" width="16" height="29" rx="1.5" fill="url(#bg)"/>
    <circle cx="32" cy="38" r="5" fill="#fff"/>
    <g stroke="#fff" stroke-width="1.8" stroke-linecap="round">
      <path d="M32 27.5v2.5M25.8 32l1.8 1.5M38.2 32l-1.8 1.5"/>
    </g>
    <rect x="24" y="38" width="16" height="7" fill="url(#bg)"/>
    <rect x="29" y="48" width="6" height="2" rx="1" fill="url(#bg)"/>
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
