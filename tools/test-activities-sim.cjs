#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The activity manager in phoenix-sim, where every app's page is a process
// of its own and the system UI's page always runs (runtime/phoenix-runtime.js,
// "Activity manager and alarms"):
//
//   1. an alarm set in the original Clock rings at its minute with the
//      Clock closed: the system UI's page launches the Clock at the
//      activity's time (as OSE's activity manager, a service, would), and
//      the alarm's popup alert opens, once;
//   2. activities due together, with nothing of their callers running,
//      each fire once: when every page fired them, an activity due with its
//      app closed fired from each page running (six here);
//   3. --launch 'appId:{json}' starts an app with those launch params
//      (Contacts' pseudo-card, from ContactsApp.js:102-105's own TEST line).
//
// The pages are driven over Qt WebEngine's DevTools protocol
// (QTWEBENGINE_REMOTE_DEBUGGING), the screen captured from the X display,
// as tools/test-index-sim.cjs does.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-activities-sim.cjs
//       [--tablet] [--sim build/phoenix-sim] [--out DIR]

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const form = args.includes("--tablet") ? "tablet" : "phone";
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "activities-sim-tests")));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const CLOCK = "com.palm.app.clock";
const KEY = "simAlarmTest";

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
// A Luna call from a page, as that page.
function luna(page, uri, params) {
    return page.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                          b.call(${JSON.stringify(uri)}, ${JSON.stringify(JSON.stringify(params || {}))}); })`);
}
let simPid = 0;
function windowId() { return execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(simPid)]).toString().trim().split("\n").pop(); }
function screenshot(name) {
    const file = path.join(outDir, name);
    try { execFileSync("import", ["-window", windowId(), file]); } catch (e) { console.log(`(no screenshot: ${e.message.split("\n")[0]})`); }
    return file;
}
const appPages = async (re) => (await targets()).filter((t) => re.test(t.url));

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-activities-sim-"));
    const pseudoCard = { launchType: "pseudo-card", contact: { phoneNumbers: [{ value: "4151234567" }] } };
    const simArgs = ["--" + form, "--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", path.join(REPO, "shell", "qml"), "--repo-dir", REPO,
                     "--launch", CLOCK, "--launch", "com.palm.app.contacts:" + JSON.stringify(pseudoCard)];
    const sim = spawn(SIM, simArgs, {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"]
    });
    simPid = sim.pid;
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    try {
        const clock = await pageMatching(/com\.palm\.app\.clock\/index\.html/, 90000);
        const sys = await pageMatching(/com\.palm\.systemui\/index\.html/, 30000);
        if (!check(!!clock && !!sys, form + ": phoenix-sim runs, the Clock's and the system UI's pages are up")) throw new Error("no pages");
        await until(() => clock.evaluate("!!(window.enyo && enyo.application && enyo.application.utilities)"), 30000);
        // The system UI listens for its events (it hosts the activities).
        await until(() => sys.evaluate("Date.now() - JSON.parse(localStorage.getItem('phoenix:systemui:listening') || '0') < 30000"), 30000);

        // 3. Contacts, launched with its params: the pseudo-card's prompt.
        const contacts = await pageMatching(/com\.palm\.app\.contacts\/index\.html/, 30000);
        const lp = contacts ? await contacts.evaluate("PalmSystem.launchParams") : "";
        const got = JSON.parse(lp || "{}");
        check(got.launchType === "pseudo-card" && got.contact && got.contact.phoneNumbers && got.contact.phoneNumbers[0].value === "4151234567",
              `--launch 'appId:{json}': Contacts has its launch params (${lp})`);
        const prompt = contacts && await until(() => contacts.evaluate("/Add To Existing/.test(document.body.innerText) && document.body.innerText"), 20000);
        check(!!prompt, "... and acts on them: its pseudo-card asks Add New Contact or Add To Existing");
        screenshot(form + "-launch-params.png");

        // 1. An alarm 20 s from now, as the Clock sets it (test-alarm.cjs).
        const due = await clock.evaluate(`new Promise((resolve) => {
            const at = new Date(Date.now() + 20000);
            const call = (url, params) => new Promise((r) => __phoenixRuntime.dispatch(url, params, r, { cancelled: () => false }));
            const when = enyo.application.utilities.getActivityDateString(at);
            call("palm://com.palm.db/put", { objects: [{ _kind: "com.palm.clock.alarm:1", key: ${JSON.stringify(KEY)}, title: "Wake up",
                occurs: "daily", hour: at.getHours(), minute: at.getMinutes(), niceTime: "", niceDay: "--", enabled: true,
                alarmSoundFile: "/media/internal/ringtones/Flurry.mp3", alarmSoundTitle: "Flurry", snoozed: false, hideSnoozeTime: false }] })
                .then(() => call("palm://com.palm.activitymanager/create", { start: true, replace: true, activity: {
                    name: ${JSON.stringify(KEY)}, description: "com.palm.app.clock alarm: Wake up", type: { foreground: true, persist: true },
                    callback: { method: "palm://com.palm.applicationManager/launch",
                                params: { id: "com.palm.app.clock", params: { action: "ring", key: ${JSON.stringify(KEY)}, setTime: when } } },
                    schedule: { start: when, local: true } } }))
                .then(() => resolve(new Date(when.replace(" ", "T")).getTime()));     // its local time, to the second
        })`);
        check(typeof due === "number" && due > Date.now(), "the Clock schedules its alarm's activity");
        // The Clock closed: nothing of it runs.
        const running = await luna(sys, "luna://com.palm.applicationManager/running", {});
        const pid = (running.running || []).find((r) => r.id === CLOCK);
        await luna(sys, "luna://com.palm.applicationManager/close", { processId: pid ? pid.processid : "" });
        const gone = await until(async () => (await appPages(/com\.palm\.app\.clock\//)).length === 0, 10000);
        check(!!gone, "the Clock is closed: no page of it runs");
        const stillThere = await until(() => sys.evaluate(`JSON.stringify(__phoenixRuntime.activities.list().filter((a) => a.name === ${JSON.stringify(KEY)}).map((a) => a.state))`), 5000);
        check(stillThere === '["waiting"]', `its activity waits (${stillThere})`);
        // At its time the Clock is launched (its page comes; the system UI's
        // page fired it at once, not a second later as for a running app),
        // and its alarm's popup alert opens, once.
        const launched = await until(async () => (await appPages(/com\.palm\.app\.clock\/index\.html/))[0], due - Date.now() + 10000, 50);
        const late = Date.now() - due;
        check(!!launched && late < 900, `at its time, the Clock is started (${late} ms after it)`);
        const alert = await until(async () => (await appPages(/com\.palm\.app\.clock\/dashAlarm\.html/))[0], 15000, 100);
        check(!!alert, `... and rings: its alarm alert opens (${Date.now() - due} ms after its time)`);
        // Once: 3 s on, no second Clock page or alert has come.
        await sleep(3000);
        const alerts = await appPages(/com\.palm\.app\.clock\/dashAlarm\.html/);
        const clocks = await appPages(/com\.palm\.app\.clock\/index\.html/);
        check(alerts.length === 1 && clocks.length === 1, `once: one Clock page, one alert (${clocks.length}, ${alerts.length})`);
        const fired = await sys.evaluate(`JSON.stringify(__phoenixRuntime.activities.list().filter((a) => a.name === ${JSON.stringify(KEY)}).map((a) => a.state))`);
        check(/running|waiting/.test(fired || ""), `the activity has fired (${fired})`);
        screenshot(form + "-alarm-closed-clock.png");

        // 2. Six activities due together, each writing a db8 object when fired.
        await luna(sys, "luna://com.palm.db/putKind", { id: "org.webosphoenix.test.fired:1", owner: "com.palm.systemui" });
        const at = new Date(Date.now() + 8000);
        const start = at.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
        for (let i = 0; i < 6; i++) {
            await luna(sys, "luna://com.palm.activitymanager/create", { start: true, replace: true, activity: {
                name: "simFireOnce" + i, description: "test", type: {}, schedule: { start },
                callback: { method: "luna://com.palm.db/put", params: { objects: [{ _kind: "org.webosphoenix.test.fired:1", tag: i }] } } } });
        }
        const pages = (await targets()).length;
        const firedCounts = async () => {
            const found = await luna(sys, "luna://com.palm.db/find", { query: { from: "org.webosphoenix.test.fired:1" } });
            const counts = [0, 0, 0, 0, 0, 0];
            (found.results || []).forEach((o) => { counts[o.tag]++; });
            return counts;
        };
        // Each fires (its object in db8), however long that takes on a loaded
        // machine; then nothing fires one again: none more by 6 s after their
        // time, and 2 s at least after the last came.
        await until(async () => (await firedCounts()).every((n) => n >= 1), Math.max(0, at.getTime() - Date.now()) + 30000);
        await sleep(Math.max(2000, at.getTime() + 6000 - Date.now()));
        const counts = await firedCounts();
        check(counts.every((n) => n === 1), `six activities due together, ${pages} pages running: each fires once (${counts.join(", ")})`);
    } catch (e) {
        check(false, "ran to the end: " + e.message);
    } finally {
        sim.kill();
        await sleep(500);
        fs.writeFileSync(path.join(outDir, form + "-sim.log"), simLog);
        fs.rmSync(home, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
