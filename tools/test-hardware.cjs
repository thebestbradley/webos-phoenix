#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Hardware and drivers end to end: Settings > Hardware and First Use's
// Hardware step (apps/settings, apps/firstuse, built into dist/) in headless
// Chromium, with runtime/phoenix-runtime.js running the device's
// org.webosphoenix.hardware service (services/hardware) on the simulated
// device and the signed sample catalog (server/drivers/sample), and the
// driver catalog's report endpoint (server/drivers, PHP's built-in server).
// Covers: the hardware, working with the image's firmware, and the gaps;
// newer firmware installed after its licence (progress, the ongoing
// activity) beside the system's, and removed; a driver the kernel lacks, an
// opkg failure rolled back, then installed; the hardware report (IDs only)
// received by the server; another catalog with Developer Mode only, trusted
// by its fingerprint and marked; a catalog signed with another key refused;
// the image's firmware licences in Device Info; and First Use offering only
// what is missing.
//
//   node tools/test-hardware.cjs [--tablet] [--out DIR]
//
// Needs PHP 8 (with sodium) and the apps built.

"use strict";
const { spawn, execSync, execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
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
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "hardware-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const H = "luna://org.webosphoenix.hardware/";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}
async function waitFor(url) {
    for (let i = 0; ; i++) {
        try { await drained(fetch(url)); return; } catch (e) { /* not up */ }
        if (i > 100) throw new Error("did not start: " + url);
        await new Promise((r) => setTimeout(r, 100));
    }
}
const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
}), [uri, params]);

async function main() {
    for (const app of ["settings", "firstuse"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });

    const data = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-drivers-"));
    const reportPort = await freePort();
    const reports = spawn("php", ["-S", "127.0.0.1:" + reportPort, path.join(REPO, "server/drivers/public/router.php")],
                          { stdio: "ignore", env: Object.assign({}, process.env, { DRIVERS_DATA: data }) });
    // Another driver catalog (someone else's, its own key): made with server/drivers.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-other-drivers-"));
    const php = (args, env) => execFileSync("php", args, { env: Object.assign({}, process.env, env || {}) }).toString();
    fs.writeFileSync(path.join(other, "make.php"), `<?php
require '${path.join(REPO, "server/drivers/src/bootstrap.php")}';
file_put_contents('${other}/gadget.ipk', Phoenix\\Drivers\\PackageWriter::ipk('kernel-module-gadget', '1.0-r0', 'all', ['lib/modules/6.6.23-phoenix/updates/gadget.ko' => 'x']));
file_put_contents('${other}/driver.json', json_encode(['id' => 'module-gadget', 'kind' => 'module', 'title' => 'Gadget driver', 'category' => 'usb',
    'match' => ['usb:v1209p0001d*'], 'modules' => ['gadget'], 'after' => 'none',
    'license' => ['id' => 'GPL-2.0-only', 'name' => 'GPL 2.0', 'free' => true, 'redistributable' => true], 'packages' => ['gadget.ipk']]));
`);
    php([path.join(other, "make.php")]);
    const otherEnv = { DRIVERS_DATA: path.join(other, "data"), DRIVERS_NAME: "Gadget Fans" };
    php([path.join(REPO, "server/drivers/bin/drivers.php"), "add", path.join(other, "driver.json")], otherEnv);
    php([path.join(REPO, "server/drivers/bin/drivers.php"), "publish"], otherEnv);
    const otherFingerprint = php([path.join(REPO, "server/drivers/bin/drivers.php"), "pubkey", "--key", path.join(other, "data")]).trim().split("\n")[1];
    const otherPort = await freePort();
    const otherServer = spawn("php", ["-S", "127.0.0.1:" + otherPort, path.join(REPO, "server/drivers/public/router.php")],
                              { stdio: "ignore", env: Object.assign({}, process.env, otherEnv) });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html?launchParams=` + encodeURIComponent(JSON.stringify(params || {}));
    let browser;
    try {
        await waitFor(origin + "/apps.json");
        await waitFor(`http://127.0.0.1:${reportPort}/v1/report`);
        await waitFor(`http://127.0.0.1:${otherPort}/v1/key.json`);
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const text = async (sel) => ((await page.textContent(sel)) || "").replace(/\s+/g, " ");
        const open = async (params) => {
            await page.goto(appUrl("org.webosphoenix.settings", Object.assign({ page: "hardware" }, params || {})));
            await page.waitForSelector("[data-testid='hw-device-usb:1-2']", { timeout: 10000 });
        };
        const device = async (id) => {
            await page.click(`[data-testid='hw-device-${id}']`);
            await page.waitForSelector("[data-testid=hw-detail-status]");
        };
        const back = async () => {
            await page.keyboard.press("Escape");
            await page.waitForSelector("[data-testid=hw-catalog]");
        };

        await page.goto(appUrl("org.webosphoenix.settings", { page: "hardware" }));
        await page.evaluate((u) => {
            localStorage.clear();
            localStorage.setItem("phoenix:hardware:config", JSON.stringify({ reportUrl: u }));
        }, `http://127.0.0.1:${reportPort}/v1/report`);
        await open();

        // ---- The hardware: the image has its firmware; the gaps -------------------------------
        const status = async (id) => text(`[data-testid='hw-device-${id}']`);
        check(/Working · newer firmware available/.test(await status("usb:1-2")), "the Realtek dongle works with the image's firmware; the catalog has newer");
        check(/Needs a driver, available to install/.test(await status("usb:1-3")), "the RTL8812AU needs a driver the 6.6 kernel lacks, which the catalog has");
        check(/Working$/.test(await status("pci:0000:01:00.0")), "the NVIDIA card works (its firmware is in the image)");
        check(/No driver/.test(await status("usb:1-4")), "the USB gadget has no driver");
        check(/Working$/.test(await status("pci:0000:02:00.0")), "the Atheros Wi-Fi card works");
        check(/Phoenix Drivers \(sample\)/.test(await text("[data-testid=hw-catalog]")), "the signed sample catalog was read");
        await shot("1-hardware");

        // ---- Newer firmware, after its licence --------------------------------------------------
        await device("usb:1-2");
        check(/20240909-r0/.test(await text("[data-testid=hw-offer-included]")), "the device page says which firmware the system has");
        await shot("2-device");
        await page.click("[data-testid=hw-install-firmware-rtw88-update]");
        await page.waitForSelector("[data-testid=hw-license]");
        check(/LICENCE\.rtlwifi_firmware\.txt/.test(await text("[data-testid=hw-license-text]")), "the licence is shown before installing");
        await page.waitForTimeout(600);   // the dialog slides up
        await shot("3-license");
        host.length = 0;
        await page.click("[data-testid=hw-license-accept]");
        await page.waitForSelector("[data-testid=hw-progress]", { timeout: 5000 });
        await shot("4-progress");
        await page.waitForSelector("[data-testid=hw-notice]", { timeout: 15000 });
        check(/is installed/.test(await text("[data-testid=hw-notice]")), "installed");
        const ongoing = host.filter((m) => m.type === "ongoing");
        check(ongoing.some((m) => m.payload.title === "Newer Realtek Wi-Fi firmware (rtw88)" && m.payload.progress >= 0) &&
              ongoing.some((m) => m.payload.params && m.payload.params.page === "hardware"), "an ongoing activity while it installed");
        let sim = await page.evaluate(() => JSON.parse(localStorage.getItem("phoenix:hardware:sim")));
        check(sim.packages["linux-firmware-rtw88-update"] && sim.packages["linux-firmware-rtw88-update"].files.every((f) => f.startsWith("lib/firmware/updates/")),
              "it goes beside the system's firmware, in /lib/firmware/updates");
        await page.waitForFunction(() => /Working$/.test(document.querySelector("[data-testid=hw-detail-status]").textContent));
        check(/rtw88_8821cu/.test(await text("[data-testid=hw-detail-driver]")), "the dongle works on");
        await shot("5-installed");
        await page.click("[data-testid=hw-remove-firmware-rtw88-update]");
        await page.click("[data-testid=hw-remove-confirm]");
        await page.waitForSelector("[data-testid=hw-install-firmware-rtw88-update]", { timeout: 10000 });
        check(true, "removing it goes back to the system's firmware, and offers it again");
        await back();

        // ---- A driver the kernel lacks: a failure rolled back, then installed ------------------------
        await page.evaluate(() => localStorage.setItem("phoenix:hardware:sim",
            JSON.stringify(Object.assign(JSON.parse(localStorage.getItem("phoenix:hardware:sim") || "{}"), { fail: { opkg: "Collected errors: check_data_file_clashes" } }))));
        await device("usb:1-3");
        await page.click("[data-testid=hw-install-module-rtl8812au]");
        await page.waitForSelector("[data-testid=hw-error]", { timeout: 15000 });
        check(/check_data_file_clashes\. Your device was put back as it was\./.test(await text("[data-testid=hw-error]")), "an opkg failure is undone and said so");
        await shot("6-failed");
        sim = await page.evaluate(() => JSON.parse(localStorage.getItem("phoenix:hardware:sim")));
        check(!sim.packages["kernel-module-88xxau-6.6.23-phoenix"], "nothing of it is left installed");
        await page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem("phoenix:hardware:sim"));
            delete s.fail;
            localStorage.setItem("phoenix:hardware:sim", JSON.stringify(s));
        });
        await page.click("[data-testid=hw-install-module-rtl8812au]");
        await page.waitForSelector("[data-testid=hw-notice]", { timeout: 15000 });
        await page.waitForFunction(() => /Working/.test(document.querySelector("[data-testid=hw-detail-status]").textContent));
        check(/88XXau/.test(await text("[data-testid=hw-detail-driver]")), "then the open source driver installs without a licence to accept, and works");
        await back();

        // ---- The hardware report --------------------------------------------------------------------
        await page.click("[data-testid=hw-report-open]");
        await page.waitForSelector("[data-testid=hw-report-ids]");
        const shown = await page.textContent("[data-testid=hw-report-ids]");
        check(shown.trim() === "usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00", "the report shows only the unknown gadget's ID");
        await page.waitForTimeout(600);
        await shot("8-report");
        await page.click("[data-testid=hw-report-send]");
        await page.waitForSelector("[data-testid=hw-report-result]");
        check(/Sent/.test(await text("[data-testid=hw-report-result]")), "sent");
        const kept = fs.readFileSync(path.join(data, "reports.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        check(kept.length === 1 && kept[0].devices[0].ids[0] === "usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00" && kept[0].arch === "x86_64" &&
              Object.keys(kept[0]).join() === "day,arch,kernel,devices", "the catalog service kept the IDs and the day, nothing else");
        await page.keyboard.press("Escape");

        // ---- Another catalog: Developer Mode only, trusted by its fingerprint, marked -----------------
        check(await page.locator("[data-testid=hw-source-add]").count() === 0, "no other catalogs without Developer Mode");
        await luna(page, "luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        await open();
        await page.click("[data-testid=hw-source-add]");
        await page.fill("[data-testid=hw-source-url] input, input[data-testid=hw-source-url]", `http://127.0.0.1:${otherPort}/v1/`);
        await page.click("[data-testid=hw-source-look]");
        await page.waitForSelector("[data-testid=hw-source-fingerprint]");
        const fp = (await page.textContent("[data-testid=hw-source-fingerprint]")).trim();
        check(fp === otherFingerprint, "the catalog's key fingerprint is shown to check (" + fp + ")");
        await page.waitForTimeout(600);
        await shot("9-other-catalog");
        await page.click("[data-testid=hw-source-trust]");
        await page.waitForSelector("[data-testid=hw-source-dialog]", { state: "detached" });
        await page.waitForFunction(() => /needs a driver/i.test(document.querySelector("[data-testid='hw-device-usb:1-4']").textContent), null, { timeout: 10000 });
        await device("usb:1-4");
        check(/Gadget Fans, a catalog you added, not Phoenix's/.test(await text("[data-testid=hw-offer-thirdparty]")), "its driver is marked as not Phoenix's");
        await shot("10-other-driver");
        await page.click("[data-testid=hw-install-module-gadget]");
        await page.waitForSelector("[data-testid=hw-notice]", { timeout: 15000 });
        check(/is installed/.test(await text("[data-testid=hw-notice]")), "and installs");
        await back();
        await luna(page, "luna://com.webos.service.devmode/setDevMode", { status: "disabled" });
        const off = await luna(page, H + "list", {});
        check(off.devices.find((d) => d.id === "usb:1-4").offers.length === 0 && off.sources.some((x) => x.thirdParty && /Developer Mode/.test(x.error.errorText)),
              "with Developer Mode off, the other catalog is not used");

        // ---- A catalog signed with another key ---------------------------------------------------------------
        await page.evaluate(() => {
            const c = JSON.parse(localStorage.getItem("phoenix:hardware:config"));
            const sample = JSON.parse(PalmSystem.getResource("/usr/share/phoenix/hardware/sample/catalog-sim.json"));
            c.sources = [Object.assign({}, sample.sources[0], { key: "ZmFrZWtleWZha2VrZXlmYWtla2V5ZmFrZWtleWZha2U=" })];
            localStorage.setItem("phoenix:hardware:config", JSON.stringify(c));
        });
        const refused = await luna(page, H + "refresh", {});
        check(refused.catalog.error && refused.catalog.error.errorCode === "BAD_SIGNATURE", "a catalog that is not signed with the pinned key is refused");
        check(refused.devices.find((d) => d.id === "usb:1-2").offers.length === 1, "... and the last good one is kept");
        await page.evaluate(() => localStorage.removeItem("phoenix:hardware:config"));

        // ---- The firmware's licences, in Device Info ---------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.settings", { page: "deviceinfo" }));
        await page.click("[data-testid=licenses]");
        await page.waitForSelector("[data-testid=firmware-packages]");
        check(/linux-firmware-rtl8821 20240909-r0 \(Firmware-rtlwifi_firmware\)/.test(await text("[data-testid=firmware-packages]")),
              "Device Info lists the firmware in the system with its licences");
        await page.click("[data-testid='firmware-license-LICENCE.rtlwifi_firmware.txt']");
        await page.waitForFunction(() => /Realtek/.test(document.body.innerText));
        await shot("11-firmware-licences");

        // ---- First Use, on a new device -------------------------------------------------------------------
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.firstuse", {}));
        await page.waitForSelector("[data-testid=step-welcome]");
        await page.click("[data-testid=next]");
        await page.waitForSelector("[data-testid=step-wifi]");
        await page.click("[data-testid=next]");
        await page.waitForSelector("[data-testid='fu-hw-usb:1-3']");
        check(await page.locator("[data-testid='fu-hw-usb:1-3']").count() === 1 && await page.locator("[data-testid='fu-hw-usb:1-2']").count() === 0,
              "First Use offers the driver that is missing, not the newer firmware");
        await shot("12-firstuse");
        await page.click("[data-testid='fu-hw-install-usb:1-3']");
        await page.waitForFunction(() => /Installed/.test(document.querySelector("[data-testid='fu-hw-usb:1-3']").textContent), null, { timeout: 15000 });
        check(true, "First Use installs it (open source: no licence to accept)");
        await shot("13-firstuse-installed");
        await page.click("[data-testid=next]");
        await page.waitForSelector("[data-testid=step-restore]");
        check(true, "and goes on to Restore");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        reports.kill();
        otherServer.kill();
        fs.rmSync(data, { recursive: true, force: true });
        fs.rmSync(other, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
