#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Accessibility > Text size in headless Chromium with the
// simulator's runtime: the system preference accessibility.textSize (a
// percentage) sets every page's root font size, so what is sized in rem
// (Ember Glass's --eg-text-*, --eg-space-*) follows it, at once and in the
// apps already open; at the default (100) the page's root is left alone.
//
//   node tools/test-text-size.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// A response read to its end (see test-emergency.cjs).
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "text-size-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8400 + Math.floor(Math.random() * 90);
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
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
}), [uri, params]);

// The page's root: its inline font size, and the computed size of the root
// and of a 1rem / --eg-style 0.875rem element.
const root = (page) => page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;font-size:0.875rem;padding:1rem";
    probe.textContent = "Aa";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const r = { inline: document.documentElement.style.fontSize,
                px: parseFloat(getComputedStyle(document.documentElement).fontSize),
                text: parseFloat(cs.fontSize), space: parseFloat(cs.paddingTop) };
    probe.remove();
    return r;
});
const near = (a, b) => Math.abs(a - b) < 0.05;

async function main() {
    for (const app of ["settings", "tasks"])
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
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
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });

        await page.goto(appUrl("org.webosphoenix.settings", { page: "accessibility" }));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.settings", { page: "accessibility" }));
        await page.waitForSelector("[data-testid=a11y-textSize]");

        // ---- The default: nothing changes --------------------------------------------
        let r = await root(page);
        check(r.inline === "" && near(r.px, 16) && near(r.text, 14) && near(r.space, 16),
              `at the default the root is the page's own 16px (${JSON.stringify(r)})`);
        const other = await context.newPage();
        other.on("pageerror", (e) => errors.push(e.message));
        await other.goto(appUrl("org.webosphoenix.tasks"));
        await other.waitForTimeout(800);
        check((await root(other)).inline === "", "and in another app");
        await shot("default");

        // ---- Settings > Accessibility > Text size: Larger -----------------------------
        await page.click("[data-testid=a11y-textSize]");
        await page.click("role=option[name='Larger']");
        await page.waitForTimeout(300);
        r = await root(page);
        check(r.inline === "130%" && near(r.px, 20.8), `Larger: the root is 130% (${r.inline}, ${r.px}px)`);
        check(near(r.text, 0.875 * 20.8) && near(r.space, 20.8), "rem text and spacing follow it");
        const a11y = (await luna(page, "luna://com.webos.service.systemservice/getPreferences", { keys: ["accessibility"] })).accessibility;
        check(a11y && a11y.textSize === 130, "the preference is saved (accessibility.textSize 130)");
        await other.waitForTimeout(300);
        r = await root(other);
        check(r.inline === "130%" && near(r.px, 20.8), "the app already open follows it at once");
        await shot("larger");

        // A page opened now starts with it.
        const third = await context.newPage();
        await third.goto(appUrl("org.webosphoenix.tasks"));
        await third.waitForTimeout(500);
        check(near((await root(third)).px, 20.8), "a page opened afterwards starts with it");
        await third.close();

        // Out of range values are kept within 50%..200%; set through the service.
        await luna(page, "luna://com.webos.service.systemservice/setPreferences", { accessibility: { ...a11y, textSize: 900 } });
        await other.waitForTimeout(300);
        check((await root(page)).inline === "200%" && (await root(other)).inline === "200%", "at most 200%");

        // High contrast still works beside it.
        await page.click("[data-testid=a11y-highContrast]");
        await page.waitForTimeout(300);
        check(await other.evaluate(() => document.documentElement.classList.contains("phoenix-high-contrast")) &&
              (await root(other)).inline === "200%", "high contrast and text size together");
        await page.click("[data-testid=a11y-highContrast]");

        // ---- Back to the default ------------------------------------------------------
        await page.click("[data-testid=a11y-textSize]");
        await page.click("role=option[name='Default']");
        await page.waitForTimeout(300);
        r = await root(page);
        check(r.inline === "" && near(r.px, 16), "Default: the root is the page's own again");
        await other.waitForTimeout(300);
        check((await root(other)).inline === "" && near((await root(other)).px, 16), "and in the other app");
        await other.close();

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
