#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant on accounts connected through Synergy, in phoenix-sim
// (docs/AI-AND-MCP.md "The Assistant and Synergy"), with real connectors:
// Todoist and Bluesky against their stand-ins (apps/connectors/testing/
// fake-providers.cjs), Jabber against the simulator's demo server
// (chat.example). Each connector package is packed and installed as the
// Marketplace installs Phoenix's own, each account made as its sign-in
// page makes it (checkCredentials, then createAccount), then in the
// Assistant app:
//   1. "add oat milk to my todoist groceries list": the task in Todoist's
//      kind, and on Todoist's server after a sync; Tasks shows it
//   2. "what's on my todoist groceries list"
//   3. "post to bluesky: ...": read back naming the account; Post; on the
//      stand-in's server
//   4. "message Ada on Jabber: ...": read back; Send; the demo server has it
//   5. "what accounts do I have"
// Screenshots of the whole simulator window after each.
//
// The pages are driven over Qt WebEngine's DevTools protocol
// (QTWEBENGINE_REMOTE_DEBUGGING); the screen is captured from the X display.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-assistant-synergy-sim.cjs [--phone] [--sim build/phoenix-sim] [--out DIR]
//
// Needs phoenix-sim built, the apps built, the connector kit built (its lib/),
// ImageMagick's import, a display (Xvfb). DEBUG_SEND=1: the Jabber message
// followed until it is sent.

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const form = args.includes("--phone") ? "phone" : "tablet";
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "assistant-synergy-sim", form)));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const { createFakeProviders } = require(path.join(REPO, "apps/connectors/testing/fake-providers.cjs"));

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
    const send = (method, params) => new Promise((resolve) => { const n = ++id; waiting[n] = resolve; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    return {
        send,
        async evaluate(expression) {
            const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
            return m.result && m.result.result ? m.result.result.value : undefined;
        },
        close() { ws.close(); }
    };
}
async function pageMatching(re, ms) {
    const t = await until(async () => (await targets()).find((x) => re.test(x.url)), ms);
    return t ? connect(t) : null;
}
const luna = (page, uri, params) => page.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge();
    b.onservicecallback = (t) => resolve(JSON.parse(t)); b.call(${JSON.stringify(uri)}, ${JSON.stringify(JSON.stringify(params || {}))}); })`);
let simPid = 0;
function screenshot(name) {
    const file = path.join(outDir, name);
    const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(simPid)]).toString().trim().split("\n").pop();
    execFileSync("import", ["-window", id, file]);
    console.log("     " + file);
    return file;
}

// The Assistant app: a request typed and sent; its answer, once the app shows it.
async function ask(app, text) {
    const before = await app.evaluate("document.querySelectorAll('.as-msg, [data-role=assistant], .as-bubble').length");
    await app.evaluate("document.querySelector('[data-testid=as-input]').focus()");
    await app.send("Input.insertText", { text });
    await sleep(150);
    await app.evaluate("document.querySelector('[data-testid=as-send]').click()");
    await until(() => app.evaluate(`document.querySelectorAll('.as-msg, [data-role=assistant], .as-bubble').length > ${before} &&
                                     !document.querySelector('[data-testid=as-input]').disabled`), 30000);
    await sleep(700);
    return app.evaluate("document.body.innerText");
}

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-synergy-sim-"));
    const ipks = {};
    for (const name of ["todoist", "bluesky", "xmpp"])
        ipks[name] = pack(path.join(REPO, "apps/connectors", name), packDir, { vendor: false, namespaces: ["org.webosphoenix", "com.webosphoenix"] }).file;
    const fake = await createFakeProviders().start(0);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-synergy-home-"));
    const sim = spawn(SIM, ["--" + form, "--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", QML_DIR, "--repo-dir", REPO,
                            "--launch", "org.webosphoenix.assistant"], {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"]
    });
    simPid = sim.pid;
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    const started = Date.now();
    try {
        const app = await pageMatching(/org\.webosphoenix\.assistant\/index\.html/, 90000);
        if (!check(!!app, form + ": phoenix-sim runs, the Assistant app is up")) throw new Error("no Assistant page");
        await sleep(Math.max(1000, 10000 - (Date.now() - started)));
        // The image's settings that point the connectors at the stand-ins (no provider registration: tokens and app passwords).
        await app.evaluate(`(function (cfg) { Object.keys(cfg).forEach(function (k) { localStorage.setItem("phoenix:systemConfig:" + k, JSON.stringify(cfg[k])); }); })(${JSON.stringify(fake.systemConfig([]))})`);

        // ---- The connectors, installed as the Marketplace installs Phoenix's own ----------------------------
        for (const [name, id] of [["todoist", "org.webosphoenix.todoist"], ["bluesky", "org.webosphoenix.bluesky"], ["xmpp", "org.webosphoenix.xmpp"]]) {
            const b64 = fs.readFileSync(ipks[name]).toString("base64");
            const r = await app.evaluate(`(function () {
                var bin = atob(${JSON.stringify(b64)}), bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; ++i) bytes[i] = bin.charCodeAt(i);
                __phoenixRuntime.tmpFiles.write("/tmp/${name}.ipk", bytes);
                return __phoenixRuntime.installPackage(${JSON.stringify(id)}, "/tmp/${name}.ipk", null, false, null, true).then(function (x) { return x.appId; }, function (e) { return "error: " + e.message; });
            })()`);
            check(r === id, "the " + name + " connector is installed (" + r + ")");
        }
        await sleep(3000);

        // ---- The accounts, as their sign-in pages make them ------------------------------------------------
        async function account(templateId, service, signIn) {
            const v = await luna(app, "luna://" + service + "/checkCredentials", Object.assign({ templateId, config: {} }, signIn));
            if (!check(v && v.returnValue, templateId + ": signed in (" + (v && (v.errorText || v.username)) + ")")) return null;
            const t = (await luna(app, "luna://com.palm.service.accounts/listAccountTemplates", {})).results.find((x) => x.templateId === templateId);
            const c = await luna(app, "luna://com.palm.service.accounts/createAccount", { templateId, username: v.username, credentials: v.credentials, config: v.config,
                                                                                         capabilityProviders: t.capabilityProviders.map((p) => ({ id: p.id })) });
            check(c && c.returnValue, templateId + ": the account is made");
            return c && c.result;
        }
        const todo = await account("com.webosphoenix.todoist", "org.webosphoenix.service.todoist", { password: fake.todoist.token });
        const sky = await account("com.webosphoenix.bluesky", "org.webosphoenix.service.bluesky", { username: fake.bluesky.handle, password: fake.bluesky.appPassword });
        const jabber = await account("com.webosphoenix.xmpp", "org.webosphoenix.service.xmpp", { username: "me@chat.example", password: "phoenix" });
        await sleep(2500);
        if (todo) await luna(app, "luna://org.webosphoenix.service.todoist/sync", { accountId: todo._id });
        if (sky) await luna(app, "luna://org.webosphoenix.service.bluesky/sync", { accountId: sky._id });
        const db = (kind) => luna(app, "luna://com.palm.db/find", { query: { from: kind } }).then((r) => r.results || []);
        check(!!(await until(async () => (await db("com.palm.tasklist.todoist:1")).find((l) => l.name === "Groceries"), 20000)), "Todoist's projects are lists");
        check(!!(await until(async () => (await db("com.palm.person:1")).find((p) => (p.ims || []).some((i) => i.type === "type_jabber" && i.value === "ada.palmer@chat.example")), 30000)),
              "the Jabber roster is linked to people");
        await app.evaluate("location.reload()");
        await sleep(4000);
        const fresh = await pageMatching(/org\.webosphoenix\.assistant\/index\.html/, 20000);

        // ---- 1-2. Todoist -------------------------------------------------------------------------------------
        let said = await ask(fresh, "add oat milk to my todoist groceries list");
        check(/Added “Oat milk” to your Groceries list in Todoist/.test(said), "1. the task, in Todoist's list");
        screenshot("1-todoist-add.png");
        check(!!(await until(async () => (await db("com.palm.task.todoist:1")).find((x) => x.summary === "Oat milk"), 5000)), "in Todoist's kind");
        await luna(fresh, "luna://org.webosphoenix.service.todoist/sync", { accountId: todo._id });
        check(!!(await until(async () => fake.todoist.tasks.find((x) => x.content === "Oat milk" && x.project_id === "220474323"), 15000)), "and on Todoist after a sync");
        said = await ask(fresh, "what's on my todoist groceries list");
        check(/Groceries \(Todoist\) list: “Buy milk” and “Oat milk”/.test(said), "2. Todoist's list read");
        screenshot("2-todoist-list.png");

        // ---- 3. Bluesky ---------------------------------------------------------------------------------------
        said = await ask(fresh, "post to bluesky: Shipping the new launcher today");
        check(/Post to Bluesky as @anna\.test: “Shipping the new launcher today”\?/.test(said), "3. the post read back, naming the account");
        screenshot("3-bluesky-readback.png");
        check(fake.bluesky.posts.length === 0, "nothing posted before Yes");
        await fresh.evaluate("document.querySelector('[data-testid=as-confirm-yes]').click()");
        check(!!(await until(async () => fake.bluesky.posts.find((p) => p.record.text === "Shipping the new launcher today"), 15000)), "posted on Yes, to Bluesky's server");
        await sleep(1200);
        screenshot("4-bluesky-posted.png");

        // ---- 4. Jabber ----------------------------------------------------------------------------------------
        said = await ask(fresh, "message Ada on Jabber: the mock-ups are ready");
        if (!check(/Send "the mock-ups are ready" to Ada Palmer on Jabber\?/.test(said), "4. the message read back")) {
            const all = await luna(fresh, "luna://com.palm.service.accounts/listAccounts", {});
            console.log("     accounts: " + JSON.stringify((all.results || []).map((a) => [a.templateId, a.username, (a.capabilityProviders || []).map((c) => [c.capability, c.serviceName, c.dbkinds])])));
            console.log("     login states: " + JSON.stringify(await db("com.palm.imloginstate:1")));
        }
        screenshot("5-jabber-readback.png");
        await fresh.evaluate("document.querySelector('[data-testid=as-confirm-yes]').click()");
        // Sent when the demo server acknowledges it (XEP-0198), in a couple
        // of seconds; DEBUG_SEND=1: the message's status and the page keeping
        // the connection, as it goes (a phoenix-sim that let Chromium slow its
        // hidden pages took up to a minute: shell/sim/main.cpp).
        const yes = Date.now();
        if (process.env.DEBUG_SEND) {
            const logAt = simLog.length;
            console.log("     pages: " + JSON.stringify((await targets()).map((t) => t.url.replace(/^.*\/(?=[^/]+\/[^/]+$)/, ""))));
            let last = "";
            for (let i = 0; i < 160; i++) {
                const m = (await db("com.palm.immessage.xmpp:1")).find((x) => x.messageText === "the mock-ups are ready");
                const st = await fresh.evaluate(`JSON.stringify({live: localStorage.getItem("phoenix:connector:live:org.webosphoenix.service.xmpp"),
                    calls: Object.keys(localStorage).filter((k) => /connector:(call|reply):/.test(k)), now: Date.now()})`);
                const line = (m ? m.status : "none") + " " + st.replace(/"now":\d+/, "");
                if (line !== last) { console.log("     +" + (Date.now() - yes) + " ms " + (m ? m.status : "none") + " " + st); last = line; }
                if (m && m.status === "successful") break;
                await sleep(250);
            }
            console.log(simLog.slice(logAt).split("\n").filter((l) => /xmpp|connector|NOT_LIVE|outbox/i.test(l)).slice(-60).join("\n"));
        }
        const out = await until(async () => (await db("com.palm.immessage.xmpp:1")).find((m) => m.messageText === "the mock-ups are ready" && m.status === "successful"), 20000);
        if (!check(!!out, "sent on Yes by the Jabber account (" + (out ? out.status + " after " + (Date.now() - yes) + " ms" : "not sent") + ")")) {
            console.log("     messages: " + JSON.stringify((await db("com.palm.immessage:1")).filter((m) => /mock-ups/.test(m.messageText || "")).map((m) => [m._kind, m.folder, m.status, m.serviceName, m.username, m.to, m.errorText])));
            console.log("     login states: " + JSON.stringify((await db("com.palm.imloginstate:1")).map((s) => [s.serviceName, s.username, s.state, s.accountId])));
        }
        await sleep(1000);
        screenshot("6-jabber-sent.png");

        // ---- 5. The accounts ----------------------------------------------------------------------------------
        said = await ask(fresh, "what accounts do I have");
        check(/Bluesky for contacts, messages and posts.*Jabber \(XMPP\) for contacts and messages.*Todoist for tasks/.test(said.replace(/\n/g, " ")), "5. the accounts listed");
        screenshot("7-accounts.png");
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
        try { screenshot("error.png"); } catch (x) { /* no window */ }
        if (process.env.VERBOSE) console.log(simLog.slice(-4000));
    } finally {
        sim.kill("SIGTERM");
        await fake.stop();
    }
    console.log(failures ? failures + " failed" : "all passed");
    process.exit(failures ? 1 : 0);
}
main();
