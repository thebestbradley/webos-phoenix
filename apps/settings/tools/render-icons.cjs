#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the Settings launcher icons (public/icon.png, public/icons/*.png).
// The original Palm preference-app icons were not open-sourced, so these
// are new: a glossy rounded tile in the webOS 2.x style with a white glyph.
// The PNGs are committed; rerun this after changing a glyph:
//
//   node apps/settings/tools/render-icons.cjs
//
// Needs Playwright with Chromium (the same one tools/test-apps.cjs uses).

"use strict";
const fs = require("fs");
const path = require("path");
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* fall back to the global install */ }
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
}
const { chromium } = loadPlaywright();

const OUT = path.join(__dirname, "..", "public");
const SIZE = 64;

// A cog: `teeth` teeth between radius r1 (tips) and r0 (roots).
function gear(cx, cy, r1, r0, teeth) {
    const pts = [];
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; ++i) {
        const a = i * step - Math.PI / 2;
        // root, rise, tip, tip, fall
        [[r0, -0.5], [r1, -0.28], [r1, 0.28], [r0, 0.5]].forEach(([r, f]) => {
            pts.push([cx + r * Math.cos(a + f * step), cy + r * Math.sin(a + f * step)]);
        });
    }
    return "M" + pts.map((p) => p[0].toFixed(2) + " " + p[1].toFixed(2)).join("L") + "Z";
}

// [top colour, bottom colour, glyph (SVG in a 64x64 box, drawn white)]
const ICONS = {
    icon: ["#8b96a3", "#39424d", `
        <path d="${gear(32, 32, 18, 13.5, 8)}" fill="#fff"/>
        <circle cx="32" cy="32" r="6" fill="url(#bg)"/>`],
    wifi: ["#4a9be8", "#16508f", `
        <g fill="none" stroke="#fff" stroke-width="5.2" stroke-linecap="round">
          <path d="M14 29a26 26 0 0 1 36 0"/>
          <path d="M20.5 36a17 17 0 0 1 23 0"/>
          <path d="M27 43a8 8 0 0 1 10 0"/>
        </g>
        <circle cx="32" cy="49.5" r="3.6" fill="#fff"/>`],
    bluetooth: ["#5b6ee0", "#27348f", `
        <path d="M24 23l17 16-9 8.5V16.5L41 25 24 41" fill="none" stroke="#fff" stroke-width="4.4"
              stroke-linecap="round" stroke-linejoin="round"/>`],
    vpn: ["#5d86b3", "#203f63", `
        <path d="M32 11.5l17 6.2v12.6c0 10.6-7.2 18.6-17 22.2-9.8-3.6-17-11.6-17-22.2V17.7z" fill="#fff"/>
        <rect x="25" y="30" width="14" height="11" rx="2" fill="url(#bg)"/>
        <path d="M27.8 30v-3.2a4.2 4.2 0 0 1 8.4 0V30" fill="none" stroke="url(#bg)" stroke-width="2.6"/>`],
    airplane: ["#f2a13b", "#b8560f", `
        <path d="M32 11c2.2 0 3.3 2.5 3.3 5.2v10.1l14.7 8.4v4.4l-14.7-4.3v9.4l4.4 3.3v3.6L32 49.6l-7.7 1.9v-3.6l4.4-3.3v-9.4L14 39.5v-4.4l14.7-8.4V16.2c0-2.7 1.1-5.2 3.3-5.2z"
              fill="#fff"/>`],
    screen: ["#3fb6b0", "#146c69", `
        <rect x="18" y="29" width="28" height="22" rx="4" fill="#fff"/>
        <path d="M23.5 29v-6a8.5 8.5 0 0 1 17 0v6" fill="none" stroke="#fff" stroke-width="4.6"/>
        <circle cx="32" cy="38.5" r="3.2" fill="url(#bg)"/>
        <rect x="30.6" y="39" width="2.8" height="7" rx="1.2" fill="url(#bg)"/>`],
    sounds: ["#a765d6", "#5a2687", `
        <path d="M14 26h8l11-9v30l-11-9h-8z" fill="#fff"/>
        <g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round">
          <path d="M39.5 25.5a9 9 0 0 1 0 13"/>
          <path d="M45 20a17 17 0 0 1 0 24"/>
        </g>`],
    datetime: ["#6f8296", "#2b3846", `
        <circle cx="32" cy="32" r="18.5" fill="none" stroke="#fff" stroke-width="4.4"/>
        <path d="M32 21v11.5l7.5 5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`],
    language: ["#56b35a", "#1f6a27", `
        <g fill="none" stroke="#fff" stroke-width="3.4">
          <circle cx="32" cy="32" r="18"/>
          <ellipse cx="32" cy="32" rx="8" ry="18"/>
          <path d="M14 32h36M17 22h30M17 42h30"/>
        </g>`],
    deviceinfo: ["#9aa2ab", "#4a525b", `
        <circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="4.4"/>
        <circle cx="32" cy="22.5" r="3.2" fill="#fff"/>
        <rect x="29" y="28.5" width="6" height="15.5" rx="2" fill="#fff"/>`],
    updates: ["#33b3d6", "#0f6283", `
        <g fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round">
          <path d="M47 30a15 15 0 0 0-27.5-7"/>
          <path d="M17 34a15 15 0 0 0 27.5 7"/>
        </g>
        <path d="M14.5 15.5l2 12.2 11.2-5.2z" fill="#fff"/>
        <path d="M49.5 48.5l-2-12.2-11.2 5.2z" fill="#fff"/>`],
    location: ["#4fa3e0", "#1d5a9a", `
        <path d="M32 50c-1.2 0-13-13.5-13-23a13 13 0 0 1 26 0c0 9.5-11.8 23-13 23z" fill="#fff"/>
        <circle cx="32" cy="27" r="5.2" fill="url(#bg)"/>`],
    emergency: ["#ef5a4c", "#9c1c14", `
        <g fill="#fff">
          <rect x="27.5" y="13" width="9" height="38" rx="3"/>
          <rect x="27.5" y="13" width="9" height="38" rx="3" transform="rotate(60 32 32)"/>
          <rect x="27.5" y="13" width="9" height="38" rx="3" transform="rotate(-60 32 32)"/>
        </g>`],
    accessibility: ["#3aa0a8", "#135c63", `
        <circle cx="32" cy="16.5" r="4.6" fill="#fff"/>
        <path d="M15.5 24.5l16.5 3.2 16.5-3.2M32 27.7v9.6M32 37.3l-7 12.5M32 37.3l7 12.5" fill="none" stroke="#fff"
              stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`],
};

function svg([top, bottom, glyph]) {
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

// icon.png at `scale` times its size: icon-256x256.png.
const sized = (file, scale) => scale === 1 ? file : file.replace(/\.png$/, `-${SIZE * scale}x${SIZE * scale}.png`);

(async () => {
    fs.mkdirSync(path.join(OUT, "icons"), { recursive: true });
    const browser = await chromium.launch();
    // The 64 px icon, then the same drawing at 256 px: icon-256x256.png, the
    // appinfo.json "splashicon" the shell draws on dense screens and on the
    // loading card (docs/spec/hidpi-art.md).
    for (const scale of [1, 4]) {
        const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: scale });
        for (const [name, spec] of Object.entries(ICONS)) {
            await page.setContent(`<html><body style="margin:0;background:transparent">${svg(spec)}</body></html>`);
            const file = name === "icon" ? path.join(OUT, "icon.png") : path.join(OUT, "icons", name + ".png");
            await page.locator("svg").screenshot({ path: sized(file, scale), omitBackground: true });
            console.log("wrote", path.relative(process.cwd(), sized(file, scale)));
        }
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
