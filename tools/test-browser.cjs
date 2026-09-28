#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Browse with the original webOS browser (com.palm.app.browser,
// isis-project/isis-browser) in headless Chromium. Its page view is the
// runtime's BrowserAdapter stand-in with the iframe engine (phoenix-sim
// uses a native view instead), so the pages here are local ones whose
// titles the frame can read:
//
//   start     no target: the start page with its address field
//   open      a launch target loads, and the address field shows it
//   address   typing an address and Enter goes there
//   history   back and forward move through the pages
//   handlers  mailto: links go to Email (command-resource-handlers.json)
//
//   node tools/test-browser.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "browser-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const browserUrl = (params) => `${origin}/usr/palm/applications/com.palm.app.browser/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const CALCULATOR = "/usr/palm/applications/com.palm.app.calculator/index.html";
const JUSTTYPE = "/usr/palm/applications/com.palm.launcher/index.html";

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
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const page = await (await browser.newContext({ viewport })).newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource|tellurium/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const address = () => page.locator(".addressbar input:visible").first();
        // The page in the WebView: its address and title, once loaded.
        const framePath = () => page.evaluate(() => {
            const f = document.querySelector("object[type='application/x-palm-browser'] iframe");
            try { return f && f.contentDocument ? f.contentDocument.location.pathname : ""; } catch (e) { return "cross-origin"; }
        });
        const waitForFrame = async (p) => {
            for (let t = 0; t < 8000; t += 200) {
                if ((await framePath()) === p) return true;
                await page.waitForTimeout(200);
            }
            return false;
        };
        const button = (icon) => page.locator(`.actionbar:visible .enyo-tool-button:has(.enyo-button-icon[style*='${icon}'])`).first();

        await page.goto(browserUrl());
        await page.waitForTimeout(2500);
        check(await address().isVisible(), "start: the address field is shown");
        await shot("start");

        await page.goto(browserUrl({ target: CALCULATOR }));
        check(await waitForFrame(CALCULATOR), "open: the launch target loads in the page view");
        await page.waitForTimeout(800);
        check((await address().inputValue()).endsWith(CALCULATOR), "open: the address field shows it");
        await shot("calculator");

        await address().click();
        await address().fill(origin + JUSTTYPE);
        await page.keyboard.press("Enter");
        check(await waitForFrame(JUSTTYPE), "address: typing an address and Enter goes there");
        await page.waitForTimeout(800);
        await shot("address");

        await button("menu-icon-back").click();
        check(await waitForFrame(CALCULATOR), "history: back returns to the first page");
        await page.waitForTimeout(500);
        await button("menu-icon-forward").click();
        check(await waitForFrame(JUSTTYPE), "history: forward goes on again");

        // A mailto: link in a page is handed to Email.
        host.length = 0;
        await page.evaluate(() => {
            const f = document.querySelector("object[type='application/x-palm-browser']");
            f.eventListener.urlRedirected("mailto:ada@example.com", "com.palm.app.email");
        });
        await page.waitForTimeout(800);
        const mail = host.find((m) => m.type === "launch" && m.payload.id === "com.palm.app.email");
        check(!!mail, "handlers: mailto: opens Email");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
