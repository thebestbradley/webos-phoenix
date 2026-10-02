#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Notification Lab (apps/notificationlab, built into dist/) in
// headless Chromium on runtime/phoenix-runtime.js, reading what it asks of
// the shell (the runtime's host messages):
//
//   activities  Download: an ongoing row whose progress moves each second;
//               Pause says so and holds it; Stop clears it. Sync: no
//               progress (-1). Three at once: three rows
//   notify      Banner: a banner; Dashboard and Popup Alert: windows of
//               type dashboard / popupalert, the app's own ?view= pages
//   tasks       In 10 Seconds: an activity whose callback relaunches the
//               lab; when due, the lab says so, posts a banner and a
//               dashboard and completes it
//   launch      {from: <activity id>}: the lab says which row was tapped
//
//   node tools/test-notificationlab.cjs [--tablet] [--out DIR]
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
const APP = "org.webosphoenix.notificationlab";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "notificationlab-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
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
    if (!fs.existsSync(path.join(REPO, "apps/notificationlab/dist/index.html"))) {
        console.error("apps/notificationlab/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
        });
        const ongoing = (id) => host.filter((m) => m.type === "ongoing" && m.payload.id === id).map((m) => m.payload);
        const last = (id) => { const o = ongoing(id); return o[o.length - 1] || {}; };
        // The host messages come through the console, a moment after.
        const until = async (f, ms = 3000) => {
            const end = Date.now() + ms;
            while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
            return f();
        };

        await page.goto(appUrl());
        await page.getByText("Live activities").waitFor();

        // ---- Live activities ----
        await page.getByTestId("start-download").click();
        await page.waitForFunction(() => document.querySelector("[data-testid^='run-download-']"));
        const dl = (await page.locator("[data-testid^='run-download-']").getAttribute("data-testid")).slice(4);
        check(last(dl) && last(dl).progress === 0 && last(dl).title === "Downloading Lab Sample.zip",
              "Download: an ongoing row at 0%");
        check(last(dl) && last(dl).params && last(dl).params.from === dl, "its tap opens the lab with {from: id}");
        await page.waitForTimeout(2300);
        check(last(dl) && last(dl).progress >= 10, `its progress moves (${last(dl) && last(dl).progress}%)`);
        await page.screenshot({ path: path.join(outDir, "running.png") });
        await page.getByTestId(`run-${dl}`).getByText("Pause").click();
        check(await until(() => /\(paused\)$/.test(last(dl).title || "")), "Pause says so");
        const held = last(dl).progress;
        await page.waitForTimeout(1500);
        check(last(dl).progress === held, "and holds it");
        await page.getByTestId(`run-${dl}`).getByText("Stop").click();
        check(await until(() => last(dl).clear === true), "Stop clears the row");

        await page.getByTestId("start-sync").click();
        await page.waitForFunction(() => document.querySelector("[data-testid^='run-sync-']"));
        const sync = (await page.locator("[data-testid^='run-sync-']").getAttribute("data-testid")).slice(4);
        check(await until(() => last(sync).progress === -1), "Sync: no progress bar (-1)");
        await page.getByTestId(`run-${sync}`).getByText("Stop").click();

        const before = new Set(host.filter((m) => m.type === "ongoing").map((m) => m.payload.id));
        await page.getByTestId("start-several").click();
        const newIds = () => [...new Set(host.filter((m) => m.type === "ongoing").map((m) => m.payload.id))].filter((id) => !before.has(id));
        await until(() => newIds().length >= 3);
        const added = newIds();
        check(added.length === 3, `Three at once: three rows (${added.join(", ")})`);
        await page.getByText("Stop All").click();
        check(await until(() => added.every((id) => last(id).clear === true)), "Stop All clears them");

        // ---- Notifications ----
        host.length = 0;
        await page.getByTestId("banner").click();
        await until(() => host.some((m) => m.type === "banner"));
        const b = host.find((m) => m.type === "banner");
        check(b && b.payload.message === "Hello from the Notification Lab" && JSON.parse(b.payload.params).from === "banner",
              "Banner: a banner that opens the lab");
        for (const [button, type, testId] of [["dashboard", "dashboard", "dashboard-view"], ["alert", "popupalert", "alert-view"]]) {
            const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId(button).click()]);
            await popup.waitForLoadState();
            check(popup.url().includes(`phoenixWindow=${type}`), `${button}: a window of type ${type}`);
            const shown = await popup.getByTestId(testId).isVisible().catch(() => false);
            check(shown, `${button}: the lab's own ?view= page`);
            await popup.screenshot({ path: path.join(outDir, `${button}.png`) });
            await popup.close();
        }

        // ---- Background task ----
        host.length = 0;
        await page.getByTestId("task-10").click();
        await page.getByText("Waiting").waitFor();
        const acts = await page.evaluate(() => __phoenixRuntime.activities.list());
        const task = acts.find((a) => a.name === "org.webosphoenix.notificationlab.task");
        check(task && task.callback.params.id === APP && task.state === "waiting", "In 10 Seconds: a waiting activity that relaunches the lab");
        const fired = await page.evaluate(() => __phoenixRuntime.activities.fireDue(Date.now() + 11000));
        check(fired === 1, "it comes due");
        await page.getByText(/Opened by the background task/).waitFor({ timeout: 5000 }).catch(() => {});
        check(await page.getByText(/Opened by the background task \(in 10 s\)/).isVisible(), "the lab says it was opened by the task");
        check(await until(() => host.some((m) => m.type === "banner" && /^Background task ran/.test(m.payload.message))), "a banner says it ran");
        await page.waitForFunction(() => __phoenixRuntime.activities.list().every((a) => a.name !== "org.webosphoenix.notificationlab.task"), null, { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => __phoenixRuntime.activities.list().every((a) => a.name !== "org.webosphoenix.notificationlab.task")),
              "the activity is completed");
        check(!(await page.getByText("Waiting").isVisible()), "and no longer waiting");

        // ---- Launched from a row ----
        await page.goto(appUrl({ from: "download-1" }));
        await page.getByText(/Opened from the live activity "download-1"/).waitFor({ timeout: 5000 }).catch(() => {});
        check(await page.getByText(/Opened from the live activity "download-1"/).isVisible(), "{from: id}: the lab says which row");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
