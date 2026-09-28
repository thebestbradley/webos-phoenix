#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Tasks (apps/tasks, built into dist/) in headless Chromium against
// the simulated db8 and activity manager in runtime/phoenix-runtime.js:
// makes a list, adds tasks (quickly and in the editor, with due dates and
// priorities), completes one (struck through), hides completed tasks,
// checks Today, Upcoming and Overdue, edits a task, sets a reminder and
// fires it (the runtime's clock is moved on with activities.fireDue, so it
// takes no time): the reminder reaches the shell as a notification, and
// opening it offers Snooze and Done. Then it renames the list, deletes a
// task and the list, and finds a task and "New Task" with Just Type.
//
//   node tools/test-tasks.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "tasks-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8500 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const APP = "org.webosphoenix.tasks";
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    if (!fs.existsSync(path.join(REPO, "apps/tasks/dist/index.html"))) {
        console.error("apps/tasks/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const row = (summary) => `[data-testid='task-${summary}']`;
        const title = () => page.textContent("[data-testid='list-title']");
        const rows = () => page.$$eval(".tk-task .tk-summary-text", (els) => els.map((e) => e.textContent));
        const pick = async (testId, label) => {
            await page.click(`[data-testid='${testId}']`);
            await page.click(`.pui-popup .pui-menu-item:has(.pui-menu-label:text-is("${label}"))`);
            await page.waitForSelector(".pui-popup", { state: "detached" });
        };
        const setDate = async (prefix, ms) => {
            const d = new Date(ms);
            await pick(`${prefix}-year`, String(d.getFullYear()));
            await pick(`${prefix}-month`, MONTHS[d.getMonth()]);
            await pick(`${prefix}-day`, String(d.getDate()));
        };
        const menuItem = (text) => page.click(`.pui-menu-item:has-text("${text}")`);
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p));
        }), [uri, params]);
        const findTask = async (summary) => (await luna("luna://com.palm.db/find", {
            query: { from: "com.palm.task:1", where: [{ prop: "summary", op: "=", val: summary }] },
        })).results[0];
        // Phone: one pane at a time; the back gesture (Escape) returns to the lists.
        const showLists = async () => {
            if (!tablet && await page.locator("[data-testid='lists-pane']").count() === 0) await page.keyboard.press("Escape");
            await page.waitForSelector("[data-testid='lists-pane']");
        };
        const open = async (testId) => {
            await showLists();
            await page.click(`[data-testid='${testId}']`);
            await page.waitForSelector("[data-testid='tasks-pane']");
        };
        const closeEditor = async () => {
            await page.click("[data-testid='edit-done']");
            await page.waitForSelector("[data-testid='editor']", { state: "detached" });
        };
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dayOffset = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n).getTime();

        // Start from a fresh device.
        await page.goto(appUrl(APP));
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        // ---- Lists -----------------------------------------------------------------------
        await page.waitForSelector("[data-testid='list-Inbox']");
        check(true, "starts with an Inbox");
        check(tablet === (await page.locator("[data-testid='tasks-pane']").count() === 1),
            tablet ? "tablet: lists and tasks side by side" : "phone: the lists on their own");
        await shot("lists");
        await page.click("[data-testid='new-list']");
        await page.waitForSelector("[data-testid='list-dialog']");
        await page.fill("[data-testid='list-name']", "Groceries");
        await page.click("[data-testid='list-ok']");
        await page.waitForSelector("[data-testid='list-dialog']", { state: "detached" });
        await page.waitForSelector("[data-testid='tasks-pane']");
        check((await title()) === "Groceries", "new list: Groceries, and it opens");

        // ---- Add tasks ----------------------------------------------------------------------
        for (const s of ["Buy milk", "Eggs"]) {
            await page.fill("[data-testid='quick-add']", s);
            await page.press("[data-testid='quick-add']", "Enter");
            await page.waitForSelector(row(s));
        }
        check(true, "\"Add a task\" adds Buy milk and Eggs");

        await page.click("[data-testid='new-task']");
        await page.waitForSelector("[data-testid='editor']");
        await page.fill("[data-testid='edit-summary']", "Pay rent");
        await page.click("[data-testid='due-toggle']");
        await setDate("due", dayOffset(-1));
        await pick("edit-priority", "High");
        await page.$eval(".tk-editor-body", (e) => { e.scrollTop = 0; });
        await shot("editor");
        await closeEditor();
        await page.waitForSelector(row("Pay rent"));
        check((await page.textContent(`${row("Pay rent")} .tk-prio`)) === "!!!", "the editor sets a high priority (!!!)");
        check((await page.textContent(`${row("Pay rent")} .tk-due.late`)) === "Yesterday", "and a due date: yesterday, in red");

        await page.click("[data-testid='new-task']");
        await page.fill("[data-testid='edit-summary']", "Book flights");
        await page.click("[data-testid='due-toggle']");
        await setDate("due", dayOffset(2));
        await page.click("[data-testid='due-time-toggle']");
        await pick("due-hour", "3");
        await pick("due-minute", "30");
        await pick("due-ampm", "PM");
        await closeEditor();
        await page.waitForSelector(row("Book flights"));
        const flights = await findTask("Book flights");
        const fd = new Date(flights.due);
        check(!flights.allDay && fd.getHours() === 15 && fd.getMinutes() === 30 && flights.due - dayOffset(2) === 15.5 * 3600e3,
            "due in two days at 3:30 PM");
        check((await rows()).join(",") === "Pay rent,Book flights,Buy milk,Eggs", `sorted by due date (${(await rows()).join(", ")})`);

        // ---- Complete, hide completed ----------------------------------------------------------
        await page.click("[data-testid='check-Eggs']");
        await page.waitForSelector(`${row("Eggs")}.completed`);
        const deco = await page.$eval(`${row("Eggs")} .tk-summary-text`, (e) => getComputedStyle(e).textDecorationLine);
        check(deco === "line-through", "a completed task is struck through");
        check((await findTask("Eggs")).completed === true, "and stored completed");
        check((await rows()).slice(-1)[0] === "Eggs", "completed tasks go to the bottom");
        await shot("tasks");
        await page.click("[data-testid='hide-completed']");
        await page.waitForSelector(row("Eggs"), { state: "detached" });
        check(true, "hide completed");
        await page.reload();
        await open("list-Groceries");
        await page.waitForSelector(row("Buy milk"));
        check(await page.locator(row("Eggs")).count() === 0, "hiding completed tasks is remembered");
        await page.click("[data-testid='menu']");
        await menuItem("Show Completed");
        await page.waitForSelector(row("Eggs"));
        check(true, "the header menu shows them again");

        // ---- Today, Upcoming, Overdue ----------------------------------------------------------------
        await page.fill("[data-testid='quick-add']", "Apples");
        await page.press("[data-testid='quick-add']", "Enter");
        await page.waitForSelector(row("Apples"));
        await showLists();
        check((await page.textContent("[data-testid='view-overdue'] .pui-row-value")) === "1", "Overdue counts 1");
        check((await page.textContent("[data-testid='list-Groceries'] .pui-row-value")) === "4", "Groceries counts 4 open tasks");
        await open("view-overdue");
        check((await title()) === "Overdue" && (await rows()).join(",") === "Pay rent", "Overdue: Pay rent");
        await open("view-upcoming");
        check((await rows()).join(",") === "Book flights", "Upcoming: Book flights");
        check((await page.textContent(`${row("Book flights")} .tk-sub`)).includes("Groceries"), "views name each task's list");
        await open("view-today");
        await page.fill("[data-testid='quick-add']", "Water plants");
        await page.press("[data-testid='quick-add']", "Enter");
        await page.waitForSelector(row("Water plants"));
        const plants = await findTask("Water plants");
        check(plants.allDay && plants.due === dayOffset(0), "a task added in Today is due today");
        await shot("today");

        // ---- Edit ---------------------------------------------------------------------------------
        await open("list-Groceries");
        await page.click(row("Buy milk"));
        await page.waitForSelector("[data-testid='editor']");
        await page.fill("[data-testid='edit-summary']", "Buy oat milk");
        await page.fill("[data-testid='edit-notes']", "Two litres");
        await pick("edit-priority", "Medium");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='editor']", { state: "detached" });
        await page.waitForSelector(row("Buy oat milk"));
        check((await page.textContent(`${row("Buy oat milk")} .tk-sub`)).includes("Two litres"), "edit: renamed, with notes, saved by the back gesture");
        check((await findTask("Buy oat milk")).priority === 5, "edit: medium priority stored as iCalendar 5");

        // ---- Reminder -------------------------------------------------------------------------------
        await page.click(row("Buy oat milk"));
        await page.click("[data-testid='remind-toggle']");
        await page.waitForSelector("[data-testid='remind-date']");
        await shot("reminder-set");
        await closeEditor();
        let milk = await findTask("Buy oat milk");
        const actName = `${APP}.remind.${milk._id}`;
        let details = await luna("luna://com.palm.activitymanager/getDetails", { activityName: actName });
        check(milk.remind > Date.now() && details.returnValue && details.activity.state === "waiting",
            `a reminder is an activity: ${details.activity && details.activity.schedule.start}`);
        check(await page.locator(`${row("Buy oat milk")} .tk-bell`).count() === 1, "the task shows a bell");
        host.length = 0;
        await page.evaluate((at) => window.__phoenixRuntime.activities.fireDue(at), milk.remind);
        await page.waitForFunction(() => true);
        const note = await (async () => {
            for (let i = 0; i < 40; i++) {
                const n = host.find((m) => m.type === "notification");
                if (n) return n.payload;
                await page.waitForTimeout(50);
            }
            return null;
        })();
        check(note && note.appId === APP && note.title === "Buy oat milk" && note.params.taskId === milk._id && note.params.fromReminder,
            "at the reminder time the shell gets a notification for the task");
        check(!host.some((m) => m.type === "launch"), "the reminder does not bring the card up");
        check(await page.locator("[data-testid='editor']").count() === 0 && (await title()) === "Groceries", "the app stays where it was");
        details = await luna("luna://com.palm.activitymanager/getDetails", { activityName: actName });
        check(details.returnValue === false, "the fired reminder's activity is completed");

        // Tapping the notification launches the app with its params (SimWindowSource -> webOSRelaunch).
        await page.evaluate((p) => window.__phoenixRuntime.relaunch(p), note.params);
        await page.waitForSelector("[data-testid='reminder-bar']");
        check((await page.inputValue("[data-testid='edit-summary']")) === "Buy oat milk", "tapping it opens the task with Snooze and Done");
        await shot("reminder");
        const before = Date.now();
        await page.click("[data-testid='reminder-snooze']");
        await page.waitForSelector("[data-testid='editor']", { state: "detached" });
        milk = await findTask("Buy oat milk");
        details = await luna("luna://com.palm.activitymanager/getDetails", { activityName: actName });
        check(milk.remind >= before + 600e3 && milk.remind <= Date.now() + 600e3 && details.returnValue,
            "Snooze 10 min reschedules the reminder");
        host.length = 0;
        await page.evaluate((at) => window.__phoenixRuntime.activities.fireDue(at), milk.remind);
        await page.waitForTimeout(300);
        const again = host.find((m) => m.type === "notification");
        check(!!again, "and it fires again");
        await page.evaluate((p) => window.__phoenixRuntime.relaunch(p), again.payload.params);
        await page.click("[data-testid='reminder-done']");
        await page.waitForSelector(`${row("Buy oat milk")}.completed`);
        check((await findTask("Buy oat milk")).completed, "Done completes the task");

        // ---- Rename, delete -------------------------------------------------------------------------
        await page.click("[data-testid='menu']");
        await menuItem("Rename List");
        await page.fill("[data-testid='list-name']", "Shopping");
        await page.click("[data-testid='list-ok']");
        await page.waitForFunction(() => document.querySelector("[data-testid='list-title']").textContent === "Shopping");
        check(true, "rename list: Shopping");
        await page.click(row("Book flights"));
        await page.click("[data-testid='edit-delete']");
        await page.waitForSelector("[data-testid='delete-task-dialog']");
        await page.click("[data-testid='delete-task-confirm']");
        await page.waitForSelector(row("Book flights"), { state: "detached" });
        check(!(await findTask("Book flights")), "delete task");
        await page.click("[data-testid='menu']");
        await menuItem("Delete List");
        await page.waitForSelector("[data-testid='delete-list-dialog']");
        await shot("delete-list");
        await page.click("[data-testid='delete-list-confirm']");
        await page.waitForFunction(() => document.querySelector("[data-testid='list-title']").textContent === "Inbox");
        check(!(await findTask("Pay rent")), "delete list: its tasks go too, and the Inbox opens");
        await page.click("[data-testid='menu']");
        check(await page.locator(".pui-menu-item.disabled:has-text('Delete List')").count() === 1, "the Inbox cannot be deleted");
        await page.keyboard.press("Escape");
        await page.fill("[data-testid='quick-add']", "Renew passport");
        await page.press("[data-testid='quick-add']", "Enter");
        await page.waitForSelector(row("Renew passport"));

        // ---- Just Type -----------------------------------------------------------------------------
        const jt = await context.newPage();
        const jtHost = [];
        jt.on("pageerror", (e) => errors.push("Just Type: " + e.message));
        jt.on("console", (m) => { if (m.text().startsWith("__phoenix__")) jtHost.push(JSON.parse(m.text().slice(11))); });
        await jt.goto(`${origin}/usr/palm/applications/com.palm.launcher/index.html`);
        await jt.waitForTimeout(2500);
        const search = async (text) => {
            await jt.evaluate(() => { const j = enyo.$.justTypeApp.$.justType; j.clearSearchText(); j.forceFocus(); });
            await jt.keyboard.type(text, { delay: 40 });
            await jt.waitForTimeout(1500);
        };
        await search("passport");
        const jtText = (await jt.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        check(/Tasks 1/.test(jtText) && /New Task/.test(jtText), "Just Type: \"passport\" finds the task and offers New Task");
        await jt.getByText("Tasks", { exact: true }).first().click();
        await jt.waitForTimeout(800);
        await jt.screenshot({ path: path.join(outDir, "justtype.png") });
        await jt.locator(".dbcontent-display1:visible", { hasText: "Renew passport" }).first().click();
        await jt.waitForTimeout(500);
        const passport = await findTask("Renew passport");
        const hit = jtHost.filter((m) => m.type === "launch").map((m) => m.payload).find((l) => l.id === APP);
        check(hit && hit.params.taskId === passport._id, "Just Type: tapping the task opens it in Tasks");
        await search("passport");
        jtHost.length = 0;
        await jt.getByText("New Task", { exact: true }).first().click();
        await jt.waitForTimeout(500);
        const action = jtHost.filter((m) => m.type === "launch").map((m) => m.payload).find((l) => l.id === APP);
        check(action && action.params.text === "passport", "Just Type: New Task carries the text");
        await jt.close();

        await page.goto(appUrl(APP, hit.params));
        await page.waitForSelector("[data-testid='editor']");
        check((await page.inputValue("[data-testid='edit-summary']")) === "Renew passport", "launched with {taskId} it opens the task");
        await page.goto(appUrl(APP, { text: "Call%20the%20vet" }));
        await page.waitForSelector("[data-testid='editor']");
        check((await page.inputValue("[data-testid='edit-summary']")) === "Call the vet", "launched with {text} it starts a new task");
        await closeEditor();
        await page.waitForSelector(row("Call the vet"));
        check((await title()) === "Inbox", "which goes in the Inbox");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
