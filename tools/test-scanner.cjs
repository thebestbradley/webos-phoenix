#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives QR Scanner (apps/scanner, built into dist/) in headless Chromium
// against the simulated services in runtime/phoenix-runtime.js. The
// camera is Chromium's fake camera playing a Y4M video of a code, drawn
// here with zxing-wasm's writer (one browser per code):
//
//   Wi-Fi       the network and its security; the password hidden until
//               "Show"; Join relaunches Settings on its Wi-Fi page with
//               {join: {ssid, security, passKey, hidden}}; Copy Password
//   web address the host and the whole address; Open in Browser goes to
//               the browser ({target}); a javascript: code is only text
//   vCard       Add to Contacts: {launchType: "newContact", contact} with
//               the name, numbers, emails and company
//   otpauth     without the authenticator: no button, a note; with it
//               (a fake entry in the installed apps): {otpauth: uri} to
//               org.webosphoenix.authenticator; the secret is never shown
//               nor kept in the history
//   EAN-13      a product code
//   history     newest first, reopens a result; "Keep History" off
//               clears it; returnTo: another app gets {scanned: {text,
//               format}}; the torch button lights org.webosports.service.torch
//
//   node tools/test-scanner.cjs [--tablet] [--out DIR]
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
const APP = "org.webosphoenix.scanner";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "scanner-tests", tablet ? "tablet" : "phone");
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

// ---- Codes as Y4M video for the fake camera ----------------------------------------------

const zxing = require(path.join(REPO, "apps/node_modules/zxing-wasm/dist/cjs/writer/index.js"));
zxing.prepareZXingModule({
    overrides: { wasmBinary: fs.readFileSync(path.join(REPO, "apps/node_modules/zxing-wasm/dist/writer/zxing_writer.wasm")).buffer },
});

async function codeVideo(text, format, file) {
    const w = await zxing.writeBarcode(text, { format });
    if (w.error) throw new Error(w.error);
    const { width: sw, height: sh, data } = w.symbol;
    const W = 640, H = 480;
    // Modules as big as fit in 300 px (a 1D code: 3 px bars, 1:2 tall).
    const scale = format === "QRCode" ? Math.max(4, Math.floor(300 / sw)) : 4;
    const rowScale = format === "QRCode" ? scale : Math.max(1, Math.floor(180 / sh));
    const ox = Math.floor((W - sw * scale) / 2), oy = Math.floor((H - sh * rowScale) / 2);
    const y = Buffer.alloc(W * H, 235);             // white paper
    for (let r = 0; r < sh; r++)
        for (let c = 0; c < sw; c++)
            if (data[r * sw + c] < 128)
                for (let dy = 0; dy < rowScale; dy++) y.fill(16, (oy + r * rowScale + dy) * W + ox + c * scale, (oy + r * rowScale + dy) * W + ox + (c + 1) * scale);
    const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
    const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma]);
    fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));
    return file;
}

// ---- One code in one browser -----------------------------------------------------------------

async function withCode(text, format, fn, opts = {}) {
    const { chromium } = loadPlaywright();
    const video = await codeVideo(text, format, path.join(outDir, `code-${format}.y4m`));
    const browser = await chromium.launch({
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
    });
    const context = await browser.newContext({ viewport });
    await context.grantPermissions(["camera", "clipboard-read", "clipboard-write"], { origin });
    // The authenticator installed or not: add it to, or take it out of, the
    // installed apps list.
    const AUTH = "org.webosphoenix.authenticator";
    await context.route("**/usr/share/phoenix/apps.json", async (route) => {
        const res = await route.fetch();
        const list = JSON.parse(await res.text()).filter((a) => a.id !== AUTH);
        if (opts.authenticator) list.push({ id: AUTH, launchPointId: AUTH + "_default", title: "Authenticator", params: {} });
        await route.fulfill({ response: res, body: JSON.stringify(list) });
    });
    const page = await context.newPage();
    const errors = [];
    const host = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        const t = m.text();
        if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
        else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
    });
    const env = {
        page, host, errors,
        shot: (name) => page.screenshot({ path: path.join(outDir, name + ".png") }),
        launched: (id) => host.filter((m) => m.type === "launch" && m.payload.id === id).map((m) => m.payload.params),
        luna: (url, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [url, params]),
        history: () => page.evaluate(() => JSON.parse(localStorage.getItem("org.webosphoenix.scanner.history") || "[]")),
    };
    try {
        await page.goto(appUrl(opts.params));
        if (opts.clean) {
            await page.evaluate(() => localStorage.clear());
            await page.goto(appUrl(opts.params));
        }
        await fn(env);
        check(errors.length === 0, `${format}: no page errors` + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
    } finally {
        await browser.close();
    }
}

const scanned = (page) => page.waitForSelector("[data-testid='result']", { timeout: 15000 });

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/scanner/dist/index.html"))) {
        console.error("apps/scanner/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);

        // ---- Wi-Fi -------------------------------------------------------------------------
        await withCode("WIFI:T:WPA;S:Phoenix Lab;P:webos2009;;", "QRCode", async ({ page, shot, launched, history }) => {
            await page.waitForSelector("[data-testid='viewfinder']");
            await scanned(page);
            check(await page.getAttribute("[data-testid='result']", "data-kind") === "wifi", "Wi-Fi: the code is read as a Wi-Fi network");
            const body = await page.textContent("[data-testid='result-text']");
            check(/Phoenix Lab/.test(body) && /WPA/.test(body) && !/webos2009/.test(body), `Wi-Fi: name and security, password hidden (${body.trim()})`);
            await shot("wifi");
            await page.click("button:has-text('Show')");
            check((await page.textContent("[data-testid='wifi-password']")) === "webos2009", "Wi-Fi: Show reveals the password");
            await page.click("[data-testid='act-join']");
            await page.waitForTimeout(200);
            const join = launched("org.webosphoenix.settings")[0];
            check(join && join.page === "wifi" && join.join.ssid === "Phoenix Lab" && join.join.security === "psk" && join.join.passKey === "webos2009",
                  `Wi-Fi: Join opens Settings > Wi-Fi with the network (${JSON.stringify(join)})`);
            await page.click("[data-testid='act-copy']");
            await page.waitForSelector("[data-testid='toast']");
            check((await page.evaluate(() => navigator.clipboard.readText())) === "webos2009", "Wi-Fi: Copy Password copies it");
            const h = await history();
            check(h.length === 1 && h[0].text.startsWith("WIFI:") && h[0].format === "QRCode", "history: the scan is kept");
            // Scan again: the viewfinder comes back and reads it again.
            await page.click("[data-testid='scan-again']");
            await page.waitForSelector("[data-testid='result']", { state: "detached" });
            await shot("viewfinder");
            await scanned(page);
            check((await history()).length === 1, "history: the same code again is not repeated");
        }, { clean: true });

        // ---- Web address --------------------------------------------------------------------
        await withCode("https://www.webosphoenix.org/apps/scanner?from=qr", "QRCode", async ({ page, shot, launched }) => {
            await scanned(page);
            const body = await page.textContent("[data-testid='result-text']");
            check(/www\.webosphoenix\.org/.test(body) && /from=qr/.test(body), `URL: the host and the whole address (${body.trim()})`);
            await shot("url");
            await page.click("[data-testid='act-open']");
            await page.waitForTimeout(200);
            const b = launched("com.palm.app.browser")[0];
            check(b && b.target === "https://www.webosphoenix.org/apps/scanner?from=qr", "URL: Open in Browser opens it in the browser");
        });

        await withCode("javascript:alert(document.cookie)", "QRCode", async ({ page }) => {
            await scanned(page);
            check(await page.getAttribute("[data-testid='result']", "data-kind") === "text" && !(await page.$("[data-testid='act-open']")),
                  "URL: a javascript: code is only text, never opened");
        });

        // ---- vCard -------------------------------------------------------------------------------
        const vcard = "BEGIN:VCARD\nVERSION:3.0\nN:Palm;Pre\nFN:Pre Palm\nORG:Palm\nTEL;TYPE=CELL:+14085550100\nEMAIL:pre@example.com\nEND:VCARD";
        await withCode(vcard, "QRCode", async ({ page, shot, launched }) => {
            await scanned(page);
            check(/Pre Palm/.test(await page.textContent("[data-testid='result-text']")), "vCard: the contact's name");
            await shot("contact");
            await page.click("[data-testid='act-contact']");
            await page.waitForTimeout(200);
            const c = launched("com.palm.app.contacts")[0];
            check(c && c.launchType === "newContact" && c.contact.name.givenName === "Pre" && c.contact.phoneNumbers[0].value === "+14085550100"
                  && c.contact.emails[0].value === "pre@example.com" && c.contact.organizations[0].name === "Palm",
                  "vCard: Add to Contacts opens a new contact with its fields");
        });

        // ---- otpauth -----------------------------------------------------------------------------
        const otp = "otpauth://totp/ACME:jane@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME";
        await withCode(otp, "QRCode", async ({ page, history }) => {
            await scanned(page);
            await page.waitForTimeout(300);
            const body = await page.textContent("[data-testid='result']");
            check(/ACME: jane@example.com/.test(body) && /Install an authenticator/.test(body) && !(await page.$("[data-testid='act-otp']")),
                  "otpauth: without an authenticator, a note and no button");
            check(!body.includes("JBSWY3DPEHPK3PXP"), "otpauth: the secret is not shown");
            check(!JSON.stringify(await history()).includes("JBSWY3DPEHPK3PXP"), "otpauth: the secret is not kept in the history");
        });
        await withCode(otp, "QRCode", async ({ page, shot, launched }) => {
            await scanned(page);
            await page.waitForSelector("[data-testid='act-otp']", { timeout: 5000 });
            await shot("otpauth");
            await page.click("[data-testid='act-otp']");
            await page.waitForTimeout(200);
            const a = launched("org.webosphoenix.authenticator")[0];
            check(a && a.otpauth === otp, "otpauth: Add to Authenticator hands the URI over ({otpauth})");
        }, { authenticator: true });

        // ---- EAN-13, history, returnTo, torch -------------------------------------------------------
        await withCode("4006381333931", "EAN13", async ({ page, shot, luna, history }) => {
            await scanned(page);
            check(await page.getAttribute("[data-testid='result']", "data-kind") === "product"
                  && /4006381333931/.test(await page.textContent("[data-testid='result-text']")), "EAN-13: a product code");
            const h = await history();
            check(h.length === 1 && h[0].format === "EAN13" && h[0].text === "4006381333931", "history: the product code is kept");
            // The history list.
            await page.click("[data-testid='scan-again']");
            if (!tablet) await page.click("[data-testid='show-history']");
            await page.waitForSelector("[data-testid='history-4006381333931']");
            await shot("history");
            await page.click("[data-testid='history-4006381333931']");
            await scanned(page);
            check(await page.getAttribute("[data-testid='result']", "data-kind") === "product", "history: a scan opens again");
            await page.click("[data-testid='scan-again']");
            // Torch.
            const torch = await page.$("[data-testid='torch']");
            check(!!torch, "torch: the light button is there when the device has a torch");
            if (torch) {
                await page.$eval("[data-testid='torch']", (e) => e.click());
                await page.waitForTimeout(200);
                check((await luna("luna://org.webosports.service.torch/getStatus", {})).on === true, "torch: the button lights the torch");
                await page.$eval("[data-testid='torch']", (e) => e.click());
                await page.waitForTimeout(200);
                check((await luna("luna://org.webosports.service.torch/getStatus", {})).on === false, "torch: and puts it out");
            }
            // Keep History off clears it.
            await page.evaluate(() => window.__phoenixRuntime.openAppMenu ? window.__phoenixRuntime.openAppMenu() : document.dispatchEvent(new Event("phoenixAppMenu")));
            await page.click("[data-testid='menu-keep']");
            await page.waitForTimeout(200);
            check((await history()).length === 0, "history: Keep History off clears it");
        });

        await withCode("PHOENIX-TEST-42", "QRCode", async ({ page, launched }) => {
            await page.waitForFunction(() => /code to scan it/.test(document.querySelector("[data-testid='hint']")?.textContent ?? ""), null, { timeout: 8000 })
                .catch(() => {});
            await page.waitForTimeout(3000);
            const r = launched("org.example.caller")[0];
            check(r && r.scanned && r.scanned.text === "PHOENIX-TEST-42" && r.scanned.format === "QRCode",
                  `returnTo: the caller gets {scanned: {text, format}} (${JSON.stringify(r)})`);
        }, { params: { returnTo: "org.example.caller" } });
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
