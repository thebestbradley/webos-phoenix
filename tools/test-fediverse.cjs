#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Fediverse account end to end, without the internet (docs/SYNERGY-CONNECTORS.md
// phase C2), in headless Chromium with runtime/phoenix-runtime.js against
// a fake Mastodon server (apps/fediverse/service/test/fake-mastodon.cjs)
// and the real Marketplace catalog (server/marketplace, PHP):
//   1. the Marketplace's Connections lists the Fediverse (featured); its
//      page's Set up opens Accounts at the template;
//   2. Accounts shows the account's sign-in page; the handle
//      (@phoenix@127.0.0.1:<port>) finds the server; the system's sign-in
//      sheet shows the server's own page, where "Authorize" is pressed; the
//      sheet closes on the redirect; Accounts offers Create Account; the
//      token is in the key store, not in the account's credentials;
//   3. the first sync: the people you follow are contacts, Sofia Lindqvist
//      linked to the sample address book's Sofia, with her avatar, profile
//      link and latest post; Contacts shows her;
//   4. a direct mention arrives in Messaging (a thread labelled not
//      private, a notification); a public mention is a notification;
//   5. the browser's page is shared to the account through the share
//      sheet; the post (unlisted) is on the server; then a photo with its
//      description;
//   6. Developer Mode: the hello-world FEEDS connector, packed by
//      phoenix-connector, installs only in Developer Mode and syncs a feed.
//
//   node tools/test-fediverse.cjs [--tablet] [--out DIR]
//
// Needs Playwright, PHP 8 (sodium, pdo_sqlite), the apps built
// (cd apps && npm run build), and the connector kit built (its lib/).

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
const { createFakeMastodon } = require(path.join(REPO, "apps/fediverse/service/test/fake-mastodon.cjs"));
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "fediverse-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TEMPLATE = "com.webosphoenix.fediverse";
const SERVICE = "org.webosphoenix.service.fediverse";

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
    for (const f of ["apps/messaging/dist/index.html", "apps/sharesheet/dist/index.html", "apps/marketplace/dist/index.html", "apps/shared/connector-kit/lib/index.js"]) {
        if (!fs.existsSync(path.join(REPO, f))) {
            console.error(f + " is missing: cd apps && npm ci && npm run build");
            process.exit(2);
        }
    }
    if (!servers.phpAvailable()) {
        console.error("PHP 8 with sodium and pdo_sqlite is needed");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const mastodon = await createFakeMastodon().start(0);
    const catalog = await servers.startCatalog({ curated: [] });
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
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(p.url().replace(/\?.*$/, "").replace(/^.*\/applications\//, "") + ": " + e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                if (process.env.FEDI_VERBOSE && !t.startsWith("__phoenix__")) console.log("    [" + m.type() + "] " + t);
            });
        };
        context.on("page", watch);
        const page = await context.newPage();
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const db = (p, kind) => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.db/obj/"))
            .map((x) => JSON.parse(localStorage.getItem(x))).filter((o) => !o._del && o._kind === k), kind);
        const syncNow = async (p, accountId) => {
            await luna(p, "palm://com.palm.activitymanager/create", { start: true, replace: true, activity: {
                name: "Sync now", type: { userInitiated: true, foreground: true },
                callback: { method: "palm://" + SERVICE + "/sync", params: { accountId } } } });
            await p.waitForTimeout(300);
            await until(() => p.evaluate((a) => !JSON.parse(localStorage.getItem("phoenix:connector:syncLock:org.webosphoenix.service.fediverse:" + a) || "0"), accountId), 30000);
        };

        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.waitForFunction(() => !!window.__phoenixRuntime);

        // ---- 1. Connections in the Marketplace ---------------------------------------------------------
        const pkgs = "luna://org.webosphoenix.service.packages/";
        const added = await luna(page, pkgs + "addSource", { url: catalog.catalogUrl });
        await luna(page, pkgs + "trustSource", { url: catalog.catalogUrl, key: added.pending && added.pending.key, name: "Test catalog" });
        const types = (await luna(page, pkgs + "listAccountTypes", { capability: "SOCIAL" })).accountTypes || [];
        check(types.some((t) => t.templateId === TEMPLATE && t.featured && t.auth.type === "oauth" && t.server === "discovered"),
              "the catalog lists the Fediverse account type, featured, OAuth, its server found from the handle");
        await page.goto(appUrl("org.webosphoenix.marketplace"));
        await page.click("[data-testid=tab-connections]");
        await page.waitForSelector("[data-testid=group-featured] [data-testid='account-" + TEMPLATE + "']", { timeout: 15000 });
        await page.waitForTimeout(500);
        await shot(page, "1-connections");
        await page.click("[data-testid=group-featured] [data-testid='account-" + TEMPLATE + "']");
        await page.waitForSelector("[data-testid=account-page]");
        const typePage = await page.textContent("[data-testid=account-page]");
        check(/Mastodon/.test(typePage) && /Phoenix's servers: none/.test(typePage), "its page: the servers it works with, and no Phoenix server in between");
        await shot(page, "2-connection-page");
        host.length = 0;
        await page.click("[data-testid=set-up]");
        await page.waitForTimeout(300);
        const setUp = host.find((m) => m.type === "launch" && m.payload.id === "com.palm.app.accounts");
        check(!!setUp && setUp.payload.params.templateId === TEMPLATE, "Set up opens Accounts at the Fediverse template");

        // ---- 2. Sign in ------------------------------------------------------------------------------
        const accounts = await context.newPage();
        await accounts.goto(appUrl("com.palm.app.accounts", { templateId: TEMPLATE }));
        const wizard = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.fediverse\/accounts\/wizard\.html/.test(f.url())), 15000);
        if (!check(!!wizard, "Accounts opens the Fediverse sign-in page")) throw new Error("no sign-in page");
        await wizard.waitForSelector("input", { timeout: 10000 });
        await accounts.waitForTimeout(800);
        await wizard.locator("input").first().fill("@phoenix@" + mastodon.domain);
        await wizard.locator("input").first().press("Tab");
        await shot(accounts, "3-sign-in");
        await wizard.getByText("Sign In", { exact: true }).click();
        // The sheet over the Accounts card, the server's page in its web view.
        const sheet = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.sharesheet\/index\.html/.test(f.url())), 15000);
        if (!check(!!sheet, "the sign-in sheet opens over the card")) throw new Error("no sheet");
        const serverPage = await until(() => accounts.frames().find((f) => f.url().indexOf(mastodon.base + "/oauth/authorize") === 0), 15000);
        if (!check(!!serverPage, "it shows the server's own sign-in page")) throw new Error("no server page");
        await serverPage.waitForSelector("#authorize");
        const address = await sheet.textContent("[data-testid=signin-address]");
        check(address.indexOf(mastodon.domain) >= 0 && /\/oauth\/authorize/.test(address), "with the server's address above it (" + address + ")");
        await accounts.waitForTimeout(400);
        await shot(accounts, "4-sign-in-sheet");
        check(!(await accounts.evaluate(() => { try { return !!document.querySelector("[data-phoenix-sheet]").contentWindow.document
            .querySelector("object").querySelector("iframe").contentDocument; } catch (e) { return false; } })),
            "the page asking cannot read the server's page");
        await serverPage.click("#authorize");
        const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 15000 }).catch(() => {});
        check(!(await accounts.evaluate(() => !!document.querySelector("[data-phoenix-sheet]"))), "the sheet closes on the redirect");
        check(await create.isVisible().catch(() => false), "signed in: Accounts offers Create Account");
        await accounts.waitForTimeout(600); // let the Accounts page settle after the sheet is gone
        await shot(accounts, "5-capabilities");
        await create.click();
        const account = await until(async () => (await luna(page, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results[0], 10000);
        if (!check(account && account.username === "phoenix@" + mastodon.domain && account.capabilityProviders.length === 3,
                   "the account exists, with People you follow, Direct mentions and Notifications")) throw new Error("no account");
        const creds = await luna(page, "luna://com.palm.service.accounts/readCredentials", { accountId: account._id, name: "common" });
        const keys = await page.evaluate(() => JSON.parse(localStorage.getItem("phoenix:oauth:keys") || "{}"));
        const key = keys["key:" + (creds.credentials && creds.credentials.oauthKey)];
        check(!!key && key.owner === SERVICE && !!key.accessToken && JSON.stringify(creds).indexOf(key.accessToken) < 0,
              "the token is in the key store, owned by the service; the account keeps only its key");
        const tokenCall = await luna(page, "luna://org.webosphoenix.service.oauth/token", { keyId: creds.credentials.oauthKey });
        check(tokenCall.returnValue === false && tokenCall.errorCode === "PERMISSION_DENIED", "a page cannot read the token");
        await accounts.waitForTimeout(800);
        await shot(accounts, "6-accounts");

        // ---- 3. The people you follow, on contact cards ------------------------------------------------
        const contacts = await until(async () => { const c = await db(page, "com.palm.contact.fediverse:1"); return c.length >= 3 ? c : null; }, 20000);
        await syncNow(page, account._id);
        check(!!contacts && contacts.length === 3, "the people you follow are contacts (com.palm.contact.fediverse:1)");
        const sofia = (contacts || []).find((c) => c.nickname === "@sofia@fedi.example");
        check(!!sofia && sofia.urls[0].value === "https://fedi.example/@sofia" && /^Latest post, 9 Oct 2026: Flashed Phoenix/.test(sofia.note)
              && /^\/var\/file-cache\//.test(sofia.photos[0].value), "Sofia: her profile link, avatar and latest post");
        const person = (await db(page, "com.palm.person:1")).find((p) => (p.contactIds || []).includes(sofia && sofia._id));
        check(!!person && person.contactIds.length === 2, "linked to the Sofia Lindqvist of the address book");
        check(/^\/var\/file-cache\/org\.webosphoenix\.service\.fediverse\/[0-9a-f]{16}\.png$/.test(person && person.photos.listPhotoPath || ""),
              "her avatar is kept as a file of the device, where Contacts finds a photo (" + (person && person.photos.listPhotoPath) + ")");
        const contactsPage = await context.newPage();
        await contactsPage.goto(appUrl("com.palm.app.contacts"));
        await contactsPage.waitForTimeout(4000);
        await contactsPage.locator("input").first().fill("Sofia");
        await contactsPage.waitForTimeout(1500);
        await contactsPage.getByText("Sofia Lindqvist").first().click().catch(() => {});
        await contactsPage.waitForTimeout(2500);
        const card = await contactsPage.evaluate(() => document.body.innerText);
        const avatar = await contactsPage.evaluate(() => [...document.querySelectorAll("img, [style]")].some((e) => /blob:|data:image/.test(e.src || e.getAttribute("style") || "")));
        check(avatar, "her card shows the avatar");
        check(/fedi\.example\/@sofia/.test(card), "her contact card shows the profile link");
        check(/Flashed Phoenix/.test(card), "and her latest post");
        await shot(contactsPage, "7-contact");
        await contactsPage.close();

        // ---- 4. Mentions: Messaging and notifications ------------------------------------------------------
        mastodon.mention("sofia", "Did the Pre 3 boot? Send pictures!", "direct");
        mastodon.mention("juniper", "Phoenix looks great on the TouchPad", "public");
        host.length = 0;
        await syncNow(page, account._id);
        const thread = await until(async () => (await db(page, "com.palm.chatthread:1")).find((t) => t.replyService === "type_fediverse"), 10000);
        check(!!thread && thread.replyAddress === "sofia@fedi.example" && thread.unreadCount === 1, "the direct mention is a Messaging conversation, unread");
        const notes = host.filter((m) => m.type === "notification");
        check(notes.some((m) => m.payload.appId === "org.webosphoenix.messaging" && /Sofia Lindqvist: Did the Pre 3 boot/.test(m.payload.title)),
              "with a notification that opens it");
        check(notes.some((m) => m.payload.appId === "org.webosphoenix.fediverse" && /Juniper Bloom mentioned you/.test(m.payload.title)),
              "the public mention is a notification");
        const messaging = await context.newPage();
        await messaging.goto(appUrl("org.webosphoenix.messaging", { threadId: thread && thread._id }));
        await messaging.waitForSelector("[data-testid=not-private]", { timeout: 10000 }).catch(() => {});
        check(/Not private/.test(await messaging.textContent("[data-testid=not-private]").catch(() => "")), "Messaging says the conversation is not private");
        check(/Did the Pre 3 boot\? Send pictures!/.test(await messaging.evaluate(() => document.body.innerText)), "and shows the message");
        await shot(messaging, "8-messaging");
        // A reply goes back as a direct mention.
        await messaging.fill("[data-testid=message-input]", "It did! Pictures soon.");
        await messaging.click("[data-testid=send]");
        const reply = await until(() => mastodon.statuses.find((s) => /It did! Pictures soon/.test(s.text)), 10000);
        check(!!reply && reply.visibility === "direct" && reply.text.indexOf("@sofia@fedi.example ") === 0 && !!reply.in_reply_to_id,
              "a reply from Messaging is a direct mention back, in reply to hers");
        await messaging.close();

        // ---- 5. Share a link from the browser ------------------------------------------------------------------
        const browserPage = await context.newPage();
        await browserPage.goto(appUrl("com.palm.app.browser"));
        await browserPage.waitForFunction(() => !!window.__phoenixRuntime);
        await browserPage.waitForTimeout(2000);
        host.length = 0;
        const shared = browserPage.evaluate(() => __phoenixRuntime.share({ title: "webOS Phoenix", url: "https://example.org/phoenix" }));
        const shareSheet = await until(() => browserPage.frames().find((f) => /org\.webosphoenix\.sharesheet\/index\.html/.test(f.url())), 10000);
        await shareSheet.waitForSelector("[data-testid='share-app-org.webosphoenix.fediverse']", { timeout: 10000 });
        await browserPage.waitForTimeout(400);
        await shot(browserPage, "9-share-sheet");
        await shareSheet.click("[data-testid='share-app-org.webosphoenix.fediverse']");
        await shared;
        const launched = host.find((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.fediverse");
        check(!!launched && launched.payload.params.share.url === "https://example.org/phoenix", "the share sheet offers the account and opens it with the link");
        const compose = await context.newPage();
        await compose.goto(appUrl("org.webosphoenix.fediverse", launched && launched.payload.params));
        await compose.waitForSelector("#compose:not([hidden])", { timeout: 10000 });
        check((await compose.inputValue("#text")).indexOf("https://example.org/phoenix") >= 0, "the post starts with the link");
        await compose.click("[data-v=unlisted]");
        await shot(compose, "10-compose");
        await compose.click("#post");
        const linkPost = await until(() => mastodon.statuses.find((s) => /example\.org\/phoenix/.test(s.text)), 10000);
        check(!!linkPost && linkPost.visibility === "unlisted", "posted, unlisted, on the server");
        // A photo, with its description.
        const photo = await context.newPage();
        await photo.goto(appUrl("org.webosphoenix.fediverse", { share: { title: "", text: "Harbour at dusk", url: "",
            files: [{ path: "/media/internal/samples/photos/harbor-dusk.jpg", mimeType: "image/jpeg" }] } }));
        await photo.waitForSelector("#alt0", { timeout: 10000 });
        await photo.fill("#alt0", "Boats at a harbour wall, the sky orange");
        await photo.click("#post");
        const photoPost = await until(() => mastodon.statuses.find((s) => s.text === "Harbour at dusk"), 15000);
        const media = photoPost && photoPost.media_attachments[0];
        check(!!media && media.description === "Boats at a harbour wall, the sky orange" && media.bytes > 10000 && media.mimeType === "image/jpeg",
              "a photo is posted with its description (" + (media ? media.bytes + " bytes" : "none") + ")");

        // ---- 6. A third-party connector: Developer Mode only --------------------------------------------------
        const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
        const packed = pack(path.join(REPO, "apps/shared/connector-kit/examples/feeds"), outDir);
        const ipkB64 = fs.readFileSync(packed.file).toString("base64");
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/feeds.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipkB64);
        const install = (dev) => page.evaluate((d) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 30 || r.statusValue === 24) res(r); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "org.example.feeds", ipkUrl: "/tmp/feeds.ipk", subscribe: true, developerMode: d }));
        }), dev);
        const refused = await install(false);
        check(refused.statusValue === 24 && /Developer Mode/.test(refused.details.reason), "the FEEDS example is refused without Developer Mode");
        await page.evaluate(() => { localStorage.setItem("phoenix:devMode", "true"); });
        const ok = await install(true);
        check(ok.statusValue === 30, "and installs in Developer Mode (" + (ok.details && ok.details.reason || "") + ")");
        await page.waitForTimeout(300);
        await page.reload();
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        // Its service runs here: a feed (the account's public posts, as
        // Mastodon serves them at /@user.rss) as an account, its entries in db8.
        const feedUrl = mastodon.base + "/@phoenix.rss";
        const notFeed = await luna(page, "luna://org.example.service.feeds/checkCredentials", { templateId: "org.example.feeds", config: { url: mastodon.base + "/@phoenix" } });
        check(notFeed.returnValue === false, "the FEEDS example's validator refuses a page that is no feed (" + notFeed.errorCode + ")");
        const checked = await luna(page, "luna://org.example.service.feeds/checkCredentials", { templateId: "org.example.feeds", config: { url: feedUrl } });
        check(checked.returnValue === true && checked.config.title === "Phoenix Tester", "and takes the feed");
        const feedAccount = await luna(page, "luna://com.palm.service.accounts/createAccount", { templateId: "org.example.feeds", username: checked.username,
            credentials: checked.credentials, config: checked.config, capabilityProviders: [{ id: "org.example.feeds.entries" }] });
        const entries = await until(async () => { const e = await db(page, "org.example.feeds.entry:1"); return e.length >= 2 ? e : null; }, 15000);
        check(!!feedAccount.returnValue && !!entries && entries.some((e) => e.title === "" || /example\.org\/phoenix|Harbour/.test(e.summary)),
              "an account of it syncs the feed's entries into db8 (" + (entries ? entries.length : 0) + ")");
        await luna(page, "luna://com.palm.service.accounts/deleteAccount", { accountId: feedAccount.result && feedAccount.result._id });
        check(!!(await until(async () => (await db(page, "org.example.feeds.entry:1")).length === 0, 10000)), "deleting the account removes its entries");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        catalog.stop && catalog.stop();
        await mastodon.close();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed; screenshots in ${outDir}` : `\nall checks passed; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
