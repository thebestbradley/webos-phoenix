#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator refuses the Luna calls ls-hubd would (docs/SIM-PARITY.md,
// "Bus permissions"; runtime/phoenix-runtime.js, "Bus permissions"), in
// headless Chromium over tools/serve-rootfs.py:
//
//   1. a call whose api groups the caller holds none of is refused with
//      luna-service2's answer ({returnValue: false, errorCode: -1,
//      errorText: "Denied method call \"m\" for category \"/c\""}), and the
//      service never runs; a method in no api group is refused the same
//      way; a legacy name is checked as the name it is on a device; an
//      allowed call is answered;
//   2. a service outside its role's outbound list: "Not permitted to send
//      to <service>.";
//   3. PHOENIX_BUS_PERMISSIONS=log: the same call is answered, with a
//      warning in the console;
//   4. a frame in Accounts' card calls with Accounts' groups (#116): a
//      connector's sign-in method its own app may not call is allowed from
//      the frame;
//   5. every connector's sign-in page (each account template's
//      validator.customUI, the catalog connectors' included), opened by
//      Accounts as on a device ({templateId}), is drawn and none of its
//      calls is refused.
//
//   node tools/test-sim-permissions.cjs [--out DIR]
//
// Needs Playwright (NODE_PATH="$(npm root -g)") and the apps built.

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
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "sim-permissions-tests");
fs.mkdirSync(outDir, { recursive: true });
const TABLE = JSON.parse(fs.readFileSync(path.join(REPO, "tools/devicecheck/bus-permissions.json"), "utf8"));
const ACCOUNTS = "com.palm.app.accounts";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

const HTML = "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<script src=\"/usr/share/phoenix/runtime/phoenix-runtime.js\"></script></head><body><p>permissions</p></body></html>";
const pageOf = (appId) => `/usr/palm/applications/${appId}/permissions-test.html`;

const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
    window.__keep = (window.__keep || []).concat([b]);
}), [uri, params]);

// Phoenix's catalog connectors (apps/connectors/*), installed as the
// Marketplace would: a folder laid out like the device's root
// (serve-rootfs.py --extra-rootfs) with each app at its id.
function connectorRootfs() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-connectors-"));
    const apps = path.join(dir, "usr", "palm", "applications");
    fs.mkdirSync(apps, { recursive: true });
    const base = path.join(REPO, "apps", "connectors");
    for (const name of fs.readdirSync(base)) {
        const info = path.join(base, name, "appinfo.json");
        if (!fs.existsSync(info)) continue;
        const id = JSON.parse(fs.readFileSync(info, "utf8")).id;
        fs.symlinkSync(path.join(base, name), path.join(apps, id));
    }
    return dir;
}

// Every account template with a sign-in page of its own: [{template, appId, name}].
function signInPages(extra) {
    const out = [];
    const dirs = [path.join(REPO, "apps"), path.join(extra, "usr", "palm", "applications")];
    for (const base of dirs) {
        for (const n of fs.readdirSync(base)) {
            const tdir = path.join(base, n, "public", "accounts");
            if (!fs.existsSync(tdir)) continue;
            for (const t of fs.readdirSync(tdir)) {
                const f = path.join(tdir, t, t + ".json");
                if (!fs.existsSync(f)) continue;
                const ui = ((JSON.parse(fs.readFileSync(f, "utf8")).validator || {}).customUI) || null;
                if (ui && ui.appId && ui.name) out.push({ template: t, appId: ui.appId, name: ui.name });
            }
        }
    }
    return out.sort((a, b) => a.template.localeCompare(b.template));
}

async function serve(env, installedDir, extra) {
    const port = await servers.freePort();
    const proc = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir,
        "--extra-rootfs", extra], { stdio: "ignore", env: Object.assign({}, process.env, env) });
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
        try { const r = await fetch(origin + "/apps.json"); await r.arrayBuffer(); if (r.ok) break; } catch (e) { /* not up */ }
        if (i > 150) throw new Error("serve-rootfs did not start");
        await new Promise((r) => setTimeout(r, 100));
    }
    return { proc, origin };
}

async function main() {
    const { chromium } = loadPlaywright();
    const extra = connectorRootfs();
    const enforcing = await serve({ PHOENIX_BUS_PERMISSIONS: "enforce", PHOENIX_BUS_LOG: "" },
        fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-")), extra);
    const logging = await serve({ PHOENIX_BUS_PERMISSIONS: "log", PHOENIX_BUS_LOG: "" },
        fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-")), extra);
    let browser;
    try {
        browser = await chromium.launch();
        const open = async (origin, appId, warnings) => {
            const ctx = await browser.newContext();
            await ctx.route(/\/permissions-test\.html$/, (route) => route.fulfill({ contentType: "text/html", body: HTML }));
            const p = await ctx.newPage();
            p.on("console", (m) => { if (/\[phoenix-runtime\] bus:/.test(m.text())) warnings.push(m.text()); });
            await p.goto(origin + pageOf(appId));
            await p.waitForFunction(() => !!window.__phoenixRuntime);
            return p;
        };

        // 1. Refused, as the hub refuses.
        const groupsOf = (id) => new Set((TABLE.apps[id] || {}).groups || []);
        const lamp = "org.webosphoenix.flashlight", settings = "org.webosphoenix.settings";
        check(!groupsOf(lamp).has("phoenix.devmode.management") && !groupsOf(lamp).has("audio.operation"),
            "the Flashlight holds neither phoenix.devmode.management nor audio.operation (the table)");
        const warned = [];
        const fl = await open(enforcing.origin, lamp, warned);
        check(await fl.evaluate(() => __phoenixRuntime.bus.mode()) === "enforce", "PHOENIX_BUS_PERMISSIONS=enforce: the runtime refuses");
        let r = await luna(fl, "luna://com.webos.service.devmode/setDevMode", { enabled: true });
        check(r.returnValue === false && r.errorCode === -1 && r.errorText === "Denied method call \"setDevMode\" for category \"/\"",
            "setDevMode from the Flashlight: luna-service2's refusal (" + JSON.stringify(r) + ")");
        r = await luna(fl, "luna://com.webos.service.audio/master/setVolume", { volume: 3 });
        check(r.returnValue === false && r.errorText === "Denied method call \"setVolume\" for category \"/master\"",
            "a method in a category: its category in the text (" + JSON.stringify(r) + ")");
        r = await luna(fl, "luna://com.webos.service.devmode/noSuchMethod", {});
        check(r.returnValue === false && r.errorText === "Denied method call \"noSuchMethod\" for category \"/\"",
            "a method no api group names is refused too (" + JSON.stringify(r) + ")");
        check(warned.some((w) => /refused org\.webosphoenix\.flashlight -> luna:\/\/com\.webos\.service\.devmode\/setDevMode \(needs one of phoenix\.devmode\.management\)/.test(w)),
            "the console says who was refused and which groups would do (" + (warned[0] || "nothing") + ")");
        const st = await open(enforcing.origin, settings, []);
        r = await luna(st, "luna://com.webos.service.devmode/getDevMode", {});
        check(r.returnValue === true && r.enabled === false, "Settings may ask (phoenix.devmode.query): answered, and the refused setDevMode never ran (" + JSON.stringify(r) + ")");
        r = await luna(fl, "luna://com.webos.service.torch/toggle", {});
        check(!(r.errorText || "").startsWith("Denied"), "a service with no api files in the table is not checked");
        // The legacy names: checked as the name a device's hub sees.
        const sysGet = (TABLE.services["com.webos.service.systemservice"].methods["getPreferences"] || []);
        check(sysGet.length > 0 && TABLE.aliases["com.palm.systemservice"] === "com.webos.service.systemservice",
            "com.palm.systemservice is com.webos.service.systemservice on a device");
        const calc = await open(enforcing.origin, "com.palm.app.calculator", []);
        r = await luna(calc, "palm://com.palm.systemservice/getPreferences", { keys: ["timeFormat"] });
        check(r.returnValue === false && r.errorText === "Denied method call \"getPreferences\" for category \"/\"",
            "an app without " + sysGet.join("|") + " is refused com.palm.systemservice/getPreferences (" + JSON.stringify(r) + ")");
        r = await luna(st, "palm://com.palm.systemservice/getPreferences", { keys: ["timeFormat"] });
        check(r.returnValue === true, "Settings, which holds it, is answered");
        // An app installed since the table was written: its appinfo.json.
        check(await fl.evaluate(() => __phoenixRuntime.bus.refusal("luna://com.webos.service.devmode/getDevMode", "org.example.nobody")) !== null,
            "an app the table does not know has only what everyone has");

        // 2. A service's role: its outbound list.
        const svc = Object.keys(TABLE.clients).find((n) => (TABLE.clients[n].outbound || []).length && !TABLE.clients[n].outbound.includes("*") &&
            !TABLE.clients[n].outbound.some((o) => /\*/.test(o)) && !TABLE.clients[n].outbound.includes("com.palm.db"));
        const out = await fl.evaluate((s) => __phoenixRuntime.bus.refusal("luna://com.palm.db/find", s, true), svc);
        check(!!out && out.reply.errorCode === -1 && out.reply.errorText === "Not permitted to send to com.palm.db.",
            svc + " calling com.palm.db, outside its outbound list: \"Not permitted to send to com.palm.db.\" (" + JSON.stringify(out && out.reply) + ")");

        // 3. Log only.
        const logged = [];
        const fl2 = await open(logging.origin, lamp, logged);
        check(await fl2.evaluate(() => __phoenixRuntime.bus.mode()) === "log", "PHOENIX_BUS_PERMISSIONS=log: the runtime only warns");
        r = await luna(fl2, "luna://com.webos.service.devmode/getDevMode", {});
        check(r.returnValue === true, "the Flashlight's getDevMode is answered (" + JSON.stringify(r) + ")");
        check(logged.some((w) => /would refuse org\.webosphoenix\.flashlight -> luna:\/\/com\.webos\.service\.devmode\/getDevMode/.test(w)),
            "with a warning that a device would refuse it (" + (logged[0] || "nothing") + ")");

        // 4 and 5. Accounts' sign-in frames.
        const accountsGroups = groupsOf(ACCOUNTS);
        const pages = signInPages(extra);
        check(pages.length >= 15, pages.length + " sign-in pages (account templates with validator.customUI)");
        let shownCaller = false;
        for (const sp of pages) {
            const refused = [], errors = [];
            const ctx = await browser.newContext({ viewport: { width: 320, height: 480 } });
            const p = await ctx.newPage();
            p.on("console", (m) => { if (/\[phoenix-runtime\] bus: refused/.test(m.text())) refused.push(m.text()); });
            p.on("pageerror", (e) => errors.push(e.message));
            await p.goto(enforcing.origin + "/usr/palm/applications/com.palm.app.accounts/index.html?launchParams=" +
                encodeURIComponent(JSON.stringify({ templateId: sp.template })));
            const re = new RegExp("/" + sp.appId.replace(/\./g, "\\.") + "/" + sp.name.replace(/\./g, "\\.") + "(\\?|$)");
            let frame = null;
            for (let t = 0; t < 15000 && !frame; t += 250) {
                frame = p.frames().find((f) => re.test(f.url())) || null;
                if (!frame) await p.waitForTimeout(250);
            }
            if (!check(!!frame, sp.template + ": Accounts frames " + sp.appId + "/" + sp.name)) { await ctx.close(); continue; }
            const drawn = await frame.locator("input:visible, button:visible, .enyo-button:visible, [role=button]:visible").first()
                .waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
            await p.waitForTimeout(800);
            await p.screenshot({ path: path.join(outDir, sp.template + ".png") });
            const caller = await frame.evaluate(() => __phoenixRuntime.bus.pageCaller()).catch(() => null);
            check(drawn && caller === ACCOUNTS && refused.length === 0,
                sp.template + ": drawn, calls as " + caller + ", nothing refused" +
                (refused.length ? " (" + refused.join("; ") + ")" : "") + (errors.length ? " [page errors: " + errors.join("; ") + "]" : ""));
            // #116: a sign-in method Accounts holds a group for and the
            // connector's own app does not.
            if (!shownCaller) {
                const own = new Set(TABLE.everyone);
                let pick = null;
                for (const [name, s] of Object.entries(TABLE.services)) {
                    for (const [m, gs] of Object.entries(s.methods)) {
                        if (!pick && !/[*?[]/.test(m) && gs.some((g) => accountsGroups.has(g)) && !gs.some((g) => own.has(g)) &&
                            gs.some((g) => /^phoenix\.[a-z]+\.signin$/.test(g))) pick = "luna://" + name + "/" + m;
                    }
                }
                const inFrame = await frame.evaluate((u) => __phoenixRuntime.bus.refusal(u, __phoenixRuntime.bus.pageCaller()), pick);
                const alone = await frame.evaluate(([u, id]) => __phoenixRuntime.bus.refusal(u, id), [pick, sp.appId]);
                check(!!pick && inFrame === null && alone !== null,
                    "in Accounts' frame " + pick + " is allowed (Accounts' groups); as " + sp.appId + " alone it would be refused");
                shownCaller = true;
            }
            await ctx.close();
        }
    } finally {
        if (browser) await browser.close();
        enforcing.proc.kill();
        logging.proc.kill();
        fs.rmSync(extra, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
