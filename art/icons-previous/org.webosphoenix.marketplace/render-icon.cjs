#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Marketplace's launcher icon (public/icon.png, icon-256x256.png):
// a glossy tile in the webOS 2.x style, like the Settings icons
// (apps/settings/tools/render-icons.cjs), with a shopping bag and a star.
// HP's App Catalog icon was not open-sourced. The PNGs are committed:
//
//   node apps/marketplace/tools/render-icon.cjs

"use strict";
const path = require("path");
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* the global install */ }
    return require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "playwright"));
}
const { chromium } = loadPlaywright();
const OUT = path.join(__dirname, "..", "public");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f93d8"/><stop offset="1" stop-color="#1b4f8c"/></linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.4" flood-color="#000" flood-opacity="0.45"/></filter>
    <filter id="glyph" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="-0.8" stdDeviation="0.4" flood-color="#000" flood-opacity="0.35"/></filter>
  </defs>
  <rect x="5" y="5" width="54" height="54" rx="12" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="5.5" y="5.5" width="53" height="53" rx="11.5" fill="none" stroke="#000" stroke-opacity="0.35"/>
  <g filter="url(#glyph)">
    <path d="M17 24h30l-2.6 24.5a3 3 0 0 1-3 2.7H22.6a3 3 0 0 1-3-2.7z" fill="#fff"/>
    <path d="M25 26v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M32 29.5l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="url(#bg)"/>
  </g>
  <path d="M6 17a11 11 0 0 1 11-11h30a11 11 0 0 1 11 11v8c-8 4-17 5.5-26 5.5S14 29 6 25z" fill="url(#gloss)"/>
  <rect x="6.5" y="6.5" width="51" height="51" rx="10.5" fill="none" stroke="#fff" stroke-opacity="0.25"/>
</svg>`;

(async () => {
    const browser = await chromium.launch();
    for (const [scale, name] of [[1, "icon.png"], [4, "icon-256x256.png"]]) {
        const page = await browser.newPage({ viewport: { width: 64, height: 64 }, deviceScaleFactor: scale });
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
        await page.locator("svg").screenshot({ path: path.join(OUT, name), omitBackground: true });
        console.log("wrote", name);
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
