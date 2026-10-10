#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The original apps' and system pages' art on dense screens: each page is
// loaded from the virtual webOS filesystem (tools/serve-rootfs.py) in
// headless Chromium at device pixel ratio 2 and 3, as the shell zooms a
// web view by its density, and every picture the page loads is checked.
// A 1x picture that has HiDPI variants (runtime/hidpi-art.json) fails: its
// stylesheet's overlay copy or phoenix-runtime.js should have asked for
// the variant (docs/spec/hidpi-art.md). So does Enyo's 1.5x art
// (images-1.5/, images/1.5/), which is only for ratios from 1.5 to 2.
//
//   node tools/test-hidpi.cjs [appId ...]
//
// Needs Playwright (npm i -g playwright && npx playwright install chromium).

"use strict";
const { spawn } = require("child_process");
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
    const tries = ["playwright", path.join(require("child_process").execSync("npm root -g").toString().trim(), "playwright")];
    for (const t of tries) {
        try { return require(t); } catch (e) { /* next */ }
    }
    console.error("Playwright not found. Install it: npm i -g playwright && npx playwright install chromium");
    process.exit(2);
}

const REPO = path.resolve(__dirname, "..");
const only = process.argv.slice(2);
const port = 8790 + Math.floor(Math.random() * 90);
// The original apps (and an Enyo 2 one); system pages by their device path.
const APPS = ["com.palm.app.calculator", "com.palm.app.calendar", "com.palm.app.clock", "com.palm.app.contacts",
              "com.palm.app.email", "com.palm.app.notes", "com.palm.app.accounts", "com.palm.app.browser",
              "org.webosphoenix.enyo2demo"];
const A = "/usr/palm/applications/";
const PAGES = {
    "com.palm.launcher": A + "com.palm.launcher/index.html",
    // The apps' other windows: Email's compose, viewer and account wizard
    // (which loads authlib), Calendar's reminder, Clock's alarm, the
    // contacts picker, Enyo's dashboard window and network alerts.
    "email-compose": A + "com.palm.app.email/compose/index.html",
    "email-viewer": A + "com.palm.app.email/emailviewer/index.html",
    "email-wizard": A + "com.palm.app.email/accounts/wizard.html",
    "calendar-reminder": A + "com.palm.app.calendar/app/reminders/reminder.html",
    "clock-alarm": A + "com.palm.app.clock/dashAlarm.html",
    "people-picker": A + "com.palm.app.contacts/sharedWidgets/peoplePicker/peoplepicker.html",
    "enyo-dashboard": "/usr/palm/frameworks/enyo/0.10/framework/build/palm/system/dashboard-window/dashboard.html",
    "network-alerts": "/usr/palm/frameworks/enyo/0.10/framework/lib/networkalerts/source/networkalerts.html",
};
// luna-systemui's file picker, as Enyo's FilePicker shows it: in a frame of
// the app's page (CrossAppUI), without a runtime of its own.
const FILE_PICKER = "/usr/lib/luna/system/luna-systemui/app/FilePicker/filepicker.html";

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try {
            if ((await drained(fetch(url))).ok) return;
        } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

// The repository file a device path is served from, without the compat
// overlay (runtime/rootfs.json: mounts, and apps by their appinfo.json id).
function originalOf(device) {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, "runtime", "rootfs.json"), "utf8"));
    const dirs = Object.entries(cfg.mounts).filter(([d]) => d.endsWith("/")).map(([d, r]) => [d, r]);
    const apps = [];
    for (const rel of cfg.applicationDirs || [])
        for (const n of fs.readdirSync(path.join(REPO, rel))) apps.push(path.join(rel, n));
    for (const rel of apps.concat(cfg.systemApps || [])) {
        const info = path.join(REPO, rel, "appinfo.json");
        if (fs.existsSync(info))
            dirs.push(["/usr/palm/applications/" + JSON.parse(fs.readFileSync(info, "utf8").replace(/^\uFEFF/, "")).id + "/", rel + "/"]);
    }
    let best = null;
    for (const [d, r] of dirs)
        if (device.startsWith(d) && (!best || d.length > best[0].length)) best = [d, r];
    return best ? path.join(REPO, best[1], device.slice(best[0].length)) : null;
}

// Each stylesheet copy tools/hidpi-art.py writes in the compat overlay keeps
// every rule of its original, as Chromium parses them (a byte order mark
// left in the middle of a copy once made it drop Calculator's first rule).
async function checkCopies(browser) {
    const header = "/* webOS Phoenix overlay (tools/hidpi-art.py)";
    const compat = path.join(REPO, "compat", "rootfs");
    const copies = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".css") && fs.readFileSync(p, "utf8").startsWith(header)) copies.push(p);
        }
    };
    walk(compat);
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    let bad = 0;
    for (const copy of copies) {
        const orig = originalOf("/" + path.relative(compat, copy));
        const missing = await page.evaluate(([o, c]) => {
            const rules = (t) => {
                const s = document.createElement("style");
                s.textContent = t;
                document.head.appendChild(s);
                const out = [];
                const walk = (list, pre) => {
                    for (const r of list) {
                        if (r.cssRules && !r.selectorText) walk(r.cssRules, pre + (r.conditionText || "") + " > ");
                        else out.push(pre + (r.selectorText || r.cssText.slice(0, 40)));
                    }
                };
                walk(s.sheet.cssRules, "");
                s.remove();
                return out;
            };
            const copied = rules(c);
            return rules(o).filter((r) => !copied.includes(r));
        }, [fs.readFileSync(orig, "utf8").replace(/^\uFEFF/, ""), fs.readFileSync(copy, "utf8")]);   // as a browser reads a file
        if (missing.length) {
            bad++;
            console.log(`FAIL ${path.relative(REPO, copy)} drops ${missing.length} of the original's rules: ${missing.slice(0, 3).join(" | ")}`);
        }
    }
    await page.close();
    console.log(`${bad ? "FAIL" : "ok  "} ${copies.length} stylesheet copies keep their originals' rules`);
    return bad === 0;
}

async function main() {
    const { chromium } = loadPlaywright();
    const art = JSON.parse(fs.readFileSync(path.join(REPO, "runtime", "hidpi-art.json"), "utf8")).art;
    const hasVariants = (p) => {
        const i = p.lastIndexOf("/");
        return !!(art[p.slice(0, i + 1)] || {})[p.slice(i + 1)];
    };
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    let failed = false;
    try {
        await waitForServer(base + "/apps.json", 10000);
        const apps = await (await fetch(base + "/apps.json")).json();
        const pages = {};
        for (const id of APPS) {
            const app = apps.find((a) => a.id === id);
            if (app) pages[id] = app.main;
            else { console.log(`FAIL ${id}: not in the rootfs`); failed = true; }
        }
        Object.assign(pages, PAGES);
        pages.filepicker = pages["com.palm.app.calculator"];
        const browser = await chromium.launch();
        if (!only.length && !(await checkCopies(browser))) failed = true;
        for (const [id, url] of Object.entries(pages)) {
            if (only.length && !only.includes(id)) continue;
            for (const ratio of [2, 3]) {
                const context = await browser.newContext({ viewport: { width: 1024, height: 740 }, deviceScaleFactor: ratio, locale: "en-US" });
                const loaded = [];
                context.on("request", (r) => { if (r.resourceType() === "image") loaded.push(decodeURIComponent(new URL(r.url()).pathname)); });
                const page = await context.newPage();
                await page.goto(base + url);
                if (id === "filepicker") {
                    await page.waitForTimeout(2000);
                    loaded.length = 0;   // the app's own pictures are checked above
                    await page.evaluate((src) => {
                        const div = document.createElement("div");
                        document.body.appendChild(div);
                        div.innerHTML = `<iframe src="${src}" style="position: fixed; left: 0; top: 0; width: 100%; height: 100%"></iframe>`;
                    }, FILE_PICKER);
                }
                // Headless apps open their window; give them time to draw.
                await page.waitForTimeout(5000);
                if (id === "com.palm.launcher") {
                    // Just Type's results: apps (their icons), web
                    // searches, actions (as tools/test-justtype.cjs types).
                    await page.evaluate(() => {
                        const jt = enyo.$.justTypeApp.$.justType;
                        jt.clearSearchText();
                        jt.forceFocus();
                    });
                    await page.keyboard.type("ca", { delay: 40 });
                    await page.waitForTimeout(2000);
                }
                const ones = [...new Set(loaded.filter(hasVariants))];
                const old = [...new Set(loaded.filter((p) => /\/images(-|\/)1\.5\//.test(p)))];
                const variants = loaded.filter((p) => p.includes(`@${ratio}x.`)).length;
                const bad = ones.concat(old);
                if (bad.length) failed = true;
                console.log(`${bad.length ? "FAIL" : "ok  "} ${id} at ${ratio}x: ${variants} variants loaded` +
                            (bad.length ? `, but also\n    ${bad.join("\n    ")}` : ""));
                await context.close();
            }
        }
        await browser.close();
    } finally {
        server.kill();
    }
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
