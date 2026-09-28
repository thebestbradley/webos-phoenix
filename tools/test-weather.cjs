#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Weather (apps/weather, built into dist/) in headless Chromium
// against the simulated services in runtime/phoenix-runtime.js, with
// Open-Meteo answered from recorded replies (apps/weather/fixtures, CC BY
// 4.0): no request leaves the machine.
//
//   first start  Current Location from com.webos.service.location; its
//                forecast in the region's units (°F, mph for en-US): now,
//                24 hours, 7 days, sunrise and sunset, the Open-Meteo credit
//   privacy      the forecast request carries only the coordinates
//                rounded to 2 decimals and the variables; the search only
//                the name, count and language
//   places       search "London", add it; its forecast; the list with each
//                place's temperature; reorder and remove (Edit)
//   units        the region set to Germany: °C and km/h; Preferences:
//                Imperial; the 24-hour clock from the system preference
//   cache        a forecast younger than 30 minutes is not fetched again;
//                offline, the last one is shown with its time, also after
//                a restart; a server error reply is shown
//   no location  location off and nothing saved: the places list asks for
//                a city
//
//   node tools/test-weather.cjs [--tablet] [--out DIR]
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
const APP = "org.webosphoenix.weather";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "weather-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = `${origin}/usr/palm/applications/${APP}/index.html`;
const fixture = (name) => fs.readFileSync(path.join(REPO, "apps/weather/fixtures", name), "utf8");

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
    if (!fs.existsSync(path.join(REPO, "apps/weather/dist/index.html"))) {
        console.error("apps/weather/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        // Open-Meteo, answered here. mode: "ok" | "offline" | "limit".
        const requests = [];
        let mode = "ok";
        await context.route(/^https:\/\/[a-z-]+\.open-meteo\.com\//, (route) => {
            const u = new URL(route.request().url());
            requests.push(u);
            if (mode === "offline") return route.abort("internetdisconnected");
            const headers = { "access-control-allow-origin": "*" };
            if (mode === "limit")
                return route.fulfill({ status: 429, contentType: "application/json", headers, body: JSON.stringify({ error: true, reason: "Daily API request limit exceeded. Please try again tomorrow." }) });
            const body = u.pathname === "/v1/search" ? fixture("search-london.json")
                : Number(u.searchParams.get("latitude")) > 45 ? fixture("forecast-london.json") : fixture("forecast-sunnyvale.json");
            return route.fulfill({ status: 200, contentType: "application/json", headers, body });
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (m.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (url, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p || {}));
        }), [url, params]);
        const text = (id) => page.textContent(`[data-testid='${id}']`);
        const toPlaces = async () => { if (!tablet) await page.click("[data-testid='to-places']"); await page.waitForSelector("[data-testid='places']"); };
        const openMenu = () => page.evaluate(() => window.__phoenixRuntime.openAppMenu());

        await page.goto(appUrl);
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl);

        // ---- First start: where the device is --------------------------------------------------
        await page.waitForSelector("[data-testid='now-temp']", { timeout: 10000 });
        check((await text("title")) === "Current Location", "first start: the Current Location");
        check((await text("now-temp")) === "74°" && (await text("now-text")) === "Clear", `first start: now, in °F for en-US (${await text("now-temp")} ${await text("now-text")})`);
        check(/^\d+ mph N$/.test(await text("wind")), `first start: wind in mph (${await text("wind")})`);
        check((await page.$$("[data-testid='hours'] .wx-hour")).length === 24, "first start: the next 24 hours");
        check((await page.$$("[data-testid='days'] .wx-day")).length === 7, "first start: 7 days");
        const hours = await page.$$eval("[data-testid='hours'] .wx-hour-time", (els) => els.slice(0, 3).map((e) => e.textContent));
        check(hours.join(",") === "Now,5 PM,6 PM", `first start: hours on the 12-hour clock, in the place's time (${hours})`);
        check(/Sunrise7:01 AM/.test(await page.textContent("[data-testid='details']")), "first start: sunrise and sunset");
        check(/Open-Meteo/.test(await text("attribution")) && /^Updated /.test(await text("updated")), "first start: the Open-Meteo credit and the time it was updated");
        await shot("current");

        // ---- Privacy: what was sent -------------------------------------------------------------
        const f = requests.find((u) => u.pathname === "/v1/forecast");
        check(f && f.host === "api.open-meteo.com" && f.searchParams.get("latitude") === "37.37" && f.searchParams.get("longitude") === "-122.04",
              `privacy: coordinates rounded to ~1 km (${f && f.search.slice(0, 50)}...)`);
        check(f && [...f.searchParams.keys()].sort().join(",") === "current,daily,forecast_days,forecast_hours,hourly,latitude,longitude,timezone",
              "privacy: nothing else in the forecast request");

        // ---- Cache: fresh forecasts are not fetched again ----------------------------------------
        const before = requests.length;
        await page.reload();
        await page.waitForSelector("[data-testid='now-temp']", { timeout: 5000 }).catch(async (e) => {
            await shot("debug-reload"); console.log("ERRORS", errors);
            console.log(await page.evaluate(() => document.body.innerText.slice(0, 400)), await page.evaluate(() => localStorage.getItem("org.webosphoenix.weather")?.slice(0, 300)));
            throw e;
        });
        await page.waitForTimeout(800);
        check(requests.length === before, "cache: a forecast younger than 30 minutes is not fetched again");

        // ---- Places: search and add ----------------------------------------------------------------
        await toPlaces();
        await page.fill("[data-testid='search']", "London");
        await page.click("[data-testid='search-go']");
        await page.waitForSelector("[data-testid='result-London-England']");
        const s = requests.find((u) => u.pathname === "/v1/search");
        check(s && s.host === "geocoding-api.open-meteo.com" && s.searchParams.get("name") === "London"
              && [...s.searchParams.keys()].sort().join(",") === "count,format,language,name", "privacy: the search sends the name only");
        await shot("search");
        await page.click("[data-testid='result-London-England']");
        await page.waitForFunction(() => document.querySelector("[data-testid='title']")?.textContent === "London");
        await page.waitForSelector("[data-testid='now-temp']");
        check((await text("now-temp")) === "62°" && (await text("now-text")) === "Cloudy", `places: London's forecast (${await text("now-temp")} ${await text("now-text")})`);
        check(await page.$eval("[data-testid='now']", (e) => e.classList.contains("night")), "places: night sky at night there");
        await shot("london");
        await toPlaces();
        await page.waitForSelector("[data-testid='place-London'] .wx-place-temp");
        const rows = await page.$$eval("[data-testid='places'] .wx-place", (els) => els.map((e) => e.querySelector(".pui-row-title").textContent + " " + (e.querySelector(".wx-place-temp")?.textContent ?? "")));
        check(rows.join(" | ") === "Current Location 74° | London 62°", `places: each with its temperature (${rows.join(" | ")})`);
        await shot("places");

        // ---- Units and clock ------------------------------------------------------------------------
        await luna("luna://com.webos.settingsservice/setSystemSettings", { settings: { localeInfo: { locales: { UI: "en-US", FMT: "de-DE" } } } });
        await page.click("[data-testid='place-Current Location']");
        await page.waitForFunction(() => document.querySelector("[data-testid='now-temp']")?.textContent === "23°", null, { timeout: 3000 })
            .then(() => check(true, "units: region Germany gives °C"), () => check(false, "units: region Germany gives °C"));
        check(/km\/h/.test(await text("wind")), "units: and km/h");
        await luna("luna://com.webos.service.systemservice/setPreferences", { timeFormat: "HH24" });
        await page.waitForFunction(() => document.querySelectorAll("[data-testid='hours'] .wx-hour-time")[1]?.textContent === "17:00", null, { timeout: 3000 })
            .then(() => check(true, "clock: 24-hour system clock"), () => check(false, "clock: 24-hour system clock"));
        await openMenu();
        await page.click(".pui-appmenu-item:has-text('Preferences')");
        await page.waitForSelector("[data-testid='prefs-dialog']");
        await page.click("[data-testid='pref-units']");
        await page.click(".pui-menu-item:has-text('Imperial')");
        await page.waitForTimeout(200);
        await shot("preferences");
        await page.click("[data-testid='prefs-done']");
        check((await text("now-temp")) === "74°", "units: Preferences > Imperial wins over the region");
        await luna("luna://com.webos.service.systemservice/setPreferences", { timeFormat: "HH12" });
        await luna("luna://com.webos.settingsservice/setSystemSettings", { settings: { localeInfo: { locales: { UI: "en-US", FMT: "en-US" } } } });

        // ---- Offline and errors -----------------------------------------------------------------------
        mode = "offline";
        await page.click("[data-testid='refresh']");
        await page.waitForFunction(() => /^Offline\. Forecast from /.test(document.querySelector("[data-testid='notice']")?.textContent ?? ""), null, { timeout: 5000 })
            .then(() => check(true, "offline: the last forecast, with its time"), () => check(false, "offline: the last forecast, with its time"));
        check((await text("now-temp")) === "74°", "offline: still shows the forecast");
        await shot("offline");
        await page.reload();
        await page.waitForSelector("[data-testid='now-temp']");
        check((await text("now-temp")) === "74°", "offline: after a restart too");
        mode = "limit";
        await page.click("[data-testid='refresh']");
        await page.waitForFunction(() => /Daily API request limit exceeded/.test(document.querySelector("[data-testid='notice']")?.textContent ?? ""), null, { timeout: 5000 })
            .then(() => check(true, "errors: the server's reason is shown"), () => check(false, "errors: the server's reason is shown"));
        mode = "ok";
        await page.click("[data-testid='refresh']");
        await page.waitForFunction(() => !document.querySelector("[data-testid='notice']") && !document.querySelector("[data-testid='updated'] .pui-spinner"),
                                   null, { timeout: 5000 })
            .then(() => check(true, "refresh: back online, updated"), () => check(false, "refresh: back online, updated"));

        // ---- Edit: reorder and remove ----------------------------------------------------------------
        await toPlaces();
        await page.click("[data-testid='edit']");
        await page.click("button[aria-label='Move London up']");
        let order = await page.$$eval("[data-testid='places'] .wx-place .pui-row-title", (els) => els.map((e) => e.textContent));
        check(order.join(",") === "London,Current Location", `edit: reorder (${order})`);
        await shot("edit");
        await page.click("[data-testid='remove-London']");
        await page.click("[data-testid='edit']");
        order = await page.$$eval("[data-testid='places'] .wx-place .pui-row-title", (els) => els.map((e) => e.textContent));
        check(order.join(",") === "Current Location", "edit: remove");
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("org.webosphoenix.weather")));
        check(Object.keys(stored.cache).join(",") === "current", "edit: a removed place's forecast is dropped from the cache");

        // ---- About ---------------------------------------------------------------------------------------
        await openMenu();
        await page.click(".pui-appmenu-item:has-text('About Weather Data')");
        await page.waitForSelector("[data-testid='about-dialog']");
        check(/rounded to about 1 km/.test(await text("about-dialog")), "about: says what is sent");
        await page.keyboard.press("Escape");

        // ---- No location, nothing saved --------------------------------------------------------------------
        await page.evaluate(() => { localStorage.removeItem("org.webosphoenix.weather"); window.__phoenixRuntime.location.set(null); });
        await page.reload();
        await page.waitForSelector("[data-testid='places']");
        await page.waitForFunction(() => /isn't available/.test(document.querySelector("[data-testid='places']")?.textContent ?? ""), null, { timeout: 5000 })
            .then(() => check(true, "no location: asks for a city"), () => check(false, "no location: asks for a city"));
        await shot("no-location");
        await page.evaluate(() => window.__phoenixRuntime.location.set(undefined));

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
