#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system language on every page, in headless Chromium with the
// simulator's runtime: PalmSystem.locale (the original's "ar_sa" form),
// localeRegion and phoneRegion come from the settings service's
// localeInfo (locales.UI, FMT for the region), read when asked; the
// runtime puts the language on <html lang> and its direction on <html dir>
// before the app's first frame, and again, live, in the pages already open
// when Settings > Language & Region (or First Use) changes it. Without
// localeInfo the old system preference locale is used.
//
//   node tools/test-locale-dir.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// A response read to its end (see test-emergency.cjs).
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "locale-dir-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8400 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

const luna = (page, uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
    const b = new PalmServiceBridge();
    b.onservicecallback = (j) => res(JSON.parse(j));
    b.call(u, JSON.stringify(p));
}), [uri, params]);
const setUI = (page, UI, FMT) => luna(page, "luna://com.webos.settingsservice/setSystemSettings",
                                      { settings: { localeInfo: { locales: { UI, FMT: FMT || UI }, clock: "locale" } } });

// The root's lang and dir, and what PalmSystem says.
const state = (page) => page.evaluate(() => ({
    lang: document.documentElement.getAttribute("lang"),
    dir: document.documentElement.getAttribute("dir"),
    computed: getComputedStyle(document.documentElement).direction,
    locale: PalmSystem.locale, localeRegion: PalmSystem.localeRegion, phoneRegion: PalmSystem.phoneRegion
}));
const show = (s) => `${s.lang} ${s.dir} ${s.locale}/${s.localeRegion}/${s.phoneRegion}`;

// Every page records its root's lang and dir at its first animation frame
// (before its first paint; the runtime is a render-blocking script in the
// head) and when the body first appears.
const FIRST_FRAME = () => {
    const at = () => ({ lang: document.documentElement.getAttribute("lang"), dir: document.documentElement.getAttribute("dir") });
    requestAnimationFrame(() => { window.__firstFrame = at(); });
    new MutationObserver((list, obs) => {
        if (document.body) { window.__atBody = at(); obs.disconnect(); }
    }).observe(document, { childList: true, subtree: true });
};

async function main() {
    for (const app of ["settings", "tasks"])
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        await context.addInitScript(FIRST_FRAME);
        const errors = [];
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
            });
            return p;
        };
        const page = watch(await context.newPage());
        await page.goto(appUrl("org.webosphoenix.tasks"));
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl("org.webosphoenix.tasks"));
        await page.waitForTimeout(500);

        // ---- The default: English, left to right ----------------------------------------
        let s = await state(page);
        check(s.lang === "en-US" && s.dir === "ltr" && s.computed === "ltr", `the default: <html lang=en-US dir=ltr> (${show(s)})`);
        check(s.locale === "en_us" && s.localeRegion === "us" && s.phoneRegion === "us",
              "PalmSystem.locale en_us, localeRegion us, phoneRegion us (the original's form)");

        // ---- Settings > Language & Region: another language, live in an open app --------
        const settings = watch(await context.newPage());
        await settings.goto(appUrl("org.webosphoenix.settings", { page: "language" }));
        await settings.waitForSelector("[data-testid=language]");
        await settings.click("[data-testid=language]");
        await settings.click("role=option[name='Deutsch']");
        await page.waitForTimeout(400);
        s = await state(page);
        check(s.lang === "de-DE" && s.dir === "ltr" && s.locale === "de_de",
              `Settings > Language & Region > Deutsch: the open app follows (${show(s)})`);
        check((await state(settings)).lang === "de-DE", "and Settings' own page");

        // Arabic (Saudi Arabia), as First Use or another Settings would set it.
        await setUI(settings, "ar-SA");
        await page.waitForTimeout(400);
        s = await state(page);
        check(s.lang === "ar-SA" && s.dir === "rtl" && s.computed === "rtl", `ar-SA: the open app turns right to left (${show(s)})`);
        check(s.locale === "ar_sa" && s.localeRegion === "sa", "PalmSystem.locale ar_sa and localeRegion sa, read when asked");
        s = await state(settings);
        check(s.lang === "ar-SA" && s.dir === "rtl", "the page that set it too");
        await page.screenshot({ path: path.join(outDir, "tasks-ar.png") });

        // A page opened now is right to left from its first frame.
        const fresh = watch(await context.newPage());
        await fresh.goto(appUrl("org.webosphoenix.tasks"));
        await fresh.waitForTimeout(500);
        const first = await fresh.evaluate(() => ({ frame: window.__firstFrame, body: window.__atBody }));
        check(first.frame && first.frame.dir === "rtl" && first.frame.lang === "ar-SA",
              `a new page: rtl at its first frame (${JSON.stringify(first.frame)})`);
        check(first.body && first.body.dir === "rtl", `and already when its body began (${JSON.stringify(first.body)})`);
        await fresh.screenshot({ path: path.join(outDir, "tasks-ar-new.png") });

        // The region from FMT, the language from UI.
        await setUI(settings, "he-IL", "en-GB");
        await page.waitForTimeout(400);
        s = await state(page);
        check(s.lang === "he-IL" && s.dir === "rtl" && s.locale === "he_il" && s.localeRegion === "gb",
              `he-IL with the region en-GB: right to left, localeRegion gb (${show(s)})`);
        check((await state(fresh)).lang === "he-IL", "every open page follows");

        // A script in the tag decides: Kurdish in Arabic script is right to
        // left, in Latin script left to right; Persian, Urdu right to left.
        for (const [tag, dir] of [["ku-Arab-IQ", "rtl"], ["ku-TR", "ltr"], ["ckb-IQ", "rtl"], ["fa-IR", "rtl"],
                                  ["ur-PK", "rtl"], ["iw-IL", "rtl"], ["yi", "rtl"], ["dv-MV", "rtl"], ["sd-Latn-PK", "ltr"],
                                  ["ja-JP", "ltr"]]) {
            await setUI(settings, tag);
            await page.waitForTimeout(150);
            s = await state(page);
            check(s.lang === tag && s.dir === dir, `${tag}: ${dir} (${show(s)})`);
        }
        s = await state(page);
        check(s.locale === "ja_jp", "PalmSystem.locale ja_jp");
        await setUI(settings, "zh-Hant-TW");
        await page.waitForTimeout(150);
        s = await state(page);
        check(s.lang === "zh-Hant-TW" && s.locale === "zh_tw", `zh-Hant-TW: lang keeps the script, PalmSystem.locale zh_tw (${show(s)})`);

        // ---- No localeInfo: the system preference locale (the old key) -------------------
        await settings.evaluate(() => {
            const st = JSON.parse(localStorage.getItem("phoenix:settings:state"));
            delete st.settings[""].localeInfo;
            localStorage.setItem("phoenix:settings:state", JSON.stringify(st));
            localStorage.setItem("phoenix:prefs", JSON.stringify({ locale: "fa_ir" }));
        });
        await page.waitForTimeout(400);
        s = await state(page);
        check(s.lang === "fa-IR" && s.dir === "rtl" && s.locale === "fa_ir",
              `without localeInfo the preference locale fa_ir is used (${show(s)})`);
        await settings.evaluate(() => localStorage.setItem("phoenix:prefs",
            JSON.stringify({ locale: { languageCode: "he", countryCode: "il", phoneRegion: { countryCode: "us" } } })));
        await page.waitForTimeout(400);
        s = await state(page);
        check(s.lang === "he-IL" && s.locale === "he_il" && s.phoneRegion === "us",
              `the original's {languageCode, countryCode, phoneRegion} form (${show(s)})`);

        // ---- Back to English ---------------------------------------------------------------
        await setUI(settings, "en-US");
        await page.waitForTimeout(400);
        s = await state(page);
        check(s.lang === "en-US" && s.dir === "ltr" && s.computed === "ltr" && s.locale === "en_us",
              `back to en-US: left to right again (${show(s)})`);

        check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
