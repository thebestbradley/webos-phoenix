#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The SFTP drive end to end (docs/SHARE-AND-FILES.md "Drives"), in headless
// Chromium with runtime/phoenix-runtime.js: the drives' package packed by
// phoenix-connector (its SSH client's npm packages inside) and installed
// as the Marketplace installs it; the simulator's TCP relay
// (tools/serve-rootfs.py /__phoenix/tcp, phoenix-sim's SimTcp) to a real
// OpenSSH sshd started here, with OpenSSH's own sftp-server:
//
//   1. the demo server (files.example, in the page): signed in with a
//      password on the sign-in page; the server's key shown to trust;
//   2. OpenSSH: Make a Key on the sign-in page; its public key put in the
//      server's authorized_keys; the fingerprint shown is ssh-keygen's;
//      trusted; the account made, its key in the sealed key store only;
//   3. Files: both SFTP places under Drives; OpenSSH's folders; a picture
//      opened (downloaded in ranges through the device's cache);
//   4. uploads: a picture copied from the device, and a 20 MB file in
//      chunks with its progress in the notification area; on the server's
//      disk byte for byte, and no partial file left;
//   5. the server's key changed (sshd started again with a new one): Files
//      refuses with the warning, a notification says so;
//   6. offline (sshd stopped): Files says the drive can't be reached;
//   7. the account removed: its key goes from the key store.
//
//   node tools/test-sftp.cjs [--tablet] [--out DIR]
//
// Needs Playwright, OpenSSH's server (apt install openssh-server; skipped
// without it, after the demo server's part), the apps built
// (cd apps && npm run build) and the connector kit built (its lib/).

"use strict";
const { spawn, execFileSync, execSync } = require("child_process");
const fs = require("fs");
const net = require("net");
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "sftp-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TEMPLATE = "com.webosphoenix.drive.sftp";
const APP = "org.webosphoenix.drives";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, step) {
    for (let t = 0; t < (ms || 10000); t += step || 250) {
        const v = await fn();
        if (v) return v;
        await sleep(step || 250);
    }
    return null;
}
function which(cmd) {
    try { return execFileSync("sh", ["-c", "command -v " + cmd]).toString().trim(); } catch (e) { return ""; }
}

// ---- OpenSSH's sshd, on this computer, for this user -----------------------------------------------

function sshdPath() {
    for (const p of ["/usr/sbin/sshd", "/usr/local/sbin/sshd", which("sshd")]) if (p && fs.existsSync(p)) return p;
    return "";
}
function sftpServerPath() {
    for (const p of ["/usr/lib/openssh/sftp-server", "/usr/libexec/openssh/sftp-server", "/usr/libexec/sftp-server", "/usr/lib/ssh/sftp-server"])
        if (fs.existsSync(p)) return p;
    return "internal-sftp";
}
function freePort() {
    return new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

function createSshd(dir, port) {
    const user = os.userInfo().username;
    let proc = null;
    fs.mkdirSync(path.join(dir, "files", "Photos"), { recursive: true });
    fs.mkdirSync(path.join(dir, "files", "Documents"), { recursive: true });
    fs.copyFileSync(path.join(REPO, "apps/media-samples/media/photos/alpine-lake.jpg"), path.join(dir, "files", "Photos", "alpine-lake.jpg"));
    fs.writeFileSync(path.join(dir, "files", "Documents", "readme.txt"), "Files on an SSH server, in Phoenix.\n");
    fs.writeFileSync(path.join(dir, "authorized_keys"), "", { mode: 0o600 });
    function hostKey() {
        const f = path.join(dir, "host_ed25519");
        for (const x of [f, f + ".pub"]) if (fs.existsSync(x)) fs.unlinkSync(x);
        execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test-host", "-f", f]);
        return execFileSync("ssh-keygen", ["-l", "-f", f + ".pub"]).toString().split(" ")[1];
    }
    const config = path.join(dir, "sshd_config");
    fs.writeFileSync(config, [
        "Port " + port, "ListenAddress 127.0.0.1", "HostKey " + path.join(dir, "host_ed25519"), "PidFile " + path.join(dir, "sshd.pid"),
        "AuthorizedKeysFile " + path.join(dir, "authorized_keys"), "StrictModes no", "UsePAM no", "PasswordAuthentication no",
        "KbdInteractiveAuthentication no", "PermitRootLogin prohibit-password", "Subsystem sftp " + sftpServerPath(), "LogLevel VERBOSE", ""
    ].join("\n"));
    // As root, sshd wants its privilege separation folder.
    if (process.getuid && process.getuid() === 0) fs.mkdirSync("/run/sshd", { recursive: true });
    const s = {
        user, port, dir, files: path.join(dir, "files"), fingerprint: hostKey(), log: "",
        async start() {
            proc = spawn(sshdPath(), ["-D", "-e", "-f", config], { stdio: ["ignore", "ignore", "pipe"] });
            proc.stderr.on("data", (d) => { s.log += d.toString(); });
            const up = await until(() => new Promise((res) => {
                const c = net.connect(port, "127.0.0.1", () => { c.destroy(); res(true); });
                c.on("error", () => res(false));
            }), 10000, 100);
            if (!up) throw new Error("sshd did not start: " + s.log);
        },
        async stop() {
            if (!proc) return;
            const p = proc;
            proc = null;
            p.kill("SIGTERM");
            await new Promise((r) => { p.once("exit", r); setTimeout(r, 3000); });
        },
        newHostKey() { s.fingerprint = hostKey(); return s.fingerprint; },
        authorize(line) { fs.appendFileSync(path.join(dir, "authorized_keys"), line.trim() + "\n"); }
    };
    return s;
}

async function main() {
    for (const f of ["apps/files/dist/index.html", "apps/shared/connector-kit/lib/index.js"]) {
        if (!fs.existsSync(path.join(REPO, f))) {
            console.error(f + " is missing: cd apps && npm ci && npm run build");
            process.exit(2);
        }
    }
    const haveSshd = !!sshdPath() && !!which("ssh-keygen");
    if (!haveSshd) console.log("note: OpenSSH's sshd is not installed (apt install openssh-server): only the demo server's part runs");
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-sftp-"));
    const sshd = haveSshd ? createSshd(work, await freePort()) : null;
    if (sshd) await sshd.start();
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    const appUrl = (id, params, file) => `${origin}/usr/palm/applications/${id}/${file || "index.html"}` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 10000, 100);
        const hostInfo = await (await fetch(origin + "/usr/share/phoenix/host.json")).json();
        check(hostInfo.tcp === "websocket" && /\/__phoenix\/tcp\?token=/.test(hostInfo.tcpUrl), "the dev server offers its TCP relay (host.json)");
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [], host = [];
        context.on("page", (p) => {
            p.on("pageerror", (e) => errors.push(p.url().replace(/\?.*$/, "").replace(/^.*\/applications\//, "") + ": " + e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                else if (process.env.SFTP_VERBOSE) console.log("    [" + m.type() + "] " + t);
            });
        });
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);

        // ---- 0. The drives' package, installed -----------------------------------------------------------
        const page = await context.newPage();
        await page.goto(appUrl("org.webosphoenix.files"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.files"));
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
        const packed = pack(path.join(REPO, "apps/connectors/drives"), work, { namespaces: ["org.webosphoenix", "com.webosphoenix"], writeAppinfo: false });
        const ipk = fs.readFileSync(packed.file);
        const { readIpk } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/ipk.js"));
        const inside = readIpk(new Uint8Array(ipk)).files.map((f) => f.path);
        check(inside.some((p) => /service\/node_modules\/@noble\/curves\/ed25519\.js$/.test(p)) && !inside.some((p) => /node_modules\/@noble\/[^/]+\/(src|esm)\//.test(p)),
              "the package carries its SSH client's npm packages, their CommonJS only (" + Math.round(packed.size / 1024) + " KB)");
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/drives.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipk.toString("base64"));
        await page.evaluate(() => { localStorage.setItem("phoenix:devMode", "true"); });
        const installed = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => { const r = JSON.parse(s); if (r.statusValue === 30 || r.statusValue === 24) res(r); };
            b.call("luna://com.webos.appInstallService/install", JSON.stringify({ id: "org.webosphoenix.drives", ipkUrl: "/tmp/drives.ipk", subscribe: true, developerMode: true }));
        }));
        if (!check(installed.statusValue === 30, "the drives' package installs (" + (installed.details && installed.details.reason || "") + ")")) throw new Error("not installed");
        await page.reload();
        await page.waitForFunction(() => !!window.__phoenixRuntime);
        const tpl = (await luna(page, "luna://com.palm.service.accounts/listAccountTemplates", { capability: "DOCUMENTS" })).results || [];
        check(tpl.some((t) => t.templateId === TEMPLATE && t.loc_name === "SFTP"), "Accounts has the SFTP template");

        // ---- 1. The demo server, files.example: a password ------------------------------------------------
        const accounts = await context.newPage();
        const wizard = async () => {
            await accounts.goto(appUrl("com.palm.app.accounts", { templateId: TEMPLATE }));
            const w = await until(() => accounts.frames().find((f) => /org\.webosphoenix\.drives\/accounts\/wizard\.html/.test(f.url())), 15000);
            if (!w) throw new Error("no sign-in page");
            await w.waitForSelector(".drives-wizard", { timeout: 10000 });
            await accounts.waitForTimeout(800);
            return w;
        };
        // The sign-in page's fields, by their names.
        const field = (w, name) => w.locator("#drivesWizard_" + name + "_input");
        const create = () => accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        // The server's key to trust (or what the page said instead).
        const trustShown = async (w, name) => {
            const r = await Promise.race([
                w.waitForSelector(".drives-trust", { state: "visible", timeout: 20000 }).then(() => "trust"),
                w.waitForSelector(".error-box", { state: "visible", timeout: 20000 }).then(() => "error")
            ]).catch(() => "nothing");
            if (r !== "trust") {
                await shot(accounts, name + "-failed");
                throw new Error("no key to trust: " + (r === "error" ? await w.locator(".error-box").textContent() : "nothing shown") + " " + JSON.stringify(errors));
            }
        };
        let w = await wizard();
        check(/any SSH server/.test(await w.locator(".drives-help").textContent()), "the SFTP sign-in page says what it is");
        await field(w, "server").fill("files.example");
        await field(w, "username").fill("ada");
        await field(w, "password").fill("any password");
        await field(w, "password").press("Tab");
        await shot(accounts, "1-demo-sign-in");
        await w.getByText("Sign In", { exact: true }).click();
        await trustShown(w, "2-demo");
        const demoFp = (await w.locator(".drives-fingerprint").textContent()).trim();
        check(/^SHA256:[A-Za-z0-9+/]{43}$/.test(demoFp), "the demo server's key is shown to trust: " + demoFp);
        await shot(accounts, "2-demo-trust");
        await w.getByText("Trust and Sign In", { exact: true }).click();
        await create().waitFor({ timeout: 20000 }).catch(async () => { await shot(accounts, "2-demo-failed"); });
        await create().click();
        const demo = await until(async () => (await luna(accounts, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results
            .find((a) => /files\.example/.test(a.username)), 10000);
        check(demo && demo.username === "ada@files.example", "the demo SFTP account exists (" + (demo && demo.username) + ")");
        const demoCreds = demo && await luna(accounts, "luna://com.palm.service.accounts/readCredentials", { accountId: demo._id, name: "common" });
        check(demoCreds && demoCreds.credentials && demoCreds.credentials.settings.hostKey.fingerprint === demoFp, "its server's key is pinned in the account");

        let real = null;
        if (sshd) {
            // ---- 2. OpenSSH: a key made on the device ------------------------------------------------------
            w = await wizard();
            await field(w, "server").fill("127.0.0.1");
            await field(w, "port").fill(String(sshd.port));
            await field(w, "username").fill(sshd.user);
            // Sign in with: a key made on this device.
            await w.locator("#drivesWizard_auth").click();
            await accounts.waitForTimeout(400);
            await w.getByText("A key made on this device", { exact: true }).click();
            await w.getByText("Make a Key", { exact: true }).click();
            await w.waitForSelector(".drives-public-key", { state: "visible", timeout: 10000 });
            const pub = (await w.locator(".drives-public-key").textContent()).trim();
            check(/^ssh-ed25519 AAAA[A-Za-z0-9+/=]+ \S+$/.test(pub), "Make a Key shows the public key to copy: " + pub.slice(0, 40) + "...");
            await field(w, "folder").fill(sshd.files);
            await accounts.waitForTimeout(300);
            await shot(accounts, "3-openssh-key");
            sshd.authorize(pub);
            await w.getByText("Sign In", { exact: true }).click();
            await trustShown(w, "4-openssh");
            const fp = (await w.locator(".drives-fingerprint").textContent()).trim();
            check(fp === sshd.fingerprint, "the fingerprint shown is ssh-keygen -l's of the server's key (" + fp + ")");
            await shot(accounts, "4-openssh-trust");
            await w.getByText("Trust and Sign In", { exact: true }).click();
            await create().waitFor({ timeout: 20000 }).catch(async () => { await shot(accounts, "4-openssh-failed"); console.log(sshd.log.split("\n").slice(-8).join("\n")); });
            await create().click();
            real = await until(async () => (await luna(accounts, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).results
                .find((a) => a.username.indexOf("@127.0.0.1:" + sshd.port) > 0), 10000);
            check(!!real, "the OpenSSH account exists (" + (real && real.username) + ")");
            const creds = real && await luna(accounts, "luna://com.palm.service.accounts/readCredentials", { accountId: real._id, name: "common" });
            const keyId = creds && creds.credentials && creds.credentials.sshKey;
            check(!!keyId && !/PRIVATE KEY/.test(JSON.stringify(creds)), "the account names its key; the key itself is not in its credentials");
            const sealed = await accounts.evaluate((id) => JSON.stringify(Object.keys(localStorage).filter((k) => /oauth:keys/.test(k))
                .map((k) => localStorage.getItem(k))).indexOf("sftp-key:" + id) >= 0, keyId);
            check(sealed, "the private key is in the OAuth service's key store");
            await shot(accounts, "5-accounts");

            // ---- 3. Files: the places, a picture ------------------------------------------------------------
            const files = await context.newPage();
            await files.goto(appUrl("org.webosphoenix.files"));
            await files.waitForSelector("[data-testid=file-list]");
            if (tablet) {
                await files.waitForSelector("[data-testid=drives-title]", { timeout: 10000 });
                check(await files.locator("[data-testid='drive-SFTP']").count() === 2, "Files: both SFTP places under Drives");
                await files.locator("[data-testid='drive-SFTP'][title='" + real.username + "']").click();
            } else {
                await files.goto(appUrl("org.webosphoenix.files", { path: "/media/drives/" + real._id }));
            }
            await files.waitForSelector("[data-testid='file-Photos']", { timeout: 20000 }).catch(async (e) => { await shot(files, "6-files-failed"); console.log("errors: " + JSON.stringify(errors)); throw e; });
            check((await files.textContent("[data-testid=folder-title]")).trim() === "SFTP", "its folder is called SFTP");
            check(await files.locator("[data-testid='file-Documents']").count() === 1, "OpenSSH's folders are listed");
            await shot(files, "6-files-sftp");
            await files.click("[data-testid='file-Photos']");
            await files.waitForSelector("[data-testid='file-alpine-lake.jpg']", { timeout: 15000 });
            await files.click("[data-testid='file-alpine-lake.jpg']");
            await files.waitForSelector(".fm-viewer-image", { timeout: 20000 });
            await files.waitForFunction(() => { const i = document.querySelector(".fm-viewer-image"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 });
            const shown = await files.evaluate(() => { const i = document.querySelector(".fm-viewer-image"); return i.naturalWidth + "x" + i.naturalHeight; });
            check(/^\d{3,}x\d{3,}$/.test(shown), "a picture on the server opens (downloaded through the device's cache): " + shown);
            await files.waitForTimeout(500);
            await shot(files, "7-files-picture");
            await files.evaluate(() => window.__phoenixRuntime.back());
            await files.waitForTimeout(300);

            // ---- 4. Uploads ----------------------------------------------------------------------------------
            const base = "/media/drives/" + real._id;
            const up = await luna(files, "luna://org.webosphoenix.filemanager/copy", { from: "/media/internal/samples/photos/aurora.jpg", to: base + "/Photos/aurora.jpg" });
            const sample = fs.readFileSync(path.join(REPO, "apps/media-samples/media/photos/aurora.jpg"));
            const onDisk = path.join(sshd.files, "Photos", "aurora.jpg");
            check(up.returnValue !== false && fs.existsSync(onDisk) && fs.readFileSync(onDisk).equals(sample),
                  "a picture of the device is uploaded, byte for byte (" + (up.errorText || sample.length + " bytes") + ")");
            const big = Buffer.alloc(20 * 1024 * 1024 + 7);
            for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 13)) & 255;
            await files.evaluate((b64) => window.__phoenixRuntime.fileManager.localFiles.write("/media/internal/Downloads/big.bin", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), false), big.toString("base64"));
            host.length = 0;
            const t0 = Date.now();
            const upBig = await luna(files, "luna://org.webosphoenix.filemanager/copy", { from: "/media/internal/Downloads/big.bin", to: base + "/Documents/big.bin" });
            const secs = (Date.now() - t0) / 1000;
            const bigOnDisk = path.join(sshd.files, "Documents", "big.bin");
            check(upBig.returnValue !== false && fs.existsSync(bigOnDisk) && fs.readFileSync(bigOnDisk).equals(big),
                  "a 20 MB file goes up in chunks, whole (" + (upBig.errorText ? upBig.errorText + "; " : "") + secs.toFixed(1) + " s, " + (big.length / 1048576 / secs).toFixed(1) + " MB/s through the relay)");
            check(!fs.readdirSync(path.join(sshd.files, "Documents")).some((n) => /phoenix-part/.test(n)), "no partial upload is left on the server");
            const ongoing = host.filter((m) => m.type === "ongoing");
            check(ongoing.some((m) => /^Uploading big\.bin$/.test(m.payload.title || "")) && ongoing[ongoing.length - 1].payload.clear,
                  "its progress in the notification area's ongoing activities, cleared at the end");
            await files.goto(appUrl("org.webosphoenix.files", { path: base + "/Photos" }));
            await files.waitForSelector("[data-testid='file-aurora.jpg']", { timeout: 15000 });
            await shot(files, "8-files-uploaded");
            const q = await luna(files, "luna://org.webosphoenix.service.drives/driveQuota", { accountId: real._id });
            check(q.returnValue && q.total > q.used && q.used > 0, "the drive says how full the server's disk is (statvfs@openssh.com)");

            // ---- 5. The server's key changes --------------------------------------------------------------------
            await sshd.stop();
            const newFp = sshd.newHostKey();
            await sshd.start();
            await files.goto(appUrl("org.webosphoenix.files", { path: base }));
            const warned = await until(async () => /has changed/.test(await files.textContent("body")), 20000);
            const body = await files.textContent("body");
            check(!!warned && body.indexOf(fp) >= 0 && body.indexOf(newFp) >= 0, "Files refuses the changed key, with both fingerprints");
            await files.waitForTimeout(300);
            await shot(files, "9-files-key-changed");
            const toast = await until(() => host.find((m) => /Server key changed/.test(JSON.stringify(m.payload || {}))), 5000);
            check(!!toast, "a notification says the server's key changed");
            const probe = await luna(files, "luna://org.webosphoenix.service.drives/sftpHostKey", { server: "127.0.0.1", port: sshd.port, accountId: real._id });
            check(probe.changed === true && probe.previous && probe.previous.fingerprint === fp, "signing in again shows the old key and the new");

            // ---- 6. Offline -----------------------------------------------------------------------------------
            await sshd.stop();
            const off = await luna(files, "luna://org.webosphoenix.service.drives/listFiles", { accountId: real._id, path: "/" });
            check(off.returnValue === false && off.errorCode === 10, "the server gone: offline, nothing lost (" + off.errorText + ")");

            // ---- 7. The account removed: its key goes ------------------------------------------------------------
            const del = await luna(accounts, "luna://com.palm.service.accounts/deleteAccount", { accountId: real._id });
            check(del.returnValue !== false, "the account is removed");
            const gone = await until(async () => accounts.evaluate((id) => JSON.stringify(Object.keys(localStorage).filter((k) => /oauth:keys/.test(k))
                .map((k) => localStorage.getItem(k))).indexOf("sftp-key:" + id) < 0, keyId), 10000);
            check(!!gone, "its key is gone from the key store");
        }
        const own = errors.filter((e) => /drives|files|accounts/i.test(e));
        check(!own.length, "no page errors" + (own.length ? ": " + own.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        if (sshd) await sshd.stop();
        fs.rmSync(installedDir, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
    console.log(failures ? failures + " failed" : "all passed");
    console.log("screenshots: " + outDir);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
