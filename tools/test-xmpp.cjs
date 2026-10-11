#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Jabber (XMPP) account with Messaging, in headless Chromium with
// runtime/phoenix-runtime.js (docs/SYNERGY-CONNECTORS.md 7). The connector
// (apps/connectors/xmpp) is packed by phoenix-connector and installed as
// the Marketplace installs a package; the server is the simulator's demo
// server, chat.example (the connector's fake XMPP server, reached over a
// WebSocket as any server without TCP is):
//
//   1. Accounts shows the account's sign-in page (privacy note, sign-up
//      links); the Jabber ID and password sign in; Create Account;
//   2. the roster: Messaging's Buddies lists them by presence; their
//      contacts are linked to the address book's people;
//   3. a chat with Ada: sent (the server's acknowledgement), delivered, read,
//      her answer with a notification; a message from Lena while the
//      conversation is closed is unread;
//   4. a picture sent (HTTP upload) and one received;
//   5. a buddy's presence changes; your own status Busy, then Offline
//      (signed out: buddies offline, a message fails);
//   6. the account deleted: its conversations go.
//
//   node tools/test-xmpp.cjs [--tablet] [--out DIR]
//
// Needs Playwright, the apps built (cd apps && npm run build) and the
// connector kit built (its lib/).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "xmpp-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TEMPLATE = "com.webosphoenix.xmpp";
const SERVICE = "org.webosphoenix.service.xmpp";
const APP = "org.webosphoenix.xmpp";

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
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const appUrl = (id, params, file) => `${origin}/usr/palm/applications/${id}/${file || "index.html"}` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 10000, 100);
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [], host = [];
        context.on("page", (p) => {
            p.on("pageerror", (e) => errors.push(p.url().replace(/\?.*$/, "").replace(/^.*\/applications\//, "") + ": " + e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                else if (process.env.XMPP_VERBOSE) console.log("    [" + m.type() + "] " + t);
            });
        });
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const db = (p, kind, temp) => p.evaluate(([k, t]) => Object.keys(localStorage)
            .filter((x) => x.startsWith(t ? "phoenix:db8:com.palm.tempdb/obj/" : "phoenix:db8:com.palm.db/obj/"))
            .map((x) => JSON.parse(localStorage.getItem(x))).filter((o) => !o._del && (o._kind === k)), [kind, !!temp]);

        // ---- 0. The connector installed --------------------------------------------------------------
        const page = await context.newPage();
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
        const packed = pack(path.join(REPO, "apps/connectors/xmpp"), outDir, { namespaces: ["org.webosphoenix", "com.webosphoenix"] });
        const ipkB64 = fs.readFileSync(packed.file).toString("base64");
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/xmpp.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipkB64);
        // As the Marketplace installs it: Developer Mode here (the first-party
        // path through the Marketplace's catalog is tools/test-marketplace.cjs').
        await page.evaluate(() => { localStorage.setItem("phoenix:devMode", "true"); });
        const installed = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 30 || r.statusValue === 24) res(r); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "org.webosphoenix.xmpp", ipkUrl: "/tmp/xmpp.ipk", subscribe: true, developerMode: true }));
        }));
        if (!check(installed.statusValue === 30, "the Jabber connector installs (" + (installed.details && installed.details.reason || "") + ")")) throw new Error("not installed");
        await page.reload();
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const tmpl = (await luna(page, "luna://com.palm.service.accounts/listAccountTemplates", { capability: "MESSAGING" })).results || [];
        check(tmpl.some((t) => t.templateId === TEMPLATE && t.loc_name === "Jabber (XMPP)"), "Accounts has the Jabber (XMPP) template");

        // ---- 1. Sign in --------------------------------------------------------------------------------
        const accounts = await context.newPage();
        await accounts.goto(appUrl("com.palm.app.accounts", { templateId: TEMPLATE }));
        const signin = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.xmpp\/accounts\/signin\.html/.test(f.url())), 15000);
        if (!check(!!signin, "Accounts opens the Jabber sign-in page")) throw new Error("no sign-in page");
        await signin.waitForSelector("#jid");
        check(/not end to end/.test(await signin.textContent("#privacy")), "it says the messages are not end-to-end encrypted");
        check(/Choose a server/.test(await signin.textContent("#signup")) && /Snikket/.test(await signin.textContent("#signup")),
              "and where to get an account (a list of servers, Snikket)");
        await signin.fill("#jid", "me@chat.example");
        await signin.fill("#password", "phoenix");
        await accounts.waitForTimeout(300);
        await shot(accounts, "1-sign-in");
        await signin.click("#signin");
        const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 20000 }).catch(() => {});
        check(await create.isVisible().catch(() => false), "signed in (TLS WebSocket, SASL, a resource bound): Accounts offers Create Account");
        await accounts.waitForTimeout(500);
        await shot(accounts, "2-capabilities");
        await create.click();
        const account = await until(async () => (await luna(page, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results[0], 10000);
        if (!check(account && account.username === "me@chat.example" && account.capabilityProviders.length === 2,
                   "the account exists, with Buddies in Contacts and Instant Messaging")) throw new Error("no account");
        const creds = await luna(page, "luna://com.palm.service.accounts/readCredentials", { accountId: account._id, name: "common" });
        check(creds.credentials && creds.credentials.password === "phoenix", "its password is in the account's credentials, as the original transports kept it");
        await accounts.close();

        // ---- 2. Roster and presence -------------------------------------------------------------------
        const online = await until(async () => (await db(page, "com.palm.imloginstate.xmpp:1")).find((s) => s.state === "online"), 30000);
        check(!!online && online.username === "me@chat.example" && online.serviceName === "type_jabber", "signed in: the account's login state is online");
        const contacts = await until(async () => { const c = await db(page, "com.palm.contact.xmpp:1"); return c.length >= 4 ? c : null; }, 15000);
        check(!!contacts && contacts.some((c) => c.ims[0].value === "ada.palmer@chat.example" && c.nickname === "Ada Palmer"), "the roster is in Contacts");
        const ada = (contacts || []).find((c) => c.remoteId === "ada.palmer@chat.example");
        const person = (await db(page, "com.palm.person:1")).find((p) => (p.contactIds || []).includes(ada && ada._id));
        check(!!person && person.contactIds.length >= 2, "Ada's buddy contact is linked to the address book's Ada Palmer");
        const buddies = await until(async () => { const b = await db(page, "com.palm.imbuddystatus.xmpp:1", true); return b.length >= 4 && b.some((x) => x.availability === 2) ? b : null; }, 15000);
        check(!!buddies, "the buddies' presence is in tempdb (com.palm.imbuddystatus.xmpp:1)");
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForSelector("[data-testid='msg-tabs']");
        await page.click("[data-testid='msg-tabs'] [data-value='buddies']");
        await page.waitForSelector("[data-testid='buddy']", { timeout: 10000 });
        await page.waitForTimeout(500);
        const groups = await page.$$eval("[data-testid^='buddy-group-']",
            (els) => els.map((e) => e.getAttribute("data-testid").slice(12) + ":" + e.querySelectorAll("[data-testid='buddy']").length));
        check(groups.join(",") === "available:2,busy:1,offline:1", "Buddies lists them by presence: " + groups.join(","));
        await shot(page, "3-buddies");

        // ---- 3. A chat ---------------------------------------------------------------------------------
        await page.click("[data-testid='buddy-group-available'] [data-testid='buddy'] >> text=Ada Palmer");
        await page.waitForSelector("[data-testid='recipient-chip']");
        check((await page.textContent("[data-testid='transport']")).startsWith("Jabber"), "a message to a buddy goes by Jabber");
        check((await page.locator("[data-testid='attach']").count()) === 1, "and can take a picture");
        await page.fill("[data-testid='message-input']", "Running Phoenix on the Pre 3?");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".bubble.out[data-service='type_jabber'][data-status='successful']", { timeout: 10000 });
        check(true, "sent: the server acknowledged it (stream management)");
        await page.waitForSelector(".bubble.in[data-service='type_jabber'] >> text=Ha, yes!", { timeout: 10000 });
        check(true, "Ada answers");
        check(!!(await until(() => host.some((m) => /Ada Palmer/.test(JSON.stringify(m.payload)) && /Ha, yes!/.test(JSON.stringify(m.payload))), 5000)),
              "with a notification");
        const sentMsg = (await db(page, "com.palm.immessage.xmpp:1")).find((m) => m.messageText === "Running Phoenix on the Pre 3?");
        check(!!sentMsg && sentMsg.deliveryStatus === "read", "her client marked it delivered, then read (" + (sentMsg && sentMsg.deliveryStatus) + ")");
        await page.waitForTimeout(400);
        await shot(page, "4-chat");
        await page.keyboard.press("Escape");
        if (!tablet) await page.waitForSelector("[data-testid='msg-tabs']");
        await page.click("[data-testid='msg-tabs'] [data-value='conversations']");
        const threadId = await page.evaluate(() => __phoenixRuntime.simulateIncomingIm({ from: "lena.okafor@chat.example", text: "Hi! Just landed." }));
        check(!!threadId, "the demo server delivers a message from Lena");
        await page.waitForFunction(() => /Hi! Just landed\./.test(document.querySelector("[data-testid='thread-row']")?.textContent || ""), null, { timeout: 8000 });
        check((await page.textContent("[data-testid='thread-row'] .thread-unread")) === "1", "listed, unread");
        await shot(page, "5-conversations");

        // ---- 4. Pictures --------------------------------------------------------------------------------
        const adaThread = (await db(page, "com.palm.chatthread:1")).find((t) => t.replyAddress === "ada.palmer@chat.example");
        const photo = "/media/internal/samples/photos/harbor-dusk.jpg";
        await luna(page, "luna://org.webosports.service.messaging/putMessage", { message: {
            _kind: "com.palm.immessage.xmpp:1", folder: "outbox", status: "pending", serviceName: "type_jabber", username: "me@chat.example",
            messageText: "", parts: [{ path: photo, mimeType: "image/jpeg", name: "harbor-dusk.jpg" }],
            to: [{ addr: "ada.palmer@chat.example", name: "Ada Palmer" }], localTimestamp: Date.now(), timestamp: Date.now(),
            flags: { read: true, visible: true }, conversations: [adaThread._id] } });
        const pic = await until(async () => (await db(page, "com.palm.immessage.xmpp:1")).find((m) => m.parts && m.folder === "outbox" && m.status === "successful"), 10000);
        check(!!pic, "a picture goes up by HTTP upload and is sent as its link");
        // Ada sends it back: its link fetched, kept as a file of the device, a part of the message.
        const back = await page.evaluate(() => __phoenixRuntime.connectorDemo("org.webosphoenix.service.xmpp", { op: "deliver", from: "ada.palmer@chat.example", picture: true }));
        const got = await until(async () => (await db(page, "com.palm.immessage.xmpp:1")).find((m) => m.parts && m.folder === "inbox"), 10000);
        check(!!back.returnValue && !!got && /^\/media\/internal\/\.phoenix\/connector-files\/org\.webosphoenix\.service\.xmpp\/.+harbor-dusk\.jpg$/.test(got.parts[0].path),
              "a picture sent to the account is fetched and kept (" + (got ? got.parts[0].path : back.errorText) + ")");
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: adaThread._id }));
        await page.waitForFunction(() => document.querySelectorAll("[data-testid='message-picture'] img").length >= 2, null, { timeout: 8000 });
        await page.waitForTimeout(600);
        await shot(page, "6-pictures");

        // ---- 5. Presence ---------------------------------------------------------------------------------
        await page.evaluate(() => __phoenixRuntime.xmpp.setBuddyPresence("ada.palmer@chat.example", 2, "Lunch"));
        check(!!(await until(async () => (await db(page, "com.palm.imbuddystatus.xmpp:1", true)).find((b) => b.username === "ada.palmer@chat.example" && b.availability === 2 && b.status === "Lunch"), 8000)),
              "Ada goes away: her buddy record follows");
        await luna(page, "luna://" + SERVICE + "/setPresence", { accountId: account._id, availability: 2, customMessage: "Flashing" });
        check(!!(await until(async () => (await db(page, "com.palm.imloginstate.xmpp:1")).find((s) => s.availability === 2 && s.customMessage === "Flashing" && s.state === "online"), 8000)),
              "your status Busy, with a message");
        await luna(page, "luna://" + SERVICE + "/setPresence", { accountId: account._id, availability: 4 });
        check(!!(await until(async () => (await db(page, "com.palm.imloginstate.xmpp:1")).find((s) => s.state === "offline"), 8000)), "Offline signs out");
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForSelector("[data-testid='msg-tabs']");
        await page.click("[data-testid='msg-tabs'] [data-value='buddies']");
        await page.waitForTimeout(800);
        await shot(page, "7-offline");
        await luna(page, "luna://" + SERVICE + "/setPresence", { accountId: account._id, availability: 0 });
        check(!!(await until(async () => (await db(page, "com.palm.imloginstate.xmpp:1")).find((s) => s.state === "online"), 10000)), "Available signs in again");

        // ---- 6. Deleted -------------------------------------------------------------------------------
        await luna(page, "luna://com.palm.service.accounts/deleteAccount", { accountId: account._id });
        check(!!(await until(async () => (await db(page, "com.palm.immessage.xmpp:1")).length === 0 && (await db(page, "com.palm.contact.xmpp:1")).length === 0, 10000)),
              "the account deleted: its messages and contacts go");
        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed; screenshots in ${outDir}` : `\nall checks passed; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
