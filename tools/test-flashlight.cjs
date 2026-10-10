#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Flashlight (apps/flashlight, built into dist/) in headless
// Chromium against the simulated org.webosports.service.torch (LuneOS
// torchd's API) in runtime/phoenix-runtime.js:
//
//   LED      the button lights the torch at 100%; the slider dims it; the
//            status line says so; another app turning it off is seen at
//            once (getStatus subscription); the screen does not time out
//            while lit (setWindowProperties {blockScreenTimeout})
//   close    closing the card puts the LED out, unless "Leave LED On When
//            Closed" is ticked in the app menu
//   screen   the Screen light is a white card, tapped away
//   no LED   on a device without a torch only the screen light is offered
//   launch   {on: true} lights it at once
//
//   node tools/test-flashlight.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// A response read to its end: one left unread, its socket closed under it,
// aborts Node's fetch (undici: assert(!this.paused), seen in CI).
async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const APP = "org.webosphoenix.flashlight";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "flashlight-tests", tablet ? "tablet" : "phone");
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
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/flashlight/dist/index.html"))) {
        console.error("apps/flashlight/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        // Record setWindowProperties calls (the runtime's is a no-op).
        await context.addInitScript(() => {
            window.__windowProps = [];
            const wrap = () => {
                if (!window.PalmSystem) return setTimeout(wrap, 0);
                const orig = window.PalmSystem.setWindowProperties;
                window.PalmSystem.setWindowProperties = (p) => { window.__windowProps.push(p); return orig && orig(p); };
            };
            wrap();
        });
        let page = await context.newPage();
        const errors = [];
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(e.message));
            p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
        };
        watch(page);
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (url, params, p = page) => p.evaluate(([u, q]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(q || {}));
        }), [url, params]);
        const status = () => page.textContent("[data-testid='status']");
        const torchState = (p = page) => luna("luna://org.webosports.service.torch/getStatus", {}, p);

        await page.goto(appUrl());
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl());
        await page.waitForSelector("[data-testid='power']:not([disabled])");
        check((await status()) === "LED off", "LED: starts off");
        await shot("off");

        // ---- LED ----------------------------------------------------------------------------
        await page.click("[data-testid='power']");
        await page.waitForFunction(() => document.querySelector("[data-testid='status']").textContent === "LED on, 100%");
        check((await torchState()).on === true, "LED: the button lights the torch at 100%");
        check(await page.evaluate(() => window.__windowProps.some((p) => p.blockScreenTimeout === true)), "LED: the screen does not time out while lit");
        await shot("led-on");
        const slider = await page.$("[data-testid='brightness-slider']");
        const box = await slider.boundingBox();
        await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
        await page.waitForTimeout(200);
        const dim = await torchState();
        check(dim.on && dim.brightness >= 35 && dim.brightness <= 50, `LED: the slider dims it (${dim.brightness}%)`);
        check(new RegExp(`LED on, ${dim.brightness}%`).test(await status()), "LED: the status line follows");
        // Another app puts it out: the app sees it.
        const other = await context.newPage();
        await other.goto(`${origin}/usr/palm/applications/org.webosphoenix.settings/index.html`);
        await luna("luna://org.webosports.service.torch/set", { on: false }, other);
        await page.waitForFunction(() => document.querySelector("[data-testid='status']").textContent === "LED off", null, { timeout: 3000 })
            .then(() => check(true, "LED: a change from another app shows at once"), () => check(false, "LED: a change from another app shows at once"));
        check(await page.evaluate(() => window.__windowProps.at(-1)?.blockScreenTimeout === false), "LED: the screen may time out again when off");
        await page.click("[data-testid='power']");
        await page.waitForFunction(() => /LED on/.test(document.querySelector("[data-testid='status']").textContent));
        check((await torchState()).brightness === dim.brightness, "LED: it comes back on at the chosen brightness");

        // ---- Closing the card ------------------------------------------------------------------
        await page.close({ runBeforeUnload: true });
        await other.waitForTimeout(300);
        check((await torchState(other)).on === false, "close: closing the card puts the LED out");
        page = await context.newPage();
        watch(page);
        await page.goto(appUrl({ on: true }));
        await page.waitForFunction(() => /LED on/.test(document.querySelector("[data-testid='status']")?.textContent ?? ""), null, { timeout: 5000 })
            .then(() => check(true, "launch {on: true}: lights it at once"), () => check(false, "launch {on: true}: lights it at once"));
        await page.evaluate(() => window.__phoenixRuntime.openAppMenu());
        await page.click("[data-testid='menu-keep-on']");
        await page.close({ runBeforeUnload: true });
        await other.waitForTimeout(300);
        check((await torchState(other)).on === true, "close: with Leave LED On When Closed, it stays on");
        await luna("luna://org.webosports.service.torch/set", { on: false }, other);

        // ---- Screen light ---------------------------------------------------------------------------
        page = await context.newPage();
        watch(page);
        await page.goto(appUrl());
        await page.waitForSelector("[data-testid='power']:not([disabled])");
        await page.click("[data-testid='mode-screen']");
        check((await status()) === "Screen light", "screen: the Screen light is chosen");
        await page.click("[data-testid='power']");
        await page.waitForSelector("[data-testid='screen-light']");
        const bg = await page.$eval("[data-testid='screen-light']", (e) => getComputedStyle(e).backgroundColor);
        check(bg === "rgb(255, 255, 255)", "screen: the whole card turns white");
        check((await torchState()).on === false, "screen: the LED stays off");
        await shot("screen-on");
        await page.click("[data-testid='screen-light']");
        await page.waitForSelector("[data-testid='screen-light']", { state: "detached" });
        check(true, "screen: a tap turns it off");
        await page.click("[data-testid='power']");
        await page.waitForSelector("[data-testid='screen-light']");
        await page.evaluate(() => window.__phoenixRuntime.back());
        await page.waitForSelector("[data-testid='screen-light']", { state: "detached", timeout: 2000 }).then(() => check(true, "screen: Back turns it off"),
            () => check(false, "screen: Back turns it off"));
        await page.click("[data-testid='mode-led']");

        // ---- No torch ------------------------------------------------------------------------------
        await page.evaluate(() => window.__phoenixRuntime.torch.setAvailable(false));
        await page.waitForFunction(() => /No flash LED/.test(document.querySelector("[data-testid='status']").textContent), null, { timeout: 3000 })
            .then(() => check(true, "no LED: only the screen light, and it says why"), () => check(false, "no LED: only the screen light, and it says why"));
        check(!(await page.$("[data-testid='mode-led']")) && !(await page.$("[data-testid='brightness']")), "no LED: no LED button or slider");
        await shot("no-led");
        await page.evaluate(() => window.__phoenixRuntime.torch.setAvailable(true));

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
