#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Phoenix Assistant (docs/M6-PLAN.md F3) in headless Chromium
// against the simulated org.webosphoenix.assistant (the device's service
// code, apps/assistant/service, run in the page by runtime/phoenix-runtime.js):
//
//   - the Assistant app (apps/assistant): the phone's commands answer at
//     once (a sum, the flashlight), a text is read back and sent only on
//     Send, a question nothing on the phone answers offers "Search the web"
//     and "Set up a cloud model";
//   - Settings > Assistant (apps/settings): a cloud provider added (a local
//     stand-in for Anthropic's Messages API, test/mock-providers.cjs,
//     reached through serve-rootfs.py's proxy as a real one would be), its
//     connection tested; speech, units and a command switched;
//   - back in the app, "Ask Anthropic" answers in the thread; a cloud model
//     asking to act is refused until Settings allows it, then acts;
//   - Conversations: new, open, delete; Clear History; no key in the
//     stored data.
//
//   node tools/test-assistant.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "assistant-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8880 + Math.floor(Math.random() * 90);
const root = `http://127.0.0.1:${port}/usr/palm/applications`;
const appUrl = `${root}/org.webosphoenix.assistant/index.html`;
const settingsUrl = `${root}/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify({ page: "assistant" }));
const KEY = "test-anthropic";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start: " + url);
}

async function main() {
    for (const app of ["assistant", "settings"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const mockPort = port + 200;
    const mock = spawn(process.execPath, [path.join(REPO, "apps/assistant/service/test/mock-providers.cjs"), String(mockPort)], { stdio: "ignore" });
    const mockUrl = `http://127.0.0.1:${mockPort}`;
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        await waitForServer(`${mockUrl}/health`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const launches = [];
        const watch = (page, name) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    if (msg.type === "launch") launches.push(msg.payload);
                } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                    errors.push(`${name}: ${t}`);
                }
            });
        };
        const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true });
        const svc = (page, uri, params) => page.evaluate(([u, p]) => new Promise((resolve) => {
            __phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);
        const A = "luna://org.webosphoenix.assistant/";

        const app = await context.newPage();
        watch(app, "assistant");
        await app.goto(appUrl);
        await app.evaluate(() => localStorage.clear());
        await app.goto(appUrl);
        await app.waitForSelector("[data-testid='as-empty']");
        check(/set a timer/.test(await app.textContent("[data-testid='as-empty']")), "a new conversation says what it can do");

        const ask = async (text) => {
            const before = await app.locator(".as-row").count();
            await app.fill("[data-testid='as-input']", text);
            await app.click("[data-testid='as-send']");
            await app.waitForFunction((n) => document.querySelectorAll(".as-row").length >= n + 2 && !document.querySelector("[data-testid='as-thinking']"), before, { timeout: 15000 });
            return (await app.locator(".as-row.in .as-bubble").last().textContent()).trim();
        };

        // ---- The phone's own commands -----------------------------------------------------
        check(await ask("What's 15% of 80?") === "15% × 80 = 12", "a sum answered on the phone");
        check(await ask("Turn on the flashlight") === "The flashlight is on.", "the flashlight turned on");
        check((await svc(app, "luna://org.webosports.service.torch/getStatus", {})).on === true, "and it is on");
        check((await app.locator(".as-via").last().textContent()) === "On the phone", "the answer says the phone answered");
        // A text: read back, sent only on Send.
        const readBack = await ask("Text Alex I'm running late");
        check(/^Send "i'm running late" to Alex Rivera\?$/.test(readBack), "a text is read back first: " + readBack);
        const sentBefore = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.smsmessage:1" } })).results.length;
        await app.click("[data-testid='as-confirm-yes']");
        await app.waitForFunction(() => /^Sent to /.test(document.querySelectorAll(".as-row.in .as-bubble")[document.querySelectorAll(".as-row.in .as-bubble").length - 1]?.textContent || ""));
        const sent = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.smsmessage:1" } })).results;
        check(sent.length === sentBefore + 1 && sent.some((m) => m.messageText === "i'm running late" && m.folder === "outbox"), "Send puts the text in the outbox");
        await shot(app, "thread-commands");
        // Nothing here can answer.
        check(await ask("Who wrote the Odyssey?") === "I can't do that on the phone.", "a question the phone cannot answer");
        check(await app.locator("[data-testid='as-choice-web']").count() === 1 && await app.locator("[data-testid='as-choice-settings']").count() === 1,
              "it offers Search the web and Set up a cloud model");
        await app.click("[data-testid='as-choice-settings']");
        await app.waitForTimeout(300);
        check(launches.some((l) => l.id === "org.webosphoenix.settings" && l.params && l.params.page === "assistant"), "Set up a cloud model opens Settings > Assistant");

        // ---- Settings > Assistant --------------------------------------------------------------
        const st = await context.newPage();
        watch(st, "settings");
        await st.goto(settingsUrl);
        await st.waitForSelector("[data-testid='as-enabled']");
        await shot(st, "settings");
        check(/llama-server/.test(await st.textContent("[data-testid='as-local-status']")), "without llama.cpp, it says how to get it");
        check(await st.locator("[data-testid^='as-model-']").count() === 3, "three on-device models offered, with size and memory");
        const settings = async () => (await svc(st, A + "getSettings", {})).settings;
        const until = async (fn, what) => {
            for (let i = 0; i < 50; ++i) {
                if (fn(await settings())) return check(true, what);
                await st.waitForTimeout(100);
            }
            check(false, what);
        };
        await st.click("[data-testid='as-speak']");
        await until((s) => s.speak === false, "Speak answers: off");
        await st.click("[data-testid='as-units']");
        await st.click("role=option[name='°C']");
        await until((s) => s.units === "metric", "Weather units: °C");
        await st.click("[data-testid='as-cmd-toggle-weather']");
        await until((s) => s.disabledCommands.includes("weather"), "the weather command turned off");
        await st.click("[data-testid='as-cmd-toggle-weather']");
        await until((s) => !s.disabledCommands.includes("weather"), "and on again");

        // A provider: Anthropic's API, here the local stand-in.
        await st.click("[data-testid='as-add-provider']");
        await st.click("role=option[name='Anthropic']");
        await st.waitForSelector("[data-testid='as-provider-key']");
        check(await st.inputValue("[data-testid='as-provider-model']") === "claude-sonnet-5-5", "Anthropic's model suggested: claude-sonnet-5-5");
        await st.fill("[data-testid='as-provider-url']", mockUrl);
        await st.fill("[data-testid='as-provider-key']", "wrong-key");
        await st.click("[data-testid='as-provider-test']");
        await st.waitForSelector("[data-testid='as-provider-result']");
        check(/401.*check the key/.test(await st.textContent("[data-testid='as-provider-result']")), "a wrong key: the test says so");
        await st.fill("[data-testid='as-provider-key']", KEY);
        await st.click("[data-testid='as-provider-test']");
        await st.waitForSelector("[data-testid='as-provider-result']:has-text('Connected')");
        check(true, "the right key: connected");
        await shot(st, "settings-provider");
        await st.click("[data-testid='as-provider-save']");
        // Back on the page once it is saved (the editor's own result note
        // says "anthropic" too: wait for the page, not for the word).
        await st.waitForSelector("[data-testid='as-add-provider']");
        const provs = (await svc(st, A + "providers", {})).providers;
        check(provs.length === 1 && provs[0].keyHint === "opic" && provs[0].hasKey && provs[0].model === "claude-sonnet-5-5", "the provider saved, its key hidden");
        const stored = await st.evaluate(() => JSON.stringify({ ...localStorage }));
        check(!stored.includes(KEY), "the key is not in the stored data");
        check(await st.locator("[data-testid='as-cloud-control'][aria-checked='true']").count() === 0, "cloud models may not control the device by default");

        // ---- Asking the cloud model --------------------------------------------------------------
        await app.bringToFront();
        await ask("Tell me about the Palm Pre");
        await app.click("[data-testid^='as-choice-cloud:']");
        await app.waitForFunction(() => /anthropic says: Tell me about the Palm Pre/.test(document.body.textContent));
        check(/Anthropic \(claude-sonnet-5-5\)/.test(await app.locator(".as-via").last().textContent()), "Ask Anthropic answers, labelled");
        const refused = await ask("force a tool");
        check(/cloud models may only chat/.test(refused), "a cloud model asking to act is refused");
        check(await ask("Turn off the flashlight") === "The flashlight is off.", "the phone's own commands answer first, in a cloud thread too");
        await st.bringToFront();
        await st.click("[data-testid='as-cloud-control']");
        await until((s) => s.allowCloudControl === true, "Allow cloud models to control the device: on");
        await app.bringToFront();
        check(await ask("Put the flashlight on for me") === "The flashlight is on.", "allowed, the cloud model acts");
        check(/Anthropic/.test(await app.locator(".as-via").last().textContent()), "and the answer says it was Anthropic");
        await shot(app, "thread-cloud");

        // ---- Conversations ----------------------------------------------------------------------
        await app.click("[data-testid='as-conversations']");
        await app.waitForSelector("[data-testid='as-new']");
        const threads = (await svc(app, A + "threads", {})).threads;
        check(threads.length === 1, "one conversation so far");
        await app.click("[data-testid='as-new']");
        await app.waitForSelector("[data-testid='as-empty']");
        await ask("What time is it?");
        await app.click("[data-testid='as-conversations']");
        await app.waitForFunction(() => document.querySelectorAll("[data-testid^='as-thread-']").length === 2);
        check(true, "a new conversation listed beside the first");
        await shot(app, "conversations");
        const first = threads[0].id;
        await app.click(`[data-testid='as-thread-${first}']`);
        await app.waitForSelector(".as-bubble:has-text('Palm Pre')");
        check((await svc(app, A + "threads", {})).current === first, "an old conversation opened goes on in use");
        await app.click("[data-testid='as-conversations']");
        const second = (await svc(app, A + "threads", {})).threads.find((t) => t.id !== first).id;
        await app.click(`[data-testid='as-delete-${second}']`);
        await app.click("[data-testid='as-delete-ok']");
        await app.waitForFunction(() => document.querySelectorAll("[data-testid^='as-thread-']").length === 1);
        check(true, "a conversation deleted");

        // ---- Clear History -----------------------------------------------------------------------
        await st.bringToFront();
        await st.click("[data-testid='as-clear']");
        await st.click("[data-testid='as-clear-ok']");
        await st.waitForSelector("[data-testid='as-cleared']");
        check((await svc(st, A + "threads", {})).threads.length === 0, "Clear History deletes every conversation");
        await app.waitForSelector("[data-testid='as-none']");
        check(true, "the app follows at once");
        await st.click("[data-testid='as-enabled']");
        await until((s) => s.enabled === false, "Assistant: off");
        await app.click(".pui-button:has-text('New Conversation')");
        await app.waitForSelector("[data-testid='as-off']");
        check(true, "the app says the assistant is off");
        await st.click("[data-testid='as-enabled']");
        await until((s) => s.enabled === true, "Assistant: on again");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
        mock.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
