#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Passwords (apps/passwords, built into dist/) in headless Chromium
// against the simulated services in runtime/phoenix-runtime.js:
//
//   create     a new KDBX 4 database in /media/internal/passwords
//   entries    a group, an entry with a generated password and a TOTP key;
//              the code shown matches RFC 6238 computed here
//   copy       the password reaches the clipboard and is cleared again
//   at rest    no entry text, password or master password anywhere in the
//              simulated device's storage (db8, files, preferences), and no
//              Just Type search in appinfo.json
//   search     finds titles, never passwords
//   lock       by hand, when the screen locks, when the card is hidden;
//              wrong and right master passwords
//   KeePass    a file written by another implementation (pykeepass, KDBX 4
//              with Argon2d) opens, with its TOTP fields; launch
//              {target: path} (Files' "Open with") selects it
//   CSP        the page runs under its Content-Security-Policy without
//              violations (Argon2 compiles its WebAssembly)
//
//   node tools/test-passwords.cjs [--tablet] [--out DIR]
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
const APP = "org.webosphoenix.passwords";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "passwords-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (params) => `${origin}/usr/palm/applications/${APP}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const APPINFO = JSON.parse(fs.readFileSync(path.join(REPO, "apps/passwords/public/appinfo.json"), "utf8"));
const FIXTURE = path.join(REPO, "apps/passwords/src/fixtures/pykeepass-kdbx4.kdbx");

const MASTER = "Tr0ub4dor&3-horse-battery";
const USER = "ada.lovelace@example.org";
const TOTP_KEY = "JBSWY3DPEHPK3PXP";

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

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/passwords/dist/index.html"))) {
        console.error("apps/passwords/dist is missing: run `npm ci && npm run build` in apps/ first");
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
        // Let dialogs finish sliding in.
        const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, name + ".png") }); };
        const luna = (url, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [url, params]);
        const tid = (id) => `[data-testid='${id}']`;
        const fill = async (id, v) => { await page.fill(tid(id), v); };
        const storage = () => page.evaluate(() => {
            const all = [];
            for (let i = 0; i < localStorage.length; ++i) all.push(localStorage.key(i) + "=" + localStorage.getItem(localStorage.key(i)));
            return all.join("\n");
        });
        const setHidden = (hidden) => page.evaluate((h) => {
            Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
            document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
        await page.addInitScript(() => {
            window.__csp = [];
            document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
        });

        // A clean device.
        await page.goto(appUrl());
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl());
        await page.waitForSelector(tid("no-databases"), { timeout: 10000 });
        check(true, "start: no databases yet");
        check(!("universalSearch" in APPINFO), "appinfo.json declares no Just Type search");
        const csp = await page.getAttribute("meta[http-equiv='Content-Security-Policy']", "content");
        check(/default-src 'none'/.test(csp) && /script-src 'self' 'wasm-unsafe-eval'/.test(csp) && !/unsafe-eval'/.test(csp.replace("'wasm-unsafe-eval'", "")),
            "index.html: a strict Content-Security-Policy (no eval, WebAssembly only)");
        await shot("locked-empty");

        // ---- Create a database -----------------------------------------------------------------
        await page.click(tid("new-database"));
        await fill("new-name", "Personal");
        await fill("new-password", "short");
        await fill("new-confirm", "short");
        await page.click(tid("create-database"));
        await page.waitForSelector(".pui-error");
        check(/at least 8/.test(await page.textContent(".pui-error")), "create: a short master password is refused");
        await fill("new-password", MASTER);
        check(/good|strong/.test(await page.getAttribute(tid("strength"), "data-strength")), "create: the strength meter rates the master password");
        await fill("new-confirm", MASTER);
        await shot("new-database");
        await page.click(tid("create-database"));
        await page.waitForSelector(tid("db-name"), { timeout: 20000 });
        check((await page.textContent(tid("db-name"))) === "Personal", "create: the new database is open");
        const stat = await luna("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/passwords/Personal.kdbx" });
        check(stat.returnValue && stat.entry.size > 0, `create: /media/internal/passwords/Personal.kdbx written (${stat.entry && stat.entry.size} bytes)`);
        const head = await luna("luna://org.webosphoenix.filemanager/read", { path: "/media/internal/passwords/Personal.kdbx", encoding: "base64" });
        const bytes = Buffer.from(head.data, "base64");
        check(bytes.readUInt32LE(0) === 0x9aa2d903 && bytes.readUInt32LE(4) === 0xb54bfb67 && bytes.readUInt16LE(10) === 4,
            "create: the file is KDBX 4 (KeePass signature, major version 4)");
        check(bytes.includes(Buffer.from("9e298b1956db4773b23dfc3ec6f0a1e6", "hex")), "create: the key derivation is Argon2id");

        // ---- A group and an entry -----------------------------------------------------------
        await page.click(tid("add"));
        await page.click("text=New Group");
        await fill("name-field", "Email");
        await page.click(tid("name-ok"));
        await page.waitForSelector(tid("group-Email"));
        await page.click(tid("group-Email"));
        await page.waitForSelector(tid("group-up"));
        await page.click(tid("add"));
        await page.click("text=New Entry");
        await page.waitForSelector(tid("entry-editor"));
        await fill("edit-title", "Mailbox");
        await fill("edit-username", USER);
        await page.click(tid("edit-generate"));
        await page.waitForSelector(tid("generator"));
        const gen1 = await page.textContent(tid("generated"));
        await page.click(tid("gen-again"));
        const gen2 = await page.textContent(tid("generated"));
        check(gen1.length === 20 && gen2.length === 20 && gen1 !== gen2, `generator: 20 random characters, new each time (${gen1.length})`);
        await shot("generator");
        await page.click(tid("gen-use"));
        const password = await page.inputValue(tid("edit-password"));
        check(password === gen2, "generator: Use Password fills the editor");
        await fill("edit-url", "https://mail.example.org");
        await fill("edit-otp", "not a key!");
        await page.click(tid("save-entry"));
        await page.waitForSelector(".pw-editor .pui-error");
        check(/One-time code/.test(await page.textContent(".pw-editor .pui-error")), "editor: a bad TOTP key is refused");
        await fill("edit-otp", TOTP_KEY.toLowerCase().replace(/(.{4})/g, "$1 "));
        await fill("edit-notes", "Recovery codes are in the safe.");
        await shot("editor");
        await page.click(tid("save-entry"));
        await page.waitForSelector(tid("entry-detail"), { timeout: 20000 });
        check((await page.textContent(tid("entry-title"))) === "Mailbox", "entry: saved and shown");
        check((await page.textContent(tid("field-password-value"))).startsWith("••••"), "entry: the password is hidden until shown");
        await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector("[data-testid='field-totp-value']").textContent));
        const shownCode = (await page.textContent(tid("field-totp-value"))).replace(" ", "");
        const expected = [totp(TOTP_KEY, Date.now() - 1000), totp(TOTP_KEY), totp(TOTP_KEY, Date.now() + 1000)];
        check(expected.includes(shownCode), `entry: the TOTP code is right (RFC 6238: ${shownCode})`);
        check(Number(await page.getAttribute(tid("totp-ring"), "data-remaining")) <= 30, "entry: the countdown ring shows the seconds left");
        await page.click(tid("field-password-show"));
        check((await page.textContent(tid("field-password-value"))) === password, "entry: Show reveals the password");
        await shot("entry");
        await page.click(tid("field-password-show"));

        // ---- Copy, and the clipboard clears ---------------------------------------------------------
        await page.click(tid("field-password-copy"));
        await page.waitForSelector(tid("copied"));
        check((await page.evaluate(() => navigator.clipboard.readText())) === password, "copy: the password is on the clipboard");
        check(/clears in \d+ s/.test(await page.textContent(tid("toast"))), "copy: the toast says when the clipboard clears");
        await shot("copied");

        // ---- Nothing in clear at rest -----------------------------------------------------------------
        await page.keyboard.press("Escape");
        const at = await storage();
        const leaks = [password, USER, "Mailbox", "Recovery codes", MASTER, TOTP_KEY, "mail.example.org"].filter((s) => at.includes(s));
        check(leaks.length === 0, "at rest: nothing of the entry or the master password in the device's storage (db8, files, prefs)" +
            (leaks.length ? ": found " + leaks.join(", ") : ""));
        check(!consoleText.some((t) => t.includes(password) || t.includes(MASTER)), "logs: no secret in the console");

        // ---- Search ------------------------------------------------------------------------------
        await page.waitForSelector(tid("search"));
        if (await page.isVisible(tid("group-up"))) await page.click(tid("group-up"));
        await fill("search", "mailbox");
        await page.waitForSelector(tid("entry-Mailbox"));
        check(true, "search: finds the entry by title");
        await fill("search", password.slice(0, 8));
        await page.waitForSelector(tid("no-match"));
        check(true, "search: never matches passwords");
        await fill("search", "");

        // ---- Preferences: clear the clipboard after 10 s ------------------------------------------
        await page.click(tid("menu"));
        await page.click("text=Preferences");
        await page.waitForSelector(tid("prefs-dialog"));
        await shot("preferences");
        await page.click(tid("pref-clipboard"));
        await page.click(`.pui-popup .pui-menu-item:has(.pui-menu-label:text-is("After 10 seconds"))`);
        await page.waitForSelector(".pui-popup", { state: "detached" });
        await page.click(tid("prefs-done"));
        await page.click(tid("group-Email"));
        await page.click(tid("entry-Mailbox"));
        await page.click(tid("field-password-copy"));
        await page.waitForSelector(tid("copied"));
        await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === ""), null, { timeout: 16000, polling: 500 })
            .then(() => check(true, "copy: the clipboard is cleared after 10 s"), () => check(false, "copy: the clipboard is cleared after 10 s"));

        // ---- Locking ------------------------------------------------------------------------------
        await page.click(tid("field-username-copy"));
        await page.keyboard.press("Escape");
        await page.click(tid("lock"));
        await page.waitForSelector(tid("db-Personal"));
        check((await page.evaluate(() => navigator.clipboard.readText())) === "", "lock: locking by hand clears the clipboard");
        check(!(await page.content()).includes(USER), "lock: nothing of the database left in the page");
        await page.fill(tid("master-password"), "wrong password");
        await page.click(tid("unlock"));
        await page.waitForSelector(".pw-unlock .pui-error", { timeout: 20000 });
        check(/Wrong master password/.test(await page.textContent(".pw-unlock .pui-error")), "unlock: a wrong master password is refused");
        await shot("wrong-password");
        await page.fill(tid("master-password"), MASTER);
        await page.click(tid("unlock"));
        await page.waitForSelector(tid("group-Email"), { timeout: 20000 });
        check(true, "unlock: the saved database opens again with its group");

        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ deviceLocked: true }));
        await page.waitForSelector(tid("lock-notice"), { timeout: 5000 })
            .then(async () => check(/screen locked/.test(await page.textContent(tid("lock-notice"))), "auto-lock: when the screen locks"),
                  () => check(false, "auto-lock: when the screen locks"));
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ deviceLocked: false }));
        await page.fill(tid("master-password"), MASTER);
        await page.click(tid("unlock"));
        await page.waitForSelector(tid("group-Email"), { timeout: 20000 });
        await setHidden(true);
        await page.waitForSelector(tid("lock-notice"), { timeout: 5000 })
            .then(async () => check(/minimized/.test(await page.textContent(tid("lock-notice"))), "auto-lock: when the card is minimized (hidden)"),
                  () => check(false, "auto-lock: when the card is minimized (hidden)"));
        await setHidden(false);
        await page.fill(tid("master-password"), MASTER);
        await page.click(tid("unlock"));
        await page.waitForSelector(tid("group-Email"), { timeout: 20000 });
        await page.evaluate(() => window.__phoenixRuntime.cardActivated(false));
        await page.waitForSelector(tid("lock-notice"), { timeout: 5000 })
            .then(() => check(true, "auto-lock: when the shell says the card left the front (minimized to card view)"),
                  () => check(false, "auto-lock: when the shell says the card left the front (minimized to card view)"));
        await page.evaluate(() => window.__phoenixRuntime.cardActivated(true));
        await shot("locked");

        // The file as saved, for a look with KeePassXC (master password in MASTER above).
        const saved = await luna("luna://org.webosphoenix.filemanager/read", { path: "/media/internal/passwords/Personal.kdbx", encoding: "base64" });
        fs.writeFileSync(path.join(outDir, "Personal.kdbx"), Buffer.from(saved.data, "base64"));

        // ---- A database from another KeePass ------------------------------------------------------
        await luna("luna://org.webosphoenix.filemanager/write", {
            path: "/media/internal/Downloads/pykeepass-kdbx4.kdbx", data: fs.readFileSync(FIXTURE).toString("base64"), encoding: "base64",
        });
        const handlers = await luna("luna://com.webos.applicationManager/listAllHandlersForMime", { mime: "application/x-keepass2" });
        check((handlers.resources || []).some((h) => h.appId === APP), "Files: Passwords opens .kdbx files (Open with)");
        await page.goto(appUrl({ target: "/media/internal/Downloads/pykeepass-kdbx4.kdbx" }));
        await page.waitForSelector(tid("unlock-form"), { timeout: 10000 });
        check(await page.isVisible(`.pw-db.open ${tid("db-pykeepass-kdbx4")}`), "launch {target}: selects that database");
        await page.fill(tid("master-password"), "fixture-master-pw");
        await page.click(tid("unlock"));
        await page.waitForSelector(tid("entry-GitHub"), { timeout: 20000 });
        await page.click(tid("entry-GitHub"));
        await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector("[data-testid='field-totp-value']").textContent));
        const gh = (await page.textContent(tid("field-totp-value"))).replace(" ", "");
        check([totp(TOTP_KEY, Date.now() - 1000), totp(TOTP_KEY), totp(TOTP_KEY, Date.now() + 1000)].includes(gh),
            "KeePass: a KDBX 4 / Argon2d file from pykeepass opens; its otpauth:// TOTP field gives the right code");
        await page.keyboard.press("Escape");
        await page.click(tid("entry-Legacy TOTP"));
        await page.waitForFunction(() => /^\d{4} \d{4}$/.test(document.querySelector("[data-testid='field-totp-value']").textContent));
        check(true, "KeePass: the older \"TOTP Seed\" / \"TOTP Settings\" fields give an 8-digit code");
        check(await page.isVisible(tid("field-custom-PIN")) && (await page.textContent(tid("field-custom-PIN-value"))).startsWith("••"),
            "KeePass: protected custom fields are shown hidden");
        await shot("keepass-file");

        const violations = await page.evaluate(() => window.__csp);
        check(violations.length === 0, "CSP: no violations (Argon2's WebAssembly allowed, nothing else)" + (violations.length ? ": " + violations.join("; ") : ""));
        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
