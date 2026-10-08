#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The community's features picked for 1.0 (docs/M6-PLAN.md F4) in the web
// side, in headless Chromium against runtime/phoenix-runtime.js:
//   - Settings > Advanced (and Text Assist > Number row): every option is a
//     system preference that reaches the shell as the systemStatus tweaks;
//     Settings > Sounds & Ringtones >
//     Repeat alerts and Screen & Lock > Show previews likewise;
//   - Contacts' Tones (compat app/phoenix-tones.js): a ringtone and a
//     message tone picked for a contact are kept, and a text from them
//     sounds its message tone;
//   - Email's cycling new-mail dashboard (compat source/phoenix-dashboard.js):
//     on, a new-mail dashboard is the cycling one, which shows one email at
//     a time with its time and deletes the one shown.
//
//   node tools/test-community.cjs [--tablet] [--out DIR]
//
// Build Settings first (cd apps && npm ci && npm run build -w settings).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "community-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const APPS = `http://127.0.0.1:${port}/usr/palm/applications`;

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
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];    // host messages from every page: {page, type, payload}
        const watch = (page, name) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    host.push({ page: name, type: msg.type, payload: msg.payload });
                }
            });
        };
        const lastStatus = () => { const s = host.filter((m) => m.type === "systemStatus"); return s.length ? s[s.length - 1].payload : {}; };
        // Wait for a state the action causes (not for time, not for what
        // may be on the page already).
        const until = async (fn, what, ms = 5000) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
                try { if (await fn()) { check(true, what); return true; } } catch (e) { /* not yet */ }
                await new Promise((r) => setTimeout(r, 50));
            }
            check(false, what);
            return false;
        };
        const svc = (page, uri, params) => page.evaluate(([u, p]) => new Promise((resolve) => {
            window.__phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);

        // ---- Settings > Advanced, Sounds, Screen & Lock -------------------------------------
        const st = await context.newPage();
        watch(st, "settings");
        const open = async (pageId) => {
            await st.goto(`${APPS}/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify({ page: pageId })));
            await st.waitForSelector(".pui-header");
        };
        await open("advanced");
        await st.evaluate(() => localStorage.clear());
        await open("advanced");
        await st.waitForSelector("[data-testid='adv-infiniteCardCyclingEnabled']");
        const tweaks = () => lastStatus().tweaks || {};
        const toggles = [["adv-infiniteCardCyclingEnabled", "infiniteCardCycling", true], ["adv-sysUiEnableMaximizeEdges", "maximizeEdges", true],
                         ["adv-sysUiEnableWaveLauncher", "waveLauncher", true], ["adv-showReticleAnimation", "tapRipple", false],
                         ["adv-hapticFeedback", "haptics", true], ["adv-showBatteryPercent", "batteryPercent", true]];
        for (const [id, key, want] of toggles) {
            await st.click(`[data-testid='${id}']`);
            await until(() => tweaks()[key] === want, `Advanced: ${key} ${want} reaches the shell`);
        }
        for (const [id, option, key, want] of [["adv-launcherGridDensity", "Dense", "gridDensity", "dense"],
                                               ["adv-gestureSensitivity", "High", "gestureSensitivity", "high"],
                                               ["adv-animationSpeed", "Fast", "animationSpeed", "fast"]]) {
            await st.click(`[data-testid='${id}']`);
            await st.click(`role=option[name='${option}']`);
            await until(() => tweaks()[key] === want, `Advanced: ${key} ${want} reaches the shell`);
        }
        // Switch apps (Screen & Lock's Advanced gestures, here beside the
        // wave launcher): only where there is a gesture area.
        check(await st.locator("[data-testid='adv-sysUiEnableNextPrevGestures']").count() === 0, "Advanced: no Switch apps without a gesture area");
        await st.evaluate(() => window.__phoenixRuntime.applyHostStatus({ gestureArea: true }));
        await st.waitForSelector("[data-testid='adv-sysUiEnableNextPrevGestures']", { timeout: 3000 });
        await st.click("[data-testid='adv-sysUiEnableNextPrevGestures']");
        await until(() => lastStatus().advancedGestures === true, "Advanced: Switch apps reaches the shell");
        await st.click("[data-testid='adv-emailDashboardCycling']");
        await until(async () => (await svc(st, "luna://com.webos.service.systemservice/getPreferences", { keys: ["emailDashboardCycling"] })).emailDashboardCycling === true,
                    "Advanced: the cycling email dashboard is a preference");
        await st.screenshot({ path: path.join(outDir, "advanced.png"), fullPage: true });

        await open("textassist");
        await st.click("[data-testid='ta-numberrow']");
        await until(() => tweaks().numberRow === true, "Text Assist > Number row reaches the shell");

        await open("sounds");
        await st.click("[data-testid='repeat-toggle']");
        await until(() => (lastStatus().notificationRepeat || {}).enabled === true, "Repeat alerts on reaches the shell");
        await st.click("[data-testid='repeat-minutes']");
        await st.click("role=option[name='5 minutes']");
        await until(() => (lastStatus().notificationRepeat || {}).minutes === 5, "every 5 minutes");
        await st.click("[data-testid='repeat-app-toggle-com.palm.app.email']");
        await until(() => ((lastStatus().notificationRepeat || {}).apps || {})["com.palm.app.email"] === false, "not for Email");
        await st.screenshot({ path: path.join(outDir, "sounds-repeat.png"), fullPage: true });

        await open("screen");
        await st.click("[data-testid='lock-previews-toggle']");
        await until(() => lastStatus().lockScreenPreviews === false, "Show previews off reaches the shell");
        await svc(st, "luna://com.webos.service.systemservice/setPreferences", { lockScreenPreviews: true });

        // ---- Contacts: a contact's ringtone and message tone ----------------------------------------
        const ct = await context.newPage();
        watch(ct, "contacts");
        await ct.goto(`${APPS}/com.palm.app.contacts/index.html`);
        // Found by the search field: on a phone the list is longer than the card.
        await ct.getByText("Marcus Chen").first().waitFor({ timeout: 20000 });
        await ct.locator("input:visible").first().click();
        await ct.keyboard.type("Nair");
        await ct.getByText("Priya Nair").first().click({ timeout: 20000 });
        // The details' edit button (the pencil in its toolbar).
        await ct.waitForSelector("[id$='details_editButton']", { state: "visible" });
        await ct.click("[id$='details_editButton']");
        await ct.getByText("Message tone", { exact: true }).first().waitFor();
        const tonesRow = (name) => ct.evaluate((n) => {
            const ed = Object.values(enyo.$).find((c) => c.kindName === "Edit");
            return ed.$[n].getContent();
        }, name);
        check(await tonesRow("phoenixMessageToneName") === "Default" && await tonesRow("phoenixRingtoneName") === "Default",
              "Edit has Tones: Ringtone and Message tone, Default");
        await ct.evaluate(() => Object.values(enyo.$).find((c) => c.kindName === "Edit").$.EditDetails.scrollToBottom());
        await ct.getByText("Message tone", { exact: true }).first().click();
        await ct.locator(".enyo-popup:visible").getByText("Phone", { exact: true }).click();
        await until(async () => await tonesRow("phoenixMessageToneName") === "Phone", "the message tone picked shows");
        await ct.getByText("Ringtone", { exact: true }).first().click();
        await ct.locator(".enyo-popup:visible").getByText("Notification", { exact: true }).click();
        await until(async () => await tonesRow("phoenixRingtoneName") === "Notification", "the ringtone picked shows");
        await ct.waitForTimeout(300);
        await ct.screenshot({ path: path.join(outDir, "contacts-tones.png") });
        await ct.locator(".enyo-button:visible", { hasText: "Done" }).first().click();
        const priya = async () => (await svc(ct, "luna://com.palm.db/find", { query: { from: "com.palm.person:1" } })).results
            .find((p) => p.name && p.name.givenName === "Priya" && p.name.familyName === "Nair");
        await until(async () => ((await priya()).ringtone || {}).location === "/usr/palm/sounds/notification.wav",
                    "the ringtone is the person's (com.palm.person ringtone, which Phone rings with)");
        await until(async () => {
            const id = (await priya())._id;
            const t = (await svc(ct, "luna://com.palm.db/find", { query: { from: "org.webosphoenix.contacttone:1" } })).results;
            return t.some((x) => x.personId === id && x.messageTone.location === "/usr/palm/sounds/phone.wav");
        }, "the message tone is kept beside the person (org.webosphoenix.contacttone:1)");
        const before = host.length;
        await ct.evaluate(() => window.__phoenixRuntime.simulateIncomingSms({ from: "(415) 555-0123", text: "On my way" }));
        await until(() => host.slice(before).some((m) => m.type === "notification" && m.payload.title === "Priya Nair"
                                                     && m.payload.soundFile === "/usr/palm/sounds/phone.wav"),
                    "a text from her sounds her message tone");
        await ct.evaluate(() => window.__phoenixRuntime.simulateIncomingSms({ from: "(415) 555-0163", text: "Dinner?" }));
        await until(() => host.slice(before).some((m) => m.type === "notification" && m.payload.title === "Marcus Chen"
                                                     && !m.payload.soundFile && m.payload.soundClass === "notifications"),
                    "a text from someone without one sounds the notification tone");

        // ---- Email: the cycling new-mail dashboard -----------------------------------------------------
        const mail = await context.newPage();
        watch(mail, "email");
        await mail.goto(`${APPS}/com.palm.app.email/index.html`);
        await mail.waitForFunction(() => window.enyo && enyo.application && enyo.application.dashboardManager
                                         && enyo.application.dashboardManager.phoenixCycling === true, null, { timeout: 20000 });
        check(true, "Email's dashboard manager reads the cycling preference");
        await mail.evaluate(() => {
            window.__deleted = [];
            Email.deleteEmails = (t) => window.__deleted.push(t.id);
        });
        const now = Date.now();
        await mail.evaluate((t) => {
            const dm = enyo.application.dashboardManager;
            dm._updateDashboard("-unified", [
                { emailId: "e1", accountId: "-unified", folderId: "f", title: "Ada Palmer", text: "Lunch on Friday", timestamp: t - 3600000,
                  icon: "images/notification-large-generic.png" },
                { emailId: "e2", accountId: "-unified", folderId: "f", title: "Lena Okafor", text: "Build notes", timestamp: t,
                  icon: "images/notification-large-generic.png" }]);
        }, now);
        // The account's dashboard window (other pages may open meanwhile:
        // find it by its name, phoenixName=dashboard--unified).
        let dash = null;
        await until(() => (dash = context.pages().find((pg) => /phoenixName=dashboard--unified/.test(pg.url()))) !== undefined,
                    "a new-mail dashboard opens", 10000);
        watch(dash, "dashboard");
        check(/phoenix-dashboard\/cycling\.html/.test(dash.url()), "the new-mail dashboard is the cycling one");
        await dash.setViewportSize({ width: 320, height: 54 });
        // On the dashboard's dark glass, as the shell shows it.
        await dash.evaluate(() => { document.documentElement.style.background = "#1f2226"; });
        await dash.waitForFunction(() => !!document.body && /Lena Okafor/.test(document.body.innerText), null, { timeout: 10000 });
        const dtext = () => dash.evaluate(() => (document.body ? document.body.innerText : "").replace(/\s+/g, " "));
        check(/Build notes/.test(await dtext()) && /1\/2/.test(await dtext()), `newest first, "1/2" (${await dtext()})`);
        check(/\d:\d\d/.test(await dtext()), "with its time");
        await dash.screenshot({ path: path.join(outDir, "email-dashboard-1.png") });
        await until(async () => /Ada Palmer/.test(await dtext()) && /2\/2/.test(await dtext()), "then the next, by itself", 8000);
        await dash.screenshot({ path: path.join(outDir, "email-dashboard-2.png") });
        await dash.click(".phoenix-dashboard-delete");
        await until(() => mail.evaluate(() => window.__deleted.indexOf("e1") >= 0), "its trash can deletes the email shown");
        await until(async () => /Lena Okafor/.test(await dtext()) && !/Ada Palmer/.test(await dtext()), "and it leaves the dashboard");
        // Off: the original stacked dashboard.
        await svc(st, "luna://com.webos.service.systemservice/setPreferences", { emailDashboardCycling: false });
        await until(() => mail.evaluate(() => enyo.application.dashboardManager.phoenixCycling === false),
                    "turned off in Settings, Email hears it (another page's preference change)");

        check(errors.length === 0, `no page errors (${errors.slice(0, 5).join(" | ")})`);
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} FAILED` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
