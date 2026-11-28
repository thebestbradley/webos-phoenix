#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The browser (com.palm.app.browser) with phoenix-sim's own page view
// (Qt WebEngine, WebAppWindow.qml), for what its iframe stand-in in
// tools/test-browser.cjs cannot show:
//   404       a page the server answers with an error status and a page of
//             its own (404 Not Found) is shown, as any page: no "Unable to
//             Load Page" over it. WebKit under BrowserAdapter loaded such a
//             page as any other; Qt WebEngine calls it a failed load
//             (HttpErrorDomain), and the view reported it as one
//             (mainDocumentLoadFailed), so the browser said it could not
//             load the page it was showing.
//   refused   a server that is not there still says so (the error dialog).
//   windows   a link with target=_blank and a tap's window.open open a new
//             card with the page, as BrowserAdapter's createPage did
//             (isis-browser Browser.js:331), the page that opened them
//             staying in its own; window.open keeps window.opener, a
//             _blank link does not (Chromium's noopener); a script's
//             window.open without a tap is blocked (Block Popups, on by
//             default: enyo BasicWebView.js:41).
//   certificate  a site with a self-signed certificate: the browser's SSL
//             dialog (Browser.js:248-280: View Certificate, Trust Always,
//             Trust Once, Don't Trust) instead of "Unable to Load Page";
//             Don't Trust stops there; Trust Once shows the page; Trust
//             Always also keeps the certificate for that host
//             (com.palm.certificatemanager), so the next start of the
//             simulator shows it without asking, until it is deleted in
//             Settings' Certificate Manager. The padlock only over a
//             secure page: never over one let through or refused.
//
// The pages are driven over Qt WebEngine's DevTools protocol
// (QTWEBENGINE_REMOTE_DEBUGGING); the screen is captured from the X display.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-browser-sim.cjs [--sim build/phoenix-sim] [--out DIR]
//
// Needs phoenix-sim built (with Qt WebEngine), the submodules (the browser),
// ImageMagick's import and xdotool, a display.

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "browser-sim-tests")));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
    for (let t = 0; t < (ms || 15000); t += 250) {
        const v = await fn().catch(() => null);
        if (v) return v;
        await sleep(250);
    }
    return null;
}

// A site with a page and a 404 page of its own.
function site() {
    const server = http.createServer((req, res) => {
        const missing = req.url.startsWith("/missing");
        res.writeHead(missing ? 404 : 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        if (req.url.startsWith("/opener")) return res.end(opener());
        if (req.url.startsWith("/child")) return res.end(child(req.url.split("?")[1] || ""));
        res.end(missing ? "<!doctype html><title>Not here</title><h1>No such page</h1>"
                        : "<!doctype html><title>Here</title><h1>A page</h1>");
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The pages that open windows (windows).
function opener() {
    return "<!doctype html><title>Opener</title><h1>Opener</h1>"
        + "<a id=blank target=_blank href=/child?blank>new card</a>"
        + "<script>window.__popup = window.open('/child?script');</script>";
}
function child(q) {
    return "<!doctype html><title>Child " + q + "</title><script>document.title = 'Child " + q + " ' + (window.opener ? 'with opener' : 'no opener');</script>";
}

// An https site with a certificate of its own (self-signed, for
// 127.0.0.1), made with openssl for this run.
function tlsSite(dir, name) {
    const key = path.join(dir, name + ".key"), crt = path.join(dir, name + ".crt");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "2",
                             "-subj", "/CN=Phoenix Test " + name, "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end("<!doctype html><title>Secure " + name + "</title><h1>" + name + "</h1>");
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- The DevTools protocol, by hand (Node's WebSocket) ----------------------------

function devtools(port) {
    async function targets() {
        const r = await fetch("http://127.0.0.1:" + port + "/json");
        return (await r.json()).filter((t) => t.type === "page");
    }
    async function connect(target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let id = 0;
        const waiting = {};
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
        };
        return {
            // tap: as the user's own (a user gesture: what a tap on the
            // page is to its popup blocker).
            evaluate(expression, tap) {
                return new Promise((resolve) => {
                    const n = ++id;
                    waiting[n] = (m) => resolve(m.result && m.result.result ? m.result.result.value : undefined);
                    ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, userGesture: !!tap } }));
                });
            },
            close() { ws.close(); }
        };
    }
    return {
        targets,
        async page(re, ms, skip) {
            const t = await until(async () => (await targets()).filter((x) => re.test(x.url))[skip || 0], ms);
            return t ? connect(t) : null;
        },
        async count(re) { return (await targets()).filter((x) => re.test(x.url)).length; }
    };
}

// The browser's error dialog (Browser.js openDialog: "Error", "Unable to Load Page").
const DIALOG = `(() => { const b = enyo.$.browserApp && enyo.$.browserApp.$.browser; const d = b && b.$.dialog;
    return d && d.isOpen ? (b.$.dialogTitle.getContent() + ": " + b.$.dialogMessage.getContent()) : ""; })()`;

// The browser's SSL dialog: its message when open ("" when not), and
// whether View Certificate has the certificate (CertificateDialog onCertLoad).
const SSL = `(() => { const b = enyo.$.browserApp && enyo.$.browserApp.$.browser; const d = b && b.$.sslDialog;
    return d && d.isOpen ? JSON.stringify({ message: b.$.sslConfirmMessage.getContent(), view: !b.$.viewCertButton.disabled }) : ""; })()`;
// Its buttons, tapped (Browser.js:98-101: response "1", "2", "0").
const sslAnswer = (caption) => `(() => { const b = enyo.$.browserApp.$.browser;
    const btn = Object.values(b.$).find((c) => c.kind === "Button" && c.caption === ${JSON.stringify(caption)});
    btn.hasNode().click(); return true; })()`;
// The address bar's padlock (AddressInput.js:33 secureLock).
const LOCK = `(() => { const l = Object.values(enyo.$).find((c) => c && c.name === "secureLock" && c.owner && c.owner.kind === "AddressInput"
    && c.owner.owner && c.owner.owner.owner && c.owner.owner.owner.owner === enyo.$.browserApp.$.browser);
    return !!(l && l.showing); })()`;
const go = (url) => `(enyo.$.browserApp.$.browser.$.dialog.isOpen && enyo.$.browserApp.$.browser.$.dialog.close(), enyo.$.browserApp.$.browser.setUrl(${JSON.stringify(url)}), true)`;
const call = (url, params) => `new Promise((resolve) => __phoenixRuntime.dispatch(${JSON.stringify(url)}, ${JSON.stringify(params || {})}, resolve, { cancelled: () => false }))`;

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const server = await site();
    const base = "http://127.0.0.1:" + server.address().port;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-browser-sim-"));
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-browser-certs-"));
    const once = await tlsSite(certDir, "once"), always = await tlsSite(certDir, "always");
    const onceUrl = "https://127.0.0.1:" + once.address().port + "/", alwaysUrl = "https://127.0.0.1:" + always.address().port + "/";
    let sim = null, simLog = "";
    // The simulator (again with the same HOME: the device after a restart),
    // the browser opened at target.
    async function start(target) {
        const port = 9300 + Math.floor(Math.random() * 500);
        simLog = "";
        sim = spawn(SIM, ["--phone", "--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", QML_DIR, "--repo-dir", REPO,
                          "--launch", "com.palm.app.browser:" + JSON.stringify({ target })], {
            env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(port), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
            stdio: ["ignore", "pipe", "pipe"]
        });
        sim.stdout.on("data", (d) => { simLog += d; });
        sim.stderr.on("data", (d) => { simLog += d; });
        return devtools(port);
    }
    async function stop() {
        if (sim && sim.exitCode === null && sim.signalCode === null) {
            const exited = new Promise((resolve) => sim.once("exit", resolve));
            sim.kill("SIGTERM");
            if (!(await Promise.race([exited.then(() => true), sleep(10000).then(() => false)])))
                sim.kill("SIGKILL");
        }
    }
    const shot = (file) => {
        try {
            const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(sim.pid)]).toString().trim().split("\n").pop();
            execFileSync("import", ["-window", id, path.join(outDir, file)]);
        } catch (e) { /* the checks say what failed */ }
    };
    const APP = /com\.palm\.app\.browser\/index\.html/;
    try {
        let dt = await start(base + "/missing");
        const app = await dt.page(APP, 60000);
        const view = await dt.page(new RegExp("^" + base.replace(/[.:\/]/g, "\\$&") + "/missing"), 60000);
        if (!check(app && view, "phoenix-sim runs; the browser and its page view are up")) throw new Error("no pages");

        // ---- 404: the server's own page, and no error over it ----
        check(!!await until(() => view.evaluate(`document.readyState === "complete" && document.title === "Not here"`), 20000),
              "404: the server's page is shown (its title)");
        await sleep(2500);
        const said = await app.evaluate(DIALOG);
        check(said === "", `404: no error dialog over it${said ? " (\"" + said + "\")" : ""}`);
        const title = await app.evaluate(`enyo.$.browserApp.$.browser.title || ""`);
        check(title === "Not here", `404: the browser has the page's title (${title})`);
        shot("browser-404.png");

        // ---- A server that is not there: the error, as before ----
        const gone = "http://127.0.0.1:9/";
        await app.evaluate(go(gone));
        const refused = await until(() => app.evaluate(DIALOG), 20000);
        check(!!refused && /Error/.test(refused), `refused: the error dialog says so (${refused})`);
        shot("browser-refused.png");

        // ---- New windows: new cards ----
        await app.evaluate(go(base + "/opener"));
        const op = await dt.page(new RegExp("/opener$"), 20000);
        check(!!op && !!await until(() => op.evaluate(`document.readyState === "complete"`), 20000), "windows: the opener page is shown");
        await sleep(2000);
        check(await dt.count(/\/child\?script$/) === 0 && await op.evaluate(`window.__popup === null`),
              "windows: a script's window.open without a tap is blocked");
        await op.evaluate(`document.getElementById("blank").click(), true`, true);
        const blank = await dt.page(/\/child\?blank$/, 20000);
        const blankTitle = blank && await until(() => blank.evaluate(`/opener/.test(document.title) && document.title`), 10000);
        check(blankTitle === "Child blank no opener", `windows: a target=_blank link opens its page (${blankTitle}), without window.opener`);
        check(await until(async () => (await dt.count(APP)) === 2, 20000), "windows: ... in a new browser card");
        const urls = async () => {
            const out = [];
            for (let i = 0; i < await dt.count(APP); i++) {
                const a = await dt.page(APP, 5000, i);
                out.push(a ? await a.evaluate(`enyo.$.browserApp && enyo.$.browserApp.$.browser.url || ""`) : "");
                if (a) a.close();
            }
            return out;
        };
        const blankUrl = await until(async () => (await urls()).find((u) => /\/child\?blank$/.test(u || "")), 20000);
        check(!!blankUrl, `windows: the new card's browser shows its address (${blankUrl || (await urls()).join(", ")})`);
        check(await op.evaluate(`location.pathname`) === "/opener", "windows: the opener stays in its card");
        shot("browser-new-card.png");
        await op.evaluate(`window.__w = window.open("/child?tap"), true`, true);
        const tapped = await dt.page(/\/child\?tap$/, 20000);
        const tappedTitle = tapped && await until(() => tapped.evaluate(`/opener/.test(document.title) && document.title`), 10000);
        check(tappedTitle === "Child tap with opener", `windows: a tap's window.open opens its page with window.opener (${tappedTitle})`);
        check(await until(async () => (await dt.count(APP)) === 3, 20000), "windows: ... in a new browser card");
        check(tapped && await tapped.evaluate(`window.opener.location.pathname`) === "/opener", "windows: window.opener is the page that opened it");
        await op.evaluate(`window.__late = window.open("/child?late"), true`);
        await sleep(2000);
        check(await dt.count(/\/child\?late$/) === 0, "windows: and later, without a tap, a script's window.open is still blocked");

        // ---- Certificates ----
        await app.evaluate(go(onceUrl));
        let ssl = await until(() => app.evaluate(SSL), 20000);
        await sleep(1500);
        check(!!ssl && /questionable signatures/.test(ssl) && /127\.0\.0\.1/.test(ssl), `certificate: the browser's SSL dialog asks (${ssl})`);
        ssl = await app.evaluate(SSL);
        check(!!ssl && JSON.parse(ssl).view === true, "certificate: View Certificate has the site's certificate");
        check(await app.evaluate(DIALOG) === "", "certificate: no \"Unable to Load Page\"");
        check(await app.evaluate(LOCK) === false, "certificate: no padlock while it asks");
        shot("browser-ssl-dialog.png");
        await app.evaluate(sslAnswer("Don't Trust"));
        await sleep(2500);
        check(await app.evaluate(SSL) === "" && await app.evaluate(DIALOG) === "", "certificate: Don't Trust stops there, with no error over it");
        check(await dt.count(/^https:\/\/127\.0\.0\.1:\d+\/$/) === 0, "certificate: ... and the page is not shown");
        check(await app.evaluate(LOCK) === false, "certificate: ... and no padlock");
        await app.evaluate(go(onceUrl));
        check(!!await until(() => app.evaluate(SSL), 20000), "certificate: asked again");
        await app.evaluate(sslAnswer("Trust Once"));
        const onceView = await dt.page(new RegExp("^" + onceUrl.replace(/[.:\/]/g, "\\$&") + "$"), 20000);
        check(!!onceView && !!await until(() => onceView.evaluate(`document.title === "Secure once"`), 20000), "certificate: Trust Once shows the page");
        await sleep(1500);
        check(await app.evaluate(LOCK) === false, "certificate: ... with no padlock (its certificate is not trusted)");
        shot("browser-trust-once.png");
        let certs = await app.evaluate(`${call("luna://com.palm.certificatemanager/listcertificates")}.then((r) => JSON.stringify(r.certificates.filter((c) => c.sites && c.sites.length)))`);
        check(certs === "[]", "certificate: Trust Once keeps nothing");
        await app.evaluate(go(alwaysUrl));
        check(!!await until(() => app.evaluate(SSL), 20000), "certificate: another site asks");
        await app.evaluate(sslAnswer("Trust Always"));
        const alwaysHost = alwaysUrl.replace(/^https:\/\//, "").replace(/\/$/, "");
        check(!!await until(async () => /Secure always/.test(await (await dt.targets()).map((t) => t.title).join(" ")), 20000), "certificate: Trust Always shows the page");
        certs = await app.evaluate(`${call("luna://com.palm.certificatemanager/listcertificates")}.then((r) => JSON.stringify(r.certificates.filter((c) => c.sites && c.sites.length).map((c) => [c.commonname, c.sites])))`);
        check(certs === JSON.stringify([["Phoenix Test always", [alwaysHost]]]), `certificate: Trust Always keeps the certificate for its host (${certs})`);
        // On http: no padlock either.
        await app.evaluate(go(base + "/"));
        await until(() => app.evaluate(`enyo.$.browserApp.$.browser.title === "Here"`), 20000);
        check(await app.evaluate(LOCK) === false, "certificate: no padlock over an http page");

        // ---- Trust Always is the device's, not this session's ----
        // Chromium keeps the exception in its profile until the simulator
        // quits; a private card's profile starts with none, so it is the
        // store's Trust Always that lets the page through there, and once
        // Settings' Certificate Manager has deleted the certificate, the
        // browser asks again.
        const privateCard = () => app.evaluate(`enyo.windows.openWindow("index.html", null, { url: ${JSON.stringify(alwaysUrl)}, phoenixPrivate: true }), true`);
        const privateApps = async () => {
            const out = [];
            for (let i = 0; i < await dt.count(APP); i++) {
                const a = await dt.page(APP, 5000, i);
                if (a && await a.evaluate(`!!(enyo.$.browserApp && enyo.$.browserApp.phoenixPrivate)`)) out.push(a);
                else if (a) a.close();
            }
            return out;
        };
        await privateCard();
        const priv = await until(async () => (await privateApps())[0], 30000);
        check(!!priv, "certificate: a private card opens");
        const privShown = priv && await until(async () => (await priv.evaluate(`enyo.$.browserApp.$.browser.title || ""`)) === "Secure always", 30000);
        check(!!privShown && await priv.evaluate(SSL) === "", "certificate: Trust Always lets the page through where Chromium has no exception (a private card), without asking");
        check(priv && await priv.evaluate(LOCK) === false, "certificate: ... with no padlock");
        shot("browser-trust-always.png");
        const removed = await app.evaluate(`${call("luna://com.palm.certificatemanager/listcertificates")}.then((r) => {
            const c = r.certificates.find((x) => x.sites && x.sites.length);
            return c ? new Promise((res) => __phoenixRuntime.dispatch("luna://com.palm.certificatemanager/removecertificate", { certificateId: c.certificateId },
                (x) => res(!!x.returnValue), { cancelled: () => false })) : false; })`);
        check(removed === true, "certificate: Settings' Certificate Manager deletes it");
        // The private card closes, and its profile with the exception.
        await priv.evaluate(`window.close(), true`);
        await until(async () => (await privateApps()).length === 0, 20000);
        await sleep(2000);
        await privateCard();
        const priv2 = await until(async () => (await privateApps())[0], 30000);
        check(!!priv2 && !!await until(() => priv2.evaluate(SSL), 30000), "certificate: deleted, the browser asks again");
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
        console.log(simLog.split("\n").filter((l) => /Error|error/.test(l)).slice(-20).join("\n"));
    } finally {
        await stop();
        server.close();
        once.close();
        always.close();
        await sleep(1000);
        fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
        fs.rmSync(certDir, { recursive: true, force: true });
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
