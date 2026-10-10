#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Exhibitions (dock mode, GAPS R5) in headless Chromium against the
// simulated services in runtime/phoenix-runtime.js: the apps as dock mode
// starts them ({dockMode: true, windowType: "dockModeWindow"}) and the
// Settings pane that chooses them.
//
//   api       listDockModeLaunchPoints lists Photos and the Agenda, from
//             their appinfo.json (exhibitionMode, exhibitionModeOptions);
//             getDockModeStatus follows the shell
//   photos    the slideshow: the sample pictures (no videos) one after
//             another, cross-fading; it stops while dock mode has another
//             exhibition in front ("phoenixcardactivation") and goes on
//             after; a tap shows the controls; the time per picture and
//             the album are kept for next time
//   agenda    today from now and the coming days from the calendar's
//             events, with their colours; a tap opens Calendar
//   settings  Settings > Exhibition turns the Agenda on and orders it
//
//   node tools/test-exhibition.cjs [--tablet] [--out DIR]
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
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "exhibition-tests", tablet ? "tablet" : "phone");
// Dock mode's window: the screen under the status bar.
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 432 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const DOCK = { dockMode: true, windowType: "dockModeWindow" };
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
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    for (const app of ["photos", "agenda", "settings"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
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
        const host = [];
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
            });
        };
        const lastHost = (type) => [...host].reverse().find((m) => m.type === type);
        const page = await context.newPage();
        watch(page);
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (url, params) => page.evaluate(([u, q]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(q || {}));
        }), [url, params]);

        // A fresh device: the demo media and calendar indexed again.
        await page.goto(appUrl("org.webosphoenix.photos"));
        await page.evaluate(() => new Promise((res) => {
            localStorage.clear();
            const r = indexedDB.deleteDatabase("phoenix-media");
            r.onsuccess = r.onerror = r.onblocked = () => res();
        }));

        // ---- api -------------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.photos"));
        await page.waitForFunction(() => !!window.PalmServiceBridge);
        const list = await luna("luna://com.palm.applicationManager/listDockModeLaunchPoints", {});
        const ids = (list.launchPoints || []).map((p) => p.id);
        check(ids.includes("org.webosphoenix.photos") && ids.includes("org.webosphoenix.agenda"),
            `api: the exhibitions are Photos and the Agenda (${ids.join(", ")})`);
        const photosLp = (list.launchPoints || []).find((p) => p.id === "org.webosphoenix.photos") || {};
        const agendaLp = (list.launchPoints || []).find((p) => p.id === "org.webosphoenix.agenda") || {};
        check(photosLp.enabled === true && photosLp.exhibitionModeTitle === "Photos", "api: Photos is on at first (conf/default-exhibition-apps.json)");
        check(agendaLp.enabled === false && agendaLp.exhibitionModeTitle === "Agenda", "api: the Agenda is off at first");
        check(list.maxApps === 3, "api: three at most");
        check((await luna("luna://com.palm.systemmanager/getDockModeStatus", {})).enabled === false, "api: not in dock mode");
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ dockMode: true }));
        check((await luna("luna://com.palm.systemmanager/getDockModeStatus", {})).enabled === true, "api: getDockModeStatus follows the shell");

        // ---- photos ----------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.photos", DOCK));
        await page.waitForSelector("[data-testid='exhibition-slide'] img", { timeout: 15000 });
        const first = await page.getAttribute("[data-testid='exhibition-slide']", "data-path");
        check(/^\/media\/internal\//.test(first) && !/\.(mp4|webm)$/.test(first), `photos: a picture fills the exhibition (${first})`);
        check(await page.getAttribute("[data-testid='exhibition']", "data-playing") === "true", "photos: the slideshow runs");
        await shot("photos-exhibition");
        // The next one after the time per picture (5 s at first).
        await page.waitForFunction((p) => document.querySelector("[data-testid='exhibition-slide']")?.getAttribute("data-path") !== p,
            first, { timeout: 7000 });
        const second = await page.getAttribute("[data-testid='exhibition-slide']", "data-path");
        check(second !== first, "photos: the next picture after five seconds");
        // Halfway through the cross-fade both show.
        await page.waitForTimeout(400);
        const fading = await page.evaluate(() => [...document.querySelectorAll(".ex-slide")]
            .map((e) => parseFloat(getComputedStyle(e).opacity)).filter((o) => o > 0.05 && o < 0.95).length);
        check(fading >= 1, "photos: the pictures cross-fade");
        // Another exhibition in front: it stops.
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("phoenixcardactivation", { detail: { active: false } })));
        await page.waitForFunction(() => document.querySelector("[data-testid='exhibition']").getAttribute("data-playing") === "false");
        await page.waitForTimeout(5600);
        check(await page.getAttribute("[data-testid='exhibition-slide']", "data-path") === second, "photos: it stops while not in front");
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("phoenixcardactivation", { detail: { active: true } })));
        check(await page.getAttribute("[data-testid='exhibition']", "data-playing") === "true", "photos: and goes on in front");
        // A tap shows the controls; 10 s a picture, kept.
        await page.mouse.click(viewport.width / 2, viewport.height / 3);
        await page.waitForSelector(".ex-controls:not(.hidden) [data-testid='exhibition-interval']");
        await page.click("[data-testid='exhibition-interval']");
        await shot("photos-exhibition-interval");
        await page.click(".pui-menu-item:has-text('10 seconds')");
        const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("org.webosphoenix.photos.exhibition") || "{}"));
        check(kept.interval === 10, "photos: the time per picture is kept");
        await page.click("[data-testid='exhibition-album']");
        await page.click(".pui-menu-item:has-text('Sample Photos')");
        const kept2 = await page.evaluate(() => JSON.parse(localStorage.getItem("org.webosphoenix.photos.exhibition") || "{}"));
        check(kept2.album === "/media/internal/samples/photos", "photos: and the album");
        await page.reload();
        await page.waitForSelector("[data-testid='exhibition-slide'] img");
        check(/^\/media\/internal\/samples\/photos\//.test(await page.getAttribute("[data-testid='exhibition-slide']", "data-path")),
            "photos: after a restart the album's pictures show");
        // Launched without dock mode it is the albums, as always.
        await page.goto(appUrl("org.webosphoenix.photos"));
        await page.waitForSelector("[data-testid='albums']");
        check(await page.$("[data-testid='exhibition']") === null, "photos: an ordinary launch shows the albums");

        // ---- agenda ----------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.agenda", DOCK));
        await page.waitForSelector(".ag-section-title");
        const sections = await page.$$eval(".ag-section-title", (els) => els.map((e) => e.textContent));
        check(sections[0] === "Today", `agenda: today first (${sections.join(", ")})`);
        check(sections.includes("Tomorrow"), "agenda: then tomorrow");
        const events = await page.$$eval("[data-testid='agenda-event'] .ag-subject", (els) => els.map((e) => e.textContent));
        check(events.includes("Dinner at Marcus's") && events.includes("Gym"), `agenda: the calendar's events (${events.length})`);
        const bar = await page.$eval("[data-testid='agenda-event'] .ag-bar", (e) => getComputedStyle(e).backgroundColor);
        check(bar === "rgb(13, 113, 215)", `agenda: in the calendar's colour (${bar})`);
        await shot("agenda");
        host.length = 0;
        await page.click("[data-testid='agenda-event']");
        await page.waitForTimeout(200);
        const launch = lastHost("launch");
        check(launch && launch.payload.id === "com.palm.app.calendar" && launch.payload.params && /\S/.test(launch.payload.params.showEventDetail || ""),
              "agenda: a tap opens the event in Calendar " + JSON.stringify(launch && launch.payload.params));

        // ---- settings --------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.settings", { page: "exhibition" }));
        await page.waitForSelector("[data-testid='exhibition-check-org.webosphoenix.agenda']");
        await shot("settings-exhibition");
        host.length = 0;
        await page.click("[data-testid='exhibition-check-org.webosphoenix.agenda']");
        await page.waitForFunction(() => document.querySelector("[data-testid='exhibition-check-org.webosphoenix.agenda']").classList.contains("checked"));
        let st = lastHost("systemStatus");
        check(st && JSON.stringify(st.payload.exhibitionApps) === JSON.stringify(["org.webosphoenix.photos", "org.webosphoenix.agenda"]),
            "settings: the Agenda goes on, after Photos");
        await page.click("[data-testid='exhibition-up-org.webosphoenix.agenda']");
        await page.waitForTimeout(200);
        st = lastHost("systemStatus");
        check(st && JSON.stringify(st.payload.exhibitionApps) === JSON.stringify(["org.webosphoenix.agenda", "org.webosphoenix.photos"]),
            "settings: and first");
        const after = await luna("luna://com.palm.applicationManager/listDockModeLaunchPoints", {});
        check((after.launchPoints || []).filter((p) => p.enabled).length === 2, "settings: the list says so");
        await shot("settings-exhibition-agenda");

        check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} check(s) failed` : "all checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
