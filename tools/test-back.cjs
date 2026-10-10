#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The back gesture's contract with the apps (runtime.back), in real app
// pages in headless Chromium. The page gets Back as the Escape key; an app
// that takes it stops the key (preventDefault) and runtime.back answers
// true; one that does not (its top level: nothing to go back to) leaves it,
// runtime.back answers false and the shell minimizes the card to card view,
// as LunaSysMgr did with a Back the web app handed back
// (SystemUiController::slotKeyEventRejected; the shell's part is in
// shell/tests/tst_shell.qml, test_backAtTheTopLevelMinimizes).
//
//   enyo 1      Memos (the original app): the wall leaves Back, the editor
//               takes it (back to the wall)
//   enyo 2      the Enyo 2 demo: its first panel leaves Back
//   phoenix     Settings: its list of panes leaves Back, a pane opened from
//               it takes it
//   ionic       Ionic Notes: the notes list leaves Back, Settings takes it
//   flutter     Flutter Notes: its first screen leaves Back
//   enact       the Enact demos (Agate, Limestone): their first panel
//   $caller     an app opened to show something ({returnToCaller}) closes
//               its card at its top level instead, back to its caller
//
//   node tools/test-back.cjs
//
// Build the apps first (cd apps && npm ci && npm run build).

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

// A response read to its end: one left unread, its socket closed under it,
// aborts Node's fetch (undici: assert(!this.paused), seen in CI).
async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

async function main() {
    for (const app of ["settings", "ionic-notes", "flutter-notes", "enact-notes-agate", "enact-notes-limestone"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-back-"));
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { if ((await drained(fetch(origin + "/apps.json"))).ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch();
        const errors = [];
        // Each app in a card of its own (a page with no history before it).
        const open = async (id, params, ready) => {
            const context = await browser.newContext({ viewport: { width: 320, height: 452 } });
            const page = await context.newPage();
            page.on("pageerror", (e) => errors.push(id + ": " + e.message));
            await page.goto(appUrl(id, params));
            await page.waitForFunction(() => !!window.__phoenixRuntime);
            if (ready) await page.waitForSelector(ready, { timeout: 15000 });
            await page.waitForTimeout(1000);
            return page;
        };
        const back = (page) => page.evaluate(() => __phoenixRuntime.back());

        // ---- Enyo 1.0: Memos -------------------------------------------------------------------
        let page = await open("com.palm.app.notes", null, ".new-memo");
        check(await back(page) === false, "enyo 1: Back on Memos' wall is left to the system (the card minimizes)");
        await page.click(".new-memo");
        await page.waitForTimeout(500);
        const editing = () => page.evaluate(() => enyo.$.appView_edit.showing);
        check(await editing(), "enyo 1: a memo opens in the editor");
        check(await back(page) === true, "enyo 1: Back in the editor is the app's");
        await page.waitForTimeout(500);
        check(!(await editing()), "enyo 1: and goes back to the wall");
        check(await back(page) === false, "enyo 1: then Back is the system's again");
        await page.context().close();

        // ---- Enyo 2 ----------------------------------------------------------------------------
        page = await open("org.webosphoenix.enyo2demo");
        check(await back(page) === false, "enyo 2: Back at the first panel is left to the system");
        await page.context().close();

        // ---- A Phoenix app: Settings -----------------------------------------------------------
        page = await open("org.webosphoenix.settings");
        check(await back(page) === false, "phoenix: Back at Settings' list is left to the system");
        await page.getByText("Date & Time", { exact: true }).first().click();
        await page.waitForTimeout(800);
        check(await back(page) === true, "phoenix: Back on a pane opened from the list is the app's");
        await page.waitForTimeout(800);
        check(await back(page) === false, "phoenix: and at the list again, the system's");
        await page.context().close();
        // Launched straight into a pane (its launcher icon, as webOS 2.x's
        // separate apps): that pane is the top level.
        page = await open("org.webosphoenix.settings", { page: "wifi" });
        check(await back(page) === false, "phoenix: Back on a pane the app was launched into is left to the system");
        await page.context().close();

        // ---- Ionic -----------------------------------------------------------------------------
        page = await open("org.webosphoenix.ionicnotes", null, "ion-router-outlet");
        const url = page.url();
        check(await back(page) === false, "ionic: Back at the notes list is left to the system");
        await page.waitForTimeout(500);
        check(page.url() === url, "ionic: and the page stays where it is");
        await page.evaluate(() => { location.hash = "#/settings"; });
        await page.waitForTimeout(1000);
        check(await back(page) === true, "ionic: Back in Settings is the app's");
        await page.waitForFunction(() => (location.hash.replace(/^#/, "") || "/") === "/", null, { timeout: 5000 }).catch(() => null);
        check((await page.evaluate(() => location.hash.replace(/^#/, "") || "/")) === "/", "ionic: and goes back to the notes");
        await page.context().close();

        // ---- Flutter and Enact -----------------------------------------------------------------
        for (const [id, what] of [["org.webosphoenix.flutternotes", "flutter"], ["org.webosphoenix.enactnotes.agate", "enact agate"],
                                  ["org.webosphoenix.enactnotes.limestone", "enact limestone"]]) {
            page = await open(id);
            await page.waitForTimeout(2000);
            check(await back(page) === false, `${what}: Back at the first screen is left to the system`);
            await page.context().close();
        }

        // ---- $caller ---------------------------------------------------------------------------
        page = await open("org.webosphoenix.settings", { $caller: "org.webosphoenix.assistant" });
        check(await back(page) === true, "$caller: at the top level the card closes, back to its caller (not minimized)");
        await page.context().close().catch(() => {});

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        server.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
