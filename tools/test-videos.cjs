#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Videos (apps/videos, built into dist/) in headless Chromium
// against the simulated media indexer and file manager: the library of
// demo videos with their stills, playing one full screen and free to turn,
// subtitles (WebVTT and SRT, a language chosen from the menu), seeking,
// fit and fill, picking up where it was left, giving the audio focus up
// to another player, and videos handed over by Files ("Open with" and open
// by type) and by Photos ("Play in Videos").
//
//   node tools/test-videos.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "videos-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8500 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const APP = "org.webosphoenix.videos";
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const HARBOR = "/media/internal/samples/videos/harbor-timelapse.webm";
const CARDS = "/media/internal/samples/videos/card-shuffle.webm";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/videos/dist/index.html"))) {
        console.error("apps/videos/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p));
        }), [uri, params]);
        const time = () => page.evaluate(() => document.querySelector("[data-testid='video']")?.currentTime ?? -1);
        const caption = () => page.evaluate(() => document.querySelector("[data-testid='caption']")?.textContent ?? "");
        const lastHost = (type) => [...host].reverse().find((m) => m.type === type);
        const showControls = async () => {
            if (!(await page.evaluate(() => document.querySelector("[data-testid='player']").classList.contains("chrome"))))
                await page.mouse.click(viewport.width / 2, viewport.height / 2);
        };

        await page.goto(appUrl(APP));
        await page.evaluate(() => new Promise((res) => {
            localStorage.clear();
            const r = indexedDB.deleteDatabase("phoenix-media");
            r.onsuccess = r.onerror = r.onblocked = () => res();
        }));
        await page.reload();

        // ---- Library -------------------------------------------------------------------------
        await page.waitForSelector("[data-testid='video-Harbor Timelapse']");
        const names = await page.$$eval("[data-testid='library'] .pui-row-title", (els) => els.map((e) => e.textContent));
        check(names.join(",") === "Harbor Timelapse,Card Shuffle", `the library lists the demo videos, newest first (${names.join(", ")})`);
        check((await page.textContent("[data-testid='video-Harbor Timelapse'] .vi-badge")).trim() === "20 s", "with their length");
        await page.waitForFunction(() => document.querySelectorAll(".vi-poster img").length === 2, null, { timeout: 15000 })
            .then(() => check(true, "and a still of each"), () => check(false, "and a still of each"));
        await shot("library");

        // ---- Playing, subtitles ---------------------------------------------------------------
        host.length = 0;
        await page.click("[data-testid='video-Harbor Timelapse']");
        await page.waitForSelector("[data-testid='player']");
        await page.waitForFunction(() => document.querySelector("[data-testid='video']")?.currentTime > 0.5, null, { timeout: 10000 })
            .then(() => check(true, "plays"), () => check(false, "plays"));
        check(lastHost("windowOrientation")?.payload.orientation === "free", "the player is free to turn with the device");
        check(lastHost("fullScreen")?.payload.on === true, "and full screen");
        await page.waitForFunction(() => /harbor at dusk/.test(document.querySelector("[data-testid='caption']")?.textContent ?? ""), null, { timeout: 8000 })
            .then(() => check(true, "shows the English WebVTT subtitles"), () => check(false, "shows the English WebVTT subtitles"));
        await showControls();
        await page.waitForTimeout(200);
        await shot("player");

        await page.click("[data-testid='subtitles']");
        await page.waitForSelector(".pui-menu-item:has-text('Spanish')");
        await page.click(".pui-menu-item:has-text('Spanish')");
        await page.evaluate(() => { const v = document.querySelector("[data-testid='video']"); v.currentTime = 6; });
        await page.waitForFunction(() => /El sol/.test(document.querySelector("[data-testid='caption']")?.textContent ?? ""), null, { timeout: 8000 })
            .then(() => check(true, "switches to the Spanish SRT subtitles"), () => check(false, "switches to the Spanish SRT subtitles"));
        await showControls();
        await page.click("[data-testid='fit']");
        check(await page.evaluate(() => document.querySelector("[data-testid='video']").classList.contains("fill")), "fill crops the picture to the screen");
        await page.click("[data-testid='fit']");

        // Seeking with the keys, then another player takes the audio focus.
        await page.keyboard.press("ArrowRight");
        const t1 = await time();
        check(t1 >= 15, `the right arrow seeks ahead (${t1.toFixed(1)} s)`);
        await page.click("[data-testid='back10']");
        const t2 = await time();
        check(t2 < t1 - 5, `back 10 s (${t2.toFixed(1)} s)`);
        await luna("luna://com.webos.service.audiofocusmanager/requestFocus", { requestType: "AFREQUEST_GAIN", streamType: "pmedia", displayId: 0 });
        await page.waitForFunction(() => document.querySelector("[data-testid='video']").paused, null, { timeout: 5000 })
            .then(() => check(true, "pauses when another app takes the audio focus"), () => check(false, "pauses when another app takes the audio focus"));
        const left = await time();

        await page.click("[data-testid='player-back']");
        await page.waitForSelector("[data-testid='library']");
        check(lastHost("fullScreen")?.payload.on === false && lastHost("windowOrientation")?.payload.orientation === "up", "the library is upright and not full screen");
        const sub = await page.textContent("[data-testid='video-Harbor Timelapse'] .pui-row-subtitle");
        check(/^Resume at 0:?\d+/.test(sub) || /^Resume at \d+ s/.test(sub), `the library offers to resume (${sub})`);
        await shot("library-resume");

        await page.click("[data-testid='video-Harbor Timelapse']");
        await page.waitForSelector("[data-testid='toast']");
        check(/Resuming at/.test(await page.textContent("[data-testid='toast']")), "reopening resumes");
        const t3 = await time();
        check(Math.abs(t3 - left) < 1.5, `where it was left (${t3.toFixed(1)} s, left at ${left.toFixed(1)} s)`);
        await page.click("[data-testid='start-over']");
        check((await time()) < 1, "Start Over goes back to the beginning");
        await page.click("[data-testid='player-back']");

        // ---- Handed over by other apps ------------------------------------------------------------
        await page.goto(appUrl(APP, { target: "file://" + CARDS }));
        await page.waitForSelector("[data-testid='player']");
        check((await page.textContent("[data-testid='player-title']")) === "Card Shuffle", "a launch with {target} plays that video");
        await page.waitForFunction(() => /Every app is a card/.test(document.querySelector("[data-testid='caption']")?.textContent ?? ""), null, { timeout: 8000 })
            .then(() => check(true, "with the SRT subtitles beside it"), () => check(false, "with the SRT subtitles beside it"));
        await shot("launched");

        // Settings > Accessibility > Captions: subtitles turned off in the
        // player come on anyway.
        await showControls();
        await page.click("[data-testid='subtitles']");
        await page.click(".pui-menu-item:has-text('Off')");
        const captionAt = async () => {
            await page.goto(appUrl(APP, { target: "file://" + CARDS }));
            await page.waitForSelector("[data-testid='player']");
            return page.waitForFunction(() => /Every app is a card/.test(document.querySelector("[data-testid='caption']")?.textContent ?? ""), null, { timeout: 4000 })
                .then(() => true, () => false);
        };
        check(!(await captionAt()), "subtitles turned off stay off");
        await luna("luna://com.palm.systemservice/setPreferences", { accessibility: { captions: true } });
        check(await captionAt(), "with Captions on in Accessibility, they show anyway");
        await luna("luna://com.palm.systemservice/setPreferences", { accessibility: { captions: false } });

        const handlers = await luna("luna://com.webos.applicationManager/listAllHandlersForMime", { mime: "video/webm" });
        check((handlers.resources || []).map((r) => r.appId).join(",") === "org.webosphoenix.videos,org.webosphoenix.photos",
            "Videos is the first app for video/webm, then Photos");
        host.length = 0;
        await luna("luna://com.webos.applicationManager/open", { target: "file://" + HARBOR });
        const opened = lastHost("launch");
        check(opened && opened.payload.id === APP && opened.payload.params.target === "file://" + HARBOR, "opening a video file by type launches Videos");

        // Photos plays videos in place, and hands them to Videos.
        await page.goto(appUrl("org.webosphoenix.photos", { target: HARBOR }));
        await page.waitForSelector("[data-testid='viewer']");
        host.length = 0;
        await page.waitForTimeout(300);
        await shot("photos-video");
        await page.click("[data-testid='open-videos']");
        await page.waitForTimeout(300);
        const handed = lastHost("launch");
        check(handed && handed.payload.id === APP && handed.payload.params.target === HARBOR, "Photos' \"Play in Videos\" launches Videos with the file");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
