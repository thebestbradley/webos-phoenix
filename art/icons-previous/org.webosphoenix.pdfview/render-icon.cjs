#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the PDF View launcher icon, apps/pdfview/public/icon.png: a page with a folded corner and a red PDF band, in
// the webOS 2.x style of the other Phoenix icons (apps/photos/tools/render-icons.cjs):
// a soft shadow and a glossy highlight, 64x64, and the same drawing at
// 256 px as icon-256x256.png (appinfo.json "splashicon"; docs/spec/hidpi-art.md).
// Original artwork; the PNGs are committed. Rerun after a change:
//
//   node apps/pdfview/tools/render-icon.cjs
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
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d9d4"/>
    </linearGradient>
    <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ec5b4f"/><stop offset="1" stop-color="#a51f17"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <path d="M13 5h28l12 12v40a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="url(#paper)" stroke="#8d8d88" stroke-width="1"/>
    <path d="M41 5v10a2 2 0 0 0 2 2h10z" fill="#c7c7c2" stroke="#8d8d88" stroke-width="1" stroke-linejoin="round"/>
    <g fill="#b9bcc2"><rect x="17" y="13" width="18" height="2" rx="1"/><rect x="17" y="18" width="22" height="2" rx="1"/><rect x="17" y="23" width="30" height="2" rx="1"/></g>
    <rect x="6" y="30" width="44" height="20" rx="3" fill="url(#band)" stroke="#6e1410" stroke-width="1"/>
    <text x="28" y="45.5" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" font-weight="bold" fill="#fff" letter-spacing="0.5">PDF</text>
  </g>
  <path d="M7 31h42v8c-14 2-28 2-42 0z" fill="url(#gloss)" opacity="0.5"/>`;

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
