#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Screen captures past the shell (docs/SCREENSHOTS.md SC1-SC2), in headless
// Chromium: the runtime saves a capture the shell hands it
// (runtime.saveScreenshot), indexes it and posts the "Screen captured"
// notification; its preview (apps/screenshot, built into dist/) crops,
// marks up, saves, shares and deletes. The shell's part (the keys, the
// flash) is shell/tests/tst_screenshot.qml.
//
//   node tools/test-screenshot.cjs [--tablet] [--out DIR]
//
// Needs Playwright (npm i -g playwright && npx playwright install chromium).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const APP = "org.webosphoenix.screenshot";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "screenshot-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (params) => `${origin}/usr/palm/applications/${APP}/index.html` +
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
    if (!fs.existsSync(path.join(REPO, "apps/screenshot/dist/index.html"))) {
        console.error("apps/screenshot/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        await waitForServer(origin + "/apps.json", 10000);
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        // The picture at a path, decoded: its size and a pixel.
        const picture = (p, x, y) => page.evaluate(async ([p, x, y]) => {
            const blob = await window.__phoenixRuntime.mediaFiles.read(p);
            if (!blob) return null;
            const img = await createImageBitmap(blob);
            const c = document.createElement("canvas");
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return { width: img.width, height: img.height, pixel: Array.from(ctx.getImageData(x, y, 1, 1).data) };
        }, [p, x, y]);

        // ---- The shell hands the runtime a capture ----------------------------------------------
        await page.goto(appUrl());
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl());
        await page.waitForSelector("[data-testid=no-captures]");
        check(true, "no captures yet: the preview says how to take one");
        // A 320x480 capture: blue, a white band at the top.
        const data = await page.evaluate(() => {
            const c = document.createElement("canvas");
            c.width = 320; c.height = 480;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#1e4a8a"; ctx.fillRect(0, 0, 320, 480);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 320, 28);
            return c.toDataURL("image/png").split(",")[1];
        });
        const when = new Date(2026, 9, 1, 21, 5, 9).getTime();
        const saved = await page.evaluate(([d, t]) => window.__phoenixRuntime.saveScreenshot({ data: d, app: "Email", time: t }), [data, when]);
        const want = "/media/internal/screencaptures/Email 2026-10-01 at 21.05.09.png";
        check(saved === want, `saved as the original did, with an ISO date (${saved})`);
        const note = host.find((m) => m.type === "notification" && m.payload.appId === APP);
        check(note && note.payload.title === "Screen captured" && note.payload.params.path === want,
              "the \"Screen captured\" notification opens it in the preview");
        const list = await luna("luna://com.webos.service.mediaindexer/getImageList", { uri: "storage:///media/internal" });
        check(list.imageList.results.some((i) => i.file_path === want), "indexed: Photos shows it");

        // ---- The preview ------------------------------------------------------------------------------
        await page.goto(appUrl({ path: want }));
        await page.waitForSelector("[data-testid=preview][data-image-width='320']");
        check((await page.textContent("[data-testid=title]")).includes("Email 2026-10-01 at 21.05.09"), "the preview names the capture");
        check(await page.locator("[data-testid=done]").count() === 1, "unedited: Done");
        await shot("1-preview");

        // Crop: drag the bottom-right corner up and left, and the top-left corner down.
        await page.click("[data-testid=crop]");
        await page.waitForSelector("[data-testid=crop-frame]");
        const drag = async (sel, dx, dy) => {
            const b = await page.locator(sel).boundingBox();
            const x = b.x + b.width / 2, y = b.y + b.height / 2;
            await page.mouse.move(x, y);
            await page.mouse.down();
            for (let i = 1; i <= 6; ++i) await page.mouse.move(x + dx * i / 6, y + dy * i / 6);
            await page.mouse.up();
        };
        await drag("[data-testid=crop-br]", -60, -80);
        await drag("[data-testid=crop-tl]", 0, 60);     // past the 28 px band at either scale
        await shot("2-crop");
        await page.click("[data-testid=mode-done]");
        check(await page.locator("[data-testid=save]").count() === 1 && await page.locator("[data-testid=revert]").count() === 1,
              "edited: Revert and Save");

        // Markup: a red stroke across the middle.
        await page.click("[data-testid=markup]");
        check(await page.isDisabled("[data-testid=undo]"), "nothing to undo yet");
        const stage = await page.locator("[data-testid=canvas]").boundingBox();
        const sy = stage.y + stage.height / 2;
        await page.mouse.move(stage.x + 10, sy);
        await page.mouse.down();
        for (let i = 1; i <= 10; ++i) await page.mouse.move(stage.x + 10 + (stage.width - 20) * i / 10, sy);
        await page.mouse.up();
        check(!(await page.isDisabled("[data-testid=undo]")), "a stroke can be undone");
        await shot("3-markup");
        await page.click("[data-testid=mode-done]");
        await page.click("[data-testid=save]");
        await page.waitForSelector("[data-testid=toast]:has-text('Saved')");
        const after = await picture(want, 5, 0);
        check(after && after.width < 320 && after.height < 480 && after.width >= 200,
              `saved over the capture, cropped (${after && after.width}x${after && after.height})`);
        check(after && after.pixel[2] > 100 && after.pixel[0] < 100, "the crop starts below the white band (blue at the top)");
        const mid = await picture(want, Math.floor(after.width / 2), Math.floor(after.height / 2));
        check(mid && mid.pixel[0] > 200 && mid.pixel[1] < 120, `the red stroke is in it (${mid && mid.pixel})`);
        check(await page.locator("[data-testid=done]").count() === 1, "saved: Done again");
        await shot("4-saved");

        // Share to Email.
        await page.click("[data-testid=share]");
        await page.click(".pui-popup >> text=Email");
        await page.waitForTimeout(200);
        const launch = host.filter((m) => m.type === "launch").pop();
        check(launch && launch.payload.id === "com.palm.app.email" && launch.payload.params.attachments[0].fullPath === want,
              "Share > Email attaches it");

        // Delete.
        await page.click("[data-testid=delete]");
        await page.click("[data-testid=delete-confirm]");
        await page.waitForTimeout(300);
        check(await picture(want, 0, 0) === null, "Delete removes the file");
        const list2 = await luna("luna://com.webos.service.mediaindexer/getImageList", { uri: "storage:///media/internal" });
        check(!list2.imageList.results.some((i) => i.file_path === want), "... and its index entry");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
