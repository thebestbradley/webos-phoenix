#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix service plugin's no-bundler build (apps/shared/sdk/dist/
// phoenix-sdk.js, the global `Phoenix`) in headless Chromium: a page with
// nothing but the script, as an app without a bundler (or a PWA) would
// have it. Without webOS it degrades: has() says no bus, requests fail with
// code "unavailable" (and one warning per service), the app menu still
// draws, share.open copies to the clipboard. With a PalmServiceBridge (a
// stand-in here) requests go over it and PalmSystem's launch params,
// relaunches and the back gesture work.
//
//   node tools/test-app-sdk.cjs [--out DIR]
//
// Build it first: npm run build -w @phoenix/sdk (in apps/).

"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO, "apps/shared/sdk/dist/phoenix-sdk.js");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "app-sdk-tests");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

async function main() {
    if (!fs.existsSync(SCRIPT)) {
        console.error("apps/shared/sdk/dist/phoenix-sdk.js is missing: build it first (npm run build -w @phoenix/sdk in apps/)");
        process.exit(2);
    }
    fs.mkdirSync(outDir, { recursive: true });
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 600 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = [];
    // A page at localhost (a secure context, so the clipboard works), served here.
    const PAGE = "http://localhost/index.html";
    await context.route(PAGE, (route) => route.fulfill({ contentType: "text/html",
        body: "<!doctype html><html><head><title>Plain</title></head><body><p>A page with no bundler</p></body></html>" }));

    // ---- A plain browser ---------------------------------------------------------
    const page = await context.newPage();
    const warnings = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
    await page.goto(PAGE);
    await page.addScriptTag({ path: SCRIPT });
    const plain = await page.evaluate(async () => {
        const P = window.Phoenix;
        const err = await P.request("luna://com.webos.service.wifi/getstatus").catch((e) => e);
        await P.request("luna://com.webos.service.wifi/setstate").catch(() => {});
        return { version: P.VERSION, bus: P.has("bus"), share: P.has("share"), errName: err.name, code: err.code,
                 shareResult: await P.share.open({ text: "hello" }) };
    });
    check(/^\d+\.\d+\.\d+$/.test(plain.version), `the global Phoenix is there (version ${plain.version})`);
    check(plain.bus === false && plain.share === false, "has(): no bus and no share sheet in a plain browser");
    check(plain.errName === "PhoenixError" && plain.code === "unavailable", "a request fails with PhoenixError code \"unavailable\"");
    check(warnings.filter((w) => /com\.webos\.service\.wifi/.test(w)).length === 1, "and says so once per service");
    check(plain.shareResult.action === "copy" && await page.evaluate(() => navigator.clipboard.readText()) === "hello",
          "share.open falls back to the clipboard");
    await page.evaluate(() => {
        window.Phoenix.applyTheme();
        window.Phoenix.appMenu.attach({ items: [{ label: "About", onSelect() { document.title = "about"; } }], share: () => ({ text: "x" }) });
        document.dispatchEvent(new CustomEvent("phoenixAppMenu"));
    });
    const labels = await page.locator(".phx-appmenu-item").allTextContents();
    check(JSON.stringify(labels) === JSON.stringify(["Edit", "Share", "About"]), "the app menu draws in the Phoenix look: " + labels.join(", "));
    check(await page.evaluate(() => getComputedStyle(document.body).fontFamily.startsWith("Prelude")), "the design layer's font (Prelude, then Open Sans)");
    await page.screenshot({ path: path.join(outDir, "plain-appmenu.png") });
    await page.locator(".phx-appmenu-item", { hasText: "About" }).click();
    check(await page.title() === "about" && await page.locator(".phx-appmenu").count() === 0, "an item runs and the menu closes");

    // ---- With a bus (a PalmServiceBridge stand-in) and PalmSystem -------------------
    const dev = await context.newPage();
    dev.on("pageerror", (e) => errors.push(e.message));
    await dev.addInitScript(() => {
        window.__sent = [];
        window.PalmServiceBridge = function () {
            this.onservicecallback = null;
            this.call = (uri, json) => {
                window.__sent.push([uri, JSON.parse(json)]);
                const reply = uri.endsWith("/osInfo/query") ? { returnValue: true, webos_name: "webOS Phoenix" }
                    : { returnValue: false, errorCode: -1, errorText: "Denied method call" };
                setTimeout(() => this.onservicecallback && this.onservicecallback(JSON.stringify(reply)), 0);
            };
            this.cancel = () => {};
        };
        window.PalmSystem = { appIdentifier: "com.example.plain", launchParams: '{"newNote":"from Just Type"}', stageReady() { window.__ready = true; } };
    });
    await dev.goto(PAGE);
    await dev.addScriptTag({ path: SCRIPT });
    const onBus = await dev.evaluate(async () => {
        const P = window.Phoenix;
        const os = await P.request("luna://com.webos.service.systemservice/osInfo/query", {});
        const denied = await P.request("luna://com.example/secret").catch((e) => e.code);
        const typed = [];
        P.justType.onAction("newNote", (t) => typed.push(t));
        document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { newNote: "again" } }));
        let backs = 0;
        P.app.onBack(() => { backs++; return true; });
        const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        window.dispatchEvent(e);
        P.app.stageReady();
        return { name: os.webos_name, denied, typed, backs, prevented: e.defaultPrevented, id: P.app.id, bus: P.has("bus"), webos: P.has("webos"),
                 ready: window.__ready, sent: window.__sent.length };
    });
    check(onBus.bus && onBus.webos && onBus.name === "webOS Phoenix", "with a bridge: has('bus'), and a request answers over it");
    check(onBus.denied === "permission-denied", "a refusal is code \"permission-denied\"");
    check(onBus.id === "com.example.plain" && JSON.stringify(onBus.typed) === JSON.stringify(["from Just Type", "again"]),
          "the app's id, and Just Type's action at launch and at a relaunch");
    check(onBus.backs === 1 && onBus.prevented, "the back gesture goes to app.onBack, which takes it");
    check(onBus.ready === true, "app.stageReady calls PalmSystem.stageReady");

    check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
    await browser.close();
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
