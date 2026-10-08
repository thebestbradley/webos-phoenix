#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Browse with the original webOS browser (com.palm.app.browser,
// isis-project/isis-browser) in headless Chromium. Its page view is the
// runtime's BrowserAdapter stand-in with the iframe engine (phoenix-sim
// uses a native view instead), so the pages here are local ones whose
// titles the frame can read:
//
//   start     no target: the start page with its address field
//   open      a launch target loads, and the address field shows it
//   address   typing an address and Enter goes there
//   history   back and forward move through the pages
//   handlers  mailto: links go to Email (command-resource-handlers.json)
//   download  a file the page view does not show is downloaded with
//             com.palm.downloadmanager: an ongoing activity with progress,
//             the Downloads drawer, the Downloads folder, Open in its app
//   print     Print in the app menu: the print dialog, Save as PDF, the
//             PDF in Documents and the job in the Print Manager
//   find      Find on Page (docs/M6-PLAN.md F4): the find bar counts the
//             matches and steps through them
//   private   Private Browsing: the red toolbar, no history
//   prefs     Block Ads & Trackers and Desktop Site are system preferences
//             the shell hears; the search engines include DuckDuckGo, Bing
//             and Startpage, and the address bar searches with the one
//             chosen
//
//   node tools/test-browser.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "browser-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const browserUrl = (params) => `${origin}/usr/palm/applications/com.palm.app.browser/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const CALCULATOR = "/usr/palm/applications/com.palm.app.calculator/index.html";
const JUSTTYPE = "/usr/palm/applications/com.palm.launcher/index.html";

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
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const page = await (await browser.newContext({ viewport })).newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource|tellurium/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const address = () => page.locator(".addressbar input:visible").first();
        // The page in the WebView: its address and title, once loaded.
        const framePath = () => page.evaluate(() => {
            const f = document.querySelector("object[type='application/x-palm-browser'] iframe");
            try { return f && f.contentDocument ? f.contentDocument.location.pathname : ""; } catch (e) { return "cross-origin"; }
        });
        const waitForFrame = async (p) => {
            for (let t = 0; t < 8000; t += 200) {
                if ((await framePath()) === p) return true;
                await page.waitForTimeout(200);
            }
            return false;
        };
        const button = (icon) => page.locator(`.actionbar:visible .enyo-tool-button:has(.enyo-button-icon[style*='${icon}'])`).first();

        await page.goto(browserUrl());
        await page.waitForTimeout(2500);
        check(await address().isVisible(), "start: the address field is shown");
        await shot("start");

        await page.goto(browserUrl({ target: CALCULATOR }));
        check(await waitForFrame(CALCULATOR), "open: the launch target loads in the page view");
        await page.waitForTimeout(800);
        check((await address().inputValue()).endsWith(CALCULATOR), "open: the address field shows it");
        await shot("calculator");

        await address().click();
        await address().fill(origin + JUSTTYPE);
        await page.keyboard.press("Enter");
        check(await waitForFrame(JUSTTYPE), "address: typing an address and Enter goes there");
        await page.waitForTimeout(800);
        await shot("address");

        await button("menu-icon-back").click();
        check(await waitForFrame(CALCULATOR), "history: back returns to the first page");
        await page.waitForTimeout(500);
        await button("menu-icon-forward").click();
        check(await waitForFrame(JUSTTYPE), "history: forward goes on again");

        // A mailto: link in a page is handed to Email: the browser's
        // WebView redirects the system's schemes (enyo WebView
        // addSystemRedirects -> BrowserAdapter addUrlRedirect), the page
        // view hands the link back (urlRedirected) and the browser opens it
        // (BrowserApp.openResource -> applicationManager open {target}).
        // Just Type, the page shown now, loads the runtime and reads its
        // appinfo.json with a synchronous request: leaving it before it has
        // loaded can stall the next navigation behind that request on a
        // busy machine, so it finishes loading first.
        await page.waitForFunction(() => {
            const f = document.querySelector("object[type='application/x-palm-browser'] iframe");
            try { return !!f && f.contentDocument.readyState === "complete"; } catch (e) { return true; }
        }, null, { timeout: 30000 });
        const LINKS = "/__links/page.html";
        await page.route("**/__links/page.html", (route) => route.fulfill({ contentType: "text/html", body:
            "<!doctype html><title>Links</title><body><p><a id='mail' href='mailto:ada@example.com?subject=Hi'>Write to Ada</a></p>" +
            "<p><a id='here' href='" + CALCULATOR + "'>Calculator</a></p></body>" }));
        await page.goto(browserUrl({ target: origin + LINKS }));
        check(await waitForFrame(LINKS), "handlers: a page with links loads");
        await page.waitForTimeout(500);
        host.length = 0;
        await page.frameLocator("object[type='application/x-palm-browser'] iframe").locator("#mail").click();
        await page.waitForTimeout(800);
        const mail = host.find((m) => m.type === "launch" && m.payload.id === "com.palm.app.email");
        check(!!mail && mail.payload.params.target === "mailto:ada@example.com?subject=Hi", "handlers: a tapped mailto: link opens Email with it");
        check(await waitForFrame(LINKS), "handlers: the page stays where it was");
        await page.frameLocator("object[type='application/x-palm-browser'] iframe").locator("#here").click();
        check(await waitForFrame(CALCULATOR), "handlers: a web link loads in the page view");

        // Downloads. A file the page view does not show comes back to the
        // browser as BrowserAdapter's mimeNotSupported (phoenix-sim's native
        // view sends it when Chromium would download); the browser asks who
        // opens the type and has com.palm.downloadmanager fetch it. The
        // simulated service fetches through serve-rootfs.py's proxy, which
        // reports the body's progress meanwhile; both are answered here.
        const luna = (u, p) => page.evaluate(([uri, params]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(uri, JSON.stringify(params || {}));
        }), [u, p]);
        const waitFor = async (what, ms) => {
            for (let t = 0; t < (ms || 8000); t += 100) {
                const v = await what();
                if (v) return v;
                await page.waitForTimeout(100);
            }
            return null;
        };
        const PDF_URL = "https://example.org/docs/field-guide.pdf";
        const pdf = fs.readFileSync(path.join(REPO, "apps/media-samples/media/documents/field-guide.pdf"));
        let received = 0, release = null;
        const arrived = new Promise((r) => { release = r; });
        await page.route("**/__phoenix/proxy/progress**", (route) => route.fulfill({
            contentType: "application/json", body: JSON.stringify({ received, total: pdf.length }) }));
        await page.route("**/__phoenix/proxy", async (route) => {
            const req = JSON.parse(route.request().postData() || "{}");
            if (req.url !== PDF_URL) return route.continue();
            await arrived;
            await route.fulfill({ contentType: "application/json", body: JSON.stringify({
                status: 200, headers: { "content-type": "application/pdf" }, url: PDF_URL, bodyBase64: pdf.toString("base64") }) });
        });
        host.length = 0;
        await page.evaluate((u) => {
            document.querySelector("object[type='application/x-palm-browser']").eventListener.mimeNotSupported("application/pdf", u);
        }, PDF_URL);
        const ongoing = () => host.filter((m) => m.type === "ongoing").map((m) => m.payload);
        const started = await waitFor(() => ongoing().find((o) => o.title === "field-guide.pdf"));
        check(!!started && started.appId === "com.palm.app.browser" && started.params && started.params.toasterOpen === "downloads",
            "download: an ongoing activity in the notification area, opening the browser's Downloads");
        received = Math.floor(pdf.length / 2);
        const half = await waitFor(() => ongoing().find((o) => o.progress >= 45 && o.progress <= 50));
        check(!!half && /^Downloading \d+ KB of \d+ KB$/.test(half.body), "download: its progress comes from the proxy (" + (half && half.body) + ")");
        const row = page.locator(".enyo-toaster .item-progress:has-text('field-guide.pdf')").first();
        check(await row.isVisible(), "download: the browser's Downloads drawer lists it");
        await shot("download-progress");
        release();
        check(!!await waitFor(() => ongoing().find((o) => o.clear && o.id === started.id)), "download: the activity goes when it is done");
        const open = page.locator(".enyo-toaster:visible .enyo-button:has-text('Open')").first();
        check(!!await waitFor(() => open.isVisible()), "download: then it can be opened from the list");
        await shot("download-done");
        const stat = await luna("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Downloads/field-guide.pdf" });
        const size = stat.entry && stat.entry.size;
        check(size === pdf.length, "download: the file is in the Downloads folder, whole (" + size + " bytes)");
        host.length = 0;
        await open.click();
        const launched = await waitFor(() => host.find((m) => m.type === "launch"));
        check(!!launched && launched.payload.id === "org.webosphoenix.pdfview" && launched.payload.params.target === "/media/internal/Downloads/field-guide.pdf",
            "download: Open hands it to PDF View");
        const hist = await luna("luna://com.palm.downloadmanager/getAllHistory", { owner: "com.palm.app.browser" });
        const item = (hist.items || []).find((h) => h.destFile === "field-guide.pdf");
        check(!!item && item.state === "completed" && item.fileExistsOnFilesys === true && JSON.parse(item.recordString).ticket === item.ticket,
            "download: the history lists it as the browser reads it again");
        // A type no app opens: the browser says so, as on webOS.
        await page.evaluate(() => {
            document.querySelector("object[type='application/x-palm-browser']").eventListener.mimeNotSupported("application/zip", "https://example.org/a.zip");
        });
        check(!!await waitFor(() => page.getByText("Cannot open MIME type").first().isVisible()), "download: a type nothing opens says \"Cannot open MIME type\"");
        await page.locator(".enyo-popup:visible .enyo-button").first().click();

        // Print: the app menu's Print opens Enyo 1.0's print dialog, which
        // finds the print manager's "Save as PDF" printer; Print renders the
        // page (here its text: the iframe engine) into a PDF in Documents.
        await page.goto(browserUrl({ target: CALCULATOR }));
        await waitForFrame(CALCULATOR);
        // Isis keeps Print disabled while the page loads, which it counts
        // until a second after the progress bar reached 100 %.
        await page.waitForTimeout(1600);
        host.length = 0;
        await page.evaluate(() => __phoenixRuntime.openAppMenu());
        const printItem = page.locator(".enyo-appmenu .enyo-menuitem:has-text('Print')").first();
        check(!!await waitFor(() => printItem.isVisible()), "print: the app menu has Print");
        await printItem.click();
        const dialog = page.locator(".print-dialog:visible");
        check(!!await waitFor(() => dialog.getByText("Save as PDF").first().isVisible()), "print: the print dialog offers Save as PDF");
        check(!!await waitFor(() => dialog.getByText("Number of Copies").first().isVisible()), "print: and its options (the dialog's picker kinds exist)");
        await shot("print-dialog");
        await dialog.locator(".enyo-button:has-text('Print')").last().click();
        const saved = await waitFor(() => host.find((m) => m.type === "notification" && m.payload.title === "Saved as PDF"), 10000);
        check(!!saved && saved.payload.appId === "org.webosphoenix.printmanager", "print: \"Saved as PDF\" (" + (saved && saved.payload.body) + ")");
        const jobs = await luna("luna://com.palm.printmgr/jobs/list", {});
        const printed = (jobs.jobs || [])[0];
        check(!!printed && printed.state === "Done" && printed.appName === "Browser" && printed.pages >= 1, "print: the Print Manager lists the job, done");
        const pdfStat = printed && await luna("luna://org.webosphoenix.filemanager/stat", { path: printed.file });
        check(!!pdfStat && pdfStat.entry && pdfStat.entry.size > 300 && /^\/media\/internal\/Documents\/.+\.pdf$/.test(printed.file),
            "print: the PDF is in Documents (" + (printed && printed.file) + ")");
        const head = printed && await luna("luna://org.webosphoenix.filemanager/read", { path: printed.file, encoding: "base64" });
        const headText = head && (head.encoding === "base64" ? Buffer.from(head.data || "", "base64").toString("latin1") : head.data || "");
        check(/^%PDF-/.test(headText || ""), "print: and it is a PDF");
        await page.goto(`${origin}/usr/palm/applications/org.webosphoenix.printmanager/index.html?launchParams=` +
                        encodeURIComponent(JSON.stringify({ jobID: printed && printed.jobID })));
        const jobRow = page.locator(`[data-testid='job-${printed && printed.jobID}']`);
        check(!!await waitFor(() => jobRow.isVisible()) && /Calculator/.test(await jobRow.textContent()) && /saved as PDF/.test(await jobRow.textContent()),
            "print: the Print Manager shows the job (" + (await jobRow.textContent().catch(() => "")) + ")");
        check(await page.locator(".pm-shown").count() === 1, "print: the job a notification opened is marked");
        await shot("printmanager");

        // ---- The community's browser features (docs/M6-PLAN.md F4 item 7) ----
        // Same-origin pages the iframe engine can read and search.
        const FIND = "/__test/find.html", PRIVATE = "/__test/private.html", AFTER = "/__test/after.html";
        await page.route("**/__test/*.html", (route) => route.fulfill({ contentType: "text/html", body:
            "<!doctype html><title>" + (route.request().url().includes("private") ? "Private page" : "Fruit") + "</title>" +
            "<body><p>Apple banana apple cherry apple.</p><p>The apple tree and the apple pie.</p></body>" }));
        await page.route("https://duckduckgo.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>DuckDuckGo</title>ddg" }));
        const comp = (expr) => page.evaluate((e) => { const c = new Function("return enyo.$.browserApp." + e)(); return c && c.hasNode() ? c.id : null; }, expr);
        const clickComp = async (expr) => { const id = await comp(expr); if (id) await page.click("#" + id); return !!id; };
        const menuItem = (name) => page.locator(`.enyo-appmenu .enyo-menuitem:has-text('${name}')`).first();
        const history = async () => ((await luna("luna://com.palm.db/find", { query: { from: "com.palm.browserhistory:1" } })).results || []).map((h) => h.url);

        await page.goto(browserUrl({ target: origin + FIND }));
        check(await waitForFrame(FIND), "find: the page loads");
        await page.evaluate(() => __phoenixRuntime.openAppMenu());
        check(!!await waitFor(() => menuItem("Find on Page").isVisible()), "find: the app menu has Find on Page");
        await menuItem("Find on Page").click();
        const findField = async () => page.locator("#" + await comp("$.browser.$.findBar.$.input") + " input").first();
        check(!!await waitFor(async () => (await comp("$.browser.$.findBar.$.input")) !== null), "find: the find bar opens");
        await (await findField()).click();
        await (await findField()).pressSequentially("apple", { delay: 30 });
        const count = async () => page.evaluate(() => enyo.$.browserApp.$.browser.$.findBar.$.count.getContent());
        check(!!await waitFor(async () => (await count()) === "1 of 5"), "find: the bar counts the matches (" + await count() + ")");
        await shot("find");
        await clickComp("$.browser.$.findBar.$.next");
        check(!!await waitFor(async () => (await count()) === "2 of 5"), "find: next goes to the second (" + await count() + ")");
        await clickComp("$.browser.$.findBar.$.prev");
        await clickComp("$.browser.$.findBar.$.prev");
        check(!!await waitFor(async () => (await count()) === "5 of 5"), "find: prev goes back, round to the last (" + await count() + ")");
        await (await findField()).fill("zebra");
        check(!!await waitFor(async () => (await count()) === "No matches"), "find: a word not there says so");
        check(!!await waitFor(async () => (await history()).some((u) => u.endsWith(FIND))), "private: off, the page is in the history");

        // Private Browsing: the toolbar turns red; pages go to no history.
        await page.evaluate(() => __phoenixRuntime.openAppMenu());
        await waitFor(() => menuItem("Private Browsing").isVisible());
        await menuItem("Private Browsing").click();
        const barColour = () => page.evaluate(() => getComputedStyle(document.querySelector(".actionbar.enyo-toolbar")).backgroundColor);
        check(!!await waitFor(async () => (await barColour()) === "rgb(155, 27, 27)"), "private: the toolbar is red (" + await barColour() + ")");
        await address().click();
        await address().fill(origin + PRIVATE);
        await page.keyboard.press("Enter");
        check(await waitForFrame(PRIVATE), "private: browsing goes on");
        await shot("private");
        await page.evaluate(() => __phoenixRuntime.openAppMenu());
        await waitFor(() => menuItem("Private Browsing").isVisible());
        check(await page.evaluate(() => enyo.$.browserApp.$.phoenixPrivateItem.getChecked()), "private: the menu item is checked");
        await menuItem("Private Browsing").click();
        check(!!await waitFor(async () => (await barColour()) !== "rgb(155, 27, 27)"), "private: off again, the toolbar is as before");
        // A page after it is history again; the private one, before it, never was.
        await address().click();
        await address().fill(origin + AFTER);
        await page.keyboard.press("Enter");
        check(!!await waitFor(async () => (await history()).some((u) => u.endsWith(AFTER))), "private: off, pages are history again");
        check(!(await history()).some((u) => u.endsWith(PRIVATE)), "private: the private page is not in the history");

        // Preferences: the content blocker and the user agent, system
        // preferences the shell applies (systemStatus browser).
        host.length = 0;
        await page.evaluate(() => __phoenixRuntime.openAppMenu());
        await waitFor(() => menuItem("Preferences").isVisible());
        await menuItem("Preferences").click();
        check(!!await waitFor(() => page.getByText("Block Ads & Trackers").first().isVisible()), "prefs: Block Ads & Trackers is in Content");
        // The pane has faded over to Preferences (a tap while it fades is
        // lost: under load the toggle was clicked mid-transition and stayed
        // off), and they show the stored system preferences.
        check(!!await waitFor(() => page.evaluate(() => {
            const a = enyo.$.browserApp;
            return !a.$.pane._transitioning && a.isPreferencesShowing() && "browserContentBlocker" in (a.systemPreferences || {});
        })), "prefs: the page is up, with the stored preferences");
        await clickComp("$.preferences.$.browserContentBlocker");
        const sysPref = async (k) => (await luna("luna://com.palm.systemservice/getPreferences", { keys: [k] }))[k];
        check(!!await waitFor(async () => (await sysPref("browserContentBlocker")) === true), "prefs: blocking is a system preference");
        const lastStatus = () => (host.filter((m) => m.type === "systemStatus").pop() || { payload: {} }).payload;
        check(!!await waitFor(() => lastStatus().browser && lastStatus().browser.contentBlocker === true), "prefs: the shell hears it");
        await clickComp("$.preferences.$.browserUserAgent");
        const desktop = page.locator(".enyo-popup:visible .enyo-item:has-text('Desktop Site')").first();
        check(!!await waitFor(() => desktop.isVisible()), "prefs: Websites offers the desktop site");
        await desktop.click();
        check(!!await waitFor(async () => (await sysPref("browserUserAgent")) === "desktop"), "prefs: Desktop Site is a system preference");
        check(!!await waitFor(() => lastStatus().browser && lastStatus().browser.userAgent === "desktop"), "prefs: the shell hears it too");
        await clickComp("$.preferences.$.searchPreference");
        const ddg = page.locator(".enyo-popup:visible .enyo-item:has-text('DuckDuckGo')").first();
        check(!!await waitFor(() => ddg.isVisible()), "prefs: the engines include DuckDuckGo");
        check(await page.locator(".enyo-popup:visible .enyo-item:has-text('Startpage')").first().isVisible()
              && await page.locator(".enyo-popup:visible .enyo-item:has-text('Bing')").first().isVisible(), "prefs: ... Bing and Startpage");
        await shot("prefs-engines");
        await ddg.click();
        const engine = async () => (await luna("luna://com.palm.universalsearch/getSearchPreference", { key: "defaultSearchEngine" })).defaultSearchEngine;
        check(!!await waitFor(async () => (await engine()) === "duckduckgo"), "prefs: the default engine is Just Type's too");
        await shot("prefs");
        // Searching from the address bar uses it.
        await page.goto(browserUrl());
        await waitFor(() => address().isVisible());
        await address().click();
        await address().fill("webos phoenix");
        await page.keyboard.press("Enter");
        const frameSrc = () => page.evaluate(() => { const f = document.querySelector("object[type='application/x-palm-browser'] iframe"); return f ? f.src : ""; });
        check(!!await waitFor(async () => /^https:\/\/duckduckgo\.com\/\?q=webos(%20|\+)phoenix/.test(await frameSrc())),
            "prefs: the address bar searches DuckDuckGo (" + await frameSrc() + ")");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
