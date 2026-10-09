#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's follow-up questions (docs/AI-AND-MCP.md) in headless
// Chromium, against the simulated org.webosphoenix.assistant (the device's
// service code, run in the page by runtime/phoenix-runtime.js):
//
//   - in the Assistant app, an event made: the question after it, worded as
//     conversation, its answers as quick replies under it, the bird asking
//     (as the avatar and in the header); a tap changes the event in db8,
//     says so, and asks the next;
//   - another made and left: the clock moved on (the runtime's
//     fastForward), the question goes out as a notification with its
//     answers as buttons (the "notification" host message with {actions})
//     and arrives in its conversation, counted unread in Conversations;
//   - the app opened from the notification ({followUp}) is on that
//     conversation; an answer typed there applies, and nothing is unread.
//
//   node tools/test-assistant-followups.cjs [--tablet] [--night] [--out DIR]
//
// The page's clock is set to a time zone where it is 12:00-ish (--night:
// 23:00-ish, the tablet's default), so what the quiet hours (22:00-08:00)
// do to the questions is the same whenever the test runs: by day they go
// one at a time, by night together at 08:00.
//
// Build the app first (cd apps && npm run build -w assistant).

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "assistant-followups-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const night = args.includes("--night") || (tablet && !args.includes("--day"));
// Etc/GMT-N is UTC+N: the zone whose hour now is the one wanted.
function zoneAt(hour) {
    let off = hour - new Date().getUTCHours();
    if (off > 14) off -= 24;
    if (off < -12) off += 24;
    return off === 0 ? "Etc/GMT" : "Etc/GMT" + (off > 0 ? "-" : "+") + Math.abs(off);
}
const timezoneId = zoneAt(night ? 23 : 12);
const port = 8790 + Math.floor(Math.random() * 80);
const appUrl = `http://127.0.0.1:${port}/usr/palm/applications/org.webosphoenix.assistant/index.html`;
const A = "luna://org.webosphoenix.assistant/";

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
    if (!fs.existsSync(path.join(REPO, "apps/assistant/dist/index.html"))) {
        console.error("apps/assistant/dist is missing: run `npm run build -w assistant` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport, timezoneId });
        console.log(`clock: ${night ? "night" : "day"} (${timezoneId})`);
        const errors = [], notes = [];
        const app = await context.newPage();
        app.on("pageerror", (e) => errors.push(e.message));
        app.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) {
                const msg = JSON.parse(t.slice(11));
                if (msg.type === "notification") notes.push(msg.payload);
            } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                errors.push(t);
            }
        });
        const shot = (name) => app.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true });
        const svc = (uri, params) => app.evaluate(([u, p]) => new Promise((resolve) => {
            __phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);
        const lastIn = async () => (await app.locator(".as-row.in .as-bubble").last().textContent()).trim();
        const send = async (words) => {
            const before = await app.locator(".as-row").count();
            await app.fill("[data-testid='as-input']", words);
            await app.click("[data-testid='as-send']");
            await app.waitForFunction((n) => document.querySelectorAll(".as-row").length >= n + 2 && !document.querySelector("[data-testid='as-thinking']"), before, { timeout: 15000 });
        };

        await app.goto(appUrl);
        await app.evaluate(() => localStorage.clear());
        await app.goto(appUrl);
        await app.waitForSelector("[data-testid='as-empty']");

        // ---- In the conversation --------------------------------------------------------------
        await send("Schedule lunch with Sam on the 20th at noon");
        await app.waitForSelector("[data-testid^='as-replies-']");
        const q = await lastIn();
        check(/^(Hey, where's|Quick one: where is) .*lunch with Sam.*\?$/.test(q), "a question after the event, as conversation: " + q);
        const chips = await app.locator("[data-testid^='as-replies-'] .as-reply").allTextContents();
        check(chips.includes("Video call") && chips[chips.length - 1] === "Skip", "its answers are quick replies: " + chips.join(" · "));
        await app.waitForSelector("[data-testid='as-header-bird'][data-pose='asking']", { timeout: 8000 });
        check(await app.locator("[data-testid='as-avatar-live'][data-pose='asking']").count() === 1, "the bird asks, beside the question and in the header");
        check((await app.getAttribute("[data-testid='as-input']", "placeholder")) === "Reply", "the field says Reply");
        await shot("question");
        await app.click("[data-testid='as-choice-fu:0']");
        const said = (re) => app.waitForFunction((src) => [...document.querySelectorAll(".as-row.in .as-bubble")].some((b) => new RegExp(src).test(b.textContent)),
                                                 re.source, { timeout: 8000 });
        await said(/^Got it, I've put /);
        const events = (await svc("luna://com.palm.db/find", { query: { from: "com.palm.calendarevent:1" } })).results;
        const lunch = events.find((e) => e.subject === "Lunch with Sam");
        check(!!lunch && lunch.location === chips[0], "the answer is the event's place in db8: " + (lunch && lunch.location));
        await app.waitForFunction(() => document.querySelectorAll("[data-testid^='as-replies-']").length === 1 && /\?$/.test([...document.querySelectorAll(".as-row.in .as-bubble")].pop().textContent));
        check(true, "and the next question comes: " + await lastIn());
        await shot("answered");

        // ---- Left for later ---------------------------------------------------------------------
        await send("Schedule dinner on the 21st at 7pm");
        await app.waitForSelector("[data-testid^='as-replies-']");
        const threadId = (await svc(A + "threads", {})).current;
        check((await svc(A + "followUpLeave", {})).queued >= 1, "closed unanswered, the questions wait for later");
        // (Out of the conversation: one in sight reads what arrives at once.
        // A phone shows the list instead; a tablet, beside it, another one.)
        await app.click(tablet ? "[data-testid='as-new']" : "[data-testid='as-conversations']");
        const ff = await app.evaluate(() => __phoenixRuntime.assistant.fastForward({ all: true }));
        // The lunch's second question (left as the dinner was asked) and the
        // dinner's: due a moment apart by day, both at 08:00 by night.
        check(ff.delivered === 2 && (night ? ff.postponed >= 1 : ff.postponed === 0), "moved on to when they are due, they are sent: " + JSON.stringify(ff));
        const n = notes.find((x) => /dinner/.test(x.title || ""));
        check(!!n && n.appId === "org.webosphoenix.assistant" && /\?$/.test(n.title) && n.actions && n.actions.uri === A + "answerFollowUp"
              && n.actions.items.some((i) => i.id === "fu:skip") && n.params && n.params.followUp,
              "as a notification with its answers as buttons: " + (n && n.title));
        await app.waitForSelector(`[data-testid='as-thread-${threadId}'] [data-testid='as-unread']`);
        check((await app.textContent(`[data-testid='as-thread-${threadId}'] [data-testid='as-unread']`)).trim() === "2", "its conversation shows them unread");
        await shot("unread");

        // ---- The notification tapped ----------------------------------------------------------------
        await app.goto(appUrl + "?launchParams=" + encodeURIComponent(JSON.stringify({ followUp: n.params.followUp })));
        await app.waitForSelector("[data-testid^='as-replies-']");
        check((await lastIn()) === n.title, "the app opens on its conversation, the question waiting last: " + await lastIn());
        let unread = 1;
        for (let i = 0; i < 50 && unread; ++i) {
            unread = ((await svc(A + "threads", {})).threads.find((t) => t.id === threadId) || {}).unread || 0;
            if (unread) await app.waitForTimeout(100);
        }
        check(unread === 0, "opened, nothing is unread");
        await shot("from-notification");
        check(/where/i.test(n.title), "it asks where dinner is");
        await send("Video call");
        await said(/^Got it, I've put Video call as the place\.$/);
        const dinner = (await svc("luna://com.palm.db/find", { query: { from: "com.palm.calendarevent:1" } })).results.find((e) => e.subject === "Dinner");
        check(!!dinner && dinner.location === "Video call", "an answer typed there applies: " + (dinner && dinner.location));
        await shot("typed-answer");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
