#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Draws the launcher icons of Phoenix's own apps and launch points from
// their vector sources in art/app-icons (docs/spec/app-icons.md): each icon
// is a platter shared by its kind (platters/disc.svg, the glass disc user
// apps sit on; platters/diamond.svg, the grey diamond system apps stand on)
// with the app's object (objects/<name>.svg) on it, as the Open webOS core
// apps' icons are drawn. art/app-icons/icons.json says which platter and
// object make each icon and where it goes.
//
// Every icon is written at 64 px (the appinfo.json "icon"), 128, 256 (the
// "splashicon") and 512 px, beside each other: icon.png, icon-128x128.png,
// icon-256x256.png, icon-512x512.png. The shell picks the one for its
// density (Theme.appIcon, docs/spec/hidpi-art.md).
//
// Each size is drawn four times as big and halved twice, so the small sizes
// are smoothed the same way at every size and blurs and thin lines look
// alike from 64 to 512 px.
//
// art/app-icons/rendered.json records, for every PNG, a hash of the SVG it
// was drawn from and of the PNG itself. --check (in CI) needs no browser:
// it fails when a source changed since its PNGs were drawn, a PNG was
// changed by hand, or one is missing or of the wrong size.
//
//   node tools/render-app-icons.cjs              draw them all
//   node tools/render-app-icons.cjs phone wifi   only these icons
//   node tools/render-app-icons.cjs --check      fail if any is out of date
//   node tools/render-app-icons.cjs --svg DIR    also write the composed SVGs
//
// Drawing needs Playwright with Chromium (the one tools/test-apps.cjs uses).

"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "art", "app-icons");
const MANIFEST = path.join(ART, "rendered.json");
const SIZES = [64, 128, 256, 512];
const SUPERSAMPLE = 4;
// Part of every source hash: change it when a change here alters the
// pixels (sizes, supersampling, composition), so --check asks for a redraw.
const RENDERER = "render-app-icons 1";

const read = (p) => fs.readFileSync(path.join(ART, p), "utf8");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// The content of an SVG file's root element (its defs and drawing).
function inner(svg, file) {
    const m = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg.replace(/<\?xml[^>]*>/, "").replace(/<!--[\s\S]*?-->/g, ""));
    if (!m)
        throw new Error(`${file}: no <svg> root`);
    return m[1];
}

// An object's own ids get a prefix so they cannot clash with the platter's
// or the shared defs' (which objects may use: url(#c-...)).
function prefixIds(body, prefix) {
    const ids = new Set();
    body.replace(/\bid="([^"]+)"/g, (_, id) => ids.add(id));
    return body
        .replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
        .replace(/url\(#([^)]+)\)/g, (all, id) => ids.has(id) ? `url(#${prefix}${id})` : all)
        .replace(/href="#([^"]+)"/g, (all, id) => ids.has(id) ? `href="#${prefix}${id}"` : all);
}

// The icon's whole drawing, 256 units square.
function compose(name, icon) {
    const common = inner(read("common.svg"), "common.svg");
    const platter = inner(read(`platters/${icon.platter}.svg`), icon.platter);
    const object = prefixIds(inner(read(`objects/${icon.object || name}.svg`), name), "o-");
    let stage;
    if (icon.platter === "disc") {
        // The object lies over the disc and shades it (and what is around
        // it) from above.
        stage = `<g filter="url(#c-drop)"><use href="#o-root"/></g>`;
    } else if (icon.platter === "diamond") {
        // The object stands on the slab at y = base: its foot darkens the
        // glass around it and the glass mirrors it, faintly, fading out.
        // base: where its foot meets the glass; foot: half its width there.
        const base = icon.base || 176;
        const foot = icon.foot || 44;
        stage = `
          <defs>
            <linearGradient id="st-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${base}" x2="0" y2="${base + 56}">
              <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
            <mask id="st-reflect" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
              <rect x="0" y="${base}" width="256" height="${256 - base}" fill="url(#st-fade)"/>
            </mask>
          </defs>
          <g clip-path="url(#pl-top)">
            <g opacity="0.3" mask="url(#st-reflect)">
              <use href="#o-root" transform="matrix(1 0 0 -1 0 ${2 * base})"/>
            </g>
            <ellipse cx="128" cy="${base + 4}" rx="${foot + 14}" ry="${Math.round((foot + 14) * 0.3)}" fill="#000" opacity="0.65" filter="url(#pl-soft)"/>
            <ellipse cx="128" cy="${base}" rx="${foot}" ry="${Math.max(3, Math.round(foot * 0.12))}" fill="#000" opacity="0.7" filter="url(#pl-contact)"/>
          </g>
          <g filter="url(#c-stand)"><use href="#o-root"/></g>`;
    } else {
        throw new Error(`${name}: unknown platter ${icon.platter}`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256" viewBox="0 0 256 256">
<defs>${common}<g id="o-root">${object}</g></defs>
${platter}
${stage}
</svg>
`;
}

// Where an icon's PNG at `size` goes: "apps/phone/public/icon" becomes
// icon.png at 64 px and icon-<size>x<size>.png otherwise.
const outFile = (out, size) => path.join(ROOT, size === 64 ? `${out}.png` : `${out}-${size}x${size}.png`);

function pngSize(file) {
    const b = fs.readFileSync(file);
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR")
        return null;
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function loadIcons() {
    const icons = JSON.parse(read("icons.json"));
    delete icons["//"];
    return icons;
}

function check() {
    const icons = loadIcons();
    const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
    const failed = [];
    let count = 0;
    for (const [name, icon] of Object.entries(icons)) {
        const svg = compose(name, icon);
        for (const out of icon.out) {
            for (const size of SIZES) {
                const file = outFile(out, size);
                const rel = path.relative(ROOT, file);
                const want = sha256(`${RENDERER}\n${size}\n${svg}`);
                const rec = manifest[rel];
                count++;
                if (!fs.existsSync(file)) failed.push(`${rel}: missing`);
                else if (!rec || rec.svg !== want) failed.push(`${rel}: its source changed since it was drawn`);
                else if (rec.png !== sha256(fs.readFileSync(file))) failed.push(`${rel}: changed by hand`);
                else {
                    const s = pngSize(file);
                    if (!s || s[0] !== size || s[1] !== size) failed.push(`${rel}: not ${size}x${size}`);
                }
            }
        }
    }
    for (const rel of Object.keys(manifest))
        if (!fs.existsSync(path.join(ROOT, rel)))
            failed.push(`${rel}: in rendered.json but not drawn by any icon`);
    for (const f of failed)
        console.log("FAIL", f);
    if (failed.length) {
        console.log("render-app-icons: run node tools/render-app-icons.cjs to redraw");
        process.exit(1);
    }
    console.log(`render-app-icons: all ${count} icon PNGs match their sources`);
}

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* fall back to the global install */ }
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
}

async function render(only, svgDir) {
    const icons = loadIcons();
    for (const n of only)
        if (!icons[n])
            throw new Error(`no icon named ${n} in art/app-icons/icons.json`);
    const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    for (const [name, icon] of Object.entries(icons)) {
        if (only.length && !only.includes(name))
            continue;
        const svg = compose(name, icon);
        if (svgDir) {
            fs.mkdirSync(svgDir, { recursive: true });
            fs.writeFileSync(path.join(svgDir, `${name}.svg`), svg);
        }
        for (const size of SIZES) {
            const png = await page.evaluate(async ({ svg, size, k }) => {
                const img = new Image();
                img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
                await img.decode();
                let side = size * k;
                let c = document.createElement("canvas");
                c.width = c.height = side;
                c.getContext("2d").drawImage(img, 0, 0, side, side);
                // Halve until the size is reached: each step averages 2x2
                // pixels, a box filter, which keeps fine detail smooth.
                while (side > size) {
                    side /= 2;
                    const d = document.createElement("canvas");
                    d.width = d.height = side;
                    const ctx = d.getContext("2d");
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = "high";
                    ctx.drawImage(c, 0, 0, side, side);
                    c = d;
                }
                return c.toDataURL("image/png").split(",")[1];
            }, { svg, size, k: SUPERSAMPLE });
            const data = Buffer.from(png, "base64");
            for (const out of icon.out) {
                const file = outFile(out, size);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, data);
                manifest[path.relative(ROOT, file)] = { svg: sha256(`${RENDERER}\n${size}\n${svg}`), png: sha256(data) };
            }
        }
        console.log("drew", name, "->", icon.out.join(", "));
    }
    await browser.close();
    const sorted = {};
    for (const k of Object.keys(manifest).sort())
        sorted[k] = manifest[k];
    fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 1) + "\n");
}

module.exports = { compose, loadIcons, outFile, SIZES };

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes("--check")) {
        check();
    } else {
        const i = args.indexOf("--svg");
        const svgDir = i >= 0 ? path.resolve(args[i + 1]) : null;
        const only = args.filter((a, j) => !a.startsWith("--") && !(i >= 0 && j === i + 1));
        render(only, svgDir).catch((e) => { console.error(e); process.exit(1); });
    }
}
