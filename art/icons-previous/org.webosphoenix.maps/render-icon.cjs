#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Maps launcher icon, apps/maps/public/icon.png: a folded paper
// map (green park, blue river, yellow road) with a red pin, in the webOS
// 2.x style of the other Phoenix icons (apps/tasks/tools/render-icon.cjs):
// a soft shadow and a glossy highlight, 64x64, plus icon-256x256.png, the
// same drawing at 256 px for the splash and dense screens
// (docs/spec/hidpi-art.md). Original artwork; the PNGs are committed.
// Rerun after a change:
//
//   node apps/maps/tools/render-icon.cjs
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

// Three panels of a folded map, each a little darker towards the fold.
const ICON = `
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="p1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fbf7ea"/><stop offset="1" stop-color="#e6dfc9"/>
    </linearGradient>
    <linearGradient id="p2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e9e2cc"/><stop offset="1" stop-color="#fbf7ea"/>
    </linearGradient>
    <linearGradient id="pin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f26a52"/><stop offset="1" stop-color="#b3261a"/>
    </linearGradient>
    <clipPath id="paper"><path d="M6 14l17-5 18 5 17-5v41l-17 5-18-5-17 5z"/></clipPath>
  </defs>
  <g filter="url(#shadow)">
    <path d="M6 14l17-5v41l-17 5z" fill="url(#p1)"/>
    <path d="M23 9l18 5v41l-18-5z" fill="url(#p2)"/>
    <path d="M41 14l17-5v41l-17 5z" fill="url(#p1)"/>
    <g clip-path="url(#paper)">
      <path d="M4 40c9-3 14 2 22-2s12-12 22-10 10 3 12 2v9c-4 1-8-1-12-1-9 0-12 9-22 11S12 47 4 50z" fill="#b9dc9a" opacity="0.9"/>
      <path d="M30 4c-4 8 6 12 2 20s-12 10-8 20 10 8 8 16" fill="none" stroke="#6fb0e3" stroke-width="4.5"/>
      <path d="M2 30l62-8" stroke="#e0a53a" stroke-width="5"/>
      <path d="M2 30l62-8" stroke="#fbd46b" stroke-width="3"/>
      <path d="M14 8l6 50M44 8l-4 50" stroke="#fff" stroke-width="2.2" opacity="0.9"/>
    </g>
    <path d="M6 14l17-5 18 5 17-5v41l-17 5-18-5-17 5z" fill="none" stroke="#8d8570" stroke-width="1"/>
    <path d="M23 9v41M41 14v41" stroke="#8d8570" stroke-width="0.6" opacity="0.7"/>
    <path d="M42 4a10 10 0 0 1 10 10c0 7.5-10 19-10 19S32 21.5 32 14A10 10 0 0 1 42 4z" fill="url(#pin)" stroke="#7d160d" stroke-width="1.2"/>
    <circle cx="42" cy="14" r="3.8" fill="#fff"/>
  </g>
  <path d="M8 15l15-4.5 18 5 15-4.5v8c-16 4-32 4-48 1z" fill="url(#gloss)" opacity="0.5"/>`;

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
