#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Settings app (apps/settings, built into dist/) in headless
// Chromium against the simulated services in runtime/phoenix-runtime.js:
// toggles Wi-Fi, joins a network with a password, sets a PIN, moves the
// brightness slider, turns on airplane mode and pairs a Bluetooth device.
// Checks both the UI and the "systemStatus" messages the runtime sends the
// shell (what drives the status bar in phoenix-sim).
//
//   node tools/test-settings.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "settings-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8790 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}/usr/palm/applications/org.webosphoenix.settings/index.html`;

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
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const status = [];   // systemStatus payloads, newest last
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) {
                const msg = JSON.parse(t.slice(11));
                if (msg.type === "systemStatus") status.push(msg.payload);
            } else if (m.type() === "error" && !/Failed to load resource/.test(t)) {
                errors.push(t);
            }
        });
        const last = () => status[status.length - 1] || {};
        const open = async (pageId) => {
            await page.goto(base + "?launchParams=" + encodeURIComponent(JSON.stringify({ page: pageId })));
            await page.waitForSelector(".pui-header");
            await page.waitForTimeout(300);
        };
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true });

        // ---- Wi-Fi ------------------------------------------------------------
        await open("wifi");
        await page.evaluate(() => localStorage.clear());
        await open("wifi");
        await page.waitForSelector("[data-testid='network-Phoenix']");
        await shot("wifi-on");
        await page.click("[data-testid='wifi-toggle']");
        await page.waitForSelector("[data-testid='wifi-toggle'][aria-checked='false']");
        check(last().wifiEnabled === false && last().wifiBars === -1, "Wi-Fi off reaches the shell (wifiBars -1)");
        check(await page.locator("[data-testid^='network-']").count() === 0, "network list hidden while Wi-Fi is off");
        await shot("wifi-off");
        await page.click("[data-testid='wifi-toggle']");
        await page.waitForSelector("[data-testid='network-Lab 5G']");
        check(last().wifiEnabled === true, "Wi-Fi on reaches the shell");

        await page.click("[data-testid='network-Lab 5G']");
        await page.waitForSelector("[data-testid='wifi-join']");
        await page.fill("[data-testid='wifi-password']", "wrongpass1");
        await page.click("[data-testid='wifi-join-button']");
        await page.waitForSelector("[data-testid='wifi-join'] [role='alert']", { timeout: 5000 });
        check(/incorrect/i.test(await page.textContent("[data-testid='wifi-join'] [role='alert']")), "wrong password is rejected");
        await shot("wifi-wrong-password");
        await page.fill("[data-testid='wifi-password']", "webos2009");
        await page.click("[data-testid='wifi-join-button']");
        await page.waitForSelector("[data-testid='wifi-join']", { state: "detached", timeout: 5000 });
        await page.waitForFunction(() => document.querySelector("[data-testid='network-Lab 5G']")?.textContent.includes("Connected"));
        check(true, "joined Lab 5G with the right password");
        check(last().wifiConnected === true && last().wifiBars === 2, "shell gets the new network's signal (2 bars)");
        await shot("wifi-connected");

        // ---- Screen & Lock: brightness and PIN ------------------------------------
        await open("screen");
        const slider = page.locator("[data-testid='brightness']");
        const box = await slider.locator(".pui-slider-track").boundingBox();
        await page.mouse.move(box.x + box.width * 0.5, box.y + 3);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.2, box.y + 3, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        const b = last().brightness;
        check(b >= 20 && b <= 30, `dragging the slider sets brightness (${b})`);

        await page.click("[data-testid='lock-mode']");
        await page.click("role=option[name='Simple PIN']");
        await page.waitForSelector("[data-testid='passcode']");
        await page.fill("[data-testid='passcode-field']", "1234");
        await page.click("[data-testid='passcode-next']");
        await page.fill("[data-testid='passcode-field']", "1243");
        await page.click("[data-testid='passcode-next']");
        check(/do not match/.test(await page.textContent("[data-testid='passcode']")), "mismatched PIN is refused");
        await page.fill("[data-testid='passcode-field']", "1234");
        await page.click("[data-testid='passcode-next']");
        await page.fill("[data-testid='passcode-field']", "1234");
        await shot("pin-confirm");
        await page.click("[data-testid='passcode-next']");
        await page.waitForSelector("[data-testid='passcode']", { state: "detached" });
        check((await page.textContent("[data-testid='lock-mode']")).includes("Simple PIN"), "PIN set");
        const mode = await page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).lockMode);
            b.call("luna://com.palm.systemmanager/getDeviceLockMode", "{}");
        }));
        check(mode === "pin", "service reports lockMode pin");
        await page.click("[data-testid='wallpaper']");
        await page.click("[data-testid='wallpaper-Aurora']");
        await page.waitForTimeout(200);
        check(/aurora\.jpg$/.test(last().wallpaperFile || ""), "wallpaper choice reaches the shell");
        await shot("screen-lock");

        // ---- Airplane mode, Bluetooth ----------------------------------------------
        await open("airplane");
        await page.click("[data-testid='airplane-toggle']");
        await page.waitForTimeout(200);
        check(last().airplaneMode === true && last().wifiEnabled === false, "airplane mode turns Wi-Fi off");
        await shot("airplane");
        await page.click("[data-testid='airplane-toggle']");
        await page.waitForTimeout(200);
        check(last().airplaneMode === false && last().wifiEnabled === true, "airplane mode off restores Wi-Fi");

        await open("bluetooth");
        await page.click("[data-testid='bt-toggle']");
        await page.waitForSelector("[data-testid='bt-search']");
        check(last().bluetoothOn === true, "Bluetooth on reaches the shell");
        await page.click("[data-testid='bt-search']");
        await page.waitForSelector("[data-testid='bt-00:1d:fe:10:20:02']", { timeout: 5000 });
        await shot("bluetooth-search");
        await page.click("[data-testid='bt-00:1d:fe:10:20:02']");
        await page.waitForFunction(() => /My devices[\s\S]*Headset/.test(document.body.innerText), null, { timeout: 5000 });
        check(true, "paired a headset");
        await shot("bluetooth-paired");

        // ---- The shell flips a toggle (system menu) ----------------------------------
        await open("wifi");
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ wifiEnabled: false }));
        await page.waitForSelector("[data-testid='wifi-toggle'][aria-checked='false']", { timeout: 2000 });
        check(true, "a system menu change shows up in Settings");

        // ---- Sounds & Ringtones -----------------------------------------------------------
        // The ringtone picker lists the shipped ringtones; picking one, and
        // the System sounds and Keyboard clicks switches, reach the shell.
        await open("sounds");
        await page.waitForSelector("[data-testid='system-sounds']");
        check(/Ringtone/.test(await page.textContent("[data-testid='ringtone']")), "the default ringtone is Open webOS's ringtone.mp3");
        await page.click("[data-testid='ringtone']");
        await page.waitForSelector("[role='option']");
        const tones = await page.locator("[role='option']").allTextContents();
        check(tones.some((t) => /^\s*Ringtone\s*$/.test(t)) && tones.some((t) => /^\s*Phone\s*$/.test(t)),
              "the picker lists the shipped ringtones: " + tones.map((t) => t.trim()).join(", "));
        await shot("sounds-ringtones");
        await page.locator("[role='option']", { hasText: /^\s*Phone\s*$/ }).click();
        await page.waitForFunction(() => /Phone/.test(document.querySelector("[data-testid='ringtone']")?.textContent || ""));
        check(last().ringtone === "/usr/palm/sounds/phone.wav", "the new ringtone reaches the shell");
        await page.click("[data-testid='keyboard-clicks']");
        await page.waitForSelector("[data-testid='keyboard-clicks'][aria-checked='false']");
        check(last().tapSounds === false, "Keyboard clicks off reaches the shell");
        await page.click("[data-testid='system-sounds']");
        await page.waitForSelector("[data-testid='system-sounds'][aria-checked='false']");
        check(last().systemSounds === false, "System sounds off reaches the shell");
        await shot("sounds");

        // ---- Every other pane renders --------------------------------------------------
        for (const p of ["datetime", "language", "deviceinfo", "updates"]) {
            await open(p);
            await shot(p);
        }
        await page.goto(base);
        await page.waitForSelector("[data-testid='hub-wifi']");
        await shot("hub");
        await page.click("[data-testid='hub-deviceinfo']");
        await page.waitForSelector("[data-testid='licenses']");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='hub-wifi']");
        check(true, "back gesture returns from a pane to the list");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
