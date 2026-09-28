#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Load every web app from the virtual webOS filesystem in headless
// Chromium, the way phoenix-sim does, and check that it starts:
// no uncaught errors and something rendered. Headless (noWindow) apps are
// judged by the first window they open, which becomes their card.
//
//   node tools/test-apps.cjs [--tablet] [--out DIR] [appId ...]
//
// Needs Playwright (npm i -g playwright && npx playwright install chromium).
// tools/app-expectations.json says which apps must pass; the run fails if
// one of those breaks, and reports apps that start passing unexpectedly.

"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    const tries = ["playwright", path.join(require("child_process").execSync("npm root -g").toString().trim(), "playwright")];
    for (const t of tries) {
        try { return require(t); } catch (e) { /* next */ }
    }
    console.error("Playwright not found. Install it: npm i -g playwright && npx playwright install chromium");
    process.exit(2);
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "app-tests", tablet ? "tablet" : "phone");
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);

// Noise that does not mean the app failed to start.
const IGNORED = [
    /tellurium/i,                       // Palm's test harness config, never shipped
    /Failed to load resource/i,         // optional locale/resource probes
    /enyo\.xhr\.request\(\) exception/i,
    // Logged with console.error by the original apps in normal operation:
    /AppPrefs: Access to pref \w+ before prefs object is ready/,   // contacts framework, while its prefs load
    /_handleNewEmailsFromAutoFinder got 0 items/,                  // Email dashboard, when there is no new mail
    /Contact lookup failed: +No Accounts/                           // Email address lookup: no Exchange (GAL) account
];

function ignorable(msg) { return IGNORED.some((re) => re.test(msg)); }

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try {
            const r = await fetch(url);
            if (r.ok) return;
        } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const expectations = JSON.parse(fs.readFileSync(path.join(__dirname, "app-expectations.json"), "utf8"));

    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    let failed = false;
    try {
        await waitForServer(base + "/apps.json", 10000);
        const apps = (await (await fetch(base + "/apps.json")).json()).filter((a) => !only.length || only.includes(a.id) || only.includes(a.appId));
        const infos = {};
        const browser = await chromium.launch();
        const results = [];
        for (const app of apps) {
            const context = await browser.newContext({ viewport });
            const page = await context.newPage();
            const errors = [];
            const watch = (p) => {
                p.on("pageerror", (e) => errors.push(e.message));
                p.on("console", (m) => { if (m.type() === "error" && !ignorable(m.text())) errors.push(m.text().split("\n")[0]); });
            };
            watch(page);
            let shown = page;
            context.on("page", (p) => { watch(p); shown = p; });
            await page.goto(base + app.main);
            // Headless apps: the window they open is what the user sees. They
            // set up their data first (Email takes a few seconds), so wait for it.
            if (app.noWindow) {
                for (let t = 0; t < 15000 && shown === page; t += 250) await page.waitForTimeout(250);
                if (shown !== page) await shown.waitForLoadState().catch(() => {});
            }
            await page.waitForTimeout(3000);
            const shot = path.join(outDir, app.id + ".png");
            await shown.screenshot({ path: shot }).catch(() => {});
            const rendered = await shown.evaluate(() => {
                const els = document.body ? document.body.querySelectorAll("*").length : 0;
                const text = document.body ? document.body.innerText.trim().length : 0;
                return els > 10 && (text > 0 || document.querySelectorAll("img,canvas,svg").length > 0);
            }).catch(() => false);
            const real = errors.filter((e) => !ignorable(e));
            const pass = rendered && real.length === 0;
            // Launch points (e.g. Settings > Wi-Fi) share their app's expectation.
            const expect = expectations[app.id] || expectations[app.appId] || { status: "unknown" };
            const mustPass = expect.status === "works" || (tablet ? expect.tablet === "works" : expect.phone === "works");
            let verdict = pass ? "PASS" : "FAIL";
            if (!pass && mustPass) { failed = true; verdict = "FAIL (regression)"; }
            else if (!pass) verdict = "FAIL (known: " + (expect.note || expect.status) + ")";
            else if (!mustPass) verdict = "PASS (unexpected: mark it as working in app-expectations.json)";
            results.push({ id: app.id, title: app.title, pass, rendered, errors: real.slice(0, 5), screenshot: shot });
            console.log(`${verdict.padEnd(12)} ${app.id}${real.length ? "\n    " + real.slice(0, 3).join("\n    ") : ""}${!rendered ? "\n    (nothing rendered)" : ""}`);
            await context.close();
        }
        await browser.close();
        fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
        console.log(`\nScreenshots and results.json in ${outDir}`);
    } finally {
        server.kill();
    }
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
