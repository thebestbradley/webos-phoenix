#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The user agent policy in phoenix-sim (shell/sim/useragent.h; the
// owner's decision of 15 October 2026, docs/DECISIONS.md): what a site
// receives (User-Agent, Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform,
// and the high-entropy hints once asked for) and what its page reads
// (navigator.userAgent, navigator.userAgentData, navigator.platform), from a local server that
// echoes the headers:
//   - in a web app's card (an installed site, as the Marketplace installs
//     Slack; the apps' profile) and in the browser's page view (its own
//     profile), Mobile Site and Desktop Site,
//   - on a phone (--phone), a tablet (--tablet, with PHOENIX_UA_CHROME_MAJOR
//     set: the override), and across a live switch from phone to tablet
//     (--adaptive, the window resized),
//   - Settings > Device Info's web engine, as the start-up log says it.
// Screenshots of the simulator window.
//
// The pages are driven over Qt WebEngine's DevTools protocol
// (QTWEBENGINE_REMOTE_DEBUGGING); the screen is captured from the X display.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-useragent-sim.cjs [--sim build/phoenix-sim] [--out DIR]
//
// Needs phoenix-sim built (with Qt WebEngine), the apps built (Settings),
// the submodules (the browser), ImageMagick's import and xdotool, a display.

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "useragent-tests")));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));
const SITE_ID = "org.webosphoenix.test.uaecho";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
    for (let t = 0; t < (ms || 15000); t += 250) {
        const v = await fn().catch(() => null);
        if (v) return v;
        await sleep(250);
    }
    return null;
}

// ---- What the pages should be told (useragent.h, repeated here) -----------------

// Chrome's stable major on the four-week cadence from Chrome 155 (6 October 2026).
function chromeMajorToday() {
    const anchor = Date.UTC(2026, 9, 6);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return today <= anchor ? 155 : 155 + Math.floor(Math.round((today - anchor) / 86400000) / 28);
}
function expectedUa(major, form) {
    const platform = form === "desktop" ? "X11; Linux x86_64" : "Linux; Android 10; K";
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 ${form === "phone" ? "Mobile " : ""}Safari/537.36`;
}
function grease(major) {
    const chars = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
    return { brand: `Not${chars[major % 11]}A${chars[(major + 1) % 11]}Brand`, version: ["8", "99", "24"][major % 3] };
}
// Sec-CH-UA's brands, whatever their order.
function brandSet(list) {
    return list.map((b) => `${b.brand}=${b.version}`).sort().join(", ");
}
function parseBrandHeader(h) {
    const out = [];
    const re = /"([^"]*)";v="([^"]*)"/g;
    let m;
    while ((m = re.exec(h || ""))) out.push({ brand: m[1], version: m[2] });
    return out;
}

// ---- The site: echoes each request's headers, and keeps them ---------------------

const seen = {};
function echoServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        seen[url.pathname + url.search] = req.headers;
        const body = `<!doctype html><meta name="viewport" content="width=device-width">
<title>User agent echo</title>
<style>body{font:14px sans-serif;margin:12px;word-break:break-word}pre{white-space:pre-wrap;font-size:12px}</style>
<h3>What this page was sent</h3><pre id="headers">${JSON.stringify(req.headers, null, 1).replace(/</g, "&lt;")}</pre>
<h3>What it reads</h3><pre id="js"></pre>
<script>
navigator.userAgentData.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness", "model", "formFactors"])
  .then(function (v) { document.getElementById("js").textContent = navigator.userAgent + "\\n" + JSON.stringify(v, null, 1); });
</script>`;
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            // The high-entropy hints, sent on the next request once asked for.
            "Accept-CH": "Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model",
        });
        res.end(body);
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- The DevTools protocol, by hand (Node's WebSocket) ----------------------------

function devtools(port) {
    async function targets() {
        const r = await fetch("http://127.0.0.1:" + port + "/json");
        return (await r.json()).filter((t) => t.type === "page");
    }
    async function connect(target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let id = 0;
        const waiting = {};
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
        };
        return {
            evaluate(expression) {
                return new Promise((resolve) => {
                    const n = ++id;
                    waiting[n] = (m) => resolve(m.result && m.result.result ? m.result.result.value : undefined);
                    ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
                });
            },
            close() { ws.close(); }
        };
    }
    return {
        targets,
        async page(re, ms) {
            const t = await until(async () => (await targets()).find((x) => re.test(x.url)), ms);
            return t ? connect(t) : null;
        }
    };
}

// What the page reads of itself.
const READ = `navigator.userAgentData.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness", "model", "formFactors", "uaFullVersion"])
    .then((h) => ({ ua: navigator.userAgent, brands: navigator.userAgentData.brands, mobile: navigator.userAgentData.mobile,
                    platform: navigator.userAgentData.platform, navPlatform: navigator.platform, high: h }))`;

// One page's headers and script view against the policy for that form factor.
function checkPage(label, headers, js, major, form, qtBrands) {
    const ua = expectedUa(major, form);
    const mobile = form === "phone";
    const platform = form === "desktop" ? "Linux" : "Android";
    const brands = brandSet([{ brand: "Chromium", version: String(major) }, grease(major)]);
    check(headers && headers["user-agent"] === ua, `${label}: User-Agent ${headers && headers["user-agent"]}`);
    check(headers && headers["sec-ch-ua-mobile"] === (mobile ? "?1" : "?0"), `${label}: Sec-CH-UA-Mobile ${headers && headers["sec-ch-ua-mobile"]}`);
    check(headers && headers["sec-ch-ua-platform"] === `"${platform}"`, `${label}: Sec-CH-UA-Platform ${headers && headers["sec-ch-ua-platform"]}`);
    check(js && js.ua === ua, `${label}: navigator.userAgent is the header's`);
    check(js && js.mobile === mobile && js.platform === platform, `${label}: navigator.userAgentData mobile ${js && js.mobile}, platform ${js && js.platform}`);
    const navPlatform = form === "desktop" ? "Linux x86_64" : "Linux armv81";
    check(js && js.navPlatform === navPlatform, `${label}: navigator.platform ${js && js.navPlatform}, as Chrome's there`);
    check(js && js.high && js.high.uaFullVersion === `${major}.0.0.0`
          && brandSet(js.high.fullVersionList) === brandSet([{ brand: "Chromium", version: `${major}.0.0.0` }, { brand: grease(major).brand, version: grease(major).version + ".0.0.0" }]),
          `${label}: full version ${js && js.high && js.high.uaFullVersion}, full version list ${js && js.high && JSON.stringify(js.high.fullVersionList)}`);
    check(js && js.high && js.high.architecture === (form === "desktop" ? "x86" : "") && js.high.platformVersion === "",
          `${label}: architecture "${js && js.high && js.high.architecture}", no OS version of the computer's`);
    if (qtBrands) {
        check(headers && brandSet(parseBrandHeader(headers["sec-ch-ua"])) === brands, `${label}: Sec-CH-UA ${headers && headers["sec-ch-ua"]}`);
        check(js && brandSet(js.brands) === brands, `${label}: navigator.userAgentData.brands ${js && JSON.stringify(js.brands)}`);
    } else {
        console.log(`     (${label}: Sec-CH-UA ${headers && headers["sec-ch-ua"]}: this Qt WebEngine keeps its own brands there; Qt 6.10 takes ours)`);
    }
}

// ---- A simulator run ---------------------------------------------------------------

async function run(name, simArgs, env, body) {
    // Each run's requests are its own.
    for (const k of Object.keys(seen)) delete seen[k];
    const server = await echoServer();
    const base = "http://127.0.0.1:" + server.address().port;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-ua-sim-"));
    // The site, installed as the Marketplace installs a web app (apps/marketplace/service/lib/pwa.js).
    const installed = path.join(home, "installed");
    const appDir = path.join(installed, "usr/palm/applications", SITE_ID);
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "appinfo.json"), JSON.stringify({
        id: SITE_ID, version: "1.0.0", vendor: "127.0.0.1", type: "web", main: base + "/site?n=1", title: "UA Echo",
        icon: "icon.png", uiRevision: 2, phoenix: { pwa: { scope: base + "/", display: "standalone" } }
    }, null, 4));
    fs.copyFileSync(path.join(REPO, "apps/settings/public/icon.png"), path.join(appDir, "icon.png"));
    const port = 9300 + Math.floor(Math.random() * 500);
    // No Marketplace catalog (it would start with the simulator where PHP is, and fill itself from the web).
    const sim = spawn(SIM, simArgs.concat(["--stay-awake", "--no-boot-animation", "--quiet", "--no-marketplace", "--qml-dir", QML_DIR, "--repo-dir", REPO,
                                           "--installed-dir", installed,
                                           "--launch", "org.webosphoenix.settings:" + JSON.stringify({ page: "deviceinfo" }),
                                           "--launch", SITE_ID,
                                           "--launch", "com.palm.app.browser:" + JSON.stringify({ target: base + "/browser?n=1" })]), {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(port), QTWEBENGINE_DISABLE_SANDBOX: "1" }, env),
        stdio: ["ignore", "pipe", "pipe"]
    });
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    const shot = (file) => {
        const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(sim.pid)]).toString().trim().split("\n").pop();
        execFileSync("import", ["-window", id, path.join(outDir, file)]);
        console.log("     " + path.join(outDir, file));
        return id;
    };
    try {
        await body({ dt: devtools(port), base, log: () => simLog, shot, sim });
    } catch (e) {
        failures++;
        console.log("FAIL " + name + ": " + (e && e.stack || e));
        console.log(simLog.split("\n").filter((l) => /web engine|Error|error|layout/i.test(l)).slice(-30).join("\n"));
    } finally {
        // Its own way out first (its web engine's processes go with it), then forced.
        if (sim.exitCode === null && sim.signalCode === null) {
            const exited = new Promise((resolve) => sim.once("exit", resolve));
            sim.kill("SIGTERM");
            if (!(await Promise.race([exited.then(() => true), sleep(10000).then(() => false)])))
                sim.kill("SIGKILL");
        }
        server.close();
        await sleep(1000);
        fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
    }
}

// Each page of the run: the site's card, the browser's view, Settings.
async function pages(dt, base) {
    const site = await dt.page(new RegExp("^" + base.replace(/[.:\/]/g, "\\$&") + "/site"), 60000);
    const browser = await dt.page(new RegExp("^" + base.replace(/[.:\/]/g, "\\$&") + "/browser"), 60000);
    const settings = await dt.page(/org\.webosphoenix\.settings/, 60000);
    return { site, browser, settings };
}
// Go to path in the page and read it once it has loaded (the request's
// headers from the server, the page's own view).
async function visit(page, base, p) {
    await page.evaluate(`location.href = ${JSON.stringify(base + p)}, true`);
    const headers = await until(async () => seen[p], 20000);
    await until(() => page.evaluate(`location.search === ${JSON.stringify(p.slice(p.indexOf("?")))} && document.readyState === "complete"`), 20000);
    return { headers, js: await page.evaluate(READ) };
}
async function hostWebEngine(settings) {
    const h = await settings.evaluate(`JSON.parse(PalmSystem.getResource("/usr/share/phoenix/host.json") || "{}").webEngine || null`);
    return h;
}
function qtBrandsFollow(webEngine) {
    const [maj, min] = String(webEngine && webEngine.qtWebEngine || "0.0").split(".").map(Number);
    return maj > 6 || (maj === 6 && min >= 10);
}

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const today = chromeMajorToday();

    // 1. A phone: the site and the browser's Mobile Site, then its Desktop Site.
    await run("phone", ["--phone"], {}, async ({ dt, base, log, shot }) => {
        const { site, browser, settings } = await pages(dt, base);
        if (!check(site && browser && settings, "phone: phoenix-sim runs; the site's card, the browser's page and Settings are up")) throw new Error("no pages");
        const engine = await hostWebEngine(settings);
        const qtBrands = qtBrandsFollow(engine);
        const logged = /web engine: Chromium (\S+) \(security patches (\S+)\), Qt WebEngine (\S+); pages are told Chrome (\d+)/.exec(log());
        check(!!logged && Number(logged[4]) === today, `phone: the start-up log names the engine and the Chrome version pages are told (${logged && logged[0]})`);
        check(engine && logged && engine.version === logged[1] && engine.securityPatches === logged[2],
              `phone: host.json's web engine is the log's (${engine && JSON.stringify(engine)})`);
        const os = await settings.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                                             b.call("luna://com.webos.service.systemservice/osInfo/query", "{}"); })`);
        check(os && logged && os.phoenix_web_engine === "Chromium" && os.phoenix_web_engine_version === logged[1] && os.phoenix_web_engine_security_patches === logged[2],
              "phone: osInfo/query reports the engine (phoenix_web_engine*)");
        const row = await until(() => settings.evaluate(`(document.querySelector('[data-testid="web-engine"]') || {}).textContent || ""`), 15000);
        check(logged && row === `Web engineChromium ${logged[1]} (security patches ${logged[2]})`, `phone: Settings > Device Info: "${row}"`);
        const sees = await settings.evaluate(`(document.querySelector('[data-testid="web-user-agent"]') || {}).textContent || ""`);
        check(sees === `Sites seeChrome ${today}`, `phone: ... "${sees}"`);
        await settings.evaluate(`(document.querySelector('[data-testid="web-engine"]') || document.body).scrollIntoView(), true`);

        let v = await visit(site, base, "/site?n=2");
        checkPage("phone, a web app's card", v.headers, v.js, today, "phone", qtBrands);
        check(v.headers && v.headers["sec-ch-ua-full-version-list"] !== undefined, "phone, a web app's card: the high-entropy hints once asked for (Accept-CH)");
        v = await visit(browser, base, "/browser?n=2");
        checkPage("phone, the browser (Mobile Site)", v.headers, v.js, today, "phone", qtBrands);
        await sleep(1500);
        shot("useragent-phone.png");
        // Desktop Site: the browser's preference, a system one (Preferences > Websites).
        await settings.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                                   b.call("luna://com.palm.systemservice/setPreferences", JSON.stringify({ browserUserAgent: "desktop" })); })`);
        await sleep(1000);
        v = await visit(browser, base, "/browser?n=3");
        checkPage("phone, the browser (Desktop Site)", v.headers, v.js, today, "desktop", qtBrands);
        v = await visit(site, base, "/site?n=3");
        checkPage("phone, a web app's card while the browser asks for Desktop Sites", v.headers, v.js, today, "phone", qtBrands);
    });

    // 2. A tablet, with the version given (PHOENIX_UA_CHROME_MAJOR).
    await run("tablet", ["--tablet"], { PHOENIX_UA_CHROME_MAJOR: "199" }, async ({ dt, base, log, shot }) => {
        const { site, browser, settings } = await pages(dt, base);
        if (!check(site && browser && settings, "tablet: phoenix-sim runs; the site's card, the browser's page and Settings are up")) throw new Error("no pages");
        const qtBrands = qtBrandsFollow(await hostWebEngine(settings));
        check(/pages are told Chrome 199\b/.test(log()), "tablet: PHOENIX_UA_CHROME_MAJOR=199 is the version pages are told");
        let v = await visit(site, base, "/site?n=2");
        checkPage("tablet, a web app's card", v.headers, v.js, 199, "tablet", qtBrands);
        v = await visit(browser, base, "/browser?n=2");
        checkPage("tablet, the browser (Mobile Site)", v.headers, v.js, 199, "tablet", qtBrands);
        await sleep(1500);
        shot("useragent-tablet.png");
    });

    // 3. Adaptive: a phone's window, then a tablet's; the pages are told the tablet's from then on.
    await run("adaptive", ["--adaptive", "--size", "400x720"], {}, async ({ dt, base, log, shot, sim }) => {
        const { site, browser, settings } = await pages(dt, base);
        if (!check(site && browser && settings, "adaptive: phoenix-sim runs; the pages are up")) throw new Error("no pages");
        const qtBrands = qtBrandsFollow(await hostWebEngine(settings));
        let v = await visit(site, base, "/site?n=2");
        checkPage("adaptive, a phone's window: a web app's card", v.headers, v.js, today, "phone", qtBrands);
        const id = execFileSync("xdotool", ["search", "--onlyvisible", "--pid", String(sim.pid)]).toString().trim().split("\n").pop();
        execFileSync("xdotool", ["windowsize", id, "1280", "860"]);
        check(!!(await until(async () => /tablet layout at/.test(log()), 20000)), "adaptive: the window made bigger switches to the tablet layout");
        const live = await site.evaluate("({ ua: navigator.userAgent, mobile: navigator.userAgentData.mobile })");
        check(live && live.ua === expectedUa(today, "tablet") && live.mobile === false, "adaptive: the page already open reads the tablet's at once, before it loads again");
        v = await visit(site, base, "/site?n=3");
        checkPage("adaptive, now a tablet: a web app's card", v.headers, v.js, today, "tablet", qtBrands);
        v = await visit(browser, base, "/browser?n=3");
        checkPage("adaptive, now a tablet: the browser", v.headers, v.js, today, "tablet", qtBrands);
        execFileSync("xdotool", ["windowsize", id, "400", "720"]);
        check(!!(await until(async () => /phone layout at/.test(log().split("tablet layout at").pop()), 20000)), "adaptive: and back to a phone");
        v = await visit(site, base, "/site?n=4");
        checkPage("adaptive, a phone again: a web app's card", v.headers, v.js, today, "phone", qtBrands);
    });

    console.log(failures ? failures + " failed" : "all passed");
    process.exit(failures ? 1 : 0);
}

main();
