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
        await shot("textassist");

        // ---- Device Info: the phone, and the legacy reset options ----------------------
        // Erase Apps & Data keeps the files on the USB drive; Full Erase does not.
        const svc = (uri, params) => page.evaluate(([u, p]) => new Promise((resolve) => {
            __phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);
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
