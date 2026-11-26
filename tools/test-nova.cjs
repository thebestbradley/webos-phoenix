#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dev push end to end in the simulator (docs/DEV-PUSH.md 11): Settings >
// Developer Mode (apps/settings, built into dist/) in headless Chromium,
// served by tools/serve-rootfs.py, with the runtime's org.webosphoenix.nova
// talking to the simulator's novad (services/nova/sim.js over
// serve-rootfs's data folder), and the nova command (tools/nova) as a
// developer runs it. Covers: Pair a Computer's code typed into `nova pair -d
// sim`, the computer then listed; `nova put` of a shell QML file and of a
// web app's page, served from the developer overlay over the checkout (the
// QML only from the overlay: the checkout's is phoenix-sim's own), the
// restarts asked of the simulator (the shell; the app, which reopens with
// the new page); Pushed Changes listing them; `nova revert PATH`; Revert to
// Image from Settings, cleared at the simulator's restart; and nothing
// served from the overlay with Developer Mode off.
//
//   node tools/test-nova.cjs [--tablet] [--out DIR]
//
// Needs the apps built (apps/settings/dist).

"use strict";
const { spawn, spawnSync, execSync } = require("child_process");
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "nova-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const QML = "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml";
const SETTINGS_PAGE = "/usr/palm/applications/org.webosphoenix.settings/index.html";

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
async function waitFor(fn, what, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ }
        if (Date.now() > end) throw new Error("timed out: " + what);
        await new Promise((r) => setTimeout(r, 100));
    }
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        console.error("apps/settings/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-nova-"));
    const installed = path.join(tmp, "installed"), data = path.join(installed, "data"), config = path.join(tmp, "config");
    fs.mkdirSync(data, { recursive: true });
    const env = Object.assign({}, process.env, { XDG_CONFIG_HOME: config });
    const novaCli = (...a) => new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(REPO, "tools/nova/nova.cjs"), ...a], { env });
        let out = "", err = "";
        p.stdout.on("data", (c) => { out += c; });
        p.stderr.on("data", (c) => { err += c; });
        p.on("close", (code) => resolve({ code, out, err }));
    });
    let simd = null;
    function startSim() {
        fs.rmSync(path.join(data, "var/luna/nova/sim.json"), { force: true });
        simd = spawn(process.execPath, [path.join(REPO, "services/nova/sim.js"), "--data", data, "--repo", REPO], { env, stdio: ["ignore", "ignore", "inherit"] });
        return waitFor(() => fs.existsSync(path.join(data, "var/luna/nova/sim.json")), "the simulator's novad");
    }
    function stopSim() {
        return new Promise((resolve) => { if (!simd || simd.exitCode !== null) return resolve(); simd.once("close", resolve); simd.kill("SIGTERM"); });
    }
    const restartFile = path.join(data, "var/luna/nova/restart.json");
    const restarts = () => { try { return JSON.parse(fs.readFileSync(restartFile, "utf8")).restart; } catch (e) { return null; } };

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installed], { stdio: "ignore" });
    const served = (p) => fetch(origin + p).then((r) => (r.status === 200 ? r.text() : null));
    const settingsUrl = `${origin}${SETTINGS_PAGE}?launchParams=${encodeURIComponent(JSON.stringify({ page: "devmode" }))}`;
    let browser;
    try {
        await startSim();
        await waitFor(() => served("/apps.json"), "serve-rootfs");
        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
        const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true }); };
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);

        // Developer Mode on, as Settings turns it on.
        await page.goto(settingsUrl);
        await page.evaluate(() => localStorage.clear());
        await luna("luna://com.webos.service.systemservice/setPreferences", { devModeUnlocked: true });
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        await page.goto(settingsUrl);

        // ---- Pair a Computer ----------------------------------------------------------------------
        await page.waitForSelector("[data-testid=devpush-pair]", { timeout: 20000 });
        check((await page.textContent("[data-testid=devpush-summary]")).includes("Its image"), "Pushed Changes: the device runs its image");
        await page.click("[data-testid=devpush-pair]");
        await page.waitForSelector("[data-testid=devpush-code]");
        const code = (await page.textContent("[data-testid=devpush-code]")).replace(/\s/g, "");
        check(/^\d{6}$/.test(code), "Pair a Computer shows a six-digit code: " + code);
        await shot("1-pair-code");
        const wrong = await novaCli("pair", "-d", "sim", "--code", code === "000000" ? "000001" : "000000");
        check(wrong.code === 1 && /not the one the device shows/.test(wrong.err), "a wrong code is refused, in plain words");
        const paired = await novaCli("pair", "-d", "sim", "--code", code, "--name", "Test laptop");
        check(paired.code === 0 && /Paired with webOS Phoenix simulator as "sim"/.test(paired.out), "nova pair -d sim with the code: " + paired.out.trim());
        await page.waitForSelector("[data-testid=devpush-paired]", { timeout: 5000 });
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=devpush-computer]")].some((e) => e.textContent.includes("Test laptop")));
        check(true, "Settings says it is paired, and lists the computer");

        // ---- nova put: the shell's QML and a web app's page ---------------------------------------
        const qml = path.join(tmp, "CardView.qml");
        fs.writeFileSync(qml, "// pushed by tools/test-nova.cjs\n" + fs.readFileSync(path.join(REPO, "shell/qml/Phoenix/Shell/CardView.qml"), "utf8"));
        const put1 = await novaCli("put", "-d", "sim", QML, qml, "--note", "A shell change");
        check(put1.code === 0 && /restarted shell/.test(put1.out), "nova put of a QML file: applied, the shell restarts");
        await waitFor(() => (restarts() || []).includes("shell"), "the restart request");
        check(true, "the simulator is asked to restart its shell");
        check((await served(QML)).startsWith("// pushed by tools/test-nova.cjs"), "the simulator serves the pushed QML over the checkout's");

        const original = await served(SETTINGS_PAGE);
        const changed = path.join(tmp, "index.html");
        fs.writeFileSync(changed, original.replace("<head>", "<head><meta name=\"nova-test\" content=\"pushed\">"));
        const put2 = await novaCli("put", "-d", "sim", SETTINGS_PAGE, changed);
        check(put2.code === 0 && /restarted app:org.webosphoenix.settings/.test(put2.out), "nova put of a web app's page: the app restarts");
        await waitFor(() => JSON.stringify(restarts()) === JSON.stringify(["app:org.webosphoenix.settings"]), "the app's restart");
        await page.goto(settingsUrl);
        await page.waitForSelector("[data-testid=devpush-summary]");
        check(await page.evaluate(() => document.querySelector("meta[name=nova-test]")?.getAttribute("content")) === "pushed",
              "the app reopens with the pushed page");
        await page.waitForFunction(() => /2 files changed/.test(document.querySelector("[data-testid=devpush-summary]").textContent));
        const listed = await page.$$eval("[data-testid=devpush-file]", (els) => els.map((e) => e.textContent));
        check(listed.some((t) => t.includes(QML)) && listed.some((t) => t.includes(SETTINGS_PAGE) && t.includes("Test laptop")),
              "Pushed Changes lists both files, and who sent them");
        await shot("2-pushed-changes");

        const st = await novaCli("status", "-d", "sim");
        check(/2 files changed/.test(st.out), "nova status: " + st.out.split("\n")[1]);
        const back = await novaCli("revert", "-d", "sim", QML);
        // (The pages are not served the shell's QML: phoenix-sim's QML engine reads it, SimNovaUrlInterceptor.)
        check(back.code === 0 && (await served(QML)) === null, "nova revert PATH: the QML is the checkout's again");

        // ---- Developer Mode off: the overlay is not read from the next start -----------------------
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "disabled" });
        // novad is told at once, with no further nova call (Settings stops asking).
        await waitFor(() => !fs.existsSync(path.join(data, "var/luna/dev-mode-enabled")), "novad told Developer Mode is off");
        const refused = await novaCli("status", "-d", "sim");
        check(refused.code !== 0, "Developer Mode off: a paired computer is refused at once");
        await stopSim();
        await startSim();
        check(!(await served(SETTINGS_PAGE)).includes("nova-test"), "Developer Mode off: nothing is served from the overlay after a restart");
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        await luna("luna://org.webosphoenix.nova/getStatus", {});
        await stopSim();
        await startSim();
        check((await served(SETTINGS_PAGE)).includes("nova-test"), "on again: the overlay is back");

        // ---- Revert to Image ----------------------------------------------------------------------
        await page.goto(settingsUrl);
        await page.waitForSelector("[data-testid=devpush-revert]", { timeout: 20000 });
        await page.click("[data-testid=devpush-revert]");
        await page.waitForSelector("[data-testid=devpush-revert-yes]");
        await shot("3-revert-confirm");
        await page.click("[data-testid=devpush-revert-yes]");
        await waitFor(() => JSON.stringify(restarts()) === JSON.stringify(["reboot"]), "the restart for Revert to Image");
        check(true, "Revert to Image asks the simulator to restart");
        await stopSim();
        // phoenix-sim runs the boot step alone before it picks the shell's
        // QML (simnova.h bootDeveloperOverlay), so it never picks a tree the
        // Revert is about to delete.
        const boot = spawnSync(process.execPath, [path.join(REPO, "services/nova/sim.js"), "--data", data, "--boot-only"], { env, encoding: "utf8" });
        check(boot.status === 0 && /Revert to Image/.test(boot.stdout) && !fs.existsSync(path.join(data, "var/lib/phoenix/overlay")),
              "the boot step alone (--boot-only) clears the overlay before the simulator's QML is picked");
        await startSim();
        check(!fs.existsSync(path.join(data, "var/lib/phoenix/overlay")), "at the restart the overlay is gone");
        check(!(await served(SETTINGS_PAGE)).includes("nova-test"), "and the checkout's page is served again");
        await page.goto(settingsUrl);
        await page.waitForFunction(() => /Its image/.test(document.querySelector("[data-testid=devpush-summary]")?.textContent || ""), null, { timeout: 20000 });
        check(true, "Pushed Changes: the device runs its image again");
        await shot("4-reverted");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    } finally {
        if (browser) await browser.close();
        await stopSim();
        rootfs.kill();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
