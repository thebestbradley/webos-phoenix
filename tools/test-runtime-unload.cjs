#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The original apps' unload listeners in a Chromium that no longer runs
// unload (158 and later: its unload permissions policy), in headless
// Chromium against tools/serve-rootfs.py. The runtime puts them on pagehide
// (runtime/phoenix-runtime.js unloadListenersOnPagehide):
//   - adding them logs no "Permissions policy violation: unload ...";
//   - they run as the page goes (navigated away, its frame taken out), once,
//     with an unload event on the window, in the order added; capture, once,
//     signal and removeEventListener work as they do for unload; a page kept
//     in the back/forward cache (pagehide persisted) runs none;
//   - Enyo 1.0's own: the app's main window closed with another of its
//     windows open, that window becomes the app's root
//     (palm/system/windows/manager.js:134-142).
// In a Chromium that still runs unload, the same checks hold through unload
// itself; the first line says which the engine does.
//
//   node tools/test-runtime-unload.cjs

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

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

const RUNTIME = "<script src=\"/usr/share/phoenix/runtime/phoenix-runtime.js\"></script>";
const ENYO = "<script src=\"/usr/palm/frameworks/enyo/0.10/framework/enyo.js\"></script>";
const DIR = "/usr/palm/applications/org.webosphoenix.flashlight/";
const CALC = "/usr/palm/applications/com.palm.app.calculator/";

// Unload listeners added every way the originals and the platform allow; each
// writes what it saw to localStorage, which outlives the page.
const LISTENERS = `<script>
var seen = [];
function note(name, e, self) {
    seen.push({ name: name, type: e.type, onWindow: self === window, target: e.target === document, currentTarget: e.currentTarget === window });
    localStorage.setItem("unloadSeen", JSON.stringify(seen));
}
function plain(e) { note("plain", e, this); }
window.addEventListener("unload", plain, false);
window.addEventListener("unload", plain, false);                   // twice: once
window.addEventListener("unload", { handleEvent: function (e) { note("handleEvent", e, window); } });
window.addEventListener("unload", function (e) { note("capture", e, this); }, true);
window.addEventListener("unload", function (e) { note("once", e, this); }, { once: true });
function removed(e) { note("removed", e, this); }
window.addEventListener("unload", removed);
window.removeEventListener("unload", removed);
var gone = new AbortController();
window.addEventListener("unload", function (e) { note("aborted", e, this); }, { signal: gone.signal });
gone.abort();
var early = new AbortController(); early.abort();
window.addEventListener("unload", function (e) { note("abortedBefore", e, this); }, { signal: early.signal });
addEventListener("unload", function (e) { note("bare", e, this); });
window.addEventListener("pagehide", function (e) { if (!e.persisted) localStorage.setItem("pagehideRan", "1"); });
window.__engineAllowsUnload = document.featurePolicy ? document.featurePolicy.allowsFeature("unload") : null;
</script>`;

function page(head, body) {
    return "<!doctype html><html><head><meta charset=\"utf-8\">" + head + "</head><body>" + (body || "<p>page</p>") + "</body></html>";
}

const violation = /Permissions policy violation: unload/;
function violations(errors) {
    const n = errors.filter((m) => violation.test(m)).length;
    return n ? ` (${n} logged)` : "";
}

async function main() {
    const { chromium } = loadPlaywright();
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { const r = await fetch(origin + "/apps.json"); await r.arrayBuffer(); if (r.ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch();

        async function context() {
            const ctx = await browser.newContext();
            const consoleErrors = [], pageErrors = [];
            const watch = (p) => {
                p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
                p.on("pageerror", (e) => pageErrors.push(e.message));
            };
            ctx.on("page", watch);
            const pages = {
                [DIR + "unload.html"]: page(RUNTIME + LISTENERS),
                [DIR + "after.html"]: page(RUNTIME),
                [DIR + "frame-host.html"]: page(RUNTIME, "<iframe src=\"frame.html\"></iframe>"),
                [DIR + "frame.html"]: page(RUNTIME + "<script>window.addEventListener('unload', function (e) { parent.__frameUnload = e.type; });</script>"),
                [CALC + "unload-child.html"]: page(RUNTIME + ENYO, "<p>child</p>")
            };
            for (const p of Object.keys(pages))
                await ctx.route(origin + p, (route) => route.fulfill({ contentType: "text/html", body: pages[p] }));
            return { ctx, consoleErrors, pageErrors };
        }
        const seen = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("unloadSeen") || "[]"));

        // ---- The page going: its listeners run, once each, as for unload -------------------
        {
            const { ctx, consoleErrors, pageErrors } = await context();
            const p = await ctx.newPage();
            await p.goto(origin + DIR + "unload.html");
            await p.waitForFunction(() => !!window.__phoenixRuntime);
            const allows = await p.evaluate(() => window.__engineAllowsUnload);
            console.log(`Chromium ${browser.version()}: unload ${allows === false ? "not allowed (the runtime puts the listeners on pagehide)" : "allowed"}`);
            check(!consoleErrors.some((m) => violation.test(m)), "adding unload listeners: no permissions policy violation" + violations(consoleErrors));

            // A page put in the back/forward cache is not unloaded.
            await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
            check((await seen(p)).length === 0, "pagehide with persisted (kept in the back/forward cache): no unload listener runs");

            await p.goto(origin + DIR + "after.html");
            const ran = await seen(p);
            const names = ran.map((r) => r.name);
            check(JSON.stringify(names) === JSON.stringify(["plain", "handleEvent", "capture", "once", "bare"]),
                "navigated away: each listener once, in the order added; none removed, none aborted (" + names.join(", ") + ")");
            check(ran.length > 0 && ran.every((r) => r.type === "unload"), "... called with an unload event");
            check(ran.length > 0 && ran.filter((r) => r.name !== "handleEvent").every((r) => r.onWindow), "... with this the window");
            check(ran.length > 0 && ran.every((r) => r.target && r.currentTarget), "... its target the document, its currentTarget the window, as unload's");
            check(await p.evaluate(() => localStorage.getItem("pagehideRan") === "1"), "... and the page's own pagehide listeners still run");
            check(pageErrors.length === 0, "no page errors" + (pageErrors.length ? ": " + pageErrors.join("; ") : ""));
            await ctx.close();
        }

        // ---- A frame taken out of its page (the sign-in sheet) -----------------------------
        {
            const { ctx, consoleErrors } = await context();
            const p = await ctx.newPage();
            await p.goto(origin + DIR + "frame-host.html");
            await p.waitForFunction(() => { const f = document.querySelector("iframe"); return f && f.contentWindow && !!f.contentWindow.__phoenixRuntime; });
            await p.evaluate(() => document.querySelector("iframe").remove());
            check(await p.evaluate(() => window.__frameUnload) === "unload", "a frame taken out: its unload listener runs");
            check(!consoleErrors.some((m) => violation.test(m)), "... and adding it logged no violation" + violations(consoleErrors));
            await ctx.close();
        }

        // ---- Enyo 1.0: the main window closed, another of the app's windows is its root ----
        {
            const { ctx, consoleErrors } = await context();
            const main = await ctx.newPage();
            await main.goto(origin + CALC + "index.html");
            await main.waitForFunction(() => window.enyo && enyo.windows && enyo.windows.manager, null, { timeout: 20000 });
            const [child] = await Promise.all([
                ctx.waitForEvent("page"),
                main.evaluate(() => { enyo.windows.openWindow("unload-child.html", "child"); })
            ]);
            await child.waitForFunction(() => window.enyo && enyo.windows && enyo.windows.manager, null, { timeout: 20000 });
            check(Object.keys(await child.evaluate(() => enyo.windows.manager._windowList)).length === 0,
                "Enyo 1.0: a window the app opened is not its root (its own window list is empty)");
            await main.close();
            await child.waitForTimeout(500);
            const after = await child.evaluate(() => ({ list: Object.keys(enyo.windows.manager._windowList), root: window.rootWindow }));
            check(after.list.indexOf("child") >= 0 && after.root === null,
                "Enyo 1.0: the main window closed, the other window becomes the app's root (" + JSON.stringify(after) + ")");
            check(!consoleErrors.some((m) => violation.test(m)), "Enyo 1.0 (Calculator and its window): no permissions policy violation" + violations(consoleErrors));
            await ctx.close();
        }
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
