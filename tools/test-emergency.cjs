#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergency information in headless Chromium with the simulator's runtime:
//
//   Settings > Emergency Info   fills in the medical ID, picks an emergency
//                               contact from Contacts, turns "Show when
//                               locked" off and on; the system preference
//                               emergencyInfo holds it
//   Phone's restricted mode     (what the lock screen's Emergency Call opens,
//                               {emergency: true}): only emergency numbers
//                               (and the owner's emergency contacts) can be
//                               called, the empty dial button fills in 911,
//                               the call goes through and is logged, the
//                               Medical ID shows, Cancel closes the window
//   Settings > Accessibility    high contrast reaches every page
//
//   node tools/test-emergency.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "emergency-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8300 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
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

// One reply from a simulated service, in the page.
const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
}), [uri, params]);

async function main() {
    for (const app of ["settings", "phone"])
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
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
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        const prefs = async () => (await luna(page, "luna://com.webos.service.systemservice/getPreferences", { keys: ["emergencyInfo"] })).emergencyInfo;

        // ---- Settings > Emergency Info ------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.settings", { page: "emergency" }));
        await page.evaluate(() => localStorage.clear());
        // Fresh demo contacts (the phone's seed data).
        await page.goto(appUrl("org.webosphoenix.phone"));
        await page.waitForTimeout(1500);
        await page.goto(appUrl("org.webosphoenix.settings", { page: "emergency" }));
        await page.waitForSelector("[data-testid=ice-name]");
        await shot("settings-empty");
        await page.fill("[data-testid=ice-name]", "Alex Morgan");
        await page.fill("[data-testid=ice-born]", "1984-03-02");
        await page.click("[data-testid=ice-blood]");
        await page.click("role=option[name='O-']");
        await page.click("[data-testid=ice-donor]");
        await page.fill("[data-testid=ice-allergies]", "Penicillin");
        await page.fill("[data-testid=ice-medications]", "Salbutamol inhaler");
        await page.fill("[data-testid=ice-conditions]", "Asthma");
        await page.click("[data-testid=ice-add-contact]");
        await page.waitForSelector("[data-testid=contact-picker]");
        const pick = page.locator("[data-testid^=pick-]").first();
        const who = (await pick.getAttribute("data-testid")).slice(5);
        await pick.click();
        const numberPick = page.locator(".emergency-pick");
        if (await page.locator("[data-testid=contact-picker]").count() && await numberPick.count()) await numberPick.first().click();
        await page.waitForSelector("[data-testid=contact-picker]", { state: "detached" });
        await page.waitForTimeout(600);
        let info = await prefs();
        check(info && info.name === "Alex Morgan" && info.bloodType === "O-" && info.organDonor === true
              && info.allergies === "Penicillin" && info.birthDate === "1984-03-02", "the medical ID is saved as you type");
        check(info && info.contacts && info.contacts.length === 1 && info.contacts[0].name === who && !!info.contacts[0].personId,
              `an emergency contact is picked from Contacts (${who})`);
        await page.click("[data-testid=ice-contact-0] .pui-row");
        await page.click("role=option[name='Spouse']");
        await page.waitForTimeout(300);
        check((await prefs()).contacts[0].relation === "Spouse", "the contact's relation is set");
        await shot("settings-filled");
        const iceNumber = (await prefs()).contacts[0].number;

        // ---- Phone, restricted mode ---------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.phone", { emergency: true }));
        await page.waitForSelector("[data-testid=emergency]");
        await page.evaluate(() => { window.__closed = 0; window.close = () => { window.__closed++; }; });
        let t = await text();
        check(/Emergency calls only/.test(t) && /Dial 911/.test(t), "restricted mode: emergency calls only, 911 offered");
        check(await page.locator("[data-testid=phone-tabs]").count() === 0, "restricted mode: no call log, favourites or contacts");
        await shot("phone-emergency");
        for (const k of "5550142") await page.keyboard.press(k);
        await page.click("[data-testid=dial-button]");
        await page.waitForTimeout(300);
        t = await text();
        check(/Only emergency numbers/.test(t), "restricted mode: another number is refused");
        const calls = async () => (await luna(page, "luna://com.palm.telephony/callStatusQuery", {})).calls || [];
        check((await calls()).filter((c) => c.state !== "disconnected").length === 0, "restricted mode: nothing was dialled");
        await page.click("[data-testid=dial-button]");
        check((await page.textContent("[data-testid=number-display]")).includes("911"), "the empty dial button fills in 911");
        await page.click("[data-testid=dial-button]");
        await page.waitForSelector("[data-testid=incall]");
        await page.waitForSelector("[data-testid=incall][data-state=active]", { timeout: 6000 });
        check(true, "911 is called and answered");
        await shot("phone-emergency-call");
        await page.click("[data-testid=end-call]");
        await page.waitForSelector("[data-testid=emergency]", { timeout: 5000 });
        check(true, "after the call, back to the emergency dial pad");
        await page.waitForTimeout(300);
        const log = await luna(page, "luna://com.palm.db/find", { query: { from: "com.palm.phonecall:1" } });
        check((log.results || []).some((c) => c.to && c.to[0] && c.to[0].addr === "911"), "the emergency call is in the call log");

        // Medical ID.
        await page.click("[data-testid=medical-id-button]");
        await page.waitForSelector("[data-testid=medical-id]");
        t = await text();
        check(/Alex Morgan/.test(t) && /O-/.test(t) && /Penicillin/.test(t) && /Asthma/.test(t) && /Organ donor/i.test(t),
              "Medical ID shows the name, blood type, allergies, conditions, donor");
        check(new RegExp(who).test(t) && /Spouse/.test(t), "Medical ID lists the emergency contact");
        await shot("phone-medical-id");
        await page.click("[data-testid=ice-call-0]");
        await page.waitForSelector("[data-testid=incall]");
        check((await calls()).some((c) => c.number.replace(/\D/g, "") === iceNumber.replace(/\D/g, "") && c.state !== "disconnected"),
              "the emergency contact can be called while locked");
        await page.click("[data-testid=end-call]");
        await page.waitForSelector("[data-testid=emergency]", { timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        check(await page.evaluate(() => window.__closed) === 1, "back closes the emergency window");
        await page.click("[data-testid=emergency-cancel]");
        check(await page.evaluate(() => window.__closed) === 2, "Cancel closes the emergency window");

        // Show when locked off: no Medical ID on the lock screen.
        await page.goto(appUrl("org.webosphoenix.settings", { page: "emergency" }));
        await page.waitForSelector("[data-testid=show-when-locked]");
        await page.click("[data-testid=show-when-locked]");
        await page.waitForTimeout(300);
        check((await prefs()).showWhenLocked === false, "Show when locked can be turned off");
        await page.goto(appUrl("org.webosphoenix.phone", { emergency: true }));
        await page.waitForSelector("[data-testid=emergency]");
        await page.waitForTimeout(400);
        check(await page.locator("[data-testid=medical-id-button]").count() === 0, "then the lock screen shows no Medical ID");
        // The emergency contact is no longer callable either.
        for (const k of iceNumber.replace(/\D/g, "")) await page.keyboard.press(k);
        await page.click("[data-testid=dial-button]");
        await page.waitForTimeout(200);
        check(/Only emergency numbers/.test(await text()), "and its contacts cannot be called from it");

        // The normal phone is unchanged.
        await page.goto(appUrl("org.webosphoenix.phone"));
        await page.waitForSelector("[data-testid=phone-tabs]");
        check(await page.locator("[data-testid=emergency]").count() === 0, "Phone without {emergency} is the full app");

        // ---- Accessibility ------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.settings", { page: "accessibility" }));
        await page.waitForSelector("[data-testid=a11y-highContrast]");
        await page.click("[data-testid=a11y-highContrast]");
        await page.waitForTimeout(200);
        check(await page.evaluate(() => document.documentElement.classList.contains("phoenix-high-contrast")), "high contrast applies at once");
        await page.click("[data-testid=a11y-reduceMotion]");
        await page.waitForTimeout(200);
        await shot("settings-accessibility");
        const other = await context.newPage();
        await other.goto(appUrl("org.webosphoenix.tasks"));
        await other.waitForTimeout(800);
        check(await other.evaluate(() => document.documentElement.classList.contains("phoenix-high-contrast")), "and in every other app");
        const a11y = (await luna(page, "luna://com.webos.service.systemservice/getPreferences", { keys: ["accessibility"] })).accessibility;
        check(a11y && a11y.reduceMotion === true && a11y.highContrast === true, "reduce motion and high contrast are saved");
        await page.click("[data-testid=a11y-highContrast]");
        await page.waitForTimeout(300);
        check(!(await other.evaluate(() => document.documentElement.classList.contains("phoenix-high-contrast"))), "turning it off reaches the other app");
        await other.close();

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
