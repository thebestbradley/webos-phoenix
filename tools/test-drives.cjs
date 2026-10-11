#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The drives end to end (docs/SHARE-AND-FILES.md "Drives",
// docs/SYNERGY-CONNECTORS.md 7), without the internet, in headless Chromium
// with runtime/phoenix-runtime.js against the stand-in servers of
// apps/connectors/drives/service/test/fake-drives.cjs and the real
// Marketplace catalog (server/marketplace, PHP):
//   1. Connections lists the drives under Files (Nextcloud featured); the
//      package, Phoenix's own from the catalog the device ships with,
//      installs without Developer Mode;
//   2. Accounts: Nextcloud's sign-in page; Sign In opens the server's login
//      page in the browser (Login Flow v2), which is granted; the page goes
//      on by itself; Create Account. Box, with no client id in this build,
//      says "not available in this build". Dropbox signs in on its own page
//      in the system's sign-in sheet;
//   3. Files: the drives beside the favourites; Nextcloud's folders; a
//      picture opened (downloaded through the cache); a folder made;
//   4. Screenshot: Save to Files, Up to the places, into Nextcloud's Photos:
//      uploaded;
//   5. Files: a file of the device shared to Save to Files, into Dropbox;
//   6. the file picker (SF2): Files, the places, Nextcloud, a document:
//      the app gets the device's copy and where it came from;
//   7. a big upload: its progress in the notification area's ongoing
//      activities, then cleared;
//   8. offline: the drive's folder says it cannot be reached, with Try Again.
//
//   node tools/test-drives.cjs [--phone] [--out DIR]
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
const { createFakeDrives } = require(path.join(REPO, "apps/connectors/drives/service/test/fake-drives.cjs"));
const args = process.argv.slice(2);
const phone = args.includes("--phone");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "drives-tests", phone ? "phone" : "tablet");
const viewport = phone ? { width: 320, height: 452 } : { width: 1024, height: 740 };
const NC = "com.webosphoenix.drive.nextcloud";

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
    for (const f of ["apps/files/dist/index.html", "apps/sharesheet/dist/index.html", "apps/marketplace/dist/index.html", "apps/screenshot/dist/index.html",
                     "apps/shared/connector-kit/lib/drives.js"]) {
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
    const fake = await createFakeDrives().start(0);
    const catalogPort = await servers.freePort();
    const catalog = await servers.startCatalog({ port: catalogPort });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-drives-pack-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const appUrl = (id, params, file) => `${origin}/usr/palm/applications/${id}/${file || "index.html"}` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 10000, 100);
        // The drives' package, Phoenix's own (an admin's upload), in the catalog.
        const drivesIpk = pack(path.join(REPO, "apps/connectors/drives"), packDir, { vendor: false, namespaces: ["org.webosphoenix", "com.webosphoenix"] });
        const up = await catalog.api("POST", "/api/apps/packages", new Uint8Array(fs.readFileSync(drivesIpk.file)), catalog.admin);
        check(up.status === 200 && up.app.kind === "connector", "the drives package, Phoenix's own, is taken by the catalog (" + (up.error || up.app.kind) + ")");
        await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);

        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        // The catalog the device ships with ("phoenix") is this one, its key the device's.
        await context.route("**/usr/share/phoenix/host.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ marketplaceCatalog: true }) }));
        await context.route("**/etc/palm/marketplace/sources.json", async (r) => {
            const res = await r.fetch();
            const json = await res.json();
            json.sources.find((x) => x.id === "phoenix").url = catalog.catalogUrl;
            await r.fulfill({ response: res, body: JSON.stringify(json) });
        });
        const errors = [], host = [];
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(p.url().replace(/\?.*$/, "").replace(/^.*\/applications\//, "") + ": " + e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                if (process.env.DRIVES_VERBOSE && !t.startsWith("__phoenix__")) console.log("    [" + m.type() + "] " + t);
            });
        };
        context.on("page", watch);
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const shellSays = (p) => p.evaluate((st) => window.__phoenixRuntime.applyHostStatus({ marketplaceCatalog: st }, { writer: false }),
            { url: catalog.url + "/", error: "", settingUp: false, state: "running", key: catalog.key });

        // ---- 1. Connections: the drives, installed from the catalog -------------------------------------
        const market = await context.newPage();
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.evaluate(() => localStorage.clear());
        // This build has Phoenix's Dropbox app registered (the test server's), not Box's or the others'.
        await market.evaluate((c) => localStorage.setItem("phoenix:systemConfig:drives/clients.json", JSON.stringify({ dropbox: c.dropbox })), fake.clients());
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.waitForSelector("[data-testid=tab-connections]", { timeout: 15000 });
        // A page open before the install (System UI, Email: they stay open) serves the new service too.
        const early = await context.newPage();
        await early.goto(appUrl("org.webosphoenix.files"));
        await early.waitForSelector("[data-testid=file-list]");
        await shellSays(market);
        await luna(market, "luna://org.webosphoenix.service.packages/refresh", {});
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.waitForSelector("[data-testid=tab-connections]");
        await shellSays(market);
        await market.click("[data-testid=tab-connections]");
        const row = "[data-testid=group-files] [data-testid='account-" + NC + "']";
        await market.waitForSelector(row, { timeout: 20000 });
        const filesGroup = await market.textContent("[data-testid=group-files]");
        check(["Nextcloud", "ownCloud", "WebDAV", "S3 Storage", "Dropbox", "OneDrive", "Google Drive", "Box"].every((t) => filesGroup.includes(t)),
              "Connections lists the drives under Files");
        await market.locator("[data-testid=group-files]").scrollIntoViewIfNeeded();
        await shot(market, "1-connections-files");
        await market.click(row);
        await market.waitForSelector("[data-testid=account-page]");
        const pageText = await market.textContent("[data-testid=account-page]");
        check(/Phoenix's servers: none/.test(pageText) && /Don't have an account\? Sign up/.test(await market.textContent("[data-testid=sign-up-line]").catch(() => "")),
              "Nextcloud's page: no Phoenix server in between, and a sign-up link");
        await shot(market, "2-nextcloud-page");
        await market.click("[data-testid=connector-install]");
        await market.waitForSelector("[data-testid=set-up]", { timeout: 30000 }).catch(async (e) => { await shot(market, "3-install-failed"); throw e; });
        check(await market.locator("[data-testid=devmode-needed]").count() === 0, "installed without Developer Mode (Phoenix's own, from the catalog the device ships with)");
        const tpl = (await luna(market, "luna://com.palm.service.accounts/listAccountTemplates", {})).results.map((t) => t.templateId);
        check(tpl.includes(NC) && tpl.includes("com.webosphoenix.drive.dropbox") && tpl.includes("com.webosphoenix.drive.s3"), "Accounts has the drives' templates");
        await shot(market, "3-installed");
        const info = await luna(early, "luna://org.webosphoenix.service.drives/providerInfo", { templateId: NC });
        check(info.returnValue !== false && info.provider === "nextcloud", "a page open before the install reaches the drives' service (" + (info.errorText || "ok") + ")");
        await early.close();

        // ---- 2. Accounts: Nextcloud with Login Flow v2; Box not in this build; Dropbox with OAuth ------------
        const accounts = await context.newPage();
        const wizardOf = async (templateId) => {
            await accounts.goto(appUrl("com.palm.app.accounts", { templateId }));
            const w = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.drives\/accounts\/wizard\.html/.test(f.url())), 15000);
            if (!w) throw new Error("no sign-in page for " + templateId);
            await w.waitForSelector(".drives-wizard", { timeout: 10000 }).catch(async (e) => { await shot(accounts, "wizard-failed"); console.log("errors: " + JSON.stringify(errors)); throw e; });
            await accounts.waitForTimeout(800);
            return w;
        };
        let w = await wizardOf("com.webosphoenix.drive.box");
        await w.waitForSelector(".drives-unavailable", { state: "visible", timeout: 5000 }).catch(() => {});
        check(/Box is not available in this build/.test(await w.locator(".drives-unavailable").textContent().catch(() => "")),
              "Box, with no client id in this build: \"not available in this build\", no Sign In");
        await shot(accounts, "4-box-not-available");

        w = await wizardOf(NC);
        check(/Don't have an account\? Sign up/.test(await w.locator(".accounts-signup").textContent().catch(() => "")), "Nextcloud's sign-in page has the sign-up link");
        await w.locator("input").first().fill(fake.origin);
        await w.locator("input").first().press("Tab");
        await shot(accounts, "5-nextcloud-sign-in");
        host.length = 0;
        await w.getByText("Sign In", { exact: true }).click();
        const opened = await until(() => host.find((m) => JSON.stringify(m.payload || {}).indexOf("/login/v2/flow/") >= 0), 10000);
        check(!!opened, "Sign In opens the server's own login page in the browser");
        await accounts.waitForTimeout(300);
        await shot(accounts, "6-nextcloud-waiting");
        const token = /\/login\/v2\/flow\/([0-9a-f]+)/.exec(JSON.stringify(opened && opened.payload))[1];
        await fetch(fake.origin + "/login/v2/grant/" + token);
        const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 20000 }).catch(() => {});
        check(await create.isVisible().catch(() => false), "granted on the server's page: the sign-in page goes on by itself, Create Account");
        await accounts.waitForTimeout(500);
        await shot(accounts, "7-nextcloud-capabilities");
        await create.click();
        const nc = await until(async () => (await luna(accounts, "luna://com.palm.service.accounts/listAccounts", { templateId: NC })).results[0], 10000);
        check(nc && /^phoenix@127\.0\.0\.1:\d+$/.test(nc.username) && nc.capabilityProviders.some((c) => c.capability === "DOCUMENTS"),
              "the Nextcloud account exists, with Files (DOCUMENTS)");

        w = await wizardOf("com.webosphoenix.drive.dropbox");
        await w.getByText("Sign In", { exact: true }).click();
        const sheet = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.sharesheet\/index\.html/.test(f.url())), 15000);
        const providerPage = await until(() => accounts.frames().find((f) => f.url().indexOf(fake.origin + "/oauth/dropbox/authorize") === 0), 15000);
        check(!!sheet && !!providerPage, "Dropbox: its own sign-in page in the system's sign-in sheet");
        if (providerPage) {
            await providerPage.waitForSelector("#allow");
            await accounts.waitForTimeout(300);
            await shot(accounts, "8-dropbox-sign-in-sheet");
            await providerPage.click("#allow");
        }
        const create2 = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create2.waitFor({ timeout: 20000 }).catch(() => {});
        await create2.click().catch(() => {});
        const dbx = await until(async () => (await luna(accounts, "luna://com.palm.service.accounts/listAccounts", { templateId: "com.webosphoenix.drive.dropbox" })).results[0], 10000);
        check(dbx && dbx.username === "phoenix@dropbox.test", "the Dropbox account exists (its e-mail from the API)");
        const creds = dbx && await luna(accounts, "luna://com.palm.service.accounts/readCredentials", { accountId: dbx._id, name: "common" });
        check(creds && creds.credentials && creds.credentials.oauthKey && !/at-dropbox/.test(JSON.stringify(creds)), "its token stays in the key store; the account keeps its key");
        await accounts.waitForTimeout(600);
        await shot(accounts, "9-accounts");

        // ---- 3. Files: the drives as places ---------------------------------------------------------------
        const files = await context.newPage();
        await files.goto(appUrl("org.webosphoenix.files"));
        await files.waitForSelector("[data-testid=file-list]");
        if (!phone) {
            await files.waitForSelector("[data-testid=drives-title]", { timeout: 10000 });
            check(await files.locator("[data-testid='drive-Nextcloud']").count() === 1 && await files.locator("[data-testid='drive-Dropbox']").count() === 1,
                  "Files: Nextcloud and Dropbox beside the favourites");
            await files.click("[data-testid='drive-Nextcloud']");
        } else {
            await files.goto(appUrl("org.webosphoenix.files", { path: "/media/drives/" + nc._id }));
        }
        await files.waitForSelector("[data-testid='file-Photos']", { timeout: 15000 }).catch(async (e) => { await shot(files, "files-failed"); console.log("errors: " + JSON.stringify(errors)); throw e; });
        check((await files.textContent("[data-testid=folder-title]")).trim() === "Nextcloud", "its folder is called Nextcloud");
        check(/Drives/.test(await files.textContent("[data-testid=path-bar]")), "the path bar starts at Drives");
        await shot(files, "10-files-nextcloud");
        await files.click("[data-testid='file-Photos']");
        await files.waitForSelector("[data-testid='file-lake.png']", { timeout: 15000 });
        await shot(files, "11-files-photos");
        await files.click("[data-testid='file-lake.png']");
        await files.waitForSelector(".fm-viewer-image", { timeout: 15000 });
        await files.waitForTimeout(500);
        const shown = await files.evaluate(() => { const i = document.querySelector(".fm-viewer-image"); return i && i.naturalWidth; });
        check(shown === 64, "a picture of the drive opens (downloaded through the device's cache): " + shown + " px");
        await shot(files, "12-files-picture");
        await files.evaluate(() => window.__phoenixRuntime.back());
        await files.waitForTimeout(300);

        // ---- 4. Screenshot: Save to Files into Nextcloud -----------------------------------------------------
        const shotPage = await context.newPage();
        await shotPage.goto(appUrl("org.webosphoenix.screenshot"));
        const data = await shotPage.evaluate(() => {
            const c = document.createElement("canvas");
            c.width = 320; c.height = 480;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#1e4a8a"; ctx.fillRect(0, 0, 320, 480);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 320, 28);
            return c.toDataURL("image/png").split(",")[1];
        });
        const capture = await shotPage.evaluate(([d, t]) => window.__phoenixRuntime.saveScreenshot({ data: d, app: "Files", time: t }),
                                                [data, new Date(2026, 9, 11, 9, 30, 0).getTime()]);
        await shotPage.goto(appUrl("org.webosphoenix.screenshot", { path: capture }));
        // A stroke of markup, then Save > Save to Files (the edited picture: its bytes go to the drive).
        await shotPage.waitForSelector("[data-testid=markup]", { timeout: 15000 });
        await shotPage.click("[data-testid=markup]");
        const stage = await shotPage.locator("[data-testid=canvas]").boundingBox();
        await shotPage.mouse.move(stage.x + 20, stage.y + 40);
        await shotPage.mouse.down();
        await shotPage.mouse.move(stage.x + 80, stage.y + 100, { steps: 4 });
        await shotPage.mouse.up();
        await shotPage.click("[data-testid=mode-done]");
        await shotPage.waitForSelector("[data-testid=save]", { timeout: 15000 });
        await shotPage.click("[data-testid=save]");
        await shotPage.click(".pui-popup >> text=Save to Files…");
        const saveFrame = await (await shotPage.waitForSelector("iframe[data-phoenix-sheet=save]")).contentFrame();
        await saveFrame.waitForSelector("[data-testid=save-picker]");
        await saveFrame.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Documents");
        await saveFrame.click("[data-testid=save-up]");
        await saveFrame.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Internal Storage");
        await saveFrame.click("[data-testid=save-up]");
        await saveFrame.waitForSelector("[data-testid='save-folder-Nextcloud']", { timeout: 10000 });
        check(await saveFrame.locator("[data-testid='save-folder-Dropbox']").count() === 1, "Save to Files: the places, Internal Storage and the drives");
        await shot(shotPage, "13-save-places");
        await saveFrame.click("[data-testid='save-folder-Nextcloud']");
        await saveFrame.click("[data-testid='save-folder-Photos']", { timeout: 15000 });
        await saveFrame.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Photos");
        await shot(shotPage, "14-save-nextcloud-photos");
        await saveFrame.click("[data-testid=save-confirm]");
        await shotPage.waitForSelector("iframe[data-phoenix-sheet]", { state: "detached", timeout: 20000 });
        const savedName = capture.replace(/^.*\//, "");
        const uploaded = await until(() => fake.trees.dav.byPath("/Photos/" + savedName), 15000);
        check(!!uploaded && uploaded.bytes.slice(1, 4).toString() === "PNG", "the capture is uploaded to Nextcloud's Photos (" + savedName + ")");

        // ---- 5. Files: share a file of the device to Save to Files, into Dropbox -------------------------------
        await files.goto(appUrl("org.webosphoenix.files", { path: "/media/internal/Documents" }));
        await files.waitForSelector("[data-testid=file-list]");
        await luna(files, "luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Documents/minutes.txt", data: "Phoenix minutes\n", encoding: "utf8" });
        await files.goto(appUrl("org.webosphoenix.files", { path: "/media/internal/Documents" }));
        await files.waitForSelector("[data-testid='file-minutes.txt']");
        await files.click("[data-testid=select]");
        await files.click("[data-testid='file-minutes.txt']");
        await files.click("[data-testid=share]");
        const shareFrame = await (await files.waitForSelector("iframe[data-phoenix-sheet=share]")).contentFrame();
        await shareFrame.click("[data-testid=share-files]");
        const save2 = await (await files.waitForSelector("iframe[data-phoenix-sheet=save]")).contentFrame();
        await save2.waitForSelector("[data-testid=save-picker]");
        await save2.waitForFunction(() => /\S/.test(document.querySelector("[data-testid=save-folder]").textContent));
        // The last folder used: Nextcloud's Photos. Up twice to the places, then Dropbox.
        await save2.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Photos", null, { timeout: 15000 });
        await save2.click("[data-testid=save-up]");
        await save2.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Nextcloud");
        await save2.click("[data-testid=save-up]");
        await save2.click("[data-testid='save-folder-Dropbox']");
        await save2.click("[data-testid='save-folder-Documents']", { timeout: 15000 });
        await save2.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Documents");
        await shot(files, "15-share-to-dropbox");
        await save2.click("[data-testid=save-confirm]");
        await files.waitForSelector("iframe[data-phoenix-sheet]", { state: "detached", timeout: 20000 });
        const inDropbox = await until(() => fake.trees.dropbox.byPath("/Documents/minutes.txt"), 15000);
        check(!!inDropbox && inDropbox.bytes.toString() === "Phoenix minutes\n", "shared from Files to Save to Files: uploaded to Dropbox's Documents");
        await files.waitForSelector("[data-testid=toast]", { timeout: 5000 }).catch(() => {});
        check(/Saved to Documents/.test(await files.textContent("[data-testid=toast]").catch(() => "")), "Files says where it went");

        // ---- 6. The file picker (SF2): a document of a drive --------------------------------------------------
        const pickP = files.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call("luna://org.webosphoenix.filepicker/pick", JSON.stringify({ kinds: ["file"], title: "Attach a File" }));
        }));
        const pick = await (await files.waitForSelector("iframe[data-phoenix-sheet=pick]")).contentFrame();
        await pick.waitForSelector("[data-testid=pick-folder]");
        await pick.click("[data-testid=pick-cancel]");
        await pick.waitForSelector("[data-testid='pick-folder-Nextcloud']", { timeout: 10000 });
        check(await pick.locator("[data-testid='pick-folder-Internal Storage']").count() === 1, "the file picker: Back from Internal Storage shows the places");
        await shot(files, "16-pick-places");
        await pick.click("[data-testid='pick-folder-Nextcloud']");
        await pick.click("[data-testid='pick-folder-Documents']", { timeout: 15000 });
        await pick.waitForSelector("[data-testid=pick-file][data-path$='notes.txt']", { timeout: 15000 });
        await shot(files, "17-pick-nextcloud-documents");
        await pick.click("[data-testid=pick-file][data-path$='notes.txt']");
        const picked = await pickP;
        const pf = picked.files && picked.files[0];
        check(pf && /^\/media\/internal\/\.phoenix\/drive-cache\//.test(pf.fullPath) && /\/media\/drives\/.+\/Documents\/notes\.txt$/.test(pf.remotePath || ""),
              "picked from Nextcloud: the app gets the device's copy (" + (pf && pf.fullPath) + ") and where it came from");
        const text = pf && await luna(files, "luna://org.webosphoenix.filemanager/read", { path: pf.fullPath });
        check(text && /^Shopping/.test(text.data), "... which it reads like any file");

        // ---- 7. A big upload: its progress in the ongoing activities ------------------------------------------
        await files.evaluate(() => {
            const b = new Uint8Array(3 * 1024 * 1024).map((_x, i) => i & 255);
            return window.__phoenixRuntime.fileManager.localFiles.write("/media/internal/Downloads/big.bin", b, false);
        });
        host.length = 0;
        const big = await luna(files, "luna://org.webosphoenix.filemanager/copy", { from: "/media/internal/Downloads/big.bin", to: "/media/drives/" + nc._id + "/big.bin" });
        check(big.returnValue && fake.trees.dav.byPath("/big.bin") && fake.trees.dav.byPath("/big.bin").bytes.length === 3 * 1024 * 1024, "a 3 MB file copied to Nextcloud (an upload)");
        const ongoing = host.filter((m) => m.type === "ongoing");
        check(ongoing.some((m) => /^Uploading big\.bin$/.test(m.payload.title) && m.payload.appId === "org.webosphoenix.files") && ongoing[ongoing.length - 1].payload.clear,
              "its progress in the notification area's ongoing activities, cleared at the end");

        // ---- 8. Offline -----------------------------------------------------------------------------------
        fake.offline = true;
        try {
            await files.goto(appUrl("org.webosphoenix.files", { path: "/media/drives/" + nc._id + "/Shared" }));
            await files.waitForSelector("[data-testid=folder-error]", { timeout: 20000 });
            check(/can't be reached/.test(await files.textContent("[data-testid=folder-error]")) && await files.locator("[data-testid=retry]").count() === 1,
                  "offline: the drive's folder says it cannot be reached, nothing lost, with Try Again");
            await shot(files, "18-offline");
            const cached = await luna(files, "luna://org.webosphoenix.filemanager/open", { path: "/media/drives/" + nc._id + "/Photos/lake.png" });
            check(cached.returnValue && cached.stale, "offline: a picture opened before opens from the device's copy (stale)");
        } finally {
            fake.offline = false;
        }
        await files.click("[data-testid=retry]");
        await files.waitForSelector("[data-testid=empty]", { timeout: 15000 }).catch(() => {});
        check(await files.locator("[data-testid=folder-error]").count() === 0, "online again: Try Again lists the folder");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        await Promise.all([catalog.stop(), fake.stop()]);
        fs.rmSync(installedDir, { recursive: true, force: true });
        fs.rmSync(packDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
