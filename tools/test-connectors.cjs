#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The provider connectors end to end (docs/SYNERGY-CONNECTORS.md 8, "Provider
// connectors"), without the internet, in headless Chromium with
// runtime/phoenix-runtime.js against the stand-ins of
// apps/connectors/testing/fake-providers.cjs and the real Marketplace
// catalog (server/marketplace, PHP). This build has no provider
// registration (no client id in any clients.json), as a build from the
// public tree has none:
//   1. Connections lists Todoist (Tasks & Notes) and Bluesky (Social &
//      Feeds); each package, Phoenix's own from the catalog the device
//      ships with, installs without Developer Mode;
//   2. Todoist in Accounts: "Sign In with Todoist is not available in this
//      build", the API token instead; the account is made;
//   3. Tasks: Todoist's projects are lists under the account, with their
//      tasks; a task added in Tasks and one ticked off reach Todoist;
//   4. the share sheet's Add to Todoist makes a task of a link;
//   5. Bluesky in Accounts: "not available in this build" for Sign In with
//      Bluesky, the handle and app password instead; the account is made;
//   6. the people followed are contacts; a direct message is a Messaging
//      conversation labelled not end-to-end encrypted, and a reply goes
//      back; a new follower is a notification;
//   7. the share sheet posts a link to Bluesky.
//
//   node tools/test-connectors.cjs [--tablet] [--out DIR]
//
// Needs Playwright, PHP 8 (sodium, pdo_sqlite), the apps built
// (cd apps && npm run build) and the connector kit built (its lib/).

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
const { createFakeProviders } = require(path.join(REPO, "apps/connectors/testing/fake-providers.cjs"));
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "connector-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const TODOIST = "com.webosphoenix.todoist", BLUESKY = "com.webosphoenix.bluesky";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
async function until(fn, ms, step) {
    for (let t = 0; t < (ms || 10000); t += step || 250) {
        const v = await fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, step || 250));
    }
    return null;
}

// In every page and frame, before the runtime: what its services are asked
// and answer (window.__phoenixLunaTrace, the last 600 calls; .now() is the
// page's clock in it), for a failure's diagnosis. Wrapping the runtime's
// registry of services (runtime.services, which dispatch reads at each call)
// sees the calls of the runtime's own services too, as the Marketplace's
// service asking the installer and the application manager, not only the
// app's. A reply is a few words: a list of records is its length, and which
// of the watched ids are in it.
function traceLuna(watch) {
    const MAX = 600, t0 = performance.now();
    const trace = window.__phoenixLunaTrace = [];
    trace.now = () => Math.round(performance.now() - t0);
    const short = (v, n) => {
        let s;
        try { s = JSON.stringify(v); } catch (e) { s = String(v); }
        return s && s.length > n ? s.slice(0, n) + "…" : s;
    };
    const summary = (r) => {
        if (!r || typeof r !== "object") return short(r, 120);
        const o = {};
        Object.keys(r).forEach((k) => {
            const v = r[k];
            if (!Array.isArray(v) || !v.some((x) => x && typeof x === "object")) { o[k] = v; return; }
            const ids = v.map((x) => x && (x.id || x.appId || x.templateId || x._id)).filter(Boolean);
            o[k] = v.length <= 6 ? "[" + ids.join(",") + "]"
                : "[" + v.length + (watch.length ? "; with: " + (watch.filter((w) => ids.includes(w)).join(",") || "none watched") : "") + "]";
        });
        return short(o, 400);
    };
    const wrapped = new WeakMap();
    const wrapMethods = (name, methods) => {
        if (!methods || typeof methods !== "object") return methods;
        if (wrapped.has(methods)) return wrapped.get(methods);
        const fns = new Map();
        const w = new Proxy(methods, {
            get(target, key) {
                const fn = target[key];
                if (typeof fn !== "function" || typeof key !== "string") return fn;
                if (!fns.has(fn)) {
                    fns.set(fn, function (params, reply, ctx, method) {
                        const e = { t: trace.now(), uri: "luna://" + name + (method || key), from: (ctx && ctx.caller) || "",
                                    params: short(params, 200), n: 0, replies: [] };
                        trace.push(e);
                        if (trace.length > MAX) trace.shift();
                        // The first replies and the last one (a subscription's end).
                        const logged = function (r) {
                            e.n++;
                            const line = trace.now() + "ms " + summary(r);
                            if (e.replies.length < 6) e.replies.push(line);
                            else e.replies[5] = "(#" + e.n + ") " + line;
                            return reply.apply(this, arguments);
                        };
                        return fn.call(this, params, logged, ctx, method);
                    });
                }
                return fns.get(fn);
            }
        });
        wrapped.set(methods, w);
        return w;
    };
    let rt;
    Object.defineProperty(window, "__phoenixRuntime", {
        configurable: true,
        get() { return rt; },
        set(v) {
            rt = v;
            if (v && v.services && typeof v.services === "object" && !v.services.__traced) {
                const registry = v.services;
                v.services = new Proxy(registry, {
                    get(target, key) { return key === "__traced" ? true : typeof key === "string" ? wrapMethods(key, target[key]) : target[key]; }
                });
            }
        }
    });
}

async function main() {
    for (const f of ["apps/tasks/dist/index.html", "apps/messaging/dist/index.html", "apps/sharesheet/dist/index.html", "apps/marketplace/dist/index.html",
                     "apps/shared/connector-kit/lib/index.js"]) {
        if (!fs.existsSync(path.join(REPO, f))) {
            console.error(f + " is missing: cd apps && npm ci && npm run build");
            process.exit(2);
        }
    }
    if (!servers.phpAvailable()) {
        console.error("PHP 8 with sodium and pdo_sqlite is needed");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
    fs.mkdirSync(outDir, { recursive: true });
    const fake = await createFakeProviders().start(0);
    const td = fake.todoist, bs = fake.bluesky;
    const catalog = await servers.startCatalog({ port: await servers.freePort() });
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-connectors-pack-"));
    // The device as this test has it, served by serve-rootfs itself: the host
    // runs the Marketplace's catalog (host.json), the catalog the device ships
    // with ("phoenix") is this one (servers.json's feeds; the built-in Phoenix
    // catalog's address comes from there, not from sources.json:
    // docs/PLATFORM-CLIENT.md). Not answered by a Playwright route: a browser
    // that intercepts requests deadlocks a page making a synchronous request
    // (the packages service reads servers.json with PalmSystem.getResource)
    // while it is navigated away from, and the next page never loads.
    const device = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-device-"));
    const serversJson = JSON.parse(fs.readFileSync(path.join(REPO, "services/account/etc/palm/phoenix/servers.json"), "utf8"));
    serversJson.feeds = catalog.url + "/";
    fs.mkdirSync(path.join(device, "etc/palm/phoenix"), { recursive: true });
    fs.writeFileSync(path.join(device, "etc/palm/phoenix/servers.json"), JSON.stringify(serversJson));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir,
                                     "--extra-rootfs", device, "--host-json", JSON.stringify({ marketplaceCatalog: true }), "--no-tcp"], { stdio: "ignore" });
    const appUrl = (id, params, file) => `${origin}/usr/palm/applications/${id}/${file || "index.html"}` +
        (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
    let browser;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 10000, 100);
        // The packages, Phoenix's own (an admin's upload), in the catalog.
        for (const name of ["todoist", "bluesky"]) {
            const ipk = pack(path.join(REPO, "apps/connectors", name), packDir, { vendor: false, namespaces: ["org.webosphoenix", "com.webosphoenix"] });
            const up = await catalog.api("POST", "/api/apps/packages", new Uint8Array(fs.readFileSync(ipk.file)), catalog.admin);
            check(up.status === 200 && up.app.kind === "connector", "the " + name + " package, Phoenix's own, is taken by the catalog (" + (up.error || up.app.kind) + ")");
            await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        }

        browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        await context.addInitScript(traceLuna, ["org.webosphoenix.todoist", "org.webosphoenix.bluesky"]);
        const errors = [], host = [];
        // For a failure's diagnosis: the requests that failed or took long,
        // those to the host (serve-rootfs's installer and proxy) and its
        // list of apps; the runtime's and the Marketplace service's console
        // lines, and every error and warning. The last 400 of each.
        const started = Date.now(), net = [], consoleLines = [];
        const keep = (list, x) => { list.push(x); if (list.length > 400) list.shift(); };
        const pageOf = (u) => u.replace(/\?.*$/, "").replace(/^.*\/applications\//, "");
        const reqPath = (u) => u.replace(origin, "").replace(/\?.*$/, "");
        // What a request is: its path, and for the host's proxy the address it fetches.
        const what = (r) => {
            let u = reqPath(r.url());
            if (u === "/__phoenix/proxy") try { u += " " + JSON.parse(r.postData() || "{}").url.replace(/\?.*$/, ""); } catch (e) { /* as is */ }
            return u;
        };
        const frameOf = (r) => { try { return pageOf(r.frame().url()); } catch (e) { return ""; } };
        const inFlight = new Map();
        context.on("request", (r) => inFlight.set(r, { at: Date.now() - started, method: r.method(), url: what(r), from: frameOf(r) }));
        context.on("requestfailed", (r) => {
            inFlight.delete(r);
            keep(net, { at: Date.now() - started, failed: (r.failure() || {}).errorText || "failed", method: r.method(), url: what(r), from: frameOf(r) });
        });
        context.on("requestfinished", async (r) => {
            inFlight.delete(r);
            const t = r.timing(), ms = Math.round(t.responseEnd);
            const res = await r.response().catch(() => null), status = res ? res.status() : 0;
            if (!(ms > 2000 || status >= 400 || /^\/(__phoenix\/|usr\/share\/phoenix\/apps\.json)/.test(reqPath(r.url())))) return;
            keep(net, { at: Date.now() - started, ms, status, method: r.method(), url: what(r), from: frameOf(r) });
        });
        context.on("page", (p) => {
            p.on("pageerror", (e) => errors.push(pageOf(p.url()) + ": " + e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                if (process.env.CONNECTORS_VERBOSE && !t.startsWith("__phoenix__")) console.log("    [" + m.type() + "] " + t);
                // (A response's "Failed to load resource" is in net, with its address.)
                if ((m.type() === "error" || m.type() === "warning" || /^\[(marketplace|phoenix-runtime)\]/.test(t)) && !/^Failed to load resource/.test(t))
                    keep(consoleLines, { at: Date.now() - started, page: pageOf(p.url()), type: m.type(), text: t.slice(0, 300) });
            });
        });
        const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (p, uri, params) => p.evaluate(([u, prm]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(prm || {}));
        }), [uri, params]);
        const db = (p, kind) => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith("phoenix:db8:com.palm.db/obj/"))
            .map((x) => JSON.parse(localStorage.getItem(x))).filter((o) => !o._del && o._kind === k), kind);
        const shellSays = (p) => p.evaluate((st) => window.__phoenixRuntime.applyHostStatus({ marketplaceCatalog: st }, { writer: false }),
            { url: catalog.url + "/", error: "", settingUp: false, state: "running", key: catalog.key });
        // A sync of the account that starts now: one already running (the
        // account's first, a reply's) may have begun before what the test
        // just changed on the server, so after it ends this one is asked again.
        const syncNow = async (p, service, accountId) => {
            const unlocked = () => until(() => p.evaluate(([s, a]) => !JSON.parse(localStorage.getItem("phoenix:connector:syncLock:" + s + ":" + a) || "0"),
                                                          [service, accountId]), 30000);
            let r = await luna(p, "luna://" + service + "/sync", { accountId });
            for (let i = 0; i < 5 && r && r.alreadyRunning; i++) {
                await unlocked();
                r = await luna(p, "luna://" + service + "/sync", { accountId });
            }
            await unlocked();
            return r;
        };

        // ---- 1. Connections: install both from the catalog ------------------------------------------------
        const market = await context.newPage();
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.evaluate(() => localStorage.clear());
        // The image's settings: the stand-ins' addresses, and no provider registration (none in this build).
        await market.evaluate((cfg) => Object.keys(cfg).forEach((k) => localStorage.setItem("phoenix:systemConfig:" + k, JSON.stringify(cfg[k]))),
                              fake.systemConfig([]));
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.waitForSelector("[data-testid=tab-connections]", { timeout: 15000 });
        await shellSays(market);
        await luna(market, "luna://org.webosphoenix.service.packages/refresh", {});
        await market.goto(appUrl("org.webosphoenix.marketplace"));
        await market.waitForSelector("[data-testid=tab-connections]");
        await shellSays(market);
        await market.click("[data-testid=tab-connections]");
        // Install did not end in Set up: why, from the page, its luna traffic
        // since the tap (clickAt, the page's clock; clickWall, this test's)
        // and the host. Install's own steps (ConnectorPackage.tsx install()):
        // getDevMode, then the packages service's install, whose last reply
        // says installed; then load() asks listInstalled, which must list the
        // app for Set up. Printed, and written next to the screenshots.
        const diagnoseInstall = async (name, clickAt, clickWall) => {
            const appId = "org.webosphoenix." + name;
            const page = await market.evaluate(([since, id]) => {
                const q = (tid) => document.querySelector("[data-testid=" + tid + "]");
                const ui = ["install-progress", "install-error", "devmode-needed", "connector-installed", "install-skipped",
                            "connector-install", "set-up", "open-accounts"].filter(q).map((tid) =>
                    tid + (q(tid).disabled ? " (disabled)" : "") + ": " + (q(tid).textContent || "").replace(/\s+/g, " ").trim().slice(0, 80));
                let state = null;
                try { state = JSON.parse(localStorage.getItem("phoenix:marketplace:state") || "null"); } catch (e) { state = null; }
                const trace = window.__phoenixLunaTrace;
                return { ui, now: trace ? trace.now() : -1, traced: !!trace,
                         recorded: state && state.installed ? Object.keys(state.installed).includes(id) : null,
                         calls: trace ? trace.filter((e) => e.t >= since) : [] };
            }, [clickAt, appId]).catch((e) => ({ ui: [], calls: [], evalError: e.message }));
            // As things are now.
            const listedNow = await luna(market, "luna://org.webosphoenix.service.packages/listInstalled", {})
                .then((r) => r.returnValue === false ? "fails: " + r.errorText : (r.apps || []).some((a) => a.id === appId) ? "lists it" : "does not list it")
                .catch((e) => "not asked: " + e.message);
            const appsNow = await luna(market, "luna://com.webos.applicationManager/listApps", {})
                .then((r) => (r.apps || []).some((a) => a.id === appId) ? "lists it" : "does not list it").catch((e) => "not asked: " + e.message);
            const hostNow = await fetch(origin + "/usr/share/phoenix/apps.json").then((r) => r.json())
                .then((l) => l.some((a) => a.id === appId) ? "lists it" : "does not list it").catch((e) => "unreachable: " + e.message);
            const onDisk = fs.existsSync(path.join(installedDir, "usr/palm/applications", appId, "appinfo.json"));

            const calls = page.calls, last = (e) => e && e.replies.length ? e.replies[e.replies.length - 1] : "";
            const of = (re) => calls.filter((e) => re.test(e.uri));
            const devmode = of(/devmode\/getDevMode$/).filter((e) => !/"subscribe":true/.test(e.params));
            const inst = of(/service\.packages\/install$/).filter((e) => e.params.includes('"' + name) || e.params.includes(appId));
            const ended = inst.length && /"state":"(installed|failed)"/.test(last(inst[inst.length - 1]));
            const listed = of(/service\.packages\/listInstalled$/);
            let verdict;
            if (!page.traced) verdict = "no luna trace in the page (" + (page.evalError || "the tracer did not load") + ")";
            else if (!devmode.length && !inst.length) verdict = "the tap did not reach install(): no getDevMode call since it";
            else if (!inst.length) verdict = devmode.some((e) => e.replies.length)
                ? "(a') getDevMode answered, but install() did not ask the packages service to install"
                : "(a) install() is waiting for getDevMode's reply";
            else if (!ended) verdict = "the install has not ended: its last reply " + (last(inst[inst.length - 1]) || "none");
            else if (/"state":"failed"/.test(last(inst[inst.length - 1]))) verdict = "the install failed: " + last(inst[inst.length - 1]);
            else {
                const endT = +((/(\d+)ms /.exec(last(inst[inst.length - 1])) || [])[1] || 0);
                const after = listed.filter((e) => e.t >= endT);
                const answer = after.length ? last(after[after.length - 1]) : "";
                verdict = !after.length ? "installed, but load() did not ask listInstalled after it"
                    : /"returnValue":false/.test(answer) ? "(b) installed, then listInstalled failed: " + answer
                    : !answer ? "(b) installed, then listInstalled did not answer"
                    : answer.includes(appId) ? "installed, and listInstalled lists it: the page did not show Set up"
                    : "(b) installed, then listInstalled answered without it: " + answer;
            }
            const since = clickWall - started;
            const report = {
                verdict, ui: page.ui, recordedInState: page.recorded, listInstalledNow: listedNow, listAppsNow: appsNow,
                hostAppsJson: hostNow, onDisk, tapAt: clickAt, pageNow: page.now,
                luna: calls.map((e) => e.t + "ms " + e.uri + (e.from ? " (from " + e.from + ")" : "") + " " + e.params
                                       + (e.replies.length ? "\n        -> " + e.replies.join("\n        -> ") : "\n        -> (no reply)")),
                requests: net.filter((r) => r.at >= since - 2000).map((r) => "+" + (r.at - since) + "ms " + r.method + " " + r.url
                                       + (r.failed ? " FAILED " + r.failed : " " + r.status + " in " + r.ms + " ms") + (r.from ? " (" + r.from + ")" : "")),
                unanswered: [...inFlight.values()].map((r) => r.method + " " + r.url + ", asked " + Math.round((Date.now() - started - r.at) / 1000)
                                                        + " s ago" + (r.from ? " (" + r.from + ")" : "")),
                failedRequests: net.filter((r) => r.failed).map((r) => r.at + "ms " + r.method + " " + r.url + " " + r.failed + " (" + r.from + ")"),
                console: consoleLines.filter((c) => c.at >= since - 2000).map((c) => "+" + (c.at - since) + "ms " + c.page + " [" + c.type + "] " + c.text),
                pageErrors: errors.slice()
            };
            fs.writeFileSync(path.join(outDir, "install-failed-" + name + ".json"), JSON.stringify(report, null, 2));
            console.log("    install of " + name + " did not end in Set up: " + verdict);
            console.log("    the page shows: " + (page.ui.join("; ") || "none of the install's parts"));
            console.log("    now: the service's record " + (page.recorded === null ? "unreadable" : page.recorded ? "has it" : "does not have it")
                        + "; listInstalled " + listedNow + "; listApps " + appsNow + "; the host's apps.json " + hostNow
                        + "; its folder " + (onDisk ? "is" : "is not") + " in the installed apps");
            console.log("    luna since the tap (" + calls.length + " calls):");
            report.luna.slice(-60).forEach((l) => console.log("      " + l));
            console.log("    requests since the tap (failed, slow, the host's):");
            report.requests.slice(-40).forEach((l) => console.log("      " + l));
            if (report.unanswered.length) console.log("    requests not answered yet:");
            report.unanswered.slice(-20).forEach((l) => console.log("      " + l));
            if (report.failedRequests.length) console.log("    failed requests in this run: " + report.failedRequests.length);
            report.failedRequests.slice(-20).forEach((l) => console.log("      " + l));
            report.console.slice(-30).forEach((l) => console.log("      console " + l));
            if (errors.length) console.log("    page errors: " + errors.join("; "));
        };
        const install = async (group, templateId, name) => {
            const row = "[data-testid=group-" + group + "] [data-testid='account-" + templateId + "']";
            await market.waitForSelector(row, { timeout: 20000 });
            await market.locator(row).scrollIntoViewIfNeeded();
            await shot(market, "1-connections-" + name);
            await market.click(row);
            await market.waitForSelector("[data-testid=account-page]");
            const text = await market.textContent("[data-testid=account-page]");
            check(/Phoenix's servers: none/.test(text) && /experimental/i.test(text), name + "'s page: no Phoenix server in between, experimental");
            await shot(market, "2-" + name + "-page");
            const clickAt = await market.evaluate(() => (window.__phoenixLunaTrace ? window.__phoenixLunaTrace.now() : 0)), clickWall = Date.now();
            await market.click("[data-testid=connector-install]");
            await market.waitForSelector("[data-testid=set-up]", { timeout: 30000 }).catch(async (e) => {
                await shot(market, "install-failed-" + name);
                await diagnoseInstall(name, clickAt, clickWall).catch((d) => console.log("    no diagnosis: " + d.message));
                throw e;
            });
            check(await market.locator("[data-testid=devmode-needed]").count() === 0, name + " installed without Developer Mode (Phoenix's own, from the catalog the device ships with)");
            await market.goBack().catch(() => {});
            await market.goto(appUrl("org.webosphoenix.marketplace"));
            await market.waitForSelector("[data-testid=tab-connections]");
            await shellSays(market);
            await market.click("[data-testid=tab-connections]");
        };
        await install("tasks", TODOIST, "todoist");
        await install("social", BLUESKY, "bluesky");
        const tpl = (await luna(market, "luna://com.palm.service.accounts/listAccountTemplates", {})).results.map((t) => t.templateId);
        check(tpl.includes(TODOIST) && tpl.includes(BLUESKY), "Accounts has both templates");

        // ---- 2. Todoist in Accounts: the API token ----------------------------------------------------------
        const accounts = await context.newPage();
        const wizardOf = async (templateId, app) => {
            await accounts.goto(appUrl("com.palm.app.accounts", { templateId }));
            const re = new RegExp(app.replace(/\./g, "\\.") + "\\/accounts\\/wizard\\.html");
            const w = await until(() => accounts.frames().find((f) => re.test(f.url())), 15000);
            if (!w) throw new Error("no sign-in page for " + templateId);
            await w.waitForSelector(".connector-wizard", { timeout: 10000 }).catch(async (e) => { await shot(accounts, "wizard-failed"); console.log("errors: " + JSON.stringify(errors)); throw e; });
            await w.waitForSelector(".connector-unavailable", { state: "visible", timeout: 8000 }).catch(() => {});
            return w;
        };
        // Sign In ends the form, inside Enyo 1.0's scroller, below the fold on
        // a phone. Playwright's scroll into view moves the DOM, which
        // BasicScroller undoes at its next scroll event (scrollHandler, enyo-1.0
        // BasicScroller.js:158-164), so on a loaded runner the tap lands on the
        // field the scroller puts back there. Scroll to the end as the page
        // itself does (scrollToBottom) and tap once the button is what is under
        // the finger, as tools/test-sftp.cjs does.
        const tapSignIn = async (w, wizard) => {
            const reachable = await until(() => w.evaluate((id) => {
                const c = enyo.$[id + "_signInButton"], n = c && c.hasNode();
                if (!n) return false;
                for (let s = c.parent; s; s = s.parent) if (typeof s.scrollToBottom === "function") { s.scrollToBottom(); break; }
                const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return !!hit && n.contains(hit);
            }, wizard), 15000, 200);
            if (!reachable) throw new Error("Sign In stays out of reach");
            await w.getByText("Sign In", { exact: true }).click();
        };
        const createAccount = async (templateId, name, stateKind) => {
            const create = accounts.locator(".enyo-button:visible, .enyo-custom-button:visible", { hasText: "Create Account" }).first();
            await create.waitFor({ timeout: 20000 }).catch(() => {});
            await accounts.waitForTimeout(400);
            await shot(accounts, name);
            await create.click().catch(() => {});
            const account = await until(async () => (await luna(accounts, "luna://com.palm.service.accounts/listAccounts", { templateId })).results[0], 10000);
            // The accounts service answers createAccount, then calls onCreate
            // with the account's config (app-services notify-created.js; the
            // runtime 500 ms later): a sync before that has no config yet.
            if (account && stateKind) {
                await until(async () => (await db(accounts, stateKind)).some((o) => o.accountId === account._id && Object.keys(o.config || {}).length), 15000);
            }
            return account;
        };
        let w = await wizardOf(TODOIST, "org.webosphoenix.todoist");
        check(/Sign In with Todoist is not available in this build/.test(await w.locator(".connector-unavailable").textContent().catch(() => "")),
              "Todoist: Sign In with Todoist is not available in this build (no registration)");
        check(/Don't have an account\? Sign up/.test(await w.locator(".accounts-signup").textContent().catch(() => "")), "and a sign-up link");
        await w.locator("input[type=password]").first().fill(td.token);
        await w.locator("input[type=password]").first().press("Tab");
        await shot(accounts, "3-todoist-sign-in");
        await tapSignIn(w, "connectorWizard");
        const todo = await createAccount(TODOIST, "4-todoist-create");
        check(todo && todo.username === "anna@example.com", "the Todoist account exists (" + (todo && todo.username) + ")");
        if (!todo) throw new Error("no Todoist account");
        await syncNow(accounts, "org.webosphoenix.service.todoist", todo._id);

        // ---- 3. Tasks --------------------------------------------------------------------------------------
        const tasks = await context.newPage();
        await tasks.goto(appUrl("org.webosphoenix.tasks"));
        await tasks.waitForSelector("[data-testid='list-Groceries']", { timeout: 20000 }).catch(() => {});
        check(await tasks.locator("[data-testid='list-Groceries']").count() === 1 && await tasks.locator("[data-testid='list-Todoist Inbox']").count() === 1,
              "Tasks: Todoist's projects are lists");
        const listsText = await tasks.textContent("[data-testid=lists-pane]");
        check(/Todoist\s*Todoist Inbox/.test(listsText), "under the account's name (" + listsText.replace(/\s+/g, " ").slice(0, 160) + ")");
        await shot(tasks, "5-tasks-lists");
        await tasks.click("[data-testid='list-Groceries']");
        await tasks.waitForSelector("[data-testid='task-Buy milk']", { timeout: 10000 }).catch(() => {});
        check(await tasks.locator("[data-testid='task-Buy milk']").count() === 1, "with their tasks");
        await shot(tasks, "6-tasks-groceries");
        await tasks.fill("[data-testid=quick-add]", "Buy eggs");
        await tasks.press("[data-testid=quick-add]", "Enter");
        await tasks.waitForSelector("[data-testid='task-Buy eggs']", { timeout: 10000 });
        await tasks.click("[data-testid='check-Buy milk']");
        // Ticked off once Tasks has written it (db8), not after a while: the sync sends what db8 has.
        const ticked = await until(async () => (await db(tasks, "com.palm.task.todoist:1")).some((t) => t.summary === "Buy milk" && t.completed), 10000);
        check(!!ticked, "the task ticked off in Tasks is done in db8");
        const eggs = (await db(tasks, "com.palm.task.todoist:1")).find((t) => t.summary === "Buy eggs");
        check(!!eggs && eggs.accountId === todo._id, "a task added in the list is the Todoist account's (com.palm.task.todoist:1)");
        await syncNow(tasks, "org.webosphoenix.service.todoist", todo._id);
        check(td.tasks.some((t) => t.content === "Buy eggs" && t.project_id === "220474323" && !t.is_deleted), "it reaches Todoist, in Groceries");
        check(td.tasks.some((t) => t.content === "Buy milk" && t.checked), "and the task ticked off is done on Todoist");
        await shot(tasks, "7-tasks-synced");

        // ---- 4. Add to Todoist from the share sheet ------------------------------------------------------------
        const browserPage = await context.newPage();
        await browserPage.goto(appUrl("com.palm.app.browser"));
        // The browser drawn: it tells the shell its stage is ready (PalmSystem.stageReady).
        check(!!(await until(() => host.some((m) => m.type === "stageReady" && m.payload.appId === "com.palm.app.browser"), 15000)),
              "the browser is up (its stage ready)");
        const shareTo = async (appId, shotName) => {
            host.length = 0;
            const shared = browserPage.evaluate(() => __phoenixRuntime.share({ title: "Phoenix release notes", url: "https://example.org/notes" }));
            const sheet = await until(() => browserPage.frames().find((f) => /org\.webosphoenix\.sharesheet\/index\.html/.test(f.url())), 10000);
            await sheet.waitForSelector("[data-testid='share-app-" + appId + "']", { timeout: 10000 });
            await browserPage.waitForTimeout(400);
            await shot(browserPage, shotName);
            const label = await sheet.getAttribute("[data-testid='share-app-" + appId + "']", "aria-label");
            await sheet.click("[data-testid='share-app-" + appId + "']");
            await shared;
            const launched = host.find((m) => m.type === "launch" && m.payload.id === appId);
            return { label, params: launched && launched.payload.params };
        };
        let s = await shareTo("org.webosphoenix.todoist", "7-share-sheet-todoist");
        check(/Add to Todoist/.test(s.label || ""), "the share sheet offers Add to Todoist (" + s.label + ")");
        let compose = await context.newPage();
        await compose.goto(appUrl("org.webosphoenix.todoist", s.params));
        await compose.waitForSelector("#compose:not([hidden])", { timeout: 10000 });
        await shot(compose, "8-todoist-compose");
        await compose.click("#post");
        check(!!(await until(() => td.tasks.find((t) => t.content === "Phoenix release notes" && /example\.org\/notes/.test(t.description)), 10000)),
              "the link is a task in Todoist's Inbox");
        await compose.waitForSelector("#done:not([hidden])", { timeout: 10000 }).catch(() => {});
        await shot(compose, "9-todoist-added");
        await compose.close();

        // ---- 5. Bluesky in Accounts: an app password ------------------------------------------------------------
        w = await wizardOf(BLUESKY, "org.webosphoenix.bluesky");
        check(/Sign In with Bluesky is not available in this build/.test(await w.locator(".connector-unavailable").textContent().catch(() => "")),
              "Bluesky: Sign In with Bluesky is not available in this build");
        await w.locator("input").first().fill(bs.handle);
        await w.locator("input[type=password]").first().fill(bs.appPassword);
        await w.locator("input[type=password]").first().press("Tab");
        await shot(accounts, "10-bluesky-sign-in");
        await tapSignIn(w, "connectorWizard");
        const sky = await createAccount(BLUESKY, "11-bluesky-create", "org.webosphoenix.bluesky.state:1");
        check(sky && sky.username === "anna.test" && sky.capabilityProviders.length === 3, "the Bluesky account exists, with contacts, messages and notifications");
        if (!sky) throw new Error("no Bluesky account");
        const firstSync = await syncNow(accounts, "org.webosphoenix.service.bluesky", sky._id);
        await accounts.waitForTimeout(600);
        await shot(accounts, "12-accounts");

        // ---- 6. Contacts, Messaging, notifications ---------------------------------------------------------------
        const people = await until(async () => { const c = await db(accounts, "com.palm.contact.bluesky:1"); return c.length >= 3 ? c : null; }, 15000);
        if (!people) console.log("    first sync: " + JSON.stringify(firstSync) + "; now: " + JSON.stringify(await luna(accounts, "luna://org.webosphoenix.service.bluesky/sync", { accountId: sky._id })));
        check(!!people && people.some((c) => c.nickname === "@bob.test" && c.name.familyName === "Marsh"), "the people followed are contacts");
        bs.message("convo-bob", "Are you coming to the meetup?");
        bs.notify("follow", bs.people[2]);
        host.length = 0;
        await syncNow(accounts, "org.webosphoenix.service.bluesky", sky._id);
        const thread = await until(async () => (await db(accounts, "com.palm.chatthread:1")).find((t) => t.replyService === "type_bluesky"), 10000);
        check(!!thread && thread.replyAddress === "bob.test", "a direct message is a Messaging conversation");
        check(host.some((m) => m.type === "notification" && /Dee Ortiz followed you/.test(m.payload.title)), "a new follower is a notification");
        const messaging = await context.newPage();
        await messaging.goto(appUrl("org.webosphoenix.messaging", { threadId: thread && thread._id }));
        await messaging.waitForSelector("[data-testid=not-private]", { timeout: 10000 }).catch(() => {});
        check(/Not end-to-end encrypted/.test(await messaging.textContent("[data-testid=not-private]").catch(() => "")), "labelled not end-to-end encrypted");
        check(/Are you coming to the meetup\?/.test(await messaging.evaluate(() => document.body.innerText)), "with the message");
        await messaging.fill("[data-testid=message-input]", "Yes! See you there.");
        await messaging.click("[data-testid=send]");
        check(!!(await until(() => bs.convos[0].messages.find((m) => m.text === "Yes! See you there." && m.sender.did === bs.did), 10000)),
              "a reply from Messaging goes to the conversation");
        await messaging.waitForTimeout(500);
        await shot(messaging, "13-messaging-bluesky");
        await messaging.close();

        // ---- 7. Post a link to Bluesky ------------------------------------------------------------------------------
        s = await shareTo("org.webosphoenix.bluesky", "14-share-sheet-bluesky");
        check(s.label === "Bluesky · @anna.test", "the share sheet offers the account (" + s.label + ")");
        compose = await context.newPage();
        await compose.goto(appUrl("org.webosphoenix.bluesky", s.params));
        await compose.waitForSelector("#compose:not([hidden])", { timeout: 10000 });
        await shot(compose, "15-bluesky-compose");
        await compose.click("#post");
        const post = await until(() => bs.posts.find((p) => /example\.org\/notes/.test(p.record.text)), 10000);
        check(!!post && post.record.facets && post.record.facets[0].features[0].uri === "https://example.org/notes", "posted, the link a facet");
        await compose.waitForSelector("#done:not([hidden])", { timeout: 10000 }).catch(() => {});
        await shot(compose, "16-bluesky-posted");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        catalog.stop && catalog.stop();
        await fake.stop();
        fs.rmSync(installedDir, { recursive: true, force: true });
        fs.rmSync(device, { recursive: true, force: true });
        fs.rmSync(packDir, { recursive: true, force: true });
    }
    console.log(failures ? `\n${failures} check(s) failed; screenshots in ${outDir}` : `\nall checks passed; screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
