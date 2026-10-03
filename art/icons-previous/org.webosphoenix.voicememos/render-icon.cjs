#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Voice Memos launcher icon, apps/voicememos/public/icon.png: a
// chrome microphone with a red record light, in the webOS 2.x style of the
// other Phoenix icons (apps/photos/tools/render-icons.cjs): a soft shadow
// and a glossy highlight, 64x64. Original artwork; the PNG is committed.
// Rerun after a change:
//
//   node apps/voicememos/tools/render-icon.cjs
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
      <stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6f757c"/><stop offset="0.3" stop-color="#f4f6f8"/><stop offset="0.55" stop-color="#b3b9c0"/>
      <stop offset="0.8" stop-color="#e8ebee"/><stop offset="1" stop-color="#5d636a"/>
    </linearGradient>
    <linearGradient id="stand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3a3d41"/><stop offset="0.45" stop-color="#a9afb6"/><stop offset="1" stop-color="#2c2f33"/>
    </linearGradient>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6b7077"/><stop offset="1" stop-color="#1f2124"/>
    </linearGradient>
    <radialGradient id="light" cx="0.4" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#ffb0a8"/><stop offset="0.4" stop-color="#e5372d"/><stop offset="1" stop-color="#7d110b"/>
    </radialGradient>
    <pattern id="grille" width="3" height="3" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="none"/><circle cx="1.5" cy="1.5" r="0.75" fill="#2b2e33" opacity="0.55"/>
    </pattern>
  </defs>
  <g filter="url(#shadow)">
    <ellipse cx="32" cy="56" rx="17" ry="4.5" fill="url(#base)"/>
    <rect x="29.5" y="40" width="5" height="16" fill="url(#stand)"/>
    <path d="M17 29v2a15 15 0 0 0 30 0v-2" fill="none" stroke="url(#stand)" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="21" y="5" width="22" height="36" rx="11" fill="url(#chrome)" stroke="#4a4f55" stroke-width="1"/>
    <rect x="21" y="5" width="22" height="22" rx="11" fill="url(#grille)"/>
    <rect x="21" y="25" width="22" height="3" fill="#8b9198" opacity="0.8"/>
    <rect x="21.5" y="5.5" width="21" height="35" rx="10.5" fill="none" stroke="#fff" stroke-opacity="0.45"/>
    <circle cx="32" cy="34" r="4" fill="url(#light)" stroke="#5a0c08" stroke-width="0.8"/>
  </g>
  <path d="M23 15a9 9 0 0 1 18 0v1c-6 1.5-12 1.5-18 0z" fill="url(#gloss)" opacity="0.7"/>`;

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
