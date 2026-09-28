#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the launcher icons of Phone (apps/phone/public/icon.png) and
// Messaging (apps/messaging/public/icon.png). Palm's were never
// open-sourced, so these are new: the glossy webOS 2.x tile of
// apps/settings/tools/render-icons.cjs with a white glyph. The PNGs are
// committed; rerun after changing a glyph:
//
//   node apps/phone/tools/render-icon.cjs
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
const APPS = path.join(__dirname, "..", "..");

// [output, top colour, bottom colour, glyph (SVG in a 64x64 box)]
const ICONS = [
    [path.join(APPS, "phone/public/icon.png"), "#6cc04a", "#1f6f1c", `
        <path fill="#fff" d="M22.6 29.3a28.5 28.5 0 0 0 12.1 12.1l4.1-4.1a1.9 1.9 0 0 1 1.9-.46 21.4 21.4 0 0 0 6.7 1.07
          1.9 1.9 0 0 1 1.9 1.9v6.4a1.9 1.9 0 0 1-1.9 1.9A31.8 31.8 0 0 1 15.6 16.3a1.9 1.9 0 0 1 1.9-1.9h6.5a1.9 1.9 0 0 1 1.9 1.9
          c0 2.33.37 4.58 1.07 6.7a1.9 1.9 0 0 1-.47 1.9z"/>`],
    [path.join(APPS, "messaging/public/icon.png"), "#5fb4ea", "#17609f", `
        <path fill="#fff" d="M30 13c-10.5 0-19 6.7-19 15 0 4.6 2.6 8.7 6.7 11.4L16 48l8.7-5.3c1.7.4 3.5.6 5.3.6 10.5 0 19-6.7 19-15.2S40.5 13 30 13z"/>
        <path fill="#fff" fill-opacity="0.75" d="M50.5 27.5c.3 1 .5 2 .5 3 0 8.6-8.2 15.7-18.7 16.8 2.6 2.1 6.3 3.4 10.2 3.4 1.2 0 2.3-.1 3.4-.4L52 53l-1.1-5.8c2.9-2.1 4.6-5 4.6-8.3 0-4.4-2-8.4-5-11.4z"/>`],
];

function svg(top, bottom, glyph) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
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
      <g filter="url(#glyph)">${glyph}</g>
      <path d="M6 17a11 11 0 0 1 11-11h30a11 11 0 0 1 11 11v8c-8 4-17 5.5-26 5.5S14 29 6 25z" fill="url(#gloss)"/>
      <rect x="6.5" y="6.5" width="51" height="51" rx="10.5" fill="none" stroke="#fff" stroke-opacity="0.25"/>
    </svg>`;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    for (const [file, top, bottom, glyph] of ICONS) {
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg(top, bottom, glyph)}</body></html>`);
        await page.locator("svg").screenshot({ path: file, omitBackground: true });
        console.log("wrote", path.relative(process.cwd(), file));
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
