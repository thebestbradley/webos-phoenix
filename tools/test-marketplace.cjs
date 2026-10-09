#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Marketplace end to end: the app (apps/marketplace, built into dist/) in
// headless Chromium, with runtime/phoenix-runtime.js running the device's
// packages service and the simulated installer (com.webos.appInstallService),
// against the real catalog service (server/marketplace with PHP's built-in
// server and SQLite), a web app site, and an App Museum stand-in
// (apps/marketplace/service/test/servers.cjs). Covers trusting a catalog by
// its key, browsing, a web app and a developer's package installed (and
// served, and listed), an update, removing, the Classics with a Mojo app
// refused, search, the update notification's launch, and in the simulator
// (its host.json) the offline card's Start Local Catalog.
//
//   node tools/test-marketplace.cjs [--tablet] [--out DIR]
//
// Needs PHP 8 with sodium and pdo_sqlite, and the apps built.

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const servers = require(path.join(REPO, "apps/marketplace/service/test/servers.cjs"));
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "marketplace-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const P = "luna://org.webosphoenix.service.packages/";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/marketplace/dist/index.html"))) {
        console.error("apps/marketplace/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    if (!servers.phpAvailable()) {
        console.error("PHP 8 with sodium and pdo_sqlite is needed");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const site = await servers.startSite();
    const catalog = await servers.startCatalog({
        curated: [{ id: "org.webosphoenix.pwa.tides", title: "Tides", developer: "Tide Co", summary: "Tide tables for sailors", categories: ["Travel"],
                    featured: true, manifest: site.manifestUrl, origin: site.url, icon: site.url + "/app/icon-192.png" }]
    });
    const museum = await servers.startMuseum();
    const feed = await servers.startFeed();
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` + (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(origin + "/apps.json")).ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
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
        const apps = async () => (await (await fetch(origin + "/usr/share/phoenix/apps.json")).json());

        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.marketplace"));

        // ---- Nothing at the default address yet ------------------------------------------------
        await page.waitForSelector("[data-testid=catalog-offline]", { timeout: 15000 });
        check(/bin\/serve\.sh/.test(await page.textContent("[data-testid=catalog-offline]")), "the default catalog is not running: it says how to start it");
        check(await page.locator("[data-testid=catalog-start]").count() === 0, "... and, not in the simulator, offers no Start Local Catalog");
        await shot("1-offline");

        // ---- Add the catalog: its key is checked first ----------------------------------------------
        await page.click("[data-testid=nav-settings]");
        await page.fill("[data-testid=source-url]", catalog.catalogUrl);
        await page.click("[data-testid=source-add]");
        await page.waitForSelector("[data-testid=source-dialog] [data-testid=trust-fingerprint]");
        check((await page.textContent("[data-testid=trust-fingerprint]")).trim() === catalog.fingerprint, "adding a catalog shows its key's fingerprint");
        await shot("2-trust");
        await page.click("[data-testid=trust-confirm]");
        await page.waitForSelector("[data-testid=source-dialog]", { state: "detached" });
        await page.click("[data-testid=source-toggle-phoenix]");   // the default one, which is not there
        await page.click("[data-testid=back]");
        await page.waitForSelector("[data-testid='app-org.webosphoenix.pwa.tides']", { timeout: 15000 });
        check(await page.locator("[data-testid^='app-org.webosphoenix.pwa.']").count() >= 20, "Featured: the curated web apps");
        await shot("3-featured");

        // ---- A web app ----------------------------------------------------------------------------------
        await page.click("[data-testid=tab-web]");
        await page.click("[data-testid='cat-Travel']");
        await page.waitForSelector("[data-testid='app-org.webosphoenix.pwa.tides']");
        await page.click("[data-testid='app-org.webosphoenix.pwa.tides']");
        await page.waitForSelector("[data-testid=install-app]");
        check((await page.textContent("[data-testid=install-app]")).includes("Add to Launcher"), "a web app is added to the launcher");
        await shot("4-webapp");
        host.length = 0;
        await page.click("[data-testid=install-app]");
        await page.waitForSelector("[data-testid=open-app]", { timeout: 20000 });
        const tides = (await apps()).find((a) => a.id === "org.webosphoenix.pwa.tides");
        const info = JSON.parse(fs.readFileSync(path.join(installedDir, "usr/palm/applications/org.webosphoenix.pwa.tides/appinfo.json"), "utf8"));
        check(!!tides && tides.removable && info.main === site.url + "/app/?source=pwa" && info.title === "Tides"
              && fs.existsSync(path.join(installedDir, "usr/palm/applications/org.webosphoenix.pwa.tides/icon.png")),
              "installed: an app in the launcher that opens the site, with the site's icon");
        await shot("5-installed");
        // The launcher's pending icon followed it: the Marketplace's progress
        // (downloading, checking, installing), then installed; a tap on it
        // meanwhile opens the app's page here.
        const pending = host.filter((m) => m.type === "installStatus" && m.payload.appId === "org.webosphoenix.pwa.tides").map((m) => m.payload);
        const steps = pending.filter((s) => s.state === "installing").map((s) => s.progress);
        check(steps.length >= 3 && steps.every((p, i) => i === 0 || p >= steps[i - 1]) && pending[0].title === "Tides"
              && pending[0].open && pending[0].open.id === "org.webosphoenix.marketplace" && pending[0].retry
              && pending[pending.length - 1].state === "installed",
              "the launcher hears the install as it goes (its progress only rising), then installed");
        host.length = 0;
        await page.click("[data-testid=open-app]");
        await page.waitForTimeout(300);
        check(host.some((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.pwa.tides"), "Open launches it");

        // ---- A developer's package, then an update -------------------------------------------------------
        const dev = await catalog.api("POST", "/api/accounts", { name: "Dana", email: "dana@example.com", role: "developer" });
        const up = await catalog.api("POST", "/api/apps/packages", await servers.webApp("com.example.notes", "1.0.0", { title: "Example Notes" }), dev.token);
        await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.click("[data-testid=tab-apps]");
        await page.waitForSelector("[data-testid='app-com.example.notes']", { timeout: 15000 });
        await page.click("[data-testid='app-com.example.notes']");
        await page.click("[data-testid=install-app]");
        await page.waitForSelector("[data-testid=open-app]", { timeout: 20000 });
        const served = await fetch(origin + "/usr/palm/applications/com.example.notes/index.html");
        check(served.status === 200 && (await served.text()).includes("com.example.notes 1.0.0"), "a package installed: its app is served");
        const v2 = await catalog.api("POST", "/api/apps/packages", await servers.webApp("com.example.notes", "1.1.0", { title: "Example Notes" }), dev.token);
        await catalog.api("POST", `/api/admin/releases/${v2.release.id}/approve`, {}, catalog.admin);
        await luna(P + "refresh", {});
        await page.goto(appUrl("org.webosphoenix.marketplace", { section: "updates" }));
        await page.waitForSelector("[data-testid=update-all]", { timeout: 15000 });
        check(/1\.0\.0 → 1\.1\.0/.test(await page.textContent("[data-testid='installed-com.example.notes']")), "the update notification opens the installed apps, with the update");
        await shot("6-updates");
        await page.click("[data-testid=update-all]");
        await page.waitForFunction(() => /Updated 1 app/.test(document.body.innerText), null, { timeout: 20000 });
        check((await (await fetch(origin + "/usr/palm/applications/com.example.notes/index.html")).text()).includes("1.1.0"), "Update All installs it");

        // ---- Remove -------------------------------------------------------------------------------------------
        await page.click("[data-testid='installed-com.example.notes']");
        await page.click("[data-testid=remove-app]");
        await page.click("[data-testid=remove-confirm]");
        await page.waitForSelector("[data-testid=install-app]", { timeout: 15000 });
        check(!(await apps()).some((a) => a.id === "com.example.notes"), "Remove takes it off the device");

        // ---- Search -------------------------------------------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.fill("[data-testid=search]", "tide tables");
        await page.press("[data-testid=search]", "Enter");
        await page.waitForSelector("[data-testid='app-org.webosphoenix.pwa.tides']");
        check(/Installed/.test(await page.textContent("[data-testid='app-org.webosphoenix.pwa.tides']")), "search finds it, installed");

        // ---- Classics (an App Museum stand-in) --------------------------------------------------------------
        await page.evaluate((u) => {
            const st = JSON.parse(localStorage.getItem("phoenix:marketplace:state"));
            st.sources.find((s) => s.id === "appmuseum").url = u;
            localStorage.setItem("phoenix:marketplace:state", JSON.stringify(st));
        }, museum.url + "/");
        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.click("[data-testid=tab-classics]");
        await page.waitForSelector("[data-testid=classics-on]");
        await shot("7-classics-off");
        await page.click("[data-testid=classics-on]");
        await page.waitForSelector("[data-testid='app-appmuseum.9001']", { timeout: 15000 });
        await shot("8-classics");
        await page.click("[data-testid='app-appmuseum.9001']");

        // ---- Screenshots: full screen, swiped through; a missing one left out -----------------------
        await page.waitForSelector("[data-testid=screenshot-1]");
        await page.waitForTimeout(500);
        check(await page.locator("[data-testid=screenshots] img").count() === 2, "screenshots: the one the archive lacks is left out");
        await page.click("[data-testid=screenshot-0]");
        await page.waitForSelector("[data-testid=screenshot-viewer]");
        const viewer = await page.locator("[data-testid=screenshot-viewer]").boundingBox();
        check(viewer.width === viewport.width && viewer.height === viewport.height, "a tapped screenshot opens full screen");
        const trackAt = () => page.evaluate(() => getComputedStyle(document.querySelector("[data-testid=viewer-track]")).transform);
        const startT = await trackAt();
        await page.mouse.move(viewport.width * 0.8, viewport.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 8; ++i) await page.mouse.move(viewport.width * (0.8 - i * 0.07), viewport.height / 2);
        await page.mouse.up();
        await page.waitForTimeout(400);
        check(await trackAt() !== startT && await page.locator("[data-testid=viewer-next]").count() === 0,
              "swiping shows the next screenshot");
        await shot("8b-screenshot-viewer");
        await page.click("[data-testid=viewer-prev]");
        await page.waitForTimeout(400);
        check(await trackAt() === startT, "the arrow goes back to the first");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid=screenshot-viewer]", { state: "detached" });
        check(await page.locator("[data-testid=install-app]").count() === 1, "the back gesture closes it, on the app's page");

        await page.click("[data-testid=install-app]");
        await page.waitForSelector("[data-testid=open-app]", { timeout: 20000 });
        check((await apps()).some((a) => a.id === "com.example.classicnotes"), "a Classic from the App Museum installs");
        await page.click("[data-testid=back]");
        await page.click("[data-testid='app-appmuseum.9002']");
        await page.click("[data-testid=install-app]");
        await page.waitForSelector("[data-testid=install-error]", { timeout: 20000 });
        check(/Mojo/.test(await page.textContent("[data-testid=install-error]")), "a Mojo app is refused, saying why");
        await shot("9-mojo");

        // ---- Install scripts and services need Developer Mode -------------------------------------------------
        await page.evaluate((u) => {
            const st = JSON.parse(localStorage.getItem("phoenix:marketplace:state"));
            Object.assign(st.sources.find((s) => s.id === "precentral"), { url: u, enabled: true });
            localStorage.setItem("phoenix:marketplace:state", JSON.stringify(st));
        }, feed.feedUrl);
        await luna(P + "refresh", { id: "precentral" });
        const hooked = { sourceId: "precentral", id: "org.example.hooked" };
        await page.goto(appUrl("org.webosphoenix.marketplace", hooked));
        await page.click("[data-testid=install-app]", { timeout: 15000 });
        await page.waitForSelector("[data-testid=install-error]", { timeout: 20000 });
        check(/Developer Mode/.test(await page.textContent("[data-testid=install-error]")) && await page.locator("[data-testid=open-devmode]").count() === 1,
              "a package with install scripts needs Developer Mode, and links to it");
        check(!(await apps()).some((a) => a.id === "org.example.hooked"), "... and is not installed");
        await shot("9b-needs-devmode");
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        await page.goto(appUrl("org.webosphoenix.marketplace", hooked));
        await page.click("[data-testid=install-app]", { timeout: 15000 });
        await page.waitForSelector("[data-testid=install-skipped]", { timeout: 20000 });
        const skippedText = await page.textContent("[data-testid=install-skipped]");
        check(/install scripts \(postinst\)/.test(skippedText) && /services \(org\.example\.hooked\.service\)/.test(skippedText),
              "in Developer Mode it installs; the simulator says it left out the scripts and the service (" + skippedText + ")");
        check((await apps()).some((a) => a.id === "org.example.hooked"), "... and the app is on the device");
        await shot("9c-devmode-installed");
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "disabled" });

        // ---- Deleting an installed app in the launcher (the shell asks the installer) ---------------------------
        const removed = await luna("luna://com.webos.appInstallService/remove", { id: "com.example.classicnotes" });
        await page.waitForTimeout(500);
        check(removed.returnValue && !(await apps()).some((a) => a.id === "com.example.classicnotes"), "com.webos.appInstallService remove");
        const nope = await luna("luna://com.webos.appInstallService/remove", { id: "org.webosphoenix.settings" });
        check(nope.returnValue === false && nope.errorText === "No such id", "built-in apps are not removable");

        // ---- In the simulator: Start Local Catalog --------------------------------------------------------
        // phoenix-sim's host.json says it can start the catalog
        // (org.webosphoenix.simulator); this test is the shell: it hears
        // the "simulator" message, passes the states on (applyHostStatus
        // {marketplaceCatalog}), and starts a catalog where the built-in
        // source looks (a free port in place of 8088).
        {
            const simPort = await servers.freePort();
            const sim = await browser.newContext({ viewport });
            await sim.route("**/usr/share/phoenix/host.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ marketplaceCatalog: true }) }));
            await sim.route("**/etc/palm/marketplace/sources.json", async (r) => {
                const res = await r.fetch();
                const json = await res.json();
                json.sources.find((x) => x.id === "phoenix").url = `http://127.0.0.1:${simPort}/v1/`;
                await r.fulfill({ response: res, body: JSON.stringify(json) });
            });
            const sp = await sim.newPage();
            const asks = [];
            sp.on("pageerror", (e) => errors.push(e.message));
            sp.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    if (msg.type === "simulator") asks.push(msg.payload);
                }
            });
            const shellSays = (c) => sp.evaluate((st) => window.__phoenixRuntime.applyHostStatus({ marketplaceCatalog: st }, { writer: false }),
                Object.assign({ url: `http://127.0.0.1:${simPort}/`, error: "", settingUp: false }, c));
            const simShot = async (name) => { await sp.waitForTimeout(350); await sp.screenshot({ path: path.join(outDir, name + ".png") }); };
            await sp.goto(appUrl("org.webosphoenix.marketplace"));
            await sp.waitForSelector("[data-testid=catalog-start]", { timeout: 15000 });
            check(!/bin\/serve\.sh/.test(await sp.textContent("[data-testid=catalog-offline]")) && /Start Local Catalog/.test(await sp.textContent("[data-testid=catalog-start]")),
                  "in the simulator the offline card offers Start Local Catalog");
            await simShot("10-sim-start-local");

            // It fails: the reason, and the button again.
            await sp.click("[data-testid=catalog-start]");
            await sp.waitForFunction(() => document.querySelector("[data-testid=catalog-start]").disabled);
            check(asks.length === 1 && asks[0].op === "startMarketplaceCatalog", "the button asks the simulator to start it");
            await shellSays({ state: "starting" });
            await shellSays({ state: "failed", error: "PHP 8 with sodium and pdo_sqlite is needed: sudo apt install php-cli php-sqlite3 (./phoenix installs it)" });
            await sp.waitForSelector("[data-testid=local-catalog-error]");
            check(/PHP 8/.test(await sp.textContent("[data-testid=local-catalog-error]"))
                  && !(await sp.locator("[data-testid=catalog-start]").isDisabled()), "it failed: the reason, and Start Local Catalog again");
            await simShot("11-sim-start-failed");

            // It starts (setting itself up), then the catalog is read: its key to trust.
            await sp.click("[data-testid=catalog-start]");
            await sp.waitForFunction(() => document.querySelector("[data-testid=catalog-start]").disabled);
            check(asks.length === 2, "asked again");
            await shellSays({ state: "starting", settingUp: true });
            await sp.waitForSelector("[data-testid=catalog-setting-up]");
            check(/Setting Up/.test(await sp.textContent("[data-testid=catalog-start]")), "starting the first time: it says it is setting up");
            await simShot("12-sim-setting-up");
            const local = await servers.startCatalog({ port: simPort });
            try {
                await shellSays({ state: "running" });
                await sp.waitForSelector("[data-testid=trust-card]", { timeout: 15000 });
                check((await sp.textContent("[data-testid=trust-fingerprint]")).trim() === local.fingerprint && await sp.locator("[data-testid=catalog-offline]").count() === 0,
                      "once it runs the Marketplace reads it: its key to trust, the offline card gone");
                await simShot("13-sim-running");
            } finally {
                await local.stop();
                await sim.close();
            }
        }

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        await Promise.all([catalog.stop(), site.close(), museum.close(), feed.close()]);
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
