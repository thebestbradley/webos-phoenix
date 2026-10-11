#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Phone and Messaging (apps/phone, apps/messaging, built into dist/)
// in headless Chromium against the simulated legacy services in
// runtime/phoenix-runtime.js ("Phone and Messaging services"): dials a
// number and places, holds and ends a call; answers, and ignores, a
// simulated incoming call; sends a text to a contact and receives one;
// sends a picture message (MMS) with a picture from the picker and
// receives one; Buddies without an IM account (Jabber with Messaging:
// tools/test-xmpp.cjs).
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
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
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
        // Upright on a phone (no room for the dial pad turned); free on a tablet.
        const turned = host.filter((m) => m.page === "phone" && m.type === "windowOrientation").pop();
        check(turned && turned.payload.orientation === (tablet ? "free" : "up"),
              `the Phone app asks to be held ${tablet ? "any way (tablet)" : "upright (phone)"}: ${JSON.stringify(turned && turned.payload)}`);
        for (const k of "2125550164") await phone.click(`[data-testid='dialpad'] [data-key='${k}']`);
        check((await phone.textContent("[data-testid='number-display']")) === "(212) 555-0164", "typed number is formatted");
        await phone.waitForFunction(() => /Lena Okafor/.test(document.querySelector("[data-testid='dialer-contact']").textContent));
        check(true, "the number is matched to a contact (com.palm.person:1)");
        await shot(phone, "phone-dialpad-number");
        if (!tablet) {
            // A card shorter than a Pre's (a dashboard showing under it): the
            // dial pad gives up height, the dial button stays above the command menu.
            await phone.setViewportSize({ width: 320, height: 400 });
            await phone.waitForTimeout(100);
            const [dialBottom, menuTop] = await phone.evaluate(() => [
                document.querySelector("[data-testid='dial-button']").getBoundingClientRect().bottom,
                document.querySelector(".phone-toolbar").getBoundingClientRect().top]);
            check(dialBottom <= menuTop, `a short card keeps the dial button above the command menu (${dialBottom} <= ${menuTop})`);
            await shot(phone, "phone-dialpad-short");
            await phone.setViewportSize(viewport);
        }

        // ---- Place, hold and end a call ----------------------------------------------------------
        await phone.click("[data-testid='dial-button']");
        await phone.waitForSelector("[data-testid='incall']");
        check(["dialing", "alerting"].includes(await status()), "dial shows the call being set up");
        await shot(phone, "phone-dialing");
        await phone.waitForSelector("[data-testid='incall'][data-state='active']", { timeout: 5000 });
        check(true, "the call connects");
        if (!tablet) {
            // During a call a Pre-sized card is 405 tall (the call's dashboard
            // under it): the caller's name must not be squeezed and clipped.
            await phone.setViewportSize({ width: 320, height: 405 });
            await phone.waitForTimeout(100);
            const name = await phone.evaluate(() => {
                const e = document.querySelector("[data-testid='incall-name']");
                return { client: e.clientHeight, scroll: e.scrollHeight, top: e.getBoundingClientRect().top };
            });
            check(name.scroll <= name.client && name.top >= 0, `the caller's name shows whole on a short card (${JSON.stringify(name)})`);
            await shot(phone, "phone-incall-short");
            await phone.setViewportSize(viewport);
        }
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
        check(/phoenixSoundClass=ringtones/.test(alertUrl) && !/phoenixSound=/.test(alertUrl),
            "it rings: sound class ringtones, the ringtone preference (AlertWindow sound attributes)");
        await alert.setViewportSize({ width: viewport.width, height: 150 });
        await alert.waitForSelector("[data-testid='incoming-alert']");
        check((await alert.textContent("[data-testid='incoming-name']")) === "Ada Palmer", "the alert shows the caller");
        check((await phone.locator("[data-testid='incall']").count()) === 0, "the Phone card is not taken over");
        await phone.waitForTimeout(200);
        check(host.some((m) => m.type === "banner" && /Incoming call: Ada Palmer/.test(m.payload.message)),
            "incoming call banner for the shell");
        // What the volume keys adjust: the ringer while it rings, the call once answered.
        const scenario = () => { const st = host.filter((m) => m.type === "systemStatus"); return st.length ? st[st.length - 1].payload.audioScenario : undefined; };
        check(scenario() === "ringtone", `ringing: the shell's audio scenario is "ringtone" (${scenario()})`);
        await shot(alert, "phone-incoming-alert");
        let closed = alert.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
        await alert.click("[data-testid='answer']");
        check(await closed, "answering closes the alert");
        await phone.waitForSelector("[data-testid='incall'][data-state='active']");
        check(true, "answer: the call is up on the Phone card");
        check(host.some((m) => m.page === "phone" && m.type === "activate"), "and the Phone card comes to the front (PalmSystem.activate)");
        check(scenario() === "phone", `in the call: "phone" (${scenario()})`);
        const acb = () => host.filter((m) => m.type === "activeCallBanner");
        await phone.waitForTimeout(300);
        check(acb().some((m) => m.payload.op === "add" && m.payload.message === "Ada Palmer" && m.payload.startTime > 0),
              `the active-call banner: Ada Palmer (${JSON.stringify(acb().map((m) => m.payload))})`);
        await phone.evaluate(() => window.__phoenixRuntime.simulateRemoteHangup());
        await phone.waitForSelector("[data-testid='incall']", { state: "detached", timeout: 4000 });
        check(true, "the caller hangs up");
        await phone.waitForTimeout(3000);
        check(scenario() === "system", `after it: "system" (${scenario()})`);
        check(acb().length > 0 && acb()[acb().length - 1].payload.op === "remove", "and it goes when the call ends");

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
        // On a new profile several pages start at once, each finding the
        // store not yet seeded: seeding again (as another page would) adds
        // no second copy of the sample conversations.
        const seededAgain = await msg.evaluate(() => {
            localStorage.removeItem("phoenix:telephony:seeded");
            window.__phoenixRuntime.seedPhoneDemoData(false);
            const find = (kind) => new Promise((resolve) => {
                const b = new PalmServiceBridge();
                b.onservicecallback = (r) => resolve(JSON.parse(r).results || []);
                b.call("luna://com.palm.db/find", JSON.stringify({ query: { from: kind } }));
            });
            return Promise.all([find("com.palm.chatthread:1"), find("com.palm.smsmessage:1")])
                .then(([t, m]) => t.length + " conversations, " + m.length + " messages");
        });
        check(seededAgain === "3 conversations, 8 messages", "seeding again adds no second copy (" + seededAgain + ")");

        // ---- Send a text to a contact -----------------------------------------------------------------------
        await msg.click("[data-testid='compose']");
        await msg.fill("[data-testid='recipient-input']", "sam");
        await msg.click("[data-testid='recipient-option'] >> text=Sam Delgado");
        await msg.waitForSelector("[data-testid='recipient-chip']");
        check(/Sam Delgado/.test(await msg.textContent("[data-testid='recipient-chip']")), "recipient picked from contacts");
        await msg.click("[data-testid='transport']");
        await msg.waitForSelector("[role='option'][aria-disabled='true']");
        check((await msg.locator("[role='option'][aria-disabled='true']").count()) >= 3, "the IM networks Phoenix cannot reach are listed but disabled");
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
        check(host.some((m) => m.type === "notification" && m.payload.appId === "org.webosphoenix.messaging" && m.payload.soundClass === "notifications"),
            "with the notification tone");
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

        // ---- Picture message (MMS): attach from the picture picker, send, receive ---------------------------------
        const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        await msg.click("[data-testid='attach']");
        const pickFrame = await (await msg.waitForSelector("iframe[data-phoenix-sheet=pick]")).contentFrame();
        await pickFrame.waitForSelector("[data-testid='pick-picture'][style*='background-image']");
        await msg.waitForTimeout(400);
        await shot(msg, "messaging-picture-picker");
        await pickFrame.click("[data-testid='pick-picture']");
        await msg.waitForSelector("iframe[data-phoenix-sheet]", { state: "detached" });
        await msg.waitForSelector("[data-testid='staged-picture'] img");
        check(true, "a picture from the picker waits above the message field");
        check((await msg.textContent("[data-testid='transport']")).startsWith("MMS"), "and the message becomes a picture message (MMS)");
        await msg.fill("[data-testid='message-input']", "From the harbor");
        await shot(msg, "messaging-mms-staged");
        await msg.click("[data-testid='send']");
        await msg.waitForSelector(".bubble.out[data-service='mms'] [data-testid='message-picture'] img");
        await msg.waitForSelector(".bubble.out[data-service='mms'][data-status='successful']", { timeout: 6000 });
        check(true, "the picture message is sent (pending -> successful)");
        check(await msg.$eval(".bubble.out[data-service='mms'] img", (i) => i.complete && i.naturalWidth > 0), "its picture shows in the balloon");
        check((await msg.locator("[data-testid='staged-picture']").count()) === 0, "and leaves the compose bar");
        const kept = (await luna(msg, "luna://com.palm.db/find", { query: { from: "com.palm.mmsmessage:1" } })).results;
        check(kept.length === 1 && /^\/media\/internal\/\.mms\//.test(kept[0].parts[0].path),
            "the message keeps its own copy of the picture (com.palm.mmsmessage:1 parts)");
        if (!tablet) {
            await msg.keyboard.press("Escape");
            await msg.waitForSelector("[data-testid='thread-row']");
        }
        await phone.evaluate(() => window.__phoenixRuntime.simulateIncomingMms({ from: "+1 303 555 0135", text: "Look where we are!" }));
        if (!tablet) {
            await msg.waitForFunction(() => /Picture: Look where we are!/.test(document.querySelector("[data-testid='thread-row']")?.textContent || ""), null, { timeout: 4000 });
            check(true, "a received picture message is listed (Picture: ...)");
            check((await msg.textContent("[data-testid='thread-row'] .thread-unread")) === "1", "unread");
            await msg.click("[data-testid='thread-row']");
        }
        await msg.waitForSelector(".bubble.in[data-service='mms'] [data-testid='message-picture'] img");
        check(host.some((m) => m.type === "notification" && m.payload.title === "Sam Delgado" && m.payload.body === "Picture: Look where we are!"),
            "the shell is told about the picture message");
        await msg.waitForTimeout(400);
        await shot(msg, "messaging-mms-thread");
        await msg.click(".bubble.in[data-service='mms'] [data-testid='message-picture']");
        await msg.waitForSelector("[data-testid='picture-viewer'] img");
        check(true, "tapping the picture shows it full screen");
        await shot(msg, "messaging-mms-viewer");
        await msg.click("[data-testid='picture-done']");
        await msg.waitForSelector("[data-testid='picture-viewer']", { state: "detached" });

        // ---- Instant messaging: the Buddies view without an IM account ------------------------------------------
        // (The IM accounts are connectors with tests of their own: Jabber with
        // Messaging is tools/test-xmpp.cjs.)
        await msg.keyboard.press("Escape");
        if (!tablet) await msg.waitForSelector("[data-testid='msg-tabs']");
        await msg.click("[data-testid='msg-tabs'] [data-value='buddies']");
        await msg.waitForSelector("[data-testid='add-im-account']");
        check((await msg.locator("[data-testid='im-network']").count()) >= 3, "Buddies lists the networks Phoenix cannot reach as unavailable");
        await shot(msg, "messaging-buddies-none");

        // Swipe a conversation across: Delete takes it and its messages.
        await msg.click("[data-testid='msg-tabs'] [data-value='conversations']");
        await msg.waitForSelector("[data-testid='thread-row']");
        const before = await msg.locator("[data-testid='thread-row']").count();
        const gone = await msg.textContent("[data-testid='thread-row'] .thread-summary");
        const box = await msg.locator("[data-testid='thread-swipe']").first().boundingBox();
        await msg.mouse.move(box.x + 20, box.y + box.height / 2);   // on the contact's photo
        await msg.mouse.down();
        await msg.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 5 });
        await msg.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
        await msg.mouse.up();
        await msg.waitForSelector("[data-testid='thread-swipe-delete']");
        await shot(msg, "messaging-swipe-delete");
        await msg.click("[data-testid='thread-swipe-delete']");
        await msg.waitForFunction((n) => document.querySelectorAll("[data-testid='thread-row']").length === n - 1, before, { timeout: 4000 });
        const left = await msg.locator("[data-testid='thread-row'] .thread-summary").allTextContents();
        check(!left.includes(gone), `a conversation swiped across and deleted goes ("${gone}")`);

        // ---- Open in New Card ----------------------------------------------------------------------------------
        // A conversation held (a long press) or right-clicked: Open, Open in
        // New Card, Delete. Open in New Card launches another card of
        // Messaging ({newCard: true}) with {threadId}, the param a message's
        // notification opens the conversation with; that card shows the
        // conversation alone, Back goes to its list.
        const first = msg.locator("[data-testid='thread-row']").first();
        const firstId = await first.getAttribute("data-thread");
        const firstName = (await first.locator(".thread-name").textContent()).trim();
        const wasSelected = /\bselected\b/.test(await first.getAttribute("class"));
        const rowBox = await first.boundingBox();
        await msg.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
        await msg.mouse.down();
        await msg.waitForSelector("[data-testid='thread-menu-newcard']", { timeout: 2000 });
        await msg.mouse.up();
        const menu = await msg.locator("[role='option']").allTextContents();
        check(menu.join(",") === "Open,Open in New Card,Delete", "a held conversation's menu: " + menu.join(", "));
        await shot(msg, "messaging-newcard-menu");
        await msg.waitForTimeout(300);
        check(/\bselected\b/.test(await first.getAttribute("class")) === wasSelected &&
              (tablet || await msg.locator("[data-testid='thread-title']").count() === 0), "the hold does not open the conversation");
        const sent = host.length;
        await msg.click("[data-testid='thread-menu-newcard']");
        for (let i = 0; i < 40 && !host.slice(sent).some((m) => m.type === "launch"); ++i) await msg.waitForTimeout(100);
        const launched = host.slice(sent).find((m) => m.type === "launch");
        check(!!launched && launched.payload.id === "org.webosphoenix.messaging" && launched.payload.newCard === true &&
              launched.payload.params.threadId === firstId, "Open in New Card: another card of Messaging on it: " + JSON.stringify(launched && launched.payload));
        const notified = host.find((m) => m.type === "notification" && m.payload.appId === "org.webosphoenix.messaging");
        check(!!notified && Object.keys(notified.payload.params).join() === "threadId", "the same launch param as a message's notification ({threadId})");
        // The new card (a cold launch with those params).
        const card = await context.newPage();
        watch(card, "second card");
        await card.goto(`${APPS}/org.webosphoenix.messaging/index.html?launchParams=` + encodeURIComponent(JSON.stringify(launched.payload.params)));
        await card.waitForSelector("[data-testid='thread-title']");
        check((await card.textContent("[data-testid='thread-title']")).includes(firstName), `the new card opens on the conversation (${firstName})`);
        await shot(card, "messaging-newcard-card");
        await card.keyboard.press("Escape");
        if (!tablet) {
            await card.waitForSelector("[data-testid='thread-row']");
            check(true, "Back in the new card: its list");
        }
        // A relaunch with another conversation's {threadId} goes there.
        const otherId = await card.locator("[data-testid='thread-row']").nth(1).getAttribute("data-thread");
        await card.evaluate((id) => document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { threadId: id } })), otherId);
        await card.waitForFunction((id) => document.querySelector("[data-testid='thread-row'].selected")?.dataset.thread === id ||
                                            !!document.querySelector("[data-testid='thread-title']"), otherId);
        check(await card.locator("[data-testid='thread-title']").count() === 1, "a relaunch with {threadId} opens that conversation");
        // Right-clicked: the same menu; the app menu offers it in a conversation.
        await msg.click("[data-testid='thread-row'] >> nth=1", { button: "right" });
        await msg.waitForSelector("[data-testid='thread-menu-open']");
        await msg.click("[data-testid='thread-menu-open']");
        await msg.waitForSelector("[data-testid='thread-title']");
        const sent2 = host.length;
        await msg.evaluate(() => window.__phoenixRuntime.openAppMenu());
        await msg.click(".pui-appmenu-item >> text=Open in New Card");
        for (let i = 0; i < 40 && !host.slice(sent2).some((m) => m.type === "launch"); ++i) await msg.waitForTimeout(100);
        const fromMenu = host.slice(sent2).find((m) => m.type === "launch");
        check(!!fromMenu && fromMenu.payload.newCard === true && fromMenu.payload.params.threadId === otherId,
              "the app menu's Open in New Card, in a conversation: " + JSON.stringify(fromMenu && fromMenu.payload));
        await card.close();

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
