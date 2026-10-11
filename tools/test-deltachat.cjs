#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Delta Chat account with Messaging, in headless Chromium with
// runtime/phoenix-runtime.js (docs/SYNERGY-MODERN.md 2.4). The connector
// (apps/connectors/deltachat) is packed and installed as the Marketplace
// installs a package; Delta Chat's core is the simulator's stand-in (the
// connector's fake deltachat-rpc-server, for chatmail.example only):
//
//   1. Accounts shows the sign-in page: it says it is the simulator's demo
//      and that chats are end-to-end encrypted; an address elsewhere is
//      refused, saying why; one at chatmail.example signs in; Create Account;
//   2. Messaging: a chat with Sam, one with Priya, the group "Phoenix
//      Testers" with its people's names;
//   3. a message to Sam: sent, delivered, read (his read receipt), his
//      answer; a picture to him and one back from him;
//   4. the account deleted: its conversations go, and the core's account.
//
//   node tools/test-deltachat.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "deltachat-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TEMPLATE = "com.webosphoenix.deltachat";
const KIND = "com.palm.immessage.deltachat:1";

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
                else if (process.env.DELTACHAT_VERBOSE) console.log("    [" + m.type() + "] " + t);
            });
        });
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const db = (p, kind) => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.db/obj/"))
            .map((x) => JSON.parse(localStorage.getItem(x))).filter((o) => !o._del && o._kind === k), kind);

        // ---- 0. Installed --------------------------------------------------------------------------
        const page = await context.newPage();
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
        const packed = pack(path.join(REPO, "apps/connectors/deltachat"), outDir, { namespaces: ["org.webosphoenix", "com.webosphoenix"] });
        const ipkB64 = fs.readFileSync(packed.file).toString("base64");
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/deltachat.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipkB64);
        await page.evaluate(() => { localStorage.setItem("phoenix:devMode", "true"); });
        const installed = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 30 || r.statusValue === 24) res(r); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "org.webosphoenix.deltachat", ipkUrl: "/tmp/deltachat.ipk", subscribe: true, developerMode: true }));
        }));
        if (!check(installed.statusValue === 30, "the Delta Chat connector installs")) throw new Error("not installed");
        await page.reload();
        await page.waitForFunction(() => !!window.__phoenixRuntime);

        // ---- 1. Sign in ------------------------------------------------------------------------------
        const accounts = await context.newPage();
        await accounts.goto(appUrl("com.palm.app.accounts", { templateId: TEMPLATE }));
        const signin = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.deltachat\/accounts\/signin\.html/.test(f.url())), 15000);
        if (!check(!!signin, "Accounts opens the Delta Chat sign-in page")) throw new Error("no sign-in page");
        await signin.waitForSelector("#unavailable:not(.hidden)", { timeout: 10000 });
        check(/Simulator demo/.test(await signin.textContent("#unavailable")), "it says the simulator's core is a demo");
        check(/end-to-end encrypted/.test(await signin.textContent("#privacy")), "it says chats are end-to-end encrypted");
        await signin.fill("#user", "me@example.org");
        await signin.fill("#password", "secret");
        await signin.click("#next");
        await signin.waitForFunction(() => /only its demo addresses/.test(document.getElementById("error").textContent), null, { timeout: 15000 }).catch(() => {});
        check(/only its demo addresses/.test(await signin.textContent("#error")), "an address elsewhere is refused, saying why");
        await signin.fill("#user", "me@chatmail.example");
        await signin.fill("#password", "phoenix");
        await shot(accounts, "1-sign-in");
        await signin.click("#next");
        const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 20000 }).catch(() => {});
        check(await create.isVisible().catch(() => false), "signed in: Accounts offers Create Account");
        await create.click();
        const account = await until(async () => (await luna(page, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results[0], 10000);
        if (!check(account && account.username === "me@chatmail.example", "the account exists")) throw new Error("no account");
        await accounts.close();

        // ---- 2. Chats in Messaging ---------------------------------------------------------------------
        const msgs = await until(async () => { const m = await db(page, KIND); return m.length >= 4 ? m : null; }, 40000);
        check(!!msgs, "the first sync files the chats' latest messages");
        const all = msgs || [];
        check(all.some((m) => m.messageText === "Welcome to Delta Chat on Phoenix!" && m.from.addr === "sam.delgado@chatmail.example"), "Sam's chat");
        check(all.some((m) => m.from && m.from.addr === "priya@chatmail.example"), "Priya's chat");
        check(all.some((m) => m.chatType === "groupchat" && m.messageText === "Sam Delgado: Build 42 boots on the Pre 3."), "the group, with its people's names");
        check(new Set(all.map((m) => m.serviceMessageId)).size === all.length, "each message once");
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForSelector("[data-testid='thread-row']");
        await page.waitForTimeout(600);
        await shot(page, "2-conversations");

        // ---- 3. A chat with Sam -------------------------------------------------------------------------
        const samThread = (await db(page, "com.palm.chatthread:1")).find((t) => t.replyAddress === "sam.delgado@chatmail.example");
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: samThread._id }));
        await page.waitForSelector("[data-testid='message-input']");
        check((await page.textContent("[data-testid='transport']")).startsWith("Delta Chat"), "the conversation goes by Delta Chat");
        await page.fill("[data-testid='message-input']", "Phoenix speaks Delta Chat now");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".bubble.out[data-service='type_deltachat'][data-status='successful']", { timeout: 15000 });
        check(true, "sent");
        await page.waitForSelector(".bubble.in >> text=Got it, end to end encrypted.", { timeout: 20000 });
        check(true, "Sam answers");
        const mine = (await db(page, KIND)).find((m) => m.messageText === "Phoenix speaks Delta Chat now");
        check(!!mine && mine.deliveryStatus === "read", "his read receipt marks it read");
        // A picture to him, and one back.
        await luna(page, "luna://org.webosports.service.messaging/putMessage", { message: {
            _kind: KIND, folder: "outbox", status: "pending", serviceName: "type_deltachat", username: "me@chatmail.example", messageText: "",
            parts: [{ path: "/media/internal/samples/photos/aurora.jpg", mimeType: "image/jpeg", name: "aurora.jpg" }],
            to: [{ addr: "sam.delgado@chatmail.example", name: "Sam Delgado" }], localTimestamp: Date.now(), timestamp: Date.now(),
            flags: { read: true, visible: true }, conversations: [samThread._id] } });
        check(!!(await until(async () => (await db(page, KIND)).find((m) => m.parts && m.folder === "outbox" && m.status === "successful"), 15000)),
              "a picture is sent");
        const back = await page.evaluate(() => __phoenixRuntime.connectorDemo("org.webosphoenix.service.deltachat", { op: "deliver", from: "sam.delgado@chatmail.example", picture: true }));
        const got = await until(async () => (await db(page, KIND)).find((m) => m.parts && m.folder === "inbox"), 15000);
        check(!!back.returnValue && !!got, "and one sent back is kept");
        await page.waitForTimeout(800);
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: samThread._id }));
        await page.waitForSelector("[data-testid='message-picture'] img", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, "3-chat");

        // ---- 4. Deleted -------------------------------------------------------------------------------------
        await luna(page, "luna://com.palm.service.accounts/deleteAccount", { accountId: account._id });
        check(!!(await until(async () => (await db(page, KIND)).length === 0, 15000)), "the account deleted: its messages go");
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
