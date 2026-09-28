#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the launcher icons of the media apps: apps/camera/public/icon.png,
// apps/photos/public/icon.png and apps/music/public/icon.png. Palm's
// Camera, Photos & Videos and Music icons were not open-sourced, so these
// are new, in the webOS 2.x style: an illustrated object with a soft shadow
// and a glossy highlight, 64x64. The PNGs are committed; rerun after a
// change:
//
//   node apps/photos/tools/render-icons.cjs
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

const APPS = path.join(__dirname, "..", "..");
const SIZE = 64;

const DEFS = `
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.5"/>
  </filter>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`;

const ICONS = {
    // A silver compact camera with a big blue lens.
    camera: `
      <defs>${DEFS}
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f4f5f6"/><stop offset="0.5" stop-color="#b9bec4"/><stop offset="1" stop-color="#6d737a"/>
        </linearGradient>
        <linearGradient id="grip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4b4f55"/><stop offset="1" stop-color="#1d1f22"/>
        </linearGradient>
        <radialGradient id="lens" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stop-color="#8fd3ff"/><stop offset="0.35" stop-color="#2a6fb8"/><stop offset="0.8" stop-color="#0b1f3d"/><stop offset="1" stop-color="#050a14"/>
        </radialGradient>
        <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2d3035"/><stop offset="1" stop-color="#8a9097"/>
        </linearGradient>
      </defs>
      <g filter="url(#shadow)">
        <rect x="22" y="12" width="16" height="8" rx="2" fill="url(#grip)"/>
        <rect x="5" y="17" width="54" height="36" rx="6" fill="url(#body)" stroke="#50555b" stroke-width="1"/>
        <rect x="5" y="36" width="54" height="17" rx="0" fill="url(#grip)" opacity="0.9"/>
        <rect x="5.5" y="17.5" width="53" height="35" rx="5.5" fill="none" stroke="#fff" stroke-opacity="0.5"/>
        <circle cx="32" cy="35" r="15" fill="url(#ring)" stroke="#222" stroke-width="1"/>
        <circle cx="32" cy="35" r="11" fill="url(#lens)"/>
        <ellipse cx="28" cy="30.5" rx="4.5" ry="2.8" fill="#fff" opacity="0.65"/>
        <circle cx="50" cy="23.5" r="2.6" fill="#ffd34d" stroke="#8a6d10" stroke-width="0.8"/>
        <rect x="10" y="21" width="7" height="4" rx="1" fill="#2a2d31"/>
      </g>`,

    // Two prints, the top one a sunset over the sea.
    photos: `
      <defs>${DEFS}
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2b4f9e"/><stop offset="0.55" stop-color="#f08a5d"/><stop offset="1" stop-color="#ffd27a"/>
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#23537d"/><stop offset="1" stop-color="#0e2238"/>
        </linearGradient>
        <linearGradient id="back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7fb069"/><stop offset="1" stop-color="#2f5d23"/>
        </linearGradient>
      </defs>
      <g filter="url(#shadow)">
        <g transform="rotate(-12 32 32)">
          <rect x="10" y="12" width="42" height="36" fill="#f3f3ef"/>
          <rect x="13.5" y="15.5" width="35" height="26" fill="url(#back)"/>
        </g>
        <g transform="rotate(7 34 36)">
          <rect x="12" y="16" width="44" height="38" fill="#fbfbf8"/>
          <rect x="15.5" y="19.5" width="37" height="27" fill="url(#sky)"/>
          <circle cx="40" cy="36" r="5" fill="#fff2c4"/>
          <rect x="15.5" y="37" width="37" height="9.5" fill="url(#sea)"/>
          <rect x="35" y="38.5" width="10" height="1.4" fill="#ffd89a" opacity="0.9"/>
          <rect x="37" y="41.5" width="6" height="1.2" fill="#ffd89a" opacity="0.7"/>
          <path d="M15.5 37l7-6 5 4 4-3 6 5z" fill="#1c2c46" opacity="0.8"/>
        </g>
      </g>
      <path d="M15 17h40l-2 13c-12 2-26 2-38-1z" fill="url(#gloss)" opacity="0.35" transform="rotate(7 34 36)"/>`,

    // A glossy amber disc with a white double note.
    music: `
      <defs>${DEFS}
        <radialGradient id="disc" cx="0.45" cy="0.35" r="0.75">
          <stop offset="0" stop-color="#ffcf6b"/><stop offset="0.55" stop-color="#f08a1c"/><stop offset="1" stop-color="#a2470a"/>
        </radialGradient>
      </defs>
      <g filter="url(#shadow)">
        <circle cx="32" cy="32" r="26" fill="url(#disc)" stroke="#7a3505" stroke-width="1"/>
        <circle cx="32" cy="32" r="25" fill="none" stroke="#fff" stroke-opacity="0.35"/>
        <path d="M41 16v19.5a5.5 5.5 0 1 1-3.4-5V22.3l-11 2.6v14.6a5.5 5.5 0 1 1-3.4-5V19.8z" fill="#fff"
              stroke="#6a2c04" stroke-opacity="0.35" stroke-width="0.8"/>
      </g>
      <path d="M11 28a21 21 0 0 1 42 0c-6-4-14-6-21-6s-15 2-21 6z" fill="url(#gloss)"/>`,
};

// icon.png at `scale` times its size: icon-256x256.png.
const sized = (file, scale) => scale === 1 ? file : file.replace(/\.png$/, `-${SIZE * scale}x${SIZE * scale}.png`);

(async () => {
    const browser = await chromium.launch();
    // The 64 px icon, then the same drawing at 256 px: icon-256x256.png, the
    // appinfo.json "splashicon" the shell draws on dense screens and on the
    // loading card (docs/spec/hidpi-art.md).
    for (const scale of [1, 4]) {
        const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: scale });
        for (const [app, body] of Object.entries(ICONS)) {
            await page.setContent(`<html><body style="margin:0;background:transparent">
                <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${body}</svg></body></html>`);
            const file = path.join(APPS, app, "public", "icon.png");
            await page.locator("svg").screenshot({ path: sized(file, scale), omitBackground: true });
            console.log("wrote", path.relative(process.cwd(), sized(file, scale)));
        }
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
