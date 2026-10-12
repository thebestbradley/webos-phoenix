#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The runtime in a page whose Content-Security-Policy forbids eval
// (script-src without 'unsafe-eval', as phoenix-default-apps' Passwords and
// Authenticator), in headless Chromium against tools/serve-rootfs.py:
//   - the page sees no violation: the runtime does not try to build the
//     services it simulates in the page (the backup, hardware and updates
//     services, the connectors) with new Function, which such a policy
//     blocks and reports (runtime/phoenix-runtime.js pageForbidsEval);
//   - the runtime still starts, and its own services answer;
//   - a page without such a policy still hosts the simulated services.
//
//   node tools/test-runtime-csp.cjs

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

// An app page as an app's index.html would be: the policy first, then the
// runtime (serve-rootfs.py adds it to an app's own pages the same way).
function appPage(policy) {
    return "<!doctype html><html><head><meta charset=\"utf-8\">" +
        (policy ? `<meta http-equiv="Content-Security-Policy" content="${policy}">` : "") +
        "<script src=\"/usr/share/phoenix/runtime/phoenix-runtime.js\"></script>" +
        "</head><body><p>page</p></body></html>";
}

// phoenix-default-apps' Passwords (apps/passwords/index.html), its connect-src
// to the breach check left out.
const STRICT = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'self'; worker-src 'none'; " +
    "manifest-src 'none'; media-src 'none'";

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
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
            setTimeout(() => res({ returnValue: false, errorText: "no answer" }), 5000);
        }), [uri, params]);

        async function open(policy) {
            const context = await browser.newContext();
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.addInitScript(() => {
                window.__csp = [];
                document.addEventListener("securitypolicyviolation", (e) =>
                    window.__csp.push(e.violatedDirective + " " + e.blockedURI + " " + e.sourceFile + ":" + e.lineNumber));
            });
            const url = `${origin}/usr/palm/applications/org.webosphoenix.flashlight/csp-test.html`;
            await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: appPage(policy) }));
            await page.goto(url);
            await page.waitForFunction(() => !!window.__phoenixRuntime, null, { timeout: 20000 });
            await page.waitForTimeout(1500);
            return { context, page, errors };
        }

        // ---- A page whose policy forbids eval ------------------------------------------------
        const strict = await open(STRICT);
        const violations = await strict.page.evaluate(() => window.__csp);
        check(violations.length === 0, "a strict policy: no violation" + (violations.length ? ": " + violations.join("; ") : ""));
        const time = await luna(strict.page, "luna://com.palm.systemservice/time/getSystemTime", {});
        check(time.returnValue !== false && typeof time.utc === "number", "a strict policy: the runtime's own services answer (systemservice time)");
        const backup = await luna(strict.page, "luna://org.webosphoenix.service.backup/getStatus", {});
        check(backup.returnValue === false, "a strict policy: the backup service, which needs eval, is not in the page");
        check(strict.errors.length === 0, "a strict policy: no page errors" + (strict.errors.length ? ": " + strict.errors.join("; ") : ""));
        await strict.context.close();

        // ---- A page without one: the simulated services are there ---------------------------
        const open_ = await open(null);
        const status = await luna(open_.page, "luna://org.webosphoenix.service.backup/getStatus", {});
        check(status.returnValue === true, "no policy: the backup service answers in the page (" + JSON.stringify(status).slice(0, 80) + ")");
        check((await open_.page.evaluate(() => window.__csp)).length === 0, "no policy: no violation");
        check(open_.errors.length === 0, "no policy: no page errors" + (open_.errors.length ? ": " + open_.errors.join("; ") : ""));
        await open_.context.close();
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
