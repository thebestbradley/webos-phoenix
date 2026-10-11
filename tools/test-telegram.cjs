#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Unofficial Telegram account with Messaging, in headless Chromium with
// runtime/phoenix-runtime.js (docs/SYNERGY-CONNECTORS.md 7). The connector
// (apps/telegram) comes with Phoenix (preinstalled.json); TDLib is the
// simulator's stand-in (the connector's fake tdjson):
//
//   1. without a Telegram app id (this checkout's runtime/connector-settings/
//      has none): Accounts' sign-in page says it is not available in this build;
//   2. with a test app id (written there for the test, and removed): the
//      phone number, the code (the demo's 12345), Create Account; it says
//      what Telegram's servers can read, and that it is not Telegram's app;
//   3. Messaging: Sam's and Priya's chats, the group, not the channel;
//   4. a message to Sam: sent, read, his answer; a picture to him and back;
//   5. the account deleted: its conversations go.
//
//   node tools/test-telegram.cjs [--tablet] [--out DIR]

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
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "telegram-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TEMPLATE = "com.webosphoenix.telegram";
const KIND = "com.palm.immessage.telegram:1";
const SETTINGS = path.join(REPO, "runtime/connector-settings/org.webosphoenix.service.telegram.json");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
async function until(fn, ms, step) {
    for (let t = 0; t < (ms || 10000); t += step || 250) {
        const v = await fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, step || 250));
    }
    return null;
}

async function main() {
    for (const f of ["apps/messaging/dist/index.html", "apps/shared/connector-kit/lib/index.js"]) {
        if (!fs.existsSync(path.join(REPO, f))) {
            console.error(f + " is missing: cd apps && npm ci && npm run build");
            process.exit(2);
        }
    }
    // A checkout with its own app id for the simulator: kept, and step 1 skipped.
    const ownSettings = fs.existsSync(SETTINGS);
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const appUrl = (id, params, file) => `${origin}/usr/palm/applications/${id}/${file || "index.html"}` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser, wroteSettings = false;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 10000, 100);
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        context.on("page", (p) => {
            p.on("pageerror", (e) => errors.push(p.url().replace(/\?.*$/, "").replace(/^.*\/applications\//, "") + ": " + e.message));
            p.on("console", (m) => { if (process.env.TELEGRAM_VERBOSE) console.log("    [" + m.type() + "] " + m.text()); });
        });
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const db = (p, kind) => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.db/obj/"))
            .map((x) => JSON.parse(localStorage.getItem(x))).filter((o) => !o._del && o._kind === k), kind);
        const signInPage = async (accounts) => {
            await accounts.goto(appUrl("com.palm.app.accounts", { templateId: TEMPLATE }));
            return until(() => accounts.frames().find((f) => /org\.webosphoenix\.telegram\/accounts\/signin\.html/.test(f.url())), 15000);
        };

        const page = await context.newPage();
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const apps = await (await fetch(origin + "/apps.json")).json();
        check(JSON.stringify(apps).indexOf("org.webosphoenix.telegram") >= 0, "Unofficial Telegram comes with Phoenix");

        // ---- 1. Not in this build ------------------------------------------------------------------
        if (!ownSettings) {
            const accounts = await context.newPage();
            const signin = await signInPage(accounts);
            if (!check(!!signin, "Accounts opens the Unofficial Telegram sign-in page")) throw new Error("no sign-in page");
            await signin.waitForSelector("#unavailable:not(.hidden)", { timeout: 10000 });
            check(/not available in this build: it was built without a Telegram app id/.test(await signin.textContent("#unavailable")),
                  "without an app id it says it is not available in this build");
            check(!(await signin.isVisible("#phone")), "and asks for nothing");
            await accounts.waitForTimeout(1000);
            await shot(accounts, "1-not-available");
            await accounts.close();
        }

        // ---- 2. Sign in (a test app id, the demo's TDLib) --------------------------------------------
        if (!ownSettings) {
            fs.writeFileSync(SETTINGS, JSON.stringify({ apiId: 1, apiHash: "simulator-demo-not-a-telegram-app" }) + "\n");
            wroteSettings = true;
        }
        const accounts = await context.newPage();
        const signin = await signInPage(accounts);
        if (!check(!!signin, "with an app id, the sign-in page asks for the phone number")) throw new Error("no sign-in page");
        await signin.waitForSelector("#phone:visible", { timeout: 10000 });
        check(/Not end-to-end encrypted, but in secret chats/.test(await signin.textContent("#privacy")), "it says what Telegram's servers can read");
        check(/not made or endorsed by Telegram/.test(await signin.textContent("body")), "and that it is not Telegram's app");
        await signin.fill("#phone", "+1 555 0100");
        await signin.click("#next");
        await signin.waitForSelector("#code:visible", { timeout: 15000 });
        check(/Telegram app on another device/.test(await signin.textContent("#codeHint")), "the code: sent to the other Telegram app");
        await signin.fill("#code", "99999");
        await signin.click("#next");
        await signin.waitForFunction(() => /not right/.test(document.getElementById("error").textContent), null, { timeout: 10000 }).catch(() => {});
        check(/not right/.test(await signin.textContent("#error")), "a wrong code is said so");
        await signin.fill("#code", "12345");
        await shot(accounts, "2-sign-in");
        await signin.click("#next");
        const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 20000 }).catch(() => {});
        check(await create.isVisible().catch(() => false), "signed in: Accounts offers Create Account");
        await create.click();
        const account = await until(async () => (await luna(page, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results[0], 10000);
        if (!check(account && account.username === "+15550100", "the account exists, by its phone number")) throw new Error("no account");
        await accounts.close();

        // ---- 3. Chats in Messaging ---------------------------------------------------------------------
        const msgs = await until(async () => { const m = await db(page, KIND); return m.length >= 4 ? m : null; }, 40000);
        check(!!msgs, "the first sync files the chats' latest messages");
        const all = msgs || [];
        check(all.some((m) => m.messageText === "Welcome to Telegram on Phoenix!" && m.from.addr === "+15550101"), "Sam's chat, by his phone number");
        check(all.some((m) => m.from && m.from.addr === "+15550102"), "Priya's chat");
        check(all.some((m) => m.chatType === "groupchat" && m.messageText === "Sam Delgado: Build 42 boots on the Pre 3."), "the group, with its people's names");
        check(!all.some((m) => /channel/.test(m.messageText)), "not the channel");
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForSelector("[data-testid='thread-row']");
        await page.waitForTimeout(600);
        await shot(page, "3-conversations");

        // ---- 4. A chat with Sam -------------------------------------------------------------------------
        const samThread = (await db(page, "com.palm.chatthread:1")).find((t) => t.replyAddress === "+15550101");
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: samThread._id }));
        await page.waitForSelector("[data-testid='message-input']");
        check((await page.textContent("[data-testid='transport']")).startsWith("Telegram"), "the conversation goes by Telegram (\"Unofficial\" shortened in the picker)");
        check(/Not end-to-end encrypted/.test((await page.textContent("[data-testid='not-private']").catch(() => "")) || ""), "the chat says it is not private");
        await page.fill("[data-testid='message-input']", "Phoenix speaks Telegram now");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".bubble.out[data-service='type_telegram'][data-status='successful']", { timeout: 15000 });
        check(true, "sent");
        await page.waitForSelector(".bubble.in >> text=Got it, from a Pre!", { timeout: 20000 });
        check(true, "Sam answers");
        const mine = (await db(page, KIND)).find((m) => m.messageText === "Phoenix speaks Telegram now");
        check(!!mine && mine.deliveryStatus === "read" && /^7000001:\d+$/.test(mine.serviceMessageId), "his reading marks it read; it has the server's id");
        await luna(page, "luna://org.webosports.service.messaging/putMessage", { message: {
            _kind: KIND, folder: "outbox", status: "pending", serviceName: "type_telegram", username: "+15550100", messageText: "",
            parts: [{ path: "/media/internal/samples/photos/aurora.jpg", mimeType: "image/jpeg", name: "aurora.jpg" }],
            to: [{ addr: "+15550101", name: "Sam Delgado" }], localTimestamp: Date.now(), timestamp: Date.now(),
            flags: { read: true, visible: true }, conversations: [samThread._id] } });
        check(!!(await until(async () => (await db(page, KIND)).find((m) => m.parts && m.folder === "outbox" && m.status === "successful"), 15000)),
              "a picture is sent");
        const back = await page.evaluate(() => __phoenixRuntime.connectorDemo("org.webosphoenix.service.telegram", { op: "deliver", from: "+15550101", picture: true }));
        const got = await until(async () => (await db(page, KIND)).find((m) => m.parts && m.folder === "inbox"), 15000);
        check(!!back.returnValue && !!got, "and one sent back is downloaded and kept");
        await page.waitForTimeout(800);
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: samThread._id }));
        await page.waitForSelector("[data-testid='message-picture'] img", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, "4-chat");

        // ---- 5. Deleted -------------------------------------------------------------------------------------
        await luna(page, "luna://com.palm.service.accounts/deleteAccount", { accountId: account._id });
        check(!!(await until(async () => (await db(page, KIND)).length === 0, 15000)), "the account deleted: its messages go");
        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (wroteSettings) fs.rmSync(SETTINGS, { force: true });
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed; screenshots in ${outDir}` : `\nall checks passed; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
