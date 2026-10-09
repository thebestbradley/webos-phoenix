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
// Covers: the hardware and what each device needs; firmware installed after
// its licence (progress, the ongoing activity) and the device working; an
// opkg failure rolled back, then the driver installed; an optional driver
// that starts after a restart; removing; a catalog signed with another key
// refused; the hardware report (IDs only) received by the server; and First
// Use offering what the hardware needs.
//
//   node tools/test-hardware.cjs [--tablet] [--out DIR]
//
// Needs PHP 8 (with sodium) and the apps built.

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

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
        try { await fetch(url); return; } catch (e) { /* not up */ }
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
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html?launchParams=` + encodeURIComponent(JSON.stringify(params || {}));
    let browser;
    try {
        await waitFor(origin + "/apps.json");
        await waitFor(`http://127.0.0.1:${reportPort}/v1/report`);
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

        // ---- The hardware -------------------------------------------------------------------
        const status = async (id) => text(`[data-testid='hw-device-${id}']`);
        check(/Needs firmware, available to install/.test(await status("usb:1-2")), "the Realtek dongle needs firmware, which the catalog has");
        check(/Needs a driver, available to install/.test(await status("usb:1-3")), "the RTL8812AU needs a driver, which the catalog has");
        check(/Working · optional driver available/.test(await status("pci:0000:01:00.0")), "the NVIDIA card works, with an optional extra");
        check(/No driver/.test(await status("usb:1-4")), "the USB gadget has no driver");
        check(/Working$/.test(await status("pci:0000:02:00.0")), "the Atheros Wi-Fi card works");
        check(/Phoenix Drivers \(sample\)/.test(await text("[data-testid=hw-catalog]")), "the signed sample catalog was read");
        await shot("1-hardware");

        // ---- Firmware, after its licence ---------------------------------------------------------
        await device("usb:1-2");
        check(/rtw88\/rtw8821c_fw\.bin/.test(await text("[data-testid=hw-detail-missing]")), "the device page names the missing firmware");
        await shot("2-device");
        await page.click("[data-testid=hw-install-firmware-rtw88]");
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
        check(ongoing.some((m) => m.payload.title === "Realtek Wi-Fi firmware (rtw88)" && m.payload.progress >= 0) &&
              ongoing.some((m) => m.payload.params && m.payload.params.page === "hardware"), "an ongoing activity while it installed");
        await page.waitForFunction(() => /Working/.test(document.querySelector("[data-testid=hw-detail-status]").textContent));
        check(/rtw88_8821cu/.test(await text("[data-testid=hw-detail-driver]")), "the dongle works, with its driver");
        await shot("5-installed");
        await back();

        // ---- A failure, rolled back ----------------------------------------------------------------
        await page.evaluate(() => localStorage.setItem("phoenix:hardware:sim",
            JSON.stringify(Object.assign(JSON.parse(localStorage.getItem("phoenix:hardware:sim") || "{}"), { fail: { opkg: "Collected errors: check_data_file_clashes" } }))));
        await device("usb:1-3");
        await page.click("[data-testid=hw-install-module-rtl8812au]");
        await page.waitForSelector("[data-testid=hw-error]", { timeout: 15000 });
        check(/check_data_file_clashes\. Your device was put back as it was\./.test(await text("[data-testid=hw-error]")), "an opkg failure is undone and said so");
        await shot("6-failed");
        const sim = await page.evaluate(() => JSON.parse(localStorage.getItem("phoenix:hardware:sim")));
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

        // ---- An optional driver, after a restart ------------------------------------------------------
        await device("pci:0000:01:00.0");
        await page.click("[data-testid=hw-install-firmware-nvidia-gsp]");
        await page.click("[data-testid=hw-license-accept]");
        await page.waitForSelector("[data-testid=hw-restart]", { timeout: 15000 });
        check(/starts when you restart/.test(await text("[data-testid=hw-notice]")), "an optional firmware that starts with the next restart");
        await shot("7-restart");
        await back();
        check(/Restart to finish/.test(await status("pci:0000:01:00.0")) && await page.locator("[data-testid=hw-restart-all]").count() === 1,
              "the list asks for a restart");
        // The simulated restart reloads the page.
        await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("[data-testid=hw-restart-all]")]);
        await page.waitForSelector("[data-testid='hw-device-pci:0000:01:00.0']", { timeout: 10000 });
        check(/^.*Working$/.test(await status("pci:0000:01:00.0")) && await page.locator("[data-testid=hw-restart-all]").count() === 0,
              "after the restart it has started");

        // ---- Removing ---------------------------------------------------------------------------------
        await device("usb:1-2");
        await page.click("[data-testid=hw-remove-firmware-rtw88]");
        await page.click("[data-testid=hw-remove-confirm]");
        await page.waitForFunction(() => /Needs firmware/.test(document.querySelector("[data-testid=hw-detail-status]").textContent), null, { timeout: 10000 });
        check(true, "removing the firmware: the dongle needs it again");
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

        // ---- First Use ---------------------------------------------------------------------------------
        await page.goto(appUrl("org.webosphoenix.firstuse", {}));
        await page.waitForSelector("[data-testid=step-welcome]");
        await page.click("[data-testid=next]");
        await page.waitForSelector("[data-testid=step-wifi]");
        await page.click("[data-testid=next]");
        await page.waitForSelector("[data-testid=step-hardware]");
        check(await page.locator("[data-testid='fu-hw-usb:1-2']").count() === 1 && await page.locator("[data-testid='fu-hw-pci:0000:01:00.0']").count() === 0,
              "First Use offers the firmware the dongle needs, not the optional extra");
        await shot("9-firstuse");
        await page.click("[data-testid='fu-hw-install-usb:1-2']");
        await page.waitForSelector("[data-testid=fu-hw-license]");
        await page.click("[data-testid=fu-hw-accept]");
        await page.waitForFunction(() => /Installed/.test(document.querySelector("[data-testid='fu-hw-usb:1-2']").textContent), null, { timeout: 15000 });
        check(true, "First Use installs it after the licence");
        await shot("10-firstuse-installed");
        await page.click("[data-testid=next]");
        await page.waitForSelector("[data-testid=step-restore]");
        check(true, "and goes on to Restore");

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        reports.kill();
        fs.rmSync(data, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
