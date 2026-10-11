#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Matrix account with Messaging, in headless Chromium with
// runtime/phoenix-runtime.js (docs/SYNERGY-MODERN.md 2.4). The connector
// (apps/connectors/matrix) is packed and installed as the Marketplace
// installs a package; the homeserver is the simulator's demo,
// matrix.example (the connector's fake homeserver):
//
//   1. Accounts shows the sign-in page: the Matrix ID finds the homeserver
//      (sliding sync), then the password; it says encrypted rooms cannot
//      be read here yet; Create Account;
//   2. Messaging: a direct chat with Sam, the encrypted one with Priya said
//      as such, the room "Phoenix Testers" with its people's names;
//   3. a message to Sam: sent, read (his receipt), his answer notified;
//      a picture to him and one back from him;
//   4. a message into Priya's encrypted room is not sent, and says why;
//   5. the account deleted: its conversations go.
//
//   node tools/test-matrix.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "matrix-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TEMPLATE = "com.webosphoenix.matrix";
const KIND = "com.palm.immessage.matrix:1";

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
                else if (process.env.MATRIX_VERBOSE) console.log("    [" + m.type() + "] " + t);
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
        const packed = pack(path.join(REPO, "apps/connectors/matrix"), outDir, { namespaces: ["org.webosphoenix", "com.webosphoenix"] });
        const ipkB64 = fs.readFileSync(packed.file).toString("base64");
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/matrix.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipkB64);
        await page.evaluate(() => { localStorage.setItem("phoenix:devMode", "true"); });
        const installed = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 30 || r.statusValue === 24) res(r); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "org.webosphoenix.matrix", ipkUrl: "/tmp/matrix.ipk", subscribe: true, developerMode: true }));
        }));
        if (!check(installed.statusValue === 30, "the Matrix connector installs")) throw new Error("not installed");
        await page.reload();
        await page.waitForFunction(() => !!window.__phoenixRuntime);

        // ---- 1. Sign in ------------------------------------------------------------------------------
        const accounts = await context.newPage();
        await accounts.goto(appUrl("com.palm.app.accounts", { templateId: TEMPLATE }));
        const signin = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.matrix\/accounts\/signin\.html/.test(f.url())), 15000);
        if (!check(!!signin, "Accounts opens the Matrix sign-in page")) throw new Error("no sign-in page");
        await signin.waitForSelector("#user");
        check(/can't be read or written from this device yet/.test(await signin.textContent("#privacy")), "it says encrypted rooms cannot be read here yet");
        await signin.fill("#user", "@me:matrix.example");
        await signin.click("#next");
        await signin.waitForSelector("#passwordBox:not(.hidden)", { timeout: 10000 });
        check(/matrix\.example \(sliding sync\)/.test(await signin.textContent("#server")), "the Matrix ID found the homeserver, which has sliding sync");
        await signin.fill("#password", "phoenix");
        await shot(accounts, "1-sign-in");
        await signin.click("#next");
        const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 20000 }).catch(() => {});
        check(await create.isVisible().catch(() => false), "signed in with the password: Accounts offers Create Account");
        await create.click();
        const account = await until(async () => (await luna(page, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results[0], 10000);
        if (!check(account && account.username === "@me:matrix.example", "the account exists")) throw new Error("no account");
        await accounts.close();

        // ---- 2. Rooms in Messaging ---------------------------------------------------------------------
        const msgs = await until(async () => { const m = await db(page, KIND); return m.length >= 4 ? m : null; }, 40000);
        check(!!msgs, "the first sync files the rooms' latest messages");
        const all = msgs || [];
        check(all.some((m) => m.messageText === "Welcome to Matrix on Phoenix!" && m.from.addr === "@sam.delgado:matrix.example"), "Sam's direct chat");
        check(all.some((m) => m.from && m.from.addr === "@priya:matrix.example" && /can't be read on this device yet/.test(m.messageText)), "Priya's encrypted chat, said as such");
        check(all.some((m) => m.chatType === "groupchat" && m.messageText === "Sam Delgado: Build 42 boots on the Pre 3."), "the room, with its people's names");
        await page.goto(appUrl("org.webosphoenix.messaging"));
        await page.waitForSelector("[data-testid='thread-row']");
        await page.waitForTimeout(600);
        await shot(page, "2-conversations");

        // ---- 3. A chat with Sam -------------------------------------------------------------------------
        const samThread = (await db(page, "com.palm.chatthread:1")).find((t) => t.replyAddress === "@sam.delgado:matrix.example");
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: samThread._id }));
        await page.waitForSelector("[data-testid='message-input']");
        check((await page.textContent("[data-testid='transport']")).startsWith("Matrix"), "the conversation goes by Matrix");
        await page.fill("[data-testid='message-input']", "Phoenix speaks Matrix now");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".bubble.out[data-service='type_matrix'][data-status='successful']", { timeout: 15000 });
        check(true, "sent");
        await page.waitForSelector(".bubble.in >> text=Nice, it works.", { timeout: 15000 });
        check(true, "Sam answers");
        const mine = (await db(page, KIND)).find((m) => m.messageText === "Phoenix speaks Matrix now");
        check(!!mine && mine.deliveryStatus === "read", "his read receipt marks it read");
        // A picture to him, and one back.
        await luna(page, "luna://org.webosports.service.messaging/putMessage", { message: {
            _kind: KIND, folder: "outbox", status: "pending", serviceName: "type_matrix", username: "@me:matrix.example", messageText: "",
            parts: [{ path: "/media/internal/samples/photos/aurora.jpg", mimeType: "image/jpeg", name: "aurora.jpg" }],
            to: [{ addr: "@sam.delgado:matrix.example", name: "Sam Delgado" }], localTimestamp: Date.now(), timestamp: Date.now(),
            flags: { read: true, visible: true }, conversations: [samThread._id] } });
        check(!!(await until(async () => (await db(page, KIND)).find((m) => m.parts && m.folder === "outbox" && m.status === "successful"), 15000)),
              "a picture goes up (media upload) and is sent");
        const back = await page.evaluate(() => __phoenixRuntime.connectorDemo("org.webosphoenix.service.matrix", { op: "deliver", from: "@sam.delgado:matrix.example", picture: true }));
        const got = await until(async () => (await db(page, KIND)).find((m) => m.parts && m.folder === "inbox"), 15000);
        check(!!back.returnValue && !!got, "and one sent back is fetched (authenticated media) and kept");
        await page.waitForTimeout(800);
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: samThread._id }));
        await page.waitForSelector("[data-testid='message-picture'] img", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, "3-chat");

        // ---- 4. The encrypted room -------------------------------------------------------------------------
        const priyaThread = (await db(page, "com.palm.chatthread:1")).find((t) => t.replyAddress === "@priya:matrix.example");
        await page.goto(appUrl("org.webosphoenix.messaging", { threadId: priyaThread._id }));
        await page.waitForSelector("[data-testid='message-input']");
        await page.fill("[data-testid='message-input']", "Can you read this?");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".bubble.out[data-status='permanent-fail']", { timeout: 25000 });
        const refused = (await db(page, KIND)).find((m) => m.messageText === "Can you read this?");
        check(!!refused && /end-to-end encrypted/.test(refused.errorText || ""), "a message into the encrypted room is not sent, and says why");
        await page.waitForTimeout(500);
        await shot(page, "4-encrypted");

        // ---- 5. Deleted -------------------------------------------------------------------------------------
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
