#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The buttons that open another app, tapped in the real apps in headless
// Chromium against the runtime, and what the app they open then shows
// (docs/LAUNCH-CONTRACTS.md; tools/check-launch-contracts.cjs checks the
// keys statically):
//
//   contacts  the original Contacts' card: the message button beside a
//             number opens Messaging on a new message to it with the
//             person's name, or on the conversation with that number when
//             there is one; the number itself calls it in Phone; the e-mail
//             address writes to it in Email; the address shows it in Maps
//   justtype  Just Type's contact result: its number calls, its message
//             button texts (luna-applauncher ContactSearch.js, AppLauncher.js)
//   calendar  an event's location opens Maps on it
//   messages  a number and a web address in a message are links: the number
//             opens Phone
//   files     an audio file opened with Music plays
//   alerts    luna-systemui's "Phone Preferences" opens Settings' Phone page
//
// Each launch is the "launch" the runtime hands the shell; the app it names
// is then opened with those params, as the shell would.
//
//   node tools/test-launch-contracts.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "launch-contract-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);
const APPS = `http://127.0.0.1:${port}/usr/palm/applications`;
const appUrl = (id, params) => `${APPS}/${id}/index.html` + (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

async function main() {
    for (const app of ["phone", "messaging", "maps", "music"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { if ((await drained(fetch(`http://127.0.0.1:${port}/apps.json`))).ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        // Every page's host messages (the windows an app opens too).
        const host = [], errors = [];
        const watch = (page) => {
            page.on("pageerror", (e) => errors.push(`${page.url().replace(/^.*applications\//, "")}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            });
        };
        context.on("page", watch);
        const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        // The launch the runtime asked the shell for, once it comes.
        const launched = async (page, pred, ms = 5000) => {
            for (let t = 0; t < ms; t += 100) {
                const m = host.find((x) => x.type === "launch" && pred(x.payload));
                if (m) return m.payload;
                await page.waitForTimeout(100);
            }
            return null;
        };
        // The app a launch names, opened with its params as the shell would.
        const openLaunched = async (l, setup) => {
            const p = await context.newPage();
            if (setup) await setup(p);
            await p.goto(appUrl(l.id, l.params));
            return p;
        };

        // ---- Contacts' card ----------------------------------------------------------------------
        const ct = await context.newPage();
        await ct.goto(appUrl("com.palm.app.contacts"));
        await ct.evaluate(() => localStorage.clear());
        await ct.goto(appUrl("com.palm.app.contacts"));
        await ct.getByText("Marcus Chen").first().waitFor({ timeout: 30000 });
        const openPerson = async (search, name) => {
            // On a phone the details replace the list: Back to it first.
            if (!(await ct.locator("input:visible").count())) {
                await ct.evaluate(() => __phoenixRuntime.back());
                await ct.waitForTimeout(500);
            }
            const field = ct.locator("input:visible").first();
            await field.click();
            await field.fill("");
            await ct.keyboard.type(search);
            await ct.getByText(name).first().click({ timeout: 20000 });
            await ct.getByText(name).nth(1).waitFor({ timeout: 10000 }).catch(() => {});
            await ct.waitForTimeout(800);
        };
        // The message button beside a number (btn_sms.png, phoneGetActionIcon).
        const tapMessageButton = async (number) => {
            const box = await ct.evaluate((n) => {
                const rows = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent.trim() === n
                                                                         && e.getBoundingClientRect().width > 0);
                const row = rows[rows.length - 1];
                if (!row) return null;
                // Up to the field's row, then its action icon.
                let r = row;
                for (let i = 0; i < 6 && r; i++, r = r.parentElement) {
                    const icon = [...r.querySelectorAll("*")].find((e) => /btn_sms/.test(getComputedStyle(e).backgroundImage) ||
                                                                     /btn_sms/.test(e.getAttribute("src") || ""));
                    if (icon) {
                        icon.scrollIntoView({ block: "center" });
                        const b = icon.getBoundingClientRect();
                        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
                    }
                }
                return null;
            }, number);
            if (!box) return false;
            await ct.mouse.click(box.x, box.y);
            return true;
        };

        await openPerson("Rivera", "Alex Rivera");
        await shot(ct, "contacts-card");
        host.length = 0;
        check(await tapMessageButton("(408) 555-0144"), "contacts: the card has a message button beside the mobile number");
        let l = await launched(ct, (p) => p.id === "org.webosphoenix.messaging");
        check(!!l && l.params.compose && l.params.compose.phoneNumbers[0].value === "(408) 555-0144" && !!l.params.compose.personId,
              `contacts: the message button opens Messaging ({compose: {personId, phoneNumbers}}): ${JSON.stringify(l && l.params)}`);
        if (l) {
            const msg = await openLaunched(l);
            await msg.waitForSelector("[data-testid='recipient-chip']", { timeout: 15000 }).catch(() => {});
            const chip = await msg.textContent("[data-testid='recipient-chip']").catch(() => "");
            check(/Alex Rivera/.test(chip), `Messaging: a new message to Alex Rivera: "${chip}"`);
            const inputFocused = await msg.evaluate(() => document.activeElement && /textarea|input/i.test(document.activeElement.tagName));
            check(inputFocused, "Messaging: ready to type the message");
            await shot(msg, "messaging-compose-from-contacts");
            await msg.close();
        }

        await openPerson("Okafor", "Lena Okafor");
        host.length = 0;
        check(await tapMessageButton("(212) 555-0164"), "contacts: Lena Okafor's card has a message button");
        l = await launched(ct, (p) => p.id === "org.webosphoenix.messaging");
        if (check(!!l, "contacts: it opens Messaging")) {
            const msg = await openLaunched(l);
            await msg.waitForSelector("[data-testid='thread-title']", { timeout: 15000 }).catch(() => {});
            const title = await msg.textContent("[data-testid='thread-title']").catch(() => "");
            check(/Lena Okafor/.test(title), `Messaging: the conversation with Lena Okafor (there is one): "${title}"`);
            check(/Landing at 6/.test(await msg.evaluate(() => document.body.innerText)), "Messaging: with its messages");
            await shot(msg, "messaging-thread-from-contacts");
            await msg.close();
        }

        await openPerson("Rivera", "Alex Rivera");
        host.length = 0;
        await ct.getByText("(408) 555-0144").last().click();
        l = await launched(ct, (p) => p.id === "org.webosphoenix.phone");
        check(!!l && l.params.address === "(408) 555-0144" && l.params.transport === "com.palm.telephony",
              `contacts: the number opens Phone ({address, transport}): ${JSON.stringify(l && l.params)}`);
        if (l) {
            const ph = await openLaunched(l);
            await ph.waitForSelector("[data-testid='incall']", { timeout: 15000 }).catch(() => {});
            const state = await ph.getAttribute("[data-testid='incall']", "data-state").catch(() => null);
            const body = await ph.evaluate(() => document.body.innerText);
            check(!!state && /Alex Rivera|555-0144/.test(body), `Phone: calls Alex Rivera at once, as a tapped number did on webOS (${state})`);
            await shot(ph, "phone-call-from-contacts");
            // Hang up.
            await ph.click("[data-testid='end-call']").catch(() => {});
            await ph.waitForTimeout(500);
            await ph.close();
        }

        host.length = 0;
        await ct.getByText("alex.rivera@example.com").last().click();
        l = await launched(ct, (p) => p.id === "com.palm.app.email");
        check(!!l && l.params.target === "mailto:alex.rivera@example.com", `contacts: the e-mail address opens Email to it: ${JSON.stringify(l && l.params)}`);

        host.length = 0;
        await ct.getByText("100 Market Street").last().click();
        l = await launched(ct, (p) => p.id === "org.webosphoenix.maps");
        check(!!l && /100 Market Street/.test(l.params.address || ""), `contacts: the address opens Maps on it: ${JSON.stringify(l && l.params)}`);
        if (l) {
            const mp = await openLaunched(l);
            await mp.waitForSelector("[data-testid='search']", { timeout: 15000 }).catch(() => {});
            await mp.waitForTimeout(1000);
            const q = await mp.inputValue("[data-testid='search']").catch(() => "");
            check(/100 Market Street/.test(q), `Maps: looks the address up: "${q}"`);
            await shot(mp, "maps-from-contacts");
            await mp.close();
        }

        // ---- Just Type's contact result ----------------------------------------------------------
        const jt = await context.newPage();
        await jt.goto(appUrl("com.palm.launcher"));
        await jt.waitForTimeout(2500);
        await jt.evaluate(() => { const j = enyo.$.justTypeApp.$.justType; j.clearSearchText(); j.forceFocus(); });
        await jt.keyboard.type("rivera", { delay: 40 });
        await jt.waitForTimeout(1500);
        await jt.getByText("Alex Rivera").first().click().catch(() => {});
        await jt.waitForTimeout(800);
        await shot(jt, "justtype-contact");
        host.length = 0;
        await jt.getByText("(408) 555-0144").first().click().catch(() => {});
        l = await launched(jt, (p) => p.id === "org.webosphoenix.phone");
        check(!!l && l.params.address === "(408) 555-0144", `Just Type: a contact's number calls it in Phone: ${JSON.stringify(l && l.params)}`);
        if (l) {
            const ph = await openLaunched(l);
            await ph.waitForSelector("[data-testid='incall']", { timeout: 15000 }).catch(() => {});
            check(!!(await ph.$("[data-testid='incall']")), "Phone: the call is placed");
            await ph.click("[data-testid='end-call']").catch(() => {});
            await ph.waitForTimeout(300);
            await ph.close();
        }
        host.length = 0;
        const smsIcon = jt.locator(".im-image:visible").first();
        if (await smsIcon.count()) await smsIcon.click().catch(() => {});
        l = await launched(jt, (p) => p.id === "org.webosphoenix.messaging", 2000);
        check(!!l && l.params.compose && l.params.compose.phoneNumbers[0].value === "(408) 555-0144",
              `Just Type: a contact's message button texts the number: ${JSON.stringify(l && l.params)}`);
        if (l) {
            const msg = await openLaunched(l);
            await msg.waitForSelector("[data-testid='recipient-chip']", { timeout: 15000 }).catch(() => {});
            check(/Alex Rivera/.test(await msg.textContent("[data-testid='recipient-chip']").catch(() => "")), "Messaging: to Alex Rivera");
            await msg.close();
        }
        await jt.close();

        // ---- Calendar: an event's location ---------------------------------------------------------
        const evId = await ct.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => {
                const r = JSON.parse(s);
                res(((r.results || []).find((e) => /Lunch with Priya/.test(e.subject || "")) || {})._id || null);
            };
            b.call("luna://com.palm.db/find", JSON.stringify({ query: { from: "com.palm.calendarevent:1" } }));
        }));
        check(!!evId, "calendar: the sample event \"Lunch with Priya\" is there");
        if (evId) {
            host.length = 0;
            const cal = await context.newPage();
            await cal.goto(appUrl("com.palm.app.calendar", { showEventDetail: evId }));
            let win = null;
            for (let i = 0; i < 200 && !win; ++i) {
                win = context.pages().find((p) => p !== cal && /com\.palm\.app\.calendar/.test(p.url()) &&
                                            !/launchParams/.test(p.url())) || null;
                if (win && !(await win.evaluate(() => /Bistro Verde/.test(document.body.innerText)).catch(() => false))) win = null;
                if (!win) await cal.waitForTimeout(100);
            }
            if (check(!!win, "calendar: the event's details show its location")) {
                await win.getByText("Bistro Verde").last().click();
                l = await launched(win, (p) => p.id === "org.webosphoenix.maps");
                check(!!l && l.params.address === "Bistro Verde", `calendar: the location opens Maps on it: ${JSON.stringify(l && l.params)}`);
                await shot(win, "calendar-event");
            }
            // Calendar stays open: closing its window with the event's details
            // open throws in the original's teardown (AppView.js:356
            // resetMenu after its pane is gone), nothing to do with launches.
        }

        // ---- A number in a message -------------------------------------------------------------------
        const msg = await context.newPage();
        await msg.goto(appUrl("org.webosphoenix.messaging"));
        const threadId = await msg.evaluate(() => window.__phoenixRuntime.simulateIncomingSms({
            from: "(212) 555-0164", text: "Call me at (408) 555-0142 or see www.example.com" }));
        await msg.goto(appUrl("org.webosphoenix.messaging", { threadId }));
        await msg.waitForSelector(".bubble-text a[href^='tel:']", { timeout: 15000 }).catch(() => {});
        const links = await msg.$$eval(".bubble-text a", (as) => as.map((a) => a.getAttribute("href")));
        check(links.includes("tel:4085550142") && links.some((h) => /^http:\/\/www\.example\.com/.test(h)),
              `messages: a number and a web address in a message are links: ${JSON.stringify(links)}`);
        await shot(msg, "messaging-links");
        host.length = 0;
        await msg.click(".bubble-text a[href^='tel:']").catch(() => {});
        l = await launched(msg, (p) => p.id === "org.webosphoenix.phone");
        check(!!l && l.params.target === "tel:4085550142", `messages: the number opens Phone with it: ${JSON.stringify(l && l.params)}`);
        if (l) {
            const ph = await openLaunched(l);
            await ph.waitForSelector("[data-testid='number-display']", { timeout: 15000 }).catch(() => {});
            check(/555-0142/.test(await ph.textContent("[data-testid='number-display']").catch(() => "")), "Phone: the number on the dial pad");
            await ph.close();
        }

        // ---- An audio file opened with Music ---------------------------------------------------------
        // Files' "Open" and Email's attachments hand the file over as {target}.
        let songs = [];
        for (let i = 0; i < 50 && !songs.length; i++) {
            songs = await msg.evaluate(() => new Promise((res) => {
                const b = new PalmServiceBridge();
                b.onservicecallback = (s) => res((JSON.parse(s).audioList || {}).results || []);
                b.call("luna://com.webos.service.mediaindexer/getAudioList", "{}");
            }));
            if (!songs.length) await msg.waitForTimeout(200);
        }
        const song = songs.find((s) => s.file_path);
        if (check(!!song, `files: the sample music is indexed (${songs.length} songs)`)) {
            const mu = await openLaunched({ id: "org.webosphoenix.music", params: { target: song.file_path } });
            const playing = await mu.waitForSelector("[data-testid='now-playing']", { timeout: 15000 }).then(() => true, () => false);
            check(playing, `Music: an audio file opened with it plays (${song.file_path})`);
            await shot(mu, "music-target");
            await mu.close();
        }

        // ---- luna-systemui's "Phone Preferences" ------------------------------------------------------
        host.length = 0;
        await msg.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = () => res();
            b.call("palm://com.palm.applicationManager/open", JSON.stringify({ id: "com.palm.app.phone", params: { preferences: true } }));
        }));
        l = await launched(msg, () => true);
        check(!!l && l.id === "org.webosphoenix.settings" && l.params.page === "phone",
              `alerts: com.palm.app.phone {preferences: true} opens Settings' Phone page: ${JSON.stringify(l)}`);

        const relevant = errors.filter((e) => !/tellurium|Failed to load resource|ResizeObserver/.test(e));
        check(relevant.length === 0, "no page errors" + (relevant.length ? ": " + relevant.slice(0, 5).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall launch contract checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
