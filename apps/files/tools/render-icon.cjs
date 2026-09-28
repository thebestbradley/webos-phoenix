#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Files launcher icon, apps/files/public/icon.png: an open
// manila folder with papers in it, in the webOS 2.x style of the other
// Phoenix icons (apps/photos/tools/render-icons.cjs): a soft shadow and a
// glossy highlight, 64x64. Original artwork; the PNG is committed. Rerun
// after a change:
//
//   node apps/files/tools/render-icon.cjs
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
      <stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="back" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e2a93a"/><stop offset="1" stop-color="#a86d12"/>
    </linearGradient>
    <linearGradient id="front" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe7a1"/><stop offset="0.45" stop-color="#f6c75a"/><stop offset="1" stop-color="#d38f1f"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdcd8"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <path d="M6 14a3 3 0 0 1 3-3h14l5 5h27a3 3 0 0 1 3 3v31H6z" fill="url(#back)" stroke="#8a5a0e" stroke-width="1"/>
    <g transform="rotate(-6 30 30)">
      <rect x="14" y="14" width="30" height="30" rx="1.5" fill="url(#paper)" stroke="#9a9a96" stroke-width="0.8"/>
      <rect x="18" y="20" width="20" height="2" fill="#9fb7d4"/>
      <rect x="18" y="25" width="16" height="2" fill="#b9c9dc"/>
    </g>
    <g transform="rotate(5 38 30)">
      <rect x="24" y="15" width="28" height="28" rx="1.5" fill="url(#paper)" stroke="#9a9a96" stroke-width="0.8"/>
      <rect x="28" y="21" width="18" height="2" fill="#9fb7d4"/>
    </g>
    <path d="M4 29a3 3 0 0 1 3-3h50a3 3 0 0 1 3 3l-3 23a3 3 0 0 1-3 2.6H10A3 3 0 0 1 7 52z" fill="url(#front)" stroke="#8a5a0e" stroke-width="1"/>
    <path d="M7.5 29.5h49" stroke="#fff" stroke-opacity="0.7" stroke-width="1"/>
  </g>
  <path d="M7 30h50l-1.6 11c-15 2.5-31 2.5-46.8 0z" fill="url(#gloss)" opacity="0.55"/>`;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">
        <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${ICON}</svg></body></html>`);
    await page.locator("svg").screenshot({ path: OUT, omitBackground: true });
    console.log("wrote", path.relative(process.cwd(), OUT));
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
