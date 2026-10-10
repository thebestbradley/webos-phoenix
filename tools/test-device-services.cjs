#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// LunaSysMgr's device services (com.palm.display, com.palm.keys) as the
// original Clock (com.palm.app.clock) uses them when an alarm goes off, in
// headless Chromium with the simulator's runtime, the test playing the
// shell (what phoenix-sim's DeviceServices and SimWindowSource do):
//
//   1. the ringer switch, as the Clock reads it before it rings (com.palm.audio
//      system/status "ringer switch", from com.palm.keys' switch);
//   2. an alarm rings: its popup alert opens and the Clock holds the display
//      on (com.palm.display/control/setProperty {requestBlock, client},
//      utility/displaymanager.js), which reaches the shell as a hold;
//   3. a volume key (com.palm.keys/audio) snoozes it: the popup closes and
//      the hold ends (the Clock cancels its call);
//   4. it rings again after the snooze; Power (com.palm.keys/switches
//      "power") snoozes it too (utility/keymanager.js, alarm.js:304-308);
//   5. com.palm.display/status follows the shell's display, as apps see it.
//
//   node tools/test-device-services.cjs [--out DIR]

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// A response read to its end: one left unread, its socket closed under it,
// aborts Node's fetch (undici: assert(!this.paused), seen in CI).
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
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "device-services-tests");
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const clock = `${origin}/usr/palm/applications/com.palm.app.clock/index.html`;
const KEY = "deviceServicesAlarm";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

// Each page's messages for the shell, kept where the test can read them
// (the runtime uses a phoenixHost that is already there).
function captureHost() {
    window.__hostLog = [];
    window.phoenixHost = { postToHost: (type, payload) => window.__hostLog.push({ type, payload: payload || {} }) };
}

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
        const context = await browser.newContext({ viewport: { width: 320, height: 452 } });
        await context.addInitScript(captureHost);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        // The shell tells every page (SimWindowSource.deviceEvent).
        const shell = async (ev) => {
            for (const p of context.pages())
                await p.evaluate((e) => window.__phoenixRuntime && __phoenixRuntime.devices.hostEvent(e), ev).catch(() => {});
        };
        const holds = () => page.evaluate(() => window.__hostLog.filter((m) => m.type === "displayHolds").map((m) => m.payload));

        await page.goto(clock);
        await page.waitForFunction(() => window.enyo && enyo.application && enyo.application.utilities, null, { timeout: 15000 });
        const call = (url, params) => page.evaluate(([u, p]) => new Promise((resolve) => __phoenixRuntime.dispatch(u, p, resolve,
            { cancelled: () => false })), [url, params]);

        // 1. The ringer switch.
        check((await call("palm://com.palm.audio/system/status", {}))["ringer switch"] === true, "the ringer is on to start with");
        await shell({ key: { category: "/switches", key: "ringer", state: "down" } });
        check((await call("palm://com.palm.audio/system/status", {}))["ringer switch"] === false, "the switch silenced: the Clock hears it off");
        check((await call("palm://com.palm.keys/switches/status", { get: "ringer" })).state === "down", "com.palm.keys says the ringer is down");
        await shell({ key: { category: "/switches", key: "ringer", state: "up" } });

        // 2. An alarm a minute from now, its activity, and time passing (as tools/test-alarm.cjs).
        const alarmDue = (key) => page.evaluate((k) => new Promise((resolve) => {
            const at = new Date(Date.now() + 60000);
            at.setSeconds(0, 0);
            const c = (url, params) => new Promise((r) => __phoenixRuntime.dispatch(url, params, r, { cancelled: () => false }));
            const when = enyo.application.utilities.getActivityDateString(at);
            c("palm://com.palm.db/put", { objects: [{ _kind: "com.palm.clock.alarm:1", key: k, title: "Wake up",
                occurs: "daily", hour: at.getHours(), minute: at.getMinutes(), niceTime: "", niceDay: "--", enabled: true,
                alarmSoundFile: "/usr/palm/sounds/alert.wav", alarmSoundTitle: "Alert", snoozed: false, hideSnoozeTime: false }] })
                .then(() => c("palm://com.palm.activitymanager/create", { start: true, replace: true, activity: {
                    name: k, description: "com.palm.app.clock alarm: Wake up", type: { foreground: true, persist: true },
                    callback: { method: "palm://com.palm.applicationManager/launch",
                                params: { id: "com.palm.app.clock", params: { action: "ring", key: k, setTime: when } } },
                    schedule: { start: when, local: true } } }))
                .then(() => resolve(at.getTime()));
        }), key);
        const due = await alarmDue(KEY);

        async function ring(at, what) {
            const popupPromise = context.waitForEvent("page", { timeout: 15000 });
            const fired = await page.evaluate((t) => __phoenixRuntime.activities.fireDue(t), at);
            check(fired >= 1, `${what}: the alarm's activity fires`);
            const popup = await popupPromise;
            await popup.waitForLoadState();
            await popup.setViewportSize({ width: 320, height: 110 });
            await popup.waitForFunction(() => /Wake up/.test(document.body.innerText), null, { timeout: 10000 });
            return popup;
        }

        let popup = await ring(due + 1000, "first ring");
        await page.waitForFunction(() => window.__hostLog.some((m) => m.type === "displayHolds" && m.payload.requestBlock === 1),
                                   null, { timeout: 5000 }).catch(() => {});
        const held = (await holds()).at(-1) || {};
        check(held.requestBlock === 1 && (held.clients || []).includes("com.palm.app.clock"),
              "ringing, the Clock holds the display on (requestBlock, client com.palm.app.clock)");
        await popup.screenshot({ path: path.join(outDir, "alarm-ringing.png") });
        // The shell adds the holds up and says so; the Clock's page can read it.
        await shell({ holds: { requestBlock: 1 }, display: { state: "on", blockDisplay: true, timeout: 60 } });
        check((await call("palm://com.palm.display/control/getProperty", { properties: ["requestBlock"] })).requestBlock === true,
              "getProperty requestBlock: the display is held");

        // 3. A volume key snoozes it.
        let closed = popup.waitForEvent("close", { timeout: 10000 }).then(() => true, () => false);
        await shell({ key: { category: "/audio", key: "volume_down", state: "down" } });
        await shell({ key: { category: "/audio", key: "volume_down", state: "up" } });
        check(await closed, "Volume Down snoozes the alarm: its alert closes");
        await page.waitForFunction(() => {
            const h = window.__hostLog.filter((m) => m.type === "displayHolds");
            return h.length && h[h.length - 1].payload.requestBlock === 0;
        }, null, { timeout: 5000 }).catch(() => {});
        check(((await holds()).at(-1) || {}).requestBlock === 0, "snoozed, the Clock lets the display go");
        await shell({ holds: { requestBlock: 0 }, display: { state: "on", blockDisplay: false } });

        // 4. Snoozed, it is due again in ten minutes (the Clock's next activity).
        const next = await call("palm://com.palm.activitymanager/getDetails", { activityName: KEY });
        const firstWhen = await page.evaluate((t) => enyo.application.utilities.getActivityDateString(new Date(t)), due);
        check(next.activity && next.activity.state === "waiting" && next.activity.schedule
              && next.activity.schedule.start > firstWhen, `snoozed, the Clock schedules the alarm again (${next.activity && next.activity.schedule && next.activity.schedule.start})`);
        // Another alarm rings; Power snoozes it too.
        popup = await ring((await alarmDue(KEY + "2")) + 1000, "a second alarm");
        closed = popup.waitForEvent("close", { timeout: 10000 }).then(() => true, () => false);
        await shell({ key: { category: "/switches", key: "power", state: "down" } });
        check(await closed, "Power snoozes it too");

        // 5. The display as apps see it, from the shell.
        const statuses = await page.evaluate(() => new Promise((resolve) => {
            const seen = [];
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => seen.push(JSON.parse(j));
            b.call("palm://com.palm.display/status", JSON.stringify({ subscribe: true }));
            setTimeout(() => {
                __phoenixRuntime.devices.hostEvent({ display: { state: "dim" } });
                __phoenixRuntime.devices.hostEvent({ display: { state: "off", active: false } });
                setTimeout(() => { b.cancel(); resolve(seen); }, 50);
            }, 50);
        }));
        check(statuses.map((s) => s.event).join() === "request,displayDimmed,displayOff",
              "com.palm.display/status: the shell dims, then turns off the display");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
