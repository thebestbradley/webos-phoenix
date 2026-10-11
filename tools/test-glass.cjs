#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The page side of Ember Glass's shell contract (docs/SYSTEM-UI-2.md, "The
// shell contract"; Ember Glass UI's docs/SHELL-CONTRACT.md), in headless
// Chromium: runtime/phoenix-runtime.js's __phoenixRuntime.glassChanged(),
// which the shell calls with the blurred wallpaper's address, the window's
// place, the screen and whether the device blurs live.
//
//  * the CSS custom properties on <html> (--eg-wallpaper-blurred,
//    --eg-window-x/y, --eg-screen-w/h, --eg-window-radius) and
//    data-eg-blur="none", PalmSystem.glass (JSON) and the phoenixGlass event;
//    taken away again with null;
//  * a page drawing L1 as Ember Glass UI's .eg-window does (the picture sized
//    to the screen, offset by the window's place) puts each pixel of the
//    picture where it lies on the screen: the blur lines up with the sharp
//    wallpaper around the window, maximized or not;
//  * without a picture, the page's own background (the tint-only fallback).
//
//   NODE_PATH="$(npm root -g)" node tools/test-glass.cjs [--out DIR]

"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "glass-tests");
const ORIGIN = "http://phoenix.test";
const APP = "/usr/palm/applications/org.webosphoenix.glasstest/index.html";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

// A page that draws L1 as Ember Glass UI's .eg-window does
// (packages/css/src/glass.css, ".eg-window::before"): the blurred
// wallpaper sized to the screen, offset by the window's place. The tone map
// (filter) is left out here so the picture's pixels arrive as they are.
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<script src="/usr/share/phoenix/runtime/phoenix-runtime.js"></script>
<style>
  html, body { margin: 0; height: 100%; background: rgb(11, 11, 13); }
  .eg-window { position: relative; isolation: isolate; min-height: 100vh; }
  .eg-window::before { content: ""; position: fixed; inset: 0; z-index: -2; pointer-events: none;
    background-image: var(--eg-wallpaper-blurred, none);
    background-size: var(--eg-screen-w, 100vw) var(--eg-screen-h, 100vh);
    background-position: calc(-1 * var(--eg-window-x, 0px)) calc(-1 * var(--eg-window-y, 0px));
    background-repeat: no-repeat; }
</style></head>
<body><div class="eg-window"></div></body></html>`;

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const runtime = fs.readFileSync(path.join(REPO, "runtime", "phoenix-runtime.js"), "utf8");
    const browser = await chromium.launch();
    try {
        // A maximized phone card: the window under the 32 px status bar,
        // above the 22 px gesture strip, of a 446 x 994 screen.
        const win = { x: 0, y: 32, width: 446, height: 940 };
        const screen = { width: 446, height: 994 };
        const context = await browser.newContext({ viewport: { width: win.width, height: win.height }, deviceScaleFactor: 1 });
        await context.route(ORIGIN + "/**", (route) => {
            const u = new URL(route.request().url());
            if (u.pathname === APP)
                return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
            if (u.pathname === "/usr/share/phoenix/runtime/phoenix-runtime.js")
                return route.fulfill({ status: 200, contentType: "application/javascript", body: runtime });
            return route.fulfill({ status: 404, body: "" });
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(ORIGIN + APP);
        await page.waitForFunction(() => !!(window.__phoenixRuntime && window.PalmSystem));

        const state = () => page.evaluate(() => {
            const root = document.documentElement;
            const p = (k) => root.style.getPropertyValue(k);
            return {
                wallpaper: p("--eg-wallpaper-blurred"), x: p("--eg-window-x"), y: p("--eg-window-y"),
                w: p("--eg-screen-w"), h: p("--eg-screen-h"), radius: p("--eg-window-radius"),
                blur: root.getAttribute("data-eg-blur"), glass: window.PalmSystem.glass
            };
        });

        let s = await state();
        check(s.wallpaper === "" && s.x === "" && s.blur === null && !s.glass, "before the shell says anything: no properties, no PalmSystem.glass");

        // A picture the size of the screen whose every pixel says where it
        // is: red the column, green the row (each mod 256), blue 128.
        const picture = await page.evaluate(({ width: w, height: h }) => {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            const img = ctx.createImageData(w, h);
            for (let y = 0; y < h; ++y)
                for (let x = 0; x < w; ++x) {
                    const i = 4 * (y * w + x);
                    img.data[i] = x % 256; img.data[i + 1] = y % 256; img.data[i + 2] = 128; img.data[i + 3] = 255;
                }
            ctx.putImageData(img, 0, 0);
            return c.toDataURL("image/png");
        }, screen);

        await page.evaluate(() => {
            window.__glassEvents = [];
            document.addEventListener("phoenixGlass", (e) => window.__glassEvents.push(e.detail));
        });
        const data = { wallpaperBlurred: picture, window: win, screen, windowRadius: 30, blur: "live", extra: "dropped" };
        await page.evaluate((d) => window.__phoenixRuntime.glassChanged(d), data);
        s = await state();
        check(s.wallpaper === `url("${picture}")`, "--eg-wallpaper-blurred: url(\"...\") of the address");
        check(s.x === "0px" && s.y === "32px", "--eg-window-x, --eg-window-y: the window's place in CSS px");
        check(s.w === "446px" && s.h === "994px", "--eg-screen-w, --eg-screen-h: the whole screen");
        check(s.radius === "30px", "--eg-window-radius: the card's corners");
        check(s.blur === null, "blur \"live\": no data-eg-blur");
        const glass = JSON.parse(s.glass || "null");
        check(glass && glass.window.y === 32 && glass.screen.height === 994 && glass.windowRadius === 30 && glass.blur === "live"
              && glass.wallpaperBlurred === picture && !("extra" in glass), "PalmSystem.glass: the data as JSON, only the contract's keys");
        let events = await page.evaluate(() => window.__glassEvents);
        check(events.length === 1 && events[0].window.height === 940, "a phoenixGlass event on document, its detail the data");
        await page.evaluate((d) => window.__phoenixRuntime.glassChanged(JSON.stringify(d)), data);
        events = await page.evaluate(() => window.__glassEvents);
        check(events.length === 1, "the same data again (as JSON): no second event");

        // The page's L1: each pixel of the picture where it lies on the screen.
        await page.waitForFunction(() => document.fonts.ready);
        await page.waitForTimeout(100);
        // Points across the viewport: its corners, its middle, near its foot.
        const pixels = async (file) => {
            await page.screenshot({ path: path.join(outDir, file) });
            const vp = page.viewportSize();
            const points = [[5, 5], [Math.round(vp.width / 3), Math.round(vp.height / 2)], [vp.width - 1, vp.height - 1],
                            [Math.round(vp.width * 0.7), vp.height - 40]];
            return page.evaluate(async ({ dataUrl, points }) => {
                const img = new Image();
                img.src = dataUrl;
                await img.decode();
                const c = document.createElement("canvas");
                c.width = img.width;
                c.height = img.height;
                const ctx = c.getContext("2d");
                ctx.drawImage(img, 0, 0);
                const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
                return points.map(([x, y]) => ({ x, y, rgba: at(x, y) }));
            }, { dataUrl: "data:image/png;base64," + fs.readFileSync(path.join(outDir, file)).toString("base64"), points });
        };
        const lined = (samples, w) => samples.every((p) => p.rgba[0] === (p.x + w.x) % 256 && p.rgba[1] === (p.y + w.y) % 256 && p.rgba[2] === 128);
        let samples = await pixels("maximized.png");
        check(lined(samples, win), "a maximized card: the page's pixel (x, y) is the picture's (x, y + 32), where it lies on the screen ("
              + samples.map((p) => `${p.x},${p.y}: ${p.rgba.slice(0, 3)}`).join("; ") + ")");

        // A window elsewhere (a tablet's card column, an alert): the same.
        const other = { x: 40, y: 120, width: 360, height: 600 };
        await page.setViewportSize({ width: other.width, height: other.height });
        await page.evaluate((d) => window.__phoenixRuntime.glassChanged(d), { wallpaperBlurred: picture, window: other, screen, windowRadius: 0, blur: "none" });
        s = await state();
        check(s.blur === "none" && s.radius === "0px", "blur \"none\": data-eg-blur=\"none\"; a window that is not a card: radius 0");
        samples = await pixels("elsewhere.png");
        check(lined(samples, other), "a window at (40, 120): its pixel (x, y) is the picture's (x + 40, y + 120)");

        // An address with a quote cannot break out of url("...").
        await page.evaluate(() => window.__phoenixRuntime.glassChanged({ wallpaperBlurred: 'file:///tmp/a"b.png', window: {}, screen: {} }));
        s = await state();
        check(s.wallpaper === 'url("file:///tmp/a%22b.png")', "a quote in the address is escaped (%22)");

        // No picture: the property goes, the page's background shows.
        await page.evaluate((d) => window.__phoenixRuntime.glassChanged(d), { wallpaperBlurred: "", window: other, screen, windowRadius: 0, blur: "live" });
        s = await state();
        check(s.wallpaper === "" && s.x === "40px" && s.blur === null, "no picture: --eg-wallpaper-blurred removed, the rest kept");
        samples = await pixels("no-picture.png");
        check(samples.every((p) => p.rgba[0] === 11 && p.rgba[1] === 11 && p.rgba[2] === 13), "... and the page's own background shows (the tint-only fallback)");

        // null (1.0's look): everything goes.
        await page.evaluate(() => window.__phoenixRuntime.glassChanged(null));
        s = await state();
        check(s.wallpaper === "" && s.x === "" && s.radius === "" && s.blur === null && s.glass === "", "null: the properties and PalmSystem.glass go");
        events = await page.evaluate(() => window.__glassEvents);
        check(events[events.length - 1] === null, "... and phoenixGlass says so (detail null)");

        check(errors.length === 0, "no errors in the page" + (errors.length ? ": " + errors.join("; ") : ""));
        await context.close();
    } finally {
        await browser.close();
    }
    if (failures) {
        console.log(failures + " failed");
        process.exit(1);
    }
    console.log("all passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
