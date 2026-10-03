#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Videos launcher icon, apps/videos/public/icon.png: a film clapperboard with a play button, in
// the webOS 2.x style of the other Phoenix icons (apps/photos/tools/render-icons.cjs):
// a soft shadow and a glossy highlight, 64x64, and the same drawing at
// 256 px as icon-256x256.png (appinfo.json "splashicon"; docs/spec/hidpi-art.md).
// Original artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/videos/tools/render-icon.cjs
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
    <linearGradient id="board" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4d55"/><stop offset="1" stop-color="#16171b"/>
    </linearGradient>
    <linearGradient id="clap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3c42"/><stop offset="1" stop-color="#101114"/>
    </linearGradient>
    <radialGradient id="btn" cx="0.4" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#c7a4f2"/><stop offset="0.45" stop-color="#8453c9"/><stop offset="1" stop-color="#3f1d74"/>
    </radialGradient>
    <clipPath id="clapclip"><path d="M8 13l44-9 2 9-44 9z"/></clipPath>
  </defs>
  <g filter="url(#shadow)">
    <rect x="8" y="21" width="48" height="36" rx="3" fill="url(#board)" stroke="#0b0b0d" stroke-width="1"/>
    <rect x="8" y="21" width="48" height="8" fill="url(#clap)"/>
    <g fill="#f2f2f2"><path d="M12 21h6l-5 8h-6zM24 21h6l-5 8h-6zM36 21h6l-5 8h-6zM48 21h6l-5 8h-6z"/></g>
    <path d="M8 13l44-9 2 9-44 9z" fill="url(#clap)" stroke="#0b0b0d" stroke-width="1"/>
    <g clip-path="url(#clapclip)" fill="#f2f2f2"><path d="M13 12l6-1.3 1 8.5-6 1.3zM25 9.5l6-1.3 1 8.5-6 1.3zM37 7l6-1.3 1 8.5-6 1.3zM49 4.5l6-1.3 1 8.5-6 1.3z" transform="skewX(-20) translate(5 0)"/></g>
    <circle cx="10" cy="21" r="2.4" fill="#9ea3ab" stroke="#333" stroke-width="0.8"/>
    <circle cx="32" cy="43" r="11" fill="url(#btn)" stroke="#2b1152" stroke-width="1"/>
    <path d="M28.5 37.5l9.5 5.5-9.5 5.5z" fill="#fff"/>
  </g>
  <path d="M9 22h46v6H9z" fill="url(#gloss)" opacity="0.35"/>
  <path d="M23 34.5a10 10 0 0 1 18 0c-5 2-13 2-18 0z" fill="url(#gloss)" opacity="0.7"/>`;

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
