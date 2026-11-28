#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// End to end: an iCloud account (template com.webosphoenix.icloud, a preset
// of the CardDAV & CalDAV transport: apps/dav/service/lib/presets.js) in the
// simulator against a stand-in for iCloud's servers
// (apps/dav/service/test/icloud.cjs: front hosts whose principals name home
// sets on a per-user partition host, an app-specific password only, a group
// card and a Reminders list it must leave alone; Radicale behind it). The
// preset is pointed at the stand-in with the image's setting
// dav/presets.json (the simulator's store "systemConfig:dav/presets.json").
// In headless Chromium with runtime/phoenix-runtime.js:
//   1. Accounts -> Add an Account -> iCloud -> the sign-in page
//      (apps/dav/accounts/icloud.html): the Apple Account's own password is
//      refused with what to do, an account of iCloud in mainland China is
//      told at once that it is not supported, the app-specific password
//      signs in, Create Account runs the first sync;
//   2. the contact and the event are in db8, Contacts and Calendar show
//      them; the group card and the reminder are not;
//   3. a contact and an event made on the device reach the stand-in;
//   4. a contact changed and an event added on the stand-in reach db8;
//   5. the account is deleted, its data goes, iCloud keeps its own.
//
//   node tools/test-icloud-sync.cjs [--tablet] [--out DIR]
//
// Needs Playwright and Radicale (pip install radicale), as tools/test-dav-sync.cjs.

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const icloud = require(path.join(REPO, "apps/dav/service/test/icloud.cjs"));
const vcard = require(path.join(REPO, "apps/shared/synckit/src/vcard.js"));
const ical = require(path.join(REPO, "apps/shared/synckit/src/ical.js"));

async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}

const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "icloud-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id) => `${origin}/usr/palm/applications/${id}/index.html`;

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

const VCARD_TEO = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "UID:teo-1", "N:Abbott;Teo;;;",
    "FN:Teo Abbott", "item1.TEL;type=CELL;type=VOICE;type=pref:(503) 555-0188", "EMAIL;type=INTERNET;type=HOME:teo@example.net",
    "END:VCARD", ""].join("\r\n");
const VCARD_GROUP = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "UID:group-1", "N:Climbing",
    "FN:Climbing", "X-ADDRESSBOOKSERVER-KIND:group", "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:teo-1", "END:VCARD", ""].join("\r\n");

function day(offset, hour, minute) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute || 0, 0, 0);
    return d;
}
const icsDate = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0") +
    "T" + String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "00Z";
const event = (uid, summary, d) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "BEGIN:VEVENT",
    `UID:${uid}`, "DTSTAMP:20260101T000000Z", `DTSTART:${icsDate(d)}`, `DTEND:${icsDate(new Date(d.getTime() + 3600000))}`,
    `SUMMARY:${summary}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const ICS_TODO = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 12.0//EN", "BEGIN:VTODO", "UID:todo-1",
    "DTSTAMP:20260101T000000Z", "SUMMARY:Return the rope", "END:VTODO", "END:VCALENDAR", ""].join("\r\n");

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!icloud.available()) {
        console.error("Radicale is not installed: pip install radicale");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const ic = await icloud.start();
    // An Apple Account of iCloud in mainland China (its home sets on *.icloud.com.cn).
    const cn = await ic.addUser({ user: "li.wei@icloud.com", appPassword: "cnpw-cnpw-cnpw-cnpw", dsid: "30033003", region: "cn" });
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        await ic.card.put(ic.cardBook + "teo-1.vcf", VCARD_TEO);
        await ic.card.put(ic.cardBook + "group-1.vcf", VCARD_GROUP);
        await ic.cal.put(ic.calHome + "gym-1.ics", event("gym-1", "Bouldering (iCloud)", day(0, 15)));
        await ic.cal.put("/" + ic.cal.user + "/tasks/todo-1.ics", ICS_TODO);
        await waitForServer(`${origin}/apps.json`, 10000);

        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        // The image's setting that points the preset at the stand-in.
        await context.addInitScript((cfg) => {
            try { localStorage.setItem("phoenix:systemConfig:dav/presets.json", JSON.stringify(cfg)); } catch (e) { /* not this origin */ }
        }, ic.presetHosts);
        const errors = [];
        const page = await context.newPage();
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(e.message));
            p.on("console", (m) => { if (/^\[dav\]/.test(m.text()) && process.env.DAV_VERBOSE) console.log("    " + m.text()); });
        };
        watch(page);
        context.on("page", watch);
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const db = (p, kind) => p.evaluate((k) => {
            const objects = Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.db/obj/"))
                .map((x) => JSON.parse(localStorage.getItem(x)));
            return objects.filter((o) => !o._del && o._kind === k);
        }, kind);
        const syncNow = async (p, accountId) => {
            await luna(p, "palm://com.palm.activitymanager/create", { start: true, replace: true, activity: {
                name: "Sync now", type: { userInitiated: true, foreground: true },
                callback: { method: "palm://org.webosphoenix.service.dav/sync", params: { accountId } } } });
            await p.waitForTimeout(300);
            for (let t = 0; t < 30000; t += 250) {
                const held = await p.evaluate((a) => JSON.parse(localStorage.getItem("phoenix:dav:syncLock:" + a) || "0"), accountId);
                if (!held) return;
                await p.waitForTimeout(250);
            }
            throw new Error("sync did not finish");
        };

        // ---- 1. Add the account in Accounts -----------------------------------------
        await page.goto(appUrl("com.palm.app.accounts"));
        await page.waitForTimeout(3000);
        await page.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Add an Account" }).first().click();
        await page.waitForTimeout(1200);
        check(await page.getByText("iCloud", { exact: true }).count() > 0, "Accounts lists the iCloud template");
        await shot(page, "1-add-account");
        await page.getByText("iCloud", { exact: true }).first().click();
        let frame = null;
        for (let t = 0; t < 10000 && !frame; t += 250) {
            frame = page.frames().find((f) => /org\.webosphoenix\.dav\/accounts\/icloud\.html/.test(f.url()));
            if (!frame) await page.waitForTimeout(250);
        }
        if (!check(!!frame, "the iCloud sign-in page opens (validator.customUI)")) throw new Error("no sign-in page");
        await frame.waitForSelector("input", { timeout: 10000 });
        await page.waitForTimeout(1000);
        const help = await frame.evaluate(() => document.body.innerText);
        check(/app-specific password/i.test(help) && /account\.apple\.com/.test(help) && /two-factor/i.test(help),
              "the page says to use an app-specific password from account.apple.com, with two-factor authentication on");
        check(await frame.locator("a[href='https://account.apple.com']").count() === 1, "... with a link to account.apple.com");
        check(/Reminders are not included/.test(help), "... and that Reminders are not included");
        const inputs = frame.locator("input");
        check(await inputs.count() === 2, "two fields: the Apple Account's email and the password (no server)");
        await inputs.nth(0).fill(ic.user);
        await inputs.nth(1).fill(ic.accountPassword);
        await inputs.nth(1).press("Tab");
        await shot(page, "2-sign-in");
        await frame.getByText("Sign In", { exact: true }).click();
        await page.waitForTimeout(2500);
        const refused = await frame.evaluate(() => document.body.innerText);
        check(/did not accept/.test(refused) && /app-specific password/.test(refused),
              "the Apple Account's own password is refused, saying to use an app-specific password");
        await shot(page, "3-account-password");
        await inputs.nth(0).fill(cn.user);
        await inputs.nth(1).fill(cn.appPassword);
        await inputs.nth(1).press("Tab");
        const cnStarted = Date.now();
        await frame.getByText("Sign In", { exact: true }).click();
        await frame.waitForFunction(() => /mainland China/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
        check(/mainland China/.test(await frame.evaluate(() => document.body.innerText)) && /not supported/.test(await frame.evaluate(() => document.body.innerText)),
              "an account of iCloud in mainland China is told it is not supported (in " + (Date.now() - cnStarted) + " ms)");
        await shot(page, "3b-mainland-china");
        await inputs.nth(0).fill(ic.user);
        await inputs.nth(1).fill(ic.appPassword);
        await inputs.nth(1).press("Tab");
        await frame.getByText("Sign In", { exact: true }).click();
        const create = page.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 10000 }).catch(() => {});
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 5000 }).catch(() => {});
        await shot(page, "4-capabilities");
        check(await create.isVisible().catch(() => false), "the app-specific password signs in; Accounts offers Create Account");
        await create.click();
        await page.waitForTimeout(1500);
        const account = (await luna(page, "palm://com.palm.service.accounts/listAccounts", { templateId: "com.webosphoenix.icloud" })).results[0];
        if (!check(account && account.username === ic.user && account.capabilityProviders.length === 2,
                   "the iCloud account exists with Contacts and Calendar")) throw new Error("no account");
        await shot(page, "5-accounts");
        check(ic.hits.some((h) => h.host === "contacts-partition") && ic.hits.some((h) => h.host === "caldav-partition"),
              "discovery followed the principals to the account's partition hosts");

        for (let t = 0; t < 20000; t += 500) {
            if ((await db(page, "com.palm.contact.dav:1")).length && (await db(page, "com.palm.calendarevent.dav:1")).length) break;
            await page.waitForTimeout(500);
        }
        await syncNow(page, account._id);

        // ---- 2. db8 has iCloud's contact and event ------------------------------------
        let contacts = await db(page, "com.palm.contact.dav:1");
        check(contacts.length === 1 && contacts[0].name.givenName === "Teo" && contacts[0].phoneNumbers[0].value === "(503) 555-0188"
              && contacts[0].accountId === account._id, "iCloud's contact is in db8, and its group card is not a contact");
        const cals = await db(page, "com.palm.calendar.dav:1");
        check(JSON.stringify(cals.map((c) => c.name).sort()) === JSON.stringify(["Home", "Work"]),
              "the Home and Work calendars, not the Reminders list");
        let events = await db(page, "com.palm.calendarevent.dav:1");
        check(events.length === 1 && events[0].subject === "Bouldering (iCloud)", "iCloud's event is in db8 (the reminder is not)");

        const contactsPage = await context.newPage();
        await contactsPage.goto(appUrl("com.palm.app.contacts"));
        await contactsPage.waitForTimeout(4000);
        check(/Teo Abbott/.test(await contactsPage.evaluate(() => document.body.innerText)), "Contacts lists Teo Abbott");
        check(!/Climbing/.test(await contactsPage.evaluate(() => document.body.innerText)), "... and not the group");
        await shot(contactsPage, "6-contacts");
        await contactsPage.close();

        const calPage = await context.newPage();
        await calPage.goto(appUrl("com.palm.app.calendar"));
        let calWin = null;
        for (let t = 0; t < 15000 && !calWin; t += 250) {
            calWin = context.pages().find((p) => p !== calPage && p !== page && /com\.palm\.app\.calendar/.test(p.url()));
            if (!calWin) await page.waitForTimeout(250);
        }
        calWin = calWin || calPage;
        await calWin.waitForTimeout(4000);
        check(/Bouldering \(iCloud\)/.test(await calWin.evaluate(() => document.body.innerText)), "Calendar shows today's iCloud event");
        await shot(calWin, "7-calendar");
        for (const p of context.pages()) if (p !== page) await p.close();

        // ---- 3. The device's changes go to iCloud -------------------------------------
        await luna(page, "palm://com.palm.db/put", { objects: [{ _kind: "com.palm.contact.dav:1", accountId: account._id,
            name: { givenName: "Nadia", familyName: "Okoro" }, phoneNumbers: [{ value: "(206) 555-0119", type: "type_mobile" }] }] });
        const work = cals.find((c) => c.name === "Work");
        const start = day(1, 12);
        await luna(page, "palm://com.palm.db/put", { objects: [{ _kind: "com.palm.calendarevent.dav:1", accountId: account._id,
            calendarId: work._id, subject: "Standup (from the phone)", dtstart: start.getTime(), dtend: start.getTime() + 1800000,
            allDay: false, tzId: Intl.DateTimeFormat().resolvedOptions().timeZone }] });
        await syncNow(page, account._id);
        const cards = await ic.card.list(ic.cardBook);
        const nadiaFile = cards.find((f) => !/teo-1|group-1/.test(f));
        check(cards.length === 3 && nadiaFile && vcard.toContact((await ic.card.get(nadiaFile)).body).contact.name.givenName === "Nadia",
              "a contact made on the device is in iCloud's address book");
        check(/X-ADDRESSBOOKSERVER-MEMBER/.test((await ic.card.get(ic.cardBook + "group-1.vcf")).body), "the group card is left as it was");
        const workFiles = await ic.cal.list(ic.calWork);
        const standup = workFiles[0] && ical.toEvents((await ic.cal.get(workFiles[0])).body).master;
        check(workFiles.length === 1 && standup && standup.subject === "Standup (from the phone)" && standup.dtstart === start.getTime(),
              "an event made on the device is in iCloud's Work calendar");

        // ---- 4. iCloud's changes come to the device -----------------------------------
        await ic.card.put(ic.cardBook + "teo-1.vcf", VCARD_TEO.replace("FN:Teo Abbott", "FN:Teo Abbott\r\nNOTE:Changed on the iPhone"));
        await ic.cal.put(ic.calHome + "climb-2.ics", event("climb-2", "Crag day (iCloud)", day(2, 9)));
        await syncNow(page, account._id);
        contacts = await db(page, "com.palm.contact.dav:1");
        check((contacts.find((c) => c.name.givenName === "Teo") || {}).note === "Changed on the iPhone", "a contact changed in iCloud changes in db8");
        events = await db(page, "com.palm.calendarevent.dav:1");
        check(JSON.stringify(events.map((e) => e.subject).sort()) ===
              JSON.stringify(["Bouldering (iCloud)", "Crag day (iCloud)", "Standup (from the phone)"]),
              "an event added in iCloud is in db8 beside the device's");

        // ---- 5. Delete the account -----------------------------------------------------
        const del = await luna(page, "palm://com.palm.service.accounts/deleteAccount", { accountId: account._id });
        check(del.returnValue, "deleteAccount");
        check((await db(page, "com.palm.contact.dav:1")).length === 0 && (await db(page, "com.palm.calendarevent.dav:1")).length === 0 &&
              (await db(page, "com.palm.calendar.dav:1")).length === 0, "its contacts, calendars and events are gone from the device");
        check((await ic.card.list(ic.cardBook)).length === 3 && (await ic.cal.list(ic.calHome)).length === 2, "iCloud keeps its data");

        check(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        ic.stop();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "all checks passed"}; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main();
