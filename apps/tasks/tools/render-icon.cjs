#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Tasks launcher icon, apps/tasks/public/icon.png: a notepad with
// ticked boxes on a blue clipboard, in the webOS 2.x style of the other
// Phoenix icons (apps/files/tools/render-icon.cjs): a soft shadow and a
// glossy highlight, 64x64. Original artwork; the PNG is committed. Rerun
// after a change:
//
//   node apps/tasks/tools/render-icon.cjs
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

const tick = (y) => `
    <rect x="17" y="${y}" width="9" height="9" rx="1.5" fill="#fff" stroke="#7d8fa3" stroke-width="1"/>
    <path d="M18.5 ${y + 4.5}l2.5 3 5-7" fill="none" stroke="#2f9e44" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
const box = (y) => `<rect x="17" y="${y}" width="9" height="9" rx="1.5" fill="#fff" stroke="#7d8fa3" stroke-width="1"/>`;
const line = (y, w, done) => `<rect x="30" y="${y + 3}" width="${w}" height="3" rx="1.5" fill="${done ? "#b9c3cf" : "#5d6f84"}"/>`;

const ICON = `
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="board" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6fb4f0"/><stop offset="1" stop-color="#1f5fa6"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e4e6"/>
    </linearGradient>
    <linearGradient id="clip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f4f4"/><stop offset="1" stop-color="#9a9ea4"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    <rect x="9" y="7" width="46" height="53" rx="5" fill="url(#board)" stroke="#194a82" stroke-width="1"/>
    <rect x="13" y="13" width="38" height="43" rx="1.5" fill="url(#paper)" stroke="#9aa3ad" stroke-width="0.8"/>
    ${tick(19)} ${line(19, 16, true)}
    ${tick(31)} ${line(31, 13, true)}
    ${box(43)} ${line(43, 17, false)}
    <rect x="22" y="3" width="20" height="9" rx="3" fill="url(#clip)" stroke="#62666c" stroke-width="1"/>
    <rect x="28" y="5" width="8" height="3" rx="1.5" fill="#62666c"/>
  </g>
  <path d="M10 12a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v10c-14 3-30 3-44 0z" fill="url(#gloss)" opacity="0.45"/>`;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">
        <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${ICON}</svg></body></html>`);
    await page.locator("svg").screenshot({ path: OUT, omitBackground: true });
    console.log("wrote", path.relative(process.cwd(), OUT));
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
