#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Authenticator (apps/authenticator, built into dist/) in headless
// Chromium against the simulated services in runtime/phoenix-runtime.js:
//
//   passcode   without a device passcode it asks for one (Screen & Lock);
//              once set, the vault is created with it; wrong ones are
//              refused; a changed device passcode re-protects the vault
//              after the previous one is typed once
//   codes      a setup key and an otpauth:// link are added; TOTP codes
//              match RFC 6238 computed here, HOTP codes RFC 4226's
//              published values, and tapping copies them
//   launch     {otpauth: "..."} (the QR scanner) asks to confirm after
//              unlocking; a bad link is refused
//   at rest    no secret, account or passcode in the device's storage
//   backup     an encrypted export into Documents; importing it needs its
//              passphrase; an Aegis plain export imports with a warning and
//              can be deleted afterwards
//   lock       by hand, when the screen locks, when the card is hidden
//   CSP        no violations; no page errors
//
//   node tools/test-authenticator.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const APP = "org.webosphoenix.authenticator";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "authenticator-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (params) => `${origin}/usr/palm/applications/${APP}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const APPINFO = JSON.parse(fs.readFileSync(path.join(REPO, "apps/authenticator/public/appinfo.json"), "utf8"));

const PIN = "2468";
const NEW_PIN = "97531";
const GH_KEY = "JBSWY3DPEHPK3PXP";
const MASTO_KEY = "KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TFOQ";
const RFC_HOTP = "otpauth://hotp/RFC%204226:test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=RFC%204226&counter=0";
const PASSPHRASE = "correct horse battery staple";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

function base32(s) {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0, v = 0; const out = [];
    for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
    return Buffer.from(out);
}
function totp(secret, t = Date.now(), digits = 6) {
    const c = Buffer.alloc(8);
    c.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
    const mac = crypto.createHmac("sha1", base32(secret)).update(c).digest();
    const o = mac[mac.length - 1] & 15;
    return String((mac.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}
const around = (secret) => [totp(secret, Date.now() - 1500), totp(secret), totp(secret, Date.now() + 1500)];

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/authenticator/dist/index.html"))) {
        console.error("apps/authenticator/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
        const page = await context.newPage();
        const errors = [];
        const consoleText = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            consoleText.push(t);
            if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        await page.addInitScript(() => {
            window.__csp = [];
            document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
        });
        // Let dialogs finish sliding in.
        const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, name + ".png") }); };
        const luna = (url, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [url, params]);
        const tid = (id) => `[data-testid='${id}']`;
        const fill = (id, v) => page.fill(tid(id), v);
        const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
        const storage = () => page.evaluate(() => {
            const all = [];
            for (let i = 0; i < localStorage.length; ++i) all.push(localStorage.key(i) + "=" + localStorage.getItem(localStorage.key(i)));
            return all.join("\n");
        });
        const codeOf = async (name) => (await page.textContent(`${tid("token-" + name)} ${tid("code")}`)).replace(/\s/g, "");
        const unlock = async (pin) => {
            await page.waitForSelector(tid("passcode"), { timeout: 10000 });
            await fill("passcode", pin);
            await page.click(tid("unlock"));
        };
        const setHidden = (hidden) => page.evaluate((h) => {
            Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
            document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
        const menuItem = async (label) => {
            await page.click(`.pui-popup .pui-menu-item:has(.pui-menu-label:text-is("${label}"))`);
            await page.waitForSelector(".pui-popup", { state: "detached" });
        };

        // A clean device, no passcode.
        await page.goto(appUrl());
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl());
        await page.waitForSelector(tid("needs-passcode"), { timeout: 10000 });
        check(true, "no device passcode: asks for one first (Screen & Lock)");
        check(!("universalSearch" in APPINFO), "appinfo.json declares no Just Type search");
        await shot("needs-passcode");

        // ---- Set a PIN; the vault is made with it ----------------------------------------------
        await luna("luna://com.palm.systemmanager/setDevicePasscode", { lockMode: "pin", passCode: PIN });
        await page.waitForSelector(tid("lock-screen"), { timeout: 8000 });
        check(/encrypted with it/.test(await page.textContent(".au-prompt")), "first use: the device passcode protects the new vault");
        await unlock("1111");
        await page.waitForSelector(".au-center .pui-error");
        check(/Wrong passcode/.test(await page.textContent(".au-center .pui-error")), "unlock: a wrong passcode is refused");
        await shot("lock-screen");
        await unlock(PIN);
        await page.waitForSelector(tid("empty"), { timeout: 10000 });
        check(true, "first use: unlocked, no codes yet");

        // ---- Add a setup key and a link ------------------------------------------------------------
        await page.click(tid("add"));
        await menuItem("Enter a Setup Key");
        await fill("add-issuer", "GitHub");
        await fill("add-account", "ada");
        await fill("add-secret", "not!base32");
        await page.click(tid("add-ok"));
        await page.waitForSelector(`${tid("add-key-dialog")} .pui-error`);
        check(/base32/.test(await page.textContent(`${tid("add-key-dialog")} .pui-error`)), "setup key: a bad key is refused with a reason");
        await fill("add-secret", GH_KEY.toLowerCase().replace(/(.{4})/g, "$1 "));
        await shot("add-key");
        await page.click(tid("add-ok"));
        await page.waitForSelector(tid("token-GitHub"));
        await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector("[data-testid='token-GitHub'] [data-testid='code']").textContent));
        check(around(GH_KEY).includes(await codeOf("GitHub")), `TOTP: the code matches RFC 6238 (${await codeOf("GitHub")})`);
        const ring = Number(await page.getAttribute(`${tid("token-GitHub")} ${tid("ring")}`, "data-remaining"));
        check(ring >= 1 && ring <= 30, `TOTP: the countdown ring shows ${ring} s left`);

        await page.click(tid("add"));
        await menuItem("Add from a Link");
        await fill("add-link", "otpauth://totp/x?secret=JBSWY3DP&digits=4");
        await page.click(tid("add-link-ok"));
        await page.waitForSelector(`${tid("add-link-dialog")} .pui-error`);
        check(/6 to 10 digits/.test(await page.textContent(`${tid("add-link-dialog")} .pui-error`)), "link: an unusable otpauth:// link is refused");
        await fill("add-link", RFC_HOTP);
        await page.click(tid("add-link-ok"));
        await page.waitForSelector(tid("token-RFC 4226"));
        await page.click(tid("token-RFC 4226"));
        await page.waitForFunction(() => /\d/.test(document.querySelector("[data-testid='token-RFC 4226'] [data-testid='code']").textContent));
        check((await codeOf("RFC 4226")) === "755224" && (await clipboard()) === "755224", "HOTP: first code 755224 (RFC 4226), copied");
        await page.click(tid("token-RFC 4226"));
        await page.waitForFunction(() => document.querySelector("[data-testid='token-RFC 4226'] [data-testid='code']").textContent.replace(/\s/g, "") === "287082", null, { timeout: 5000 })
            .then(() => check(true, "HOTP: the next tap gives the next code (287082)"), () => check(false, "HOTP: the next tap gives the next code (287082)"));

        await page.click(tid("token-GitHub"));
        await page.waitForSelector(tid("toast"));
        check(around(GH_KEY).includes(await clipboard()), "tap: the TOTP code is copied");
        check(/GitHub code copied · clears in \d+ s/.test(await page.textContent(tid("toast"))), "tap: the toast says when the clipboard clears");

        // ---- Launched by the QR scanner --------------------------------------------------------------
        await page.goto(appUrl({ otpauth: `otpauth://totp/Mastodon:ada%40example.social?secret=${MASTO_KEY}&issuer=Mastodon` }));
        await page.waitForSelector(tid("pending-add"), { timeout: 10000 });
        check(/Mastodon \(ada@example.social\)/.test(await page.textContent(tid("pending-add"))), "launch {otpauth}: the lock screen says which code will be added");
        await unlock(PIN);
        await page.waitForSelector(tid("confirm-add"), { timeout: 10000 });
        check((await page.textContent(tid("confirm-issuer"))) === "Mastodon" && (await page.textContent(tid("confirm-account"))) === "ada@example.social",
            "launch {otpauth}: asks to confirm the code, never adds it silently");
        await shot("confirm-add");
        await page.click(tid("confirm-add-ok"));
        await page.waitForSelector(tid("token-Mastodon"));
        await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector("[data-testid='token-Mastodon'] [data-testid='code']").textContent));
        check(around(MASTO_KEY).includes(await codeOf("Mastodon")), "launch {otpauth}: added, with the right code");
        await page.waitForTimeout(300);
        await shot("codes");
        await page.goto(appUrl({ otpauth: "otpauth://totp/Evil?secret=%%%" }));
        await unlock(PIN);
        await page.waitForSelector(tid("confirm-add"), { timeout: 10000 });
        check(!(await page.isVisible(tid("confirm-add-ok"))) && /secret|valid/i.test(await page.textContent(tid("confirm-add"))),
            "launch {otpauth}: a bad link is refused");
        await page.click(tid("confirm-add-cancel"));

        // ---- At rest -----------------------------------------------------------------------------------
        const at = await storage();
        const leaks = [GH_KEY, MASTO_KEY, "GEZDGNBVGY3TQOJQ", "Mastodon", "ada@example.social", "GitHub"].filter((s) => at.includes(s));
        check(leaks.length === 0, "at rest: no secret or account in the device's storage (db8, files, prefs)" + (leaks.length ? ": found " + leaks.join(", ") : ""));
        check(!new RegExp(`"${PIN}"|=${PIN}\\b`).test(at), "at rest: the passcode is not stored");
        check(!consoleText.some((t) => t.includes(GH_KEY) || t.includes(MASTO_KEY)), "logs: no secret in the console");

        // ---- Export, import --------------------------------------------------------------------------
        await page.click(tid("menu"));
        await menuItem("Export Backup");
        await fill("export-passphrase", PASSPHRASE);
        await fill("export-confirm", PASSPHRASE);
        await shot("export");
        await page.click(tid("export-ok"));
        await page.waitForSelector(tid("export-result"), { timeout: 10000 });
        const backupPath = (await page.textContent(`${tid("export-result")} b`)).trim();
        const backup = await luna("luna://org.webosphoenix.filemanager/read", { path: backupPath, encoding: "utf8" });
        check(backup.returnValue && JSON.parse(backup.data).format === "phoenix-authenticator-backup", `export: an encrypted backup in ${backupPath}`);
        check(![GH_KEY, MASTO_KEY, "Mastodon", "GitHub"].some((s) => backup.data.includes(s)), "export: the backup holds no secret or name in clear");
        await page.click(tid("export-done"));

        const aegis = {
            version: 1, header: { slots: null, params: null },
            db: { version: 2, entries: [
                { type: "totp", uuid: "a", name: "grace@example.org", issuer: "Forge", info: { secret: "MFRGGZDFMZTWQ2LK", algo: "SHA1", digits: 6, period: 30 } },
                { type: "steam", uuid: "b", name: "gamer", issuer: "Steam", info: { secret: "JBSWY3DP", algo: "SHA1", digits: 5, period: 30 } },
            ] },
        };
        await luna("luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Downloads/aegis-export.json", data: JSON.stringify(aegis), encoding: "utf8" });
        await page.click(tid("menu"));
        await menuItem("Import");
        await page.waitForSelector(tid("import-file-aegis-export.json"));
        await page.click(tid("import-file-aegis-export.json"));
        await page.waitForSelector(tid("import-warning"));
        check(/unencrypted/.test(await page.textContent(tid("import-warning"))), "import: an Aegis plain export is flagged as unencrypted");
        await shot("import-warning");
        await page.click(tid("import-ok"));
        await page.waitForSelector(tid("import-result"));
        check(/Added 1 of 1 code\./.test(await page.textContent(tid("import-result"))) && /1 could not be used/.test(await page.textContent(tid("import-result"))),
            "import: the TOTP entry is added, the Steam one skipped");
        await page.click(tid("import-delete-file"));
        await page.waitForSelector(tid("import-deleted"));
        const gone = await luna("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Downloads/aegis-export.json" });
        check(!gone.returnValue, "import: the plain export can be deleted afterwards");
        await page.click(tid("import-done"));
        await page.waitForSelector(tid("token-Forge"));

        await page.click(tid("menu"));
        await menuItem("Import");
        await page.click(`[data-testid^='import-file-Authenticator backup']`);
        await fill("import-passphrase", "wrong phrase");
        await page.click(tid("import-ok"));
        await page.waitForSelector(`${tid("import-dialog")} .pui-error`, { timeout: 10000 });
        check(/Wrong passphrase/.test(await page.textContent(`${tid("import-dialog")} .pui-error`)), "import: a backup needs its passphrase");
        await fill("import-passphrase", PASSPHRASE);
        await page.click(tid("import-ok"));
        await page.waitForSelector(tid("import-result"), { timeout: 10000 });
        check(/Added 0 of 3 codes \(the rest were already here\)/.test(await page.textContent(tid("import-result"))), "import: the backup opens; codes already here are not doubled");
        await page.click(tid("import-done"));

        // ---- Edit and delete -----------------------------------------------------------------------
        await page.click(`${tid("token-Forge")} ${tid("token-menu")}`);
        await menuItem("Delete");
        await page.click(tid("delete-ok"));
        await page.waitForSelector(tid("token-Forge"), { state: "detached" });
        check(true, "delete: the code is removed");

        // ---- Locking -----------------------------------------------------------------------------
        await page.click(tid("token-GitHub"));
        await page.waitForSelector(tid("toast"));
        await page.click(tid("lock"));
        await page.waitForSelector(tid("lock-screen"));
        check(!(await page.content()).includes("ada@example.social"), "lock: nothing of the codes left in the page");
        check((await clipboard()) === "", "lock: locking by hand clears the clipboard");
        await unlock(PIN);
        await page.waitForSelector(tid("token-GitHub"), { timeout: 10000 });
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ deviceLocked: true }));
        await page.waitForSelector(tid("lock-notice"), { timeout: 5000 })
            .then(async () => check(/screen locked/.test(await page.textContent(tid("lock-notice"))), "auto-lock: when the screen locks"),
                  () => check(false, "auto-lock: when the screen locks"));
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ deviceLocked: false }));
        await unlock(PIN);
        await page.waitForSelector(tid("token-GitHub"), { timeout: 10000 });
        await setHidden(true);
        await page.waitForSelector(tid("lock-notice"), { timeout: 5000 })
            .then(async () => check(/minimized/.test(await page.textContent(tid("lock-notice"))), "auto-lock: when the card is minimized (hidden)"),
                  () => check(false, "auto-lock: when the card is minimized (hidden)"));
        await setHidden(false);
        await unlock(PIN);
        await page.waitForSelector(tid("token-GitHub"), { timeout: 10000 });
        await page.evaluate(() => window.__phoenixRuntime.cardActivated(false));
        await page.waitForSelector(tid("lock-notice"), { timeout: 5000 })
            .then(() => check(true, "auto-lock: when the shell says the card left the front (minimized to card view)"),
                  () => check(false, "auto-lock: when the shell says the card left the front (minimized to card view)"));
        await page.evaluate(() => window.__phoenixRuntime.cardActivated(true));

        // ---- The device passcode changes -------------------------------------------------------------
        const changed = await luna("luna://com.palm.systemmanager/setDevicePasscode", { lockMode: "pin", passCode: NEW_PIN, oldPasscode: PIN });
        check(changed.returnValue, "the device PIN is changed in Screen & Lock");
        await unlock(NEW_PIN);
        await page.waitForSelector(tid("passcode"));
        await page.waitForFunction(() => /previous one/.test(document.querySelector(".au-prompt").textContent), null, { timeout: 10000 });
        check(true, "passcode changed: asks for the previous passcode once");
        await shot("passcode-changed");
        await unlock(PIN);
        await page.waitForSelector(tid("token-GitHub"), { timeout: 10000 });
        await page.click(tid("lock"));
        await unlock(NEW_PIN);
        await page.waitForSelector(tid("token-GitHub"), { timeout: 10000 })
            .then(() => check(true, "passcode changed: the codes are now protected by the new passcode"),
                  () => check(false, "passcode changed: the codes are now protected by the new passcode"));
        await page.click(tid("lock"));
        await unlock(PIN);
        await page.waitForSelector(".au-center .pui-error", { timeout: 10000 });
        check(true, "passcode changed: the old passcode no longer opens them");

        const violations = await page.evaluate(() => window.__csp);
        check(violations.length === 0, "CSP: no violations" + (violations.length ? ": " + violations.join("; ") : ""));
        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        // Leave the simulated device without a PIN for other tests.
        await luna("luna://com.palm.systemmanager/setDevicePasscode", { lockMode: "none", oldPasscode: NEW_PIN });
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
