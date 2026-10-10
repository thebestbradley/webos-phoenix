#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// End to end: a CardDAV & CalDAV account in the simulator against a real
// server. Starts Radicale (pip install radicale) with a throwaway storage
// folder, puts a contact and two events on it, then in headless Chromium
// with runtime/phoenix-runtime.js:
//   1. adds the account in the original Accounts app (Add an Account ->
//      CardDAV & CalDAV -> the sign-in page in apps/dav/accounts -> Create
//      Account), which runs the first sync (onCreate, onEnabled);
//   2. checks db8 against the server, and that Contacts and Calendar show
//      the synced contact and events;
//   3. changes, adds and deletes contacts and events in db8 (as the apps
//      do), syncs through the activity manager ("Sync now"), and checks the
//      server;
//   4. changes and deletes on the server, syncs, checks db8;
//   5. deletes the account and checks its data is gone.
//
//   node tools/test-dav-sync.cjs [--tablet] [--out DIR]
//
// Needs Playwright, like the other tools/test-*.cjs.

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const radicale = require(path.join(REPO, "apps/dav/service/test/radicale.cjs"));
const vcard = require(path.join(REPO, "apps/shared/synckit/src/vcard.js"));
const ical = require(path.join(REPO, "apps/shared/synckit/src/ical.js"));

const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "dav-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8500 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id) => `${origin}/usr/palm/applications/${id}/index.html`;

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

const VCARD_WREN = ["BEGIN:VCARD", "VERSION:3.0", "UID:wren-1", "N:Castillo;Wren;;;", "FN:Wren Castillo",
    "TEL;TYPE=CELL:(415) 555-0133", "EMAIL;TYPE=INTERNET,HOME:wren@example.net", "NOTE:Met at the conference",
    "CATEGORIES:Friends", "END:VCARD", ""].join("\r\n");

const VCARD_PRIYA = ["BEGIN:VCARD", "VERSION:3.0", "UID:priya-1", "N:Natarajan;Priya;;;", "FN:Priya Natarajan",
    "EMAIL;TYPE=INTERNET,WORK:priya.natarajan@example.net", "TITLE:Architect", "END:VCARD", ""].join("\r\n");

function day(offset, hour, minute) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute || 0, 0, 0);
    return d;
}
const icsDate = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0") +
    "T" + String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "00Z";
const ICS_REVIEW = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:review-1",
    "DTSTAMP:20260101T000000Z", `DTSTART:${icsDate(day(0, 15))}`, `DTEND:${icsDate(day(0, 16))}`,
    "SUMMARY:Design review (DAV)", "LOCATION:Room 4B", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const ICS_RUN = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:run-1",
    "DTSTAMP:20260101T000000Z", `DTSTART:${icsDate(day(1, 7))}`, `DTEND:${icsDate(day(1, 8))}`,
    "RRULE:FREQ=DAILY;COUNT=5", "SUMMARY:Morning run (DAV)", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!radicale.available()) {
        console.error("Radicale is not installed: pip install radicale");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const dav = await radicale.start();
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        await dav.mkAddressbook("contacts", "Contacts");
        await dav.mkCalendar("calendar", "Personal");
        await dav.put("/alice/contacts/wren-1.vcf", VCARD_WREN);
        // Same email address as the sample address book's Priya Natarajan: the
        // contacts linker joins the two into one person.
        await dav.put("/alice/contacts/priya-1.vcf", VCARD_PRIYA);
        await dav.put("/alice/calendar/review-1.ics", ICS_REVIEW);
        await dav.put("/alice/calendar/run-1.ics", ICS_RUN);
        await waitForServer(`${origin}/apps.json`, 10000);

        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
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
            // The runtime's db8 keeps each object under a key of its own.
            const objects = Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.db/obj/"))
                .map((x) => JSON.parse(localStorage.getItem(x)));
            return objects.filter((o) => !o._del && o._kind === k);
        }, kind);
        // A sync through the activity manager, as the apps' "Sync now" starts it;
        // waits for the account's sync lock to clear.
        const syncNow = async (p, accountId) => {
            await luna(p, "palm://com.palm.activitymanager/create", { start: true, replace: true, activity: {   // as Calendar does (CalendarsManager.js)
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
        check(await page.getByText("CardDAV & CalDAV", { exact: true }).count() > 0, "Accounts lists the CardDAV & CalDAV template");
        await shot(page, "1-add-account");
        await page.getByText("CardDAV & CalDAV", { exact: true }).first().click();
        let frame = null;
        for (let t = 0; t < 10000 && !frame; t += 250) {
            frame = page.frames().find((f) => /org\.webosphoenix\.dav\/accounts\/wizard\.html/.test(f.url()));
            if (!frame) await page.waitForTimeout(250);
        }
        if (!check(!!frame, "the sign-in page opens (validator.customUI)")) throw new Error("no wizard");
        await frame.waitForSelector("input", { timeout: 10000 });
        await page.waitForTimeout(1000);
        const inputs = frame.locator("input");
        await inputs.nth(0).fill(dav.url);
        await inputs.nth(1).fill(dav.user);
        await inputs.nth(2).fill("not-the-password");
        await inputs.nth(2).press("Tab");
        await shot(page, "2-sign-in");
        await frame.getByText("Sign In", { exact: true }).click();
        await page.waitForTimeout(2500);
        check(/incorrect/i.test(await frame.evaluate(() => document.body.innerText)), "a wrong password is refused (401_UNAUTHORIZED)");
        await shot(page, "3-wrong-password");
        await inputs.nth(2).fill(dav.password);
        await inputs.nth(2).press("Tab");
        await frame.getByText("Sign In", { exact: true }).click();
        const create = page.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
        await create.waitFor({ timeout: 10000 }).catch(() => {});
        await shot(page, "4-capabilities");
        check(await create.isVisible().catch(() => false), "the account validates; Accounts offers Create Account");
        await create.click();
        await page.waitForTimeout(1500);
        const account = (await luna(page, "palm://com.palm.service.accounts/listAccounts", { templateId: "com.webosphoenix.dav" })).results[0];
        if (!check(account && account.username === dav.user && account.capabilityProviders.length === 2,
                   "the account exists with Contacts and Calendar")) throw new Error("no account");
        await shot(page, "5-accounts");

        // The first sync (onCreate, onEnabled) runs in the Accounts page.
        let contacts = [];
        for (let t = 0; t < 20000; t += 500) {
            contacts = await db(page, "com.palm.contact.dav:1");
            const events = await db(page, "com.palm.calendarevent.dav:1");
            if (contacts.length && events.length >= 2) break;
            await page.waitForTimeout(500);
        }
        await syncNow(page, account._id);   // settle: waits for the first sync's lock

        // ---- 2. db8 agrees with the server ------------------------------------------------
        contacts = await db(page, "com.palm.contact.dav:1");
        const wren = contacts.find((c) => c.name.givenName === "Wren");
        check(contacts.length === 2 && wren && wren.phoneNumbers[0].value === "(415) 555-0133" && wren.accountId === account._id,
              "the server's contact is in db8 (com.palm.contact.dav:1)");
        const persons = (await db(page, "com.palm.person:1")).filter((p) => (p.contactIds || []).includes(wren && wren._id));
        check(persons.length === 1 && persons[0].sortKey === "castillo\twren", "the contacts linker step made a person for it");
        const priya = contacts.find((c) => c.name.givenName === "Priya");
        const priyaPerson = (await db(page, "com.palm.person:1")).find((p) => (p.contactIds || []).includes(priya && priya._id));
        check(!!priyaPerson && priyaPerson.contactIds.length === 2 && priyaPerson.contactIds.includes("phoenix-sample-contact-2"),
              "a contact with the email of an existing person is linked to that person");
        const cals = await db(page, "com.palm.calendar.dav:1");
        check(cals.length === 1 && cals[0].name === "Personal", "the server's calendar is a com.palm.calendar.dav:1");
        let events = await db(page, "com.palm.calendarevent.dav:1");
        const run = events.find((e) => e.subject === "Morning run (DAV)");
        check(events.length === 2 && run && run.rrule && run.rrule.freq === "DAILY" && run.rrule.count === 5 && run.calendarId === cals[0]._id,
              "both events are in db8, the recurring one with its rule");

        const contactsPage = await context.newPage();
        await contactsPage.goto(appUrl("com.palm.app.contacts"));
        await contactsPage.waitForTimeout(4000);
        check(/Wren Castillo/.test(await contactsPage.evaluate(() => document.body.innerText)), "Contacts lists Wren Castillo");
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
        check(/Design review \(DAV\)/.test(await calWin.evaluate(() => document.body.innerText)), "Calendar shows today's synced event");
        await shot(calWin, "7-calendar");
        for (const p of context.pages()) if (p !== page) await p.close();

        // ---- 3. Device changes go to the server ------------------------------------------
        await luna(page, "palm://com.palm.db/merge", { objects: [{ _id: wren._id, note: "Changed on the phone" }] });
        await luna(page, "palm://com.palm.db/put", { objects: [{ _kind: "com.palm.contact.dav:1", accountId: account._id,
            name: { givenName: "Carol", familyName: "Nguyen" }, phoneNumbers: [{ value: "(212) 555-0126", type: "type_mobile" }] }] });
        const start = day(2, 12);
        await luna(page, "palm://com.palm.db/put", { objects: [{ _kind: "com.palm.calendarevent.dav:1", accountId: account._id,
            calendarId: cals[0]._id, subject: "Lunch (from the phone)", dtstart: start.getTime(), dtend: start.getTime() + 3600000,
            allDay: false, tzId: Intl.DateTimeFormat().resolvedOptions().timeZone,
            alarm: [{ action: "display", alarmTrigger: { value: "-PT15M", valueType: "DURATION" } }] }] });
        const review = events.find((e) => e.subject === "Design review (DAV)");
        await luna(page, "palm://com.palm.db/del", { ids: [review._id] });
        await syncNow(page, account._id);

        const wrenServer = vcard.toContact((await dav.get("/alice/contacts/wren-1.vcf")).body);
        check(wrenServer.contact.note === "Changed on the phone", "an edited contact is uploaded (If-Match)");
        check(/CATEGORIES:Friends/.test((await dav.get("/alice/contacts/wren-1.vcf")).body), "fields the phone does not show survive");
        const cardFiles = await dav.list("/alice/contacts/");
        const carolFile = cardFiles.find((f) => !/wren-1|priya-1/.test(f));
        check(cardFiles.length === 3 && carolFile && vcard.toContact((await dav.get(carolFile)).body).contact.name.givenName === "Carol",
              "a new contact is uploaded (If-None-Match: *)");
        const calFiles = await dav.list("/alice/calendar/");
        check(!calFiles.includes("/alice/calendar/review-1.ics"), "a deleted event is deleted on the server");
        const lunchFile = calFiles.find((f) => !/run-1|review-1/.test(f));
        const lunch = lunchFile && ical.toEvents((await dav.get(lunchFile)).body).master;
        check(!!lunch && lunch.subject === "Lunch (from the phone)" && lunch.dtstart === start.getTime() &&
              lunch.alarm && lunch.alarm[0].alarmTrigger.value === "-PT15M", "a new event is uploaded with its time and alarm");

        // ---- 4. Server changes come to the device -----------------------------------------
        await dav.put("/alice/contacts/wren-1.vcf", VCARD_WREN.replace("NOTE:Met at the conference", "NOTE:Changed on the server"));
        await dav.del("/alice/calendar/run-1.ics");
        await dav.put("/alice/contacts/dan-1.vcf", VCARD_WREN.replace(/wren-1/g, "dan-1").replace("N:Castillo;Wren", "N:Ito;Dan")
            .replace("FN:Wren Castillo", "FN:Dan Ito").replace("(415) 555-0133", "(650) 555-0146").replace("wren@", "dan@"));
        await syncNow(page, account._id);
        contacts = await db(page, "com.palm.contact.dav:1");
        check(contacts.find((c) => c.name.givenName === "Wren").note === "Changed on the server", "a server edit reaches db8");
        check(contacts.some((c) => c.name.givenName === "Dan"), "a new server contact reaches db8");
        events = await db(page, "com.palm.calendarevent.dav:1");
        check(!events.some((e) => e.subject === "Morning run (DAV)"), "an event deleted on the server is deleted in db8");
        check(events.some((e) => e.subject === "Lunch (from the phone)"), "the phone's event is still there");

        // Server and db8 agree: every server resource has one db8 object and vice versa.
        const names = contacts.map((c) => c.name.givenName).sort();
        const serverNames = [];
        for (const f of await dav.list("/alice/contacts/")) serverNames.push(vcard.toContact((await dav.get(f)).body).contact.name.givenName);
        check(JSON.stringify(names) === JSON.stringify(serverNames.sort()), "db8 and the server have the same contacts (" + names.join(", ") + ")");
        const subjects = events.map((e) => e.subject).sort();
        const serverSubjects = [];
        for (const f of await dav.list("/alice/calendar/")) serverSubjects.push(ical.toEvents((await dav.get(f)).body).master.subject);
        check(JSON.stringify(subjects) === JSON.stringify(serverSubjects.sort()), "db8 and the server have the same events (" + subjects.join(", ") + ")");
        const status = await page.evaluate(() => {
            const objects = Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.tempdb/obj/"))
                .map((x) => JSON.parse(localStorage.getItem(x)));
            return objects.filter((o) => !o._del && o._kind === "com.palm.account.syncstate:1").map((o) => o.syncState);
        });
        check(status.length === 2 && status.every((s) => s === "IDLE"), "sync status in tempdb: IDLE for both capabilities");

        // ---- 5. Delete the account -----------------------------------------------------------
        const del = await luna(page, "palm://com.palm.service.accounts/deleteAccount", { accountId: account._id });
        check(del.returnValue, "deleteAccount");
        check((await db(page, "com.palm.contact.dav:1")).length === 0 && (await db(page, "com.palm.calendarevent.dav:1")).length === 0 &&
              (await db(page, "com.palm.calendar.dav:1")).length === 0, "its contacts, calendar and events are gone");
        const left = await db(page, "com.palm.person:1");
        check(!left.some((p) => /Castillo|Ito|Nguyen/.test(JSON.stringify(p.names))), "and so are their persons");
        const priyaLeft = left.find((p) => (p.contactIds || []).includes("phoenix-sample-contact-2"));
        check(!!priyaLeft && priyaLeft.contactIds.length === 1, "the linked person keeps only its local contact");
        check((await dav.list("/alice/contacts/")).length === 4, "the server keeps its data");

        check(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        dav.stop();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "all checks passed"}; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main();
