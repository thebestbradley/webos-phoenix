#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Backup end to end: Settings > Backup (apps/settings, built into dist/) in
// headless Chromium with runtime/phoenix-runtime.js running the device's
// backup service (apps/settings/service) and a real WebDAV server
// (WsgiDAV on 127.0.0.1: pip install wsgidav cheroot). Sets where backups go
// and the passphrase, backs up to the USB drive and to the server, restores
// (a wrong passphrase first), deletes, turns daily backups on, and checks
// the legacy hooks: the "Backup Failure" event for luna-systemui, the
// com.palm.app.backup id, and the launcher layout handed back to the shell.
// The First Use restore is in tools/test-firstuse.cjs.
//
//   node tools/test-backup.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const wsgidav = require(path.join(REPO, "apps/settings/service/test/wsgidav.cjs"));
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "backup-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const page0 = `${origin}/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=${encodeURIComponent(JSON.stringify({ page: "backup" }))}`;
const B = "luna://org.webosphoenix.service.backup/";
const PASS = "a long backup passphrase";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
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
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    if (!wsgidav.available()) {
        console.error("WsgiDAV is not installed: pip install wsgidav cheroot");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const dav = await wsgidav.start();
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, " ");

        await page.goto(page0);
        await page.evaluate(() => localStorage.clear());
        await page.goto(page0);
        await page.waitForSelector("[data-testid=backup-now]");
        await shot("1-new");
        check(await page.isDisabled("[data-testid=backup-now]") && /Never/.test(await text("[data-testid=backup-last]")),
              "a new device: nothing set, never backed up, Back Up Now off");

        // The USB drive, and a passphrase (twice, and long enough).
        await page.click("[data-testid=backup-where]");
        await page.waitForSelector("[data-testid=backup-where-dialog]");
        await page.click("[data-testid=backup-where-save]");
        await page.waitForSelector("[data-testid=backup-where-dialog]", { state: "detached" });
        await page.click("[data-testid=backup-passphrase]");
        await page.fill("[data-testid=backup-pass1]", "short");
        check(await page.isDisabled("[data-testid=backup-pass-save]"), "a short passphrase is not taken");
        await page.fill("[data-testid=backup-pass1]", PASS);
        await page.fill("[data-testid=backup-pass2]", PASS + "x");
        check(/do not match/.test(await text("[data-testid=backup-passphrase-dialog]")), "the two must match");
        await page.fill("[data-testid=backup-pass2]", PASS);
        await page.waitForTimeout(400);   // the dialog's fade
        await shot("2-passphrase");
        await page.click("[data-testid=backup-pass-save]");
        await page.waitForSelector("[data-testid=backup-passphrase-dialog]", { state: "detached", timeout: 15000 });
        const cfg = await page.evaluate(() => localStorage.getItem("phoenix:backup:config"));
        check(!cfg.includes(PASS), "only a key derived from the passphrase is kept");

        // Something to back up: a task, a setting, the launcher layout.
        await luna("luna://com.palm.db/put", { objects: [{ _kind: "com.palm.task:1", summary: "Backup canary", completed: false, priority: 0, listId: "l", accountId: "" }] });
        await luna("luna://com.webos.service.systemservice/setPreferences", { screenTimeout: 180 });
        const layout = JSON.stringify({ pages: [["org.webosphoenix.settings"], [], []], dock: ["com.palm.app.phone"], removed: [] });
        await page.evaluate((l) => __phoenixRuntime.applyHostStatus({ launcherLayout: l }), layout);

        await page.click("[data-testid=backup-now]");
        await page.waitForFunction(() => /Today/.test(document.querySelector("[data-testid=backup-last]").textContent), null, { timeout: 15000 });
        const usbFiles = (await luna("luna://org.webosphoenix.filemanager/list", { path: "/media/internal/backups" })).entries || [];
        check(usbFiles.length === 1 && /^phoenix-backup-\d{8}-\d{6}\.pbak$/.test(usbFiles[0].name), "Back Up Now: a backup file on the USB drive");
        const raw = (await luna("luna://org.webosphoenix.filemanager/read", { path: "/media/internal/backups/" + usbFiles[0].name })).data;
        check(raw.includes("org.webosphoenix.backup") && !raw.includes("Backup canary"), "... encrypted (the task is not readable in it)");
        await page.waitForSelector(`[data-testid='backup-file-${usbFiles[0].name}']`);
        await shot("3-backed-up");

        // Change things, then restore: a wrong passphrase first.
        await luna("luna://com.palm.db/del", { query: { from: "com.palm.task:1" } });
        await luna("luna://com.webos.service.systemservice/setPreferences", { screenTimeout: 30 });
        host.length = 0;
        await page.click(`[data-testid='backup-file-${usbFiles[0].name}']`);
        await page.waitForSelector("[data-testid=backup-dialog]");
        await page.waitForFunction(() => /Launcher layout/.test(document.querySelector("[data-testid=backup-dialog]").textContent));
        check(/Settings/.test(await text("[data-testid=backup-dialog]")), "a backup says what it holds");
        await page.waitForTimeout(400);   // the dialog's fade
        await shot("4-backup");
        await page.click("[data-testid=backup-restore]");
        await page.fill("[data-testid=backup-restore-pass]", "wrong wrong wrong");
        await page.click("[data-testid=backup-restore-confirm]");
        await page.waitForSelector("[data-testid=backup-restore-error]", { timeout: 15000 });
        check(/not this backup's passphrase/.test(await text("[data-testid=backup-restore-error]")), "restore: a wrong passphrase is refused");
        await page.fill("[data-testid=backup-restore-pass]", PASS);
        await page.click("[data-testid=backup-restore-confirm]");
        await page.waitForSelector("[data-testid=backup-restored]", { timeout: 15000 });
        await page.waitForTimeout(400);   // the dialog's fade
        await shot("5-restored");
        const tasks = (await luna("luna://com.palm.db/find", { query: { from: "com.palm.task:1" } })).results || [];
        const prefs = await luna("luna://com.webos.service.systemservice/getPreferences", { keys: ["screenTimeout"] });
        check(tasks.some((t) => t.summary === "Backup canary") && prefs.screenTimeout === 180, "restore: the task and the setting are back");
        const back = host.find((m) => m.type === "launcherLayout");
        check(!!back && back.payload.json === layout, "restore: the launcher layout goes back to the shell");
        await page.click("[data-testid=backup-done]");

        // A WebDAV server: a wrong password is refused, nothing changes.
        const url = dav.url + "/Phoenix/";
        await page.click("[data-testid=backup-where]");
        await page.click("[data-testid=backup-type]");
        await page.click("role=option[name='WebDAV server']");
        await page.fill("[data-testid=backup-url]", url);
        await page.fill("[data-testid=backup-user]", dav.user);
        await page.fill("[data-testid=backup-password]", "not it");
        await page.click("[data-testid=backup-where-save]");
        await page.waitForSelector("[data-testid=backup-where-error]", { timeout: 15000 });
        check(/did not accept/.test(await text("[data-testid=backup-where-error]")), "WebDAV: a wrong password is refused");
        check((await luna(B + "getStatus", {})).destination.type === "usb", "... and the USB drive is still where backups go");
        await page.fill("[data-testid=backup-password]", dav.password);
        await page.waitForTimeout(400);   // the dialog's fade
        await shot("6-webdav");
        await page.click("[data-testid=backup-where-save]");
        await page.waitForSelector("[data-testid=backup-where-dialog]", { state: "detached", timeout: 15000 });
        check(dav.files("Phoenix").length === 0 && fs.existsSync(path.join(dav.root, "Phoenix")), "WebDAV: the folder is made on the server");
        await page.waitForSelector("text=No backups yet");
        await page.click("[data-testid=backup-now]");
        await page.waitForFunction(() => document.querySelectorAll("[data-testid^=backup-file-]").length === 1, null, { timeout: 15000 });
        const remote = dav.files("Phoenix");
        check(remote.length === 1 && /\.pbak$/.test(remote[0]) && !dav.read("Phoenix/" + remote[0]).includes("Backup canary"),
              "WebDAV: Back Up Now puts an encrypted backup on the server");
        const st = await luna(B + "getStatus", {});
        check(!JSON.stringify(st).includes(dav.password), "the status never shows the server password");

        // Delete it.
        await page.click(`[data-testid='backup-file-${remote[0]}']`);
        await page.click("[data-testid=backup-delete]");
        await page.click("[data-testid=backup-delete-confirm]");
        await page.waitForSelector("[data-testid=backup-dialog]", { state: "detached", timeout: 15000 });
        check(dav.files("Phoenix").length === 0, "delete: the backup is gone from the server");

        // Every day: an activity; when it keeps failing, the system UI hears of it.
        await page.click("[data-testid=backup-auto]");
        await page.waitForTimeout(300);
        const act = await luna("luna://com.palm.activitymanager/getDetails", { activityName: "org.webosphoenix.backup.daily" });
        check(act.returnValue && act.activity.callback.method === B + "scheduled", "Back up every day: a daily activity");
        await dav.stop();
        await page.evaluate(() => {
            const c = JSON.parse(localStorage.getItem("phoenix:backup:config"));
            c.lastSuccess = new Date(Date.now() - 6 * 86400000).toISOString();
            localStorage.setItem("phoenix:backup:config", JSON.stringify(c));
        });
        const ran = await luna(B + "scheduled", {});
        const events = await page.evaluate(() => JSON.parse(localStorage.getItem("phoenix:systemui:events") || "[]"));
        check(ran.returnValue === false && ran.errorCode === "CONNECTION_FAILED"
              && events.some((e) => e.event === "subscribeToBackupStatus" && e.message.notify && e.message.duration === 6),
              "a failing daily backup, six days on: luna-systemui's Backup Failure event");
        await page.waitForSelector("[data-testid=backup-failed]");
        await shot("7-failed");

        // luna-systemui's dashboard opens com.palm.app.backup: this page.
        host.length = 0;
        await luna("luna://com.palm.applicationManager/open", { id: "com.palm.app.backup", params: {} });
        const launch = host.find((m) => m.type === "launch");
        check(!!launch && launch.payload.id === "org.webosphoenix.settings" && launch.payload.params.page === "backup",
              "com.palm.app.backup opens Settings > Backup");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        server.kill();
        await dav.stop().catch(() => {});
    }
    console.log(failures ? `\n${failures} check(s) failed` : `\nAll checks passed. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
