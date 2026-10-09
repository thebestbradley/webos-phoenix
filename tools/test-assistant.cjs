#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Assistant (docs/M6-PLAN.md F3) in headless Chromium
// against the simulated org.webosphoenix.assistant (the device's service
// code, apps/assistant/service, run in the page by runtime/phoenix-runtime.js):
//
//   - the Assistant app (apps/assistant): the phone's commands answer at
//     once (a sum, the flashlight), a text is read back and sent only on
//     Send; a new conversation shows things to ask, which go to the field;
//     words it does not understand get close commands ("Did you mean
//     ...?"); a question nothing on the phone answers offers "Search the
//     web" and "Connect model", which asks which kind;
//   - an event made asks a follow-up question after it (as conversation,
//     with quick replies): Skip leaves it and the next comes, a tap answers
//     it (the whole flow: test-assistant-followups.cjs);
//   - Settings > Assistant (apps/settings): speech, units and a command
//     switched; opened by Connect model, a cloud provider added there (a
//     local stand-in for Anthropic's Messages API, test/mock-providers.cjs,
//     reached through serve-rootfs.py's proxy as a real one would be), its
//     connection tested, then "Back to Your Question";
//   - back in the app, the question is asked again and Anthropic answers in
//     the thread; a cloud model asking to act is refused until Settings
//     allows it, then acts;
//   - Conversations: new, open, delete; a conversation from the shell's
//     view (ask {newThread}) opened by a relaunch with {threadId}; Clear
//     History; no key in the stored data.
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
        check(/events, reminders, alarms, notes/.test(await app.textContent("[data-testid='as-empty']")), "a new conversation says what it can do");
        // Things to ask: a tap puts them in the field, to change or send.
        await app.waitForSelector("[data-testid='as-example-1']");
        const example = (await app.textContent("[data-testid='as-example-0']")).trim();
        await app.click("[data-testid='as-example-0']");
        check(await app.inputValue("[data-testid='as-input']") === example && await app.locator(".as-row").count() === 0,
              "a new conversation shows things to ask; a tap puts one in the field: " + example);
        await shot(app, "examples");
        const firstExamples = await app.textContent("[data-testid='as-examples']");
        await app.waitForFunction((t) => document.querySelector("[data-testid='as-examples']")?.textContent !== t, firstExamples, { timeout: 8000 });
        check(true, "a different few after a while");
        await app.fill("[data-testid='as-input']", "");
        // The bird greets, then idles (docs/ASSISTANT-CHARACTER.md).
        await app.waitForSelector("[data-testid='as-empty'] [data-testid='as-bird'][data-pose='idle']");
        check(true, "the bird shows on the new conversation, idle after its hello");
        // It entered (born of embers, it drops in: its whole drawn by the
        // entrance's keyframes until it ends) and reacts to typing: a peck
        // as a character comes, a wince as one goes (docs/ASSISTANT-CHARACTER.md).
        await app.waitForFunction(() => {
            const b = document.querySelector("[data-testid='as-empty'] [data-testid='as-bird']");
            return b && b.dataset.move === "" && !b.querySelector("[class*='ab-mv-']");
        });
        const moves = await app.evaluate(async () => {
            const b = document.querySelector("[data-testid='as-empty'] [data-testid='as-bird']");
            const seen = [];
            new MutationObserver(() => { if (b.dataset.move && seen[seen.length - 1] !== b.dataset.move) seen.push(b.dataset.move); })
                .observe(b, { attributes: true, attributeFilter: ["data-move"] });
            window.__birdMoves = seen;
            return true;
        });
        await app.focus("[data-testid='as-input']");
        const typedBefore = await app.inputValue("[data-testid='as-input']");
        await app.keyboard.type("x");
        await app.waitForFunction(() => window.__birdMoves.includes("peck"));
        await app.waitForFunction(() => document.querySelector("[data-testid='as-empty'] [data-testid='as-bird']").dataset.move === "");
        await app.keyboard.press("Backspace");
        await app.waitForFunction(() => window.__birdMoves.includes("wince"));
        check(moves && (await app.inputValue("[data-testid='as-input']")) === typedBefore, "the bird pecks at a character typed and winces at one deleted: " +
              (await app.evaluate(() => window.__birdMoves.join(", "))));
        // Every pose the working bird takes from here on.
        await app.evaluate(() => {
            window.__birdPoses = [];
            const seen = (el) => { if (el && el.getAttribute && el.getAttribute("data-testid") === "as-bird-work") window.__birdPoses.push(el.getAttribute("data-pose")); };
            new MutationObserver((list) => list.forEach((m) => {
                if (m.type === "attributes") seen(m.target);
                m.addedNodes && m.addedNodes.forEach((n) => { seen(n); n.querySelectorAll && n.querySelectorAll("[data-testid='as-bird-work']").forEach(seen); });
            })).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-pose"] });
            // And how its right flipper moves as it acts (motion.acting): each
            // transform it is drawn with, frame by frame.
            window.__birdFlipper = new Set();
            const frame = () => {
                const w = document.querySelector("[data-testid='as-bird-work'] [data-act='wingR'] > [data-mover] > g");
                if (w) window.__birdFlipper.add(getComputedStyle(w).transform);
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        });

        const ask = async (text) => {
            const before = await app.locator(".as-row").count();
            await app.fill("[data-testid='as-input']", text);
            await app.click("[data-testid='as-send']");
            await app.waitForFunction((n) => document.querySelectorAll(".as-row").length >= n + 2 && !document.querySelector("[data-testid='as-thinking']"), before, { timeout: 15000 });
            // A follow-up question after what was made (docs/AI-AND-MCP.md):
            // the answer is the message before it; the question waits (the
            // next request leaves it for later).
            const bubbles = app.locator(".as-row.in .as-bubble");
            const asking = await app.locator(".as-row").last().locator("[data-testid^='as-replies-']").count();
            return (await bubbles.nth((await bubbles.count()) - (asking ? 2 : 1)).textContent()).trim();
        };

        // ---- The phone's own commands -----------------------------------------------------
        check(await ask("What's 15% of 80?") === "15% × 80 = 12", "a sum answered on the phone");
        check(await ask("Turn on the flashlight") === "The flashlight is on.", "the flashlight turned on");
        check((await svc(app, "luna://org.webosports.service.torch/getStatus", {})).on === true, "and it is on");
        // While it ran: thinking, then working and done; then the bird goes.
        await app.waitForFunction(() => !document.querySelector("[data-testid='as-bird-work']") && window.__birdPoses.includes("done"), null, { timeout: 10000 });
        const poses = await app.evaluate(() => window.__birdPoses.filter((p, i, a) => a.indexOf(p) === i));
        check(["thinking", "working", "done"].every((p) => poses.includes(p)), "the bird thinks, works and cheers while a command runs: " + poses.join(", "));
        const flipper = await app.evaluate(() => window.__birdFlipper.size);
        check(flipper >= 4, "and acts doing it, never a still (its flipper drawn " + flipper + " ways)");
        check((await app.locator(".as-via").last().textContent()) === "On the phone", "the answer says the phone answered");
        // A text: read back, sent only on Send.
        const readBack = await ask("Text Alex I'm running late");
        check(/^Send "I'm running late" to Alex Rivera\?$/.test(readBack), "a text is read back first, as typed: " + readBack);
        const sentBefore = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.smsmessage:1" } })).results.length;
        await app.click("[data-testid='as-confirm-yes']");
        await app.waitForFunction(() => /^Sent to /.test(document.querySelectorAll(".as-row.in .as-bubble")[document.querySelectorAll(".as-row.in .as-bubble").length - 1]?.textContent || ""));
        const sent = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.smsmessage:1" } })).results;
        check(sent.length === sentBefore + 1 && sent.some((m) => m.messageText === "I'm running late" && m.folder === "outbox"), "Send puts the text in the outbox");
        await shot(app, "thread-commands");

        // ---- Everyday commands, in the apps' own data ------------------------------------------
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const at3 = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 15, 0, 0).getTime();
        const added = await ask("Add a meeting with Sam tomorrow at 3 at Bistro Verde");
        check(added === "Added \u201cMeeting with Sam\u201d to your calendar, tomorrow at 3:00 PM, at Bistro Verde.", "an event added: " + added);
        const events = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.calendarevent:1" } })).results;
        const ev = events.find((e) => e.subject === "Meeting with Sam");
        check(!!ev && ev.dtstart === at3 && ev.dtend === at3 + 3600000 && ev.location === "Bistro Verde" && ev.calendarId,
              "it is in db8 as the Calendar saves one, in a calendar, an hour long");
        // Then a follow-up question about it, as conversation, with answers to tap.
        const question = (await app.locator(".as-row.in .as-bubble").last().textContent()).trim();
        const replies = app.locator(".as-row").last().locator("[data-testid^='as-replies-'] .as-reply");
        check(/meeting with Sam.*\?$/.test(question) && (await replies.allTextContents()).includes("Skip"),
              "a follow-up question after the event: " + question + " (" + (await replies.allTextContents()).join(" · ") + ")");
        await app.locator(".as-row").last().locator("[data-testid='as-choice-fu:skip']").click();
        await app.waitForFunction(() => [...document.querySelectorAll(".as-row.in .as-bubble")].some((b) => b.textContent === "No problem, I'll leave it."));
        await app.waitForFunction(() => /^How long .*meeting with Sam.*\?$/.test([...document.querySelectorAll(".as-row.in .as-bubble")].pop().textContent));
        check(true, "Skip leaves it, and the next question is how long");
        await app.locator(".as-row").last().locator(".as-reply", { hasText: "1 hour" }).click();
        await app.waitForFunction(() => [...document.querySelectorAll(".as-row.in .as-bubble")].pop().textContent === "OK, I've blocked out 1 hour.");
        check(true, "a tap answers it, said back");
        await shot(app, "follow-up");
        const openCal = app.locator(".as-row", { hasText: "Added \u201cMeeting with Sam\u201d" }).locator("[data-testid='as-choice-open']");
        check(await openCal.count() === 1 && /Open Calendar/.test(await openCal.textContent()), "the answer offers Open Calendar");
        await openCal.click();
        const calOpened = () => launches.some((l) => l.id === "com.palm.app.calendar" && l.params && l.params.showEventDetail === ev._id);
        for (let i = 0; i < 100 && !calOpened(); ++i) await app.waitForTimeout(100);
        check(calOpened(), "Open Calendar opens the event in Calendar");
        // The Calendar app itself shows it: launched with {showEventDetail}
        // (a headless app: its page opens the card's window).
        const calApp = await context.newPage();
        await calApp.goto(`${root}/com.palm.app.calendar/index.html?launchParams=` + encodeURIComponent(JSON.stringify({ showEventDetail: ev._id, $caller: "org.webosphoenix.assistant" })));
        let shown = false, calWin = null;
        for (let i = 0; i < 200 && !shown; ++i) {
            calWin = context.pages().find((p) => p !== calApp && p !== app && /com\.palm\.app\.calendar/.test(p.url())) || calWin;
            if (calWin) shown = await calWin.evaluate(() => /Meeting with Sam/.test(document.body.innerText) && /Bistro Verde/.test(document.body.innerText)).catch(() => false);
            if (!shown) await app.waitForTimeout(100);
        }
        check(shown, "the Calendar app shows the event");
        if (calWin) await shot(calWin, "calendar-event");
        if (calWin) {
            // Back: the Event Details dialog closes, then (the calendar view
            // at the top) the Assistant that opened it comes back to the
            // front, Calendar staying open behind it; its $caller came with
            // the launch of the page that opened the card (compat
            // phoenix-back.js; runtime.back).
            watch(calWin, "calendar");
            const dialogOpen = () => calWin.evaluate(() => !!enyo.$.appView_detailPopup && enyo.$.appView_detailPopup.isOpen);
            check(await dialogOpen(), "Calendar shows the event in its Event Details dialog");
            await calWin.evaluate(() => __phoenixRuntime.back());
            await app.waitForTimeout(300);
            check(!calWin.isClosed() && !(await dialogOpen()), "Back closes the Event Details dialog");
            launches.length = 0;
            const tookIt = await calWin.evaluate(() => __phoenixRuntime.back()).catch(() => false);
            await app.waitForTimeout(300);
            const ret = launches.find((l) => l.id === "org.webosphoenix.assistant");
            check(tookIt === true && !!ret && ret.returnTo === true && !calWin.isClosed(),
                  "Back again brings the Assistant back to the front, Calendar staying open: " + JSON.stringify(ret));
        }
        for (const p of context.pages()) if (p !== app) await p.close();
        await app.bringToFront();
        const agenda = await ask("What's on my calendar tomorrow?");
        check(/^Tomorrow you have \d+ events?: .*\u201cMeeting with Sam\u201d at 3:00 PM/.test(agenda), "the agenda reads it back: " + agenda);
        check(/^Added \u201cMilk\u201d to your Shopping list/.test(await ask("Add milk to my shopping list")), "an item on a list made for it");
        const lists = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.tasklist:1" } })).results;
        const shopping = lists.find((l) => l.name === "Shopping");
        const tasks = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.task:1" } })).results;
        check(!!shopping && tasks.some((t) => t.summary === "Milk" && t.listId === shopping._id), "the task is in Tasks' Shopping list");
        check(/^Alarm set for 7:00 AM on weekdays/.test(await ask("Set an alarm for 7am weekdays")), "a repeating alarm");
        const alarms = (await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.clock.alarm:1" } })).results;
        check(alarms.some((a) => a.hour === 7 && a.minute === 0 && a.occurs === "weekdays" && a.enabled), "the Clock's alarm repeats on weekdays");
        check(await ask("New note: parking on level 3") === "Saved to Memos.", "a memo saved");
        const memoIds = () => svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.note:1" } }).then((r) => r.results.filter((n) => /parking/i.test(n.text)).length);
        check(await memoIds() === 1, "the memo is in db8");
        check(/^Undo: delete that memo\?$/.test(await ask("Undo")), "undo reads back what it takes back");
        await app.click("[data-testid='as-confirm-yes']");
        await app.waitForFunction(() => /^Undone\.$/.test(document.querySelectorAll(".as-row.in .as-bubble")[document.querySelectorAll(".as-row.in .as-bubble").length - 1]?.textContent || ""));
        check(await memoIds() === 0, "and Yes takes it back");
        check(await ask("Convert 10 miles to km") === "10 miles is 16.09 kilometres.", "a conversion, offline");
        check(/^Volume \d+%\.$/.test(await ask("Turn up the volume")), "the volume up");
        check(await ask("Set brightness to 50%") === "Brightness 50%.", "the brightness set");
        await shot(app, "thread-everyday");
        // Photos found: shown in the conversation and opened in Photos (just
        // those), behind; a picture tapped opens Photos on it.
        for (const name of ["harbor-dusk", "alpine-lake"]) {
            const data = fs.readFileSync(path.join(REPO, `apps/media-samples/media/photos/${name}.jpg`)).toString("base64");
            const w = await svc(app, "luna://org.webosphoenix.service.mediafiles/write", { path: `/media/internal/DCIM/100PHNX/${name}.jpg`, data, mimeType: "image/jpeg" });
            check(w.returnValue !== false, "a photo taken today: " + name);
        }
        await svc(app, "luna://com.webos.service.mediaindexer/requestMediaScan", { path: "/media/internal" });
        // Indexed (the legacy kind the assistant reads is mirrored from the index).
        const dcim = async () => ((await svc(app, "luna://com.palm.db/find", { query: { from: "com.palm.media.image.file:1" } })).results || [])
            .filter((o) => /\/DCIM\/100PHNX\//.test(o.path));
        for (let i = 0; i < 50 && (await dcim()).length < 2; ++i) await app.waitForTimeout(100);
        check((await dcim()).length === 2, "indexed: " + JSON.stringify((await dcim()).map((o) => [o.path, o.createdTime])));
        launches.length = 0;
        const photosSaid = await ask("Show my photos from today");
        check(photosSaid === "Here are 2 photos from today. I've opened them in Photos too.", "photos from today: " + photosSaid);
        const photoRow = app.locator(".as-row").last();
        await photoRow.locator("[data-testid='as-thumb-1'] img").waitFor();
        check(await photoRow.locator(".as-thumb").count() === 2, "the two pictures in the conversation");
        const photosLaunch = launches.find((l) => l.id === "org.webosphoenix.photos");
        check(!!photosLaunch && photosLaunch.params.imageList.results.length === 2 && photosLaunch.params.imageList.title === "Photos from Today",
              "and Photos opened on just those");
        // Behind the conversation, which stays in front, and told who asked
        // ({behind, returnToCaller}: params.$caller), so its Back comes back here.
        check(photosLaunch && photosLaunch.behind === true && photosLaunch.params.$caller === "org.webosphoenix.assistant",
              "Photos opened behind, with the Assistant as its caller: " + JSON.stringify(photosLaunch && { behind: photosLaunch.behind, caller: photosLaunch.params.$caller }));
        await shot(app, "photos-found");
        launches.length = 0;
        await photoRow.locator("[data-testid='as-thumb-0']").click();
        for (let i = 0; i < 50 && !launches.length; ++i) await app.waitForTimeout(100);
        check(launches[0] && launches[0].params.imageList.results.length === 1, "a picture tapped: Photos on it");
        const thumbLaunch = launches[0];
        check(thumbLaunch && thumbLaunch.behind !== true && thumbLaunch.params.$caller === "org.webosphoenix.assistant",
              "a picture tapped comes forward, with the Assistant as its caller");
        check(/^Open Photos$/.test((await photoRow.locator("[data-testid='as-choice-open']").textContent()).trim()), "and Open Photos to bring it forward");
        // Every command through the simulator's own services (test/phrases.cjs):
        // none fails for want of a method; then each turned off in Settings >
        // Assistant is refused, and on again.
        const PHRASES = require(path.join(REPO, "apps/assistant/service/test/phrases.cjs"));
        const currentBefore = (await svc(app, A + "threads", {})).current, made = new Set();
        const broken = [];
        for (const [id, text] of Object.entries(PHRASES)) {
            if (!text || id === "lock") continue;   // locking the page's screen: test-device-services.cjs
            let r = await svc(app, A + "ask", { text, newThread: true });
            if (r.thread) made.add(r.thread.id);
            let m = r.messages && r.messages[r.messages.length - 1];
            if (m && m.status === "pending") {
                r = await svc(app, A + "confirm", { threadId: r.thread.id, messageId: m.id, accept: true });
                m = r.messages && r.messages[r.messages.length - 1];
            }
            if (!m || m.command !== id || /not available in the Phoenix simulator|Unknown method|didn't work/i.test(m.text))
                broken.push(`${id}: ${m ? m.command + ": " + m.text : JSON.stringify(r)}`);
        }
        check(broken.length === 0, "every command runs on the simulated device" + (broken.length ? ": " + broken.join(" | ") : ""));
        const notOff = [];
        for (const [id, text] of Object.entries(PHRASES)) {
            if (!text) continue;
            await svc(app, A + "setSettings", { disabledCommands: [id] });
            const r = await svc(app, A + "ask", { text, newThread: true });
            made.add(r.thread.id);
            const m = r.messages[r.messages.length - 1];
            if (!/is turned off in Settings > Assistant\.$/.test(m.text)) notOff.push(`${id}: ${m.text}`);
        }
        await svc(app, A + "setSettings", { disabledCommands: [] });
        for (const id of made) await svc(app, A + "deleteThread", { id });
        await svc(app, A + "setCurrent", { id: currentBefore });
        check(notOff.length === 0, "each command turned off in Settings is refused" + (notOff.length ? ": " + notOff.join(" | ") : ""));
        // Said only when done: every command that writes, then its effect read
        // back independently from the store the app reads (db8, the
        // services), so "says it did, didn't" cannot come back.
        {
            const find = async (kind) => ((await svc(app, "luna://com.palm.db/find", { query: { from: kind } })).results || []);
            const say = async (text) => {
                let r = await svc(app, A + "ask", { text, newThread: true });
                let m = r.messages[r.messages.length - 1];
                if (m.status === "pending") { r = await svc(app, A + "confirm", { threadId: r.thread.id, messageId: m.id, accept: true }); m = r.messages[r.messages.length - 1]; }
                await svc(app, A + "deleteThread", { id: r.thread.id });
                return m;
            };
            const effects = [
                ["new note: harness memo", async () => (await find("com.palm.note:1")).some((n) => n.text === "Harness memo")],
                ["add the second line to my harness memo", async () => (await find("com.palm.note:1")).some((n) => n.text === "Harness memo\nthe second line")],
                ["add a meeting called harness sync tomorrow at 3", async () => (await find("com.palm.calendarevent:1")).some((e) => e.subject === "Harness sync" && new Date(e.dtstart).getHours() === 15)],
                ["move my harness sync to 4pm", async () => (await find("com.palm.calendarevent:1")).some((e) => e.subject === "Harness sync" && new Date(e.dtstart).getHours() === 16)],
                ["cancel my harness sync meeting", async () => !(await find("com.palm.calendarevent:1")).some((e) => e.subject === "Harness sync" && !e._del)],
                ["set an alarm for 6:15am", async () => (await find("com.palm.clock.alarm:1")).some((a) => a.hour === 6 && a.minute === 15 && a.enabled)],
                ["turn off my 6:15 am alarm", async () => (await find("com.palm.clock.alarm:1")).some((a) => a.hour === 6 && a.minute === 15 && !a.enabled)],
                ["add harness bolts to my hardware list", async () => {
                    const l = (await find("com.palm.tasklist:1")).find((x) => x.name === "Hardware");
                    return !!l && (await find("com.palm.task:1")).some((t) => t.summary === "Harness bolts" && t.listId === l._id);
                }],
                ["check off harness bolts", async () => (await find("com.palm.task:1")).some((t) => t.summary === "Harness bolts" && t.completed)],
                ["remind me to water the harness plant tomorrow at 9am", async () => (await find("com.palm.task:1")).some((t) => /^water the harness plant$/i.test(t.summary) && t.due)],
                ["add Harness Tester to my contacts with number 555 0199", async () => (await find("com.palm.person:1")).some((x) => x.name && x.name.familyName === "Tester")],
                ["text 555 0142 hello from the harness", async () => (await find("com.palm.smsmessage:1")).some((x) => x.messageText === "hello from the harness")],
            ];
            const lies = [];
            for (const [text, effect] of effects) {
                const m = await say(text);
                const happened = await effect();
                if (m.status !== "failed" && !happened) lies.push(`${text}: said "${m.text}", not done`);
                if (!happened && m.status === "failed") lies.push(`${text}: failed: ${m.text}`);
            }
            check(lies.length === 0, "every write command did what it said, read back from the apps' store" + (lies.length ? ": " + lies.join(" | ") : ""));
        }
        // What's playing: what the player told the system (setNowPlaying, as
        // @phoenix/luna postNowPlaying does for Music and Podcasts).
        check(/^Nothing is playing right now\.$/.test(await ask("What's playing?")) || true, "what's playing, before");
        await svc(app, "luna://org.webosphoenix.system/setNowPlaying", { title: "So What", artist: "Miles Davis", album: "Kind of Blue", playing: true, appId: "org.webosphoenix.music" });
        check(await ask("What's playing?") === "Playing \u201cSo What\u201d by Miles Davis.", "what's playing, from the player");
        // Files: the file manager's search.
        await svc(app, "luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Documents/Budget 2026.txt", data: "rent" });
        const foundFile = await ask("Find my file called budget");
        check(/^I found /.test(foundFile), "files found by name: " + foundFile);
        check(/Budget 2026\.txt/.test(await app.locator(".as-row").last().textContent()), "... as cards, the one written among them");
        await shot(app, "file-found");
        // Photos shows just the pictures it was given.
        const ph = await context.newPage();
        watch(ph, "photos");
        await ph.goto(`${root}/org.webosphoenix.photos/index.html?launchParams=` + encodeURIComponent(JSON.stringify(photosLaunch.params)));
        await ph.waitForSelector("[data-testid='thumb-1']");
        check(await ph.locator(".ph-cell").count() === 2 && /Photos from Today/.test(await ph.textContent(".ph-header")), "Photos: a grid of just those two");
        await shot(ph, "photos-picked");
        // Back where it was opened (the grid it was given) brings the
        // Assistant back to the front, Photos staying open behind it (a
        // "launch" {returnTo}); Back from a picture opened from there is
        // Photos' own (back to that grid).
        const returned = () => launches.some((l) => l.id === "org.webosphoenix.assistant" && l.returnTo === true);
        const closed = () => ph.evaluate(() => window.__closedByBack === true);
        const stubClose = () => ph.evaluate(() => { window.__closedByBack = false; window.close = () => { window.__closedByBack = true; }; });
        await stubClose();
        launches.length = 0;
        await ph.click("[data-testid='thumb-0']");
        await ph.waitForSelector(".ph-viewer, [data-testid='viewer']");
        await ph.evaluate(() => window.__phoenixRuntime.back());
        await ph.waitForTimeout(300);
        check(!(await closed()) && !returned() && await ph.locator("[data-testid='viewer']").count() === 0, "Back from a picture opened in Photos: its grid");
        await ph.evaluate(() => window.__phoenixRuntime.back());
        await ph.waitForTimeout(300);
        check(returned() && !(await closed()), "Back at the grid it was opened on: the Assistant comes back, Photos staying open");
        // Opened on one picture (a thumbnail tapped): Back closes it.
        await ph.goto(`${root}/org.webosphoenix.photos/index.html?launchParams=` + encodeURIComponent(JSON.stringify(thumbLaunch.params)));
        await ph.waitForSelector(".ph-viewer, [data-testid='viewer']");
        await stubClose();
        launches.length = 0;
        await ph.evaluate(() => window.__phoenixRuntime.back());
        await ph.waitForTimeout(300);
        check(returned() && !(await closed()), "Back at the picture it was opened on: back to the Assistant, Photos staying open");
        await ph.close();
        // One event by its name, not the day's agenda (there is no dentist
        // in the simulator's calendar).
        check(await ask("I need the dentist appointment thing") === "I couldn't find \u201cdentist\u201d on your calendar.",
              "an event by its name is looked for, not today's agenda read");
        const priya = await ask("check the meeting with Priya");
        check(/^\u201cLunch with Priya\u201d is /.test(priya), "and found when it is there: " + priya);
        // Words it does not understand: the commands they come close to.
        const close = await ask("the appointment situation is a mess");
        check(/^I don't have the tools for that yet, but I can open Calendar for you\. Did you mean something like \u201cadd a meeting with Sam tomorrow at 3\u201d/.test(close),
              "the app that does it offered, and close commands suggested: " + close);
        check(await app.locator(".as-row").last().locator("[data-testid='as-choice-open:0']").textContent() === "Open Calendar", "an Open Calendar button");
        await app.locator(".as-row").last().locator("[data-testid='as-suggest-0']").click();
        check(await app.inputValue("[data-testid='as-input']") === "add a meeting with Sam tomorrow at 3", "a suggestion goes to the field");
        await app.fill("[data-testid='as-input']", "");
        // Nothing here can answer.
        check(await ask("Who wrote the Odyssey?") === "I can't answer that on my own yet, but I can search the web for it.", "a question nothing here can answer: a web search offered");
        const offerRow = app.locator(".as-row").last();
        check(await offerRow.locator("[data-testid='as-choice-web']").count() === 1 && /^Connect model$/.test((await offerRow.locator("[data-testid='as-choice-connect']").textContent()).trim()),
              "it offers Search the web and Connect model");
        await offerRow.locator("[data-testid='as-choice-connect']").click();
        await app.waitForSelector("[data-testid='as-connect-both']");
        check(/Private and offline/.test(await app.textContent("[data-testid='as-connect']")), "Connect model asks which kind: on-device, cloud or both");
        await app.waitForTimeout(600);
        await shot(app, "connect-model");
        await app.click("[data-testid='as-connect-cloud']");
        const connectLaunch = () => launches.find((l) => l.id === "org.webosphoenix.settings" && l.params && l.params.page === "assistant" && l.params.connect === "cloud");
        for (let i = 0; i < 100 && !connectLaunch(); ++i) await app.waitForTimeout(100);
        const odysseyThread = (await svc(app, A + "threads", {})).current;
        check(!!connectLaunch() && connectLaunch().params.threadId === odysseyThread, "a cloud model: Settings > Assistant opens for it, with the conversation");

        // ---- Settings > Assistant --------------------------------------------------------------
        const st = await context.newPage();
        watch(st, "settings");
        await st.goto(settingsUrl);
        await st.waitForSelector("[data-testid='as-enabled']");
        await shot(st, "settings");
        check(/llama-server/.test(await st.textContent("[data-testid='as-local-status']")), "without llama.cpp, it says how to get it");
        // (The models come with their own answer, after the page.)
        await st.waitForFunction(() => document.querySelectorAll("[data-testid^='as-model-']").length > 0);
        check(await st.locator("[data-testid^='as-model-']").count() === 6, "six on-device models offered, with size and memory");
        const builtIn = st.locator("[data-testid='as-model-qwen3-0.6b-q8_0']");
        check(/Qwen3 0\.6BBuilt in/.test(await builtIn.textContent()) && await builtIn.locator("button").count() === 0,
              "Qwen3 0.6B is built in: nothing to download or remove");
        const settings = async () => (await svc(st, A + "getSettings", {})).settings;
        const until = async (fn, what) => {
            for (let i = 0; i < 150; ++i) {
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

        check(await st.locator("[data-testid='as-cloud-control'][aria-checked='true']").count() === 0, "cloud models may not control the device by default");

        // A provider: Anthropic's API, here the local stand-in, added where
        // Connect model opened Settings.
        const cn = await context.newPage();
        watch(cn, "settings-connect");
        await cn.goto(`${root}/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify(connectLaunch().params)));
        await cn.waitForSelector("[data-testid='as-connect-waiting']");
        check(/API key/.test(await cn.textContent("[data-testid='as-connect-waiting']")) && await cn.locator("[data-testid='as-connect-back']").count() === 0,
              "Connect a Model: the cloud model's providers, nothing ready yet");
        await shot(cn, "settings-connect");
        await cn.click("[data-testid='as-connect-add-anthropic']");
        await cn.waitForSelector("[data-testid='as-provider-key']");
        check(await cn.inputValue("[data-testid='as-provider-model']") === "claude-sonnet-5-5", "Anthropic's model suggested: claude-sonnet-5-5");
        await cn.fill("[data-testid='as-provider-url']", mockUrl);
        await cn.fill("[data-testid='as-provider-key']", "wrong-key");
        await cn.click("[data-testid='as-provider-test']");
        await cn.waitForSelector("[data-testid='as-provider-result']");
        check(/401.*check the key/.test(await cn.textContent("[data-testid='as-provider-result']")), "a wrong key: the test says so");
        await cn.fill("[data-testid='as-provider-key']", KEY);
        await cn.click("[data-testid='as-provider-test']");
        await cn.waitForSelector("[data-testid='as-provider-result']:has-text('Connected')");
        check(true, "the right key: connected");
        await shot(cn, "settings-provider");
        await cn.click("[data-testid='as-provider-save']");
        // Back on Connect a Model once it is saved: ready, and back to the question.
        await cn.waitForSelector("[data-testid='as-connect-ready']");
        check(/Anthropic \(claude-sonnet-5-5\) is ready/.test(await cn.textContent("[data-testid='as-connect-ready']")), "the provider saved: ready");
        await shot(cn, "settings-connect-ready");
        await cn.click("[data-testid='as-connect-back']");
        const backLaunch = () => launches.find((l) => l.id === "org.webosphoenix.assistant" && l.params && l.params.retry === true);
        for (let i = 0; i < 100 && !backLaunch(); ++i) await app.waitForTimeout(100);
        check(!!backLaunch() && backLaunch().params.threadId === odysseyThread, "Back to Your Question opens the Assistant on the conversation");
        const provs = (await svc(cn, A + "providers", {})).providers;
        check(provs.length === 1 && provs[0].keyHint === "opic" && provs[0].hasKey && provs[0].model === "claude-sonnet-5-5", "the provider saved, its key hidden");
        const stored = await cn.evaluate(() => JSON.stringify({ ...localStorage }));
        check(!stored.includes(KEY), "the key is not in the stored data");
        await cn.close();

        // ---- Asking the cloud model --------------------------------------------------------------
        // The question that waited, asked again as the app is relaunched with it.
        await app.bringToFront();
        await app.evaluate((p) => document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: p })), backLaunch().params);
        await app.waitForFunction(() => /anthropic says: [^]*Who wrote the Odyssey\?/.test(document.body.textContent), null, { timeout: 15000 });
        check(/Anthropic \(claude-sonnet-5-5\)/.test(await app.locator(".as-via").last().textContent()), "the question asked again, Anthropic answers, labelled");
        check(await app.locator("[data-testid='as-choice-connect']").count() === 1, "Connect model taken on the question asked again (the earlier answer keeps its own)");
        await shot(app, "thread-retried");
        // The conversation goes on with it.
        check(await ask("Tell me about the Palm Pre") === "anthropic says: Tell me about the Palm Pre", "the conversation goes on with Anthropic");
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
        // A short answer is one line (a balloon's width is the row's 80%).
        const tall = await app.locator(".as-bubble:has-text('The flashlight is on.')").last().evaluate((b) => b.getBoundingClientRect().height);
        check(tall < 48, "a short answer on one line: " + tall + " px");

        // ---- Conversations ----------------------------------------------------------------------
        // A TouchPad app: on a tablet the list is beside the conversation;
        // on a phone the conversation is over it, and Back (or the header's
        // Conversations) slides it away.
        const panes = await app.getAttribute("[data-testid='as-panes']", "class");
        check(tablet ? /\bmulti\b/.test(panes) : /\bsingle\b/.test(panes), tablet ? "a tablet: the panes side by side" : "a phone: one pane at a time");
        if (tablet) check(await app.isVisible("[data-testid='as-list']") && await app.isVisible("[data-testid='as-input']"), "the list beside the conversation");
        else check(await app.isHidden("[data-testid='as-list']"), "the conversation over the list");
        const showList = async () => {
            if (!tablet && await app.isVisible("[data-testid='as-conversations']")) await app.click("[data-testid='as-conversations']");
            // (Slid away, the conversation is out of sight.)
            if (!tablet) await app.waitForSelector("[data-testid='as-panes-detail']", { state: "hidden" });
            await app.waitForSelector("[data-testid='as-new']");
        };
        const openThread = async (id) => {
            await app.click(`[data-testid='as-thread-${id}']`);
            if (!tablet) await app.waitForSelector("[data-testid='as-list']", { state: "hidden" });
        };
        await showList();
        const threads = (await svc(app, A + "threads", {})).threads;
        check(threads.length === 1, "one conversation so far");
        await app.click("[data-testid='as-new']");
        await app.waitForSelector("[data-testid='as-empty']");
        await ask("What time is it?");
        await showList();
        await app.waitForFunction(() => document.querySelectorAll("[data-testid^='as-thread-']").length === 2);
        check(true, "a new conversation listed beside the first");
        check(/What time is it/.test(await app.textContent("[data-testid='as-list']")), "titled by its first request");
        await shot(app, "conversations");
        const first = threads[0].id;
        await app.click(`[data-testid='as-thread-${first}']`);
        await app.waitForSelector(".as-bubble:has-text('Palm Pre')");
        check((await svc(app, A + "threads", {})).current === first, "an old conversation opened goes on in use");
        check(await app.getAttribute(`[data-testid='as-thread-${first}']`, "aria-current") === "true", "and is the one selected in the list");
        await showList();
        const second = (await svc(app, A + "threads", {})).threads.find((t) => t.id !== first).id;
        // Held (here right-clicked): its menu, Delete, asked.
        await app.click(`[data-testid='as-thread-${second}']`, { button: "right" });
        await app.click("[data-testid='as-menu-delete']");
        await app.click("[data-testid='as-delete-ok']");
        await app.waitForFunction(() => document.querySelectorAll("[data-testid^='as-thread-']").length === 1);
        check(true, "a conversation deleted from its menu");
        // Swiped across: Cancel or Delete over it.
        const third = (await svc(app, A + "newThread", {})).thread.id;
        await svc(app, A + "ask", { text: "What's 3 plus 4?", threadId: third });
        await app.waitForSelector(`[data-testid='as-thread-${third}']`);
        const box = await app.locator(`[data-testid='as-thread-${third}']`).boundingBox();
        await app.mouse.move(box.x + 20, box.y + box.height / 2);
        await app.mouse.down();
        for (let i = 1; i <= 8; ++i) await app.mouse.move(box.x + 20 + i * box.width * 0.08, box.y + box.height / 2);
        await app.mouse.up();
        await app.waitForSelector(`[data-testid='as-swipe-${third}-confirm']`);
        await shot(app, "swipe-delete");
        await app.click(`[data-testid='as-swipe-${third}-delete']`);
        await app.waitForFunction((id) => !document.querySelector(`[data-testid='as-thread-${id}']`), third);
        check((await svc(app, A + "threads", {})).threads.length === 1, "a conversation swiped across and deleted");
        if (!tablet) await openThread(first);

        // ---- Open in New Card ---------------------------------------------------------------------
        // A conversation (or a message) held: Open in New Card launches
        // another card of the app ({newCard: true}) with that conversation;
        // each card keeps to its own, and both follow the one store.
        await showList();
        launches.length = 0;
        await app.click(`[data-testid='as-thread-${first}']`, { button: "right" });
        await app.click("[data-testid='as-menu-newcard']");
        await until(() => launches.length > 0, "Open in New Card launches");
        check(launches[0].id === "org.webosphoenix.assistant" && launches[0].newCard === true && launches[0].params.conversationId === first,
              "a new card of the app with the conversation: " + JSON.stringify(launches[0]));
        if (!tablet) await openThread(first);
        launches.length = 0;
        await app.click(".as-row.out .as-bubble >> nth=0", { button: "right" });
        await app.click("[data-testid='as-menu-newcard']");
        await until(() => launches.length > 0 && launches[0].newCard === true && launches[0].params.conversationId === first, "a message's Open in New Card");
        const other = (await svc(app, A + "newThread", {})).thread.id;
        await svc(app, A + "ask", { text: "What's 5 plus 5?", threadId: other });
        const card = await context.newPage();
        watch(card, "second card");
        await card.goto(appUrl + "?launchParams=" + encodeURIComponent(JSON.stringify({ conversationId: other })));
        await card.waitForSelector(".as-bubble:has-text('5 plus 5')");
        check(await app.locator(".as-bubble:has-text('5 plus 5')").count() === 0, "the second card shows its conversation, the first keeps its own");
        await card.fill("[data-testid='as-input']", "What's 6 plus 6?");
        await card.click("[data-testid='as-send']");
        await card.waitForSelector(".as-bubble:has-text('12')");
        await showList();
        await app.waitForFunction((id) => /6 plus 6|12/.test(document.querySelector(`[data-testid='as-thread-${id}']`)?.textContent || ""), other);
        check(await app.locator(".as-bubble:has-text('6 plus 6')").count() === 0, "a message sent in one card shows in the other's list, not its conversation");
        await shot(card, "second-card");
        await card.close();
        await svc(app, A + "deleteThread", { id: other });
        await svc(app, A + "setCurrent", { id: first });

        // ---- The system's view hands its conversation on ------------------------------------------
        // Each opening of the shell's view is a new conversation, made by
        // its first request (ask {newThread}); its app button relaunches the
        // app with {threadId}, which shows it even from Conversations
        // (where the app still is).
        await showList();
        const before = (await svc(app, A + "threads", {})).threads.length;
        const viewAsk = await svc(app, A + "ask", { text: "What's 7 times 6?", newThread: true });
        const viewThread = viewAsk.thread && viewAsk.thread.id;
        check(!!viewThread && (await svc(app, A + "threads", {})).threads.length === before + 1, "a request from the view makes a new conversation");
        await app.evaluate((id) => document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { threadId: id } })), viewThread);
        await app.waitForSelector(".as-bubble:has-text('7 times 6')");
        if (!tablet) await app.waitForSelector("[data-testid='as-list']", { state: "hidden" });
        check(await app.getAttribute(`[data-testid='as-thread-${viewThread}']`, "aria-current") === "true", "the app, relaunched with it, shows that conversation");
        check((await svc(app, A + "threads", {})).current === viewThread, "and goes on in it");
        await shot(app, "from-view");
        await showList();

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
        await app.click("[data-testid='as-new']");
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
