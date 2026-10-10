#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Enact Notes demos (apps/enact-notes-limestone and
// apps/enact-notes-agate, built into dist/) in headless Chromium against the
// simulated db8 in runtime/phoenix-runtime.js, at tablet size. In Limestone:
// the welcome note is there on a first run; a new note is written in
// Markdown and saved; a box is checked in the preview and stays checked
// after a reload; a folder is made; search finds the note. In Agate (which
// shares the notes): the note and the folder are there; a box checked here
// shows in Limestone; the note moves to the folder, goes to Recently
// Deleted and comes back. On a phone (320 px) each shows one pane at a
// time, the note in the list's place, and Back closes the note.
//
//   node tools/test-enact-notes.cjs [--out DIR]
//
// Build the apps first (apps/enact-notes-*/README.md).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "enact-notes-tests");
const viewport = { width: 1024, height: 740 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const LIMESTONE = "org.webosphoenix.enactnotes.limestone";
const AGATE = "org.webosphoenix.enactnotes.agate";
const appUrl = (id) => `${origin}/usr/palm/applications/${id}/index.html`;

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

// Enact's rows and buttons are .spottable elements; icon buttons are found
// by their aria-label.
const spot = (page, text) => page.locator(".spottable", { hasText: text }).first();
const button = (page, label) => page.locator(`[aria-label="${label}"]`).first();
const pause = (page, ms = 700) => page.waitForTimeout(ms);

async function main() {
    for (const app of ["enact-notes-limestone", "enact-notes-agate"]) {
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
        const context = await browser.newContext({ viewport });
        const errors = [];
        const open = async (id) => {
            const page = await context.newPage();
            page.on("pageerror", (e) => errors.push(`${id}: ${e.message}`));
            page.on("console", (m) => {
                if (m.type() === "error" && !/Failed to load resource|ERR_CERT|gstatic/.test(m.text())) errors.push(`${id}: ${m.text()}`);
            });
            await page.goto(appUrl(id));
            await pause(page, 2000);
            return page;
        };
        const editorText = (page) => page.locator("textarea").inputValue();

        // ---- Limestone --------------------------------------------------------
        const lime = await open(LIMESTONE);
        check(await spot(lime, "Welcome to Notes").isVisible(), "Limestone: the welcome note is there on a first run");
        await spot(lime, "Welcome to Notes").click();
        await pause(lime);
        check((await editorText(lime)).startsWith("# Welcome to Notes"), "Limestone: a note opens as Markdown");

        await button(lime, "New Note").click();
        await pause(lime);
        const area = lime.locator("textarea");
        await area.focus();
        await area.press("End");
        await lime.keyboard.type("Groceries");
        await lime.keyboard.press("Enter");
        await lime.keyboard.press("Enter");
        await lime.keyboard.type("- [ ] milk");
        await lime.keyboard.press("Enter");
        await lime.keyboard.type("eggs");
        await pause(lime, 1200);
        check(await editorText(lime) === "# Groceries\n\n- [ ] milk\n- [ ] eggs", "Limestone: a new note starts with a title, and Enter continues a checklist");
        check(await spot(lime, "Groceries").isVisible(), "Limestone: the note is listed by its first line");
        await lime.screenshot({ path: path.join(outDir, "limestone-editor.png") });

        await button(lime, "Preview").click();
        await pause(lime);
        check(await lime.locator("input[data-task]").count() === 2, "Limestone: the preview shows two task boxes");
        await lime.locator('input[data-task="1"]').click();
        await pause(lime, 1200);
        await lime.screenshot({ path: path.join(outDir, "limestone-preview.png") });
        await lime.reload();
        await pause(lime, 2000);
        await spot(lime, "Groceries").click();
        await pause(lime);
        check((await editorText(lime)).includes("- [x] eggs"), "Limestone: a box checked in the preview is saved to db8");

        await button(lime, "Folders").click();
        await pause(lime);
        await spot(lime, "New Folder").click();
        await pause(lime);
        await lime.keyboard.type("Work");
        await lime.keyboard.press("Enter");
        await pause(lime, 1200);
        check(await lime.locator(".spottable", { hasText: "Work" }).count() > 0, "Limestone: a folder is made");

        await spot(lime, "All Notes").click();
        await pause(lime);
        await lime.locator('[placeholder="Search"]').click();
        await lime.keyboard.type("eggs");
        await lime.keyboard.press("Enter");
        await pause(lime);
        check((await lime.textContent("body")).includes("1 found in All Notes"), "Limestone: search finds the note by its text");
        await lime.screenshot({ path: path.join(outDir, "limestone-search.png") });

        // ---- Agate (the same notes) -------------------------------------------
        const agate = await open(AGATE);
        check(await spot(agate, "Groceries").isVisible(), "Agate: the note written in Limestone is there");
        check(await agate.locator(".spottable", { hasText: "Work" }).count() > 0, "Agate: so is the folder, as a tab");
        await spot(agate, "Groceries").click();
        await pause(agate);
        await spot(agate, "Preview").click();
        await pause(agate);
        await agate.locator('input[data-task="0"]').click();
        await pause(agate, 1200);
        check((await agate.textContent("body")).includes("2 of 2 done"), "Agate: checking a box updates the progress bar");
        await agate.screenshot({ path: path.join(outDir, "agate-preview.png") });

        await lime.reload();
        await pause(lime, 2000);
        await spot(lime, "Groceries").click();
        await pause(lime);
        check((await editorText(lime)).includes("- [x] milk"), "Limestone: a box checked in Agate shows here");

        await button(agate, "More").click();
        await pause(agate);
        await agate.locator("#floatLayer .spottable", { hasText: "Move" }).first().click();
        await pause(agate);
        await agate.locator("#floatLayer .spottable", { hasText: "Work" }).first().click();
        await pause(agate, 1000);
        await agate.locator(".spottable", { hasText: "Work" }).first().click();
        await pause(agate);
        check(await spot(agate, "Groceries").isVisible(), "Agate: the note moves to the folder");

        await spot(agate, "Groceries").click();
        await pause(agate);
        await button(agate, "More").click();
        await pause(agate);
        // The action menu, then the confirmation (both in Enact's floating layer).
        await agate.locator("#floatLayer .spottable", { hasText: "Delete" }).first().click();
        await pause(agate);
        await agate.locator("#floatLayer .spottable", { hasText: /^Delete$/ }).first().click();
        await pause(agate, 1000);
        await spot(agate, "Recently Deleted").click();
        await pause(agate);
        check(await spot(agate, "Groceries").isVisible(), "Agate: a deleted note is in Recently Deleted");
        await spot(agate, "Groceries").click();
        await pause(agate);
        await spot(agate, "Recover").click();
        await pause(agate, 1000);
        check(!(await spot(agate, "Groceries").isVisible().catch(() => false)), "Agate: a recovered note leaves Recently Deleted");
        await agate.screenshot({ path: path.join(outDir, "agate-recovered.png") });

        // ---- A phone (320 px): one pane at a time, Back closes the note -------
        for (const [id, name] of [[AGATE, "Agate"], [LIMESTONE, "Limestone"]]) {
            const page = await context.newPage();
            await page.setViewportSize({ width: 320, height: 452 });
            page.on("pageerror", (e) => errors.push(`${id} (phone): ${e.message}`));
            await page.goto(appUrl(id));
            await pause(page, 2500);
            check(await page.locator("textarea").count() === 0 && await spot(page, "Groceries").isVisible(),
                  `${name} on a phone: the notes alone, no note beside them`);
            await spot(page, "Groceries").click();
            await pause(page, 1000);
            check(await page.locator("textarea").count() > 0 && !(await spot(page, "Groceries").isVisible().catch(() => false)),
                  `${name} on a phone: a note opens in the list's place`);
            await page.screenshot({ path: path.join(outDir, `${name.toLowerCase()}-phone-note.png`) });
            check(await page.evaluate(() => __phoenixRuntime.back()) === true, `${name} on a phone: Back is the app's while a note is open`);
            await pause(page, 1000);
            check(await page.locator("textarea").count() === 0 && await spot(page, "Groceries").isVisible(),
                  `${name} on a phone: and goes back to the notes`);
            check(await page.evaluate(() => __phoenixRuntime.back()) === false, `${name} on a phone: then Back is the system's`);
            await page.close();
        }

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
