#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Goes through First Use (apps/firstuse, built into dist/) in headless
// Chromium with the simulator's runtime, as a new owner would: language,
// Wi-Fi (a wrong password, then the right one), the hardware that needs
// a driver, time zone and the 24-hour
// clock, accounts (Add an account opens Accounts), a PIN (mismatched, then
// set), location off in Privacy, the cards and gestures tutorial, and All
// Set, which opens Help and then finishes: the system preference
// firstUseComplete is set and the window closes. Then, on a fresh device,
// "Skip setup" ends it at once, and Settings > Device Info runs it again.
// Screenshots of every step go to build/firstuse-tests/.
//
//   node tools/test-firstuse.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "firstuse-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8100 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const APP = "org.webosphoenix.firstuse";
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

const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
}), [uri, params]);

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/firstuse/dist/index.html"))) {
        console.error("apps/firstuse/dist is missing: run `npm ci && npm run build` in apps/ first");
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
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        const step = async (id) => {
            await page.waitForSelector(`[data-testid=step-${id}]`, { timeout: 5000 });
            await page.waitForTimeout(400);
            // The step's Back and Next show their whole label (a long one,
            // Restore's "Set Up as New", was cut off at both ends on a phone).
            const cut = await page.evaluate(() => [...document.querySelectorAll(".fu-buttons .pui-button")]
                .filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
            check(cut.length === 0, `${id}: the buttons' labels fit${cut.length ? " (cut: " + cut.join(", ") + ")" : ""}`);
        };
        const next = () => page.click("[data-testid=next]");
        const pref = async (key) => (await luna(page, "luna://com.webos.service.systemservice/getPreferences", { keys: [key] }))[key];
        const start = async (params) => {
            await page.goto(appUrl(APP, params));
            await page.evaluate(() => { window.__closed = 0; window.close = () => { window.__closed++; }; });
        };

        await page.goto(appUrl(APP));
        await page.evaluate(() => localStorage.clear());
        // The old device: a backup on its USB drive, of a task and a setting.
        const B = "luna://org.webosphoenix.service.backup/";
        await page.goto(appUrl(APP));
        await luna(page, "luna://com.palm.db/put", { objects: [{ _kind: "com.palm.task:1", summary: "Restore canary", completed: false,
                                                                 priority: 0, listId: "l", accountId: "" }] });
        await luna(page, "luna://com.webos.service.systemservice/setPreferences", { screenTimeout: 300 });
        await luna(page, B + "configure", { destination: { type: "usb" }, passphrase: "old phone passphrase" });
        const made = await luna(page, B + "backupNow", {});
        const file = await luna(page, "luna://org.webosphoenix.filemanager/read", { path: "/media/internal/backups/" + made.name });
        // A new device, with that file copied onto its USB drive.
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl(APP));
        await luna(page, "luna://org.webosphoenix.filemanager/mkdir", { path: "/media/internal/backups" });
        await luna(page, "luna://org.webosphoenix.filemanager/write", { path: "/media/internal/backups/" + made.name, data: file.data });
        await start();
        check(await pref("firstUseComplete") === false, "a new device has not run First Use");

        // ---- Welcome -------------------------------------------------------------
        await step("welcome");
        check(/Welcome/.test(await text()) && await page.locator("[data-testid=skip]").count() === 0, "Welcome, which cannot be skipped");
        await shot("1-welcome");
        await page.click("[data-testid='lang-de-DE']");
        await page.waitForTimeout(300);
        const locale = await luna(page, "luna://com.webos.settingsservice/getSystemSettings", { keys: ["localeInfo"] });
        check(locale.settings.localeInfo.locales.UI === "de-DE", "choosing Deutsch sets the UI locale");
        await page.click("[data-testid='lang-en-US']");
        await next();

        // ---- Wi-Fi -----------------------------------------------------------------
        await step("wifi");
        await page.waitForSelector("[data-testid='network-Lab 5G']");
        await page.click("[data-testid='network-Lab 5G']");
        await page.waitForSelector("[data-testid=wifi-join]");
        await page.fill("[data-testid=wifi-password]", "nope1234");
        await page.click("[data-testid=wifi-connect]");
        await page.waitForSelector("[data-testid=wifi-join] [role=alert]", { timeout: 5000 });
        check(/incorrect/.test(await page.textContent("[data-testid=wifi-join] [role=alert]")), "Wi-Fi: a wrong password is refused");
        await page.fill("[data-testid=wifi-password]", "webos2009");
        await page.click("[data-testid=wifi-connect]");
        await page.waitForSelector("[data-testid=wifi-join]", { state: "detached", timeout: 5000 });
        await page.waitForFunction(() => document.querySelector("[data-testid='network-Lab 5G']")?.textContent.includes("Connected"));
        check(true, "Wi-Fi: joined Lab 5G");
        await shot("2-wifi");
        await next();

        // ---- Hardware (the simulated RTL8812AU has no driver in the kernel; tools/test-hardware.cjs installs it) ----
        await step("hardware");
        await page.waitForSelector("[data-testid='fu-hw-usb:1-3']");
        check(await page.locator("[data-testid='fu-hw-usb:1-3']").count() === 1, "Hardware: the Wi-Fi dongle whose driver the kernel lacks is offered");
        await shot("2a-hardware");
        await next();

        // ---- Restore -----------------------------------------------------------------
        await step("restore");
        await shot("2b-restore");
        await page.click("[data-testid=restore-start]");
        await page.waitForSelector("[data-testid=restore-type]");
        await next();
        await page.waitForSelector(`[data-testid='restore-file-${made.name}']`);
        await page.click(`[data-testid='restore-file-${made.name}']`);
        await page.fill("[data-testid=restore-pass]", "not the passphrase");
        await page.click("[data-testid=restore-confirm]");
        await page.waitForSelector("[data-testid=restore-pass-error]", { timeout: 15000 });
        check(/not this backup's passphrase/.test(await page.textContent("[data-testid=restore-pass-error]")), "Restore: a wrong passphrase is refused");
        await page.fill("[data-testid=restore-pass]", "old phone passphrase");
        await page.click("[data-testid=restore-confirm]");
        await page.waitForFunction(() => /Restored/.test(document.body.innerText), null, { timeout: 15000 });
        await shot("2c-restored");
        const tasks = (await luna(page, "luna://com.palm.db/find", { query: { from: "com.palm.task:1" } })).results || [];
        check(tasks.some((t) => t.summary === "Restore canary") && await pref("screenTimeout") === 300,
              "Restore: the old device's task and screen timeout are back");
        const bst = await luna(page, B + "getStatus", {});
        check(bst.configured && bst.auto && bst.destination.type === "usb", "Restore: this device backs up there every day, with the same passphrase");
        await next();

        // ---- Date & Time -------------------------------------------------------------
        await step("datetime");
        await page.click("[data-testid=timezone]");
        await page.click("role=option[name='Berlin, Germany']");
        await page.click("[data-testid=clock-24]");
        await page.waitForTimeout(300);
        check((await pref("timeZone")).ZoneID === "Europe/Berlin", "Date & Time: the time zone is set");
        check(await pref("timeFormat") === "HH24", "Date & Time: the 24-hour clock is on");
        await shot("3-datetime");
        await next();

        // ---- Accounts ----------------------------------------------------------------
        await step("accounts");
        await page.waitForTimeout(500);
        let t = await text();
        check(/Synergy/.test(t) && /CardDAV/.test(t), "Accounts: explains Synergy and what syncs");
        check(await page.locator("[data-testid^=account-]").count() >= 1, "Accounts: lists the accounts there are");
        host.length = 0;
        await page.click("[data-testid=add-account]");
        await page.waitForTimeout(300);
        check(host.some((m) => m.type === "launch" && m.payload.id === "com.palm.app.accounts"), "Accounts: Add an account opens Accounts");
        await shot("4-accounts");
        await page.click("[data-testid=skip]");

        // ---- Passcode ---------------------------------------------------------------
        await step("passcode");
        await page.click("[data-testid=lock-pin]");
        // The keyboard comes up for the PIN: the window shrinks under it,
        // and the field stays in view above it (it went under it).
        await page.focus("[data-testid=code-confirm]");
        await page.setViewportSize({ width: viewport.width, height: tablet ? 400 : 180 });
        await page.waitForTimeout(400);
        const inView = await page.evaluate(() => {
            const r = document.activeElement.getBoundingClientRect();
            return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5 ? true : [r.top, r.bottom, window.innerHeight].join();
        });
        check(inView === true, "Passcode: with the keyboard up, the field typed in is in view" + (inView === true ? "" : ` (${inView})`));
        await shot("5a-passcode-keyboard");
        await page.setViewportSize(viewport);
        await page.fill("[data-testid=code]", "1357");
        await page.fill("[data-testid=code-confirm]", "1358");
        await next();
        await page.waitForTimeout(200);
        check(/do not match/.test(await text()), "Passcode: mismatched PINs are refused");
        await page.fill("[data-testid=code-confirm]", "1357");
        await shot("5-passcode");
        await next();
        await step("privacy");
        const mode = await luna(page, "luna://com.palm.systemmanager/getDeviceLockMode", {});
        const match = await luna(page, "luna://com.palm.systemmanager/matchDevicePasscode", { passCode: "1357" });
        check(mode.lockMode === "pin" && match.succeeded, "Passcode: the PIN is set");

        // ---- Privacy ----------------------------------------------------------------
        await page.click("[data-testid=location-toggle]");
        await page.waitForTimeout(300);
        const h = await luna(page, "luna://com.webos.service.location/getAllLocationHandlers", {});
        check(h.handlers.every((x) => !x.state), "Privacy: location services off");
        await page.click("[data-testid=location-toggle]");
        await page.waitForSelector("[data-testid=network-location]");
        await page.click("[data-testid=network-location]");
        await page.waitForTimeout(300);
        const h2 = await luna(page, "luna://com.webos.service.location/getAllLocationHandlers", {});
        check(h2.handlers.find((x) => x.name === "gps").state && !h2.handlers.find((x) => x.name === "network").state,
              "Privacy: GPS on, network location off");
        // The Assistant (no more "Coming later"): on, and its wake word.
        check(!/Coming later/.test(await text()), "Privacy: the Assistant is not \"coming later\"");
        const A = "luna://org.webosphoenix.assistant/";
        await page.waitForSelector("[data-testid=assistant-wake]");
        await page.click("[data-testid=assistant-wake]");
        await page.waitForTimeout(300);
        const as1 = (await luna(page, A + "getSettings", {})).settings;
        await page.click("[data-testid=assistant-toggle]");
        await page.waitForTimeout(300);
        const as2 = (await luna(page, A + "getSettings", {})).settings;
        check(as1.enabled && as1.wakeWord && !as2.enabled, "Privacy: the Assistant's wake word, then the Assistant off");
        await page.click("[data-testid=assistant-toggle]");
        await page.waitForTimeout(300);
        await shot("6-privacy");
        await next();

        // ---- Tutorial ---------------------------------------------------------------
        await step("tutorial");
        const seen = [];
        for (let i = 0; i < 10; ++i) {
            const lesson = await page.getAttribute("[data-testid=tutorial]", "data-lesson");
            if (seen.includes(lesson)) break;
            seen.push(lesson);
            await page.waitForTimeout(1300);
            await shot("7-tutorial-" + lesson);
            if (await page.locator("[data-testid=step-tutorial]").count() === 0) break;
            // Its buttons are on the screen as it opens, not below it (on a
            // phone they were cut off at the bottom; a click scrolls to them).
            const fits = await page.evaluate(() => {
                const r = document.querySelector("[data-testid=lesson-next]").getBoundingClientRect();
                return r.bottom <= window.innerHeight + 0.5 ? true : `${Math.round(r.bottom)} > ${window.innerHeight}`;
            });
            check(fits === true, `Tutorial (${lesson}): its buttons fit on the screen` + (fits === true ? "" : ` (${fits})`));
            await page.click("[data-testid=lesson-next]");
            await page.waitForTimeout(200);
            if (await page.locator("[data-testid=step-tutorial]").count() === 0) break;
        }
        const want = tablet ? ["cardview", "open", "close", "launcher", "justtype"] : ["cardview", "open", "close", "back", "launcher", "justtype"];
        check(JSON.stringify(seen) === JSON.stringify(want), `Tutorial: ${seen.join(", ")}`);
        check(await page.locator("[data-testid=step-done]").count() === 1, "Tutorial: Got It goes on to All Set");

        // ---- All set ----------------------------------------------------------------
        await step("done");
        host.length = 0;
        await page.click("[data-testid=open-help]");
        await page.waitForTimeout(300);
        check(host.some((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.help"), "All Set: Help and tips opens Help");
        await shot("8-done");
        await next();
        await page.waitForTimeout(500);
        check(await pref("firstUseComplete") === true, "Start: firstUseComplete is set");
        check(await page.evaluate(() => window.__closed) === 1, "Start: the window closes (the shell leaves First Use)");

        // ---- Back and Skip ----------------------------------------------------------
        await start();
        await step("welcome");
        await next();
        await step("wifi");
        await page.click("[data-testid=back]");
        await step("welcome");
        check(true, "Back returns to the step before");
        await next();
        await step("wifi");
        await page.keyboard.press("Escape");
        await step("welcome");
        check(true, "the back gesture does too");

        await luna(page, "luna://com.webos.service.systemservice/setPreferences", { firstUseComplete: false });
        await start();
        await step("welcome");
        await page.click("[data-testid=skip-setup]");
        await page.waitForSelector("[data-testid=skip-dialog]");
        await shot("9-skip");
        await page.click("[data-testid=skip-confirm]");
        await page.waitForTimeout(500);
        check(await pref("firstUseComplete") === true && await page.evaluate(() => window.__closed) === 1,
              "Skip setup ends it at once, marked done");

        // ---- Again from Settings ------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.settings", { page: "deviceinfo" }));
        await page.waitForSelector("[data-testid=rerun-firstuse]");
        host.length = 0;
        await page.click("[data-testid=rerun-firstuse]");
        await page.waitForTimeout(300);
        const again = host.find((m) => m.type === "launch" && m.payload.id === APP);
        check(!!again && again.payload.params.rerun === true, "Settings > Device Info runs it again");
        await start({ rerun: true });
        await step("welcome");
        for (let i = 0; i < 9; ++i) {
            if (await page.locator("[data-testid=skip]").count()) await page.click("[data-testid=skip]");
            else await next();
            await page.waitForTimeout(200);
        }
        await step("done");
        check((await page.textContent("[data-testid=next]")).includes("Done"), "run again, it ends with Done");
        await start({ rerun: true });
        await step("welcome");
        await next();
        for (const id of ["wifi", "hardware", "restore", "datetime", "accounts"]) {
            await step(id);
            await page.click("[data-testid=skip]");
        }
        await step("passcode");
        check(/A PIN already locks this device/.test(await text()), "run again, the passcode step leaves the PIN alone");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));

        // A new device takes the computer's time zone, and Date & Time's
        // picker shows it: "UTC" (a container's) is the list's Etc/UTC, and
        // a zone the list lacks is added to it.
        for (const [tz, want, label] of [["UTC", "Etc/UTC", "UTC"], ["Europe/Vienna", "Europe/Vienna", "Vienna"]]) {
            const c = await browser.newContext({ viewport, timezoneId: tz });
            const p = await c.newPage();
            await p.goto(appUrl(APP));
            await p.evaluate(() => localStorage.clear());
            await p.goto(appUrl(APP));
            await p.click("[data-testid=next]");
            await p.waitForSelector("[data-testid=step-wifi]");
            await p.click("[data-testid=skip]");
            await p.waitForSelector("[data-testid=step-hardware]");
            await p.click("[data-testid=skip]");
            await p.waitForSelector("[data-testid=step-restore]");
            await p.click("[data-testid=skip]");
            await p.waitForSelector("[data-testid=step-datetime]");
            await p.waitForTimeout(400);
            const zone = (await luna(p, "luna://com.webos.service.systemservice/getPreferences", { keys: ["timeZone"] })).timeZone;
            const shown = (await p.textContent("[data-testid=timezone]")).trim();
            check(zone.ZoneID === want && zone.City === label && shown.includes(label),
                  `a computer in ${tz}: the zone is ${zone.ZoneID} (${zone.City}), the picker shows "${shown}"`);
            await c.close();
        }
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
