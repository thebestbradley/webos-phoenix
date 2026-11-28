#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a page stores survives the simulator stopping, however it stops:
// a value written to localStorage by Settings' page (and a setting saved
// through com.webos.settingsservice/setSystemSettings, as Language &
// Region saves one) a few seconds before phoenix-sim
//
//   1. gets SIGTERM (what `kill`, xvfb-run, CI and the scripts send),
//   2. gets SIGINT, alone and as Ctrl+C in its terminal sends it: to its
//      whole process group, Qt WebEngine's helper processes too,
//   3. gets SIGHUP (its terminal closed),
//   4. is quit from its menu, Device > Quit (as closing its window: the
//      shutdown first, then Qt.quit; Linux, by xdotool),
//   5. quits by itself after --screenshot,
//   6. as another device (--instance), gets SIGTERM,
//
// is there when it starts again with the same HOME; each stop is a clean
// exit (status 0), not death by the signal. Before, a signal killed the
// process before Qt WebEngine shut down and wrote its profile's storage
// out, and the next start read the old value.
//
// The pages are driven over Qt WebEngine's DevTools protocol
// (QTWEBENGINE_REMOTE_DEBUGGING).
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-storage-shutdown-sim.cjs [--sim build/phoenix-sim]
//
// Needs phoenix-sim built, the apps built (Settings is the page), a
// display (Xvfb), xdotool. Linux and macOS (POSIX signals; Device > Quit
// on Linux only).

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const SETTINGS = "org.webosphoenix.settings";

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
        evaluate(expression) {
            return new Promise((resolve) => {
                const n = ++id;
                waiting[n] = (m) => resolve(m.result && m.result.result ? m.result.result.value : undefined);
                ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
            });
        },
        close() { try { ws.close(); } catch (e) { /* gone with the simulator */ } }
    };
}
async function pageMatching(re, ms) {
    const t = await until(async () => (await targets()).find((x) => re.test(x.url)), ms);
    return t ? connect(t) : null;
}

// One run of the simulator with Settings open: what it read (the value
// stored by the run before), then the new value written, then the stop.
// stop: a signal's name ("group:" before it: to the process group), "quit"
// (Device > Quit) or "screenshot" (it quits by itself).
async function run(home, { instance, stop, value }) {
    const simArgs = ["--phone", "--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace",
                     "--qml-dir", QML_DIR, "--repo-dir", REPO, "--launch", SETTINGS];
    if (instance) simArgs.push("--instance", instance);
    // Long enough to read and write before it saves its picture and quits.
    if (stop === "screenshot") simArgs.push("--screenshot", path.join(home, "shot.png"), "--delay", "45000");
    const sim = spawn(SIM, simArgs, {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"],
        detached: /^group:/.test(stop || "")   // a process group of its own, as a terminal's job
    });
    let log = "";
    sim.stdout.on("data", (d) => { log += d; });
    sim.stderr.on("data", (d) => { log += d; });
    const exited = new Promise((resolve) => sim.on("exit", (code, signal) => resolve({ code, signal })));
    const result = { read: null, locale: null, wrote: false, log: () => log };
    let page = null;
    try {
        page = await pageMatching(new RegExp(SETTINGS.replace(/\./g, "\\.") + "/"), 90000);
        if (page && await until(() => page.evaluate("typeof PalmServiceBridge !== 'undefined'"), 30000)) {
            result.read = await page.evaluate("localStorage.getItem('phoenix:test:shutdown')");
            const call = (method, params) => page.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); window.__keep = b;
                b.onservicecallback = (t) => resolve(JSON.parse(t)); b.call("luna://com.webos.settingsservice/${method}", ${JSON.stringify(JSON.stringify(params))}); })`);
            const got = await call("getSystemSettings", { keys: ["localeInfo"] });
            result.locale = got && got.settings && got.settings.localeInfo ? got.settings.localeInfo.locales.UI : null;
            if (value) {
                await page.evaluate(`localStorage.setItem('phoenix:test:shutdown', ${JSON.stringify(value.stored)}), true`);
                const set = await call("setSystemSettings", { settings: { localeInfo: { locales: { UI: value.locale } } } });
                result.wrote = !!(set && set.returnValue) && await page.evaluate("localStorage.getItem('phoenix:test:shutdown')") === value.stored;
            }
        }
    } catch (e) {
        console.log("     " + e.message);
    }
    if (page) page.close();
    // A few seconds after the write: well inside the time it was lost in.
    await sleep(3000);
    if (stop === "quit") {
        // The window with the menus sits at the display's corner (Xvfb has
        // no window manager): Device, the first menu; Quit, its last item.
        execFileSync("xdotool", ["mousemove", "20", "8", "click", "1"]);
        await sleep(1000);
        execFileSync("xdotool", ["key", "Up", "Return"]);
    } else if (/^group:/.test(stop)) {
        process.kill(-sim.pid, stop.slice(6));
    } else if (stop !== "screenshot") {
        sim.kill(stop);
    }
    const timer = setTimeout(() => sim.kill("SIGKILL"), stop === "screenshot" ? 120000 : 30000);
    result.exit = await exited;
    clearTimeout(timer);
    return result;
}

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY && process.platform !== "darwin") { console.error("No display: run under xvfb-run"); process.exit(2); }
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-storage-shutdown-"));
    // Each step: how it stops, the device (instance), what it writes, and
    // what the next run on that device must read.
    const steps = [
        { stop: "SIGTERM", value: { stored: "after-sigterm", locale: "fr-FR" } },
        { stop: "SIGINT", value: { stored: "after-sigint", locale: "de-DE" } },
        { stop: "group:SIGINT", value: { stored: "after-ctrl-c", locale: "nl-NL" } },
        { stop: "SIGHUP", value: { stored: "after-sighup", locale: "es-ES" } },
        ...(process.platform === "linux" ? [{ stop: "quit", value: { stored: "after-quit", locale: "pt-BR" } }] : []),
        { stop: "screenshot", value: { stored: "after-screenshot", locale: "it-IT" } },
        { stop: "SIGTERM", instance: "two", value: { stored: "two-after-sigterm", locale: "ja-JP" } },
    ];
    const last = {};   // device -> the value its last run wrote
    try {
        for (const step of steps) {
            const device = step.instance || "phoenix-sim";
            const r = await run(home, step);
            const before = last[device];
            if (before) {
                check(r.read === before.stored, `${device}: localStorage written before ${before.stop} is there after (read ${JSON.stringify(r.read)}, wrote ${JSON.stringify(before.stored)})`);
                check(r.locale === before.locale, `${device}: the language set before ${before.stop} is there after (read ${r.locale}, set ${before.locale})`);
            } else {
                check(r.read === null, `${device}: a new device, nothing stored yet (read ${JSON.stringify(r.read)})`);
            }
            check(r.wrote, `${device}: Settings' page stored ${step.value.stored} and the language ${step.value.locale}`);
            check(r.exit.code === 0 && !r.exit.signal,
                  `${device}: ${{ screenshot: "--screenshot quits by itself", quit: "Device > Quit", "group:SIGINT": "Ctrl+C (SIGINT to its process group)" }[step.stop] || step.stop}: a clean exit, status 0 (got ${r.exit.code}${r.exit.signal ? ", killed by " + r.exit.signal : ""})`);
            if (!r.wrote || r.exit.code !== 0) console.log(r.log().split("\n").slice(-15).join("\n"));
            last[device] = Object.assign({ stop: step.stop }, step.value);
        }
        // The last of each device, read once more (no write; SIGTERM).
        for (const device of Object.keys(last)) {
            const r = await run(home, { instance: device === "phoenix-sim" ? null : device, stop: "SIGTERM" });
            check(r.read === last[device].stored && r.locale === last[device].locale,
                  `${device}: what it stored before ${last[device].stop} is there after (read ${JSON.stringify(r.read)}, ${r.locale})`);
        }
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
