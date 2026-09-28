#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the QR Scanner launcher icon, apps/scanner/public/icon.png: a QR
// code-like card under a red scan line inside viewfinder corners, in the
// webOS 2.x style of the other Phoenix icons (apps/tasks/tools/
// render-icon.cjs): a soft shadow and a glossy highlight, 64x64, and the
// same drawing at 256 px as icon-256x256.png (the "splashicon",
// docs/spec/hidpi-art.md). Original artwork (the modules are a pattern,
// not a readable code); the PNGs are committed. Rerun after a change:
//
//   node apps/scanner/tools/render-icon.cjs
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

// A 21x21 grid like a version 1 QR code: three finder squares, the rest a
// fixed pseudo-random pattern.
const N = 21, M = 1.4, X0 = 17.3, Y0 = 17.3;
const inFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
const finder = (r, c) => {
    const x = X0 + c * M, y = Y0 + r * M;
    return `<rect x="${x}" y="${y}" width="${M * 7}" height="${M * 7}" fill="#1d1d1d"/>
    <rect x="${x + M}" y="${y + M}" width="${M * 5}" height="${M * 5}" fill="#fff"/>
    <rect x="${x + M * 2}" y="${y + M * 2}" width="${M * 3}" height="${M * 3}" fill="#1d1d1d"/>`;
};
const modules = [];
for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
        if (inFinder(r, c)) continue;
        const dark = r === 6 || c === 6 ? (r + c) % 2 === 0 : ((r * 7 + c * 13 + r * c) % 5) < 2;
        if (dark) modules.push(`<rect x="${(X0 + c * M).toFixed(2)}" y="${(Y0 + r * M).toFixed(2)}" width="${M + 0.05}" height="${M + 0.05}" fill="#1d1d1d"/>`);
    }
}

const corner = (d) => `<path d="${d}" fill="none" stroke="#e9ecef" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;

const ICON = `
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#555"/><stop offset="1" stop-color="#151515"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdfe3"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="laser" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff3b30" stop-opacity="0"/><stop offset="0.2" stop-color="#ff3b30"/>
      <stop offset="0.8" stop-color="#ff3b30"/><stop offset="1" stop-color="#ff3b30" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="6" y="6" width="52" height="52" rx="9" fill="url(#tile)" stroke="#000" stroke-width="1"/>
  </g>
  ${corner("M11 20v-6a3 3 0 0 1 3-3h6")} ${corner("M44 11h6a3 3 0 0 1 3 3v6")}
  ${corner("M53 44v6a3 3 0 0 1-3 3h-6")} ${corner("M20 53h-6a3 3 0 0 1-3-3v-6")}
  <rect x="15" y="15" width="34" height="34" rx="2.5" fill="url(#paper)" stroke="#8d949c" stroke-width="0.8"/>
  ${finder(0, 0)} ${finder(0, N - 7)} ${finder(N - 7, 0)}
  ${modules.join("")}
  <rect x="9" y="31" width="46" height="2.4" rx="1.2" fill="url(#laser)"/>
  <rect x="9" y="30" width="46" height="4.4" rx="2" fill="#ff3b30" opacity="0.18"/>
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
