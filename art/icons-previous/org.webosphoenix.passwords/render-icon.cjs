#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Passwords launcher icon, apps/passwords/public/icon.png: a
// golden key across a blue safe door, in the webOS 2.x style of the
// other Phoenix icons (apps/photos/tools/render-icons.cjs): a soft shadow
// and a glossy highlight, 64x64. Original artwork; the PNG is committed.
// Rerun after a change:
//
//   node apps/passwords/tools/render-icon.cjs
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
    <linearGradient id="safe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6f9fd0"/><stop offset="0.55" stop-color="#2f5f8f"/><stop offset="1" stop-color="#1b3a5c"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0b0"/><stop offset="0.35" stop-color="#f0c040"/><stop offset="0.7" stop-color="#c8901c"/><stop offset="1" stop-color="#8a5a08"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="6" y="6" width="52" height="50" rx="9" fill="url(#safe)" stroke="#12304d" stroke-width="1"/>
    <rect x="6.5" y="6.5" width="51" height="49" rx="8.5" fill="none" stroke="#fff" stroke-opacity="0.35"/>
    <rect x="11" y="11" width="42" height="40" rx="5" fill="none" stroke="#0f2a45" stroke-opacity="0.55" stroke-width="1.5"/>
    <g transform="rotate(-38 32 31)">
      <circle cx="21" cy="31" r="9.5" fill="url(#gold)" stroke="#6b4406" stroke-width="1"/>
      <circle cx="19" cy="31" r="3.2" fill="#1b3a5c"/>
      <rect x="29" y="28" width="23" height="6" rx="1.5" fill="url(#gold)" stroke="#6b4406" stroke-width="1"/>
      <path d="M42 34v5h3v-5zm5 0v7h3v-7z" fill="url(#gold)" stroke="#6b4406" stroke-width="0.8"/>
    </g>
  </g>
  <path d="M8 16a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v6c-15 4-33 4-48 0z" fill="url(#gloss)" opacity="0.55"/>`;

// icon.png at `scale` times its size: icon-256x256.png.
const sized = (file, scale) => scale === 1 ? file : file.replace(/\.png$/, `-${SIZE * scale}x${SIZE * scale}.png`);

(async () => {
    const browser = await chromium.launch();
    // The 64 px icon, then the same drawing at 256 px: icon-256x256.png, the
    // appinfo.json "splashicon" the shell draws on dense screens and on the
    // loading card (docs/spec/hidpi-art.md).
    for (const scale of [1, 4]) {
        const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: scale });
        await page.setContent(`<html><body style="margin:0;background:transparent">
            <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${ICON}</svg></body></html>`);
        await page.locator("svg").screenshot({ path: sized(OUT, scale), omitBackground: true });
        console.log("wrote", path.relative(process.cwd(), sized(OUT, scale)));
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
