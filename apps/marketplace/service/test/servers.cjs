// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Servers for the Marketplace tests (service.test.ts, tools/test-marketplace.cjs):
//
//   startCatalog()  the real catalog service (server/marketplace, PHP's
//                   built-in server, SQLite in a temporary folder), set up
//                   with bin/marketplace.php init and the test web app
//   startSite()     a web app site: a page, its manifest and icons, and a
//                   chat page with no manifest (a site the catalog writes one
//                   for) and its favicon.ico
//   startMuseum()   an App Museum II stand-in (its web service's shapes, our
//                   own made-up apps) with a package host: an Enyo app and a
//                   Mojo app
//   startFeed()     a Preware feed: Packages and two packages
//   startPhoenixDevice()  a catalog as the one the device ships with
//                   ("phoenix": servers.json's feeds, in a folder for
//                   serve-rootfs's --extra-rootfs), and install(): Phoenix's
//                   own connector published there by an admin and installed
//                   from it, as on a device. A connector with a sign-in page
//                   of its own is framed only when installed that way, not
//                   sideloaded (rule C17 on the device, packagesservice.js
//                   checkSignInPage)
//
// Packages are made with the service's own .ipk writer.

"use strict";

const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const SERVER = path.resolve(__dirname, "../../../../server/marketplace");
const ipk = require("../lib/ipk.js").createIpk({
    gzip: { gzip: async (b) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b) => new Uint8Array(zlib.gunzipSync(b)) }
});

function phpAvailable() {
    const r = spawnSync("php", ["-r", "echo function_exists('sodium_crypto_sign_detached') && extension_loaded('pdo_sqlite') ? 'ok' : 'no';"]);
    return r.status === 0 && String(r.stdout) === "ok";
}

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
        s.on("error", reject);
    });
}

function listen(handler) {
    return freePort().then((port) => new Promise((resolve) => {
        const srv = http.createServer(handler);
        srv.listen(port, "127.0.0.1", () => resolve({ srv, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(r)) }));
    }));
}

// A PNG of one colour (size x size), for icons.
function png(size, rgb) {
    const crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const raw = Buffer.alloc((size * 3 + 1) * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(rgb, y * (size * 3 + 1) + 1 + x * 3);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function webApp(id, version, extra) {
    const dir = `usr/palm/applications/${id}/`;
    const files = [
        { path: dir + "appinfo.json", data: JSON.stringify(Object.assign({ id, version, vendor: "Example", type: (extra && extra.type) || "web", main: "index.html", title: (extra && extra.title) || id, icon: "icon.png" },
                                                                         (extra && extra.appinfo) || {})) },
        { path: dir + "index.html", data: `<!doctype html><title>${id}</title><h1>${id} ${version}</h1>` },
        { path: dir + "icon.png", data: new Uint8Array(png(64, [40, 120, 200])) }
    ].concat((extra && extra.files) || []);
    return ipk.write({ control: { Package: id, Version: version, Architecture: (extra && extra.arch) || "all", Description: id }, files,
                       scripts: extra && extra.scripts });
}

// ---- The catalog service ---------------------------------------------------------

async function startCatalog(opts) {
    opts = opts || {};
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-catalog-"));
    const port = opts.port || await freePort();
    const env = Object.assign({}, process.env, { MARKETPLACE_DATA: data, MARKETPLACE_BASE_URL: `http://127.0.0.1:${port}/v1/` });
    delete env.MARKETPLACE_DSN;
    const php = (args) => {
        const r = spawnSync("php", [path.join(SERVER, "bin/marketplace.php")].concat(args), { env, encoding: "utf8" });
        if (r.status !== 0) throw new Error("marketplace.php " + args.join(" ") + ": " + r.stderr + r.stdout);
        return r.stdout;
    };
    if (opts.curated) {
        const file = path.join(data, "curated-test.json");
        fs.writeFileSync(file, JSON.stringify({ apps: opts.curated }));
        php(["init"]);
        php(["seed", file]);
        php(["publish"]);
    } else {
        php(["init"]);
    }
    // Several requests at once, as bin/serve.sh: an icon copied from its site waits on it.
    // The test sites are on this computer (http://127.0.0.1), which a real catalog refuses,
    // and they are the only ones it asks ("only"): the curated apps' icons (the init's
    // whole list) are their initials at once. Copied from their real sites, each took
    // seconds on a slow link, and the 20 a Featured page asks for kept the 4 workers busy
    // past the tests' waits (the test site's icon and the index queued behind them).
    const proc = spawn("php", ["-S", `127.0.0.1:${port}`, path.join(SERVER, "public/router.php")],
                       { env: Object.assign({ PHP_CLI_SERVER_WORKERS: "4", MARKETPLACE_FETCH_LOCAL: "only" }, env), stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
        try { if ((await fetch(url + "/api/health")).ok) break; } catch (e) { /* not up yet */ }
        if (i > 100 || proc.exitCode !== null) throw new Error("php -S did not start: " + stderr);
        await new Promise((r) => setTimeout(r, 100));
    }
    const admin = fs.readFileSync(path.join(data, "admin.token"), "utf8").trim();
    const api = async (method, p, body, token) => {
        const res = await fetch(url + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
                                           body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
        return Object.assign({ status: res.status }, await res.json());
    };
    const key = php(["key"]).split("\n");
    return {
        url, catalogUrl: url + "/v1/", data, admin, api, php, key: key[0], fingerprint: key[1],
        indexFile: path.join(data, "public/v1/index.json"),
        async stop() {
            proc.kill();
            await new Promise((r) => (proc.exitCode !== null ? r() : proc.on("exit", r)));
            fs.rmSync(data, { recursive: true, force: true });
        }
    };
}

// ---- A web app site ----------------------------------------------------------------

// An ICO of pictures [[size, bytes], ...] (a size of 256 is written 0, as the format has it).
function ico(pics) {
    const head = Buffer.alloc(6 + 16 * pics.length);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(pics.length, 4);
    let at = head.length;
    pics.forEach(([size, data], i) => {
        head[6 + 16 * i] = head[7 + 16 * i] = size % 256;
        head.writeUInt32LE(data.length, 14 + 16 * i);
        head.writeUInt32LE(at, 18 + 16 * i);
        at += data.length;
    });
    return Buffer.concat([head].concat(pics.map((p) => p[1])));
}

async function startSite() {
    const icon192 = png(192, [200, 60, 60]), icon512 = png(512, [200, 60, 60]);
    // As Slack's favicon.ico: a small bitmap first, then a 256 px PNG.
    const favicon = ico([[16, Buffer.alloc(40 + 16 * 16 * 4, 9)], [256, png(256, [74, 21, 75])]]);
    let manifest = null;
    const site = await listen((req, res) => {
        const u = req.url.split("?")[0];
        if (u === "/favicon.ico") { res.writeHead(200, { "Content-Type": "image/x-icon" }); res.end(favicon); return; }
        if (u === "/chat/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Quay Chat</title><h1>Quay Chat</h1>"); return; }
        if (u === "/app/manifest.json") { res.writeHead(200, { "Content-Type": "application/manifest+json" }); res.end(JSON.stringify(manifest)); return; }
        if (u === "/app/icon-192.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(icon192); return; }
        if (u === "/app/icon-512.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(icon512); return; }
        if (u === "/app/" || u === "/app/index.html") {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end('<!doctype html><link rel="manifest" href="manifest.json"><title>Tide Tables</title><h1>Tide Tables</h1>');
            return;
        }
        res.writeHead(404); res.end();
    });
    manifest = {
        name: "Tide Tables for Sailors", short_name: "Tides", start_url: "/app/?source=pwa", scope: "/app/", display: "standalone",
        theme_color: "#1d4f7a", background_color: "#ffffff",
        icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" },
                { src: "mask.png", sizes: "512x512", type: "image/png", purpose: "maskable" }]
    };
    return Object.assign(site, { manifestUrl: site.url + "/app/manifest.json", setManifest: (m) => { manifest = m; } });
}

// ---- An App Museum II stand-in --------------------------------------------------------

async function startMuseum() {
    const enyo = await webApp("com.example.classicnotes", "1.2.0", {
        title: "Classic Notes",
        files: [{ path: "usr/palm/applications/com.example.classicnotes/depends.js", data: "enyo.depends('source/App.js');" }]
    });
    const mojo = await webApp("com.example.mojoclock", "2.0.1", {
        title: "Mojo Clock",
        files: [{ path: "usr/palm/applications/com.example.mojoclock/sources.json", data: "[{\"source\": \"app/assistants/stage-assistant.js\"}]" }]
    });
    // An Enyo app with a native PDK plugin (as Quickoffice).
    const hybrid = await webApp("com.example.classicoffice", "3.0.0", {
        title: "Classic Office", appinfo: { "plug-ins": true },
        files: [{ path: "usr/palm/applications/com.example.classicoffice/depends.js", data: "enyo.depends('source/App.js');" },
                { path: "usr/palm/applications/com.example.classicoffice/import/docservice/docservice_appinfo.json", data: "{\"type\": \"hybrid\"}" },
                { path: "usr/palm/applications/com.example.classicoffice/import/docservice/docservice", data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]) }]
    });
    const apps = [
        { id: 9001, title: "Classic Notes", author: "Example Soft", summary: "Notes, the 2011 way.", appIcon: "9001/icon.png", appIconBig: "9001/icon-256.png",
          category: "Productivity", Pre3: true, TouchPad: true, LuneOS: false, Adult: false, starRating: 4, reviewCount: 2 },
        { id: 9002, title: "Mojo Clock", author: "Example Soft", summary: "A clock in Mojo.", appIcon: "9002/icon.png", appIconBig: "9002/icon.png",
          category: "Utilities", Pre3: true, TouchPad: false, LuneOS: false, Adult: false },
        { id: 9003, title: "Classic Office", author: "Example Soft", summary: "Documents, with a native engine.", appIcon: "9003/icon.png", appIconBig: "9003/icon.png",
          category: "Business", Pre3: true, TouchPad: true, LuneOS: false, Adult: false }
    ];
    const details = {
        9001: { publicApplicationId: "com.example.classicnotes", version: "1.2.0", description: "Takes notes.", filename: "com.example.classicnotes_1.2.0_all.ipk", appSize: enyo.length,
                // Three listed, one gone (the real archive has such: Quickoffice's).
                images: [{ screenshot: "9001/images/1/L/a.png", thumbnail: "9001/images/1/L/a.png" },
                         { screenshot: "9001/images/2/L/gone.png", thumbnail: "9001/images/2/L/gone.png" },
                         { screenshot: "9001/images/3/L/b.png", thumbnail: "9001/images/3/L/b.png" }] },
        9002: { publicApplicationId: "com.example.mojoclock", version: "2.0.1", description: "Tells time.", filename: "com.example.mojoclock_2.0.1_all.ipk", appSize: mojo.length, images: {} },
        9003: { publicApplicationId: "com.example.classicoffice", version: "3.0.0", description: "Opens documents.", filename: "com.example.classicoffice_3.0.0_all.ipk", appSize: hybrid.length, images: {} }
    };
    const counted = [];
    let port = 0;
    const m = await listen((req, res) => {
        const u = new URL(req.url, "http://x");
        const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
        if (u.pathname === "/WebService/getConfig.php") return json({ service_host: "127.0.0.1", package_host: `127.0.0.1:${port}/packages` });
        if (u.pathname === "/WebService/getMuseumMaster.php") return json({ data: u.searchParams.get("key") ? apps.filter((a) => !u.searchParams.get("category") || a.category === u.searchParams.get("category")) : [] });
        if (u.pathname === "/WebService/getSearchResults.php") return json({ data: apps.filter((a) => a.title.toLowerCase().includes(String(u.searchParams.get("app")).toLowerCase())) });
        if (u.pathname === "/WebService/getMuseumDetails.php") return json(details[u.searchParams.get("id")] || {});
        if (u.pathname === "/WebService/countAppDownload.php") { counted.push(u.searchParams.get("appid")); return json({ ok: true }); }
        if (u.pathname === "/packages/com.example.classicnotes_1.2.0_all.ipk") { res.writeHead(200); res.end(Buffer.from(enyo)); return; }
        if (u.pathname === "/packages/com.example.mojoclock_2.0.1_all.ipk") { res.writeHead(200); res.end(Buffer.from(mojo)); return; }
        if (u.pathname === "/packages/com.example.classicoffice_3.0.0_all.ipk") { res.writeHead(200); res.end(Buffer.from(hybrid)); return; }
        if (u.pathname.includes("/gone.png")) { res.writeHead(404); res.end(); return; }
        if (u.pathname.startsWith("/AppImages/")) { res.writeHead(200, { "Content-Type": "image/png" }); res.end(png(64, [90, 90, 160])); return; }
        res.writeHead(404); res.end();
    });
    port = m.port;
    return Object.assign(m, { counted });
}

// ---- A Preware feed ---------------------------------------------------------------------

async function startFeed() {
    const web = Buffer.from(await webApp("org.example.homebrew", "0.9.1", { title: "Homebrew Thing" }));
    const native = Buffer.from(await webApp("org.example.nativelib", "1.0", { arch: "armv7" }));
    // A homebrew app with a service and a postinst, as many Preware packages are.
    const hooked = Buffer.from(await webApp("org.example.hooked", "2.0", {
        title: "Hooked", scripts: { postinst: "#!/bin/sh\necho hi\n" },
        files: [{ path: "usr/palm/services/org.example.hooked.service/service.js", data: "// a 2011 service" }] }));
    // A Synergy connector: its service in the app's service/ folder (docs/SYNERGY-CONNECTORS.md 3.1).
    const connector = Buffer.from(await webApp("org.example.feeds", "0.1.0", {
        title: "News Feeds", appinfo: { phoenix: { hidden: true }, requiredPermissions: [] },
        files: [{ path: "usr/palm/applications/org.example.feeds/service/package.json", data: JSON.stringify({ name: "org.example.service.feeds" }) },
                { path: "usr/palm/applications/org.example.feeds/service/sysbus/org.example.service.feeds.role.json", data: "{}" }] }));
    // An account type with a sign-in page of its own (validator.customUI) and
    // no service, so no Developer Mode is asked: a third party's, refused
    // (rule C17 on the device); and one whose page is another app's (C7).
    const signInTemplate = (id, pageApp) => JSON.stringify({ templateId: id, loc_name: id,
        validator: { address: "palm://" + id + ".service/checkCredentials", customUI: { appId: pageApp, name: "accounts/signin.html" } },
        capabilityProviders: [{ id: id + ".chat", capability: "MESSAGING", implementation: "palm://" + id + ".service/" }] });
    const signIn = Buffer.from(await webApp("org.example.signin", "1.0.0", {
        title: "Own Sign-in", appinfo: { phoenix: { hidden: true } },
        files: [{ path: "usr/palm/applications/org.example.signin/public/accounts/org.example.signin/org.example.signin.json",
                  data: signInTemplate("org.example.signin", "org.example.signin") },
                { path: "usr/palm/applications/org.example.signin/accounts/signin.html", data: "<!doctype html><title>Sign in</title>" }] }));
    const borrowed = Buffer.from(await webApp("org.example.borrowed", "1.0.0", {
        title: "Borrowed Sign-in", appinfo: { phoenix: { hidden: true } },
        files: [{ path: "usr/palm/applications/org.example.borrowed/public/accounts/org.example.borrowed/org.example.borrowed.json",
                  data: signInTemplate("org.example.borrowed", "org.webosphoenix.dav") }] }));
    // A web app under a system name (LuneOS's org.webosports): only Phoenix's
    // own catalog installs those (RESERVED_NAME).
    const squat = Buffer.from(await webApp("org.webosports.app.squat", "1.0.0", { title: "Squat" }));
    const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
    const para = (id, v, arch, file, b, title) => [
        `Package: ${id}`, `Version: ${v}`, "Section: misc", `Architecture: ${arch}`, `MD5Sum: ${md5(b)}`, `Size: ${b.length}`, `Filename: ${file}`,
        `Description: ${title}`, "Maintainer: Homebrewer <hb@example.org>",
        `Source: {"Title": "${title}", "Category": "Utilities", "FullDescription": "Line one\\nLine two", "License": "GPL-2.0"}`].join("\n");
    let packages = [para("org.example.homebrew", "0.9.0", "all", "old.ipk", web, "Homebrew Thing"),
                    para("org.example.homebrew", "0.9.1", "all", "org.example.homebrew_0.9.1_all.ipk", web, "Homebrew Thing"),
                    para("org.example.nativelib", "1.0", "armv7", "org.example.nativelib_1.0_armv7.ipk", native, "Native Lib"),
                    para("org.example.hooked", "2.0", "all", "org.example.hooked_2.0_all.ipk", hooked, "Hooked"),
                    para("org.example.feeds", "0.1.0", "all", "org.example.feeds_0.1.0_all.ipk", connector, "News Feeds"),
                    para("org.example.signin", "1.0.0", "all", "org.example.signin_1.0.0_all.ipk", signIn, "Own Sign-in"),
                    para("org.example.borrowed", "1.0.0", "all", "org.example.borrowed_1.0.0_all.ipk", borrowed, "Borrowed Sign-in"),
                    para("org.webosports.app.squat", "1.0.0", "all", "org.webosports.app.squat_1.0.0_all.ipk", squat, "Squat")].join("\n\n") + "\n";
    let serveWeb = web;
    const f = await listen((req, res) => {
        const u = req.url.split("?")[0];
        if (u === "/feed/Packages") { res.writeHead(200); res.end(packages); return; }
        if (u === "/feed/org.example.homebrew_0.9.1_all.ipk") { res.writeHead(200); res.end(serveWeb); return; }
        if (u === "/feed/org.example.hooked_2.0_all.ipk") { res.writeHead(200); res.end(hooked); return; }
        if (u === "/feed/org.example.feeds_0.1.0_all.ipk") { res.writeHead(200); res.end(connector); return; }
        if (u === "/feed/org.example.signin_1.0.0_all.ipk") { res.writeHead(200); res.end(signIn); return; }
        if (u === "/feed/org.example.borrowed_1.0.0_all.ipk") { res.writeHead(200); res.end(borrowed); return; }
        if (u === "/feed/org.webosports.app.squat_1.0.0_all.ipk") { res.writeHead(200); res.end(squat); return; }
        res.writeHead(404); res.end();
    });
    return Object.assign(f, { feedUrl: f.url + "/feed/", corrupt: () => { serveWeb = Buffer.concat([web, Buffer.from("x")]); } });
}

// ---- The catalog the device ships with --------------------------------------------

// A catalog where the device's own Phoenix catalog looks: its address is
// servers.json's feeds (docs/PLATFORM-CLIENT.md), so serve-rootfs is given a
// folder (rootfsArgs: --extra-rootfs) with that file pointing here. The key
// is the device's (as an image ships it: trustSource on the built-in
// source). install(context, origin, ipkFile, appId) uploads the package as
// an admin (Phoenix's namespaces), approves it, and has the Marketplace's
// service install it from that catalog, in a page of the Marketplace (the
// service's caller); -> its last reply ({state: "installed"} or "failed").
async function startPhoenixDevice() {
    const catalog = await startCatalog();
    const device = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-device-"));
    const serversJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../services/account/etc/palm/phoenix/servers.json"), "utf8"));
    serversJson.feeds = catalog.url + "/";
    fs.mkdirSync(path.join(device, "etc/palm/phoenix"), { recursive: true });
    fs.writeFileSync(path.join(device, "etc/palm/phoenix/servers.json"), JSON.stringify(serversJson));
    return {
        catalog, device, rootfsArgs: ["--extra-rootfs", device],
        async install(context, origin, ipkFile, appId) {
            const up = await catalog.api("POST", "/api/apps/packages", new Uint8Array(fs.readFileSync(ipkFile)), catalog.admin);
            if (up.status !== 200 || !up.release) return { state: "failed", errorText: "the catalog refused it: " + (up.error || up.status) };
            await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
            const page = await context.newPage();
            try {
                await page.goto(`${origin}/usr/palm/applications/org.webosphoenix.marketplace/index.html`, { waitUntil: "domcontentloaded" });
                await page.waitForFunction(() => !!window.PalmServiceBridge);
                return await page.evaluate(([url, key, id]) => {
                    const call = (m, prm, done) => {
                        const b = new PalmServiceBridge();
                        b.onservicecallback = (x) => done(JSON.parse(x), b);
                        b.call("luna://org.webosphoenix.service.packages/" + m, JSON.stringify(prm));
                    };
                    return new Promise((res) => call("trustSource", { url, key }, (t) => {
                        if (t.returnValue === false) return res({ state: "failed", errorText: "trustSource: " + t.errorText });
                        call("install", { sourceId: "phoenix", id, subscribe: true }, (r, b) => {
                            if (r.returnValue === false || r.state === "failed") { b.cancel && b.cancel(); res(Object.assign({ state: "failed" }, r)); }
                            else if (r.state === "installed") res(r);
                        });
                    }));
                }, [catalog.catalogUrl, catalog.key, appId]);
            } finally {
                await page.close();
            }
        },
        async stop() {
            await catalog.stop();
            fs.rmSync(device, { recursive: true, force: true });
        }
    };
}

module.exports = { phpAvailable, startCatalog, startSite, startMuseum, startFeed, startPhoenixDevice, webApp, png, freePort };
