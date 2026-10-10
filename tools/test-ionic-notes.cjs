#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Ionic Notes demo (apps/ionic-notes, built into dist/) in
// headless Chromium against the simulated db8 in runtime/phoenix-runtime.js.
// At tablet size: the welcome note is there on a first run; a new note is
// written in Markdown; a box checked in the preview is saved; a folder is
// made and the note moved into it; search finds it; a deleted note comes
// back with Undo. At phone size: a note opens as its own page and Back
// returns to the list, an empty new note is dropped, and the folders are a
// side menu. Escape (webOS's back gesture) goes back too. Then Settings
// switches Ionic to Material Design.
//
//   node tools/test-ionic-notes.cjs [--out DIR]
//
// Build the app first (npm run build in apps/, or apps/ionic-notes/README.md).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// A response read to its end: one left unread, its socket closed under it,
// aborts Node's fetch (undici: assert(!this.paused), seen in CI).
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
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "ionic-notes-tests");
const TABLET = { width: 1024, height: 740 };
const PHONE = { width: 390, height: 780 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const APP = "org.webosphoenix.ionicnotes";
const appUrl = `${origin}/usr/palm/applications/${APP}/index.html`;

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

const pause = (page, ms = 700) => page.waitForTimeout(ms);
// The visible page's controls (Ionic keeps pages it has left in the DOM, hidden).
const visible = (page, selector) => page.locator(`${selector} >> visible=true`).first();
const button = (page, label) => visible(page, `[aria-label="${label}"]`);
const row = (page, text) => visible(page, `ion-item.note-row:has-text("${text}")`);
const menuItem = (page, text) => page.locator("ion-menu ion-item", { hasText: text }).first();

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/ionic-notes/dist/index.html"))) {
        console.error("apps/ionic-notes/dist is missing: build it first (apps/ionic-notes/README.md)");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport: TABLET });
        const errors = [];
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            if ((m.type() === "error" || /Ionic Warning/.test(m.text())) && !/Failed to load resource/.test(m.text())) errors.push(m.text());
        });
        await page.goto(appUrl);
        await pause(page, 2500);
        const editorText = () => visible(page, "textarea.note-editor").inputValue();

        // ---- Tablet ------------------------------------------------------------
        check(await row(page, "Welcome to Notes").isVisible(), "tablet: the welcome note is there on a first run");
        check(await menuItem(page, "Recently Deleted").isVisible(), "tablet: the folders are beside the notes (split pane)");

        await button(page, "New Note").click();
        await pause(page);
        const area = visible(page, "textarea.note-editor");
        await area.focus();
        await area.press("End");
        await page.keyboard.type("Groceries");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await page.keyboard.type("- [ ] milk");
        await page.keyboard.press("Enter");
        await page.keyboard.type("eggs");
        await pause(page, 1200);
        check(await editorText() === "# Groceries\n\n- [ ] milk\n- [ ] eggs", "tablet: a new note starts with a title, and Enter continues a checklist");
        check(await row(page, "Groceries").isVisible(), "tablet: the note is listed by its first line, beside the open note");
        await page.screenshot({ path: path.join(outDir, "tablet-editor.png") });

        await visible(page, 'ion-segment-button:has-text("Preview")').click();
        await pause(page);
        check(await page.locator(".note-preview input[data-task]").count() === 2, "tablet: the preview shows two task boxes");
        await page.locator('.note-preview input[data-task="1"]').click();
        await pause(page, 1200);
        check((await page.textContent("body")).includes("1 of 2 done"), "tablet: checking a box updates the progress bar");
        await page.screenshot({ path: path.join(outDir, "tablet-preview.png") });
        await page.reload();
        await pause(page, 2500);
        await row(page, "Groceries").click();
        await pause(page);
        check((await editorText()).includes("- [x] eggs"), "tablet: a box checked in the preview is saved to db8");

        await page.locator("ion-menu ion-button", { hasText: "New Folder" }).click();
        await pause(page);
        await page.locator("ion-alert input").fill("Work");
        await page.locator("ion-alert .alert-button", { hasText: "Save" }).click();
        await pause(page, 1000);
        check(await menuItem(page, "Work").isVisible(), "tablet: a folder is made");

        await menuItem(page, "All Notes").click();
        await pause(page);
        await row(page, "Groceries").click();
        await pause(page);
        await button(page, "More").click();
        await pause(page);
        await page.locator("ion-action-sheet .action-sheet-button", { hasText: "Move to Folder" }).click();
        await pause(page);
        await page.locator("ion-modal ion-item", { hasText: "Work" }).locator("ion-radio").click();
        await pause(page, 1000);
        await menuItem(page, "Work").click();
        await pause(page);
        check(await row(page, "Groceries").isVisible(), "tablet: the note moves to the folder");

        await menuItem(page, "All Notes").click();
        await pause(page);
        await visible(page, "ion-searchbar input").fill("eggs");
        await pause(page, 800);
        check((await page.textContent("body")).includes("1 found"), "tablet: search finds the note by its text");
        await page.screenshot({ path: path.join(outDir, "tablet-search.png") });
        await visible(page, "ion-searchbar input").fill("");
        await pause(page);

        await row(page, "Groceries").click();
        await pause(page);
        await button(page, "More").click();
        await pause(page);
        await page.locator("ion-action-sheet .action-sheet-button", { hasText: "Delete Note" }).click();
        await pause(page, 800);
        check(!(await row(page, "Groceries").isVisible().catch(() => false)), "tablet: a deleted note leaves the list");
        await page.locator("ion-toast").getByRole("button", { name: "Undo" }).click();
        await pause(page, 1000);
        check(await row(page, "Groceries").isVisible(), "tablet: Undo brings it back");

        // ---- Phone (same notes: the same origin's db8) --------------------------
        await page.setViewportSize(PHONE);
        await pause(page, 1000);
        check(!(await menuItem(page, "Recently Deleted").isVisible()), "phone: the folders are a side menu, closed");
        await row(page, "Groceries").click();
        await pause(page, 1200);
        check(/#\/note\//.test(page.url()), "phone: a note opens as its own page");
        check((await editorText()).includes("- [x] eggs"), "phone: it is the same note");
        await page.screenshot({ path: path.join(outDir, "phone-note.png") });
        await visible(page, "ion-back-button").click();
        await pause(page, 1200);
        check(!/#\/note\//.test(page.url()) && await row(page, "Groceries").isVisible(), "phone: Back returns to the list");

        await row(page, "Groceries").click();
        await pause(page, 1200);
        await page.keyboard.press("Escape");
        await pause(page, 1200);
        check(!/#\/note\//.test(page.url()) && await row(page, "Groceries").isVisible(), "phone: Escape (the back gesture) returns to the list");

        const before = await page.locator("ion-item.note-row").count();
        await button(page, "New Note").click();
        await pause(page, 1200);
        await visible(page, "ion-back-button").click();
        await pause(page, 1500);
        check(await page.locator("ion-item.note-row").count() === before, "phone: a new note left with only its \"# \" start is not kept");

        await visible(page, "ion-menu-button").click();
        await pause(page);
        check(await menuItem(page, "Work").isVisible(), "phone: the menu button opens the folders");
        await page.screenshot({ path: path.join(outDir, "phone-menu.png") });

        await button(page, "Settings").click();
        await pause(page, 1200);
        await visible(page, 'ion-item:has-text("Style") ion-select').click();
        await pause(page);
        await page.locator("ion-popover ion-radio", { hasText: "Material Design" }).click();
        await page.waitForLoadState("load");
        await pause(page, 2500);
        check(await page.evaluate(() => document.documentElement.classList.contains("md")), "Settings: the style switches Ionic to Material Design");
        await page.goto(appUrl);
        await pause(page, 2500);
        check(await visible(page, "ion-fab-button").isVisible(), "Material Design: New Note is a floating action button");
        await page.screenshot({ path: path.join(outDir, "phone-md.png") });

        // ---- The Phoenix service plugin (@phoenix/sdk, react, capacitor) ------
        // The status bar's app name: the app menu, Edit and Share first.
        await page.evaluate(() => window.__phoenixRuntime.openAppMenu());
        await pause(page, 400);
        const menuLabels = await page.locator(".phx-appmenu-item").allTextContents();
        check(JSON.stringify(menuLabels) === JSON.stringify(["Edit", "Share", "New Note", "Settings"]),
              "SDK: the app menu has Edit, Share, New Note and Settings (" + menuLabels.join(", ") + ")");
        check(await page.locator(".phx-appmenu-item.disabled", { hasText: "Share" }).count() === 1, "SDK: Share is dimmed with no note open");
        await page.screenshot({ path: path.join(outDir, "phone-appmenu.png") });
        await page.keyboard.press("Escape");
        await pause(page, 400);
        check(await page.locator(".phx-appmenu").count() === 0, "SDK: the back gesture closes the app menu");
        // A share from another app (appinfo.json shareTargets) becomes a note.
        await page.evaluate(() => window.__phoenixRuntime.relaunch({ share: { title: "Shared Recipe", text: "Flour and eggs" } }));
        await pause(page, 1500);
        check(await visible(page, "textarea.note-editor").inputValue() === "# Shared Recipe\n\nFlour and eggs", "SDK: a share received becomes a new note");
        // Just Type's "New Note (Ionic)" action ({newNote: words}).
        await page.keyboard.press("Escape");
        await pause(page, 1000);
        await page.evaluate(() => window.__phoenixRuntime.relaunch({ newNote: "Typed in Just Type" }));
        await pause(page, 1500);
        check(await visible(page, "textarea.note-editor").inputValue() === "Typed in Just Type", "SDK: Just Type's action makes a note of the words");
        // Share in the app menu now shares the open note: the system's sheet opens.
        await page.evaluate(() => window.__phoenixRuntime.openAppMenu());
        await pause(page, 400);
        await page.locator(".phx-appmenu-item", { hasText: "Share" }).click();
        await pause(page, 1500);
        check(await page.locator("iframe[src*='org.webosphoenix.sharesheet']").count() === 1, "SDK: Share opens the system's share sheet (Capacitor plugin)");
        await page.screenshot({ path: path.join(outDir, "phone-share.png") });

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
