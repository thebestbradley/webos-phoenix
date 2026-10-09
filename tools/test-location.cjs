#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Location Services in headless Chromium with the simulator's runtime:
//
//   Settings > Location Services   where the device is (GPS, then network),
//                                  the GPS and network handlers, Location
//                                  Services off and on
//   the location service           com.webos.service.location from another
//                                  app, and navigator.geolocation over it
//   permissions                    the first request with the system UI
//                                  running raises luna-systemui's own
//                                  location alert ("Don't Allow" refuses);
//                                  with none, the simulator allows; Settings
//                                  lists the apps and changes the answers
//
//   node tools/test-location.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "location-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8200 + Math.floor(Math.random() * 90);
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

const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
}), [uri, params]);

// navigator.geolocation in a page: {lat} or {code}.
const geo = (page) => page.evaluate(() => new Promise((res) => navigator.geolocation.getCurrentPosition(
    (p) => res({ lat: p.coords.latitude, accuracy: p.coords.accuracy }), (e) => res({ code: e.code }))));

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
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
        const errors = [];
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (m.type() === "error" && !/Failed to load resource|tellurium/.test(t)) errors.push(t);
            });
        };
        watch(page);
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const text = async (p = page) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        const openSettings = async () => {
            await page.goto(appUrl("org.webosphoenix.settings", { page: "location" }));
            await page.waitForSelector("[data-testid=location-toggle]");
            await page.waitForTimeout(600);
        };

        // ---- Settings -------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.settings", { page: "location" }));
        await page.evaluate(() => localStorage.clear());
        await openSettings();
        let t = await text();
        check(/San Jose, CA/.test(t) && /GPS, within 8 m/.test(t), "Settings shows where the device is, from GPS");
        check(/No app has asked/.test(t), "no app has asked yet");
        await shot("settings");
        await page.click("[data-testid=gps-toggle]");
        await page.waitForTimeout(600);
        t = await text();
        check(/Network, within 150 m/.test(t), "GPS off: the position comes from the network");
        await page.click("[data-testid=location-toggle]");
        await page.waitForTimeout(400);
        const h = await luna(page, "luna://com.webos.service.location/getAllLocationHandlers", {});
        check(h.handlers.every((x) => !x.state), "Location Services off turns both handlers off");
        check(/Apps cannot find where you are/.test(await text()), "and says what that means");
        await shot("settings-off");

        // An app asks while it is off.
        const app = await context.newPage();
        watch(app);
        await app.goto(appUrl("org.webosphoenix.tasks"));
        await app.waitForTimeout(600);
        let r = await luna(app, "luna://com.webos.service.location/getLocationUpdates", {});
        check(r.returnValue === false && r.errorCode === 5, "with it off, an app gets errorCode 5 (location off)");
        check((await geo(app)).code === 2, "and navigator.geolocation POSITION_UNAVAILABLE");

        await page.click("[data-testid=location-toggle]");
        await page.waitForTimeout(400);
        check((await luna(page, "luna://com.webos.service.location/getAllLocationHandlers", {})).handlers.every((x) => x.state),
              "Location Services on turns both handlers on");

        // ---- An app with no system UI to ask: allowed, and listed ---------------------
        r = await luna(app, "luna://com.webos.service.location/getLocationUpdates", {});
        check(r.returnValue && Math.abs(r.latitude - 37.3337) < 0.01 && r.errorCode === 0, "Tasks gets the position");
        const fix = await geo(app);
        check(Math.abs(fix.lat - 37.3337) < 0.01 && fix.accuracy === 8, "navigator.geolocation answers from the same service");
        const place = await luna(app, "luna://com.webos.service.location/getReverseLocation", { latitude: r.latitude, longitude: r.longitude });
        check(place.locality === "San Jose", "getReverseLocation names the place");
        await openSettings();
        await page.waitForSelector("[data-testid='app-org.webosphoenix.tasks']", { timeout: 3000 }).catch(() => {});
        check(await page.locator("[data-testid='app-org.webosphoenix.tasks']").count() === 1, "Settings lists Tasks under Apps");
        check(/Tasks/.test(await text()) && /Allowed/.test(await text()), "as allowed");
        await page.click("[data-testid='app-org.webosphoenix.tasks']");
        await page.click("role=option[name='Not allowed']");
        await page.waitForTimeout(300);
        await shot("settings-apps");
        r = await luna(app, "luna://com.webos.service.location/getLocationUpdates", {});
        check(r.returnValue === false && r.errorCode === 6, "Not allowed: Tasks gets errorCode 6 (permission denied)");
        check((await geo(app)).code === 1, "and navigator.geolocation PERMISSION_DENIED");
        await page.click("[data-testid='app-org.webosphoenix.tasks']");
        await page.click("role=option[name='Ask next time']");
        await page.waitForTimeout(300);
        check(await page.locator("[data-testid='app-org.webosphoenix.tasks']").count() === 0, "Ask next time forgets the answer");

        // ---- With the system UI running: luna-systemui's location alert --------------
        const sysui = await context.newPage();
        const popups = [];
        context.on("page", (p) => popups.push(p));
        await sysui.goto(`${origin}/usr/palm/applications/com.palm.systemui/index.html`);
        await sysui.waitForTimeout(2500);
        const music = await context.newPage();
        watch(music);
        await music.goto(appUrl("org.webosphoenix.music"));
        await music.waitForTimeout(800);
        const asking = luna(music, "luna://com.webos.service.location/getLocationUpdates", {});
        let alert = null;
        for (let i = 0; i < 40 && !alert; ++i) {
            await new Promise((res) => setTimeout(res, 150));
            for (const p of popups) {
                const u = p.url();
                if (/systemmanageralerts/.test(u)) alert = p;
            }
        }
        check(!!alert, "the first request raises luna-systemui's location alert");
        if (alert) {
            // The alert takes "ignore" as its answer when its window is
            // deactivated (LocationAlert.handleWindowDeActivated): keep it in front.
            await alert.bringToFront();
            await alert.waitForTimeout(1200);
            const at = await text(alert);
            check(/Location Services/.test(at) && /Music/.test(at), "the alert names Location Services and the app (" + at.slice(0, 80) + ")");
            await alert.screenshot({ path: path.join(outDir, "systemui-alert.png") });
            // The alert closes its own window from the tap handler, so the page can be gone
            // before Playwright finishes the click; that is the expected outcome, not an error.
            await alert.getByText("Don't Allow", { exact: true }).click().catch((e) => {
                if (!alert.isClosed()) throw e;
            });
        }
        r = await asking;
        check(r.returnValue === false && r.errorCode === 6, "Don't Allow: Music is refused");
        // localStorage reaches other pages a moment later (Chromium commits it in batches).
        for (let i = 0; i < 10; ++i) {
            await openSettings();
            if (await page.locator("[data-testid='app-org.webosphoenix.music']").count()) break;
            await page.waitForTimeout(500);
        }
        check(/Music/.test(await text()) && /Not allowed/.test(await text()), "Settings lists Music, not allowed");

        // The alert lives as long as the app that asked: when the app is
        // closed (the shell tells the system UI, runtime.appClosed), its
        // alert goes, unanswered.
        const tasks = await context.newPage();
        watch(tasks);
        await tasks.goto(appUrl("org.webosphoenix.tasks"));
        await tasks.waitForTimeout(800);
        popups.length = 0;
        luna(tasks, "luna://com.webos.service.location/getLocationUpdates", {}).catch(() => {});
        alert = null;
        for (let i = 0; i < 40 && !alert; ++i) {
            await new Promise((res) => setTimeout(res, 150));
            alert = popups.find((p) => /systemmanageralerts/.test(p.url()) && !p.isClosed()) || null;
        }
        check(!!alert, "another app's request raises the alert again");
        if (alert) {
            await alert.bringToFront();
            await alert.waitForTimeout(800);
            check(await sysui.evaluate(() => __phoenixRuntime.appClosed("org.webosphoenix.music")) === false && !alert.isClosed(),
                  "another app closing leaves the alert");
            await tasks.close();
            check(await sysui.evaluate(() => __phoenixRuntime.appClosed("org.webosphoenix.tasks")) === true,
                  "the app that asked closes: the system UI closes its alert");
            for (let i = 0; i < 20 && !alert.isClosed(); ++i) await new Promise((res) => setTimeout(res, 100));
            check(alert.isClosed(), "the alert's window is gone");
        }

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
