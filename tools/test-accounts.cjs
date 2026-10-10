#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The accounts service's templates and the ways Accounts reaches the
// Marketplace and back (docs/SYNERGY-CONNECTORS.md 2.4), in headless
// Chromium with runtime/phoenix-runtime.js against tools/serve-rootfs.py's
// installer:
//   - the built-in templates are found (rootfs.json's /usr/palm/public/accounts
//     folders and the runtime's Jabber account), as before;
//   - a connector installed from a package (its app's public/accounts/<id>/)
//     is listed, the change is signalled in tempdb (com.palm.signaling:1),
//     and it goes when the app is removed;
//   - "Find More ..." in Accounts' "Add an Account" opens the Marketplace
//     with the original's params (com.palm.app.enyo-findapps is an alias);
//   - Accounts launched (and relaunched) with {templateId} opens that
//     template's sign-in.
//
//   node tools/test-accounts.cjs [--out DIR]

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const servers = require(path.join(REPO, "apps/marketplace/service/test/servers.cjs"));
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "accounts-tests");
const ACCOUNTS = "luna://com.palm.service.accounts/";
const BUILTIN = ["com.palm.imap", "com.palm.othermail", "com.palm.palmprofile", "com.palm.pop",
                 "com.webosphoenix.dav", "com.webosphoenix.webcal", "com.webosphoenix.xmpp"];

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

// A connector's package (docs/SYNERGY-CONNECTORS.md 3.1): a hidden app with
// its template in public/accounts/<templateId>/.
function connector() {
    const dir = "usr/palm/applications/org.example.feeds/";
    const template = {
        templateId: "org.example.feeds", loc_name: "Example Feeds",
        icon: { loc_32x32: "images/feeds-32.png", loc_48x48: "images/feeds-48.png" },
        validator: "palm://org.example.feeds.service/checkCredentials",
        capabilityProviders: [{ id: "org.example.feeds.feeds", capability: "FEEDS",
                                implementation: "palm://org.example.feeds.service/",
                                onCreate: "palm://org.example.feeds.service/onCreate" }]
    };
    return servers.webApp("org.example.feeds", "1.0.0", {
        title: "Example Feeds", appinfo: { phoenix: { hidden: true } },
        files: [{ path: dir + "public/accounts/org.example.feeds/org.example.feeds.json", data: JSON.stringify(template) },
                { path: dir + "public/accounts/org.example.feeds/images/feeds-32.png", data: new Uint8Array(servers.png(32, [240, 140, 0])) },
                { path: dir + "public/accounts/org.example.feeds/images/feeds-48.png", data: new Uint8Array(servers.png(48, [240, 140, 0])) }]
    });
}

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const accountsUrl = (params) => `${origin}/usr/palm/applications/com.palm.app.accounts/index.html` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(origin + "/apps.json")).ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport: { width: 320, height: 452 } });
        const page = await context.newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
        });
        await page.goto(`${origin}/usr/palm/applications/com.palm.app.calculator/index.html`);
        await page.evaluate(() => localStorage.clear());
        await page.goto(`${origin}/usr/palm/applications/com.palm.app.calculator/index.html`);
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const templateIds = async () => (await luna(page, ACCOUNTS + "listAccountTemplates", {})).results.map((t) => t.templateId).sort();
        const signal = async () => ((await luna(page, "luna://com.palm.tempdb/find", { query: { from: "com.palm.signaling:1",
            where: [{ prop: "appId", op: "=", val: "com.palm.accounts.templates" }] } })).results || [])[0];

        // ---- The built-in templates ---------------------------------------------------------------
        const builtin = await templateIds();
        check(JSON.stringify(builtin) === JSON.stringify(BUILTIN), "the built-in templates: " + builtin.join(", "));
        const imap = (await luna(page, ACCOUNTS + "listAccountTemplates", { capability: "MAIL" })).results.find((t) => t.templateId === "com.palm.imap");
        check(!!imap && imap.icon.loc_32x32 === "/usr/palm/public/accounts/com.palm.imap/images/imapmail32.png",
              "a template's icons are paths in its folder");
        check((await luna(page, ACCOUNTS + "listAccountTemplates", { capability: "CONTACTS" })).results.some((t) => t.templateId === "com.webosphoenix.dav"),
              "listAccountTemplates by capability includes the transports' templates");

        // ---- A connector installed, then removed ----------------------------------------------------
        const ipk = Buffer.from(await connector());
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/feeds.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipk.toString("base64"));
        const installed = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 30 || r.statusValue === 24) res(r); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "org.example.feeds", ipkUrl: "/tmp/feeds.ipk", subscribe: true }));
        }));
        check(installed.statusValue === 30, "the connector installs");
        await page.waitForTimeout(200);
        check((await templateIds()).includes("org.example.feeds"), "its template is listed");
        const feeds = (await luna(page, ACCOUNTS + "listAccountTemplates", { capability: "FEEDS" })).results;
        check(feeds.length === 1 && feeds[0].icon.loc_32x32 === "/usr/palm/applications/org.example.feeds/public/accounts/org.example.feeds/images/feeds-32.png",
              "by its capability, with its icons in the app");
        const sig = await signal();
        check(!!sig && sig.templates.split(",").includes("org.example.feeds"), "the new list is signalled in tempdb (com.palm.signaling:1)");
        const created = await luna(page, ACCOUNTS + "createAccount", { templateId: "org.example.feeds", username: "me@example.org",
            capabilityProviders: [{ id: "org.example.feeds.feeds" }] });
        check(created.returnValue === true, "an account of it can be created");
        await luna(page, ACCOUNTS + "deleteAccount", { accountId: created.result && created.result._id });

        // ---- Accounts' "Find More ..." --------------------------------------------------------------
        const app = await context.newPage();
        app.on("pageerror", (e) => errors.push(e.message));
        app.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
        });
        await app.goto(accountsUrl());
        await app.waitForTimeout(3000);
        await app.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Add an Account" }).first().click();
        await app.waitForTimeout(1200);
        check(await app.getByText("Example Feeds", { exact: true }).count() > 0, "Add an Account lists the installed connector");
        await app.screenshot({ path: path.join(outDir, "1-add-account.png") });
        host.length = 0;
        await app.getByText("Find More ...", { exact: true }).first().click();
        await app.waitForTimeout(500);
        const launch = host.find((m) => m.type === "launch");
        const cp = launch && launch.payload.params.common && launch.payload.params.common.params;
        check(!!launch && launch.payload.id === "org.webosphoenix.marketplace" && launch.payload.params.common.sceneType === "search"
              && cp.type === "connector" && Array.isArray(cp.connectorInfo.types) && typeof cp.connectorInfo.searchBarTitle === "string",
              "Find More ... opens the Marketplace with the original's params: " + JSON.stringify(launch && launch.payload.params));
        host.length = 0;
        const params = { common: { sceneType: "search", params: { type: "connector",
            connectorInfo: { searchBarTitle: "Contacts", searchBarIcon: "/x.png", types: ["CONTACTS"] } } } };
        await luna(page, "luna://com.palm.applicationManager/open", { id: "com.palm.app.enyo-findapps", params });
        const opened = host.find((m) => m.type === "launch");
        check(!!opened && opened.payload.id === "org.webosphoenix.marketplace" && JSON.stringify(opened.payload.params) === JSON.stringify(params),
              "com.palm.app.enyo-findapps opens the Marketplace, its params unchanged");

        // ---- Set up: Accounts launched with {templateId} -------------------------------------------
        const wizard = async (p) => {
            for (let t = 0; t < 10000; t += 250) {
                if (p.frames().some((f) => /org\.webosphoenix\.dav\/accounts\/wizard\.html/.test(f.url()))) return true;
                await p.waitForTimeout(250);
            }
            return false;
        };
        const setup = await context.newPage();
        setup.on("pageerror", (e) => errors.push(e.message));
        await setup.goto(accountsUrl({ templateId: "com.webosphoenix.dav" }));
        check(await wizard(setup), "launched with {templateId}, Accounts opens that template's sign-in");
        await setup.screenshot({ path: path.join(outDir, "2-setup.png") });
        await setup.close();
        await app.goto(accountsUrl({ templateId: "org.example.feeds" }));
        await app.waitForTimeout(3000);
        check(/USERNAME/i.test(await app.evaluate(() => document.body.innerText))
              && await app.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Sign In" }).count() > 0,
              "a template without its own sign-in page: the credentials view");
        await app.screenshot({ path: path.join(outDir, "3-setup-credentials.png") });
        await app.goto(accountsUrl());
        await app.waitForTimeout(3000);
        await app.evaluate(() => __phoenixRuntime.relaunch({ templateId: "com.webosphoenix.dav" }));
        check(await wizard(app), "relaunched with {templateId}, too");
        await app.goto(accountsUrl({ templateId: "com.example.none" }));
        await app.waitForTimeout(3000);
        check(await app.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Add an Account" }).count() > 0,
              "an unknown templateId leaves Accounts on its main view");

        // ---- Removed ---------------------------------------------------------------------------------
        await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 31 || r.statusValue === 25) res(r); };
            b.call("luna://com.webos.appInstallService/remove", JSON.stringify({ id: "org.example.feeds", subscribe: true }));
        }));
        await page.waitForTimeout(200);
        check(JSON.stringify(await templateIds()) === JSON.stringify(BUILTIN), "removed, its template is gone");
        check(!(await signal()).templates.split(",").includes("org.example.feeds"), "and tempdb says so");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
