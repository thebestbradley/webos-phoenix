#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant and Maps together, end to end (the owner's "find coffee
// shops near me": a place far away, a search field holding the whole
// sentence, coffee shops that could not be picked, no way to start the
// navigation). In headless Chromium, against the simulated services of
// runtime/phoenix-runtime.js, the device downtown San Jose:
//
//   - asked "find coffee shops near me", the Assistant answers with the
//     closest ones as cards (Photon asked for amenity=cafe inside a box
//     around the device, not the words anywhere), and opens Maps behind on
//     {nearby: "coffee shops"};
//   - Maps on that launch: "coffee shops" in its field, the list closest
//     first with pins, the map around the user; a result tapped opens its
//     card;
//   - a card tapped in the conversation: Maps on that place (returnToCaller,
//     $caller), its pin, the map near the user, its card with distance and
//     opening hours (Overpass); Directions: the route drawn, its time and
//     each mode's; Start: turn-by-turn, the turn list with the coming turn
//     highlighted, which moves on as the device does, then "arrived";
//     Back through what the user opened in Maps, then Back on the view the
//     Assistant opened goes back to the Assistant (the runtime closes the card);
//   - "directions to the nearest coffee shop": a card with the time there
//     and Start Navigation, which opens Maps navigating;
//   - Settings > Language & Region > Units: metric chosen on a US device,
//     the Assistant and Maps both answer in metres.
//
// The map data services are answered from tools/fixtures/maps (replies
// recorded from Photon, Valhalla's FOSSGIS server and Overpass on 9 October
// 2026; © OpenStreetMap contributors, ODbL); the map draws the demo region
// Maps ships. Nothing else leaves this machine.
//
//   node tools/test-assistant-maps.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "assistant-maps-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const root = `${origin}/usr/palm/applications`;
const ASSISTANT = "org.webosphoenix.assistant", MAPS = "org.webosphoenix.maps";
const mapsUrl = (params) => `${root}/${MAPS}/index.html?launchParams=` + encodeURIComponent(JSON.stringify(params));
const FIX = path.join(__dirname, "fixtures/maps");
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const SAMPLE = path.join(REPO, "apps/maps/public/regions/sample");
// The device: downtown San Jose (the runtime's home position).
const HOME = { lat: 37.3337, lon: -121.8907 };

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

function metres(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const x = Math.sin((b.lat - a.lat) * r / 2), y = Math.sin((b.lon - a.lon) * r / 2);
    return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * r) * Math.cos(b.lat * r) * y * y));
}

async function main() {
    for (const app of ["assistant", "maps"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
        const context = await browser.newContext({ viewport });
        const errors = [], launches = [], external = [];
        const net = { photon: [], valhalla: [], overpass: [] };

        // The data services: the Assistant's through the runtime's proxy
        // (POST /__phoenix/proxy), Maps' straight from the page.
        const valhalla = (costing) => fixture(`valhalla-${costing}.json`);
        const answer = (url, body) => {
            const u = new URL(url);
            if (u.hostname === "photon.komoot.io") {
                net.photon.push(u);
                const cafes = u.searchParams.getAll("include").includes("osm.amenity.cafe");
                return cafes ? fixture("photon-cafes.json") : JSON.stringify({ type: "FeatureCollection", features: [] });
            }
            if (u.hostname === "valhalla1.openstreetmap.de") {
                const q = JSON.parse(u.searchParams.get("json") || "{}");
                net.valhalla.push(q);
                return valhalla(q.costing);
            }
            if (u.hostname === "overpass-api.de") {
                net.overpass.push(decodeURIComponent(String(body || "").replace(/^data=/, "")));
                return fixture("overpass-city-bagels.json");
            }
            return null;
        };
        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
            const req = route.request();
            const u = new URL(req.url());
            if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
            const body = answer(req.url(), req.postData());
            if (body !== null) return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body });
            if (u.hostname === "tiles.openfreemap.org") {
                if (u.pathname === "/planet") return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf"] }) });
                const m = /\/planet\/test\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(u.pathname);
                const f = m && path.join(SAMPLE, m[1], m[2], `${m[3]}.pbf`);
                return route.fulfill({ status: f && fs.existsSync(f) ? 200 : 204, headers: { "Access-Control-Allow-Origin": "*" }, body: f && fs.existsSync(f) ? fs.readFileSync(f) : "" });
            }
            external.push(req.url());
            return route.abort();
        });
        await context.route(`${origin}/__phoenix/proxy`, async (route) => {
            const req = JSON.parse(route.request().postData() || "{}");
            const body = answer(req.url, req.body);
            if (body === null) { external.push(req.url); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ error: "offline", code: "ENOTFOUND" }) }); }
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: 200, headers: { "content-type": "application/json" }, body }) });
        });

        const watch = (page, name) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    if (msg.type === "launch") launches.push(msg.payload);
                } else if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|status of 404/.test(t)) {
                    errors.push(`${name}: ${t}`);
                }
            });
        };
        const tid = (id) => `[data-testid='${id}']`;
        const until = async (what, ms = 10000) => {
            for (let t = 0; t < ms; t += 100) { const v = what(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
            return null;
        };

        // ---- The Assistant ----------------------------------------------------------------------
        const app = await context.newPage();
        watch(app, "assistant");
        await app.goto(`${root}/${ASSISTANT}/index.html`);
        await app.evaluate(() => localStorage.clear());
        await app.reload();
        await app.evaluate(([lat, lon]) => window.__phoenixRuntime.location.set(lat, lon), [HOME.lat, HOME.lon]);
        const ask = async (text) => {
            const before = await app.locator(".as-row.in").count();
            await app.fill(tid("as-input"), text);
            await app.press(tid("as-input"), "Enter");
            await app.waitForFunction((n) => document.querySelectorAll(".as-row.in").length > n && !document.querySelector("[data-testid='as-thinking']"), before, { timeout: 15000 });
            await app.waitForTimeout(300);
            return app.locator(".as-row.in").nth((await app.locator(".as-row.in").count()) - 1);
        };
        let reply = await ask("find coffee shops near me");
        // The first time, the Assistant asks to use the location.
        if (/I need your location/.test(await reply.textContent())) {
            const before = await app.locator(".as-row.in").count();
            await reply.locator("button", { hasText: "Allow" }).first().click();
            await app.waitForFunction((n) => document.querySelectorAll(".as-row.in").length >= n + 2, before, { timeout: 15000 });
            await app.waitForTimeout(300);
            reply = app.locator(".as-row.in").nth((await app.locator(".as-row.in").count()) - 1);
        }
        const said = await reply.locator(".as-bubble").textContent();
        check(/^Here are coffee shops near you, closest first\. The closest is Café Too, (?:50 m|180 ft) away\.$/.test(said), `the answer: "${said}"`);
        const cards = await reply.locator(".as-card .as-card-title").allTextContents();
        check(cards.join(" | ") === "Café Too | Poppy and Claro | Tea Alley | City Bagels | The Tech Cafe", `the closest five as cards: ${cards.join(" | ")}`);
        const asked = net.photon[0];
        check(asked && asked.searchParams.getAll("include").join() === "osm.amenity.cafe" && !asked.searchParams.get("q")
              && metres(HOME, { lat: Number(asked.searchParams.get("lat")), lon: Number(asked.searchParams.get("lon")) }) < 20 && !!asked.searchParams.get("bbox"),
              "Photon asked for cafés (their OSM tag) in a box around the device, not for the sentence anywhere");
        const behind = launches.find((l) => l.id === MAPS);
        check(behind && behind.params.nearby === "coffee shops" && behind.behind === true, `Maps opened behind on {nearby: "coffee shops"}: ${JSON.stringify(behind && behind.params)}`);
        await app.screenshot({ path: path.join(outDir, "1-assistant-cards.png") });

        // ---- Maps, as opened behind: the list ---------------------------------------------------------
        const maps = await context.newPage();
        watch(maps, "maps");
        // (One origin: the device's storage, cleared above, is the Assistant's too.)
        await maps.goto(mapsUrl(behind.params));
        await maps.waitForSelector(`${tid("results")} ${tid("result")}`, { timeout: 20000 });
        check((await maps.inputValue(tid("search"))) === "coffee shops", `Maps' field holds what is looked for: "${await maps.inputValue(tid("search"))}"`);
        const listed = await maps.$$eval(`${tid("results")} .pui-row-title`, (els) => els.slice(0, 3).map((e) => e.textContent));
        check(listed.join(" | ") === "Café Too | Poppy and Claro | Tea Alley", `the list, closest first: ${listed.join(" | ")}`);
        check(await maps.locator(tid("marker-result")).count() === 20, "a pin for each");
        await maps.waitForTimeout(900);
        const centre = await maps.evaluate(() => { const c = window.__phoenixMap.getCenter(); return { lat: c.lat, lon: c.lng }; });
        check(metres(centre, HOME) < 1000, `the map is around the user (${Math.round(metres(centre, HOME))} m from them)`);
        await maps.screenshot({ path: path.join(outDir, "2-maps-list.png") });
        await maps.click(`${tid("result")} >> nth=1`);
        await maps.waitForSelector(tid("place-card"));
        check((await maps.textContent(tid("place-name"))) === "Poppy and Claro", "a result tapped opens its card");
        await maps.close();

        // ---- A card tapped in the conversation: Maps on that place ---------------------------------
        launches.length = 0;
        await reply.locator(".as-card").nth(3).click();
        const onPlace = await until(() => launches.find((l) => l.id === MAPS));
        check(onPlace && onPlace.params.place && onPlace.params.place.name === "City Bagels" && onPlace.params.$caller === ASSISTANT && !onPlace.behind,
              `the card opens Maps in front on that place: ${JSON.stringify(onPlace && onPlace.params)}`);
        const place = await context.newPage();
        watch(place, "maps (place)");
        await place.goto(mapsUrl({ ...onPlace.params, $caller: ASSISTANT }));
        await place.waitForSelector(tid("place-card"), { timeout: 20000 });
        check((await place.textContent(tid("place-name"))) === "City Bagels", "Maps shows the place's card");
        check(/West Santa Clara Street/.test(await place.textContent(tid("place-detail"))), "with its address");
        await place.waitForSelector(tid("place-distance"));
        check(/^(?:7\d0 ft|0\.1 mi|2\d0 m) away$/.test(await place.textContent(tid("place-distance"))), `and how far it is: ${await place.textContent(tid("place-distance"))}`);
        await place.waitForSelector(tid("place-hours"));
        check(/Mon–Fri 6:00–14:00 · Sat–Sun 6:00–13:30/.test(await place.textContent(tid("place-hours"))) && net.overpass.some((q) => /node\(3555373048\)/.test(q)),
              `its opening hours (Overpass): ${await place.textContent(tid("place-hours"))}`);
        check(await place.locator(tid("marker-selected")).count() === 1, "its pin on the map");
        await place.waitForTimeout(900);
        const at = await place.evaluate(() => { const c = window.__phoenixMap.getCenter(); return { lat: c.lat, lon: c.lng }; });
        check(metres(at, { lat: 37.3356689, lon: -121.8911368 }) < 60 && metres(at, HOME) < 1000, "the map on it, near the user");
        await place.screenshot({ path: path.join(outDir, "3-maps-place.png") });

        // Directions: the route, its time, each mode's.
        net.valhalla.length = 0;
        await place.click(tid("directions"));
        await place.waitForSelector(tid("route-summary"));
        await place.waitForSelector(`${tid("mode-time-walk")}`);
        await place.waitForSelector(`${tid("mode-time-cycle")}`);
        check(/1 min/.test(await place.textContent(tid("route-summary"))), `the time and distance: ${await place.textContent(tid("route-summary"))}`);
        check((await place.textContent(tid("mode-time-walk"))) === "3 min" && net.valhalla[0].costing === "auto"
              && metres({ lat: net.valhalla[0].locations[0].lat, lon: net.valhalla[0].locations[0].lon }, HOME) < 20,
              `from the user, by car first; each mode's time on its button: ${await place.textContent(".mp-modes")}`);
        const steps = await place.$$eval(`${tid("steps")} .mp-step-text`, (els) => els.map((e) => e.textContent));
        check(steps[1] === "Turn right onto West Santa Clara Street", `the turns: ${steps.join(" / ")}`);
        await place.waitForTimeout(800);
        await place.screenshot({ path: path.join(outDir, "4-maps-directions.png") });

        // Start: turn by turn, the coming turn highlighted.
        await place.click(tid("start-nav"));
        await place.waitForSelector(tid("nav-banner"));
        if (!tablet) await place.click(tid("nav-steps-button"));
        await place.waitForSelector(tid("nav-steps"));
        const current = () => place.$eval(".mp-step.current .mp-step-text", (e) => e.textContent);
        check((await current()) === "Turn right onto West Santa Clara Street", `navigating: the coming turn highlighted (${await current()})`);
        await place.waitForTimeout(600);
        await place.screenshot({ path: path.join(outDir, "5-maps-navigating.png") });
        // The device moves past the turn, then to the door.
        await place.evaluate(() => window.__phoenixRuntime.location.set(37.33608, -121.89118));
        await place.waitForFunction(() => /destination/.test(document.querySelector(".mp-step.current .mp-step-text")?.textContent || ""), null, { timeout: 10000 });
        check(await place.locator(".mp-step.done").count() === 2, "past the turn: the next one highlighted, those done dimmed");
        await place.evaluate(() => window.__phoenixRuntime.location.set(37.3356689, -121.8911368));
        await place.waitForFunction(() => /Arrived/.test(document.querySelector("[data-testid='nav-distance']")?.textContent || ""), null, { timeout: 10000 });
        check(true, "at the door: arrived");
        await place.screenshot({ path: path.join(outDir, "6-maps-arrived.png") });

        // Back: out of navigation, out of directions, then to the Assistant.
        await place.evaluate(() => { window.__closed = false; window.close = () => { window.__closed = true; }; });
        const back = () => place.evaluate(() => window.__phoenixRuntime.back());
        await back();
        await place.waitForSelector(tid("directions-panel"));
        await back();
        await place.waitForSelector(tid("place-card"));
        check(!(await place.evaluate(() => window.__closed)), "Back leaves navigation, then directions, in Maps");
        launches.length = 0;
        await back();
        const ret = await until(() => launches.find((l) => l.id === ASSISTANT));
        check(!!ret && ret.returnTo === true && !(await place.evaluate(() => window.__closed)),
              "Back on the place the Assistant opened brings the Assistant back, Maps staying open behind it");
        await place.close();

        // ---- "Directions to the nearest coffee shop" -----------------------------------------------
        launches.length = 0;
        await app.evaluate(([lat, lon]) => window.__phoenixRuntime.location.set(lat, lon), [HOME.lat, HOME.lon]);
        reply = await ask("directions to the nearest coffee shop");
        const dir = await reply.locator(".as-bubble").textContent();
        check(/^Café Too \(110 South Market Street, San Jose\) is 1 min away by car, /.test(dir), `the answer: "${dir}"`);
        check(/1 min by car/.test(await reply.locator(".as-card .as-card-sub").first().textContent()), "its card with the time there");
        const opened = await until(() => launches.find((l) => l.id === MAPS));
        check(opened && opened.params.destination && opened.params.destination.name === "Café Too" && opened.params.travelMode === "drive" && opened.behind,
              "Maps opened behind on the directions");
        await app.screenshot({ path: path.join(outDir, "7-assistant-directions.png") });
        launches.length = 0;
        await reply.locator("button", { hasText: "Start Navigation" }).click();
        const start = await until(() => launches.find((l) => l.id === MAPS));
        check(start && start.params.navigate === true && start.params.destination.name === "Café Too", "Start Navigation opens Maps navigating");
        const nav = await context.newPage();
        watch(nav, "maps (navigate)");
        await nav.goto(mapsUrl({ ...start.params, $caller: ASSISTANT }));
        await nav.waitForSelector(tid("nav-banner"), { timeout: 20000 });
        check(true, "Maps starts the turn-by-turn guidance at once");
        await nav.screenshot({ path: path.join(outDir, "8-maps-start-navigation.png") });

        // ---- One setting for the units: Settings > Language & Region > Units ----------------------
        // The device is in the US (miles); metric chosen there, Maps and the Assistant both follow.
        const set = await context.newPage();
        watch(set, "settings");
        await set.goto(`${root}/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify({ page: "language" })));
        await set.waitForSelector(tid("units"));
        check(/Automatic \(miles, °F\)/.test(await set.textContent(tid("units"))), `Units: Automatic, by the region (${await set.textContent(tid("units"))})`);
        await set.click(tid("units"));
        await set.click(`.pui-popup .pui-menu-item:has(.pui-menu-label:text-is("Metric (km, °C)"))`);
        await set.waitForSelector(".pui-popup", { state: "detached" });
        await set.screenshot({ path: path.join(outDir, "9-settings-units.png") });
        await app.evaluate(([lat, lon]) => window.__phoenixRuntime.location.set(lat, lon), [HOME.lat, HOME.lon]);
        reply = await ask("coffee near me");
        const metric = await reply.locator(".as-bubble").textContent();
        check(/Café Too, [56]0 m away\.$/.test(metric), `the Assistant answers in metres now: "${metric}"`);
        const km = await context.newPage();
        watch(km, "maps (metric)");
        await km.goto(mapsUrl({ place: { id: "photon:N3555373048", name: "City Bagels", lat: 37.3356689, lon: -121.8911368 } }));
        await km.waitForSelector(tid("place-distance"), { timeout: 20000 });
        check(/^2\d0 m away$/.test(await km.textContent(tid("place-distance"))), `and Maps in metres: ${await km.textContent(tid("place-distance"))}`);

        check(external.length === 0, `no requests to other servers${external.length ? ": " + [...new Set(external)].join(", ") : ""}`);
        check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
