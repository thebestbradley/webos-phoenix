#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Links between apps (docs/APP-RUNTIME.md "Links"), clicked in real app
// pages in headless Chromium: a link that leaves an app does not load in
// its card, the application manager opens it (open {target}) in the app
// for it, as WebAppMgr handed such a link over (mimeHandoffUrl):
//
//   web        an https link in an app's page (and Weather's Open-Meteo
//              credit, a target=_blank link) opens the browser with it;
//              the app's page stays where it is, and no window opens
//   mailto     Email, which starts a message to the address
//   tel        Phone, with the number on the dial pad
//   sms        Messaging, a new message to the number with the text
//   web app    a link to an installed web app's site opens the web app
//              (its manifest scope); a Google Maps link opens Maps
//   own pages  a link to the app's own page loads there, as before
//   unknown    a link no app opens: open fails and the shell hears it
//   scanner    QR Scanner's Call and Send Text (from its history) hand
//              tel: and sms: links to Phone and Messaging
//
// phoenix-sim's window adds what a page cannot catch itself (navigations
// by script, sites without the runtime, the browser's page views):
// shell/tests/tst_links.qml.
//
//   node tools/test-links.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "links-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const fixture = (name) => fs.readFileSync(path.join(REPO, "apps/weather/fixtures", name), "utf8");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

async function main() {
    for (const app of ["weather", "phone", "messaging", "scanner"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-links-"));
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(origin + "/apps.json")).ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
        const context = await browser.newContext({ viewport });
        // Open-Meteo for Weather, answered here; nothing else leaves.
        await context.route(/^https:\/\/[a-z-]+\.open-meteo\.com\//, (route) => {
            const u = new URL(route.request().url());
            const body = u.pathname === "/v1/search" ? fixture("search-london.json") : fixture("forecast-sunnyvale.json");
            return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        });
        let popups = 0;
        context.on("page", () => { popups++; });
        const page = await context.newPage();
        popups = 0;
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        const launched = async (id, target) => {
            for (let t = 0; t < 3000; t += 100) {
                const m = host.find((x) => x.type === "launch" && x.payload.id === id);
                if (m) return target === undefined || m.payload.params.target === target ? m : null;
                await page.waitForTimeout(100);
            }
            return null;
        };

        // ---- A web app whose site links open: installed as the marketplace does ------------------
        await page.goto(appUrl("com.palm.app.calculator"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("com.palm.app.calculator"));
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const ipk = Buffer.from(await servers.webApp("com.example.tunes", "1.0.0", {
            title: "Tunes", appinfo: { main: "https://m.tunes.example/home", phoenix: { pwa: { scope: "https://m.tunes.example/" } } } }));
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/tunes.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipk.toString("base64"));
        await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { if (JSON.parse(s).statusValue === 30) res(); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "com.example.tunes", ipkUrl: "/tmp/tunes.ipk", subscribe: true }));
        }));

        // ---- Links in an app's page --------------------------------------------------------------
        // Notes (the original Enyo app), with links as a page shows them.
        const NOTES = appUrl("com.palm.app.notes");
        await page.goto(NOTES);
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            const links = [
                ["web", "https://example.com/article?id=7", "An article"],
                ["mail", "mailto:ada@example.com?subject=Hello", "Write to Ada"],
                ["tel", "tel:+1-555-0100", "Call the office"],
                ["sms", "sms:+15550111?body=On%20my%20way", "Text Bob"],
                ["tunes", "https://www.tunes.example/album/7", "An album"],
                ["maps", "https://maps.google.com/?q=Brandenburger+Tor", "A place"],
                ["unknown", "nosuchscheme:42", "Something else"],
                ["own", location.pathname.replace(/index\.html$/, "index.html?own=1"), "This app"],
                ["blank", "https://example.org/", "In a new window"]
            ];
            const box = document.createElement("div");
            box.id = "links";
            box.style.cssText = "position:fixed;left:8px;top:60px;z-index:99999;background:#fff;padding:6px;font:14px sans-serif;display:flex;flex-direction:column;gap:6px";
            for (const [id, href, text] of links) {
                const a = document.createElement("a");
                a.id = "link-" + id;
                a.href = href;
                a.textContent = text;
                if (id === "blank") a.target = "_blank";
                box.appendChild(a);
            }
            document.body.appendChild(box);
        });
        await shot("notes-links");
        const click = async (id) => { host.length = 0; await page.click("#link-" + id); };

        await click("web");
        check(!!await launched("com.palm.app.browser", "https://example.com/article?id=7"), "web: an https link opens the browser with it");
        check(page.url() === NOTES, "web: the app's page stays where it is");
        await click("blank");
        check(!!await launched("com.palm.app.browser", "https://example.org/"), "web: a target=_blank link too");
        check(popups === 0, "web: and no window opens");
        await click("mail");
        check(!!await launched("com.palm.app.email", "mailto:ada@example.com?subject=Hello"), "mailto: Email, with the link");
        await click("tel");
        check(!!await launched("org.webosphoenix.phone", "tel:+1-555-0100"), "tel: Phone, with the link");
        await click("sms");
        check(!!await launched("org.webosphoenix.messaging", "sms:+15550111?body=On%20my%20way"), "sms: Messaging, with the link");
        await click("tunes");
        check(!!await launched("com.example.tunes", "https://www.tunes.example/album/7"), "web app: a link to an installed web app's site opens the web app");
        await click("maps");
        check(!!await launched("org.webosphoenix.maps", "https://maps.google.com/?q=Brandenburger+Tor"), "maps: a Google Maps link opens Maps");
        await click("unknown");
        await page.waitForTimeout(500);
        check(host.some((m) => m.type === "open" && m.payload.target === "nosuchscheme:42") && !host.some((m) => m.type === "launch"),
              "unknown: nothing launches, and the shell hears so (it tells the user)");
        check(page.url() === NOTES, "unknown: the page stays");
        host.length = 0;
        await Promise.all([page.waitForURL(/own=1/, { timeout: 10000 }).catch(() => null), page.click("#link-own")]);
        check(/own=1/.test(page.url()) && !host.some((m) => m.type === "launch"), "own pages: a link to the app's own page loads there");

        // The text indexer (enyo.string.runTextIndexer -> PalmSystem.runTextIndexer,
        // as Memos and Calendar show a note): addresses, e-mail addresses
        // and phone numbers in the text become links; tags stay.
        await page.goto(NOTES);
        await page.waitForFunction(() => !!window.enyo && !!enyo.string && !!window.PalmSystem);
        const indexed = await page.evaluate(() => enyo.string.runTextIndexer(
            "Lunch at www.example.com/menu, mail ada@example.com or call (408) 555-1212. <b>http://palm.com/</b> on 2010-11-12"));
        check(indexed === 'Lunch at <a href="http://www.example.com/menu">www.example.com/menu</a>, mail <a href="mailto:ada@example.com">ada@example.com</a>'
              + ' or call <a href="tel:4085551212">(408) 555-1212</a>. <b><a href="http://palm.com/">http://palm.com/</a></b> on 2010-11-12',
              "text indexer: web, mailto and tel links in the text, tags kept, dates left: " + indexed);
        check(await page.evaluate(() => enyo.string.runTextIndexer('<a href="http://a.com">http://a.com</a> 555-0100', { phoneNumber: false }))
              === '<a href="http://a.com">http://a.com</a> 555-0100', "text indexer: links stay as they are; {phoneNumber: false} leaves numbers");
        check(await page.evaluate(() => enyo.string.runTextIndexer("&lt;http://a.com&gt;")) === '&lt;<a href="http://a.com">http://a.com</a>&gt;',
              "text indexer: an escaped bracket ends an address");
        await page.evaluate((html) => {
            const d = document.createElement("div");
            d.id = "indexed";
            d.style.cssText = "position:fixed;left:8px;top:60px;right:8px;z-index:99999;background:#fff;padding:6px;font:14px sans-serif";
            d.innerHTML = html;
            document.body.appendChild(d);
        }, indexed);
        await shot("notes-indexed");
        host.length = 0;
        await page.click("#indexed a[href^='tel:']");
        check(!!await launched("org.webosphoenix.phone", "tel:4085551212"), "text indexer: its phone link opens Phone");

        // Weather's Open-Meteo credit, a target=_blank link in a Phoenix app.
        await page.goto(appUrl("org.webosphoenix.weather"));
        await page.waitForSelector("[data-testid='attribution']", { timeout: 15000 });
        await page.locator("[data-testid='attribution']").scrollIntoViewIfNeeded();
        await shot("weather-credit");
        const weather = page.url();
        host.length = 0;
        popups = 0;
        await page.click("[data-testid='attribution']");
        const credit = await launched("com.palm.app.browser");
        check(!!credit && /^https:\/\/open-meteo\.com\/?/.test(credit.payload.params.target), "weather: the Open-Meteo credit opens the browser" + (credit ? ` (${credit.payload.params.target})` : ""));
        check(popups === 0 && page.url() === weather, "weather: no card of Weather with the site; Weather stays");

        // ---- The apps the links open, with the link ----------------------------------------------
        await page.goto(appUrl("org.webosphoenix.phone", { target: "tel:+1-555-0100" }));
        await page.waitForSelector("[data-testid='number-display']", { timeout: 10000 });
        await page.waitForTimeout(500);
        const dialed = (await page.textContent("[data-testid='number-display']")).replace(/\D/g, "");
        check(dialed === "15550100", `tel: Phone has the number on the dial pad (${dialed})`);
        await shot("phone-tel");
        await page.goto(appUrl("org.webosphoenix.messaging", { target: "sms:+15550111?body=On%20my%20way" }));
        await page.waitForSelector("[data-testid='message-input']", { timeout: 10000 });
        await page.waitForTimeout(500);
        const to = await page.textContent("[data-testid='recipient-chip']").catch(() => "");
        const body = await page.inputValue("[data-testid='message-input']");
        check(/5550111/.test(to.replace(/\D/g, "")) && body === "On my way", `sms: Messaging starts a message to the number with the text (${to}: ${body})`);
        await shot("messaging-sms");
        await page.goto(appUrl("org.webosphoenix.messaging", { target: "im:ada@example.com" }));
        await page.waitForSelector("[data-testid='message-input']", { timeout: 10000 });
        await page.waitForTimeout(300);
        check(/ada@example\.com/.test(await page.textContent("[data-testid='recipient-chip']").catch(() => "")), "im: Messaging starts a message to the address");
        // Email opens its composer in a window of its own (enyo.windows),
        // a page of its own here.
        const windows = [];
        const onPage = (p) => windows.push(p);
        context.on("page", onPage);
        await page.goto(appUrl("com.palm.app.email", { target: "mailto:ada@example.com?subject=Hello" }));
        let compose = null;
        for (let t = 0; t < 20000 && !compose; t += 500) {
            await page.waitForTimeout(500);
            for (const w of [page].concat(windows)) {
                const hit = await w.evaluate(() => {
                    const text = document.body.innerText + " " + Array.from(document.querySelectorAll("input,textarea")).map((e) => e.value).join(" ");
                    return /ada@example\.com/.test(text) && /Hello/.test(text);
                }).catch(() => false);
                if (hit) { compose = w; break; }
            }
        }
        context.off("page", onPage);
        check(!!compose, "mailto: Email starts a message to the address, with the subject");
        if (compose) await compose.screenshot({ path: path.join(outDir, "email-mailto.png") });

        // ---- QR Scanner: Call and Send Text ------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.scanner"));
        await page.evaluate(() => localStorage.setItem("org.webosphoenix.scanner.history", JSON.stringify([
            { id: "a", text: "tel:+15550100", format: "QRCode", at: Date.now() },
            { id: "b", text: "SMSTO:+15550111:See you", format: "QRCode", at: Date.now() - 1000 }
        ])));
        await page.goto(appUrl("org.webosphoenix.scanner"));
        const openScan = async (n) => {
            if (await page.locator("[data-testid='scan-again']").isVisible().catch(() => false))
                await page.click("[data-testid='scan-again']");
            if (!tablet && !(await page.locator("[data-testid='history']").isVisible().catch(() => false)))
                await page.click("[data-testid='show-history']");
            await page.locator(".sc-history-row").nth(n).click();
        };
        await openScan(0);
        host.length = 0;
        await page.click("[data-testid='act-call']");
        check(!!await launched("org.webosphoenix.phone", "tel:+15550100"), "scanner: Call opens Phone with the number");
        await openScan(1);
        host.length = 0;
        await page.click("[data-testid='act-sms']");
        check(!!await launched("org.webosphoenix.messaging", "sms:+15550111?body=See%20you"), "scanner: Send Text opens Messaging with the number and text");

        // The handler table itself (order, sites): tools/test-appmanager.cjs.
        check((await luna("luna://com.palm.applicationManager/getHandlerForUrl", { url: "https://m.tunes.example/" })).appId === "com.example.tunes",
              "the installed web app is the handler of its site");
        const real = errors.filter((e) => !/getUserMedia|NotFoundError|NotReadableError|Requested device not found/.test(e));
        check(real.length === 0, "no page errors" + (real.length ? ": " + real.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        server.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
