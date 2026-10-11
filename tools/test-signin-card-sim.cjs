#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Sign In card in phoenix-sim (the device's way of an OAuth sign-in,
// services/oauth/signincard.js; the simulator's sheet stays the default):
// the runtime's OAuth service switched to the card
// (__phoenixRuntime.oauthUseCard(true)), a sign-in against a fake provider
// (services/oauth/test/fake-provider.cjs) started from a page, the card
// org.webosphoenix.signin opening the provider's page under the shell's
// bar (SignInBar: host, lock, Cancel), Allow pressed, the redirect to the
// loopback address stopped by the card and handed to the waiting page;
// then a sign-in whose card is closed: CANCELED. Screenshots of the whole
// simulator window.
//
// The pages are driven over Qt WebEngine's DevTools protocol
// (QTWEBENGINE_REMOTE_DEBUGGING); the screen is captured from the X display.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-signin-card-sim.cjs [--tablet] [--sim build/phoenix-sim] [--out DIR]
//
// Needs phoenix-sim built, the apps built (Settings is the page the sign-in
// starts from), ImageMagick's import, a display (Xvfb).

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const tablet = args.includes("--tablet");
const form = tablet ? "tablet" : "phone";
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "signin-card-tests")));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const { createFakeProvider } = require(path.join(REPO, "services/oauth/test/fake-provider.cjs"));

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

// ---- The DevTools protocol, by hand (Node's WebSocket) ----------------------------

async function targets() {
    const r = await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json");
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
        url: target.url,
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
async function pageMatching(re, ms) {
    const t = await until(async () => (await targets()).find((x) => re.test(x.url)), ms);
    return t ? connect(t) : null;
}
// The simulator's window (Xvfb has no window manager: it is the one window shown).
function screenshot(name) {
    const file = path.join(outDir, name);
    const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(simPid)]).toString().trim().split("\n").pop();
    execFileSync("import", ["-window", id, file]);
    return file;
}
let simPid = 0;

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const provider = await createFakeProvider({ redirectUris: ["http://127.0.0.1/oauth/callback"] }).start(0);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-signin-sim-"));
    const sim = spawn(SIM, ["--" + form, "--stay-awake", "--no-boot-animation", "--quiet", "--qml-dir", QML_DIR, "--repo-dir", REPO, "--launch", "org.webosphoenix.settings"], {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"]
    });
    simPid = sim.pid;
    const started = Date.now();
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    try {
        // The sim's window sits at the display's corner (Xvfb has no window manager).
        const settings = await pageMatching(/org\.webosphoenix\.settings/, 60000);
        if (!check(!!settings, form + ": phoenix-sim runs, Settings' page is up")) throw new Error("no Settings page");
        // The shell and the system UI settle (no boot animation: --no-boot-animation).
        await sleep(Math.max(1000, 8000 - (Date.now() - started)));
        await settings.evaluate("__phoenixRuntime.oauthUseCard(true)");
        const ru = await settings.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                                             b.call("luna://org.webosphoenix.service.oauth/redirectUri", "{}"); })`);
        check(ru && ru.redirectUri === "http://127.0.0.1/oauth/callback" && /:47613\//.test(ru.fixedRedirectUri),
              form + ": with the card, the redirect is the loopback address (" + (ru && ru.redirectUri) + ")");
        const start = (p) => settings.evaluate(`(function () { window.__signin = null; var b = new PalmServiceBridge(); window.__signinBridge = b;
            b.onservicecallback = function (t) { window.__signin = JSON.parse(t); };
            b.call("luna://org.webosphoenix.service.oauth/authorize", ${JSON.stringify(JSON.stringify(p))}); return true; })()`);
        const params = { authorizationEndpoint: provider.authorizationEndpoint, tokenEndpoint: provider.tokenEndpoint, clientId: provider.clientId,
                         scope: "files.read", redirectUri: "http://127.0.0.1/oauth/callback" };

        // 1. Allow.
        await start(params);
        const card = await pageMatching(new RegExp("^" + provider.base.replace(/[.:\/]/g, "\\$&") + "/authorize"), 20000);
        if (!check(!!card, form + ": the Sign In card opens the provider's page")) throw new Error("no card");
        check(await card.evaluate("typeof PalmSystem === 'undefined' && typeof PalmServiceBridge === 'undefined' && typeof __phoenixRuntime === 'undefined'"),
              form + ": the provider's page has no Phoenix runtime in it");
        await sleep(1500);
        console.log("     " + screenshot("signin-card-sim-" + form + ".png"));
        await card.evaluate("document.getElementById('allow').click(), true");
        const r = await until(() => settings.evaluate("window.__signin"), 20000);
        check(r && r.returnValue === true && !!r.keyId, form + ": signed in through the card (" + JSON.stringify(r) + ")");
        check(!!(await until(async () => !(await targets()).some((t) => t.url.indexOf(provider.base) === 0 || /org\.webosphoenix\.signin/.test(t.url)), 10000)),
              form + ": the card has closed");
        const tok = r && r.keyId ? await settings.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                                    b.call("luna://org.webosphoenix.service.oauth/token", ${JSON.stringify(JSON.stringify({ keyId: r.keyId }))}); })`) : null;
        check(tok && /^at-/.test(tok.accessToken || ""), form + ": the token is kept for the page that signed in");
        await sleep(800);
        console.log("     " + screenshot("signin-card-sim-" + form + "-after.png"));

        // 2. The card closed: CANCELED.
        await start(params);
        const card2 = await pageMatching(new RegExp("^" + provider.base.replace(/[.:\/]/g, "\\$&") + "/authorize"), 20000);
        check(!!card2, form + ": a second sign-in opens the card again");
        await card2.evaluate("window.close(), true");
        const r2 = await until(() => settings.evaluate("window.__signin"), 15000);
        check(r2 && r2.errorCode === "CANCELED", form + ": the card closed: CANCELED (" + JSON.stringify(r2) + ")");

        // 3. The sheet is still the default.
        await settings.evaluate("__phoenixRuntime.oauthUseCard(false)");
        const ru2 = await settings.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                                              b.call("luna://org.webosphoenix.service.oauth/redirectUri", "{}"); })`);
        check(ru2 && /signed-in\.html$/.test(ru2.redirectUri), form + ": without the card, the sheet's redirect again");
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
        console.log(simLog.split("\n").filter((l) => /oauth|signin|Error|error/i.test(l)).slice(-30).join("\n"));
    } finally {
        sim.kill("SIGTERM");
        await sleep(500);
        try { sim.kill("SIGKILL"); } catch (e) { /* gone */ }
        await provider.stop();
        fs.rmSync(home, { recursive: true, force: true });
    }
    console.log(failures ? failures + " failed" : "all passed");
    process.exit(failures ? 1 : 0);
}

main();
