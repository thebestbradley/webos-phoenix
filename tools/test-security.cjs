#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system services behind the lock screen's security policy, Full Erase,
// USB drive mode and the debugging overlays, in headless Chromium against
// runtime/phoenix-runtime.js (the Settings page hosts it):
//   - com.palm.systemmanager getSecurityPolicy / getDeviceLockMode with an
//     EAS policy in db8 (com.palm.securitypolicy:1): pending until a passcode
//     the policy takes is set (the original's checks and errors), then
//     active; wrong passcodes cost tries, the last wipes the device
//     (com.palm.storage/erase/Wipe); without a policy, three wrong ones
//     hold the next off for 15 s
//   - com.palm.storage erase/EraseAll, diskmode/hostIsConnected and enterMSM,
//     and the /storaged signals reaching com.palm.bus/signal/addmatch
//   - enableFpsCounter, enableTouchPlot, getDebugOverlays,
//     runProgressAnimation, subscribeTurboMode
//   - Settings > Developer Mode's Debugging switches
//
//   node tools/test-security.cjs [--out DIR]
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
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "security-tests");
const port = 8500 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const pageUrl = (p) => `${origin}/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=${encodeURIComponent(JSON.stringify({ page: p }))}`;
const SM = "luna://com.palm.systemmanager/";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
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
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    let browser;
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        browser = await chromium.launch();
        const page = await (await browser.newContext({ viewport: { width: 320, height: 452 } })).newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        // One reply.
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            __phoenixRuntime.dispatch(u, p || {}, res, { cancelled: () => false, onCancel: null });
        }), [uri, params]);
        const hostOf = (type) => host.filter((m) => m.type === type);

        await page.goto(pageUrl("devmode"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(pageUrl("devmode"));
        await page.waitForSelector(".pui-header");

        // ---- No policy ---------------------------------------------------------------
        let mode = await luna(SM + "getDeviceLockMode", {});
        check(mode.lockMode === "none" && mode.policyState === "none" && mode.retriesLeft === 0,
              "no passcode, no policy (" + JSON.stringify(mode) + ")");
        check((await luna(SM + "getSecurityPolicy", {})).returnValue === false, "getSecurityPolicy: none");
        check((await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "2580" })).returnValue, "a PIN");
        let r;
        for (let i = 0; i < 3; ++i)
            r = await luna(SM + "matchDevicePasscode", { passCode: "1111" });
        check(r.succeeded === false && r.lockedOut === false && r.retriesLeft === 0, "three wrong ones (" + JSON.stringify(r) + ")");
        r = await luna(SM + "matchDevicePasscode", { passCode: "2580" });
        check(r.succeeded === false && r.lockedOut === true, "then 15 s locked out, even the right one (" + JSON.stringify(r) + ")");
        await page.evaluate(() => {
            const k = "phoenix:settings:state", s = JSON.parse(localStorage.getItem(k));
            s.lock.lastFailure -= 16000;
            localStorage.setItem(k, JSON.stringify(s));
        });
        r = await luna(SM + "matchDevicePasscode", { passCode: "2580" });
        check(r.succeeded === true, "after 15 s the right one unlocks");

        // ---- An EAS policy that the PIN does not satisfy -------------------------------
        const policy = { _kind: "com.palm.securitypolicy:1", devicePasswordEnabled: true, minDevicePasswordLength: 6,
                         maxDevicePasswordFailedAttempts: 3, alphanumericDevicePasswordRequired: false,
                         allowSimpleDevicePassword: false, maxInactivityTimeDeviceLock: 125 };
        check((await luna("luna://com.palm.db/put", { objects: [policy] })).returnValue, "an EAS account puts a policy in db8");
        mode = await luna(SM + "getDeviceLockMode", {});
        check(mode.policyState === "pending" && mode.retriesLeft === 0, "a 4-digit PIN does not satisfy it: pending (" + JSON.stringify(mode) + ")");
        let sp = await luna(SM + "getSecurityPolicy", {});
        check(sp.returnValue && sp.policy.password.enabled && sp.policy.password.minLength === 6 && sp.policy.password.maxRetries === 3
              && sp.policy.password.allowSimplePassword === false && sp.policy.inactivityInSeconds === 120
              && sp.policy.status.enforced === false,
              "getSecurityPolicy: the policy, inactivity rounded down to the minute (" + JSON.stringify(sp) + ")");
        const second = Object.assign({}, policy, { minDevicePasswordLength: 4, maxDevicePasswordFailedAttempts: 5, maxInactivityTimeDeviceLock: 45 });
        await luna("luna://com.palm.db/put", { objects: [second] });
        sp = await luna(SM + "getSecurityPolicy", {});
        check(sp.policy.password.minLength === 6 && sp.policy.password.maxRetries === 3 && sp.policy.inactivityInSeconds === 30,
              "two policies: the strictest of each (" + JSON.stringify(sp.policy) + ")");
        // The lock screen sets the new PIN without the old one while pending.
        r = await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "1357" });
        check(r.returnValue === false && r.errorCode === -2 && r.errorText === "Passcode not minimum length", "too short: -2 (" + JSON.stringify(r) + ")");
        r = await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "123456" });
        check(r.returnValue === false && r.errorCode === -9 && r.errorText === "No sequential numbers (1234)", "sequential: -9 (" + JSON.stringify(r) + ")");
        r = await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "333333" });
        check(r.returnValue === false && r.errorCode === -8 && r.errorText === "No repeating numbers (3333)", "repeating: -8");
        r = await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "12ab56" });
        check(r.returnValue === false && r.errorCode === -5, "not digits: -5");
        r = await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "135792" });
        check(r.returnValue === true, "a PIN the policy takes");
        mode = await luna(SM + "getDeviceLockMode", {});
        check(mode.lockMode === "pin" && mode.policyState === "active" && mode.retriesLeft === 3, "active, three tries (" + JSON.stringify(mode) + ")");
        r = await luna(SM + "setDevicePasscode", { lockMode: "pin", passCode: "246813" });
        check(r.returnValue === false && r.errorText === "Incorrect passcode", "active: changing it needs the old one again");

        // Wrong ones cost tries; the right one gives them back.
        r = await luna(SM + "matchDevicePasscode", { passCode: "000000" });
        check(!r.succeeded && r.retriesLeft === 2, "a wrong one: two left (" + JSON.stringify(r) + ")");
        check((await luna(SM + "matchDevicePasscode", { passCode: "135792" })).succeeded, "the right one");
        check((await luna(SM + "getDeviceLockMode", {})).retriesLeft === 3, "three again");

        // The last try wipes the device.
        await luna("luna://com.webos.service.systemservice/setPreferences", { firstUseComplete: true, wallpaper: "phoenix-test" });
        for (let i = 0; i < 2; ++i)
            r = await luna(SM + "matchDevicePasscode", { passCode: "000000" });
        check(!r.succeeded && r.retriesLeft === 1, "one left");
        r = await luna(SM + "matchDevicePasscode", { passCode: "000000" });
        check(!r.succeeded && r.retriesLeft === 0, "none left");
        await page.waitForTimeout(500);
        mode = await luna(SM + "getDeviceLockMode", {});
        const prefs = await luna("luna://com.webos.service.systemservice/getPreferences", { keys: ["firstUseComplete", "wallpaper"] });
        check(mode.lockMode === "none" && mode.policyState === "none" && !prefs.firstUseComplete && prefs.wallpaper !== "phoenix-test",
              "wiped: no passcode, no policy (the account is gone), First Use again (" + JSON.stringify({ mode, prefs }) + ")");

        // ---- Full Erase: com.palm.storage/erase/EraseAll -----------------------------------
        await luna("luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Documents/keep.txt", data: "x", overwrite: true });
        check((await luna("luna://com.palm.storage/erase/EraseAll", {})).returnValue, "EraseAll");
        const stat = await luna("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Documents/keep.txt" });
        check(stat.returnValue === false, "... the USB drive's files too");

        // ---- USB drive mode ------------------------------------------------------------
        check((await luna("luna://com.palm.storage/diskmode/hostIsConnected", {})).hostIsConnected === false, "no cable");
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ usbHost: true }));
        r = await luna("luna://com.palm.storage/diskmode/hostIsConnected", {});
        check(r.result === true && r.hostIsConnected === true, "the cable from a computer is in");
        host.length = 0;
        check((await luna("luna://com.palm.storage/diskmode/enterMSM", { "user-confirmed": true, enterIMasq: false })).returnValue,
              "enterMSM");
        check(hostOf("enterMSM").length === 1, "... asks phoenix-sim's storaged");
        const heard = await page.evaluate(() => new Promise((res) => {
            const got = [];
            __phoenixRuntime.dispatch("luna://com.palm.bus/signal/addmatch", { category: "/storaged", method: "MSMAvail", subscribe: true },
                (x) => { got.push(x); if (got.length === 2) res(got); }, { cancelled: () => false, onCancel: null });
            __phoenixRuntime.storagedSignal("MSMAvail", { "mode-avail": true });
        }));
        check(heard[1]["mode-avail"] === true, "a /storaged signal reaches addmatch (luna-systemui)");

        // ---- Debugging overlays, progress animation, turbo --------------------------------
        host.length = 0;
        check((await luna(SM + "enableFpsCounter", { enable: true })).returnValue, "enableFpsCounter");
        check((await luna(SM + "enableTouchPlot", { trails: true })).returnValue, "enableTouchPlot");
        check((await luna(SM + "enableTouchPlot", { nothing: true })).returnValue === false, "enableTouchPlot without a known key fails");
        const d = hostOf("debugOverlay").map((m) => m.payload);
        check(d.length === 2 && d[0].fpsCounter.enable === true && d[1].touchPlot.trails === true, "... to the shell (" + JSON.stringify(d) + ")");
        check((await luna(SM + "runProgressAnimation", { type: "msm", state: "start" })).returnValue
              && hostOf("progressAnimation")[0].payload.type === "msm", "runProgressAnimation");
        check((await luna(SM + "runProgressAnimation", { type: "msm" })).returnValue === false, "... needs a state");
        r = await luna(SM + "subscribeTurboMode", { subscribe: true });
        check(r.subscribed === true && r.turboMode === true, "subscribeTurboMode");

        // Settings > Developer Mode > Debugging, as the shell reports what shows.
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ debugOverlays: { fpsCounter: true, touchPlot: { trails: false, crosshairs: false } } }));
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        await page.goto(pageUrl("devmode"));
        await page.waitForSelector("[data-testid=devmode-fps]");
        await page.screenshot({ path: path.join(outDir, "devmode-debugging.png") });
        host.length = 0;
        await page.click("[data-testid=devmode-touchplot]");
        await page.waitForTimeout(300);
        const tp = hostOf("debugOverlay").map((m) => m.payload);
        check(tp.length === 1 && tp[0].touchPlot.trails === true && tp[0].touchPlot.crosshairs === true,
              "Debugging > Touch plot turns on trails and crosshairs (" + JSON.stringify(tp) + ")");

        check(errors.length === 0, "no page errors (" + errors.join("; ") + ")");
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
    console.log(failures ? `${failures} FAILED` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
