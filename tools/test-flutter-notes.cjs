#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Flutter Notes demo (apps/flutter-notes, built into dist/) in
// headless Chromium against the simulated db8 in runtime/phoenix-runtime.js.
// Flutter draws into a canvas, so the test works through its semantics tree
// (the accessible DOM Flutter keeps beside the canvas) and reads the notes
// back from db8. At tablet size: the welcome note is there on a first run;
// a new note is written in Markdown (Enter continues a checklist); a box
// checked in the preview is saved; a folder is made and the note moved into
// it; search finds it; a deleted note comes back with Undo. At phone size:
// the note takes the screen and Escape (webOS's back gesture) returns to
// the list. Then the Ionic demo shows the same note, and a box it checks
// shows here.
//
//   node tools/test-flutter-notes.cjs [--out DIR]
//
// Build the apps first (apps/flutter-notes/README.md; the Ionic demo with
// npm run build in apps/).

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
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "flutter-notes-tests");
const TABLET = { width: 1024, height: 740 };
const PHONE = { width: 390, height: 780 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id) => `${origin}/usr/palm/applications/${id}/index.html`;
const FLUTTER = "org.webosphoenix.flutternotes";
const IONIC = "org.webosphoenix.ionicnotes";

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

const pause = (page, ms = 700) => page.waitForTimeout(ms);

// The notes in db8, through the page's own Luna bridge.
function notes(page) {
    return page.evaluate(() => new Promise((resolve) => {
        const b = new PalmServiceBridge();
        b.onservicecallback = (json) => resolve(JSON.parse(json).results || []);
        b.call("luna://com.palm.db/find", JSON.stringify({ query: { from: "org.webosphoenix.enactnotes.note:1" } }));
    }));
}
const bodyOf = async (page, title) => ((await notes(page)).find((n) => n.body.startsWith(`# ${title}`)) || {}).body || "";

async function main() {
    for (const app of ["flutter-notes", "ionic-notes"]) {
        if (!fs.existsSync(path.join(REPO, "apps", app, "dist/index.html"))) {
            console.error(`apps/${app}/dist is missing: build it first (apps/${app}/README.md)`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        // Flutter's engine reads navigator.language; set it (a machine with no
        // locale gives Chromium's "en-US@posix", which Flutter rejects).
        const context = await browser.newContext({ viewport: TABLET, locale: "en-US" });
        const errors = [];
        const open = async (id, wait = 5000) => {
            const page = await context.newPage();
            page.on("pageerror", (e) => errors.push(`${id}: ${e.message}`));
            page.on("console", (m) => {
                if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${id}: ${m.text()}`);
            });
            await page.goto(appUrl(id));
            await pause(page, wait);
            return page;
        };
        const page = await open(FLUTTER);
        const button = (name) => page.getByRole("button", { name, exact: true }).first();
        const text = (t) => page.getByText(t, { exact: true }).first();
        // A list row or folder: one button, named by its title and then its
        // other lines (date, preview, count).
        const row = (title) => page.getByRole("button", { name: new RegExp(`^${title}\\b`) }).first();

        // ---- Tablet ------------------------------------------------------------
        check(await row("Welcome to Notes").isVisible(), "tablet: the welcome note is there on a first run");
        check(await text("Folders").isVisible(), "tablet: the folders are beside the notes");

        await button("New Note").click();
        await pause(page, 1200);
        await page.keyboard.type("Groceries");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await page.keyboard.type("- [ ] milk");
        await page.keyboard.press("Enter");
        await page.keyboard.type("eggs");
        await pause(page, 1500);
        check(await bodyOf(page, "Groceries") === "# Groceries\n\n- [ ] milk\n- [ ] eggs",
            "tablet: a new note starts with a title, Enter continues a checklist, and it is saved to db8");
        check(await row("Groceries").isVisible(), "tablet: the note is listed by its first line");
        await page.screenshot({ path: path.join(outDir, "tablet-editor.png") });

        await text("Preview").click();
        await pause(page, 1000);
        check(await page.getByRole("checkbox").count() === 2, "tablet: the preview shows two task boxes");
        await page.getByRole("checkbox", { name: "Task 2" }).click();
        await pause(page, 1500);
        check(await text("1 of 2 done").isVisible(), "tablet: checking a box updates the progress bar");
        check((await bodyOf(page, "Groceries")).includes("- [x] eggs"), "tablet: the checked box is saved to db8");
        await page.screenshot({ path: path.join(outDir, "tablet-preview.png") });

        await button("New Folder").click();
        await pause(page, 800);
        await page.keyboard.type("Work");
        await page.keyboard.press("Enter");
        await pause(page, 1200);
        check(await row("Work").isVisible(), "tablet: a folder is made");

        await row("All Notes").click();
        await pause(page);
        await row("Groceries").click();
        await pause(page);
        await button("More").click();
        await pause(page);
        await text("Move to Folder…").click();
        await pause(page);
        await page.getByRole("radio", { name: "Work" }).click();
        await pause(page, 1200);
        await row("Work").click();
        await pause(page, 1000);
        check(await row("Groceries").isVisible(), "tablet: the note moves to the folder");

        await row("All Notes").click();
        await pause(page);
        await page.getByRole("searchbox", { name: "Search" }).click();
        await page.keyboard.type("eggs");
        await pause(page, 1000);
        check(await text("1 found").isVisible(), "tablet: search finds the note by its text");
        await page.screenshot({ path: path.join(outDir, "tablet-search.png") });
        await button("Clear").click();
        await pause(page);

        await row("Groceries").click();
        await pause(page);
        await button("More").click();
        await pause(page);
        await text("Delete Note").click();
        await pause(page, 1200);
        check(!(await row("Groceries").isVisible().catch(() => false)), "tablet: a deleted note leaves the list");
        await button("Undo").click();
        await pause(page, 1500);
        check(await row("Groceries").isVisible(), "tablet: Undo brings it back");

        // ---- Phone ---------------------------------------------------------------
        await page.setViewportSize(PHONE);
        await pause(page, 1500);
        check(!(await row("Recently Deleted").isVisible().catch(() => false)), "phone: the folders are a drawer, closed");
        await row("Groceries").click();
        await pause(page, 1200);
        check(await button("Back").isVisible(), "phone: the note takes the screen, with a back button");
        await page.screenshot({ path: path.join(outDir, "phone-note.png") });
        await page.keyboard.press("Escape");
        await pause(page, 1200);
        check(!(await button("Back").isVisible().catch(() => false)) && await row("Groceries").isVisible(),
            "phone: Escape (the back gesture) returns to the list");
        await button("Folders").click();
        await pause(page, 1000);
        check(await row("Recently Deleted").isVisible(), "phone: the menu button opens the folders");
        await page.screenshot({ path: path.join(outDir, "phone-drawer.png") });
        await page.keyboard.press("Escape");
        await pause(page, 800);

        // ---- The Ionic demo, on the same notes ---------------------------------
        const ionic = await open(IONIC, 2500);
        const ionicRow = ionic.locator("ion-item.note-row:has-text(\"Groceries\") >> visible=true").first();
        check(await ionicRow.isVisible(), "Ionic: the note written in Flutter is there");
        check(await ionic.locator("ion-menu ion-item", { hasText: "Work" }).count() > 0, "Ionic: so is the folder");
        await ionicRow.click();
        await pause(ionic);
        await ionic.locator("ion-segment-button:has-text(\"Preview\") >> visible=true").first().click();
        await pause(ionic);
        await ionic.locator('.note-preview input[data-task="0"]').click();
        await pause(ionic, 1500);
        await page.reload();
        await pause(page, 5000);
        await row("Groceries").click();
        await pause(page, 1000);
        await text("Preview").click();
        await pause(page, 1000);
        check(await text("2 of 2 done").isVisible(), "Flutter: a box checked in Ionic shows here");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
