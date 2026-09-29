#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Help (apps/help, built into dist/) in headless Chromium with the
// simulator's runtime: the topic list by category, search, a topic page with
// its links to other topics and "Open" button, the back gesture, the
// {topic} and {search} launch params, and Just Type's content search finding
// a help topic and opening it (the topics are put into db8 from
// help-index.json).
//
//   node tools/test-help.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "help-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8400 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const APP = "org.webosphoenix.help";
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
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

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/help/dist/help-index.json"))) {
        console.error("apps/help/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource|tellurium/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        const launches = () => host.filter((m) => m.type === "launch").map((m) => m.payload);
        const shownTopic = () => page.locator("[data-testid=topic]").first().getAttribute("data-topic").catch(() => null);

        // ---- The list ------------------------------------------------------------
        await page.goto(appUrl(APP));
        await page.waitForSelector("[data-testid=topic-gestures]");
        let t = await text();
        check(/Basics/.test(t) && /Apps/.test(t) && /Settings/.test(t), "topics grouped as Basics, Apps and Settings");
        for (const id of ["gestures", "cards", "launcher", "notifications", "justtype", "phone", "tasks", "voicememos", "emergency", "location"])
            check(await page.locator(`[data-testid=topic-${id}]`).count() === 1, `topic listed: ${id}`);
        await shot("list");

        // ---- Search --------------------------------------------------------------
        await page.fill("[data-testid=help-search]", "blood type");
        await page.waitForTimeout(200);
        t = await text();
        check(/1 topic/.test(t) && await page.locator("[data-testid=topic-emergency]").count() === 1, "search: \"blood type\" finds Emergency Info");
        await page.fill("[data-testid=help-search]", "flick");
        await page.waitForTimeout(200);
        const first = await page.locator("[data-testid^=topic-]").first().getAttribute("data-testid");
        check(first === "topic-cards" || first === "topic-gestures", "search: \"flick\" puts cards or gestures first (" + first + ")");
        await shot("search");
        await page.fill("[data-testid=help-search]", "qqqxyz");
        await page.waitForTimeout(200);
        check(/No help topics match/.test(await text()), "search: nothing found says so");
        await page.fill("[data-testid=help-search]", "");

        // ---- A topic -------------------------------------------------------------
        await page.click("[data-testid=topic-gestures]");
        await page.waitForTimeout(300);
        check(await shownTopic() === "gestures", "a topic opens");
        t = await text();
        check(/gesture area/.test(t) && /Swipe up/.test(t), "the topic's text is shown");
        check(await page.locator(".help-article strong").count() > 0 && await page.locator(".help-article ul li").count() >= 4,
              "Markdown: bold and a list");
        await shot("topic");
        await page.locator(".help-article a", { hasText: "Cards" }).first().click();
        await page.waitForTimeout(300);
        check(await shownTopic() === "cards", "a link opens another topic");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        check(await shownTopic() === "gestures", "back returns to the topic before");
        if (!tablet) {
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            check(await page.locator("[data-testid=help-search]").isVisible(), "back again returns to the list (phone)");
        }

        // ---- Launch params and Open ------------------------------------------------
        await page.goto(appUrl(APP, { topic: "tasks" }));
        await page.waitForSelector("[data-testid=topic]");
        check(await shownTopic() === "tasks", "{topic: \"tasks\"} opens that topic");
        host.length = 0;
        await page.click("[data-testid=open-app]");
        await page.waitForTimeout(300);
        check(launches().some((l) => l.id === "org.webosphoenix.tasks"), "Open Tasks launches Tasks");
        await shot("launched-topic");
        await page.evaluate(() => window.__phoenixRuntime.relaunch({ search: "passcode" }));
        await page.waitForTimeout(300);
        check(await page.inputValue("[data-testid=help-search]") === "passcode", "relaunched with {search} searches");

        // ---- Just Type -------------------------------------------------------------
        const jt = await context.newPage();
        jt.on("console", (m) => {
            const s = m.text();
            if (s.startsWith("__phoenix__")) host.push(JSON.parse(s.slice(11)));
        });
        await jt.goto(`${origin}/usr/palm/applications/com.palm.launcher/index.html`);
        await jt.waitForTimeout(2500);
        await jt.evaluate(() => {
            const j = enyo.$.justTypeApp.$.justType;
            j.clearSearchText();
            j.forceFocus();
        });
        await jt.keyboard.type("gesture", { delay: 40 });
        await jt.waitForTimeout(1500);
        const jtText = (await jt.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        check(/Help \d/.test(jtText), "Just Type: \"gesture\" finds help topics (" + (/Help \d+/.exec(jtText) || ["none"])[0] + ")");
        await jt.getByText("Help", { exact: true }).first().click();
        await jt.waitForTimeout(800);
        await jt.screenshot({ path: path.join(outDir, "justtype.png") });
        host.length = 0;
        await jt.locator(".dbcontent-display1:visible", { hasText: "Gestures" }).first().click();
        await jt.waitForTimeout(500);
        const opened = launches().find((l) => l.id === APP);
        check(opened && opened.params && opened.params.topic === "help-gestures", "Just Type: tapping it opens the topic in Help");
        await page.goto(appUrl(APP, opened ? opened.params : {}));
        await page.waitForSelector("[data-testid=topic]");
        check(await shownTopic() === "gestures", "Help opens the topic Just Type asked for");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
