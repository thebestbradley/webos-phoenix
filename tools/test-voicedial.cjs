#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Voice Dial (apps/voicedial, built into dist/) in headless Chromium
// against the runtime's org.webosphoenix.dictation, with this script in the
// shell's place: it answers the "dictation" host messages the runtime posts
// ({op: start | stop | cancel}) through __phoenixRuntime.dictationEvent, as
// phoenix-sim's SimWindowSource does with the shell's microphone and
// whisper.cpp. The transcripts are what whisper.cpp made of espeak-ng saying
// the commands (see docs/APP-RUNTIME.md, "Voice Dial"), mishearings
// included. It checks: the contacts' names go to the transcriber as the
// prompt; a name heard wrong is still matched; "Yes" places the call
// (Phone, launched with {number, dial: true}, calls); "No" listens again; a number;
// a choice between two people; no match; nothing heard; tapping the
// microphone; and without a shell's microphone, a clear error. Also the
// original ids: com.palm.sysapp.voicedial and
// com.palm.pmvoicecommand/startVoiceCommand.
//
//   node tools/test-voicedial.cjs [--tablet] [--out DIR]
//
// Build the app first (cd apps && npm ci && npm run build).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "voicedial-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);
const APP = `http://127.0.0.1:${port}/usr/palm/applications/org.webosphoenix.voicedial/index.html`;
const PHONE = `http://127.0.0.1:${port}/usr/palm/applications/org.webosphoenix.phone/index.html`;

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
    throw new Error("server did not start");
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/voicedial/dist/index.html"))) {
        console.error("apps/voicedial/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) {
                const msg = JSON.parse(t.slice(11));
                host.push({ type: msg.type, payload: msg.payload });
            } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                errors.push(t);
            }
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        // The shell: one has a microphone ({"dictation": true} in host.json).
        let shellHasMic = true;
        await context.route("**/usr/share/phoenix/host.json", (route) =>
            route.fulfill({ contentType: "application/json", body: JSON.stringify(shellHasMic ? { dictation: true } : {}) }));
        const dictationOps = () => host.filter((m) => m.type === "dictation").map((m) => m.payload);
        const waitOp = async (op, n) => {
            const until = Date.now() + 5000;
            while (Date.now() < until) {
                const ops = dictationOps().filter((p) => p.op === op);
                if (ops.length >= n) return ops[n - 1];
                await page.waitForTimeout(50);
            }
            throw new Error(`no dictation ${op} #${n}`);
        };
        const say = (ev) => page.evaluate((e) => window.__phoenixRuntime.dictationEvent(e), ev);
        const hear = async (text) => {
            await say({ state: "listening" });
            await say({ state: "transcribing" });
            await say({ state: "done", text });
        };
        const stage = () => page.getAttribute("[data-testid='voicedial']", "data-stage");
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        const open = async () => {
            host.length = 0;
            await page.goto(APP);
            await page.waitForSelector("[data-testid='voicedial']");
        };

        // ---- Listening, with the contacts' names as the words to expect -------------------------------
        await page.goto(APP);
        await page.evaluate(() => { localStorage.clear(); });
        await open();
        let start = await waitOp("start", 1);
        check(start.autoStop === true, "it listens at once, and stops when the speaker is done (autoStop)");
        check(/^Call .*\.$/.test(start.prompt) && ["Ada Palmer", "Lena Okafor", "Marcus Chen", "Marcus Reyes"].every((n) => start.prompt.includes(n)),
            "the contacts' names are the words to expect (the transcriber's prompt)");
        await say({ state: "listening" });
        await page.waitForSelector("[data-testid='mic'][data-state='listening']");
        check(/Say a name or number/.test(await page.textContent("[data-testid='status']")), "Say a name or number");
        await page.waitForTimeout(300);
        await shot("voicedial-listening");
        await say({ state: "transcribing" });
        await page.waitForSelector("[data-testid='mic'][data-state='transcribing']");
        check(true, "Recognizing while it transcribes");
        await shot("voicedial-recognizing");

        // ---- A name heard wrong ("Call either Palmer."), confirmed by saying Yes ---------------------------
        await say({ state: "done", text: "Call either Palmer." });
        await page.waitForSelector("[data-testid='confirm']");
        check((await page.textContent("[data-testid='status']")) === "Call Ada Palmer?", "\"Call either Palmer\" is Ada Palmer");
        check(/Mobile \(408\) 555-0142/.test(await page.textContent("[data-testid='target']")), "on her mobile");
        check((await page.textContent("[data-testid='heard']")).includes("Call either Palmer."), "what was heard is shown");
        const ask = await waitOp("start", 2);
        check(ask.prompt === "Yes. No." && ask.autoStop, "the confirmation listens for Yes or No");
        await say({ state: "listening" });
        await page.waitForTimeout(300);
        await shot("voicedial-confirm");
        await say({ state: "done", text: "Yes." });
        await page.waitForFunction(() => document.querySelector("[data-testid='voicedial']")?.getAttribute("data-stage") === "calling");
        await page.waitForTimeout(200);
        const toPhone = host.find((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.phone");
        check(!!toPhone && toPhone.payload.params.number === "(408) 555-0142" && toPhone.payload.params.dial === true,
            "\"Yes\": Phone is asked to call her ({number, dial: true})");
        await shot("voicedial-calling");
        // Phone, launched so, places the call and shows it.
        const phone = await context.newPage();
        phone.on("pageerror", (e) => errors.push("phone: " + e.message));
        await phone.goto(PHONE + "?launchParams=" + encodeURIComponent(JSON.stringify(toPhone.payload.params)));
        await phone.waitForSelector("[data-testid='incall'][data-state='active']", { timeout: 6000 });
        const calls = (await luna("luna://com.palm.telephony/callStatusQuery", {})).calls || [];
        check(calls.length === 1 && /408\) 555-0142|4085550142/.test(calls[0].number) && calls[0].direction === "outgoing",
            "and Phone calls (com.palm.telephony/dial): " + calls.map((c) => c.number + " " + c.state).join(", "));
        await phone.screenshot({ path: path.join(outDir, "voicedial-phone-call.png") });
        await luna("luna://com.palm.telephony/hangup", { id: calls[0].id });
        await phone.close();

        // ---- A number; "No" listens again ---------------------------------------------------------------------
        await open();
        await waitOp("start", 1);
        await hear("Dial 2-1-2-5-5-5-0-1-6-4");
        await page.waitForSelector("[data-testid='confirm']");
        check((await page.textContent("[data-testid='status']")) === "Call Lena Okafor?", "a number is matched to its contact");
        await waitOp("start", 2);
        await say({ state: "done", text: "No." });
        start = await waitOp("start", 3);
        check(start.prompt.includes("Ada Palmer") && (await stage()) === "listening", "\"No\" listens for a name again");
        // whisper.cpp on "Dial 4 0 8, 5 5 5, 0 1 4 2": the verb misheard, "for" for 4.
        await hear("Nile for 0-8, 5-5-5, 0-1-4-2");
        await page.waitForSelector("[data-testid='confirm']");
        check((await page.textContent("[data-testid='status']")) === "Call Ada Palmer?", "\"Nile for 0-8, 5-5-5, 0-1-4-2\" is (408) 555-0142");
        // Not answered: the buttons stay.
        await waitOp("start", 4);
        await say({ state: "error", errorText: "Nothing was heard." });
        await page.waitForFunction(() => !/Say/.test(document.querySelector("[data-testid='say-yes']")?.textContent || ""));
        check((await stage()) === "confirm", "no answer: it waits for a tap");
        await page.click("[data-testid='cancel']");
        await waitOp("start", 5);
        check((await stage()) === "listening", "No (the button) listens again");

        // ---- Two about as likely: a choice ------------------------------------------------------------------
        // Two Marcuses; "at work" picks their work numbers.
        await hear("Call Marcus at work.");
        await page.waitForSelector("[data-testid='choice']");
        const marcuses = await page.locator("[data-testid='choice']").allTextContents();
        check(marcuses.length === 2 && marcuses.some((t) => /Marcus Reyes.*Work \(650\) 555-0110/.test(t)) && marcuses.some((t) => /Marcus Chen/.test(t)),
            "\"Call Marcus at work\": Marcus Chen or Marcus Reyes, at work");
        await shot("voicedial-choose-marcus");
        await page.click("[data-testid='again']");
        await waitOp("start", 6);
        await hear("Call Lena Palmer.");
        await page.waitForSelector("[data-testid='choice']");
        const choices = await page.locator("[data-testid='choice'] .pui-row-title").allTextContents();
        check(choices.includes("Ada Palmer") && choices.includes("Lena Okafor"), "\"Lena Palmer\": Ada Palmer or Lena Okafor? (" + choices.join(", ") + ")");
        await shot("voicedial-choose");
        await page.click("[data-testid='choice'] >> text=Lena Okafor");
        await page.waitForSelector("[data-testid='call']");
        await page.click("[data-testid='call']");
        await page.waitForFunction(() => document.querySelector("[data-testid='voicedial']")?.getAttribute("data-stage") === "calling");
        check(true, "a choice, then Call (the button)");
        await page.waitForTimeout(200);
        check(host.some((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.phone" && m.payload.params.number === "(212) 555-0164"),
            "calls Lena");

        // ---- No one by that name; nothing heard; the microphone button --------------------------------------------
        await open();
        await waitOp("start", 1);
        await hear("Call Zebulon Quartermaine.");
        await page.waitForSelector("[data-testid='again']");
        check((await stage()) === "nomatch" && /No contact matches/.test(await page.textContent("[data-testid='status']")), "no one by that name");
        await shot("voicedial-nomatch");
        await page.click("[data-testid='again']");
        await waitOp("start", 2);
        await say({ state: "listening" });
        await page.click("[data-testid='mic']");
        await waitOp("stop", 1);
        check(true, "tapping the microphone while listening: done speaking (stop)");
        await say({ state: "error", errorText: "Nothing was heard." });
        await page.waitForSelector("[data-testid='error']");
        check(/Nothing was heard/.test(await page.textContent("[data-testid='error']")), "nothing heard: said so, with Try Again");
        await page.click("[data-testid='mic']");
        await waitOp("start", 3);
        check((await stage()) === "listening", "and the microphone listens again");

        // ---- Without a shell's microphone ----------------------------------------------------------------------
        shellHasMic = false;
        await open();
        await page.waitForSelector("[data-testid='error']");
        check(/microphone/.test(await page.textContent("[data-testid='error']")) && !dictationOps().some((p) => p.op === "start"),
            "in a browser without the shell: \"" + (await page.textContent("[data-testid='error']")) + "\"");
        await shot("voicedial-unavailable");
        shellHasMic = true;

        // ---- The original ids ------------------------------------------------------------------------------------
        host.length = 0;
        await luna("palm://com.palm.pmvoicecommand/startVoiceCommand", { source: "appicon" });
        await luna("palm://com.palm.applicationManager/launch", { id: "com.palm.sysapp.voicedial" });
        const launches = host.filter((m) => m.type === "launch").map((m) => m.payload.id);
        check(launches.length === 2 && launches.every((id) => id === "org.webosphoenix.voicedial"),
            "com.palm.pmvoicecommand/startVoiceCommand and com.palm.sysapp.voicedial open Voice Dial");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
