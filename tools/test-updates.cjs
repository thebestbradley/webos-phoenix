#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System updates end to end: Settings > Updates (apps/settings, built into
// dist/) in headless Chromium, with runtime/phoenix-runtime.js running the
// device's com.palm.update service over the simulated RAUC, against an
// update feed made by server/updates/bin/updates.php and served by PHP's
// built-in server. Covers: up to date, an update found with its notes,
// downloaded and prepared (an ongoing activity in the notification area
// meanwhile), what luna-systemui hears (Available, Countdown), Install
// later and the next charge, a low battery, Install now and the restart
// into the new system, and the "Updated" notification.
//
//   node tools/test-updates.cjs [--tablet] [--out DIR]
//
// Needs PHP 8 and the apps built.

"use strict";
const { spawn, execSync, execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "updates-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const U = "luna://com.palm.update/";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}
async function waitFor(url) {
    for (let i = 0; ; i++) {
        try { await drained(fetch(url)); return; } catch (e) { /* not up */ }
        if (i > 100) throw new Error("did not start: " + url);
        await new Promise((r) => setTimeout(r, 100));
    }
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });

    const feed = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-feed-"));
    const publish = (...a) => execFileSync("php", [path.join(REPO, "server/updates/bin/updates.php"), ...a],
                                           { env: Object.assign({}, process.env, { UPDATES_FEED: feed }) }).toString();
    const feedPort = await freePort();
    const feedServer = spawn("php", ["-S", "127.0.0.1:" + feedPort, "-t", feed], { stdio: "ignore" });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const settingsUrl = (params) => `${origin}/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=` +
        encodeURIComponent(JSON.stringify(Object.assign({ page: "updates" }, params || {})));
    let browser;
    try {
        await waitFor(origin + "/apps.json");
        await waitFor(`http://127.0.0.1:${feedPort}/`);
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
        const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(outDir, name + ".png") }); };
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        // What luna-systemui hears: a GetStatus subscription kept in the page.
        const listenPalm = () => page.evaluate((u) => {
            window.__palm = [];
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => window.__palm.push(JSON.parse(s));
            b.call(u + "GetStatus", JSON.stringify({ subscribe: true }));
            window.__palmBridge = b;
        }, U);
        const palm = () => page.evaluate(() => window.__palm.filter((r) => r.status).map((r) => r.status));
        const status = async () => (await page.textContent("[data-testid=update-status]")).trim();

        await page.goto(settingsUrl());
        await page.evaluate((f) => {
            localStorage.clear();
            // The feed: servers.json's "updates" with Developer Mode's override
            // (runtime/phoenix-runtime.js "Platform servers").
            localStorage.setItem("phoenix:devMode", "true");
            localStorage.setItem("phoenix:platform:servers", JSON.stringify({ updates: { url: f } }));
        }, `http://127.0.0.1:${feedPort}/`);
        await page.goto(settingsUrl());

        // ---- Up to date: nothing published for the simulator yet --------------------------------
        await page.waitForSelector("[data-testid=check-updates]");
        check((await page.textContent("[data-testid=update-current]")).includes("0.1.0"), "the running system: 0.1.0");
        await page.click("[data-testid=check-updates]");
        await page.waitForFunction(() => !/Never|Now/.test(document.querySelector("[data-testid=update-last-checked]").textContent));
        check(/up to date/.test(await status()), "nothing on the feed: up to date");
        await shot("1-up-to-date");

        // ---- An update ----------------------------------------------------------------------------
        publish("simulator", "--version", "0.2.0", "--build", "2", "--note", "Faster card switching", "--note", "The Marketplace");
        await page.click("[data-testid=check-updates]");
        await page.waitForSelector("[data-testid=update-download]");
        check(/available/.test(await status()), "the update is found");
        const notes = await page.textContent("[data-testid=update-notes]");
        check(/Faster card switching/.test(notes) && /The Marketplace/.test(notes), "its notes show");
        await shot("2-available");

        await listenPalm();
        host.length = 0;
        await page.click("[data-testid=update-download]");
        await page.waitForSelector("[data-testid=update-install]", { timeout: 20000 });
        check(/Ready to install/.test(await status()), "downloaded and prepared: ready to install");
        const ongoing = host.filter((m) => m.type === "ongoing");
        check(ongoing.some((m) => m.payload.title === "Downloading webOS Phoenix 0.2.0") &&
              ongoing.some((m) => /^Preparing/.test(m.payload.title || "") && m.payload.progress === 100),
              "the download and the preparing are an ongoing activity, with progress");
        check(ongoing.length > 0 && ongoing[ongoing.length - 1].payload.clear === true, "the ongoing activity ends with them");
        const slots = await page.evaluate(() => JSON.parse(localStorage.getItem("phoenix:updates:slots")));
        check(slots.slots["rootfs.1"].version === "0.2.0" && slots.primary === "rootfs.0",
              "written to the other slot; this one stays the one that starts");
        check((await palm()).includes("Available"), "luna-systemui hears Available (its \"Update Available\" alert)");
        await shot("3-ready");

        // ---- Install later: again at the next charge --------------------------------------------
        await page.evaluate(() => window.__phoenixRuntime.setPower({ percent: 60, charger: "none" }));
        await page.click("[data-testid=update-later]");
        await page.waitForFunction(() => /next connect the charger/.test(document.querySelector("[data-testid=update-status]").textContent));
        check(true, "Install later: it will be installed at the next charge");
        await page.evaluate(() => window.__phoenixRuntime.setPower({ charger: "wall" }));
        await page.waitForFunction(() => window.__palm.some((r) => r.status === "Countdown"), null, { timeout: 5000 });
        const countdown = await page.evaluate(() => window.__palm.find((r) => r.status === "Countdown"));
        check(countdown.version === "webOS Phoenix 0.2.0" && countdown.showLaterButton === true && countdown.countdownTime > 0,
              "the charger: luna-systemui hears Countdown (its countdown alert)");
        await shot("4-later");

        // ---- Install now: the battery, then the restart -----------------------------------------
        await page.evaluate(() => window.__phoenixRuntime.setPower({ percent: 10, charger: "none" }));
        await page.click("[data-testid=update-install]");
        await page.waitForSelector("[data-testid=update-error]");
        check(/Charge the battery to 20%/.test(await page.textContent("[data-testid=update-error]")), "a low battery: not now");
        check((await palm()).includes("InsufficientCharge"), "luna-systemui hears InsufficientCharge");
        await page.evaluate(() => window.__phoenixRuntime.setPower({ charger: "wall" }));
        host.length = 0;
        await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click("[data-testid=update-install]")]);
        await page.waitForSelector("[data-testid=update-current]");
        await page.waitForFunction(() => /0\.2\.0/.test(document.querySelector("[data-testid=update-current]").textContent));
        check(true, "restarted into the new system: 0.2.0");
        const os2 = await luna("luna://com.webos.service.systemservice/osInfo/query", { parameters: ["webos_release", "webos_build_id"] });
        check(os2.webos_release === "0.2.0" && os2.webos_build_id === "2", "osInfo says 0.2.0, build 2");
        await page.waitForFunction(() => /up to date/.test(document.querySelector("[data-testid=update-status]").textContent));
        check(true, "and it is up to date");
        await page.waitForTimeout(500);
        // From Settings itself, a banner for Settings; from another page, a notification.
        const told = host.find((m) => /Updated to webOS Phoenix 0.2.0/.test(m.payload.message || m.payload.title || ""));
        const toldParams = told && (typeof told.payload.params === "string" ? JSON.parse(told.payload.params) : told.payload.params);
        check(!!told && toldParams && toldParams.page === "updates", "it says it was updated (and opens Updates)");
        await shot("5-updated");

        // ---- The preferences --------------------------------------------------------------------
        await page.click("[data-testid=update-auto]");
        const st = await luna(U + "getStatus", {});
        check(st.autoDownload === false, "automatic downloads can be switched off");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        feedServer.kill();
        fs.rmSync(feed, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
