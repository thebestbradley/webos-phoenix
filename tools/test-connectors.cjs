#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The provider connectors end to end (docs/SYNERGY-CONNECTORS.md 8, "Provider
// connectors"), without the internet, in headless Chromium with
// runtime/phoenix-runtime.js against the stand-ins of
// apps/connectors/testing/fake-providers.cjs and the real Marketplace
// catalog (server/marketplace, PHP). This build has no provider
// registration (no client id in any clients.json), as a build from the
// public tree has none:
//   1. Connections lists Todoist (Tasks & Notes) and Bluesky (Social &
//      Feeds); each package, Phoenix's own from the catalog the device
//      ships with, installs without Developer Mode;
//   2. Todoist in Accounts: "Sign In with Todoist is not available in this
//      build", the API token instead; the account is made;
//   3. Tasks: Todoist's projects are lists under the account, with their
//      tasks; a task added in Tasks and one ticked off reach Todoist;
//   4. the share sheet's Add to Todoist makes a task of a link;
//   5. Bluesky in Accounts: "not available in this build" for Sign In with
//      Bluesky, the handle and app password instead; the account is made;
//   6. the people followed are contacts; a direct message is a Messaging
//      conversation labelled not end-to-end encrypted, and a reply goes
//      back; a new follower is a notification;
//   7. the share sheet posts a link to Bluesky.
//
//   node tools/test-connectors.cjs [--tablet] [--out DIR]
//
// Needs Playwright, PHP 8 (sodium, pdo_sqlite), the apps built
// (cd apps && npm run build) and the connector kit built (its lib/).

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
const { createFakeProviders } = require(path.join(REPO, "apps/connectors/testing/fake-providers.cjs"));
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "connector-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TODOIST = "com.webosphoenix.todoist", BLUESKY = "com.webosphoenix.bluesky";

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
    for (const f of ["apps/tasks/dist/index.html", "apps/messaging/dist/index.html", "apps/sharesheet/dist/index.html", "apps/marketplace/dist/index.html",
                     "apps/shared/connector-kit/lib/index.js"]) {
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
    const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
    fs.mkdirSync(outDir, { recursive: true });
    const fake = await createFakeProviders().start(0);
    const td = fake.todoist, bs = fake.bluesky;
    const catalog = await servers.startCatalog({ port: await servers.freePort() });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-connectors-pack-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const appUrl = (id, params, file) => `${origin}/usr/palm/applications/${id}/${file || "index.html"}` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 10000, 100);
        // The packages, Phoenix's own (an admin's upload), in the catalog.
        for (const name of ["todoist", "bluesky"]) {
            const ipk = pack(path.join(REPO, "apps/connectors", name), packDir, { vendor: false, namespaces: ["org.webosphoenix", "com.webosphoenix"] });
            const up = await catalog.api("POST", "/api/apps/packages", new Uint8Array(fs.readFileSync(ipk.file)), catalog.admin);
            check(up.status === 200 && up.app.kind === "connector", "the " + name + " package, Phoenix's own, is taken by the catalog (" + (up.error || up.app.kind) + ")");
            await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        }

        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        await context.route("**/usr/share/phoenix/host.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ marketplaceCatalog: true }) }));
        // The device's servers.json, its feeds at this test's catalog (the
        // built-in Phoenix catalog's address comes from there, not from
        // sources.json: docs/PLATFORM-CLIENT.md).
        await context.route("**/etc/palm/phoenix/servers.json", async (r) => {
            const res = await r.fetch();
            const json = await res.json();
            json.feeds = catalog.url + "/";
            await r.fulfill({ response: res, body: JSON.stringify(json) });
        });
        const errors = [], host = [];
        context.on("page", (p) => {
            p.on("pageerror", (e) => errors.push(p.url().replace(/\?.*$/, "").replace(/^.*\/applications\//, "") + ": " + e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                if (process.env.CONNECTORS_VERBOSE && !t.startsWith("__phoenix__")) console.log("    [" + m.type() + "] " + t);
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
        const shellSays = (p) => p.evaluate((st) => window.__phoenixRuntime.applyHostStatus({ marketplaceCatalog: st }, { writer: false }),
            { url: catalog.url + "/", error: "", settingUp: false, state: "running", key: catalog.key });
        // A sync of the account that starts now: one already running (the
        // account's first, a reply's) may have begun before what the test
        // just changed on the server, so after it ends this one is asked again.
        const syncNow = async (p, service, accountId) => {
            const unlocked = () => until(() => p.evaluate(([s, a]) => !JSON.parse(localStorage.getItem("phoenix:connector:syncLock:" + s + ":" + a) || "0"),
                                                          [service, accountId]), 30000);
            let r = await luna(p, "luna://" + service + "/sync", { accountId });
            for (let i = 0; i < 5 && r && r.alreadyRunning; i++) {
                await unlocked();
                r = await luna(p, "luna://" + service + "/sync", { accountId });
            }
            await unlocked();
            return r;
        };

        // ---- 1. Connections: install both from the catalog ------------------------------------------------
        const market = await context.newPage();
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.evaluate(() => localStorage.clear());
        // The image's settings: the stand-ins' addresses, and no provider registration (none in this build).
        await market.evaluate((cfg) => Object.keys(cfg).forEach((k) => localStorage.setItem("phoenix:systemConfig:" + k, JSON.stringify(cfg[k]))),
                              fake.systemConfig([]));
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.waitForSelector("[data-testid=tab-connections]", { timeout: 15000 });
        await shellSays(market);
        await luna(market, "luna://org.webosphoenix.service.packages/refresh", {});
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.waitForSelector("[data-testid=tab-connections]");
        await shellSays(market);
        await market.click("[data-testid=tab-connections]");
        const install = async (group, templateId, name) => {
            const row = "[data-testid=group-" + group + "] [data-testid='account-" + templateId + "']";
            await market.waitForSelector(row, { timeout: 20000 });
            await market.locator(row).scrollIntoViewIfNeeded();
            await shot(market, "1-connections-" + name);
            await market.click(row);
            await market.waitForSelector("[data-testid=account-page]");
            const text = await market.textContent("[data-testid=account-page]");
            check(/Phoenix's servers: none/.test(text) && /experimental/i.test(text), name + "'s page: no Phoenix server in between, experimental");
            await shot(market, "2-" + name + "-page");
            await market.click("[data-testid=connector-install]");
            await market.waitForSelector("[data-testid=set-up]", { timeout: 30000 }).catch(async (e) => { await shot(market, "install-failed-" + name); throw e; });
            check(await market.locator("[data-testid=devmode-needed]").count() === 0, name + " installed without Developer Mode (Phoenix's own, from the catalog the device ships with)");
            await market.goBack().catch(() => {});
            await market.goto(appUrl("org.webosphoenix.marketplace"));
            await market.waitForSelector("[data-testid=tab-connections]");
            await shellSays(market);
            await market.click("[data-testid=tab-connections]");
        };
        await install("tasks", TODOIST, "todoist");
        await install("social", BLUESKY, "bluesky");
        const tpl = (await luna(market, "luna://com.palm.service.accounts/listAccountTemplates", {})).results.map((t) => t.templateId);
        check(tpl.includes(TODOIST) && tpl.includes(BLUESKY), "Accounts has both templates");

        // ---- 2. Todoist in Accounts: the API token ----------------------------------------------------------
        const accounts = await context.newPage();
        const wizardOf = async (templateId, app) => {
            await accounts.goto(appUrl("com.palm.app.accounts", { templateId }));
            const re = new RegExp(app.replace(/\./g, "\\.") + "\\/accounts\\/wizard\\.html");
            const w = await until(() => accounts.frames().find((f) => re.test(f.url())), 15000);
            if (!w) throw new Error("no sign-in page for " + templateId);
            await w.waitForSelector(".connector-wizard", { timeout: 10000 }).catch(async (e) => { await shot(accounts, "wizard-failed"); console.log("errors: " + JSON.stringify(errors)); throw e; });
            await w.waitForSelector(".connector-unavailable", { state: "visible", timeout: 8000 }).catch(() => {});
            await accounts.waitForTimeout(600);
            return w;
        };
        const createAccount = async (templateId, name) => {
            const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
            await create.waitFor({ timeout: 20000 }).catch(() => {});
            await accounts.waitForTimeout(400);
            await shot(accounts, name);
            await create.click().catch(() => {});
            return until(async () => (await luna(accounts, "luna://com.palm.service.accounts/listAccounts", { templateId })).results[0], 10000);
        };
        let w = await wizardOf(TODOIST, "org.webosphoenix.todoist");
        check(/Sign In with Todoist is not available in this build/.test(await w.locator(".connector-unavailable").textContent().catch(() => "")),
              "Todoist: Sign In with Todoist is not available in this build (no registration)");
        check(/Don't have an account\? Sign up/.test(await w.locator(".accounts-signup").textContent().catch(() => "")), "and a sign-up link");
        await w.locator("input[type=password]").first().fill(td.token);
        await w.locator("input[type=password]").first().press("Tab");
        await shot(accounts, "3-todoist-sign-in");
        await w.getByText("Sign In", { exact: true }).click();
        const todo = await createAccount(TODOIST, "4-todoist-create");
        check(todo && todo.username === "anna@example.com", "the Todoist account exists (" + (todo && todo.username) + ")");
        if (!todo) throw new Error("no Todoist account");
        await syncNow(accounts, "org.webosphoenix.service.todoist", todo._id);

        // ---- 3. Tasks --------------------------------------------------------------------------------------
        const tasks = await context.newPage();
        await tasks.goto(appUrl("org.webosphoenix.tasks"));
        await tasks.waitForSelector("[data-testid='list-Groceries']", { timeout: 20000 }).catch(() => {});
        check(await tasks.locator("[data-testid='list-Groceries']").count() === 1 && await tasks.locator("[data-testid='list-Todoist Inbox']").count() === 1,
              "Tasks: Todoist's projects are lists");
        const listsText = await tasks.textContent("[data-testid=lists-pane]");
        check(/Todoist\s*Todoist Inbox/.test(listsText), "under the account's name (" + listsText.replace(/\s+/g, " ").slice(0, 160) + ")");
        await shot(tasks, "5-tasks-lists");
        await tasks.click("[data-testid='list-Groceries']");
        await tasks.waitForSelector("[data-testid='task-Buy milk']", { timeout: 10000 }).catch(() => {});
        check(await tasks.locator("[data-testid='task-Buy milk']").count() === 1, "with their tasks");
        await shot(tasks, "6-tasks-groceries");
        await tasks.fill("[data-testid=quick-add]", "Buy eggs");
        await tasks.press("[data-testid=quick-add]", "Enter");
        await tasks.waitForSelector("[data-testid='task-Buy eggs']", { timeout: 10000 });
        await tasks.click("[data-testid='check-Buy milk']");
        await tasks.waitForTimeout(500);
        const eggs = (await db(tasks, "com.palm.task.todoist:1")).find((t) => t.summary === "Buy eggs");
        check(!!eggs && eggs.accountId === todo._id, "a task added in the list is the Todoist account's (com.palm.task.todoist:1)");
        await syncNow(tasks, "org.webosphoenix.service.todoist", todo._id);
        check(td.tasks.some((t) => t.content === "Buy eggs" && t.project_id === "220474323" && !t.is_deleted), "it reaches Todoist, in Groceries");
        check(td.tasks.some((t) => t.content === "Buy milk" && t.checked), "and the task ticked off is done on Todoist");
        await shot(tasks, "7-tasks-synced");

        // ---- 4. Add to Todoist from the share sheet ------------------------------------------------------------
        const browserPage = await context.newPage();
        await browserPage.goto(appUrl("com.palm.app.browser"));
        await browserPage.waitForFunction(() => !!window.__phoenixRuntime);
        await browserPage.waitForTimeout(1500);
        const shareTo = async (appId, shotName) => {
            host.length = 0;
            const shared = browserPage.evaluate(() => __phoenixRuntime.share({ title: "Phoenix release notes", url: "https://example.org/notes" }));
            const sheet = await until(() => browserPage.frames().find((f) => /org\.webosphoenix\.sharesheet\/index\.html/.test(f.url())), 10000);
            await sheet.waitForSelector("[data-testid='share-app-" + appId + "']", { timeout: 10000 });
            await browserPage.waitForTimeout(400);
            await shot(browserPage, shotName);
            const label = await sheet.getAttribute("[data-testid='share-app-" + appId + "']", "aria-label");
            await sheet.click("[data-testid='share-app-" + appId + "']");
            await shared;
            const launched = host.find((m) => m.type === "launch" && m.payload.id === appId);
            return { label, params: launched && launched.payload.params };
        };
        let s = await shareTo("org.webosphoenix.todoist", "7-share-sheet-todoist");
        check(/Add to Todoist/.test(s.label || ""), "the share sheet offers Add to Todoist (" + s.label + ")");
        let compose = await context.newPage();
        await compose.goto(appUrl("org.webosphoenix.todoist", s.params));
        await compose.waitForSelector("#compose:not([hidden])", { timeout: 10000 });
        await shot(compose, "8-todoist-compose");
        await compose.click("#post");
        check(!!(await until(() => td.tasks.find((t) => t.content === "Phoenix release notes" && /example\.org\/notes/.test(t.description)), 10000)),
              "the link is a task in Todoist's Inbox");
        await compose.waitForSelector("#done:not([hidden])", { timeout: 10000 }).catch(() => {});
        await shot(compose, "9-todoist-added");
        await compose.close();

        // ---- 5. Bluesky in Accounts: an app password ------------------------------------------------------------
        w = await wizardOf(BLUESKY, "org.webosphoenix.bluesky");
        check(/Sign In with Bluesky is not available in this build/.test(await w.locator(".connector-unavailable").textContent().catch(() => "")),
              "Bluesky: Sign In with Bluesky is not available in this build");
        await w.locator("input").first().fill(bs.handle);
        await w.locator("input[type=password]").first().fill(bs.appPassword);
        await w.locator("input[type=password]").first().press("Tab");
        await shot(accounts, "10-bluesky-sign-in");
        await w.getByText("Sign In", { exact: true }).click();
        const sky = await createAccount(BLUESKY, "11-bluesky-create");
        check(sky && sky.username === "anna.test" && sky.capabilityProviders.length === 3, "the Bluesky account exists, with contacts, messages and notifications");
        if (!sky) throw new Error("no Bluesky account");
        const firstSync = await syncNow(accounts, "org.webosphoenix.service.bluesky", sky._id);
        await accounts.waitForTimeout(600);
        await shot(accounts, "12-accounts");

        // ---- 6. Contacts, Messaging, notifications ---------------------------------------------------------------
        const people = await until(async () => { const c = await db(accounts, "com.palm.contact.bluesky:1"); return c.length >= 3 ? c : null; }, 15000);
        if (!people) console.log("    first sync: " + JSON.stringify(firstSync) + "; now: " + JSON.stringify(await luna(accounts, "luna://org.webosphoenix.service.bluesky/sync", { accountId: sky._id })));
        check(!!people && people.some((c) => c.nickname === "@bob.test" && c.name.familyName === "Marsh"), "the people followed are contacts");
        bs.message("convo-bob", "Are you coming to the meetup?");
        bs.notify("follow", bs.people[2]);
        host.length = 0;
        await syncNow(accounts, "org.webosphoenix.service.bluesky", sky._id);
        const thread = await until(async () => (await db(accounts, "com.palm.chatthread:1")).find((t) => t.replyService === "type_bluesky"), 10000);
        check(!!thread && thread.replyAddress === "bob.test", "a direct message is a Messaging conversation");
        check(host.some((m) => m.type === "notification" && /Dee Ortiz followed you/.test(m.payload.title)), "a new follower is a notification");
        const messaging = await context.newPage();
        await messaging.goto(appUrl("org.webosphoenix.messaging", { threadId: thread && thread._id }));
        await messaging.waitForSelector("[data-testid=not-private]", { timeout: 10000 }).catch(() => {});
        check(/Not end-to-end encrypted/.test(await messaging.textContent("[data-testid=not-private]").catch(() => "")), "labelled not end-to-end encrypted");
        check(/Are you coming to the meetup\?/.test(await messaging.evaluate(() => document.body.innerText)), "with the message");
        await messaging.fill("[data-testid=message-input]", "Yes! See you there.");
        await messaging.click("[data-testid=send]");
        check(!!(await until(() => bs.convos[0].messages.find((m) => m.text === "Yes! See you there." && m.sender.did === bs.did), 10000)),
              "a reply from Messaging goes to the conversation");
        await messaging.waitForTimeout(500);
        await shot(messaging, "13-messaging-bluesky");
        await messaging.close();

        // ---- 7. Post a link to Bluesky ------------------------------------------------------------------------------
        s = await shareTo("org.webosphoenix.bluesky", "14-share-sheet-bluesky");
        check(s.label === "Bluesky · @anna.test", "the share sheet offers the account (" + s.label + ")");
        compose = await context.newPage();
        await compose.goto(appUrl("org.webosphoenix.bluesky", s.params));
        await compose.waitForSelector("#compose:not([hidden])", { timeout: 10000 });
        await shot(compose, "15-bluesky-compose");
        await compose.click("#post");
        const post = await until(() => bs.posts.find((p) => /example\.org\/notes/.test(p.record.text)), 10000);
        check(!!post && post.record.facets && post.record.facets[0].features[0].uri === "https://example.org/notes", "posted, the link a facet");
        await compose.waitForSelector("#done:not([hidden])", { timeout: 10000 }).catch(() => {});
        await shot(compose, "16-bluesky-posted");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        catalog.stop && catalog.stop();
        await fake.stop();
        fs.rmSync(installedDir, { recursive: true, force: true });
        fs.rmSync(packDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed; screenshots in ${outDir}` : `\nall checks passed; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
