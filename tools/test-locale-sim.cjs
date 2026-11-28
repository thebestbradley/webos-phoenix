#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell in the device's language in phoenix-sim: for English (US),
// German and Arabic (right to left), localeInfo set as Settings > Language
// & Region sets it (com.webos.settingsservice setSystemSettings, over Qt
// WebEngine's DevTools protocol, as tools/test-index-sim.cjs drives the
// pages) while the lock screen or the system menu is up ("--scene locked",
// "--scene systemmenu": 9:41 on 6 June 2009), the shell taking it at once
// (its "Localization:" line), then the screen saved. Checks that each
// language's pictures differ from English's; the dates and strings
// themselves are shell/tests/tst_locale.qml's.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-locale-sim.cjs [--phone]
//       [--only de-DE] [--sim build/phoenix-sim] [--qml-dir shell/qml] [--out DIR]

"use strict";
const { spawn, execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const form = args.includes("--phone") ? "phone" : "tablet";
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const QML_DIR = path.resolve(opt("--qml-dir", path.join(REPO, "shell", "qml")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "locale-sim-tests")));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const ALL_LOCALES = [
    { tag: "en-US", log: /UI locale en-US, formats en-US, translation none/ },
    { tag: "de-DE", log: /UI locale de-DE, formats de-DE, translation de\b/ },
    { tag: "ar-SA", log: /UI locale ar-SA, formats ar-SA, translation ar, right to left/ },
];
// --only TAG: that language alone (and English, to compare with).
const LOCALES = ALL_LOCALES.filter((l) => !opt("--only") || l.tag === "en-US" || l.tag === opt("--only"));

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, every) {
    for (let t = 0; t < (ms || 15000); t += every || 250) {
        const v = await fn().catch(() => null);
        if (v) return v;
        await sleep(every || 250);
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
function busCall(page, uri, params) {
    return page.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                          b.call(${JSON.stringify(uri)}, ${JSON.stringify(JSON.stringify(params || {}))}); })`);
}

// phoenix-sim with this HOME; resolves with its output when it exits.
function runSim(home, simArgs, env) {
    const sim = spawn(SIM, ["--" + form, "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", QML_DIR, "--repo-dir", REPO].concat(simArgs), {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_DISABLE_SANDBOX: "1" }, env || {}),
        stdio: ["ignore", "pipe", "pipe"]
    });
    let log = "";
    sim.stdout.on("data", (d) => { log += d; });
    sim.stderr.on("data", (d) => { log += d; });
    const done = new Promise((resolve) => sim.on("exit", () => resolve(log)));
    return { sim, done, log: () => log };
}

// A scene ("locked", "systemmenu": 9:41 on 6 June 2009); the device's
// language set as Settings > Language & Region sets it, from the system
// UI's page (always there), the shell taking it at once, then the screen
// saved.
// Each run has a new HOME (the language is set live, not carried over).
async function sceneInLanguage(locale, scene, file) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-locale-sim-"));
    const run = runSim(home, ["--stay-awake", "--scene", scene],
                       { QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT) });
    simPid = run.sim.pid;
    const what = `${locale.tag} ${scene}`;
    try {
        const page = await pageMatching(/com\.palm\.systemui\/index\.html/, 90000);
        if (!check(!!page, what + ": phoenix-sim runs, the system UI's page is up")) return "";
        const r = await until(async () => {
            const a = await busCall(page, "luna://com.webos.settingsservice/setSystemSettings",
                                    { settings: { localeInfo: { locales: { UI: locale.tag, FMT: locale.tag }, clock: "locale" } } });
            return a && a.returnValue === true ? a : null;
        }, 30000, 1000);
        check(!!r, what + ": setSystemSettings {localeInfo}");
        check(!!(await until(async () => locale.log.test(run.log()), 15000)),
              what + ": the shell took it at once (" + String(locale.log).slice(1, -1) + ")");
        page.close();
        // The scene settled (the menu's fade, the lock screen's), then the screen.
        await sleep(4000);
        execFileSync("import", ["-window", windowId(), file]);
        return cropHash(file, scene);
    } finally {
        run.sim.kill("SIGTERM");
        await Promise.race([run.done, sleep(10000)]);
        try { run.sim.kill("SIGKILL"); } catch (e) { /* gone */ }
        fs.rmSync(home, { recursive: true, force: true });
    }
}

let simPid = 0;
// The simulator's window (Xvfb has no window manager: the one window shown).
function windowId() { return execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(simPid)]).toString().trim().split("\n").pop(); }

// The part with the dates and strings: the top of the lock screen (the
// bar's date, the clock, the date under it), the system menu at the right.
function cropHash(file, scene) {
    if (!fs.existsSync(file))
        return "";
    const crop = scene === "locked" ? "100%x25%+0+0" : "32%x60%+0+0";
    const gravity = scene === "locked" ? "NorthWest" : "NorthEast";
    const pixels = execFileSync("convert", [file, "-gravity", gravity, "-crop", crop, "+repage", "rgb:-"], { maxBuffer: 64 << 20 });
    return crypto.createHash("sha256").update(pixels).digest("hex");
}

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const shots = {};
    for (const locale of LOCALES) {
        for (const scene of ["locked", "systemmenu"]) {
            const file = path.join(outDir, `locale-${locale.tag}-${scene}-${form}.png`);
            fs.rmSync(file, { force: true });
            const hash = await sceneInLanguage(locale, scene, file);
            check(!!hash, `${locale.tag} ${scene}: screenshot ${file}`);
            shots[locale.tag + " " + scene] = hash;
        }
    }
    for (const locale of LOCALES.slice(1))
        for (const scene of ["locked", "systemmenu"])
            check(shots[locale.tag + " " + scene] && shots[locale.tag + " " + scene] !== shots["en-US " + scene],
                  `${locale.tag}: the ${scene} screen differs from English's`);
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
