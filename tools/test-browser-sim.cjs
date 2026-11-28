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
        res.end(missing ? "<!doctype html><title>Not here</title><h1>No such page</h1>"
                        : "<!doctype html><title>Here</title><h1>A page</h1>");
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
            evaluate(expression) {
                return new Promise((resolve) => {
                    const n = ++id;
                    waiting[n] = (m) => resolve(m.result && m.result.result ? m.result.result.value : undefined);
                    ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
                });
            },
            close() { ws.close(); }
        };
    }
    return {
        targets,
        async page(re, ms) {
            const t = await until(async () => (await targets()).find((x) => re.test(x.url)), ms);
            return t ? connect(t) : null;
        }
    };
}

// The browser's error dialog (Browser.js openDialog: "Error", "Unable to Load Page").
const DIALOG = `(() => { const b = enyo.$.browserApp && enyo.$.browserApp.$.browser; const d = b && b.$.dialog;
    return d && d.isOpen ? (b.$.dialogTitle.getContent() + ": " + b.$.dialogMessage.getContent()) : ""; })()`;

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const server = await site();
    const base = "http://127.0.0.1:" + server.address().port;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-browser-sim-"));
    const port = 9300 + Math.floor(Math.random() * 500);
    const sim = spawn(SIM, ["--phone", "--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", QML_DIR, "--repo-dir", REPO,
                            "--launch", "com.palm.app.browser:" + JSON.stringify({ target: base + "/missing" })], {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(port), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"]
    });
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    const shot = (file) => {
        try {
            const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(sim.pid)]).toString().trim().split("\n").pop();
            execFileSync("import", ["-window", id, path.join(outDir, file)]);
        } catch (e) { /* the checks say what failed */ }
    };
    try {
        const dt = devtools(port);
        const app = await dt.page(/com\.palm\.app\.browser\/index\.html/, 60000);
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
        await app.evaluate(`(enyo.$.browserApp.$.browser.$.dialog.isOpen && enyo.$.browserApp.$.browser.$.dialog.close(), true)`);
        await app.evaluate(`enyo.$.browserApp.$.browser.setUrl(${JSON.stringify(gone)}), true`);
        const refused = await until(() => app.evaluate(DIALOG), 20000);
        check(!!refused && /Error/.test(refused), `refused: the error dialog says so (${refused})`);
        shot("browser-refused.png");
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
        console.log(simLog.split("\n").filter((l) => /Error|error/.test(l)).slice(-20).join("\n"));
    } finally {
        if (sim.exitCode === null && sim.signalCode === null) {
            const exited = new Promise((resolve) => sim.once("exit", resolve));
            sim.kill("SIGTERM");
            if (!(await Promise.race([exited.then(() => true), sleep(10000).then(() => false)])))
                sim.kill("SIGKILL");
        }
        server.close();
        await sleep(1000);
        fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
