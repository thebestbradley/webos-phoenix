#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System notices end to end (docs/NOTICES.md): Settings (apps/settings,
// built into dist/) in headless Chromium, with runtime/phoenix-runtime.js
// running com.palm.update's notices (services/updates/notices.js) against
// the simulator's sample feed (server/notices/sample, a file:// in the
// rootfs, signed with the sample key the simulator's servers.json pins).
// Covers: the feed verifies and its notices for this device show once
// (the beta-only one does not), the Updates pane's check reads it too,
// dismissNotice, Phoenix announcements off, and a critical notice's popup
// alert (the runtime's com.webos.notification createAlert).
//
//   node tools/test-notices.cjs [--tablet] [--out DIR]
//
// Needs the apps built.

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "notices-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const U = "luna://com.palm.update/";
const SAMPLE = JSON.parse(fs.readFileSync(path.join(REPO, "server/notices/sample/public/notices.json"), "utf8"));

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
        try { const r = await fetch(url); await r.arrayBuffer(); return; } catch (e) { /* not up */ }
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
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const settingsUrl = (page) => `${origin}/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=` +
        encodeURIComponent(JSON.stringify({ page }));
    let browser;
    try {
        await waitFor(origin + "/apps.json");
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
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        // What the shell is told about a notice: Settings' own banner (the
        // service runs in Settings' page here) or a notification for it.
        const told = (title) => host.filter((m) => (m.type === "banner" || m.type === "notification") &&
                                                   String(m.payload.message || m.payload.title || "").includes(title));

        await page.goto(settingsUrl("screen"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(settingsUrl("screen"));
        await page.waitForSelector("[data-testid=announcements-toggle]");
        check(await page.getAttribute("[data-testid=announcements-toggle]", "aria-checked") === "true", "Phoenix announcements: on by default");

        // ---- The sample feed --------------------------------------------------------------------
        host.length = 0;
        const r = await luna(U + "checkNotices", {});
        check(r.returnValue === true && r.configured === true && r.error === null && r.sequence === SAMPLE.sequence,
              "the sample feed verifies with the pinned sample key" + (r.errorText ? ": " + r.errorText : ""));
        const ids = (r.notices || []).map((n) => n.id);
        const beta = SAMPLE.notices.find((n) => n.audience && n.audience.channels);
        check(ids.length === SAMPLE.notices.length - 1 && !ids.includes(beta.id), "the notices for this device (not the beta channel's)");
        await page.waitForTimeout(300);
        const info = SAMPLE.notices.find((n) => n.severity === "info" && !n.audience);
        const important = SAMPLE.notices.find((n) => n.severity === "important");
        const shownInfo = told(info.title);
        const params = shownInfo[0] && (typeof shownInfo[0].payload.params === "string" ? JSON.parse(shownInfo[0].payload.params) : shownInfo[0].payload.params);
        check(shownInfo.length === 1 && params && params.page === "updates", "the info notice is shown, and opens Settings > Updates");
        check(told(important.title).length === 1, "the important notice is shown");
        check(told(beta.title).length === 0, "the beta channel's is not");
        await page.locator("[data-testid=announcements]").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(outDir, "1-announcements.png") });

        // ---- Shown once; the Updates pane's check reads the feed too ----------------------------
        host.length = 0;
        await luna(U + "check", {});
        await page.waitForTimeout(500);
        const st = await luna(U + "getNotices", {});
        check(told(info.title).length === 0 && told(important.title).length === 0, "each notice is shown once");
        check(st.lastChecked && st.lastChecked !== r.lastChecked, "the Updates pane's check reads the notices feed too");
        // A new page (another start of the service): still once.
        await page.reload();
        await page.waitForSelector("[data-testid=announcements-toggle]");
        host.length = 0;
        await luna(U + "checkNotices", {});
        await page.waitForTimeout(300);
        check(told(info.title).length === 0, "... and after the service starts again");
        const d = await luna(U + "dismissNotice", { id: important.id });
        check(d.returnValue === true && d.notices.find((n) => n.id === important.id).dismissed === true, "dismissNotice keeps it dismissed");

        // ---- Announcements off: only critical ones ----------------------------------------------
        await page.click("[data-testid=announcements-toggle]");
        await page.waitForFunction(() => document.querySelector("[data-testid=announcements-toggle]").getAttribute("aria-checked") === "false");
        const off = await luna(U + "getNotices", {});
        check(off.enabled === false, "turned off in Screen & Lock: the service hears it");

        // ---- A critical notice's popup alert (com.webos.notification createAlert) ---------------
        host.length = 0;
        const a = await luna("luna://com.webos.notification/createAlert", {
            title: "Please update: security fix", message: "Phoenix 1.0.4 fixes a security problem.",
            buttons: [{ label: "Open", onclick: "luna://com.webos.applicationManager/launch",
                        params: { id: "org.webosphoenix.settings", params: { page: "updates" } } }, { label: "Close" }] });
        const alert = host.find((m) => m.type === "alert");
        check(a.returnValue === true && !!alert && alert.payload.alertId === a.alertId && alert.payload.buttons.length === 2 &&
              alert.payload.buttons[0].onclick === "luna://com.webos.applicationManager/launch",
              "createAlert: a popup alert in the shell, its buttons' calls with it");
        const bad = await luna("luna://com.webos.notification/createAlert", { message: "x", buttons: [{ label: "Go", onclick: "https://evil.example/" }] });
        check(bad.returnValue === false, "a button that is not a luna:// call is refused");
        const closed = await luna("luna://com.webos.notification/closeAlert", { alertId: a.alertId });
        check(closed.returnValue === true && host.some((m) => m.type === "alert" && m.payload.close === true), "closeAlert takes it away");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
