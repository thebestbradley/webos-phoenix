#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Authenticator launcher icon, apps/authenticator/public/icon.png:
// a green shield with a code dial and its countdown arc, in the webOS 2.x
// style of the other Phoenix icons (apps/photos/tools/render-icons.cjs): a soft shadow
// and a glossy highlight, 64x64. Original artwork; the PNG is committed.
// Rerun after a change:
//
//   node apps/authenticator/tools/render-icon.cjs
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
    <linearGradient id="shield" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7fd6b0"/><stop offset="0.45" stop-color="#2a9a70"/><stop offset="1" stop-color="#0f4a36"/>
    </linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe6e3"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <path d="M32 4l23 8v16c0 15-9.6 26.6-23 32C18.6 54.6 9 43 9 28V12z" fill="url(#shield)" stroke="#0b3a2a" stroke-width="1"/>
    <path d="M32 5.6l21.6 7.5V28c0 14.2-9 25.2-21.6 30.4" fill="none" stroke="#fff" stroke-opacity="0.35"/>
    <circle cx="32" cy="31" r="15" fill="url(#face)" stroke="#0b3a2a" stroke-width="1"/>
    <path d="M32 16a15 15 0 0 1 14.2 19.8" fill="none" stroke="#2f86d6" stroke-width="3.2" stroke-linecap="round"/>
    <text x="32" y="35.5" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="11.5" fill="#1b4f82">123</text>
  </g>
  <path d="M11 13.5L32 6l21 7.5v7c-14 4-28 4-42 0z" fill="url(#gloss)" opacity="0.6"/>`;

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
