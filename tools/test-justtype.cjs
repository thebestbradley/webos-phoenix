#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Use the original Just Type (com.palm.launcher, openwebos/luna-applauncher)
// the way a person would, in headless Chromium with the simulator's runtime
// and sample data, and check what it finds:
//
//   apps      "ca" launches Calculator, Calendar and Camera
//   contacts  "ada" finds Ada Palmer and her number
//   content   "dentist" finds the calendar event (Calendar's "dbsearch" in
//             appinfo.json), and tapping it opens the event
//   actions   New Memo carries the typed text to Memos
//   web       Search Google opens the browser with the query
//
//   node tools/test-justtype.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "justtype-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const justType = `${origin}/usr/palm/applications/com.palm.launcher/index.html`;

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
        const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const launches = () => host.filter((m) => m.type === "launch").map((m) => m.payload);
        // Clear the field (the cancel icon) and type a new search.
        const search = async (s) => {
            await page.evaluate(() => {
                const jt = enyo.$.justTypeApp.$.justType;
                jt.clearSearchText();
                jt.forceFocus();
            });
            await page.keyboard.type(s, { delay: 40 });
            await page.waitForTimeout(1500);
        };

        // The demo data (memos, contacts...) is seeded by the runtime on first use.
        await page.goto(justType);
        await page.waitForTimeout(2500);
        check(await page.locator("[contenteditable]").first().isVisible(), "the Just Type field is shown");

        await search("ca");
        let t = await text();
        check(/LAUNCH/.test(t) && /Calculator/.test(t) && /Calendar/.test(t) && /Camera/.test(t),
              "apps: \"ca\" offers Calculator, Calendar and Camera");
        check(/Search Google/.test(t), "web: Search Google is offered");
        check(/New Memo/.test(t) && /New Event/.test(t), "actions: New Memo and New Event are offered");
        await shot("ca");
        host.length = 0;
        await page.locator("[name=appTitle]", { hasText: "Calculator" }).first().click();
        await page.waitForTimeout(500);
        check(launches().some((l) => l.id === "com.palm.app.calculator"), "apps: tapping Calculator launches it");

        await search("ada");
        t = await text();
        check(/CONTACTS \(1\)/.test(t) && /Ada Palmer/.test(t), "contacts: \"ada\" finds Ada Palmer");
        check(/555-0142/.test(t), "contacts: with her number");
        await shot("ada");

        await search("dentist");
        t = await text();
        check(/Calendar Events 1/.test(t), "content: \"dentist\" finds one calendar event");
        await page.getByText("Calendar Events", { exact: true }).first().click();
        await page.waitForTimeout(800);
        t = await text();
        check(/Dentist/.test(t), "content: the Dentist event is listed");
        await shot("dentist");
        host.length = 0;
        await page.locator(".dbcontent-display1:visible", { hasText: "Dentist" }).first().click();
        await page.waitForTimeout(500);
        const ev = launches().find((l) => l.id === "com.palm.app.calendar");
        check(ev && ev.params && /^phoenix-sample-event-/.test(ev.params.showEventDetail || ""), "content: tapping it opens the event in Calendar");

        await search("lunch");
        host.length = 0;
        await page.getByText("New Memo", { exact: true }).first().click();
        await page.waitForTimeout(500);
        const memo = launches().find((l) => l.id === "com.palm.app.notes");
        check(memo && memo.params && memo.params.text === "lunch", "actions: New Memo opens Memos with \"lunch\"");

        await search("webos phoenix");
        host.length = 0;
        await page.getByText("Search Google", { exact: true }).first().click();
        await page.waitForTimeout(500);
        const web = launches().find((l) => l.id === "com.palm.app.browser");
        check(web && /google\.com\/search\?q=webos(%20|\+)phoenix/.test(web.params && web.params.target || ""),
              "web: Search Google opens the browser on the query");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
