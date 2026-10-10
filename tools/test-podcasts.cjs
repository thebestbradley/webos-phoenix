#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Podcasts (apps/podcasts, built into dist/) in headless Chromium
// against a feed server this script runs on 127.0.0.1 (two podcasts whose
// episodes are the demo chiptunes) and the simulated services: subscribes
// by address, lists the episodes, downloads one (the download manager;
// the file in /media/internal/podcasts), plays it (speed, sleep timer,
// skipping, the place kept), gives the audio focus up when another player
// takes it, finds a podcast through the directory search (Apple's API,
// answered here), exports and imports OPML, unsubscribes, and refreshes in
// the background when the activity fires (a new episode and a
// notification).
//
//   node tools/test-podcasts.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const http = require("http");
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "podcasts-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const feedPort = port + 100;
const origin = `http://127.0.0.1:${port}`;
const feeds = `http://127.0.0.1:${feedPort}`;
const APP = "org.webosphoenix.podcasts";
const appUrl = (params) => `${origin}/usr/palm/applications/${APP}/index.html` +
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

// ---- The feed server --------------------------------------------------------------------

const MUSIC = path.join(REPO, "apps/media-samples/media/music");
const extraEpisodes = [];
function rss(title, author, slug, eps) {
    const items = eps.map((e) => `
    <item>
      <title>${e.title}</title>
      <guid isPermaLink="false">${slug}-${e.n}</guid>
      <pubDate>${new Date(Date.UTC(2026, 8, e.day, 9)).toUTCString()}</pubDate>
      <itunes:duration>${e.duration}</itunes:duration>
      <description><![CDATA[<p>${e.title}: a chiptune from the <b>Phoenix</b> demo media.</p>]]></description>
      <enclosure url="${feeds}/audio/${e.file}" length="${fs.statSync(path.join(MUSIC, e.file)).size}" type="audio/ogg"/>
    </item>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${title}</title>
    <link>${feeds}/</link>
    <description>A test podcast for webOS Phoenix.</description>
    <itunes:author>${author}</itunes:author>
    <itunes:image href="${feeds}/art/${slug}.jpg"/>${items}
  </channel>
</rss>`;
}
function harborFeed() {
    return rss("Harbor Radio", "Phoenix Test Studio", "harbor", [
        ...extraEpisodes,
        { n: 3, title: "Morning Boot", file: "morning-boot.ogg", day: 20, duration: "0:12" },
        { n: 2, title: "Card Shuffle", file: "card-shuffle.ogg", day: 13, duration: "12" },
        { n: 1, title: "Harbor Lights", file: "harbor-lights.ogg", day: 6, duration: "00:00:12" },
    ]);
}
const lunaFeed = () => rss("Luna Bus Weekly", "Service Calls", "luna", [
    { n: 1, title: "Just Type", file: "just-type.ogg", day: 21, duration: "12" },
]);

function feedServer() {
    return http.createServer((req, res) => {
        const u = req.url.split("?")[0];
        const send = (code, type, body) => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
        if (u === "/harbor.xml") return send(200, "application/rss+xml", harborFeed());
        if (u === "/old-harbor.xml") { res.writeHead(301, { Location: "/harbor.xml" }); return res.end(); }
        if (u === "/luna.xml") return send(200, "application/rss+xml", lunaFeed());
        if (u.startsWith("/audio/")) {
            const f = path.join(MUSIC, path.basename(u));
            return fs.existsSync(f) ? send(200, "audio/ogg", fs.readFileSync(f)) : send(404, "text/plain", "no");
        }
        if (u.startsWith("/art/")) {
            const f = path.join(MUSIC, "art", u.includes("luna") ? "service-calls.jpg" : "low-tide.jpg");
            return send(200, "image/jpeg", fs.readFileSync(f));
        }
        send(404, "text/plain", "not found");
    });
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/podcasts/dist/index.html"))) {
        console.error("apps/podcasts/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const fsrv = feedServer();
    await new Promise((r) => fsrv.listen(feedPort, "127.0.0.1", r));
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        // Apple's directory, answered here: the simulator sends web requests
        // through serve-rootfs.py's proxy.
        let searched = "";
        await page.route("**/__phoenix/proxy", async (route) => {
            const req = JSON.parse(route.request().postData() || "{}");
            if (!/^https:\/\/itunes\.apple\.com\/search/.test(req.url || "")) return route.continue();
            searched = req.url;
            await route.fulfill({ contentType: "application/json", body: JSON.stringify({
                status: 200, headers: { "content-type": "application/json" }, url: req.url,
                body: JSON.stringify({ resultCount: 1, results: [{ collectionName: "Luna Bus Weekly", artistName: "Service Calls", feedUrl: `${feeds}/luna.xml` }] }),
            }) });
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p));
        }), [uri, params]);
        const find = (kind) => luna("luna://com.palm.db/find", { query: { from: kind } }).then((r) => r.results || []);
        const menuItem = (text) => page.click(`.pui-menu-item:has-text("${text}")`);

        // A fresh device.
        await page.goto(appUrl());
        await page.evaluate(() => new Promise((res) => {
            localStorage.clear();
            const r = indexedDB.deleteDatabase("phoenix-media");
            r.onsuccess = r.onerror = r.onblocked = () => res();
        }));
        await page.reload();
        await page.waitForSelector("[data-testid='empty']");
        check(true, "starts with no podcasts");
        await shot("empty");
        const acts = await page.evaluate(() => window.__phoenixRuntime.activities.list().map((a) => a.name));
        check(acts.includes("org.webosphoenix.podcasts.refresh"), "a background refresh is scheduled");

        // ---- Subscribe by address -------------------------------------------------------------
        await page.click("[data-testid='add']");
        await page.fill("[data-testid='feed-url']", `127.0.0.1:${feedPort}/nothing.xml`);
        await page.click("[data-testid='add-ok']");
        await page.waitForSelector("[data-testid='add-dialog'] .pui-error");
        check(true, "a bad address says it could not subscribe");
        await page.fill("[data-testid='feed-url']", `${feeds}/old-harbor.xml`);
        await page.click("[data-testid='add-ok']");
        await page.waitForSelector("[data-testid='podcast-Harbor Radio']");
        check(true, "subscribes by address (following a redirect)");
        check((await page.textContent("[data-testid='podcast-Harbor Radio']")).includes("1 new"), "only the newest episode counts as new");
        await page.waitForTimeout(400);
        await shot("podcasts");

        await page.click("[data-testid='podcast-Harbor Radio']");
        await page.waitForSelector("[data-testid='episode-Morning Boot']");
        const titles = await page.$$eval("[data-testid='episodes'] .pui-row-title", (els) => els.map((e) => e.textContent));
        check(titles.join(",") === "Morning Boot,Card Shuffle,Harbor Lights", `episodes newest first (${titles.join(", ")})`);
        check(/Sep 20.*1 min/.test(await page.textContent("[data-testid='episode-Morning Boot'] .pui-row-subtitle")), "an episode shows its date and length");

        // ---- Download -----------------------------------------------------------------------------
        await page.click("[data-testid='download-Morning Boot']");
        await page.waitForSelector("[data-testid='downloaded-Morning Boot']", { timeout: 10000 });
        const ep = (await find("org.webosphoenix.podcast.episode:1")).find((e) => e.title === "Morning Boot");
        check(ep && ep.file === "/media/internal/podcasts/harbor-radio/2026-09-20-morning-boot.ogg", `downloaded to ${ep && ep.file}`);
        const listed = await luna("luna://org.webosphoenix.filemanager/list", { path: "/media/internal/podcasts/harbor-radio" });
        check((listed.entries || []).some((e) => e.name === "2026-09-20-morning-boot.ogg" && e.size > 1000), "the download is in Files");
        await shot("episodes");

        // ---- Play ----------------------------------------------------------------------------------
        await page.click("[data-testid='episode-Morning Boot']");
        await page.waitForSelector("[data-testid='now-playing']");
        await page.waitForFunction(() => /^0:0[1-9]/.test(document.querySelector("[data-testid='np-elapsed']").textContent), null, { timeout: 8000 })
            .then(() => check(true, "plays the downloaded episode"), () => check(false, "plays the downloaded episode"));
        check(await page.evaluate(() => !!document.querySelector("[data-testid='np-play'][aria-label='Pause']")), "the play button shows Pause");
        await page.click("[data-testid='np-speed']");
        check((await page.textContent("[data-testid='np-speed']")).trim() === "1.25×", "speed goes to 1.25×");
        const sleepBtn = await page.$("[data-testid='np-sleep']");
        await sleepBtn.click();
        await menuItem("15 minutes");
        check(/^1[45]:\d\d/.test((await page.textContent("[data-testid='np-sleep']")).trim()), "the sleep timer counts down from 15 minutes");
        await page.waitForTimeout(300);
        await shot("now-playing");
        const nowPlaying = [...host].reverse().find((m) => m.type === "nowPlaying");
        check(nowPlaying && nowPlaying.payload.title === "Morning Boot" && nowPlaying.payload.artist === "Harbor Radio" && nowPlaying.payload.appId === APP,
            "the shell hears what plays (nowPlaying)");

        // Another player takes the audio focus: the episode pauses.
        await luna("luna://com.webos.service.audiofocusmanager/requestFocus", { requestType: "AFREQUEST_GAIN", streamType: "pmedia", displayId: 0 });
        await page.waitForSelector("[data-testid='np-play'][aria-label='Play']", { timeout: 5000 })
            .then(() => check(true, "pauses when another app takes the audio focus"), () => check(false, "pauses when another app takes the audio focus"));
        await page.waitForTimeout(400);
        const saved = (await find("org.webosphoenix.podcast.episode:1")).find((e) => e.title === "Morning Boot");
        check(saved && saved.position > 0 && !saved.played, `pausing keeps the place in the episode (${saved && saved.position} s)`);
        await page.click("[data-testid='np-fwd30']");
        await page.waitForTimeout(600);
        const done = (await find("org.webosphoenix.podcast.episode:1")).find((e) => e.title === "Morning Boot");
        check(done && done.played, "skipping past the end marks it played");

        await page.click("[data-testid='np-back']");
        await page.waitForSelector("[data-testid='mini-player']");
        check(true, "the mini player stays while browsing");

        // ---- Directory search ------------------------------------------------------------------------
        await page.click("[data-testid='find']");
        await page.fill("[data-testid='search-field']", "luna bus");
        await page.click("[data-testid='search-go']");
        await page.waitForSelector("[data-testid='result-Luna Bus Weekly']");
        check(/media=podcast/.test(searched) && /term=luna%20bus/.test(searched), "searches Apple's podcast directory");
        await shot("search");
        await page.click("[data-testid='subscribe-Luna Bus Weekly']");
        await page.waitForSelector("[data-testid='result-Luna Bus Weekly'] .pc-subscribed");
        check(true, "subscribes from the search");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='podcast-Luna Bus Weekly']");

        // ---- OPML --------------------------------------------------------------------------------------
        await page.click("[data-testid='menu']");
        await menuItem("Export OPML");
        await page.waitForFunction(() => /Podcasts\.opml/.test(document.querySelector("[data-testid='toast']")?.textContent ?? ""));
        const opml = await luna("luna://org.webosphoenix.filemanager/read", { path: "/media/internal/Documents/Podcasts.opml", encoding: "utf8" });
        check(/xmlUrl="http:\/\/127\.0\.0\.1:\d+\/old-harbor\.xml"/.test(opml.data || "") && /Luna Bus Weekly/.test(opml.data || ""), "exports OPML to Documents");

        await page.click("[data-testid='podcast-Luna Bus Weekly']");
        await page.click("[data-testid='podcast-menu']");
        await menuItem("Unsubscribe");
        await page.click("[data-testid='unsubscribe-ok']");
        await page.waitForSelector("[data-testid='podcast-Luna Bus Weekly']", { state: "detached" });
        check((await find("org.webosphoenix.podcast:1")).length === 1, "unsubscribes");

        await page.click("[data-testid='menu']");
        await menuItem("Import OPML");
        await page.waitForSelector("[data-testid='import-Podcasts.opml']");
        await page.click("[data-testid='import-Podcasts.opml']");
        await page.waitForSelector("[data-testid='podcast-Luna Bus Weekly']", { timeout: 10000 });
        check((await find("org.webosphoenix.podcast:1")).length === 2, "imports OPML (skipping what is already there)");

        // ---- Background refresh --------------------------------------------------------------------------
        extraEpisodes.push({ n: 4, title: "Prelude", file: "prelude.ogg", day: 27, duration: "12" });
        host.length = 0;
        await page.evaluate(() => window.__phoenixRuntime.activities.fireDue(Date.now() + 7 * 3600 * 1000));
        await page.waitForFunction(() => /1 new/.test(document.querySelector("[data-testid='podcast-Harbor Radio']")?.textContent ?? ""), null, { timeout: 10000 })
            .then(() => check(true, "the background refresh finds the new episode"), () => check(false, "the background refresh finds the new episode"));
        for (let i = 0; i < 50 && !host.some((m) => m.type === "notification"); ++i) await page.waitForTimeout(100);
        await page.waitForTimeout(300);
        const note = host.find((m) => m.type === "notification");
        check(note && note.payload.appId === APP && /1 new episode/.test(note.payload.body), "and posts a notification");
        const next = await page.evaluate(() => window.__phoenixRuntime.activities.list().find((a) => a.name === "org.webosphoenix.podcasts.refresh"));
        check(next && next.state !== "fired", "the next refresh is scheduled");
        await page.waitForTimeout(300);
        await shot("refreshed");

        // A launch with an OPML file imports it.
        await page.goto(appUrl({ target: "file:///media/internal/Documents/Podcasts.opml" }));
        await page.waitForSelector("[data-testid='toast']");
        check(/Imported 2 of 2/.test(await page.textContent("[data-testid='toast']")), "a launch with {target: .opml} imports it");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
        fsrv.close();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
