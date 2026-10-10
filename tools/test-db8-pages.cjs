#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulated db8 shared by several pages at once, as in phoenix-sim,
// where the system UI, the launcher, Just Type and every app each run
// runtime/phoenix-runtime.js on the one origin's localStorage. Each page
// reads from its own copy of that store, which hears of other pages' writes
// a moment later (longer when the page is busy: on a loaded machine, at
// start-up). Here one page is held busy, with a synchronous request the
// test answers when it wants, while another writes; then the busy page
// writes too, from what it saw before. Nothing the other page stored may
// be lost:
//
// - objects put by two pages at once (com.palm.db and com.palm.tempdb);
// - Tasks' Inbox, made on first start while another page is still loading
//   the sample data (Tasks hung on its spinner for ever when it was lost);
// - watches fire for other pages' writes, in both databases;
// - Tasks makes its Inbox again if another page deletes it;
// - a profile with the database in the single value of earlier runtimes.
//
//   node tools/test-db8-pages.cjs [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "db8-pages-tests");
const port = 8500 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id) => `${origin}/usr/palm/applications/${id}/index.html`;
const TASKS = "org.webosphoenix.tasks";
const OTHER = "org.webosphoenix.flashlight";
const HOLD = `${origin}/__hold`;

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

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/tasks/dist/index.html"))) {
        console.error("apps/tasks/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport: { width: 1024, height: 740 } });
        const errors = [];
        const watchPage = (p, name) => {
            p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            p.on("console", (m) => {
                if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
            });
        };

        // A page held inside one task: its synchronous request to HOLD is
        // answered when release() is called. Until then the page cannot hear
        // of other pages' writes.
        let release = null;
        await context.route(HOLD, async (route) => {
            await new Promise((r) => { release = r; });
            release = null;
            await route.fulfill({ status: 200, body: "go" });
        });
        const waitHeld = async () => { while (!release) await new Promise((r) => setTimeout(r, 20)); };
        // Runs fn (a string: a function of the runtime) in page p after the hold.
        const heldThen = (p, fn) => p.evaluate(([hold, src]) => {
            const x = new XMLHttpRequest();
            x.open("GET", hold, false);
            x.send();
            return new Function("rt", "return (" + src + ")(rt);")(window.__phoenixRuntime);
        }, [HOLD, fn.toString()]);
        const now = (p, url, params) => p.evaluate(([u, prm]) => window.__phoenixRuntime.callNow(u, prm), [url, params]);
        const count = async (p, db, kind) => (await now(p, `palm://${db}/find`, { query: { from: kind } })).results.length;
        const fresh = async (p, id) => {
            await p.goto(appUrl(id));
            await p.evaluate(() => localStorage.clear());
            await p.reload();
        };

        const a = await context.newPage();
        const b = await context.newPage();
        watchPage(a, "a");
        watchPage(b, "b");

        // ---- 1. Two pages put at once ----------------------------------------------------
        await fresh(a, OTHER);
        await b.goto(appUrl(OTHER));
        for (const db of ["com.palm.db", "com.palm.tempdb"]) {
            const held = heldThen(b, `(rt) => rt.callNow("palm://${db}/put", { objects: [{ _kind: "org.example.b:1", who: "b" }] })`);
            await waitHeld();
            await now(a, `palm://${db}/put`, { objects: [{ _kind: "org.example.a:1", who: "a" }] });
            release();
            const put = await held;
            check(put.returnValue, `${db}: the busy page's put succeeds`);
            await a.waitForTimeout(300);
            for (const [name, p] of [["first", a], ["busy", b]]) {
                check(await count(p, db, "org.example.a:1") === 1 && await count(p, db, "org.example.b:1") === 1,
                    `${db}: the ${name} page finds both pages' objects`);
            }
        }

        // ---- 2. Tasks' first start while another page loads the sample data -------------------
        await fresh(b, OTHER);
        const loading = heldThen(b, "(rt) => { rt.loadSampleData(true); return true; }");
        await waitHeld();
        await a.goto(appUrl(TASKS));
        await a.waitForSelector("[data-testid='list-Inbox']", { timeout: 15000 });
        check(true, "Tasks starts with its Inbox while the other page is busy");
        release();
        await loading;
        await a.waitForTimeout(1500);
        const lists = (p) => now(p, "palm://com.palm.db/find", { query: { from: "com.palm.tasklist:1" } });
        check((await lists(a)).results.some((l) => l.isDefault), "the Inbox is still stored after the other page's sample data");
        check((await lists(b)).results.some((l) => l.isDefault), "and the other page finds it too");
        check(await count(a, "com.palm.db", "com.palm.person:1") > 0, "the sample contacts are stored as well");
        check(await a.locator("[data-testid='list-Inbox']").count() === 1 && await a.locator(".tk-loading").count() === 0,
            "Tasks still shows its lists (no spinner)");
        await a.screenshot({ path: path.join(outDir, "tasks-after-sample-data.png") });

        // ---- 3. Watches fire for other pages' writes ----------------------------------------
        for (const db of ["com.palm.db", "com.palm.tempdb"]) {
            const fired = a.evaluate((d) => new Promise((res) => {
                const bridge = new PalmServiceBridge();
                let n = 0;
                bridge.onservicecallback = (s) => {
                    const r = JSON.parse(s);
                    if (++n === 1) window.__watchReady = true;
                    if (r.fired) { bridge.cancel(); res(true); }
                };
                bridge.call(`palm://${d}/find`, JSON.stringify({ query: { from: "org.example.watched:1" }, watch: true }));
                setTimeout(() => res(false), 5000);
            }), db);
            await a.waitForFunction(() => window.__watchReady);
            await a.evaluate(() => { window.__watchReady = false; });
            await now(b, `palm://${db}/put`, { objects: [{ _kind: "org.example.watched:1" }] });
            check(await fired, `${db}: a watch fires when another page puts`);
        }

        // ---- 4. The Inbox deleted by another page -----------------------------------------------
        const inbox = (await lists(b)).results.find((l) => l.isDefault);
        if (inbox) await now(b, "palm://com.palm.db/del", { ids: [inbox._id], purge: true });
        await a.waitForFunction(() => window.__phoenixRuntime.callNow("palm://com.palm.db/find",
            { query: { from: "com.palm.tasklist:1" } }).results.some((l) => l.isDefault), null, { timeout: 5000 }).catch(() => {});
        check((await lists(a)).results.filter((l) => l.isDefault).length === 1, "Tasks makes its Inbox again when another page deletes it");
        await a.waitForSelector("[data-testid='list-Inbox']", { timeout: 5000 }).catch(() => {});
        check(await a.locator("[data-testid='list-Inbox']").count() === 1, "and shows it");

        // ---- 5. The single-value database of earlier runtimes -----------------------------------
        await b.close();
        await a.goto(appUrl(OTHER));
        await a.evaluate(() => {
            localStorage.clear();
            localStorage.setItem("phoenix:db8:com.palm.db", JSON.stringify({
                rev: 7, nextId: 3, objects: { "++old1": { _id: "++old1", _kind: "org.example.old:1", _rev: 6, title: "kept" } },
                kinds: { "org.example.old:1": { extends: [], indexes: [], revSets: [], sync: true } },
            }));
            for (const k of ["sampleData", "db8SystemKinds", "db8BackupKinds"]) localStorage.setItem("phoenix:" + k, "99");
        });
        await a.reload();
        const old = await now(a, "palm://com.palm.db/find", { query: { from: "org.example.old:1" } });
        check(old.results.length === 1 && old.results[0].title === "kept", "an old profile's objects are found");
        const put = await now(a, "palm://com.palm.db/put", { objects: [{ _kind: "org.example.old:1", title: "new" }] });
        check(put.results[0].rev > 7, "revisions go on from the old profile's");
        const meta = await a.evaluate(() => JSON.parse(localStorage.getItem("phoenix:db8:com.palm.db")));
        check(!meta.objects && await a.evaluate(() => !!localStorage.getItem("phoenix:db8:com.palm.db/obj/++old1")),
            "and are kept under keys of their own");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
