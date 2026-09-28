#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Camera, Photos and Music (apps/camera, apps/photos, apps/music,
// built into dist/) in headless Chromium against the simulated media
// services in runtime/phoenix-runtime.js:
//
//   Camera  takes a photo with Chromium's fake camera and records a short
//           video; the last-shot thumbnail asks the shell to open Photos
//   Photos  opens with those launch params, finds the photo in the Camera
//           Roll, swipes the viewer through the sample photos, sets a
//           wallpaper (checks the systemStatus the shell gets) and deletes
//           the photo
//   Music   plays a song, pauses, seeks, skips and changes the volume
//
//   node tools/test-media.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "media-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");

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
    for (const app of ["camera", "photos", "music"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch({
            args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        });
        const context = await browser.newContext({ viewport });
        await context.grantPermissions(["camera", "microphone"], { origin });
        const errors = [];
        const host = [];   // host messages from every page, oldest first
        const watch = (page) => {
            page.on("pageerror", (e) => errors.push(e.message));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
            });
        };
        const lastHost = (type) => [...host].reverse().find((m) => m.type === type);
        const page = await context.newPage();
        watch(page);
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });

        // Start from an empty device (the demo media is indexed again).
        await page.goto(appUrl("org.webosphoenix.photos"));
        await page.evaluate(() => new Promise((res) => {
            localStorage.clear();
            const r = indexedDB.deleteDatabase("phoenix-media");
            r.onsuccess = r.onerror = r.onblocked = () => res();
        }));

        // ---- Camera --------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.camera"));
        await page.waitForSelector("[data-testid='shutter']:not([disabled])", { timeout: 10000 });
        await page.waitForFunction(() => document.querySelector("video.cam-video").videoWidth > 0);
        check(await page.locator("[data-testid='no-camera']").count() === 0, "camera: the fake camera fills the viewfinder");
        await shot(page, "camera-viewfinder");
        check(await page.locator("[data-testid='last-shot']").isDisabled(), "camera: no last shot yet");
        await page.click("[data-testid='flash']");
        check((await page.getAttribute("[data-testid='flash']", "aria-label")) === "Flash: On", "camera: flash toggles to On");
        await page.click("[data-testid='shutter']");
        await page.waitForTimeout(170);
        await shot(page, "camera-capture");
        await page.waitForTimeout(330);
        await shot(page, "camera-capture-2");
        await page.waitForSelector("[data-testid='last-shot'] img", { timeout: 5000 });
        await page.waitForTimeout(800);
        await shot(page, "camera-after");
        const shots = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).imageList.results.filter((i) => i.file_path.includes("/DCIM/")));
            b.call("luna://com.webos.service.mediaindexer/getImageList", JSON.stringify({ uri: "storage:///media/internal/DCIM" }));
        }));
        check(shots.length === 1 && /\/DCIM\/100PHNX\/CIMG0001\.jpg$/.test(shots[0].file_path), "camera: photo saved and indexed as DCIM/100PHNX/CIMG0001.jpg");
        check(shots[0] && shots[0].width > 0 && shots[0].height > 0, `camera: the indexer knows its size (${shots[0] && shots[0].width}x${shots[0] && shots[0].height})`);

        await page.click("[data-testid='mode-video']");
        await page.click("[data-testid='shutter']");
        await page.waitForSelector("[data-testid='rec-time']");
        await page.waitForTimeout(1300);
        await shot(page, "camera-recording");
        await page.click("[data-testid='shutter']");
        await page.waitForSelector("[data-testid='rec-time']", { state: "detached" });
        await page.waitForFunction(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).videoList.count === 1);
            b.call("luna://com.webos.service.mediaindexer/getVideoList", "{}");
        }), null, { timeout: 8000 }).then(() => check(true, "camera: video recorded and indexed"),
            () => check(false, "camera: video recorded and indexed"));
        await page.click("[data-testid='mode-photo']");

        await page.waitForTimeout(300);
        host.length = 0;
        await page.click("[data-testid='last-shot']");
        await page.waitForTimeout(200);
        const launch = lastHost("launch");
        check(launch && launch.payload.id === "org.webosphoenix.photos" && launch.payload.params.imageList,
            "camera: the last shot asks the shell to open Photos with {imageList}");

        // ---- Photos --------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.photos", launch ? launch.payload.params : undefined));
        await page.waitForSelector("[data-testid='viewer']");
        const opened = await page.textContent("[data-testid='viewer-index']");
        check(/^\d+ of 2$/.test(opened.trim()), `photos: opens the new shot in the Camera Roll (${opened.trim()})`);
        await page.waitForFunction(() => { const i = document.querySelector(".ph-slide-media"); return i && (i.naturalWidth > 0 || i.videoWidth > 0 || i.readyState > 0); });
        await shot(page, "photos-launched");

        await page.keyboard.press("Escape");
        await page.waitForSelector(".ph-grid");
        check(await page.locator(".ph-cell").count() === 2, "photos: the Camera Roll has the photo and the video");
        await shot(page, "photos-camera-roll");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='albums']");
        await page.waitForTimeout(300);
        await shot(page, "photos-albums");

        await page.click("[data-testid='album-Sample Photos']");
        await page.waitForSelector("[data-testid='thumb-6']");
        await page.waitForTimeout(400);
        await shot(page, "photos-grid");
        await page.click("[data-testid='thumb-0']");
        await page.waitForSelector("[data-testid='viewer']");
        check((await page.textContent("[data-testid='viewer-index']")).trim() === "1 of 7", "photos: viewer on the first sample");
        const swipe = async (dx) => {
            const cx = viewport.width / 2, cy = viewport.height / 2;
            await page.mouse.move(cx, cy);
            await page.mouse.down();
            await page.mouse.move(cx + dx / 2, cy, { steps: 4 });
            await page.mouse.move(cx + dx, cy, { steps: 4 });
            await page.mouse.up();
            await page.waitForTimeout(400);
        };
        await swipe(-viewport.width * 0.6);
        check((await page.textContent("[data-testid='viewer-index']")).trim() === "2 of 7", "photos: swipe left shows the next photo");
        await swipe(-viewport.width * 0.6);
        await swipe(viewport.width * 0.6);
        check((await page.textContent("[data-testid='viewer-index']")).trim() === "2 of 7", "photos: swipe right goes back");
        await page.waitForTimeout(300);
        await shot(page, "photos-viewer");

        host.length = 0;
        await page.click("[data-testid='wallpaper']");
        await page.waitForSelector(".ph-toast");
        await page.waitForTimeout(200);
        const st = lastHost("systemStatus");
        const current = await page.evaluate(() => document.querySelector(".ph-viewer-title").textContent);
        check(st && /\/media\/internal\/samples\/photos\/.+\.jpg$/.test(st.payload.wallpaperFile), `photos: wallpaper preference set (${st && st.payload.wallpaperFile})`);
        check(st && /^data:image\/jpeg;base64,/.test(st.payload.wallpaperUrl || ""), "photos: the shell gets the wallpaper picture");
        check(current.length > 0, `photos: viewer title shows (${current})`);
        await shot(page, "photos-wallpaper");
        const prefs = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call("luna://com.webos.service.systemservice/getPreferences", JSON.stringify({ keys: ["wallpaper"] }));
        }));
        check(prefs.wallpaper && prefs.wallpaper.wallpaperFile === st.payload.wallpaperFile, "photos: getPreferences returns the same wallpaper Settings reads");

        await page.click("[data-testid='share']");
        await page.waitForSelector(".pui-popup");
        await shot(page, "photos-share");
        await page.keyboard.press("Escape");

        // Delete the camera photo.
        await page.goto(appUrl("org.webosphoenix.photos", { target: shots[0].file_path }));
        await page.waitForSelector("[data-testid='viewer']");
        await page.click("[data-testid='delete']");
        await page.waitForSelector("[data-testid='delete-dialog']");
        await page.waitForTimeout(400);
        await shot(page, "photos-delete");
        await page.click("[data-testid='delete-confirm']");
        await page.waitForFunction(() => /of 1$/.test(document.querySelector("[data-testid='viewer-index']")?.textContent ?? ""), null, { timeout: 5000 })
            .then(() => check(true, "photos: deleting leaves the video in the Camera Roll"), () => check(false, "photos: deleting leaves the video in the Camera Roll"));
        const left = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).imageList.results.filter((i) => i.file_path.includes("/DCIM/")).length);
            b.call("luna://com.webos.service.mediaindexer/getImageList", "{}");
        }));
        check(left === 0, "photos: the photo is gone from the index");

        // ---- Music -----------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.music"));
        await page.waitForSelector("[data-testid='artist-Pixel Sunrise']");
        await shot(page, "music-artists");
        await page.click("[data-testid='tab-albums']");
        await page.waitForSelector("[data-testid='album-Cartridge Dreams']");
        await shot(page, "music-albums");
        await page.click("[data-testid='album-Cartridge Dreams']");
        await page.waitForSelector("[data-testid='play-album']");
        await shot(page, "music-album");
        await page.keyboard.press("Escape");
        await page.click("[data-testid='tab-songs']");
        await page.waitForSelector("[data-testid='song-Morning Boot']");
        await shot(page, "music-songs");
        host.length = 0;
        await page.click("[data-testid='song-Morning Boot']");
        await page.waitForSelector("[data-testid='now-playing']");
        const elapsed = () => page.evaluate(() => {
            const [m, s] = document.querySelector("[data-testid='np-elapsed']").textContent.split(":").map(Number);
            return m * 60 + s;
        });
        const position = () => page.evaluate(() => Number(document.querySelector("[data-testid='np-seek']").getAttribute("aria-valuenow")));
        await page.waitForFunction(() => document.querySelector("[data-testid='np-elapsed']").textContent !== "0:00", null, { timeout: 8000 })
            .then(() => check(true, "music: the song plays"), () => check(false, "music: the song plays"));
        const np = lastHost("nowPlaying");
        check(np && np.payload.title === "Morning Boot" && np.payload.playing === true, "music: nowPlaying host message");
        await shot(page, "music-now-playing");

        await page.click("[data-testid='np-play']");
        await page.waitForTimeout(300);
        const p1 = await elapsed();
        await page.waitForTimeout(1300);
        check(await elapsed() === p1 && (await page.getAttribute("[data-testid='np-play']", "aria-label")) === "Play", "music: pause stops the clock");
        check(lastHost("nowPlaying").payload.playing === false, "music: the shell hears it paused");

        const track = await page.locator("[data-testid='np-seek'] .pui-slider-track").boundingBox();
        await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
        await page.waitForTimeout(300);
        const pos = await position();
        const dur = await page.evaluate(() => Number(document.querySelector("[data-testid='np-seek']").getAttribute("aria-valuemax")));
        check(Math.abs(pos - dur * 0.75) < 2 && dur > 20, `music: seek to 3/4 (${pos}s of ${dur}s)`);
        await page.click("[data-testid='np-play']");
        await page.waitForTimeout(2200);
        check(await position() > pos, "music: plays on from there");

        await page.click("[data-testid='np-next']");
        await page.waitForFunction(() => document.querySelector("[data-testid='np-title']").textContent !== "Morning Boot");
        check(true, `music: next song (${await page.textContent("[data-testid='np-title']")})`);

        const vol = await page.locator("[data-testid='np-volume'] .pui-slider-track").boundingBox();
        await page.mouse.click(vol.x + vol.width * 0.3, vol.y + vol.height / 2);
        await page.waitForTimeout(200);
        const v = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).volume);
            b.call("luna://com.webos.service.audio/getInputVolume", JSON.stringify({ streamType: "pmedia" }));
        }));
        check(v >= 25 && v <= 35, `music: volume sets the pmedia stream (${v})`);
        await page.waitForTimeout(500);
        await shot(page, "music-now-playing-2");
        await page.click("[data-testid='np-back']");
        await page.waitForSelector("[data-testid='mini-player']");
        await shot(page, "music-mini-player");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
