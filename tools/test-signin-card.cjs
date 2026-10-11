#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// OAuth sign-ins the way a device does them (docs/SYNERGY-CONNECTORS.md
// 4.1; services/oauth/device.js), end to end in headless Chromium, without
// the internet:
//
//   - the OAuth service's device code in this process (Node, as
//     run-js-service runs it): its loopback listener on 127.0.0.1, its
//     sealed key store in a temporary folder;
//   - the Sign In card's own page (apps/signin) in Chromium, launched as
//     the application manager would ({session} only); its Luna calls
//     (pending) reach the service as org.webosphoenix.signin's;
//   - a fake OAuth provider (services/oauth/test/fake-provider.cjs) and
//     the Fediverse's fake Mastodon server (apps/fediverse/service/test/
//     fake-mastodon.cjs), whose real pages are pressed in the card.
//
//   1. a sign-in: the card asks for the address and opens the provider's
//      page (no Phoenix runtime in it); Allow; the redirect reaches the
//      listener, which answers the card; the card is closed; the token is
//      the owner's, sealed on disk, refreshed, revoked;
//   2. Deny on the provider's page: ACCESS_DENIED;
//   3. the card closed by the user: CANCELED, the listener gone;
//   4. a card launched with no sign-in open shows that it has ended;
//   5. the Fediverse: the app registered with the fixed loopback redirect,
//      Authorize on the server's own page, the token sealed.
//
// Screenshots of the card (phone and tablet sizes) go to the output folder.
//
//   node tools/test-signin-card.cjs [--out DIR]
//
// Needs Playwright (NODE_PATH="$(npm root -g)").

"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const crypto = require("crypto");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "signin-card-tests");
const { createDeviceOAuth, SIGNIN_APP } = require(path.join(REPO, "services/oauth/device.js"));
const { createFakeProvider } = require(path.join(REPO, "services/oauth/test/fake-provider.cjs"));
const { createFakeMastodon } = require(path.join(REPO, "apps/fediverse/service/test/fake-mastodon.cjs"));
const synckit = require(path.join(REPO, "apps/shared/synckit/src/index.js"));
const OWNER = "org.webosphoenix.service.test";
const CARD_DIR = path.join(REPO, "apps/signin");

let failures = 0;
const T0 = Date.now();
const trace = process.env.SIGNIN_TRACE ? (m) => console.log("  [" + (Date.now() - T0) + " ms] " + m) : () => {};
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
async function until(fn, ms) {
    for (let t = 0; t < (ms || 10000); t += 100) {
        const v = await fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 100));
    }
    return null;
}
function portOpen(port) {
    return new Promise((resolve) => {
        const s = net.connect(port, "127.0.0.1");
        s.on("connect", () => { s.destroy(); resolve(true); });
        s.on("error", () => resolve(false));
    });
}

// The card's files, as WebAppMgr loads them (a file of the app's folder).
function serveCard() {
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
    const server = http.createServer((req, res) => {
        const p = path.join(CARD_DIR, path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, ""));
        if (!p.startsWith(CARD_DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
        fs.createReadStream(p).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: "http://127.0.0.1:" + server.address().port })));
}

async function main() {
    fs.mkdirSync(outDir, { recursive: true });
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const card = await serveCard();
    const provider = await createFakeProvider({ redirectUris: ["http://127.0.0.1/oauth/callback"] }).start(0);
    const mastodon = await createFakeMastodon().start(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-signin-card-"));
    let viewport = { width: 320, height: 452 };
    const cards = [];          // the card pages opened, in order
    const bars = [];
    let device = null;
    let pendingDelay = 0;

    // The application manager: launch opens the card's page with {session};
    // closeByAppId closes it; a page closed by the user is its "close" event.
    async function launchCard(params) {
        const context = await browser.newContext({ viewport });
        // The card's page gets PalmSystem and the bus as WebAppMgr's page
        // would (only on the card's own origin: the provider's page gets
        // nothing of Phoenix's).
        await context.exposeBinding("__phoenixLuna", async (_source, uri, payload) => {
            const m = /^luna:\/\/org\.webosphoenix\.service\.oauth\/(\w+)$/.exec(uri);
            if (!m || !device.methods[m[1]]) return JSON.stringify({ returnValue: false, errorText: "Unknown service " + uri });
            if (pendingDelay) await new Promise((r) => setTimeout(r, pendingDelay));
            return JSON.stringify(await device.methods[m[1]](JSON.parse(payload || "{}"), SIGNIN_APP));
        });
        await context.addInitScript(({ origin, launchParams }) => {
            if (location.origin !== origin) return;
            window.PalmSystem = { launchParams: JSON.stringify(launchParams), stageReady() {} };
            window.PalmServiceBridge = function () {
                const self = this;
                this.call = (uri, json) => { window.__phoenixLuna(uri, json).then((r) => self.onservicecallback && self.onservicecallback(r)); };
                this.cancel = () => {};
            };
        }, { origin: card.base, launchParams: params });
        trace("launch " + JSON.stringify(params));
        const page = await context.newPage();
        const entry = { page, context, closedByService: false, params };
        page.on("close", () => { trace("page closed (by service: " + entry.closedByService + ")"); if (!entry.closedByService) device.card.appClosed(); });
        cards.push(entry);
        page.on("framenavigated", (f) => { if (f === page.mainFrame()) trace("navigated " + f.url().slice(0, 60)); });
        page.on("load", () => trace("load " + page.url().slice(0, 60)));
        page.on("requestfailed", (r) => trace("request failed " + r.url().slice(0, 60) + " " + (r.failure() && r.failure().errorText)));
        page.goto(card.base + "/index.html").catch(() => {});
        return { returnValue: true };
    }
    async function closeCard() {
        const open = cards.filter((c) => !c.page.isClosed());
        trace("closeCard: " + open.length + " open");
        for (const c of open) {
            c.closedByService = true;
            trace("closing page at " + c.page.url().slice(0, 60));
            // The application manager ends the card's whole process: its
            // context here (a page.close() made while the page commits the
            // redirect's navigation can wait forever in Playwright).
            await c.context.close();
        }
        // The application manager's close event for it.
        trace("closeCard: closed");
        if (open.length) setTimeout(() => { trace("close event"); device.card.appClosed(); }, 10);
        return { returnValue: true };
    }
    device = createDeviceOAuth({
        request: synckit.createRequest({ userAgent: "webOS-Phoenix-OAuth-test" }),
        fs, path, crypto, http, dir, launchCard, closeCard,
        bar: (info) => bars.push(info),
        fixedPort: 42000 + Math.floor(Math.random() * 6000)
    });
    const params = (extra) => Object.assign({ authorizationEndpoint: provider.authorizationEndpoint, tokenEndpoint: provider.tokenEndpoint,
                                              revocationEndpoint: provider.revocationEndpoint, clientId: provider.clientId, scope: "files.read",
                                              redirectUri: "http://127.0.0.1/oauth/callback" }, extra || {});
    const lastCard = () => cards[cards.length - 1];
    // The card a sign-in opened: one launched after `before` cards (the
    // last sign-in's card may still be closing), on the provider's page.
    const onProvider = async (base, before) => {
        const c = await until(async () => {
            const l = lastCard();
            return l && cards.length > before && !l.page.isClosed() && l.page.url().indexOf(base) === 0 ? l : null;
        }, 15000);
        if (!c) throw new Error("the card did not reach " + base + " (cards: " + cards.map((x) => (x.page.isClosed() ? "closed " : "") + x.page.url()).join(", ") + ")");
        return c;
    };

    try {
        // 1. Allow.
        for (const size of [["phone", { width: 320, height: 452 }], ["tablet", { width: 1024, height: 740 }]]) {
            viewport = size[1];
            bars.length = 0;
            const before = cards.length;
            const signing = device.methods.authorize(params(), OWNER);
            const c = await onProvider(provider.base, before);
            if (!check(!!c, size[0] + ": the card opens the provider's page")) throw new Error("no provider page");
            check(Object.keys(c.params).join() === "session", size[0] + ": the card was launched with {session} only");
            await c.page.waitForSelector("#allow");
            check(await c.page.evaluate(() => typeof window.PalmServiceBridge === "undefined" && typeof window.PalmSystem === "undefined"),
                  size[0] + ": the provider's page has no Phoenix runtime in it");
            check(bars[0] && bars[0].host === new URL(provider.base).host && bars[0].appId === SIGNIN_APP,
                  size[0] + ": the shell's bar names the provider's host (" + (bars[0] && bars[0].host) + ")");
            const redirect = new URL(c.page.url()).searchParams.get("redirect_uri");
            const port = Number(new URL(redirect).port);
            check(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/.test(redirect) && port > 0, size[0] + ": the redirect is the loopback address on an ephemeral port (" + redirect + ")");
            await c.page.screenshot({ path: path.join(outDir, "signin-card-provider-" + size[0] + ".png") });
            await c.page.click("#allow");
            const r = await signing;
            check(r.returnValue === true && !!r.keyId, size[0] + ": signed in (key " + (r.keyId || JSON.stringify(r)) + ")");
            check(!!(await until(() => c.page.isClosed() && c.closedByService, 5000)), size[0] + ": the service closed the card");
            check(!(await portOpen(port)), size[0] + ": the listener has stopped");
            check(bars[bars.length - 1] === null, size[0] + ": the bar is gone");
            const t = await device.methods.token({ keyId: r.keyId }, OWNER);
            check(/^at-/.test(t.accessToken || ""), size[0] + ": the token is its owner's");
            check((await device.methods.token({ keyId: r.keyId }, SIGNIN_APP)).errorCode === "PERMISSION_DENIED", size[0] + ": the card cannot read it");
            const sealed = fs.readFileSync(path.join(dir, "keys.enc"), "utf8");
            check(sealed.indexOf(t.accessToken) < 0 && sealed.indexOf("rt-") < 0, size[0] + ": keys.enc holds no token in the clear");
            if (size[0] === "tablet") {
                check((await device.methods.forget({ keyId: r.keyId }, OWNER)).returnValue === true && !provider.tokenLive(t.accessToken),
                      "forget revokes the token at the provider");
            }
        }
        viewport = { width: 320, height: 452 };

        // The card's own page, the moment before the provider's: the service
        // is slow to answer pending.
        {
            pendingDelay = 3000;
            const before = cards.length;
            const signing = device.methods.authorize(params(), OWNER);
            const c = await until(() => cards.length > before && !lastCard().page.isClosed() ? lastCard() : null, 10000);
            check(!!(await until(async () => /Opening the sign-in page/.test(await c.page.textContent("#message", { timeout: 200 }).catch(() => "")), 2000)),
                  "the card's own page shows while it asks for the address");
            await c.page.screenshot({ path: path.join(outDir, "signin-card-opening-phone.png") });
            await c.page.close();
            check((await signing).errorCode === "CANCELED", "a card closed before the provider's page: CANCELED");
            pendingDelay = 0;
        }

        // 2. Deny.
        {
            const before = cards.length;
            const signing = device.methods.authorize(params(), OWNER);
            const c = await onProvider(provider.base, before);
            await c.page.click("#deny");
            check((await signing).errorCode === "ACCESS_DENIED", "Deny on the provider's page: ACCESS_DENIED");
        }

        // 3. The user closes the card.
        {
            const before = cards.length;
            const signing = device.methods.authorize(params(), OWNER);
            const c = await onProvider(provider.base, before);
            const port = Number(new URL(new URL(c.page.url()).searchParams.get("redirect_uri")).port);
            check(await portOpen(port), "the listener waits while the card is open");
            await c.page.close();
            check((await signing).errorCode === "CANCELED", "the card closed by the user: CANCELED");
            check(!(await portOpen(port)), "the listener has stopped");
        }

        // 4. A card launched for no sign-in.
        {
            await launchCard({ session: "made-up" });
            const c = lastCard();
            await until(async () => /ended/.test(await c.page.textContent("#message", { timeout: 200 }).catch(() => "")), 5000);
            check(/This sign-in has ended/.test(await c.page.textContent("#message")), "a card for no open sign-in says it has ended, and opens nothing");
            await c.page.screenshot({ path: path.join(outDir, "signin-card-ended-phone.png") });
            c.closedByService = true;
            trace("closing page at " + c.page.url().slice(0, 60));
            await c.page.close();
        }

        // 5. The Fediverse's server: the app registered with the fixed loopback redirect.
        {
            const before = cards.length;
            const ru = await device.methods.redirectUri({}, OWNER);
            const reg = JSON.parse((await mastodon.request({ method: "POST", url: mastodon.base + "/api/v1/apps", headers: { "content-type": "application/json" },
                                                             body: JSON.stringify({ client_name: "webOS Phoenix", redirect_uris: ru.fixedRedirectUri, scopes: "read" }) })).body);
            await device.methods.client({ name: mastodon.base + " " + ru.fixedRedirectUri, value: { clientId: reg.client_id, clientSecret: reg.client_secret } }, OWNER);
            const signing = device.methods.authorize({ authorizationEndpoint: mastodon.base + "/oauth/authorize", tokenEndpoint: mastodon.base + "/oauth/token",
                                                       revocationEndpoint: mastodon.base + "/oauth/revoke", clientId: reg.client_id, clientSecret: reg.client_secret,
                                                       scope: "read", redirectUri: ru.fixedRedirectUri }, OWNER);
            const c = await onProvider(mastodon.base, before);
            await c.page.waitForSelector("#authorize");
            await c.page.screenshot({ path: path.join(outDir, "signin-card-mastodon-phone.png") });
            await c.page.click("#authorize");
            const r = await signing;
            check(r.returnValue === true, "the Fediverse server's page, Authorize: signed in on the fixed port " + ru.fixedRedirectUri);
            const sealed = fs.readFileSync(path.join(dir, "keys.enc"), "utf8");
            check(sealed.indexOf(reg.client_secret) < 0, "the server's client secret is sealed too");
        }
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
    } finally {
        await browser.close();
        await provider.stop();
        await mastodon.close();
        card.server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log(failures ? failures + " failed" : "all passed (screenshots in " + path.relative(REPO, outDir) + ")");
    process.exit(failures ? 1 : 0);
}

main();
