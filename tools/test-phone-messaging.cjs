#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Phone and Messaging (apps/phone, apps/messaging, built into dist/)
// in headless Chromium against the simulated legacy services in
// runtime/phoenix-runtime.js ("Phone and Messaging services"): dials a
// number and places, holds and ends a call; answers, and ignores, a
// simulated incoming call; sends a text to a contact and receives one.
// Both apps run as two pages of one browser context, sharing the
// simulated services' store as two cards do in phoenix-sim.
//
//   node tools/test-phone-messaging.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "phone-tests", tablet ? "tablet" : "phone");
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
    for (const app of ["phone", "messaging"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];      // host messages from both pages: {page, type, payload}
        const watch = (page, name) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    host.push({ page: name, type: msg.type, payload: msg.payload });
                } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                    errors.push(`${name}: ${t}`);
                }
            });
        };
        const phone = await context.newPage();
        watch(phone, "phone");
        const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const status = () => phone.getAttribute("[data-testid='incall']", "data-state").catch(() => null);

        // ---- Phone: dial pad ---------------------------------------------------------------
        await phone.goto(`${APPS}/org.webosphoenix.phone/index.html`);
        await phone.evaluate(() => localStorage.clear());
        await phone.reload();
        await phone.waitForSelector("[data-testid='dialpad']");
        await phone.waitForTimeout(300);
        await shot(phone, "phone-dialpad");
        for (const k of "2125550164") await phone.click(`[data-testid='dialpad'] [data-key='${k}']`);
        check((await phone.textContent("[data-testid='number-display']")) === "(212) 555-0164", "typed number is formatted");
        await phone.waitForFunction(() => /Lena Okafor/.test(document.querySelector("[data-testid='dialer-contact']").textContent));
        check(true, "the number is matched to a contact (com.palm.person:1)");
        await shot(phone, "phone-dialpad-number");

        // ---- Place, hold and end a call ----------------------------------------------------------
        await phone.click("[data-testid='dial-button']");
        await phone.waitForSelector("[data-testid='incall']");
        check(["dialing", "alerting"].includes(await status()), "dial shows the call being set up");
        await shot(phone, "phone-dialing");
        await phone.waitForSelector("[data-testid='incall'][data-state='active']", { timeout: 5000 });
        check(true, "the call connects");
        await phone.click("[data-testid='mute']");
        await phone.waitForSelector("[data-testid='mute'][aria-pressed='true']");
        check(true, "mute");
        await phone.click("[data-testid='speaker']");
        await phone.waitForSelector("[data-testid='speaker'][aria-pressed='true']");
        check(true, "speaker");
        await phone.waitForTimeout(1100);
        check(/^0:0[1-9]$/.test(await phone.textContent("[data-testid='call-status']")), "the call timer runs");
        await shot(phone, "phone-incall");
        await phone.click("[data-testid='keypad']");
        await phone.click("[data-testid='dtmf-pad'] [data-key='1']");
        await phone.click("[data-testid='dtmf-pad'] [data-key='#']");
        check((await phone.textContent("[data-testid='call-status']")) === "1#", "keypad sends touch tones");
        await shot(phone, "phone-incall-keypad");
        await phone.keyboard.press("Escape");
        await phone.waitForSelector("[data-testid='hold']");
        await phone.click("[data-testid='hold']");
        await phone.waitForSelector("[data-testid='incall'][data-state='held']");
        check((await phone.textContent("[data-testid='call-status']")) === "On Hold", "hold");
        await shot(phone, "phone-held");
        await phone.click("[data-testid='hold']");
        await phone.waitForSelector("[data-testid='incall'][data-state='active']");
        await phone.click("[data-testid='end-call']");
        await phone.waitForSelector("[data-testid='incall'][data-state='disconnected']", { timeout: 2000 });
        await shot(phone, "phone-call-ended");
        await phone.waitForSelector("[data-testid='incall']", { state: "detached", timeout: 3000 });
        check(true, "ending the call returns to the phone");

        await phone.click("[data-testid='phone-tabs'] [data-value='log']");
        await phone.waitForSelector("[data-testid='call-row']");
        check(/Lena Okafor/.test(await phone.textContent("[data-testid='call-row']")), "the call is in the call log");

        // ---- Incoming call: answer -------------------------------------------------------------------
        // Phone opens a popup alert for it (the shell shows it under what
        // the user is doing); its card is not the incoming-call screen.
        let alertPage = context.waitForEvent("page");
        await phone.evaluate(() => window.__phoenixRuntime.simulateIncomingCall({ number: "(408) 555-0142" }));
        let alert = await alertPage;
        watch(alert, "alert");
        const alertUrl = alert.url();
        check(/alert=incoming/.test(alertUrl) && /phoenixWindow=popupalert/.test(alertUrl) && /phoenixHeight=150/.test(alertUrl),
            "an incoming call opens a 150 px popup alert");
        check(/phoenixName=incoming-known/.test(alertUrl), "named incoming-known for a contact (notificationPolicy.conf)");
        await alert.setViewportSize({ width: viewport.width, height: 150 });
        await alert.waitForSelector("[data-testid='incoming-alert']");
        check((await alert.textContent("[data-testid='incoming-name']")) === "Ada Palmer", "the alert shows the caller");
        check((await phone.locator("[data-testid='incall']").count()) === 0, "the Phone card is not taken over");
        await phone.waitForTimeout(200);
        check(host.some((m) => m.type === "banner" && /Incoming call: Ada Palmer/.test(m.payload.message)),
            "incoming call banner for the shell");
        await shot(alert, "phone-incoming-alert");
        let closed = alert.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
        await alert.click("[data-testid='answer']");
        check(await closed, "answering closes the alert");
        await phone.waitForSelector("[data-testid='incall'][data-state='active']");
        check(true, "answer: the call is up on the Phone card");
        check(host.some((m) => m.page === "phone" && m.type === "activate"), "and the Phone card comes to the front (PalmSystem.activate)");
        await phone.evaluate(() => window.__phoenixRuntime.simulateRemoteHangup());
        await phone.waitForSelector("[data-testid='incall']", { state: "detached", timeout: 4000 });
        check(true, "the caller hangs up");

        // ---- Incoming call on the lock screen: unlocking answers ---------------------------------------
        // ("Drag up to answer": the shell unlocks; the alert hears it through
        // com.palm.systemmanager getLockStatus.)
        await phone.evaluate(() => window.__phoenixRuntime.applyHostStatus({ deviceLocked: true }));
        alertPage = context.waitForEvent("page");
        await phone.evaluate(() => window.__phoenixRuntime.simulateIncomingCall({ number: "(408) 555-0142" }));
        alert = await alertPage;
        watch(alert, "alert");
        await alert.waitForSelector("[data-testid='incoming-alert']");
        await alert.waitForTimeout(300);
        check((await alert.locator("[data-testid='answer']").count()) === 0,
            "on the lock screen the alert shows only the caller (the handle answers)");
        await alert.setViewportSize({ width: viewport.width, height: 300 });
        await shot(alert, "phone-incoming-alert-locked");
        closed = alert.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
        await phone.evaluate(() => window.__phoenixRuntime.applyHostStatus({ deviceLocked: false }));
        check(await closed, "unlocking during the call closes the alert");
        await phone.waitForSelector("[data-testid='incall'][data-state='active']");
        check(true, "and answers the call");
        await phone.evaluate(() => window.__phoenixRuntime.simulateRemoteHangup());
        await phone.waitForSelector("[data-testid='incall']", { state: "detached", timeout: 4000 });

        // ---- Incoming call: ignore -> missed ----------------------------------------------------------
        alertPage = context.waitForEvent("page");
        await phone.evaluate(() => window.__phoenixRuntime.simulateIncomingCall({ number: "(510) 555-0177" }));
        alert = await alertPage;
        watch(alert, "alert");
        check(/phoenixName=incoming-unknown/.test(alert.url()), "named incoming-unknown for a number not in contacts");
        await alert.waitForSelector("[data-testid='ignore']");
        closed = alert.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
        await alert.click("[data-testid='ignore']");
        check(await closed, "ignoring closes the alert");
        await phone.click("[data-testid='log-filter'] [data-value='missed']");
        await phone.waitForFunction(() => /\(510\) 555-0177/.test(document.querySelector("[data-testid='call-row']")?.textContent || ""));
        check(true, "an ignored call is listed under Missed");
        await shot(phone, "phone-calllog-missed");
        await phone.click("[data-testid='log-filter'] [data-value='all']");
        await phone.waitForTimeout(200);
        const rows = await phone.locator("[data-testid='call-row']").allTextContents();
        // Newest first: the missed call, the two answered from Ada, the placed one.
        check(/Ada Palmer/.test(rows[1]) && /Ada Palmer/.test(rows[2]) && /Lena Okafor/.test(rows[3]),
            "answered and placed calls are logged in order");
        await shot(phone, "phone-calllog");
        await phone.click("[data-testid='phone-tabs'] [data-value='favorites']");
        await phone.waitForSelector("[data-testid='person-row']");
        check((await phone.locator(".person-row .fav-star").count()) === 4, "favourites from contacts");
        await shot(phone, "phone-favorites");

        // ---- Messaging: conversations -----------------------------------------------------------------
        const msg = await context.newPage();
        watch(msg, "messaging");
        await msg.goto(`${APPS}/org.webosphoenix.messaging/index.html`);
        await msg.waitForSelector("[data-testid='thread-row']");
        await msg.waitForTimeout(300);
        const threads = await msg.locator("[data-testid='thread-row'] .thread-name").allTextContents();
        check(threads.join(",") === "Marcus Reyes,Lena Okafor,Ada Palmer", "conversation list, newest first");
        check((await msg.textContent("[data-testid='thread-row'] .thread-unread")) === "1", "unread count");
        await shot(msg, "messaging-threads");

        // ---- Send a text to a contact -----------------------------------------------------------------------
        await msg.click("[data-testid='compose']");
        await msg.fill("[data-testid='recipient-input']", "sam");
        await msg.click("[data-testid='recipient-option'] >> text=Sam Delgado");
        await msg.waitForSelector("[data-testid='recipient-chip']");
        check(/Sam Delgado/.test(await msg.textContent("[data-testid='recipient-chip']")), "recipient picked from contacts");
        await msg.click("[data-testid='transport']");
        await msg.waitForSelector("[role='option'][aria-disabled='true']");
        check((await msg.locator("[role='option'][aria-disabled='true']").count()) >= 3, "IM transports are listed but disabled");
        await shot(msg, "messaging-transports");
        await msg.keyboard.press("Escape");
        await msg.fill("[data-testid='message-input']", "Hi Sam, texting from Phoenix!");
        await shot(msg, "messaging-compose");
        await msg.click("[data-testid='send']");
        await msg.waitForSelector(".bubble.out >> text=Hi Sam, texting from Phoenix!");
        await msg.waitForSelector(".bubble.out[data-status='successful']", { timeout: 5000 });
        check(true, "the text is sent (outbox: pending -> successful)");
        check((await msg.textContent("[data-testid='thread-title']")).includes("Sam Delgado"), "the new conversation is with Sam");
        await shot(msg, "messaging-sent");

        // ---- Receive a text (through the other page, like the telephony service) ----------------------------------
        if (!tablet) {
            await msg.keyboard.press("Escape");
            await msg.waitForSelector("[data-testid='thread-row']");
        }
        await phone.evaluate(() => window.__phoenixRuntime.simulateIncomingSms({ from: "+1 303 555 0135", text: "Got it, see you at 6" }));
        await msg.waitForFunction(() => /Got it, see you at 6/.test(document.querySelector("[data-testid='thread-row']")?.textContent || ""), null, { timeout: 4000 });
        check(true, "the received text updates Messaging in another window");
        check(host.some((m) => m.type === "notification" && m.payload.appId === "org.webosphoenix.messaging" && m.payload.title === "Sam Delgado"),
            "the shell is told about the new message");
        if (!tablet) {
            check((await msg.textContent("[data-testid='thread-row'] .thread-unread")) === "1", "it counts as unread");
            await shot(msg, "messaging-received-list");
            await msg.click("[data-testid='thread-row']");
        }
        await msg.waitForSelector(".bubble.in >> text=Got it, see you at 6");
        await msg.waitForTimeout(300);
        await shot(msg, "messaging-thread");
        const unread = await msg.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).results.map((t) => t.unreadCount || 0).reduce((a, x) => a + x, 0));
            b.call("luna://com.palm.db/find", JSON.stringify({ query: { from: "com.palm.chatthread:1", where: [{ prop: "displayName", op: "=", val: "Sam Delgado" }] } }));
        }));
        check(unread === 0, "opening the conversation marks it read");

        // ---- Reply in the conversation --------------------------------------------------------------------------
        await msg.fill("[data-testid='message-input']", "Perfect");
        await msg.keyboard.press("Enter");
        await msg.waitForSelector(".bubble.out >> text=Perfect");
        check((await msg.locator(".bubble").count()) === 3, "the reply joins the conversation");

        // ---- IM stub --------------------------------------------------------------------------------------------
        await msg.keyboard.press("Escape");
        if (!tablet) await msg.waitForSelector("[data-testid='msg-tabs']");
        await msg.click("[data-testid='msg-tabs'] [data-value='buddies']");
        await msg.waitForSelector("[data-testid='im-account']");
        check((await msg.locator("[data-testid='im-account'].disabled").count()) >= 3, "Buddies lists the IM transports as unavailable");
        await shot(msg, "messaging-buddies");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
