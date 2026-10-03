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
        // Every toast the page shows, as it shows it: a toast lasts 2.5 s,
        // and a busy machine can take longer than that between two steps.
        await context.addInitScript(() => {
            window.__toasts = [];
            const seen = new WeakSet();
            new MutationObserver(() => {
                const t = document.querySelector("[data-testid=toast]");
                if (t && !seen.has(t)) {
                    seen.add(t);
                    window.__toasts.push(t.textContent);
                }
            }).observe(document, { subtree: true, childList: true });
        });
        const page = await context.newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        // Wait for a toast with this text, shown since the last call.
        let toastsSeen = 0;
        const toast = async (text) => {
            const at = await page.waitForFunction(([t, from]) => {
                const i = window.__toasts.findIndex((s, n) => n >= from && s.includes(t));
                return i >= 0 ? i + 1 : false;
            }, [text, toastsSeen]).catch(async (e) => {
                // Say what was shown instead.
                const seen = await page.evaluate(() => window.__toasts).catch(() => []);
                throw new Error(`no "${text}" toast; shown: ${JSON.stringify(seen)}; page errors: ${JSON.stringify(errors)}\n${e.message}`);
            });
            toastsSeen = await at.jsonValue();
        };
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
        // Save asks where: Photos (over the capture) or Files (a copy).
        await page.click(".pui-popup >> text=Save to Photos");
        await toast("Saved");
        const after = await picture(want, 5, 0);
        check(after && after.width < 320 && after.height < 480 && after.width >= 200,
              `saved over the capture, cropped (${after && after.width}x${after && after.height})`);
        check(after && after.pixel[2] > 100 && after.pixel[0] < 100, "the crop starts below the white band (blue at the top)");
        const mid = await picture(want, Math.floor(after.width / 2), Math.floor(after.height / 2));
        check(mid && mid.pixel[0] > 200 && mid.pixel[1] < 120, `the red stroke is in it (${mid && mid.pixel})`);
        check(await page.locator("[data-testid=done]").count() === 1, "saved: Done again");
        await shot("4-saved");

        // ---- The system's share sheet (docs/SHARE-AND-FILES.md) -----------------------------------
        const sheet = async (kind) => {
            const el = await page.waitForSelector(`iframe[data-phoenix-sheet=${kind}]`);
            const f = await el.contentFrame();
            await f.waitForSelector(kind === "share" ? "[data-testid=share-sheet]" : "[data-testid=save-picker]");
            return f;
        };
        const sheetGone = () => page.waitForSelector("iframe[data-phoenix-sheet]", { state: "detached" });
        await page.click("[data-testid=share]");
        let f = await sheet("share");
        check((await f.textContent("[data-testid=share-title]")).includes("Email 2026-10-01 at 21.05.09"), "the sheet names what is shared");
        check(await f.locator("[data-testid=share-thumb]").count() === 1, "... with its thumbnail");
        const apps = await f.$$eval(".ss-app", (els) => els.map((e) => e.getAttribute("data-testid")));
        check(apps.includes("share-app-com.palm.app.email") && apps.includes("share-app-org.webosphoenix.messaging"),
              `the apps that take a picture: Email, and Messaging as a picture message (${apps.join(", ")})`);
        check(await f.locator("[data-testid=share-photos]").count() === 1 && await f.locator("[data-testid=share-files]").count() === 1,
              "Save to Photos and Save to Files");
        await shot("5-share-sheet");
        await f.click('[data-testid="share-app-com.palm.app.email"]');
        await sheetGone();
        await page.waitForTimeout(200);
        const launch = host.filter((m) => m.type === "launch").pop();
        check(launch && launch.payload.id === "com.palm.app.email" && launch.payload.params.attachments[0].fullPath === want,
              "Share > Email attaches it");

        // The back gesture closes the sheet, not the preview.
        await page.click("[data-testid=share]");
        await sheet("share");
        await page.evaluate(() => window.__phoenixRuntime.back());
        await sheetGone();
        check(await page.locator("[data-testid=preview]").count() === 1, "back closes the sheet; the preview stays");

        // Save to Files: edit, Save > Save to Files..., a new folder, a name.
        await page.click("[data-testid=markup]");
        await page.mouse.move(stage.x + 20, stage.y + 20);
        await page.mouse.down();
        await page.mouse.move(stage.x + 60, stage.y + 60, { steps: 4 });
        await page.mouse.up();
        await page.click("[data-testid=mode-done]");
        await page.click("[data-testid=save]");
        await page.click(".pui-popup >> text=Save to Files…");
        f = await sheet("save");
        const folderTitle = () => f.waitForFunction(() => {
            const el = document.querySelector("[data-testid=save-folder]");
            return el && document.querySelector("[data-testid=save-folders] [data-testid^=save-folder-], [data-testid=save-folders] .ss-empty") && el.textContent.trim();
        }).then((h) => h.jsonValue());
        check(await folderTitle() === "Documents", "the first time: Documents");
        await f.click("[data-testid=save-new-folder]");
        await f.fill("[data-testid=new-folder-name]", "Screens");
        await f.click("[data-testid=new-folder-create]");
        await f.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Screens");
        await f.fill("[data-testid=save-name]", "Edited capture.png");
        await shot("6-save-picker");
        await f.click("[data-testid=save-confirm]");
        await sheetGone();
        await toast("Saved to Screens");
        const saved2 = "/media/internal/Documents/Screens/Edited capture.png";
        const st = await luna("luna://org.webosphoenix.filemanager/stat", { path: saved2 });
        check(st.returnValue && st.entry.size > 0, "saved in the new folder, where Files sees it");
        const copy = await picture(saved2, 25, 25);
        check(copy && copy.width === after.width, `the edited picture (${copy && copy.width}x${copy && copy.height})`);
        check(await page.locator("[data-testid=revert]").count() === 1, "the capture itself keeps its edits unsaved (Save to Files is a copy)");

        // The last folder comes back; the same name asks before replacing.
        await page.click("[data-testid=save]");
        await page.click(".pui-popup >> text=Save to Files…");
        f = await sheet("save");
        check(await folderTitle() === "Screens", "the next time: the last folder used");
        await f.fill("[data-testid=save-name]", "Edited capture.png");
        await f.click("[data-testid=save-confirm]");
        await f.waitForSelector("[data-testid=replace-dialog]");
        check(true, "the same name: Replace asks first");
        await f.click("[data-testid=replace-confirm]");
        await sheetGone();
        await toast("Saved to Screens");
        check(true, "replaced");
        // Any app's share: a picture not yet in Photos goes to the Camera Roll.
        const openShare = (req) => page.evaluate((r) => {
            window.__shareResult = null;
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { window.__shareResult = JSON.parse(s); };
            b.call("luna://org.webosphoenix.share/open", JSON.stringify(r));
        }, req);
        const shareResult = () => page.waitForFunction(() => window.__shareResult).then((h) => h.jsonValue());
        // (Photos shows every folder of pictures: one in Documents is in Photos already.)
        await openShare({ files: [{ path: saved2, mimeType: "image/png" }] });
        f = await sheet("share");
        await f.click("[data-testid=share-photos]");
        await sheetGone();
        let rp = await shareResult();
        check(rp.action === "photos" && rp.already === true && rp.path === saved2, "a picture already in a Photos album is not copied again");
        const sample = "/media/internal/samples/photos/harbor-dusk.jpg";
        await openShare({ files: [{ path: sample, mimeType: "image/jpeg" }] });
        f = await sheet("share");
        await f.click("[data-testid=share-photos]");
        await sheetGone();
        rp = await shareResult();
        check(rp.action === "photos" && rp.path === "/media/internal/DCIM/100PHNX/harbor-dusk.jpg", `Save to Photos: a sample goes to the Camera Roll (${rp.path})`);
        const roll = await luna("luna://com.webos.service.mediaindexer/getImageList", { uri: "storage:///media/internal" });
        check(roll.imageList.results.some((i) => i.file_path === rp.path), "... and Photos shows it");

        // Text and a link: Messaging takes them, and Copy.
        await openShare({ text: "Look at this", url: "https://webosarchive.org/" });
        f = await sheet("share");
        const textApps = await f.$$eval(".ss-app", (els) => els.map((e) => e.getAttribute("data-testid")));
        check(textApps.includes("share-app-org.webosphoenix.messaging") && textApps.includes("share-app-com.palm.app.email"),
              `text: Messaging and Email (${textApps.join(", ")})`);
        check(await f.locator("[data-testid=share-copy]").count() === 1 && await f.locator("[data-testid=share-files]").count() === 0,
              "text: Copy, no Save to Files");
        await f.click('[data-testid="share-app-org.webosphoenix.messaging"]');
        await sheetGone();
        await shareResult();
        const msg = host.filter((m) => m.type === "launch").pop();
        check(msg && msg.payload.id === "org.webosphoenix.messaging" && msg.payload.params.share.url === "https://webosarchive.org/",
              "Share > Messaging gets {share: {text, url}}");

        // Save to Photos writes the edits over the capture.
        await page.click("[data-testid=save]");
        await page.click(".pui-popup >> text=Save to Photos");
        await page.waitForSelector("[data-testid=done]");
        check(true, "Save to Photos: saved over the capture (Done again)");

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
