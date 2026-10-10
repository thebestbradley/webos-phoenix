#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The page side of rotation (runtime/phoenix-runtime.js), with an original
// Enyo 1.0 app (Calculator) in headless Chromium:
//
//  * the app's orientation request reaches the shell: Enyo calls
//    PalmSystem.setWindowOrientation("free") once loaded (enyo.ready ->
//    enyo.setAllowedOrientation), and enyo.setAllowedOrientation("up")
//    asks for "up", each as a "windowOrientation" host message;
//  * the shell turning the window reaches the app: the page is resized to
//    the turned card and __phoenixRuntime.screenOrientationChanged() sets
//    PalmSystem.screenOrientation, and Enyo's windowRotated event follows,
//    also for a half turn where the size does not change;
//  * com.palm.systemmanager/getSystemStatus reports how the UI and the
//    device are turned, as the shell last said;
//  * the adaptive simulator's window resized past the tablet threshold
//    (applyHostStatus {screen, formFactor}): PalmSystem.deviceInfo and
//    com.palm.systemservice/deviceInfo/query report the new screen.
//
//   node tools/test-orientation.cjs [--tablet] [--out DIR]

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
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "orientation-tests", tablet ? "tablet" : "phone");
// The maximized card upright, and turned (phone: 480 - 28 bar, gesture
// area outside the screen; tablet: 1024 x 768 - 28).
const upright = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const sideways = tablet ? { width: 768, height: 996 } : { width: 460, height: 292 };
const port = 8880 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}/usr/palm/applications/com.palm.app.calculator/index.html`;

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
    if (!fs.existsSync(path.join(REPO, "third_party/core-apps/com.palm.app.calculator/appinfo.json"))) {
        console.error("third_party/core-apps is missing: git submodule update --init");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport: upright });
        const page = await context.newPage();
        const errors = [];
        const requests = [];   // windowOrientation payloads
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) {
                const msg = JSON.parse(t.slice(11));
                if (msg.type === "windowOrientation") requests.push(msg.payload.orientation);
            }
        });
        await page.goto(base);
        await page.waitForFunction(() => window.enyo && enyo.windows && document.body.children.length > 0, null, { timeout: 15000 });
        await page.waitForTimeout(500);

        // ---- The app's request reaches the shell -------------------------------------
        check(requests.includes("free"), "Enyo asks for \"free\" once loaded (enyo.setAllowedOrientation)");
        await page.evaluate(() => enyo.setAllowedOrientation("up"));
        await page.waitForTimeout(100);
        check(requests[requests.length - 1] === "up", "enyo.setAllowedOrientation(\"up\") reaches the shell");
        check(await page.evaluate(() => PalmSystem.specifiedWindowOrientation) === "up", "PalmSystem.specifiedWindowOrientation follows");

        // ---- The shell turns the window ---------------------------------------------------
        await page.evaluate(() => {
            window.__rotated = [];
            enyo.dispatcher.features.push(function (e) { if (e.type === "windowRotated") window.__rotated.push(e.orientation); });
        });
        check(await page.evaluate(() => PalmSystem.screenOrientation) === "up", "starts upright");
        // As phoenix-sim does: the card is resized, and the page told.
        await page.setViewportSize(sideways);
        await page.evaluate(() => __phoenixRuntime.screenOrientationChanged("left"));
        await page.waitForTimeout(200);
        check(await page.evaluate(() => PalmSystem.screenOrientation) === "left", "PalmSystem.screenOrientation is \"left\"");
        check(await page.evaluate(() => PalmSystem.windowOrientation) === "left", "PalmSystem.windowOrientation is \"left\"");
        check(await page.evaluate(() => enyo.getWindowOrientation()) === "left", "enyo.getWindowOrientation() is \"left\"");
        check((await page.evaluate(() => window.__rotated)).includes("left"), "Enyo sends windowRotated \"left\"");
        await page.screenshot({ path: path.join(outDir, "left.png") });
        // Half a turn: the size stays, the app still hears of it.
        await page.evaluate(() => __phoenixRuntime.screenOrientationChanged("right"));
        await page.waitForTimeout(200);
        check((await page.evaluate(() => window.__rotated)).slice(-1)[0] === "right", "a half turn sends windowRotated \"right\"");
        await page.setViewportSize(upright);
        await page.evaluate(() => __phoenixRuntime.screenOrientationChanged("up"));
        await page.waitForTimeout(200);
        check((await page.evaluate(() => window.__rotated)).slice(-1)[0] === "up", "back upright");
        await page.screenshot({ path: path.join(outDir, "up.png") });

        // ---- getSystemStatus ----------------------------------------------------------------
        const status = () => page.evaluate(() => new Promise((resolve) => {
            __phoenixRuntime.dispatch("luna://com.palm.systemmanager/getSystemStatus", {}, resolve,
                                      { cancelled: function () { return false; }, onCancel: null });
        }));
        let s = await status();
        check(s && s.returnValue && s.orientation && s.orientation.ui === "up", "getSystemStatus: upright by default");
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ orientation: { ui: "up", device: "left" } }));
        s = await status();
        check(s.orientation.ui === "up" && s.orientation.device === "left", "getSystemStatus: the device turned, the UI held (" + JSON.stringify(s.orientation) + ")");

        // ---- The screen resized (the adaptive simulator) ------------------------------------
        const info = () => page.evaluate(() => JSON.parse(PalmSystem.deviceInfo));
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ formFactor: "phone", screen: { width: 393, height: 852 } }));
        let d = await info();
        check(d.screenWidth === 393 && d.screenHeight === 852, "deviceInfo: the shell's screen (" + d.screenWidth + "x" + d.screenHeight + ")");
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ formFactor: "tablet", screen: { width: 1180, height: 820 } }));
        d = await info();
        check(d.screenWidth === 1180 && d.screenHeight === 820, "deviceInfo follows a resize to a tablet (" + d.screenWidth + "x" + d.screenHeight + ")");
        const q = await page.evaluate(() => new Promise((resolve) => {
            __phoenixRuntime.dispatch("luna://com.palm.systemservice/deviceInfo/query", {}, resolve,
                                      { cancelled: function () { return false; }, onCancel: null });
        }));
        check(q && q.screenWidth === 1180, "deviceInfo/query reports it too");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
