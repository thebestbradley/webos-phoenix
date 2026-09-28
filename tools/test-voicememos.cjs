#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Voice Memos (apps/voicememos, built into dist/) in headless
// Chromium against the simulated services in runtime/phoenix-runtime.js,
// with Chromium's fake microphone (a beep):
//
//   list        the two demo memos are installed on first start, with
//               their titles, dates and lengths
//   record      the level meter moves and the time runs; pause holds the
//               time, resume and stop save a WAV under
//               /media/internal/voicememos that Files and the media
//               indexer see
//   play        the memo plays; the scrubber seeks
//   transcribe  the demo memo gives its known script; a recording gets
//               the "runs on the device" placeholder (never a made-up
//               transcript); transcripts are searchable in the app and
//               through Just Type's content search (appinfo.json dbsearch)
//   rename, share (Email with the file attached), delete (the file, its
//               index entry and the memo), "transcribe automatically",
//               and the Just Type launch params {memoId} and {newMemo}
//
//   node tools/test-voicememos.cjs [--tablet] [--out DIR]
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
const APP = "org.webosphoenix.voicememos";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "voicememos-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (params) => `${origin}/usr/palm/applications/${APP}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const SAMPLES = JSON.parse(fs.readFileSync(path.join(REPO, "apps/voicememos/public/samples/samples.json"), "utf8")).memos;
const APPINFO = JSON.parse(fs.readFileSync(path.join(REPO, "apps/voicememos/public/appinfo.json"), "utf8"));

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
    if (!fs.existsSync(path.join(REPO, "apps/voicememos/dist/index.html"))) {
        console.error("apps/voicememos/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
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
        await context.grantPermissions(["microphone"], { origin });
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
        const luna = (url, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [url, params]);
        const memoSel = (title) => `[data-testid='memo-${title}']`;
        const memoIds = () => page.evaluate(() => [...document.querySelectorAll("[data-memo-id]")].map((e) => e.getAttribute("data-memo-id")));
        const findMemos = async () => (await luna("luna://com.palm.db/find", { query: { from: "org.webosphoenix.voicememo:1" } })).results;
        const seconds = (s) => { const [m, x] = s.trim().split(":").map(Number); return m * 60 + x; };

        // Start from an empty device. The first start installs the demo
        // memos; let it finish, or it would go on writing after the wipe.
        await page.goto(appUrl());
        await page.waitForSelector(memoSel(SAMPLES[SAMPLES.length - 1].title), { timeout: 10000 });
        await page.evaluate(() => new Promise((res) => {
            localStorage.clear();
            const r = indexedDB.deleteDatabase("phoenix-media");
            r.onsuccess = r.onerror = r.onblocked = () => res();
        }));

        // ---- The list: the demo memos --------------------------------------------------
        await page.goto(appUrl());
        const [welcome, shopping] = SAMPLES;
        await page.waitForSelector(memoSel(welcome.title), { timeout: 10000 });
        await page.waitForSelector(memoSel(shopping.title));
        await page.waitForTimeout(300);
        await shot("list");
        const row = await page.textContent(memoSel(shopping.title));
        check(/0:07/.test(row) && /\d:\d\d [AP]M/.test(row), `list: the demo memos with time and length (${row.replace(/\s+/g, " ").trim()})`);
        const days = await page.$$eval(".pui-divider-caption", (els) => els.map((e) => e.textContent));
        check(days.includes("Sep 20") && days.includes("Sep 1"), `list: under day dividers (${days.join(", ")})`);
        let vfs = await luna("luna://org.webosphoenix.filemanager/list", { path: "/media/internal/voicememos" });
        check(vfs.returnValue && vfs.entries.length === 2, "list: the demo memos are files in /media/internal/voicememos");

        // ---- Record ---------------------------------------------------------------------
        await page.click("[data-testid='record']");
        await page.waitForSelector("[data-testid='recording']");
        await page.waitForFunction(() => /Recording/.test(document.querySelector("[data-testid='rec-state']").textContent), null, { timeout: 8000 });
        let maxLevel = 0;
        for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(80);
            maxLevel = Math.max(maxLevel, Number(await page.getAttribute("[data-testid='level']", "aria-valuenow")));
        }
        check(maxLevel > 0, `record: the level meter moves with the fake microphone (peak ${maxLevel} of 20 bars)`);
        await shot("recording");
        const t1 = seconds(await page.textContent("[data-testid='rec-time']"));
        check(t1 >= 1, `record: the time runs (${t1} s)`);
        await page.click("[data-testid='rec-pause']");
        await page.waitForFunction(() => /Paused/.test(document.querySelector("[data-testid='rec-state']").textContent));
        const p1 = await page.textContent("[data-testid='rec-time']");
        await page.waitForTimeout(1300);
        const p2 = await page.textContent("[data-testid='rec-time']");
        check(p1 === p2 && (await page.textContent("[data-testid='rec-pause']")).trim() === "Resume", `record: pause holds the time (${p1})`);
        await shot("recording-paused");
        await page.click("[data-testid='rec-pause']");
        await page.waitForTimeout(1200);
        await page.click("[data-testid='rec-stop']");
        await page.waitForSelector("[data-testid='recording']", { state: "detached", timeout: 10000 });
        await page.waitForSelector(memoSel("Memo 1"));
        const memos = await findMemos();
        const rec = memos.find((m) => m.title === "Memo 1");
        check(rec && /^\/media\/internal\/voicememos\/memo-\d{8}-\d{6}\.wav$/.test(rec.path), `record: saved as ${rec && rec.path}`);
        check(rec && rec.duration >= 2 && rec.duration < 4.5, `record: the pause is left out (${rec && rec.duration} s)`);
        const header = await page.evaluate((p) => window.__phoenixRuntime.mediaFiles.read(p).then((b) => b.slice(0, 44).arrayBuffer())
            .then((a) => { const v = new DataView(a); return { riff: String.fromCharCode(...new Uint8Array(a, 0, 4)), rate: v.getUint32(24, true), ch: v.getUint16(22, true) }; }), rec.path);
        check(header.riff === "RIFF" && header.rate === 16000 && header.ch === 1, "record: a 16 kHz mono WAV, as whisper.cpp reads it");
        vfs = await luna("luna://org.webosphoenix.filemanager/list", { path: "/media/internal/voicememos" });
        check(vfs.entries.some((e) => e.path === rec.path && e.size > 44), "record: Files sees the new file");
        const audio = await luna("luna://com.webos.service.mediaindexer/getAudioList", {});
        const indexed = audio.audioList.results.find((i) => i.file_path === rec.path);
        check(indexed && indexed.mime === "audio/wav" && indexed.duration > 1, `record: the media indexer has it (${indexed && indexed.duration} s)`);
        check(await page.locator(`${memoSel("Memo 1")} [data-testid='memo-detail']`).count() === 1, "record: the new memo is opened");
        await shot("recorded");

        // ---- Play ------------------------------------------------------------------------
        const mine = memoSel("Memo 1");
        await page.click(`${mine} [data-testid='play']`);
        await page.waitForFunction((s) => document.querySelector(s + " [data-testid='elapsed']").textContent !== "0:00" ||
            Number(document.querySelector(s + " [data-testid='scrubber']").getAttribute("aria-valuenow")) > 0, mine, { timeout: 6000 })
            .then(() => check(true, "play: the memo plays"), () => check(false, "play: the memo plays"));
        check((await page.getAttribute(`${mine} [data-testid='play']`, "aria-label")) === "Pause", "play: the button turns to pause");
        await page.click(`${mine} [data-testid='play']`);
        const track = await page.locator(`${mine} [data-testid='scrubber'] .pui-slider-track`).boundingBox();
        await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2);
        await page.waitForTimeout(300);
        const pos = await page.evaluate((s) => Number(document.querySelector(s + " [data-testid='scrubber']").getAttribute("aria-valuenow")), mine);
        const max = await page.evaluate((s) => Number(document.querySelector(s + " [data-testid='scrubber']").getAttribute("aria-valuemax")), mine);
        check(Math.abs(pos - max / 2) <= 1, `play: the scrubber seeks to the middle (${pos} of ${max} s)`);
        await shot("playing");

        // ---- Transcribe --------------------------------------------------------------------
        await page.click(`${mine} [data-testid='transcribe']`);
        await page.waitForSelector(`${mine} [data-testid='transcript']`, { timeout: 5000 });
        const placeholder = await page.textContent(`${mine} [data-testid='transcript']`);
        check(placeholder === "(transcription runs on the device with whisper.cpp)" &&
              await page.locator(`${mine} .vm-transcript.placeholder`).count() === 1,
              "transcribe: a recording gets the placeholder, not a made-up transcript");

        await page.click(`${memoSel(welcome.title)} .pui-row`);
        const w = memoSel(welcome.title);
        await page.waitForSelector(`${w} [data-testid='memo-detail']`);
        await page.click(`${w} [data-testid='transcribe']`);
        await page.waitForSelector(`${w} [data-testid='transcribing']`, { timeout: 3000 })
            .then(() => check(true, "transcribe: progress is shown"), () => check(false, "transcribe: progress is shown"));
        await page.waitForTimeout(350);
        await shot("transcribing");
        await page.waitForSelector(`${w} [data-testid='transcript']`, { timeout: 5000 });
        const said = (await page.textContent(`${w} [data-testid='transcript']`)).replace(/\s+/g, " ").trim();
        check(said === welcome.text, `transcribe: the demo memo gives its known text ("${said}")`);
        await shot("transcribed");

        await page.fill("[data-testid='search']", "red button");
        await page.waitForTimeout(200);
        let shown = await memoIds();
        check(shown.length === 1 && await page.locator(w).count() === 1, "search: \"red button\" finds the memo by its transcript");
        await shot("search");
        await page.fill("[data-testid='search']", "whisper");
        await page.waitForTimeout(200);
        check(await page.locator("[data-testid='no-match']").count() === 1, "search: the placeholder is not searchable");
        await page.fill("[data-testid='search']", "");
        const q = JSON.parse(JSON.stringify(APPINFO.universalSearch.dbsearch.dbQuery));
        q.where[0].val = "transcribe";
        const js = await luna("luna://com.palm.db/search", { query: q });
        check(js.returnValue && js.results.length === 1 && js.results[0].title === welcome.title,
              "Just Type: its content search (appinfo.json dbsearch) finds the memo by transcript");

        // ---- Rename -----------------------------------------------------------------------------
        await page.click(`${mine} .pui-row`);
        await page.click(`${mine} [data-testid='rename']`);
        await page.waitForSelector("[data-testid='rename-dialog']");
        await page.fill("[data-testid='rename-field']", "Garage sale");
        await shot("rename");
        await page.click("[data-testid='rename-ok']");
        await page.waitForSelector(memoSel("Garage sale"));
        check(await page.locator(memoSel("Memo 1")).count() === 0 && (await findMemos()).some((m) => m.title === "Garage sale" && m.path === rec.path),
              "rename: the memo has its new name (the file keeps its own)");

        // ---- Share -----------------------------------------------------------------------------
        const g = memoSel("Garage sale");
        await page.click(`${g} [data-testid='share']`);
        await page.waitForSelector(".pui-popup");
        const shareMenu = await page.textContent(".pui-popup");
        check(/Email/.test(shareMenu) && /Messaging/.test(shareMenu) && /Open in Music/.test(shareMenu), `share: ${shareMenu.replace(/([a-z])([A-Z])/g, "$1, $2")}`);
        await shot("share");
        host.length = 0;
        await page.click(".pui-menu-item:has-text('Email')");
        await page.waitForTimeout(200);
        const email = host.find((m) => m.type === "launch" && m.payload.id === "com.palm.app.email");
        check(email && email.payload.params.attachments[0].fullPath === rec.path && email.payload.params.attachments[0].mimeType === "audio/wav",
              "share: Email opens with the recording attached");

        // ---- Delete -------------------------------------------------------------------------------
        await page.click(`${g} [data-testid='delete']`);
        await page.waitForSelector("[data-testid='delete-dialog']");
        await page.waitForTimeout(300);
        await shot("delete");
        await page.click("[data-testid='delete-confirm']");
        await page.waitForSelector(g, { state: "detached" });
        vfs = await luna("luna://org.webosphoenix.filemanager/list", { path: "/media/internal/voicememos" });
        const left = (await luna("luna://com.webos.service.mediaindexer/getAudioList", {})).audioList.results.filter((i) => i.file_path === rec.path);
        check(!(await findMemos()).some((m) => m.path === rec.path) && !vfs.entries.some((e) => e.path === rec.path) && left.length === 0,
              "delete: the memo, its file and its index entry are gone");

        // ---- Transcribe automatically -----------------------------------------------------------
        await page.click("[data-testid='menu']");
        await page.click(".pui-menu-item:has-text('Preferences')");
        await page.waitForSelector("[data-testid='prefs-dialog']");
        await page.click("[data-testid='pref-auto']");
        await page.waitForTimeout(300);
        await shot("preferences");
        await page.click("[data-testid='prefs-done']");
        await page.click("[data-testid='record']");
        await page.waitForFunction(() => /Recording/.test(document.querySelector("[data-testid='rec-state']")?.textContent ?? ""), null, { timeout: 8000 });
        await page.waitForTimeout(1100);
        await page.click("[data-testid='rec-stop']");
        await page.waitForSelector(`${memoSel("Memo 1")} [data-testid='transcript']`, { timeout: 8000 })
            .then(() => check(true, "transcribe automatically: a new memo is transcribed when saved"),
                  () => check(false, "transcribe automatically: a new memo is transcribed when saved"));

        // ---- Just Type launch params ---------------------------------------------------------------
        const shopId = (await findMemos()).find((m) => m.title === shopping.title)._id;
        await page.goto(appUrl({ memoId: shopId }));
        await page.waitForSelector(`${memoSel(shopping.title)} [data-testid='memo-detail']`, { timeout: 8000 })
            .then(() => check(true, "launch {memoId}: opens that memo"), () => check(false, "launch {memoId}: opens that memo"));
        await page.goto(appUrl({ newMemo: "Call the plumber" }));
        await page.waitForSelector("[data-testid='recording']", { timeout: 8000 });
        check((await page.textContent(".vm-rec-title")) === "Call the plumber", "launch {newMemo}: records a memo with that title");
        await page.waitForFunction(() => /Recording/.test(document.querySelector("[data-testid='rec-state']").textContent), null, { timeout: 8000 });
        await page.click("[data-testid='rec-discard']");
        await page.waitForSelector("[data-testid='recording']", { state: "detached" });
        check(!(await findMemos()).some((m) => m.title === "Call the plumber"), "record: Discard saves nothing");
        await shot("final");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
