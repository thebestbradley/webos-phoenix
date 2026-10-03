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
//   download  a file the page view does not show is downloaded with
//             com.palm.downloadmanager: an ongoing activity with progress,
//             the Downloads drawer, the Downloads folder, Open in its app
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

        // Downloads. A file the page view does not show comes back to the
        // browser as BrowserAdapter's mimeNotSupported (phoenix-sim's native
        // view sends it when Chromium would download); the browser asks who
        // opens the type and has com.palm.downloadmanager fetch it. The
        // simulated service fetches through serve-rootfs.py's proxy, which
        // reports the body's progress meanwhile; both are answered here.
        const luna = (u, p) => page.evaluate(([uri, params]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(uri, JSON.stringify(params || {}));
        }), [u, p]);
        const waitFor = async (what, ms) => {
            for (let t = 0; t < (ms || 8000); t += 100) {
                const v = await what();
                if (v) return v;
                await page.waitForTimeout(100);
            }
            return null;
        };
        const PDF_URL = "https://example.org/docs/field-guide.pdf";
        const pdf = fs.readFileSync(path.join(REPO, "apps/media-samples/media/documents/field-guide.pdf"));
        let received = 0, release = null;
        const arrived = new Promise((r) => { release = r; });
        await page.route("**/__phoenix/proxy/progress**", (route) => route.fulfill({
            contentType: "application/json", body: JSON.stringify({ received, total: pdf.length }) }));
        await page.route("**/__phoenix/proxy", async (route) => {
            const req = JSON.parse(route.request().postData() || "{}");
            if (req.url !== PDF_URL) return route.continue();
            await arrived;
            await route.fulfill({ contentType: "application/json", body: JSON.stringify({
                status: 200, headers: { "content-type": "application/pdf" }, url: PDF_URL, bodyBase64: pdf.toString("base64") }) });
        });
        host.length = 0;
        await page.evaluate((u) => {
            document.querySelector("object[type='application/x-palm-browser']").eventListener.mimeNotSupported("application/pdf", u);
        }, PDF_URL);
        const ongoing = () => host.filter((m) => m.type === "ongoing").map((m) => m.payload);
        const started = await waitFor(() => ongoing().find((o) => o.title === "field-guide.pdf"));
        check(!!started && started.appId === "com.palm.app.browser" && started.params && started.params.toasterOpen === "downloads",
            "download: an ongoing activity in the notification area, opening the browser's Downloads");
        received = Math.floor(pdf.length / 2);
        const half = await waitFor(() => ongoing().find((o) => o.progress >= 45 && o.progress <= 50));
        check(!!half && /^Downloading \d+ KB of \d+ KB$/.test(half.body), "download: its progress comes from the proxy (" + (half && half.body) + ")");
        const row = page.locator(".enyo-toaster .item-progress:has-text('field-guide.pdf')").first();
        check(await row.isVisible(), "download: the browser's Downloads drawer lists it");
        await shot("download-progress");
        release();
        check(!!await waitFor(() => ongoing().find((o) => o.clear && o.id === started.id)), "download: the activity goes when it is done");
        const open = page.locator(".enyo-toaster:visible .enyo-button:has-text('Open')").first();
        check(!!await waitFor(() => open.isVisible()), "download: then it can be opened from the list");
        await shot("download-done");
        const stat = await luna("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Downloads/field-guide.pdf" });
        const size = stat.entry && stat.entry.size;
        check(size === pdf.length, "download: the file is in the Downloads folder, whole (" + size + " bytes)");
        host.length = 0;
        await open.click();
        const launched = await waitFor(() => host.find((m) => m.type === "launch"));
        check(!!launched && launched.payload.id === "org.webosphoenix.pdfview" && launched.payload.params.target === "/media/internal/Downloads/field-guide.pdf",
            "download: Open hands it to PDF View");
        const hist = await luna("luna://com.palm.downloadmanager/getAllHistory", { owner: "com.palm.app.browser" });
        const item = (hist.items || []).find((h) => h.destFile === "field-guide.pdf");
        check(!!item && item.state === "completed" && item.fileExistsOnFilesys === true && JSON.parse(item.recordString).ticket === item.ticket,
            "download: the history lists it as the browser reads it again");
        // A type no app opens: the browser says so, as on webOS.
        await page.evaluate(() => {
            document.querySelector("object[type='application/x-palm-browser']").eventListener.mimeNotSupported("application/zip", "https://example.org/a.zip");
        });
        check(!!await waitFor(() => page.getByText("Cannot open MIME type").first().isVisible()), "download: a type nothing opens says \"Cannot open MIME type\"");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
