#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An alarm going off in the original Clock (com.palm.app.clock), in headless
// Chromium with the simulator's runtime:
//
//   1. an alarm is due; its activity (the one the Clock schedules,
//      utility/activitymanager.js) fires while the Clock is running;
//   2. the Clock is relaunched in place (Mojo.relaunch, as LunaSysMgr did)
//      and rings: it opens its alarm popup alert (enyo.windows.openPopup),
//      tagged for the shell with its type, height and window name;
//   3. Dismiss closes the alert.
//
// And the system sounds the alarm and the ringtone picker draw on: Open
// webOS's /usr/palm/sounds are served, the ringtone list starts with them;
// the Clock's default alarm, Flurry.mp3, and Email's emailreceived.mp3 are
// Phoenix's own (tools/make-feedback-sounds.py; the originals were never
// released or cannot be shipped, docs/LEGAL.md), and they play.
//
//   node tools/test-alarm.cjs [--out DIR]

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
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "alarm-tests");
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const clock = `${origin}/usr/palm/applications/com.palm.app.clock/index.html`;
const KEY = "clockAlarmTest";

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
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
        const context = await browser.newContext({ viewport: { width: 320, height: 452 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));

        await page.goto(clock);
        await page.waitForFunction(() => window.enyo && enyo.application && enyo.application.utilities, null, { timeout: 15000 });

        // An alarm a minute from now, and the activity the Clock schedules
        // for it (ActivityManager.setAlarmTimeout), with the Clock's default
        // sound (alarmdbmanager.js:100): Phoenix's Flurry.mp3 on the drive.
        const FLURRY = "/media/internal/ringtones/Flurry.mp3";
        const EMAIL = "/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3";
        for (const [p, want] of [["/usr/palm/sounds/ringtone.mp3", 200], ["/usr/palm/sounds/alert.wav", 200],
                                 ["/usr/share/phoenix/sounds/feedback/key.wav", 200],
                                 ["/usr/share/phoenix/sounds/feedback/birdappclose.wav", 200],
                                 [FLURRY, 200], [EMAIL, 200]]) {
            const r = await fetch(origin + p);
            check(r.status === want, `${p}: ${r.status}`);
        }
        // Email's is Phoenix's own, not the original (whose ID3 tags name
        // another copyright holder): no tags at all.
        const mail = Buffer.from(await (await fetch(origin + EMAIL)).arrayBuffer());
        check(mail.slice(0, 3).toString() !== "ID3" && !mail.includes(Buffer.from("Steinbach")), "emailreceived.mp3 is Phoenix's (no ID3 tags)");
        const tones = await page.evaluate(() => new Promise((resolve) => __phoenixRuntime.dispatch(
            "luna://com.webos.service.systemservice/ringtone/listRingtones", {}, resolve, { cancelled: () => false })));
        check(tones.ringtones.slice(0, 2).map((t) => t.fullPath).join() === "/usr/palm/sounds/ringtone.mp3,/usr/palm/sounds/phone.wav",
              "the ringtones start with Open webOS's ringtone.mp3 and phone.wav");
        check(tones.ringtones.some((t) => t.fullPath === FLURRY && t.name === "Flurry"), "the user's ringtones have Flurry");
        // Both decode and play in the page (Chromium's MP3 decoder).
        const played = await page.evaluate((files) => Promise.all(files.map((f) => new Promise((resolve) => {
            const a = new Audio(f);
            a.muted = true;
            a.addEventListener("playing", () => { a.pause(); resolve(a.duration); }, { once: true });
            a.addEventListener("error", () => resolve(-1), { once: true });
            a.play().catch(() => resolve(-2));
        }))), [FLURRY, EMAIL]);
        check(played[0] > 6 && played[0] < 7, `Flurry.mp3 plays (${played[0]} s)`);
        check(played[1] > 1 && played[1] < 1.5, `emailreceived.mp3 plays (${played[1]} s)`);
        const due = await page.evaluate(([key, flurry]) => new Promise((resolve) => {
            const at = new Date(Date.now() + 60000);
            at.setSeconds(0, 0);
            const call = (url, params) => new Promise((r) => __phoenixRuntime.dispatch(url, params, r, { cancelled: () => false }));
            const when = enyo.application.utilities.getActivityDateString(at);
            call("palm://com.palm.db/put", { objects: [{ _kind: "com.palm.clock.alarm:1", key, title: "Wake up",
                occurs: "daily", hour: at.getHours(), minute: at.getMinutes(), niceTime: "", niceDay: "--", enabled: true,
                alarmSoundFile: flurry, alarmSoundTitle: "Flurry", snoozed: false, hideSnoozeTime: false }] })
                .then(() => call("palm://com.palm.activitymanager/create", { start: true, replace: true, activity: {
                    name: key, description: "com.palm.app.clock alarm: Wake up", type: { foreground: true, persist: true },
                    callback: { method: "palm://com.palm.applicationManager/launch",
                                params: { id: "com.palm.app.clock", params: { action: "ring", key, setTime: when } } },
                    schedule: { start: when, local: true } } }))
                .then(() => resolve(at.getTime()));
        }), [KEY, FLURRY]);

        // Time passes: the activity fires on the Clock's own page.
        const popupPromise = context.waitForEvent("page", { timeout: 15000 });
        const fired = await page.evaluate((at) => __phoenixRuntime.activities.fireDue(at + 1000), due);
        check(fired === 1, "the alarm's activity fires");
        const popup = await popupPromise;
        await popup.waitForLoadState();
        const url = popup.url();
        check(/dashAlarm\.html/.test(url), "the Clock rings: its alarm window opens");
        check(/phoenixWindow=popupalert/.test(url) && /phoenixHeight=110/.test(url), "as a 110 px popup alert");
        check(url.includes("phoenixName=" + encodeURIComponent("com.palm.app.clock.alarm." + KEY)),
              "named for the alarm, so the shell ranks it (notificationPolicy.conf \"ring\")");
        await popup.setViewportSize({ width: 320, height: 110 });
        await popup.waitForFunction(() => /Wake up/.test(document.body.innerText), null, { timeout: 10000 });
        const text = (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        check(/Wake up/.test(text) && /Snooze/.test(text) && /Dismiss/.test(text), `it shows the alarm with Snooze and Dismiss (${text.trim()})`);
        await popup.screenshot({ path: path.join(outDir, "alarm.png") });

        const closed = popup.waitForEvent("close", { timeout: 10000 }).then(() => true, () => false);
        await popup.getByText("Dismiss", { exact: true }).click();
        check(await closed, "Dismiss closes the alert");
        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
