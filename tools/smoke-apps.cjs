#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Use the original Open webOS apps the way a person would, in headless
// Chromium with the simulator's runtime and sample data (like
// tools/test-apps.cjs, which only checks that they start): compute 12×3,
// write a memo, add an alarm, open and add a contact, open and add a
// calendar event, read and send an email, open the account settings.
// Each step is checked and screenshotted to build/app-tests/<form factor>/.
//
//   node tools/smoke-apps.cjs [--tablet] [appId ...]
//
// Needs Playwright (npm i -g playwright && npx playwright install chromium).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    const tries = ["playwright", path.join(execSync("npm root -g").toString().trim(), "playwright")];
    for (const t of tries) {
        try { return require(t); } catch (e) { /* next */ }
    }
    console.error("Playwright not found. Install it: npm i -g playwright && npx playwright install chromium");
    process.exit(2);
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const only = args.filter((a) => !a.startsWith("--"));
const phone = !tablet;
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const outDir = path.join(REPO, "build", "app-tests", tablet ? "tablet" : "phone");
const port = 8600 + Math.floor(Math.random() * 90);

// Helpers for a page -----------------------------------------------------------------

function helpers(page, appId) {
    let shot = 0;
    const h = {
        page,
        text: async () => (await h.page.evaluate(() => document.body.innerText)).replace(/\s+/g, " "),
        wait: (ms) => h.page.waitForTimeout(ms),
        button: (caption) => h.page.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: caption }).first(),
        tapText: async (text, ms) => { await h.page.getByText(text, { exact: true }).first().click(); await h.wait(ms || 1200); },
        tap: async (selector, ms) => { await h.page.locator(selector).first().click(); await h.wait(ms || 1200); },
        type: async (text) => { await h.page.keyboard.type(text); await h.wait(300); },
        back: async () => { await h.page.evaluate(() => window.__phoenixRuntime.back()); await h.wait(1200); },
        expect: async (what, fn) => {
            const got = await fn();
            if (!got) throw new Error("expected " + what);
        },
        expectText: async (s) => h.expect("to see \"" + s + "\"", async () => (await h.text()).includes(s)),
        screenshot: async (name) => h.page.screenshot({ path: path.join(outDir, "smoke-" + appId.replace("com.palm.app.", "") + "-" + (++shot) + "-" + name + ".png") }),
        db: (kindRe) => h.page.evaluate((re) => {
            const db = JSON.parse(localStorage.getItem("phoenix:db8:com.palm.db") || "{\"objects\":{}}");
            return Object.values(db.objects).filter((o) => !o._del && new RegExp(re).test(o._kind));
        }, kindRe)
    };
    return h;
}

// Waits for the next window (card) an app opens.
async function nextWindow(context, before, ms) {
    for (let t = 0; t < (ms || 15000); t += 250) {
        const pages = context.pages();
        if (pages.length > before) {
            const p = pages[pages.length - 1];
            await p.waitForLoadState().catch(() => {});
            return p;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("the app did not open a window");
}

// Scenarios ----------------------------------------------------------------------------

const SCENARIOS = {
    "com.palm.app.calculator": async (h) => {
        for (const key of ["1", "2", "×", "3", "="]) {
            await h.page.locator(".calc-small-body :is(.calc-key, .calc-operator-key):visible", { hasText: new RegExp("^" + key + "$") }).first().click();
            await h.wait(150);
        }
        await h.screenshot("12x3");
        await h.expect("the display to read 36", async () =>
            (await h.page.locator(".calc-small-body .calc-display").first().innerText()).trim().startsWith("36"));
    },

    "com.palm.app.notes": async (h) => {
        const before = (await h.db("com\\.palm\\.note:1")).length;
        await h.tap(".new-memo");
        await h.type("Smoke test: buy a new phone case");
        await h.screenshot("editing");
        await h.tap(".back-button:visible");
        await h.screenshot("wall");
        await h.expectText("Smoke test: buy a new phone case");
        await h.expect("one more memo in db8", async () => (await h.db("com\\.palm\\.note:1")).length === before + 1);
    },

    "com.palm.app.clock": async (h) => {
        await h.tap(".enyo-radiobutton:nth-child(2)");
        await h.button("New Alarm").click(); await h.wait(1200);
        await h.screenshot("new-alarm");
        await h.button("Done").click(); await h.wait(1200);
        await h.screenshot("alarms");
        await h.expect("an alarm in db8", async () => (await h.db("com\\.palm\\.clock\\.alarm:1")).length === 1);
        await h.expectText("8:00 AM");
    },

    "com.palm.app.contacts": async (h) => {
        await h.tapText("Marcus Chen", 1500);
        await h.screenshot("details");
        await h.expectText("Chef, Harbor & Pine");
        await h.expectText("(415) 555-0163");
        if (phone) await h.back();
        await h.button("Add Contact").click(); await h.wait(1500);
        await h.page.locator("input:visible").first().click();
        await h.type("Taylor Morgan");
        await h.screenshot("new-contact");
        await h.button("Done").click(); await h.wait(2500);
        await h.screenshot("saved");
        await h.expectText("Taylor Morgan");
        await h.expect("a person for the new contact in db8", async () =>
            (await h.db("com\\.palm\\.person:1")).some((p) => p.name && p.name.familyName === "Morgan"));
    },

    "com.palm.app.calendar": async (h) => {
        const ev = h.page.getByText("Lunch with Priya").first();
        await ev.scrollIntoViewIfNeeded().catch(() => {});
        await ev.click(); await h.wait(1500);
        await h.screenshot("event-details");
        await h.expectText("Bistro Verde");
        await h.button("Close").click(); await h.wait(1000);
        const views = h.page.locator(".Rbutton .enyo-radiobutton");
        await views.nth(1).click(); await h.wait(1500);
        await h.screenshot("week");
        await views.nth(2).click(); await h.wait(1500);
        await h.screenshot("month");
        await views.nth(0).click(); await h.wait(1000);
        await h.button("New event").click(); await h.wait(1500);
        await h.tap(".event-name", 300);
        await h.type("Pick up bike");
        await h.screenshot("new-event");
        await h.button("Done").click(); await h.wait(2000);
        await h.screenshot("day");
        await h.expect("the new event in db8", async () =>
            (await h.db("com\\.palm\\.calendarevent:1")).some((e) => e.subject === "Pick up bike"));
    },

    "com.palm.app.email": async (h, context) => {
        await h.tapText("Launcher mock-ups for Thursday", 2000);
        await h.screenshot("message");
        await h.expectText("Larger touch targets in the quick launch bar");
        if (phone) await h.back();
        const before = context.pages().length;
        await h.tap("[id$=composeButton]", 500);
        const c = helpers(await nextWindow(context, before), "com.palm.app.email");
        await c.wait(2500);
        await c.tap("[id$=toInput_input_input_input]", 300);
        await c.type("dan.okafor@example.com, ");
        await c.tap("[id$=subjectInput] input", 300);
        await c.type("Coastal trail next month");
        await c.tap("[id$=bodyInput]", 300);
        await c.type("Shall we pick a date?");
        await c.page.screenshot({ path: path.join(outDir, "smoke-email-compose.png") });
        await c.page.locator("[id$=sendButton]").first().click();
        await h.wait(2000);
        await h.expect("the sent email in the Sent folder", async () =>
            (await h.db("email:1")).some((e) => e.subject === "Coastal trail next month" && /sent/.test(e.folderId)));
    },

    "com.palm.app.accounts": async (h) => {
        await h.tapText("Example Mail", 1200);
        await h.screenshot("account-settings");
        await h.expectText("Account Settings");
        await h.button("Back").click(); await h.wait(1000);
        await h.button("Add an Account").click(); await h.wait(1200);
        await h.tapText("Email Account", 2500);
        await h.screenshot("email-wizard");
        const frame = h.page.frames().find((f) => /accounts\/wizard\.html/.test(f.url()));
        await h.expect("the Email sign-in page", async () =>
            !!frame && (await frame.evaluate(() => document.body.innerText)).includes("EMAIL ADDRESS"));
    }
};

// Main ---------------------------------------------------------------------------------

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    let failed = 0;
    try {
        await waitForServer(base + "/apps.json", 10000);
        const apps = (await (await fetch(base + "/apps.json")).json())
            .filter((a) => SCENARIOS[a.id] && (!only.length || only.includes(a.id)));
        const browser = await chromium.launch();
        for (const app of apps) {
            const context = await browser.newContext({ viewport });
            const page = await context.newPage();
            const errors = [];
            context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
            page.on("pageerror", (e) => errors.push(e.message));
            let status = "PASS", detail = "";
            try {
                await page.goto(base + app.main);
                const shown = app.noWindow ? await nextWindow(context, 1) : page;
                await shown.waitForTimeout(3000);
                await SCENARIOS[app.id](helpers(shown, app.id), context);
                if (errors.length) throw new Error("uncaught errors: " + errors.slice(0, 3).join(" | "));
            } catch (e) {
                status = "FAIL";
                detail = "\n    " + String(e.message || e).split("\n")[0];
                failed++;
            }
            console.log(`${status}  ${app.id}${detail}`);
            await context.close();
        }
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
