#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stacked notifications end to end: Messaging and Phone (apps/messaging,
// apps/phone, built into dist/) in headless Chromium with
// runtime/phoenix-runtime.js, their "notification" host messages fed to the
// shell's own stacking (shell/qml/Phoenix/Shell/NotificationStacks.js, run
// here as the window sources run it):
//
//   1. texts from two people, three from Ada and two from Marcus: each
//      conversation one stack, the newest on top with the count, each text
//      with its notification (the shell's banner);
//   2. Ada's conversation opened in Messaging: her stack goes (read), and
//      Marcus's stays;
//   3. two missed calls: one "missed calls" stack in Phone's name, opening
//      the call log on its missed calls; the call log seen: the stack goes.
//
//   node tools/test-notification-stacks.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm run build -w messaging -w phone).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "notification-stacks-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);
const APPS = `http://127.0.0.1:${port}/usr/palm/applications`;
const MESSAGING = "org.webosphoenix.messaging";
const PHONE = "org.webosphoenix.phone";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

// The shell's stacking library, as QML runs it (".pragma library": a
// script of plain functions).
function loadStacks() {
    const src = fs.readFileSync(path.join(REPO, "shell/qml/Phoenix/Shell/NotificationStacks.js"), "utf8")
        .replace(/^\s*\.pragma library\s*$/m, "");
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx;
}

// A ListModel as the window sources hold their notifications in.
class ListModel {
    constructor() { this.rows = []; }
    get count() { return this.rows.length; }
    get(i) { return this.rows[i]; }
    set(i, fields) { this.rows[i] = Object.assign({}, this.rows[i], fields); }
    append(fields) { this.rows.push(Object.assign({}, fields)); }
    remove(i) { this.rows.splice(i, 1); }
}

// The "notification" host message as SimWindowSource takes it ({tag}
// replaces, {remove} takes back by tag, prefix or group, else notify()).
function applyNotification(Stacks, model, appId, p, seq) {
    const target = p.appId || appId;
    if (p.tag) Stacks.removeTagged(model, target, String(p.tag));
    if (p.remove) {
        if (p.tagPrefix) Stacks.removeTagged(model, target, String(p.tagPrefix), true);
        if (p.group) Stacks.removeGroup(model, target, String(p.group));
        return;
    }
    Stacks.push(model, {
        id: "n" + seq, appId: target, title: p.title || "", body: p.body || "",
        params: p.params && typeof p.params === "object" ? JSON.stringify(p.params) : "",
        windowKey: "", ongoing: false, tag: p.tag ? String(p.tag) : "", actions: ""
    }, p.group ? String(p.group) : "");
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try {
            const r = await fetch(url);
            await r.arrayBuffer().catch(() => null);
            if (r.ok) return;
        } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    for (const app of ["phone", "messaging"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm run build -w ${app}\` in apps/ first`);
            process.exit(2);
        }
    }
    const Stacks = loadStacks();
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];      // {page, type, payload}
        const model = new ListModel();
        let seq = 0;
        const watch = (page, name, appId) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    host.push({ page: name, type: msg.type, payload: msg.payload });
                    if (msg.type === "notification")
                        applyNotification(Stacks, model, appId, msg.payload || {}, ++seq);
                } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                    errors.push(`${name}: ${t}`);
                }
            });
        };
        const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const notes = () => host.filter((m) => m.type === "notification" && !m.payload.remove);
        const stackOf = (appId, title) => model.rows.find((r) => r.appId === appId && (title === undefined || r.title === title));
        const until = async (fn, ms = 5000) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
                const v = await fn();
                if (v) return v;
                await new Promise((r) => setTimeout(r, 100));
            }
            return null;
        };

        // ---- 1. Texts from two people -----------------------------------------------------------
        const msg = await context.newPage();
        watch(msg, "messaging", MESSAGING);
        await msg.goto(`${APPS}/${MESSAGING}/index.html`);
        await msg.evaluate(() => localStorage.clear());
        await msg.reload();
        await msg.waitForSelector("[data-testid='msg-tabs']");
        const texts = [["(408) 555-0142", "Are you there?"], ["(650) 555-0187", "Lunch at noon?"],
                       ["(408) 555-0142", "Call me when you can"], ["(408) 555-0142", "It's about Friday"],
                       ["(650) 555-0187", "Or 1 if that's easier"]];
        const threads = {};
        for (const [from, text] of texts)
            threads[from] = await msg.evaluate((o) => window.__phoenixRuntime.simulateIncomingSms(o), { from, text });
        await until(() => notes().length >= 5);
        check(notes().length === 5, `each text has its notification (a banner each): ${notes().length}`);
        check(notes().every((n) => n.payload.group && n.payload.group === n.payload.params.threadId),
              "each one's group is its conversation: " + JSON.stringify(notes().map((n) => n.payload.group)));
        check(threads["(408) 555-0142"] !== threads["(650) 555-0187"], "two conversations");
        const live = model.rows.filter((r) => r.appId === MESSAGING);
        check(live.length === 2, `two stacks in the notification area, not five rows: ${live.length}`);
        const ada = stackOf(MESSAGING, "Ada Palmer"), marcus = stackOf(MESSAGING, "Marcus Reyes");
        check(!!ada && ada.layerCount === 3 && ada.body === "It's about Friday",
              "Ada's: three, the newest on top: " + JSON.stringify(ada && [ada.layerCount, ada.body]));
        check(!!marcus && marcus.layerCount === 2 && marcus.body === "Or 1 if that's easier",
              "Marcus's: two, the newest on top: " + JSON.stringify(marcus && [marcus.layerCount, marcus.body]));
        check(!!ada && JSON.parse(ada.params).threadId === threads["(408) 555-0142"], "a tap on Ada's opens her conversation ({threadId})");
        check(!!ada && Stacks.layersOf(ada).map((l) => l.body).join(" | ") === "Are you there? | Call me when you can | It's about Friday",
              "the layers under it, oldest first");
        await msg.waitForFunction(() => document.querySelectorAll("[data-testid='thread-row']").length >= 2);
        await shot(msg, "1-two-conversations");

        // ---- 2. Ada's conversation read -----------------------------------------------------------
        await msg.click("[data-testid='thread-row'] >> text=Ada Palmer");
        await msg.waitForSelector(".bubble.in >> text=It's about Friday");
        const cleared = await until(() => host.some((m) => m.type === "notification" && m.payload.remove
                                                             && m.payload.group === threads["(408) 555-0142"]));
        check(!!cleared, "reading Ada's conversation takes her stack away ({group, remove})");
        check(!stackOf(MESSAGING, "Ada Palmer") && !!stackOf(MESSAGING, "Marcus Reyes"), "Marcus's stays");
        await shot(msg, "2-ada-read");

        // ---- 3. Missed calls ----------------------------------------------------------------------
        const phone = await context.newPage();
        watch(phone, "phone", PHONE);
        await phone.goto(`${APPS}/${PHONE}/index.html`);
        await phone.waitForSelector(tablet ? "[data-testid='call-row'], .phone-empty" : "[data-testid='dialpad']");
        // On a tablet the log shows beside the dial pad; it was seen already.
        const before = notes().length;
        // Unanswered: the caller hangs up while it rings (an ignored call
        // is not a missed one: the user saw it).
        for (const number of ["(510) 555-0177", "(212) 555-0164"]) {
            const alertPage = context.waitForEvent("page");
            await phone.evaluate((n) => window.__phoenixRuntime.simulateIncomingCall({ number: n }), number);
            const alert = await alertPage;
            await alert.waitForSelector("[data-testid='ignore']");
            const closed = alert.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
            await phone.evaluate(() => window.__phoenixRuntime.simulateRemoteHangup());
            check(await closed, `a call from ${number} rings out unanswered`);
        }
        await until(() => notes().length >= before + 2);
        const missed = notes().slice(before);
        check(missed.length === 2 && missed.every((n) => n.payload.appId === PHONE && n.payload.group === "missed-calls"
                                                     && n.payload.params.action === "missedcalls"),
              "each missed call has its notification, on the missed calls' stack: " + JSON.stringify(missed.map((n) => n.payload)));
        const calls = stackOf(PHONE);
        check(!!calls && calls.layerCount === 2 && calls.title === "Lena Okafor" && /^Missed call, /.test(calls.body),
              "one stack, two missed calls, the newest on top: " + JSON.stringify(calls && [calls.layerCount, calls.title, calls.body]));
        // Opened from it ({action: "missedcalls"}): the log, its missed calls; seen, the stack goes.
        await phone.evaluate(() => document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { action: "missedcalls" } })));
        const onMissed = await phone.waitForSelector("[data-testid='log-filter'] [data-value='missed'][aria-selected='true']", { timeout: 4000 })
            .then(() => true, () => false);
        check(onMissed, "opened from the stack: the call log, on Missed");
        await phone.waitForSelector("[data-testid='call-row']");
        const rows = await phone.locator("[data-testid='call-row']").allTextContents();
        check(rows.length >= 2 && rows.every((r) => /Missed|Ignored/.test(r)), "the call log on its missed calls: " + rows.length);
        const gone = await until(() => !stackOf(PHONE));
        check(!!gone, "the call log seen: the missed calls' stack goes");
        await shot(phone, "3-missed-calls-log");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
