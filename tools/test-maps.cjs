#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Maps (apps/maps, built into dist/) in headless Chromium against
// the simulated location, db8, TTS and application manager services in
// runtime/phoenix-runtime.js. No live servers: the map draws the demo
// region shipped with the app (apps/maps/public/regions/sample), and the
// online services are answered by this script (Photon search, Valhalla
// directions, Overpass for a place's hours, the OpenFreeMap tile server
// for saving an area; the tiles
// served are the demo region's). Every other request off this machine
// fails the test.
//
// It checks: the vector map and "you are here" from the location service;
// search (online, then offline when the search server is down); a place
// card with its opening hours, phone and website; saving a place and Saved Places; sharing to Messaging; directions
// with a turn list (Valhalla, with its X-Client-Id), travel modes, each
// mode's time on its button;
// turn-by-turn navigation as the simulated device moves, with spoken
// directions; offline directions; geo:, maploc:, mapto: and address
// launches, and Contacts/Calendar's com.palm.app.maps launch reaching
// Maps; saving an area for offline use and deleting it; the canvas
// renderer; location turned off; the attribution always on the map.
//
//   node tools/test-maps.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "maps-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const APP = "org.webosphoenix.maps";
const appUrl = (params) => `${origin}/usr/palm/applications/${APP}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
const SAMPLE = path.join(REPO, "apps/maps/public/regions/sample");

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

// ---- The online services, answered here ------------------------------------------------------

// Photon: two museums in the demo region.
const PHOTON = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-121.89148, 37.33336] },
      properties: { osm_type: "N", osm_id: 101, osm_key: "tourism", osm_value: "museum", type: "house", name: "San José Museum of Art",
                    housenumber: "110", street: "South Market Street", city: "San Jose", state: "California", country: "United States" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-121.89202, 37.32652] },
      properties: { osm_type: "W", osm_id: 102, osm_key: "tourism", osm_value: "museum", type: "house", name: "Children's Discovery Museum",
                    street: "Woz Way", city: "San Jose", state: "California", country: "United States" } },
] };

// Valhalla (FOSSGIS server), a real reply for a short drive downtown.
const VALHALLA = { trip: {
    summary: { length: 0.527, time: 153.809 },
    legs: [{
        shape: "{jtefA~zrngFk@ZoAz@qS|Mk@`@qK`HmM~IoBrAcBfA_LvHcOzJmOhKaEnCeEvCwP~K}AbAgTdOxBfGPh@b@pAt@xB|ChJz@hCpAcA~@mB?yAoCaHcAg@m@?eAViA~@pDxK|CdJu]hV",
        maneuvers: [
            { type: 1, instruction: "Drive northwest on South Market Street.", verbal_pre_transition_instruction: "Drive northwest on South Market Street.",
              street_names: ["South Market Street"], length: 0.328, time: 33.626, begin_shape_index: 0 },
            { type: 15, instruction: "Turn left onto West Santa Clara Street.", verbal_pre_transition_instruction: "Turn left onto West Santa Clara Street.",
              street_names: ["West Santa Clara Street"], length: 0.051, time: 53.775, begin_shape_index: 16 },
            { type: 15, instruction: "Turn left.", verbal_pre_transition_instruction: "Turn left.", length: 0.148, time: 66.406, begin_shape_index: 22 },
            { type: 6, instruction: "Your destination is on the left.", verbal_pre_transition_instruction: "Your destination is on the left.",
              length: 0, time: 0, begin_shape_index: 33 },
        ],
    }],
} };

// Overpass: the museum's opening hours, phone and website (its OSM tags).
const OVERPASS = { elements: [{ type: "node", id: 101, tags: { name: "San José Museum of Art", opening_hours: "Tu-Su 11:00-17:00; Mo off",
                                                              phone: "+1 408 271 6840", website: "https://sjmusart.org/" } }] };

function sampleTile(z, x, y) {
    const f = path.join(SAMPLE, String(z), String(x), `${y}.pbf`);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/maps/dist/index.html"))) {
        console.error("apps/maps/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        // Software WebGL (SwiftShader) where there is no GPU.
        const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];
        const external = [];
        const net = { photon: "ok", photonQueries: [], valhalla: [], overpass: [], tiles: 0, served: 0 };

        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
            const req = route.request();
            const u = new URL(req.url());
            if (u.hostname === "photon.komoot.io") {
                net.photonQueries.push(u.searchParams.get("q") || u.pathname);
                if (net.photon !== "ok") return route.fulfill({ status: 503, body: "down" });
                if (u.pathname === "/reverse") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ features: [PHOTON.features[0]] }) });
                const q = (u.searchParams.get("q") || "").toLowerCase();
                const hits = PHOTON.features.filter((f) => q.split(/\s+/).every((w) => JSON.stringify(f.properties).toLowerCase().includes(w)));
                return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ type: "FeatureCollection", features: hits }) });
            }
            if (u.hostname === "overpass-api.de") {
                net.overpass.push(decodeURIComponent((req.postData() || "").replace(/^data=/, "")));
                return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(OVERPASS) });
            }
            if (u.hostname === "valhalla1.openstreetmap.de") {
                if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "X-Client-Id" } });
                net.valhalla.push({ json: JSON.parse(u.searchParams.get("json") || "{}"), clientId: req.headers()["x-client-id"] });
                return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(VALHALLA) });
            }
            if (u.hostname === "tiles.openfreemap.org") {
                if (u.pathname === "/planet") {
                    return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
                                           body: JSON.stringify({ tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf"] }) });
                }
                const m = /\/planet\/test\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(u.pathname);
                if (m) {
                    net.tiles++;
                    const t = sampleTile(m[1], m[2], m[3]);
                    if (t) net.served++;
                    return route.fulfill({ status: t ? 200 : 204, headers: { "Access-Control-Allow-Origin": "*" }, body: t || "" });
                }
                return route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "" });
            }
            external.push(req.url());
            return route.abort();
        });

        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|status of 404|status of 503/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const tid = (id) => `[data-testid='${id}']`;
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p));
        }), [uri, params]);
        const pick = async (testId, label) => {
            await page.click(tid(testId));
            await page.click(`.pui-popup .pui-menu-item:has(.pui-menu-label:text-is("${label}"))`);
            await page.waitForSelector(".pui-popup", { state: "detached" });
        };
        // The map has drawn everything it asked for.
        const settled = async () => {
            await page.waitForFunction(() => {
                const el = document.querySelector("[data-testid='map']");
                return el && el.dataset.ready === "1" && Date.now() - Number(el.dataset.idle || 0) > 300;
            }, null, { timeout: 20000 });
        };
        const relaunch = (params) => page.evaluate((p) => {
            document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: p }));
        }, params);
        const setLocation = (lat, lon, extra) => page.evaluate(([a, b, x]) => window.__phoenixRuntime.location.set(a, b, x), [lat, lon, extra || {}]);
        const spoken = () => page.evaluate(() => window.__phoenixRuntime.tts.spoken.map((s) => s.text));
        const search = async (q) => {
            await page.fill(tid("search"), q);
            await page.press(tid("search"), "Enter");
            await page.waitForSelector(`${tid("results")} ${tid("result")}, ${tid("no-results")}, ${tid("results-note")}`);
        };
        const closePanels = async () => {
            for (let i = 0; i < 4 && await page.locator(tid("panel")).count(); i++) await page.keyboard.press("Escape");
        };

        // Start from a fresh device.
        await page.goto(appUrl());
        await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("phoenix-maps"); });
        await page.reload();

        // ---- The map ------------------------------------------------------------------------
        await page.waitForSelector(tid("map"));
        await settled();
        const renderer = await page.evaluate(() => !!window.__phoenixMap && !!document.querySelector(".maplibregl-canvas"));
        check(renderer, "draws the vector map with MapLibre GL (WebGL)");
        const drawn = await page.evaluate(() => {
            const c = document.querySelector(".maplibregl-canvas");
            const g = c.getContext("webgl2");
            const px = new Uint8Array(4 * 64);
            g.readPixels(Math.floor(c.width / 2) - 32, Math.floor(c.height / 2), 64, 1, g.RGBA, g.UNSIGNED_BYTE, px);
            const colours = new Set();
            for (let i = 0; i < px.length; i += 4) colours.add(px.slice(i, i + 3).join(","));
            return colours.size;
        });
        check(drawn > 3, `the demo region's streets are drawn offline (${drawn} colours across the middle)`);
        await page.waitForSelector(tid("my-location"), { state: "attached" });
        check(true, "shows \"you are here\" from com.webos.service.location");
        const attribution = await page.textContent(tid("attribution"));
        check(/OpenStreetMap contributors/.test(attribution) && /OpenMapTiles/.test(attribution), `attribution on the map: "${attribution}"`);
        await shot("map");

        // Rotate, then north up again.
        await page.evaluate(() => window.__phoenixMap.rotateTo(40, { duration: 0 }));
        await page.waitForSelector(tid("compass"));
        await page.click(tid("compass"));
        await page.waitForSelector(tid("compass"), { state: "detached" });
        check(true, "rotating shows the compass; tapping it turns north up");

        // ---- Search (online) ------------------------------------------------------------------
        await search("museum");
        const names = await page.$$eval(`${tid("results")} .pui-row-title`, (els) => els.map((e) => e.textContent));
        check(names.length === 2 && names[0] === "San José Museum of Art", `Photon results: ${names.join(", ")}`);
        check(net.photonQueries.includes("museum"), "searched Photon only when asked");
        check(tablet === (await page.locator(".mp-panel.side").count() === 1), tablet ? "tablet: results in a column on the left" : "phone: results in a sheet");
        await page.waitForTimeout(800);
        await shot("search");
        await page.click(`${tid("result")} >> nth=0`);
        await page.waitForSelector(tid("place-card"));
        check((await page.textContent(tid("place-name"))) === "San José Museum of Art", "a result opens its place card");
        check(/110 South Market Street/.test(await page.textContent(tid("place-detail"))), "with its address");
        await page.waitForSelector(tid("place-hours"));
        check(/Tue–Sun 11:00–17:00 · Mon off/.test(await page.textContent(tid("place-hours"))) && net.overpass[0] === "[out:json][timeout:10];node(101);out tags;",
              `its opening hours from its OSM tags (Overpass): ${await page.textContent(tid("place-hours"))}`);
        check((await page.textContent(tid("place-phone"))) === "+1 408 271 6840" && /sjmusart\.org/.test(await page.textContent(tid("place-website"))), "its phone and website");
        await page.waitForTimeout(800);
        await shot("place");

        // Save it.
        await page.click(tid("save-place"));
        await page.waitForFunction(() => document.querySelector("[data-testid='save-place']").getAttribute("aria-pressed") === "true");
        const savedObjs = (await luna("luna://com.palm.db/find", { query: { from: "org.webosphoenix.maps.place:1" } })).results || [];
        check(savedObjs.length === 1 && savedObjs[0].name === "San José Museum of Art" && /museum/.test(savedObjs[0].searchText),
              "saving puts the place in db8 (org.webosphoenix.maps.place:1)");

        // Share it with Messaging.
        host.length = 0;
        await page.click(tid("share"));
        await page.click(`.pui-popup .pui-menu-item:has(.pui-menu-label:text-is("Messaging"))`);
        await page.waitForTimeout(200);
        const shareLaunch = host.find((m) => m.type === "launch");
        check(!!shareLaunch && shareLaunch.payload.id === "org.webosphoenix.messaging"
              && /openstreetmap\.org\/\?mlat=37\.33336/.test(shareLaunch.payload.params.messageText || ""),
              "Share > Messaging starts a message with the place and a map link");

        // ---- Directions (Valhalla) -----------------------------------------------------------
        await page.click(tid("directions"));
        await page.waitForSelector(tid("steps"));
        let steps = await page.$$eval(`${tid("steps")} .mp-step-text`, (els) => els.map((e) => e.textContent));
        check(steps.length === 4 && steps[0] === "Drive northwest on South Market Street", `a turn list: ${steps.join(" / ")}`);
        check(net.valhalla.length >= 1 && net.valhalla[0].json.costing === "auto" && net.valhalla[0].clientId === "webos-phoenix-maps",
              "asked Valhalla for a drive, with the app's X-Client-Id");
        // Then each other mode's time, for its button.
        await page.waitForSelector(`${tid("mode-time-walk")}, ${tid("mode-time-cycle")}`);
        await page.waitForFunction(() => document.querySelector("[data-testid='mode-time-walk']") && document.querySelector("[data-testid='mode-time-cycle']"));
        check(net.valhalla.slice(1, 3).map((v) => v.json.costing).sort().join() === "bicycle,pedestrian",
              `every mode's time on its button: ${await page.textContent(".mp-modes")}`);
        check(/min/.test(await page.textContent(tid("route-summary"))), "with the time and distance");
        await page.waitForTimeout(900);
        await shot("directions");
        await page.click(tid("mode-walk"));
        await page.waitForFunction((n) => document.querySelectorAll("[data-testid='step']").length > 0 && n, net.valhalla.length);
        await page.waitForTimeout(300);
        check(net.valhalla[net.valhalla.length - 1].json.costing === "pedestrian", "Walk asks for a walking route");
        await page.click(tid("mode-cycle"));
        await page.waitForTimeout(300);
        check(net.valhalla[net.valhalla.length - 1].json.costing === "bicycle", "Cycle asks for a cycling route");
        await page.click(tid("mode-drive"));
        await page.waitForSelector(tid("start-nav"));

        // ---- Turn by turn --------------------------------------------------------------------
        // The line is drawn once the style has loaded; wait for it rather than read it early.
        const routeLine = () => page.evaluate(async () => {
            const src = window.__phoenixMap.getSource("phx-route");
            return src ? (await src.getData()).geometry.coordinates : null;
        });
        let geometry = await routeLine();
        for (let i = 0; i < 50 && !(geometry && geometry.length); i++) {
            await page.waitForTimeout(100);
            geometry = await routeLine();
        }
        check(Array.isArray(geometry) && geometry.length > 20, "the route is drawn on the map");
        if (!Array.isArray(geometry) || geometry.length <= 20) throw new Error("no route on the map; the navigation checks need it");
        await page.click(tid("start-nav"));
        await page.waitForSelector(tid("nav-banner"));
        check(/Turn left onto West Santa Clara Street/.test(await page.textContent(tid("nav-instruction"))), "navigation shows the next turn");
        const said0 = await spoken();
        check(said0.some((t) => /Drive northwest on South Market Street/.test(t)), "and says the first direction (com.webos.service.tts)");
        // Drive along: shape points 8 and 14 (before the first turn), then past it.
        await setLocation(geometry[8][1], geometry[8][0], { speed: 10, direction: 330 });
        await page.waitForTimeout(400);
        const d1 = await page.textContent(tid("nav-distance"));
        await setLocation(geometry[14][1], geometry[14][0], { speed: 10, direction: 330 });
        await page.waitForTimeout(400);
        const d2 = await page.textContent(tid("nav-distance"));
        check(d1 !== d2, `the distance to the turn counts down (${d1} -> ${d2})`);
        check((await spoken()).some((t) => /turn left onto West Santa Clara Street/i.test(t)), "announces the turn ahead");
        await page.waitForTimeout(500);
        await shot("navigation");
        await setLocation(geometry[19][1], geometry[19][0], { speed: 8, direction: 240 });
        await page.waitForFunction(() => /Turn left$/.test(document.querySelector("[data-testid='nav-instruction']").textContent));
        check(true, "after the turn, the next one is shown");
        const end = geometry[geometry.length - 1];
        await setLocation(end[1], end[0], { speed: 0 });
        await page.waitForFunction(() => document.querySelector("[data-testid='nav-distance']").textContent === "Arrived");
        check((await spoken()).some((t) => /arrived/i.test(t)), "arriving is announced");
        await page.click(tid("nav-end"));
        await page.waitForSelector(tid("nav-banner"), { state: "detached" });
        check(true, "End leaves navigation");
        await closePanels();
        await page.evaluate(() => window.__phoenixRuntime.location.reset());

        // ---- Search offline (the server is down) ---------------------------------------------
        net.photon = "down";
        await search("San Pedro Square");
        const offlineNames = await page.$$eval(`${tid("results")} .pui-row-title`, (els) => els.map((e) => e.textContent));
        check(offlineNames[0] === "San Pedro Square", `offline search in the demo region: ${offlineNames.slice(0, 3).join(", ")}`);
        check(/offline maps/i.test(await page.textContent(tid("results-note"))), "says the results come from offline maps");
        await closePanels();
        await search("Ferry Building");     // outside the demo region: nothing offline either
        check(/Search is not available/.test(await page.textContent(tid("results-note"))), "a failed search says search is not available");
        check(await page.locator(tid("no-results")).count() === 0, "and not \"No places found\" as well");
        await closePanels();

        // ---- Preferences: offline directions ---------------------------------------------------
        await page.click(tid("menu-button"));
        await page.click(".pui-appmenu-item:has-text('Preferences')");
        await page.waitForSelector(tid("settings"));
        await pick("pref-routing", "Offline maps only");
        await page.click(tid("pref-apply"));
        await page.click(tid("page-done"));
        await page.waitForSelector(tid("settings"), { state: "detached" });
        await search("San Pedro Square");
        await page.click(`${tid("result")} >> nth=0`);
        await page.click(tid("directions"));
        await page.waitForSelector(tid("steps"), { timeout: 20000 });
        steps = await page.$$eval(`${tid("steps")} .mp-step-text`, (els) => els.map((e) => e.textContent));
        const before = net.valhalla.length;
        check(steps.length >= 3 && /^Drive along /.test(steps[0]) && steps.some((s) => /Street/.test(s)) && /arrived/.test(steps[steps.length - 1]),
              `offline directions from the tiles: ${steps.join(" / ")}`);
        check(/offline/i.test(await page.textContent(".mp-credit")) && net.valhalla.length === before, "without the routing server");
        await page.waitForTimeout(900);
        await shot("offline-directions");
        await closePanels();

        // ---- Launches from other apps ----------------------------------------------------------
        await relaunch({ target: "geo:37.3363,-121.894?z=17" });
        await page.waitForSelector(tid("place-card"));
        check(/37\.33630, -121\.89400/.test(await page.textContent(tid("place-coords"))), "a geo: URI shows that point");
        await relaunch({ address: "100 Market Street\nSan Jose, CA" });
        await page.waitForFunction(() => /Market Street/.test(document.querySelector("[data-testid='place-name']")?.textContent || ""));
        check(true, `Contacts' {address} launch finds it (offline): ${await page.textContent(tid("place-name"))}`);
        await relaunch({ target: "mapto:San Pedro Square" });
        await page.waitForSelector(tid("directions-panel"));
        await page.waitForFunction(() => /San Pedro Square/.test(document.querySelector("[data-testid='dir-to']").textContent));
        check(true, "mapto: opens directions to the place");
        await closePanels();
        host.length = 0;
        await luna("luna://com.palm.applicationManager/launch", { id: "com.palm.app.maps", params: { address: "1 Main St" } });
        await luna("luna://com.palm.applicationManager/open", { target: "geo:37.33,-121.89" });
        const launches = host.filter((m) => m.type === "launch").map((m) => m.payload);
        check(launches.length === 2 && launches.every((l) => l.id === APP) && launches[1].params.target === "geo:37.33,-121.89",
              "Contacts' and Calendar's com.palm.app.maps launch and geo: links open Maps");

        // ---- Saved places -------------------------------------------------------------------------
        await page.click(tid("saved-button"));
        await page.waitForSelector(tid("saved"));
        await page.click(tid("saved-San José Museum of Art"));
        await page.waitForSelector(tid("place-card"));
        check((await page.textContent(tid("place-name"))) === "San José Museum of Art", "Saved Places opens a saved place");
        const savedId = savedObjs[0]._id;
        await relaunch({ placeId: savedId });
        await page.waitForTimeout(300);
        check((await page.textContent(tid("place-name"))) === "San José Museum of Art", "Just Type's {placeId} launch opens it");
        await closePanels();

        // ---- Offline maps: save the area on screen ----------------------------------------------
        await page.evaluate(() => window.__phoenixMap.jumpTo({ center: [-121.8907, 37.3337], zoom: 17.5 }));
        await settled();
        await page.click(tid("regions-button"));
        await page.waitForSelector(tid("regions"));
        check(await page.locator(tid("region-sample")).count() === 1, "Offline Maps lists the demo region");
        const size = await page.textContent(`${tid("region-size")} .pui-row-value`);
        await page.fill(tid("region-name"), "Plaza");
        net.tiles = 0;
        net.served = 0;
        await page.click(tid("region-save"));
        await page.waitForSelector(".pui-row:has-text('Plaza')", { timeout: 30000 });
        const stored = await page.evaluate(() => new Promise((res) => {
            const r = indexedDB.open("phoenix-maps");
            r.onsuccess = () => { const c = r.result.transaction("tiles").objectStore("tiles").count(); c.onsuccess = () => res(c.result); };
        }));
        // The server here has only the demo region's zooms (0, 10-14); the rest are empty tiles.
        check(stored >= 5 && stored === net.served && net.tiles === Number(size.replace(/\D/g, "")),
              `saved the area (${size} fetched): the ${stored} with data in IndexedDB`);
        await shot("offline-maps");
        await page.click(".pui-row:has-text('Plaza') .mp-row-delete");
        await page.click(tid("confirm-ok"));
        await page.waitForSelector(".pui-row:has-text('Plaza')", { state: "detached" });
        check(true, "and deletes it");
        await page.click(tid("page-done"));

        // ---- The canvas renderer (no WebGL) --------------------------------------------------------
        await page.click(tid("menu-button"));
        await page.click(".pui-appmenu-item:has-text('Preferences')");
        await pick("pref-renderer", "Canvas (no WebGL)");
        await page.click(tid("pref-apply"));
        await page.click(tid("page-done"));
        await page.waitForSelector(".leaflet-container");
        await page.waitForFunction(() => document.querySelectorAll(".leaflet-tile-loaded").length > 0);
        await page.waitForTimeout(800);
        const canvasColours = await page.evaluate(() => {
            const c = document.querySelector(".leaflet-tile-loaded");
            const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            const s = new Set();
            for (let i = 0; i < d.length; i += 97 * 4) s.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
            return s.size;
        });
        check(canvasColours > 3, `the canvas renderer draws the same tiles (${canvasColours} colours in a tile)`);
        await shot("canvas");
        await page.click(tid("menu-button"));
        await page.click(".pui-appmenu-item:has-text('Preferences')");
        await page.click(tid("pref-reset"));
        await page.click(tid("page-done"));
        await page.waitForSelector(".maplibregl-canvas");
        check(true, "Reset to Defaults goes back to the vector map");

        // ---- Location off --------------------------------------------------------------------
        await luna("luna://com.webos.service.location/setState", { Handler: "gps", state: false });
        await luna("luna://com.webos.service.location/setState", { Handler: "network", state: false });
        await page.reload();
        await page.waitForSelector(tid("location-status"));
        check(/off/i.test(await page.textContent(tid("location-status"))), "says when location services are off");
        await luna("luna://com.webos.service.location/setState", { Handler: "gps", state: true });
        await luna("luna://com.webos.service.location/setState", { Handler: "network", state: true });

        check(external.length === 0, `no requests to other servers${external.length ? ": " + external.slice(0, 3).join(", ") : ""}`);
        check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
