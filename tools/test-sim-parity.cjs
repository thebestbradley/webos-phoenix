#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator is not kinder than a device (docs/SIM-PARITY.md): the
// runtime's simulated services (runtime/phoenix-runtime.js) answer as the
// device's do where a device run or review found a difference, in headless
// Chromium over tools/serve-rootfs.py:
//
//   1. com.webos.service.devmode: both answer forms, {status} and OSE's
//      {enabled} (services/devmode/devmode.js answer(), #81); setDevMode
//      takes OSE's {enabled} too, says {restarting: false} when nothing
//      changes and tells no watcher (#79).
//   2. com.webos.service.audio master/getVolume {soundOutput: "alsa"}:
//      refused with audiod-pro's error 204, as on a device (#91); {} answers.
//   3. com.webos.settingsservice getSystemSettings for keys none of which
//      is set: {returnValue: false, errorKey}, and no subscription (OSE's
//      PrefsDb8Get::sendResultReply; shell/qml/Phoenix/Lsm/LsmStatus.js
//      backlightUnset, #91).
//
//   node tools/test-sim-parity.cjs

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const servers = require(path.join(REPO, "apps/marketplace/service/test/servers.cjs"));

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

const PAGE = "/usr/palm/applications/org.webosphoenix.settings/parity.html";
const HTML = "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<script src=\"/usr/share/phoenix/runtime/phoenix-runtime.js\"></script></head><body><p>parity</p></body></html>";

// One call; with subscribe, every answer that comes within `ms`.
const luna = (page, uri, params, ms) => page.evaluate(([u, p, wait]) => new Promise((res) => {
    const b = new PalmServiceBridge(), got = [];
    b.onservicecallback = (j) => { got.push(JSON.parse(j)); if (!wait) res(got[0]); };
    b.call(u, JSON.stringify(p));
    window.__keep = (window.__keep || []).concat([b]);
    if (wait) setTimeout(() => res(got), wait);
}), [uri, params, ms || 0]);

async function main() {
    const { chromium } = loadPlaywright();
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { const r = await fetch(origin + "/apps.json"); await r.arrayBuffer(); if (r.ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch();
        const ctx = await browser.newContext();
        const pageErrors = [];
        await ctx.route(origin + PAGE, (route) => route.fulfill({ contentType: "text/html", body: HTML }));
        const p = await ctx.newPage();
        p.on("pageerror", (e) => pageErrors.push(e.message));
        await p.goto(origin + PAGE);
        await p.waitForFunction(() => !!window.__phoenixRuntime);

        // 1. Developer Mode.
        const DM = "luna://com.webos.service.devmode/";
        let r = await luna(p, DM + "getDevMode", {});
        check(r.returnValue === true && r.status === "disabled" && r.enabled === false,
            "getDevMode: both forms, {status: \"disabled\", enabled: false} (" + JSON.stringify(r) + ")");
        const watched = luna(p, DM + "getDevMode", { subscribe: true }, 800);
        await new Promise((res) => setTimeout(res, 100));
        r = await luna(p, DM + "setDevMode", { enabled: true });
        check(r.returnValue === true && r.status === "enabled" && r.enabled === true,
            "setDevMode takes OSE's {enabled: true} (" + JSON.stringify(r) + ")");
        r = await luna(p, DM + "setDevMode", { status: "enabled" });
        check(r.returnValue === true && r.restarting === false, "setDevMode to what it is: {restarting: false} (" + JSON.stringify(r) + ")");
        const answers = await watched;
        check(answers.length === 2 && answers[1].status === "enabled" && answers[1].enabled === true,
            "a getDevMode subscriber hears the change once, in both forms (" + JSON.stringify(answers) + ")");
        r = await luna(p, DM + "setDevMode", { status: "disabled" });
        check(r.returnValue === true && r.enabled === false, "setDevMode {status: \"disabled\"} still works");
        r = await luna(p, DM + "setDevMode", { enabled: "yes" });
        check(r.returnValue === false, "setDevMode with neither form is refused");

        // 2. The master volume.
        const AUDIO = "luna://com.webos.service.audio/master/";
        r = await luna(p, AUDIO + "getVolume", { soundOutput: "alsa" });
        check(r.returnValue === false && r.errorCode === 204, "master/getVolume {soundOutput: \"alsa\"}: error 204, as audiod-pro (" + JSON.stringify(r) + ")");
        r = await luna(p, AUDIO + "getVolume", {});
        check(r.returnValue === true && r.volumeStatus && typeof r.volumeStatus.volume === "number", "master/getVolume {}: the active output's volume");
        r = await luna(p, AUDIO + "setVolume", { soundOutput: "alsa", volume: 40 });
        check(r.returnValue === true, "master/setVolume still takes {soundOutput: \"alsa\"}");

        // 3. settingsservice: a key nothing has set.
        const SS = "luna://com.webos.settingsservice/";
        const unset = await luna(p, SS + "getSystemSettings", { category: "picture", keys: ["parityUnset"], subscribe: true }, 600);
        check(unset.length === 1 && unset[0].returnValue === false && Array.isArray(unset[0].errorKey) && unset[0].errorKey[0] === "parityUnset" && !unset[0].subscribed,
            "getSystemSettings of a key never set: {returnValue: false, errorKey}, not subscribed (" + JSON.stringify(unset) + ")");
        const later = luna(p, SS + "getSystemSettings", { category: "picture", keys: ["parityUnset"], subscribe: true }, 600);
        await new Promise((res) => setTimeout(res, 100));
        await luna(p, SS + "setSystemSettings", { category: "picture", settings: { parityUnset: 5 } });
        const got = await later;
        check(got.length === 1, "... and a set afterwards is not sent to it (no subscription was made)");
        r = await luna(p, SS + "getSystemSettings", { category: "picture", keys: ["parityUnset"] });
        check(r.returnValue === true && r.settings && r.settings.parityUnset === 5, "once set, the get answers it");
        r = await luna(p, SS + "getSystemSettings", { category: "picture", keys: ["backlight"] });
        check(r.returnValue === true && typeof r.settings.backlight === "number",
            "picture.backlight is set on a new simulator, as the device's shell seeds it at boot (LsmSystemStatus)");

        check(pageErrors.length === 0, "no page errors" + (pageErrors.length ? ": " + pageErrors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
