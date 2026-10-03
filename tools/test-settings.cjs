#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Settings app (apps/settings, built into dist/) in headless
// Chromium against the simulated services in runtime/phoenix-runtime.js:
// toggles Wi-Fi, joins a network with a password, sets a PIN (and the
// screen and lock timeouts), moves the
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
        // Call a simulated service in the page, as an app would.
        const svc = (uri, params) => page.evaluate(([u, p]) => new Promise((resolve) => {
            __phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);

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

        // ---- Developer Mode without a PIN: set one first --------------------------
        await open("devmode");
        await page.click("[data-testid='devmode-toggle']");
        await page.waitForSelector("[data-testid='devmode-nolock']");
        check(await page.locator("[data-testid='devmode-open-screen']").count() === 1, "Developer Mode asks for a PIN or password to be set first");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='devmode-nolock']", { state: "detached" });
        check(await page.getAttribute("[data-testid='devmode-toggle']", "aria-checked") === "false", "Developer Mode stays off");

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
        // "Turn off after" and, with a PIN, "Lock after" reach the shell
        // (its display and lock screen).
        await page.click("[data-testid='timeout']");
        await page.click("role=option[name='2 minutes']");
        await page.waitForTimeout(200);
        check(last().screenTimeout === 120, `Turn off after reaches the shell (${last().screenTimeout})`);
        await page.click("[data-testid='lock-after']");
        await page.click("role=option[name='5 minutes']");
        await page.waitForTimeout(200);
        check(last().lockTimeout === 300, `Lock after reaches the shell (${last().lockTimeout})`);
        // Advanced gestures: offered once the shell reports a gesture area,
        // and the long swipe's setting reaches it.
        check(await page.locator("[data-testid='advanced-gestures']").count() === 0, "no Advanced gestures without a gesture area");
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ gestureArea: true }));
        await page.waitForSelector("[data-testid='advanced-gestures']", { timeout: 3000 });
        await page.click("[data-testid='advanced-gestures'] [role='switch']");
        await page.waitForTimeout(200);
        check(last().advancedGestures === true, `Advanced gestures reaches the shell (${last().advancedGestures})`);
        await page.click("[data-testid='wallpaper']");
        await page.click("[data-testid='wallpaper-Aurora']");
        await page.waitForTimeout(200);
        check(/aurora\.jpg$/.test(last().wallpaperFile || ""), "wallpaper choice reaches the shell");
        await shot("screen-lock");

        // ---- Developer Mode: warning and the PIN ---------------------------------
        const devStatus = () => page.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j).status);
            b.call("luna://com.webos.service.devmode/getDevMode", "{}");
        }));
        await open("devmode");
        await page.click("[data-testid='devmode-toggle']");
        await page.waitForSelector("[data-testid='devmode-confirm']");
        check(/install scripts and background services/.test(await page.textContent("[data-testid='devmode-confirm']")), "Developer Mode warns before turning on");
        await page.fill("[data-testid='devmode-passcode']", "9999");
        await page.click("[data-testid='devmode-enable']");
        await page.waitForFunction(() => /not correct/.test(document.querySelector("[data-testid='devmode-confirm']")?.textContent || ""));
        check(await devStatus() === "disabled", "a wrong PIN leaves Developer Mode off");
        await shot("devmode-confirm");
        await page.fill("[data-testid='devmode-passcode']", "1234");
        await page.click("[data-testid='devmode-enable']");
        await page.waitForSelector("[data-testid='devmode-confirm']", { state: "detached" });
        await page.waitForSelector("[data-testid='devmode-toggle'][aria-checked='true']");
        check(await devStatus() === "enabled", "the right PIN turns Developer Mode on");
        await shot("devmode-on");
        await page.click("[data-testid='devmode-toggle']");
        await page.waitForSelector("[data-testid='devmode-toggle'][aria-checked='false']");
        check(await devStatus() === "disabled", "turning Developer Mode off needs no PIN");

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
        // The alert and notification tones: Open webOS's by default, any
        // ringtone too.
        check(/Alert/.test(await page.textContent("[data-testid='alerttone']"))
              && /Notification/.test(await page.textContent("[data-testid='notificationtone']")), "alert.wav and notification.wav by default");
        await page.click("[data-testid='notificationtone']");
        await page.locator("[role='option']", { hasText: /^\s*Ringtone\s*$/ }).click();
        await page.waitForFunction(() => /Ringtone/.test(document.querySelector("[data-testid='notificationtone']")?.textContent || ""));
        check(last().notificationtone === "/usr/palm/sounds/ringtone.mp3", "the new notification tone reaches the shell");
        await page.click("[data-testid='alerttone']");
        await page.locator("[role='option']", { hasText: /^\s*Notification\s*$/ }).click();
        await page.waitForFunction(() => /Notification/.test(document.querySelector("[data-testid='alerttone']")?.textContent || ""));
        check(last().alerttone === "/usr/palm/sounds/notification.wav", "the new alert tone reaches the shell");
        await page.click("[data-testid='keyboard-clicks']");
        await page.waitForSelector("[data-testid='keyboard-clicks'][aria-checked='false']");
        check(last().tapSounds === false, "Keyboard clicks off reaches the shell");
        await page.click("[data-testid='system-sounds']");
        await page.waitForSelector("[data-testid='system-sounds'][aria-checked='false']");
        check(last().systemSounds === false, "System sounds off reaches the shell");
        await shot("sounds");

        // ---- Text Assist: the keyboard's suggestions, corrections, swipe -----------------
        await open("textassist");
        await page.waitForSelector("[data-testid='ta-suggestions'][aria-checked='true']");
        check(last().textAssist && last().textAssist.suggestions === true && last().textAssist.swipe === true,
              "Text Assist: all on by default");
        await page.click("[data-testid='ta-autocorrect']");
        await page.waitForSelector("[data-testid='ta-autocorrect'][aria-checked='false']");
        check(last().textAssist.autoCorrect === false && last().tapSounds === false, "Auto-correct off reaches the shell (other keyboard settings kept)");
        await page.click("[data-testid='ta-swipe']");
        await page.waitForSelector("[data-testid='ta-swipe'][aria-checked='false']");
        check(last().textAssist.swipe === false, "Swipe typing off reaches the shell");
        await page.click("[data-testid='ta-forget']");
        await page.click("[data-testid='ta-forget-confirm']");
        await page.waitForFunction(() => /forgotten/.test(document.querySelector("[data-testid='ta-learned-note']")?.textContent || ""));
        for (let i = 0; i < 50 && !(last().textAssist && last().textAssist.forgetWords > 0); ++i) await page.waitForTimeout(100);
        check(last().textAssist.forgetWords > 0, "Forget Learned Words reaches the shell");
        // Keyboards: English alone, which cannot be turned off; Deutsch added.
        check(JSON.stringify(last().keyboards) === '[{"layout":"qwerty","language":"en"}]', "one keyboard by default (English, QWERTY)");
        check(await page.locator("[data-testid='ta-kb-qwerty-en']").isDisabled(), "the last keyboard stays on");
        await page.click("[data-testid='ta-kb-qwertz-de']");
        await page.waitForSelector("[data-testid='ta-kb-qwertz-de'][aria-checked='true']");
        check(JSON.stringify(last().keyboards) === '[{"layout":"qwerty","language":"en"},{"layout":"qwertz","language":"de"}]',
              `a second keyboard reaches the shell (${JSON.stringify(last().keyboards)})`);
        check(last().keyboard && last().keyboard.language === "en", "the one in use stays English");
        // The keyboard's language key chose German: kept (x_palm_virtualkeyboard_settings).
        await page.evaluate(() => window.__phoenixRuntime.applyHostStatus({ keyboard: { layout: "qwertz", language: "de" } }));
        check(last().keyboard && last().keyboard.layout === "qwertz", "the language key's choice is kept");
        await page.click("[data-testid='ta-kb-qwertz-de']");
        await page.waitForSelector("[data-testid='ta-kb-qwertz-de'][aria-checked='false']");
        check(last().keyboard && last().keyboard.language === "en", "turned off, the keyboard in use goes back to the first");
        // Hardware keyboard: the shortcut scheme reaches the shell.
        check(last().keyboardShortcuts === "ipad", "iPad-style shortcuts by default");
        await page.click("[data-testid='keyboard-shortcuts']");
        await page.click("role=option[name='Desktop style (Alt, Super)']");
        await page.waitForTimeout(200);
        check(last().keyboardShortcuts === "desktop", `desktop-style shortcuts reach the shell (${last().keyboardShortcuts})`);
        // Shortcuts: one added reaches the keyboard; a bad one is refused.
        await page.click("[data-testid='ta-shortcut-add']");
        await page.fill("[data-testid='ta-shortcut-field']", "on my");
        await page.fill("[data-testid='ta-shortcut-text']", "x");
        await page.click("[data-testid='ta-shortcut-save']");
        check(/letters only/.test(await page.textContent("[data-testid='ta-shortcut-error']")), "a shortcut with a space is refused");
        await page.fill("[data-testid='ta-shortcut-field']", "omw");
        await page.fill("[data-testid='ta-shortcut-text']", "On my way");
        await shot("textassist-shortcut");
        await page.click("[data-testid='ta-shortcut-save']");
        await page.waitForSelector("[data-testid='ta-shortcut-omw']");
        check(last().textAssist.shortcuts && last().textAssist.shortcuts.omw === "On my way" && last().textAssist.shortcutsOn === true,
              `a new shortcut reaches the keyboard (${JSON.stringify(last().textAssist.shortcuts)})`);
        await shot("textassist");

        // ---- Accessibility > Keyboard: the hardware keyboard's options reach the shell ----
        await open("accessibility");
        check(last().keyboardAccess && last().keyboardAccess.stickyKeys === false && last().keyboardAccess.customRepeat === false,
              "keyboard accessibility off by default, the keyboard's own repeat");
        await page.click("[data-testid='a11y-stickyKeys']");
        await page.waitForSelector("[data-testid='a11y-stickyKeys'][aria-checked='true']");
        await page.click("[data-testid='a11y-slowKeys']");
        await page.click("role=option[name='0.6 seconds']");
        await page.click("[data-testid='a11y-keyRepeat']");
        await page.click("role=option[name='Fast']");
        await page.waitForTimeout(200);
        const ka = last().keyboardAccess || {};
        check(ka.stickyKeys === true && ka.slowKeys === 600 && ka.bounceKeys === 0, `sticky and slow keys reach the shell (${JSON.stringify(ka)})`);
        check(ka.customRepeat === true && ka.repeatDelay === 250 && ka.repeatInterval === 30, "the key repeat reaches the shell");
        await page.click("[data-testid='a11y-keyRepeat']");
        await page.click("role=option[name='As the keyboard does']");
        await page.waitForTimeout(200);
        check(last().keyboardAccess.customRepeat === false, "back to the keyboard's own repeat");
        await shot("accessibility-keyboard");
        // ---- Just Type: com.palm.universalsearch, what Just Type reads ------------------
        const usList = () => svc("luna://com.palm.universalsearch/getUniversalSearchList", {});
        await open("justtype");
        await page.waitForSelector("[data-testid='jt-engine-amazon']");
        check((await usList()).UniversalSearchList.map((e) => e.id).join() === "google,wikipedia,amazon,imdb,cnn", "the engines as UniversalSearchList.json lists them");
        await page.click("[data-testid='jt-engine-amazon']");
        await page.waitForSelector("[data-testid='jt-engine-amazon'][aria-checked='true']");
        check((await usList()).UniversalSearchList.find((e) => e.id === "amazon").enabled === true, "Amazon turned on for Just Type");
        // Drag Amazon to the top by its grip.
        const grip = await page.locator("[data-testid='grip-amazon']").boundingBox();
        const top = await page.locator("[data-testid='grip-google']").boundingBox();
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2, top.y + 4, { steps: 8 });
        await page.mouse.up();
        for (let i = 0; i < 30 && (await usList()).UniversalSearchList[0].id !== "amazon"; ++i) await page.waitForTimeout(100);
        check((await usList()).UniversalSearchList.map((e) => e.id).join() === "amazon,google,wikipedia,imdb,cnn", "dragged to the top, Amazon is first in Just Type's list");
        await page.click("[data-testid='jt-default-engine']");
        await page.click("role=option[name='Wikipedia']");
        for (let i = 0; i < 30 && (await usList()).defaultSearchEngine !== "wikipedia"; ++i) await page.waitForTimeout(100);
        check((await usList()).defaultSearchEngine === "wikipedia", "Wikipedia is Just Type's default search");
        await page.waitForTimeout(300);
        await shot("justtype");
        // Just Type's Preferences item opens this pane.
        const hostMsgs = [];
        page.on("console", (m) => { const t = m.text(); if (t.startsWith("__phoenix__")) hostMsgs.push(JSON.parse(t.slice(11))); });
        await svc("luna://com.palm.applicationManager/launch", { id: "com.palm.app.searchpreferences" });
        await page.waitForTimeout(200);
        check(hostMsgs.some((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.settings" && m.payload.params.page === "justtype"),
              "com.palm.app.searchpreferences opens Settings > Just Type");

        // ---- Device Info: the phone, and the legacy reset options ----------------------
        // Erase Apps & Data keeps the files on the USB drive; Full Erase does not.
        const KEEP = "/media/internal/Documents/keep.txt";
        const PHOTO = "/media/internal/Pictures/kept.png";
        const plant = async () => {
            await svc("luna://org.webosphoenix.filemanager/write", { path: KEEP, data: "my file", overwrite: true });
            await svc("luna://org.webosphoenix.service.mediafiles/write", { path: PHOTO, data: "iVBORw0KGgo=", mimeType: "image/png" });
            await svc("luna://com.webos.service.systemservice/setPreferences", { wallpaper: "phoenix-test" });
        };
        const state = () => page.evaluate(([k, ph]) => new Promise((resolve) => {
            __phoenixRuntime.dispatch("luna://org.webosphoenix.filemanager/stat", { path: k }, (r) => {
                __phoenixRuntime.mediaFiles.list("/media/internal/Pictures/").then((photos) => {
                    resolve({ file: r.returnValue !== false, photo: photos.indexOf(ph) >= 0 });
                });
            }, { cancelled: () => false, onCancel: null });
        }), [KEEP, PHOTO]);
        const erase = async (button) => {
            await open("deviceinfo");
            await page.click(`[data-testid='${button}']`);
            await page.waitForSelector("[data-testid='reset-dialog']");
            await shot("deviceinfo-" + button);
            await page.click("[data-testid='reset-confirm']");
            await page.waitForSelector(".pui-note");
        };
        await open("deviceinfo");
        await page.waitForSelector("[data-testid='imei']");
        const phoneText = await page.locator(".pui-group", { hasText: "IMEI" }).innerText();
        check(/\+1 \(408\) 555-0199/.test(phoneText) && /490154203237518/.test(phoneText) && /Phoenix/.test(phoneText)
              && /3G \(UMTS\)/.test(phoneText) && /Ready/.test(phoneText),
              "Device Info: phone number, carrier, network, IMEI and SIM (" + phoneText.replace(/\s+/g, " ") + ")");
        await shot("deviceinfo-phone");
        await plant();
        let st = await state();
        check(st.file && st.photo, "a file and a picture on the USB drive");
        await erase("erase-data");
        st = await state();
        const pref = await svc("luna://com.webos.service.systemservice/getPreferences", { keys: ["wallpaper"] });
        check(st.file && st.photo && pref.wallpaper !== "phoenix-test",
              "Erase Apps & Data: settings gone, the USB drive's files kept (" + JSON.stringify({ st, wallpaper: pref.wallpaper }) + ")");
        await erase("full-erase");
        st = await state();
        check(!st.file && !st.photo, "Full Erase: the USB drive's files gone too (" + JSON.stringify(st) + ")");

        // ---- VPN: com.webos.service.vpn (LuneOS), the page, the system menu -----------
        const VPN = "luna://com.webos.service.vpn/";
        const vpnStatus = () => (last().vpnProfiles || []);
        const vpnShell = (name) => vpnStatus().find((v) => v.name === name) || {};
        const PRIV = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=", PUB = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=";
        await open("vpn");
        await page.waitForSelector("[data-testid='vpn-Office']");
        await shot("vpn");
        check(/WireGuard · vpn\.example\.com/.test(await page.locator("[data-testid='vpn-Office']").innerText()),
              "VPN: the WireGuard demo profile");
        await page.click("[data-testid='vpn-toggle-Office']");
        await page.waitForTimeout(150);
        check(vpnShell("Office").state === "connecting", "connecting reaches the shell (" + JSON.stringify(vpnStatus()) + ")");
        await page.waitForTimeout(1400);
        check(vpnShell("Office").state === "connected", "... then connected (" + vpnShell("Office").state + ")");
        const conn = await svc(VPN + "getConnectionDetails", { vpnProfileName: "Office" });
        check(conn.state === "connected" && conn.clientIpAddress === "10.8.0.2" && conn.ifName === "wg0" && conn.subscribed === false,
              "getConnectionDetails: the tunnel's address (" + JSON.stringify(conn) + ")");
        // The system menu's drawer: by name, as the shell asks every page.
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ vpnDisconnect: "Office" }));
        await page.waitForSelector("[data-testid='vpn-toggle-Office'][aria-checked='false']");
        await page.waitForTimeout(400);   // connman's "disconnect", then "idle"
        check(vpnShell("Office").state === "disconnected", "the system menu disconnects it");
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ vpnConnect: "Office" }));
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ vpnConnect: "Office" }));   // a second page: no change
        await page.waitForTimeout(1500);
        check(vpnShell("Office").state === "connected", "... and connects it (once, from every page)");

        // The service's own answers, codes as legacy webOS numbered them.
        const e3 = await svc(VPN + "connect", { vpnProfileName: "Nope" });
        const e4 = await svc(VPN + "addProfile", { vpnProfileName: "Office", vpnAgentGuid: "com.webos.vpn.wireguard", vpnProfile: { vpnHost: "x" } });
        const e9 = await svc(VPN + "addProfile", { vpnProfileName: "X", vpnAgentGuid: "com.example.nope", vpnProfile: { vpnHost: "x" } });
        const e2 = await svc(VPN + "addProfile", { vpnProfileName: "X", vpnAgentGuid: "com.webos.vpn.wireguard", vpnProfile: {} });
        const e6 = await svc(VPN + "connect", { vpnProfileName: "Office" });
        check(e3.errorCode === -3 && e3.errorText === "Profile not found." && e4.errorCode === -4 && e9.errorCode === -9
              && e2.errorCode === -2 && e2.errorText === "Invalid parameters." && e6.errorCode === -6 && e6.errorText === "Already connected",
              "errors -2, -3, -4, -6, -9 (" + [e2, e3, e4, e6, e9].map((e) => e.errorCode).join(", ") + ")");
        const agents = (await svc(VPN + "getAgents", {})).vpnAgents;
        const wgForm = (await svc(VPN + "getAgentFormFields", { vpnAgentGuid: "com.webos.vpn.wireguard" })).vpnFormFields;
        check(agents.map((a) => a.connmanType).join() === "wireguard,openvpn,openconnect,vpnc,l2tp,pptp"
              && agents[5].deprecated === true && agents[0].supportsImport[0] === "wg-conf" && wgForm.length === 9,
              "getAgents and getAgentFormFields as luneos-vpn-adapter has them");

        // Add an OpenVPN profile from its .ovpn file: it signs in when connecting.
        await page.click("[data-testid='vpn-add']");
        await page.click("[data-testid='vpn-agent-openvpn']");
        await page.waitForSelector("[data-testid='vpn-edit-dialog']");
        await page.fill("[data-testid='vpn-name']", "Home");
        await page.setInputFiles("[data-testid='vpn-file']", { name: "home.ovpn", mimeType: "text/plain",
            buffer: Buffer.from("client\ndev tun\nremote home.example.net 443 tcp\nauth-user-pass\n") });
        await page.waitForFunction(() => document.querySelector("[data-testid='vpn-host']").value === "home.example.net");
        await page.waitForTimeout(400);   // the dialog's fade
        await shot("vpn-add");
        await page.click("[data-testid='vpn-save']");
        await page.waitForSelector("[data-testid='vpn-Home']");
        check(/OpenVPN · home\.example\.net/.test(await page.locator("[data-testid='vpn-Home']").innerText()), "an OpenVPN profile from its file");
        const hd = await svc(VPN + "getProfileDetails", { vpnProfileName: "Home" });
        const hv = (id) => (hd.vpnProfile.vpnFormFields.find((f) => f.id === id) || {}).value;
        const ovpnFile = await svc("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/vpn/Home.ovpn" });
        check(hv("ovpnConfigFile") === "/media/internal/vpn/Home.ovpn" && hv("ovpnPort") === "443" && hv("ovpnProto") === "tcp"
              && hv("ovpnAuthUserPass") === "-" && ovpnFile.returnValue !== false,
              "... its file stored and used as OpenVPN.ConfigFile, port, protocol, user/password auth");
        check(vpnShell("Home").needsCredentials === true, "the system menu knows it signs in (needsCredentials)");
        await page.click("[data-testid='vpn-toggle-Home']");
        await page.waitForSelector("[data-testid='vpn-prompt']");
        await page.waitForTimeout(400);
        await shot("vpn-prompt");
        await page.fill("[data-testid='vpn-prompt-user-name']", "pat");
        await page.fill("[data-testid='vpn-prompt-password']", "secret");
        await page.click("[data-testid='vpn-prompt-ok']");
        await page.waitForTimeout(1500);
        check(vpnShell("Home").state === "connected" && vpnShell("Office").state === "disconnected",
              "signed in: connected, and the other VPN is not (one at a time)");
        const leak = JSON.stringify(await svc(VPN + "getProfileDetails", { vpnProfileName: "Home" }));
        check(!leak.includes("secret") && vpnShell("Home").needsCredentials === false, "the password never comes back; it is kept for next time");
        await page.click("[data-testid='vpn-toggle-Home']");
        await page.waitForTimeout(500);
        await page.click("[data-testid='vpn-toggle-Home']");
        await page.waitForTimeout(1500);
        check(vpnShell("Home").state === "connected" && await page.locator("[data-testid='vpn-prompt']").count() === 0,
              "... connecting again asks nothing");

        // A WireGuard profile from its .conf; a broken one is refused, with why.
        await page.click("[data-testid='vpn-add']");
        await page.click("[data-testid='vpn-agent-wireguard']");
        await page.setInputFiles("[data-testid='vpn-file']", { name: "bad.conf", mimeType: "text/plain", buffer: Buffer.from("[Interface]\nAddress = 10.0.0.2/32\n") });
        await page.waitForSelector("[data-testid='vpn-edit-dialog'] .pui-error");
        check(/PrivateKey/.test(await page.locator("[data-testid='vpn-edit-dialog'] .pui-error").innerText()), "a .conf without a key is refused");
        await page.setInputFiles("[data-testid='vpn-file']", { name: "lab.conf", mimeType: "text/plain", buffer: Buffer.from(
            `[Interface]\nPrivateKey = ${PRIV}\nAddress = 10.9.0.5/24\nDNS = 10.9.0.1\n\n[Peer]\nPublicKey = ${PUB}\nEndpoint = lab.example.org:51000\nAllowedIPs = 10.9.0.0/24\n`) });
        await page.waitForFunction(() => document.querySelector("[data-testid='vpn-host']").value === "lab.example.org");
        await page.click("[data-testid='vpn-save']");
        await page.waitForSelector("[data-testid='vpn-lab']");
        const ld = await svc(VPN + "getProfileDetails", { vpnProfileName: "lab" });
        const lv = (id) => ld.vpnProfile.vpnFormFields.find((f) => f.id === id);
        check(ld.vpnProfile.vpnHost === "lab.example.org" && lv("wgAddress").value === "10.9.0.5/24" && lv("wgEndpointPort").value === "51000"
              && lv("wgPrivateKey").value === "" && lv("wgPrivateKey").hasStoredValue === false,
              "a WireGuard .conf split into its fields; the key not given back");

        // Airplane mode drops the VPN.
        await svc("luna://com.webos.service.connectionmanager/setstate", { offlineMode: "enabled" });
        await page.waitForTimeout(200);
        check(vpnShell("Home").state === "disconnected", "airplane mode disconnects the VPN");
        await svc("luna://com.webos.service.connectionmanager/setstate", { offlineMode: "disabled" });

        // Delete.
        await page.click("[data-testid='vpn-lab']");
        await page.click("[data-testid='vpn-delete']");
        await page.click("[data-testid='vpn-delete-confirm']");
        await page.waitForSelector("[data-testid='vpn-lab']", { state: "detached" });
        check(!vpnStatus().some((v) => v.name === "lab"), "a deleted profile leaves the system menu too");

        // ---- Certificate Manager: com.palm.certificatemanager -------------------------
        // The system's CAs; the demo CA added from the device's storage with
        // the picker, its details, distrusted, then deleted.
        await open("certificates");
        await page.waitForSelector("[data-testid='cert-isrg-root-x1']");
        check(await page.locator("[data-testid^='cert-'][role='button']").count() >= 7, "the system's root certificates are listed");
        await shot("certificates");
        await page.click("[data-testid='cert-add']");
        await page.waitForSelector("[data-testid='cert-file-phoenix-lab-root-ca.crt']");
        await shot("certificates-picker");
        await page.click("[data-testid='cert-file-phoenix-lab-root-ca.crt']");
        await page.waitForSelector("[data-testid='cert-notice']");
        const labRow = page.locator("[data-testid^='cert-user-']");
        check(/Phoenix Lab Root CA/.test(await labRow.first().textContent()), "the picked certificate is installed");
        const store = await svc("luna://com.palm.certificatemanager/listcertificates", {});
        check(store.userCertificateStore.length === 1 && store.userCertificateStore[0].commonname === "Phoenix Lab Root CA",
              "Wi-Fi's view (userCertificateStore) has it");
        await labRow.first().click();
        await page.waitForSelector("[data-testid='cert-sha256']");
        check((await page.textContent("[data-testid='cert-sha256']")).startsWith("06:1E:77:61"), "its SHA-256 fingerprint is shown");
        await shot("certificates-details");
        await page.click("[data-testid='cert-trusted']");
        await page.waitForSelector("[data-testid='cert-trusted'][aria-checked='false']");
        const userCerts = async () => (await svc("luna://com.palm.certificatemanager/listcertificates", {})).userCertificateStore;
        for (let i = 0; i < 30 && (await userCerts())[0].trusted !== false; ++i) await page.waitForTimeout(100);
        check((await userCerts())[0].trusted === false, "distrusted");
        await page.click("[data-testid='cert-delete']");
        await page.click("[data-testid='cert-delete-confirm']");
        await page.waitForSelector("[data-testid='cert-add']");
        for (let i = 0; i < 30 && (await userCerts()).length; ++i) await page.waitForTimeout(100);
        check((await userCerts()).length === 0, "deleted");

        // ---- Phone Preferences: call forwarding, data and roaming ----------------------
        await open("phone");
        await page.waitForSelector("[data-testid='phone-forward']");
        check(last().callForwarding !== true, "no call forwarding at first");
        await page.click("[data-testid='phone-forward']");
        await page.fill("[data-testid='phone-forward-number']", "(408) 555-0177");
        await page.click("[data-testid='phone-forward-save']");
        for (let i = 0; i < 30 && last().callForwarding !== true; ++i) await page.waitForTimeout(100);
        check(last().callForwarding === true, "call forwarding on reaches the shell (its status bar icon)");
        check(await page.evaluate(() => __phoenixRuntime.simulateIncomingCall({})) === 0, "a call that comes in is forwarded, not rung");
        await page.click("[data-testid='phone-data']");
        await page.waitForSelector("[data-testid='phone-data'][aria-checked='false']");
        check((await svc("luna://com.palm.wan/getstatus", {})).disablewan === "on", "Data Usage off: com.palm.wan disablewan on");
        await page.click("[data-testid='phone-data']");
        await page.click("[data-testid='phone-roaming']");
        await page.click("role=option[name='Enabled']");
        for (let i = 0; i < 30 && (await svc("luna://com.palm.wan/getstatus", {})).roamguard !== "disable"; ++i) await page.waitForTimeout(100);
        check((await svc("luna://com.palm.wan/getstatus", {})).roamguard === "disable", "Data Roaming enabled: roamguard disable");
        await page.waitForTimeout(200);
        await shot("phone");
        await page.click("[data-testid='phone-forward']");
        for (let i = 0; i < 30 && last().callForwarding !== false; ++i) await page.waitForTimeout(100);
        check(last().callForwarding === false, "call forwarding off reaches the shell");
        // Airplane mode: the network's settings cannot be read.
        await svc("luna://com.webos.service.connectionmanager/setstate", { offlineMode: "enabled" });
        await open("phone");
        await page.waitForSelector("[data-testid='phone-forward-status']");
        check(/network connection/.test(await page.textContent("[data-testid='phone-forward-status']")), "airplane mode: call forwarding needs the network");
        await shot("phone-airplane");
        await svc("luna://com.webos.service.connectionmanager/setstate", { offlineMode: "disabled" });

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
