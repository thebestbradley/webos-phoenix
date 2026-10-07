#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the clipboard history (docs/M6-PLAN.md F2) in headless Chromium
// against the simulated org.webosphoenix.clipboard in
// runtime/phoenix-runtime.js: copies made in another app's page (a text
// field, a password field) reach the Clipboard app (apps/clipboard) live;
// the app's tabs, search, pins, categories (new, rename, reorder, delete),
// moving, editing and deleting clips; a sensitive clip masked, revealed
// only with the device passcode, hidden again when the screen locks, and
// sent to Passwords or the Authenticator; nothing secret in the stored
// data. Then Settings > Clipboard (apps/settings): every choice reaches the
// service, exclusions, Clear History, and the history turned off.
//
//   node tools/test-clipboard.cjs [--tablet] [--out DIR]
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
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "clipboard-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8790 + Math.floor(Math.random() * 90);
const root = `http://127.0.0.1:${port}/usr/palm/applications`;
const appUrl = `${root}/org.webosphoenix.clipboard/index.html`;
const settingsUrl = `${root}/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify({ page: "clipboard" }));
const otherUrl = `${root}/org.webosphoenix.flashlight/index.html`;

const PASSWORD = "Hunter2!quietly";
const OTPAUTH = "otpauth://totp/Phoenix:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Phoenix";
const PIN = "4321";

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
    for (const app of ["clipboard", "settings", "flashlight"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${port}` });
        const errors = [];
        const launches = [];
        const watch = (page, name) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    if (msg.type === "launch") launches.push(msg.payload);
                } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                    errors.push(`${name}: ${t}`);
                }
            });
        };
        const app = await context.newPage();
        watch(app, "clipboard");
        const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true });
        const svc = (page, uri, params) => page.evaluate(([u, p]) => new Promise((resolve) => {
            __phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);
        const history = async (q = {}) => (await svc(app, "luna://org.webosphoenix.clipboard/history", q)).clips;
        const appMenu = async (item) => {
            await app.evaluate(() => document.dispatchEvent(new CustomEvent("phoenixAppMenu")));
            await app.click(`.pui-appmenu-item:has-text("${item}")`);
        };

        // A clean device with a PIN.
        await app.goto(appUrl);
        await app.evaluate(() => localStorage.clear());
        await app.goto(appUrl);
        await svc(app, "luna://com.palm.systemmanager/setDevicePasscode", { lockMode: "pin", passCode: PIN });
        await app.waitForSelector("[data-testid='empty']");
        check(/What you copy/.test(await app.textContent("[data-testid='empty']")), "an empty history says what will show");

        // ---- Copies in another app reach the Clipboard app ----------------------------
        const other = await context.newPage();
        watch(other, "flashlight");
        await other.goto(otherUrl);
        await other.waitForSelector("#root *");
        await other.evaluate(() => {
            const t = document.createElement("textarea");
            t.id = "t";
            t.value = "Meet at the old station at noon";
            t.style.cssText = "position: fixed; left: 0; top: 0; z-index: 9999; width: 200px; height: 40px";
            document.body.appendChild(t);
            const p = document.createElement("input");
            p.type = "password";
            p.id = "p";
            p.style.cssText = "position: fixed; left: 0; top: 50px; z-index: 9999; width: 200px";
            document.body.appendChild(p);
        });
        await other.click("#t");
        await other.keyboard.press("Control+A");
        await other.keyboard.press("Control+C");
        await app.waitForSelector("[data-testid='clip-title']:has-text('Meet at the old station')", { timeout: 5000 });
        check(true, "a copy in another app shows in the Clipboard app at once");
        const first = (await history())[0];
        check(first && first.source === "org.webosphoenix.flashlight" && first.type === "text", "it records the app it was copied in");
        // A password field: Chromium refuses Copy there; the runtime copies it, as a secret.
        await other.fill("#p", PASSWORD);
        await other.click("#p");
        await other.keyboard.press("Control+A");
        await other.keyboard.press("Control+C");
        await app.waitForFunction(() => document.querySelectorAll('.cb-clip-row').length >= 2, null, { timeout: 5000 }).catch(() => {});
        let clips = await history();
        const pw = clips.find((c) => c.sensitive);
        check(pw && pw.kind === "password" && pw.text === undefined && pw.length === PASSWORD.length, "Copy in a password field records a masked password");
        check(await other.evaluate(() => navigator.clipboard.readText()) === PASSWORD, "and puts it on the system clipboard");
        await other.close();

        // More clips, as other apps would make them.
        await svc(app, "luna://org.webosphoenix.clipboard/add", { text: "https://webosphoenix.org/news", title: "Phoenix news", source: "org.webosphoenix.browser" });
        await svc(app, "luna://org.webosphoenix.clipboard/add", { text: OTPAUTH, source: "org.webosphoenix.scanner" });
        await svc(app, "luna://org.webosphoenix.clipboard/add", { text: "Grocery list: milk, bread", source: "org.webosphoenix.tasks" });
        await app.waitForFunction(() => document.querySelectorAll('.cb-clip-row').length === 5);
        check(true, "five clips listed, newest first");
        const body = await app.textContent("body");
        check(!body.includes(PASSWORD) && !body.includes("JBSWY3DPEHPK3PXP"), "secrets are masked in the list");
        check(await app.locator(".cb-clip-row.secret").count() === 2, "two clips show as secrets (the password, the otpauth link)");
        await shot(app, "list");

        // ---- Search ------------------------------------------------------------------------
        await app.fill("[data-testid='search']", "grocery");
        await app.waitForFunction(() => document.querySelectorAll('.cb-clip-row').length === 1);
        check(true, "search finds the grocery list");
        await app.fill("[data-testid='search']", "hunter");
        await app.waitForSelector("[data-testid='empty']");
        check(true, "search never matches a secret's text");
        await app.fill("[data-testid='search']", "");

        // ---- Categories --------------------------------------------------------------------
        await appMenu("Categories");
        await app.waitForSelector("[data-testid='category-new']");
        for (const name of ["Work", "Home"]) {
            await app.click("[data-testid='category-new']");
            await app.fill("[data-testid='name-field']", name);
            await app.click("[data-testid='name-ok']");
            await app.waitForSelector(`[data-testid='category-${name}']`);
        }
        await app.click("[data-testid='category-rename-Home']");
        await app.fill("[data-testid='name-field']", "Family");
        await app.click("[data-testid='name-ok']");
        await app.waitForSelector("[data-testid='category-Family']");
        await app.click("[data-testid='category-up-Family']");
        await app.waitForFunction(() => document.querySelector("[data-testid^='category-']:not([data-testid^='category-new'])")?.getAttribute("data-testid") === "category-Family");
        let cats = (await svc(app, "luna://org.webosphoenix.clipboard/history", {})).categories.map((c) => c.name);
        check(cats.join() === "Family,Work", "categories added, renamed and reordered");
        await shot(app, "categories");
        await app.keyboard.press("Escape");
        await app.waitForSelector("[data-testid='tab-recent']");
        check(await app.locator("[data-testid='tabs'] [role='tab']").allTextContents().then((t) => t.join()) === "Recent,Pinned,Family,Work",
              "tabs: Recent, Pinned, then the categories in order");

        // ---- A clip: pin, move, edit, delete -----------------------------------------------
        const open = async (text) => {
            await app.click(`[data-testid^='clip-']:has-text("${text}")`);
            await app.waitForSelector("[data-testid='detail-body']");
        };
        await open("Grocery list");
        await app.click("[data-testid='detail-pin-toggle']");
        await app.waitForSelector("[data-testid='detail-pin-toggle'][aria-checked='true']");
        await app.click("[data-testid='detail-category']");
        await app.click("role=option[name='Work']");
        await app.waitForFunction(() => document.querySelector("[data-testid='detail-category']")?.textContent.includes("Work"));
        await app.click("[data-testid='detail-edit']");
        await app.fill("[data-testid='edit-text']", "Grocery list: milk, bread, eggs");
        await app.click("[data-testid='edit-save']");
        await app.waitForSelector("[data-testid='detail-text']:has-text('eggs')");
        await shot(app, "clip");
        const g = (await history()).find((c) => /Grocery/.test(c.text || ""));
        check(g && g.pinned && g.text.endsWith("eggs") && g.category === (await svc(app, "luna://org.webosphoenix.clipboard/history", {})).categories.find((c) => c.name === "Work").id,
              "pinned, moved to Work and edited");
        await app.keyboard.press("Escape");
        await app.click("[data-testid='tab-pinned']");
        await app.waitForFunction(() => document.querySelectorAll('.cb-clip-row').length === 1);
        await app.click("[data-testid='tab-Work'], [data-testid^='tab-c']:has-text('Work')");
        await app.waitForFunction(() => document.querySelectorAll('.cb-clip-row').length === 1);
        check(true, "the Pinned and Work tabs show it");
        await app.click("[data-testid='tab-recent']");
        await open("Meet at the old station");
        await app.click("[data-testid='detail-delete']");
        await app.click("[data-testid='delete-ok']");
        await app.waitForSelector("[data-testid='tab-recent']");
        check(!(await history()).some((c) => /old station/.test(c.text || "")), "a clip deleted");

        // ---- Secrets -------------------------------------------------------------------------
        await app.click(".cb-clip-row.secret:has-text('Password')");
        await app.waitForSelector("[data-testid='detail-mask']");
        await app.click("[data-testid='detail-reveal']");
        await app.fill("[data-testid='reveal-passcode']", "0000");
        await app.click("[data-testid='reveal-ok']");
        await app.waitForSelector("[data-testid='reveal-error']");
        check(/not the device passcode/.test(await app.textContent("[data-testid='reveal-error']")), "a wrong passcode reveals nothing");
        await app.fill("[data-testid='reveal-passcode']", PIN);
        await app.click("[data-testid='reveal-ok']");
        await app.waitForSelector("[data-testid='detail-revealed']");
        check(await app.textContent("[data-testid='detail-revealed']") === PASSWORD, "the device passcode reveals the password");
        await shot(app, "secret-revealed");
        await app.click("[data-testid='detail-send']");
        await app.waitForTimeout(200);
        const toPasswords = launches.find((l) => l.id === "org.webosphoenix.passwords");
        check(toPasswords && toPasswords.params && toPasswords.params.newEntry && toPasswords.params.newEntry.password === PASSWORD,
              "Save to Passwords opens Passwords with a new entry holding it");
        // The screen locks: hidden again.
        await app.evaluate(() => __phoenixRuntime.applyHostStatus({ deviceLocked: true }));
        await app.waitForSelector("[data-testid='detail-mask']");
        check(true, "locking the screen hides it again");
        await app.evaluate(() => __phoenixRuntime.applyHostStatus({ deviceLocked: false }));
        await app.keyboard.press("Escape");
        await app.click(".cb-clip-row.secret:has-text('Authenticator link')");
        await app.click("[data-testid='detail-send']");
        await app.fill("[data-testid='reveal-passcode']", PIN);
        await app.click("[data-testid='reveal-ok']");
        await app.waitForTimeout(200);
        const toAuth = launches.find((l) => l.id === "org.webosphoenix.authenticator");
        check(toAuth && toAuth.params && toAuth.params.otpauth === OTPAUTH, "Add to Authenticator opens it with the otpauth link");
        await app.keyboard.press("Escape");
        const stored = await app.evaluate(() => JSON.stringify({ ...localStorage }));
        check(!stored.includes(PASSWORD) && !stored.includes("JBSWY3DPEHPK3PXP") && !stored.includes(btoa(PASSWORD)),
              "no secret in the stored data, in any form");

        // ---- Settings > Clipboard ------------------------------------------------------------
        const st = await context.newPage();
        watch(st, "settings");
        await st.goto(settingsUrl);
        await st.waitForSelector("[data-testid='cb-enabled']");
        await shot(st, "settings");
        const settings = async () => (await svc(st, "luna://org.webosphoenix.clipboard/getSettings", {})).settings;
        const until = async (fn, what) => {
            for (let i = 0; i < 40; ++i) {
                if (fn(await settings())) return check(true, what);
                await st.waitForTimeout(100);
            }
            check(false, what);
        };
        await st.click("[data-testid='cb-keepFor']");
        await st.click("role=option[name='1 day']");
        await until((s) => s.keepFor === "day", "Keep: 1 day");
        await st.click("[data-testid='cb-maxItems']");
        await st.click("role=option[name='25 clips']");
        await until((s) => s.maxItems === 25, "Up to: 25 clips");
        await st.click("[data-testid='cb-clearOnLock']");
        await until((s) => s.clearOnLock === true, "Clear when locked: on");
        await st.click("[data-testid='cb-sensitive']");
        await st.click("role=option[name=\"Don't keep\"]");
        await until((s) => s.sensitive === "skip", "Passwords and codes: not kept");
        await st.click("[data-testid='cb-detectSecrets']");
        await until((s) => s.detectSecrets === false, "Recognize secrets: off");
        await st.click("[data-testid='cb-keyboardKey']");
        await until((s) => s.keyboardKey === false, "Keyboard key: off");
        await st.click("[data-testid='cb-exclude-add']");
        await st.click("role=option[name='Flashlight']");
        await until((s) => s.excludedApps.includes("org.webosphoenix.flashlight"), "Flashlight excluded");
        await st.waitForSelector("[data-testid='cb-excluded-org.webosphoenix.flashlight']");
        await shot(st, "settings-changed");
        check((await svc(st, "luna://org.webosphoenix.clipboard/add", { text: "from flashlight", source: "org.webosphoenix.flashlight" })).skipped === "excluded",
              "an excluded app's copy is not kept");
        await st.click("[data-testid='cb-include-org.webosphoenix.flashlight']");
        await until((s) => s.excludedApps.length === 0, "Flashlight included again");
        // The app follows: the Clipboard app's list after Clear History keeps the pinned clip.
        await st.click("[data-testid='cb-clear']");
        await st.click("[data-testid='cb-clear-ok']");
        await st.waitForSelector("[data-testid='cb-cleared']");
        clips = await history();
        check(clips.length === 1 && /Grocery/.test(clips[0].text), "Clear History keeps the pinned, saved clip");
        await app.waitForFunction(() => document.querySelectorAll('.cb-clip-row').length === 1);
        check(true, "the Clipboard app follows at once");
        await st.click("[data-testid='cb-enabled']");
        await until((s) => s.enabled === false, "Clipboard history: off");
        check(await st.locator("[data-testid='cb-keepFor'][aria-disabled='true']").count() === 1, "its choices are greyed while off");
        check((await svc(st, "luna://org.webosphoenix.clipboard/add", { text: "while off" })).skipped === "off", "nothing is kept while off");
        await app.waitForSelector("[data-testid='off-note']");
        check(true, "the Clipboard app says the history is off");
        await shot(app, "off");
        await st.click("[data-testid='cb-enabled']");
        await until((s) => s.enabled === true, "Clipboard history: on again");
        await st.click("[data-testid='cb-clear-all']");
        await st.click("[data-testid='cb-clear-ok']");
        // Clear History's note was showing: wait for this clear's own answer.
        // (Settings drops it when a clear starts.)
        await st.waitForFunction(() => /cleared/.test(document.querySelector("[data-testid='cb-cleared']")?.textContent || ""));
        check((await history()).length === 0, "Clear All Clips clears saved clips too");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
