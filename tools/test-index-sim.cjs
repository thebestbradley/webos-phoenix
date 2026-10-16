#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Search your phone in phoenix-sim (services/index; the runtime's "Search
// your phone" block; the shell's second LocalModels): turned on from
// Settings, the simulator's own data indexed with the real EmbeddingGemma
// 2 through llama.cpp's llama-server, then
//
//   - Settings > Assistant > Search your phone: its size and status;
//   - the Assistant finding a memo and an email by what they mean, each a
//     card with its app's icon ("where's that note about the internet
//     password", "find the email about the server downtime": no email has
//     those words);
//   - Just Type's "From your phone" group under the exact matches;
//
// with screenshots of each. The pages are driven over Qt WebEngine's
// DevTools protocol (QTWEBENGINE_REMOTE_DEBUGGING), the screen captured
// from the X display, as tools/test-signin-card-sim.cjs does.
//
//   python3 tools/get-index-model.py
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-index-sim.cjs [--model FILE.gguf]
//       [--llama-server PATH] [--phone] [--sim build/phoenix-sim] [--out DIR]
//
// --model: EmbeddingGemma 2's GGUF (lib/model.js TEXT: embeddinggemma-2-Q8_0.gguf,
// 310 MB), linked into the simulator's models folder (no download);
// tools/get-index-model.py's in build/index by default.
// --llama-server: a llama-server that knows the model (llama.cpp b11451
// or newer; ./phoenix builds b11552): get-index-model.py's
// (build/index/llama.cpp) when it is there, else the one on the PATH.

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const tablet = !args.includes("--phone");
const form = tablet ? "tablet" : "phone";
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "index-sim-tests")));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));
const INDEX_DIR = path.join(REPO, "build", "index");
const MODEL = opt("--model", path.join(INDEX_DIR, "embeddinggemma-2-Q8_0.gguf"));
const LLAMA = opt("--llama-server", fs.existsSync(path.join(INDEX_DIR, "llama.cpp", "llama-server")) ? path.join(INDEX_DIR, "llama.cpp", "llama-server") : "");
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const INDEX = "luna://org.webosphoenix.service.index/";

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
    execFileSync("import", ["-window", windowId(), file]);
    return file;
}

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    if (!MODEL || !fs.existsSync(MODEL)) { console.error(MODEL + " is missing: EmbeddingGemma 2's GGUF is needed (python3 tools/get-index-model.py, or --model)"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-index-sim-"));
    const models = path.join(home, ".local/share/webos-phoenix/phoenix-sim/models/index");
    fs.mkdirSync(models, { recursive: true });
    try { fs.linkSync(MODEL, path.join(models, "embeddinggemma-2-q8_0.gguf")); } catch (e) { fs.symlinkSync(path.resolve(MODEL), path.join(models, "embeddinggemma-2-q8_0.gguf")); }
    const simArgs = ["--" + form, "--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", QML_DIR, "--repo-dir", REPO,
                     "--launch", "org.webosphoenix.settings"].concat(LLAMA ? ["--llama-server", LLAMA] : []);
    const sim = spawn(SIM, simArgs, {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"]
    });
    simPid = sim.pid;
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    const results = {};
    try {
        let settings = await pageMatching(/org\.webosphoenix\.settings/, 90000);
        if (!check(!!settings, form + ": phoenix-sim runs, Settings' page is up")) throw new Error("no Settings page");
        // The system UI up and listening for its events, as tools/test-activities-sim.cjs waits for it.
        const sys = await pageMatching(/com\.palm\.systemui\/index\.html/, 30000);
        if (!check(!!sys && !!(await until(() => sys.evaluate("Date.now() - JSON.parse(localStorage.getItem('phoenix:systemui:listening') || '0') < 30000"), 30000)),
                   form + ": the system UI is up")) throw new Error("no system UI");

        // 1. Turned on from Settings; the simulator's data indexed with the real model.
        const t0 = Date.now();
        let st = await luna(settings, INDEX + "setSettings", { enabled: true });
        check(st && st.enabled === true && st.model.text.installed, form + ": turned on, the model is there (" + JSON.stringify(st && st.model.text) + ")");
        // A pass finished after it was turned on, with nothing left waiting
        // (the simulator's charger, as a device's, lets the first build run).
        st = await until(async () => {
            const s = await luna(settings, INDEX + "getStatus", {});
            return s && s.records > 0 && s.state === "idle" && s.lastRun >= t0 ? s : null;
        }, 15 * 60000, 2000);
        const took = Date.now() - t0;
        check(!!st, form + ": indexed (" + (st ? st.records + " items, " + st.passages + " passages, " + st.bytes + " bytes" : "not in time") + ") in " + Math.round(took / 1000) + " s");
        results.status = st;
        results.indexMs = took;
        if (st) console.log("     " + st.sources.map((s) => s.id + " " + s.records).join(", "));

        // 2. Queries, as the Assistant and Just Type ask them.
        for (const q of ["internet password", "when are the servers down", "lunch with Priya", "the paper about birds", "a trip with mountains and a lake"]) {
            const a = Date.now();
            const r = await luna(settings, INDEX + "search", { query: q, limit: 3 });
            results[q] = { ms: Date.now() - a, results: (r.results || []).map((x) => ({ source: x.source, title: x.title, score: x.score })) };
            console.log("     " + JSON.stringify(q) + " (" + results[q].ms + " ms): " + results[q].results.map((x) => x.source + " " + JSON.stringify(x.title) + " " + x.score).join("; "));
        }
        check(results["internet password"].results.some((x) => /Wi-Fi at the cabin/.test(x.title)), form + ": \"internet password\" finds the Wi-Fi memo");

        // 3. Settings > Assistant > Search your phone.
        await luna(settings, "luna://com.palm.applicationManager/launch", { id: "org.webosphoenix.settings", params: { page: "assistant" } });
        settings = await pageMatching(/org\.webosphoenix\.settings/, 10000);
        await until(() => settings.evaluate("!!document.querySelector('[data-testid=ix-size]')"), 15000);
        await settings.evaluate("document.querySelector('[data-testid=ix-enabled]').closest('section').scrollIntoView(), true");
        await sleep(1200);
        console.log("     " + screenshot("index-settings-" + form + ".png"));
        const size = await settings.evaluate("document.querySelector('[data-testid=ix-size]').textContent");
        check(/[1-9]\d* items/.test(size || ""), form + ": Settings shows the index's size (" + size + ")");

        // 4. The Assistant: a memo and an email by meaning, cards with the app's icon.
        await luna(settings, "luna://com.palm.applicationManager/launch", { id: "org.webosphoenix.assistant", params: {} });
        const assistant = await pageMatching(/org\.webosphoenix\.assistant/, 30000);
        if (!check(!!assistant, form + ": the Assistant app opens")) throw new Error("no Assistant");
        // Its page ready for a request: its field there and enabled.
        await until(() => assistant.evaluate("!!document.querySelector('[data-testid=as-input]') && !document.querySelector('[data-testid=as-input]').disabled"), 30000);
        const ask = (text) => luna(assistant, "luna://org.webosphoenix.assistant/ask", { text: text, newThread: true });
        let r = await ask("where's that note about the internet password");
        let last = r && r.messages && r.messages[r.messages.length - 1];
        check(last && last.command === "searchPhone" && /Wi-Fi at the cabin/.test(last.text), form + ": the Assistant finds the memo (" + (last && last.text) + ")");
        check(last && last.data && last.data.attachments && last.data.attachments[0].items[0].icon, form + ": its card has the Memos icon");
        // The conversation on screen ({threadId}: App.tsx's launch params).
        const show = (m) => m && luna(assistant, "luna://com.palm.applicationManager/launch", { id: "org.webosphoenix.assistant", params: { threadId: m.threadId } });
        await show(last);
        await until(() => assistant.evaluate("/Wi-Fi at the cabin/.test(document.body.innerText)"), 15000);
        console.log("     " + screenshot("index-assistant-memo-" + form + ".png"));
        r = await ask("find the email about the server downtime");
        last = r && r.messages && r.messages[r.messages.length - 1];
        check(last && /Scheduled maintenance/.test(last.text), form + ": the Assistant finds the email by meaning (" + (last && last.text) + ")");
        await show(last);
        await until(() => assistant.evaluate("/Scheduled maintenance/.test(document.body.innerText)"), 15000);
        console.log("     " + screenshot("index-assistant-email-" + form + ".png"));

        // 5. Just Type (com.palm.launcher): "From your phone" under the exact
        // matches, for words no item has ("how do I get online at the lake
        // house": the Wi-Fi memo), typed on the card view.
        // Typed once the Assistant's card has left the front (the shell says
        // so: phoenixcardactivation), the card view's keys going to Just Type.
        await assistant.evaluate("window.__cardActive = null; addEventListener('phoenixcardactivation', (e) => { window.__cardActive = e.detail.active; }), true");
        execFileSync("xdotool", ["key", "--window", windowId(), "super+Home"]);
        check(!!(await until(() => assistant.evaluate("window.__cardActive === false"), 15000)), form + ": the card view (the Assistant's card no longer in front)");
        execFileSync("xdotool", ["type", "--window", windowId(), "--delay", "120", "how do I get online at the lake house"]);
        const jt = await pageMatching(/com\.palm\.launcher/, 15000);
        const group = jt ? await until(() => jt.evaluate("(function () { var c = enyo.$.justTypeApp_justType_mainView_phoenixPhoneSearch;"
            + " return c && c.$.group.showing && c.hasNode() && c.hasNode().offsetParent ? c.results.map(function (r) { return r.title; }) : null; })()"), 30000) : null;
        check(!!group && group.some((t) => /Wi-Fi at the cabin/.test(t)), form + ": Just Type shows \"From your phone\" with the Wi-Fi memo (" + JSON.stringify(group) + ")");
        await sleep(1500);
        console.log("     " + screenshot("index-justtype-" + form + ".png"));
        fs.writeFileSync(path.join(outDir, "index-sim-" + form + ".json"), JSON.stringify(results, null, 1));
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
    } finally {
        console.log(simLog.split("\n").filter((l) => /\[index\]|index|llama|Error|error/i.test(l)).slice(-40).join("\n"));
        sim.kill("SIGTERM");
        await sleep(800);
        try { sim.kill("SIGKILL"); } catch (e) { /* gone */ }
        fs.rmSync(home, { recursive: true, force: true });
    }
    console.log(failures ? failures + " failed" : "all passed");
    process.exit(failures ? 1 : 0);
}

main();
