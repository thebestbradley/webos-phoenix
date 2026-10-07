#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sharing and sync, the community's features of docs/M6-PLAN.md F4 item 8,
// in headless Chromium against runtime/phoenix-runtime.js:
//   dropshare  Settings > DropShare turns it on; the DropShare app shows a
//              QR code of the address; files another device uploads land
//              in Downloads (with a notification), files shared with it
//              are handed to the server; the share sheet offers it; Touch
//              to Share gives a phone the address. phoenix-sim's server
//              (/__phoenix/dropshare, shell/sim/simdropshare.h) is played
//              here by a small fake; build/simnet-test runs the real one.
//   webcal     a Subscribed Calendar account: its page checks a public
//              .ics address, the account reads it into a read-only
//              calendar (the address answered here, through the proxy).
//
//   node tools/test-sharing.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "sharing-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8600 + Math.floor(Math.random() * 90);
const APPS = `http://127.0.0.1:${port}/usr/palm/applications`;

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

// phoenix-sim's DropShare server, played: the same JSON API as
// RootfsSchemeHandler::dropShare / SimDropShare::request.
function fakeDropShare() {
    const ds = { state: "off", mode: "", url: "", files: [], next: 1, bytes: {}, offers: {}, starts: 0 };
    ds.status = () => ({ returnValue: true, state: ds.state, mode: ds.mode, url: ds.state === "waiting" || ds.state === "transferring" ? ds.url : "",
                         files: ds.files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, received: f.received, done: f.done,
                                                       taken: !!f.taken, downloads: f.downloads || 0 })) });
    ds.request = (req) => {
        switch (req.op) {
        case "start":
            if (req.mode === "send" && !ds.files.length) return { returnValue: false, errorText: "Nothing to send" };
            if (req.mode === "receive") ds.files = [];
            ds.mode = req.mode;
            ds.state = "waiting";
            ds.starts++;
            ds.url = `http://192.168.1.20:4${ds.starts}000/token${ds.starts}/`;
            return { returnValue: true, url: ds.url, token: "token" + ds.starts, port: 41000, mode: ds.mode };
        case "stop":
            if (ds.state === "waiting" || ds.state === "transferring") ds.state = "stopped";
            return ds.status();
        case "status": return ds.status();
        case "take": {
            const f = ds.files.find((x) => x.id === req.id);
            if (f) f.taken = true;
            return { returnValue: !!f };
        }
        case "offerBegin": {
            if (ds.mode !== "send-offering") { ds.files = []; ds.mode = "send-offering"; }
            const f = { id: ds.next++, name: req.name, type: req.type, size: req.size, received: 0, done: false, downloads: 0 };
            ds.files.push(f);
            ds.offers[f.id] = [];
            return { returnValue: true, id: f.id };
        }
        case "offerPart": {
            const f = ds.files.find((x) => x.id === req.id);
            const b = Buffer.from(req.data, "base64");
            ds.offers[req.id].push(b);
            f.received += b.length;
            return { returnValue: true };
        }
        case "offerEnd": {
            const f = ds.files.find((x) => x.id === req.id);
            f.done = f.received === f.size;
            return { returnValue: f.done };
        }
        }
        return { returnValue: false, errorText: "Unknown op" };
    };
    // Another device uploads a file (receive) / downloads one (send).
    ds.upload = (name, type, data) => {
        const f = { id: ds.next++, name, type, size: data.length, received: data.length, done: true };
        ds.bytes[f.id] = data;
        ds.files.push(f);
        ds.state = "transferring";
    };
    ds.download = (id) => {
        const f = ds.files.find((x) => x.id === id);
        f.downloads++;
        ds.state = ds.files.every((x) => x.downloads > 0) ? "done" : "transferring";
        if (ds.state === "done") ds.files = [];
        return Buffer.concat(ds.offers[id]);
    };
    return ds;
}

async function main() {
    for (const app of ["settings", "dropshare"])
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];
        const watch = (page, name) => {
            page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
            page.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) {
                    const msg = JSON.parse(t.slice(11));
                    host.push({ page: name, type: msg.type, payload: msg.payload });
                } else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(`${name}: ${t}`);
            });
        };
        // Wait for a state the action causes (not for time).
        const until = async (fn, what, ms = 8000) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
                try { if (await fn()) { check(true, what); return true; } } catch (e) { /* not yet */ }
                await new Promise((r) => setTimeout(r, 50));
            }
            check(false, what);
            return false;
        };
        const svc = (page, uri, params) => page.evaluate(([u, p]) => new Promise((resolve) => {
            window.__phoenixRuntime.dispatch(u, p, resolve, { cancelled: () => false, onCancel: null });
        }), [uri, params]);

        const ds = fakeDropShare();
        await context.route("**/__phoenix/dropshare**", (route) => {
            const u = new URL(route.request().url());
            if (u.pathname === "/__phoenix/dropshare/file")
                return route.fulfill({ contentType: "application/octet-stream", body: ds.bytes[Number(u.searchParams.get("id"))] || Buffer.alloc(0) });
            return route.fulfill({ contentType: "application/json", body: JSON.stringify(ds.request(JSON.parse(u.searchParams.get("req") || "{}"))) });
        });

        // ---- Settings > DropShare ---------------------------------------------------
        const st = await context.newPage();
        watch(st, "settings");
        await st.goto(`${APPS}/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify({ page: "dropshare" })));
        await st.waitForSelector("[data-testid='ds-enabled']");
        await st.evaluate(() => localStorage.clear());
        await st.reload();
        await st.waitForSelector("[data-testid='ds-enabled']");
        check(await st.getAttribute("[data-testid='ds-enabled']", "aria-checked") === "false", "DropShare is off by default");
        const dsPref = async () => (await svc(st, "luna://com.webos.service.systemservice/getPreferences", { keys: ["dropShareEnabled"] })).dropShareEnabled;
        // Off, the service refuses.
        const refused = await svc(st, "luna://org.webosphoenix.dropshare/receive", {});
        check(refused.returnValue === false && /off/.test(refused.errorText), "off, DropShare refuses to receive");
        await st.click("[data-testid='ds-enabled']");
        await until(async () => (await dsPref()) === true, "Settings turns DropShare on");
        await st.waitForSelector("[data-testid='ds-receive']");
        await st.screenshot({ path: path.join(outDir, "settings-dropshare.png"), fullPage: true });
        host.length = 0;
        await st.click("[data-testid='ds-receive']");
        await until(() => host.some((m) => m.type === "launch" && m.payload.id === "org.webosphoenix.dropshare"), "Receive Files opens DropShare");

        // ---- Receiving ----------------------------------------------------------------
        const app = await context.newPage();
        watch(app, "dropshare");
        await app.goto(`${APPS}/org.webosphoenix.dropshare/index.html`);
        await until(async () => (await app.locator("[data-testid='ds-url']").textContent()) === ds.url, "the app shows the session's address");
        await until(async () => /^0 0 \d+ \d+$/.test(await app.locator("[data-testid='ds-qr'] svg").getAttribute("viewBox") || ""), "and its QR code");
        await app.screenshot({ path: path.join(outDir, "receive.png") });
        const photo = fs.readFileSync(path.join(REPO, "apps/media-samples/media/photos/alpine-lake.jpg"));
        host.length = 0;
        ds.upload("Holiday.jpg", "image/jpeg", photo);
        await until(async () => /In Downloads/.test(await app.locator("[data-testid='ds-file-Holiday.jpg']").textContent()),
                    "a file another device uploaded lands in Downloads");
        const stat = await svc(app, "luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Downloads/Holiday.jpg" });
        check(stat.entry && stat.entry.size === photo.length, `... whole (${stat.entry && stat.entry.size} bytes)`);
        check(ds.files[0].taken === true, "... and the server lets it go");
        check(host.some((m) => m.type === "ongoing" && m.payload.id === "dropshare" && /Receiving Holiday.jpg/.test(m.payload.body || "")),
              "an ongoing activity while it comes");
        // A second of the same name is numbered; the uploader is done.
        ds.upload("Holiday.jpg", "image/jpeg", Buffer.from("second"));
        ds.state = "done";
        await until(async () => /Received 2 files/.test(await app.locator("[data-testid='ds-status']").textContent()), "the uploader is done: Received 2 files");
        check((await svc(app, "luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Downloads/Holiday (2).jpg" })).returnValue !== false,
              "the second of a name is numbered");
        const note = host.filter((m) => m.type === "notification" && m.payload.title === "DropShare").pop();
        check(!!note && note.payload.appId === "org.webosphoenix.files" && note.payload.params.path === "/media/internal/Downloads"
              && /2 files are in Downloads/.test(note.payload.body), "a notification opens Files at Downloads");
        check(!(await app.locator("[data-testid='ds-url']").count()), "the address is gone with the session");
        await app.screenshot({ path: path.join(outDir, "received.png") });
        await app.click("[data-testid='ds-again']");
        await until(async () => (await app.locator("[data-testid='ds-url']").textContent()) === ds.url && ds.starts === 2, "Receive More: a new address");

        // Touch to Share: a phone touched to the device gets the address.
        host.length = 0;
        await app.evaluate(() => window.__phoenixRuntime.relaunch({ sendDataToShare: true }));
        await until(() => host.some((m) => m.type === "touchToShare" && m.payload.op === "shareData" && m.payload.data.target === ds.url),
                    "Touch to Share hands the phone the address");

        // ---- Sending (the share sheet's DropShare) ---------------------------------
        const targets = await svc(app, "luna://org.webosphoenix.share/targets", { types: ["image/jpeg"] });
        check((targets.targets || []).some((t) => t.appId === "org.webosphoenix.dropshare" && t.label === "DropShare"), "the share sheet offers DropShare for a picture");
        const sender = await context.newPage();
        watch(sender, "dropshare-send");
        const pdf = fs.readFileSync(path.join(REPO, "apps/media-samples/media/documents/field-guide.pdf"));
        await sender.goto(`${APPS}/org.webosphoenix.dropshare/index.html?launchParams=` + encodeURIComponent(JSON.stringify({
            share: { files: [{ path: "/media/internal/Downloads/Holiday.jpg", mimeType: "image/jpeg" },
                             { path: "/media/internal/samples/documents/field-guide.pdf", mimeType: "application/pdf" }] } })));
        await until(async () => (await sender.locator("[data-testid='ds-url']").textContent()) === ds.url && ds.mode === "send", "sending: the address to download from");
        check(Buffer.concat(ds.offers[ds.files[0].id]).equals(photo), "the picture (from the device's store) is handed over whole");
        check(Buffer.concat(ds.offers[ds.files[1].id]).equals(pdf), "the PDF (a system file) too, in parts");
        await sender.screenshot({ path: path.join(outDir, "send.png") });
        const ids = ds.files.map((f) => f.id);
        ds.download(ids[0]);
        await until(async () => /1 of 2 files downloaded/.test(await sender.locator("[data-testid='ds-status']").textContent()), "one downloaded: 1 of 2");
        ds.download(ids[1]);
        await until(async () => /Sent 2 files/.test(await sender.locator("[data-testid='ds-status']").textContent()), "both: Sent 2 files");
        await sender.screenshot({ path: path.join(outDir, "sent.png") });
        // Closing the card ends a session (the page's pagehide, which a
        // page closing here would fire after its requests stop being seen).
        await sender.click("[data-testid='ds-again']");
        await until(() => ds.state === "waiting", "Send Again offers them again");
        await sender.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
        await until(() => ds.state === "stopped", "closing DropShare stops its session");

        // ---- A subscribed calendar (.ics, one way) -------------------------------------
        const ICS_URL = "https://cal.example.org/holidays.ics";
        // Days near today, so the Calendar app's first view shows them.
        const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); };
        const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "X-WR-CALNAME:Phoenix Holidays",
                     "BEGIN:VEVENT", "UID:ny-2027", "DTSTAMP:20260101T000000Z", "DTSTART;VALUE=DATE:" + day(0), "SUMMARY:New Year", "END:VEVENT",
                     "BEGIN:VEVENT", "UID:may-2027", "DTSTAMP:20260101T000000Z", "DTSTART;VALUE=DATE:" + day(2), "SUMMARY:May Day", "END:VEVENT",
                     "END:VCALENDAR", ""].join("\r\n");
        await context.route("**/__phoenix/proxy", (route) => {
            const req = JSON.parse(route.request().postData() || "{}");
            if (req.url !== ICS_URL) return route.continue();
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: 200, headers: { "content-type": "text/calendar" }, url: ICS_URL, body: ics }) });
        });
        const templates = await svc(st, "luna://com.palm.service.accounts/listAccountTemplates", {});
        check((templates.results || []).some((t) => t.templateId === "com.webosphoenix.webcal" && t.loc_name === "Subscribed Calendar"),
              "the accounts offer a Subscribed Calendar");
        const wiz = await context.newPage();
        watch(wiz, "webcal-wizard");
        await wiz.goto(`${APPS}/org.webosphoenix.dav/accounts/webcal.html?launchParams=` + encodeURIComponent(JSON.stringify({ mode: "create" })));
        await wiz.waitForSelector("input");
        await wiz.evaluate(() => { window.__results = []; window.addEventListener("message", (e) => window.__results.push(String(e.data))); });
        await wiz.locator("input").first().fill("webcal://cal.example.org/holidays.ics");
        await wiz.screenshot({ path: path.join(outDir, "webcal-wizard.png") });
        await wiz.getByText("Subscribe", { exact: true }).last().click();
        let result = null;
        await until(async () => {
            const r = (await wiz.evaluate(() => window.__results)).find((m) => m.indexOf("enyoCrossAppResult=") === 0);
            result = r ? JSON.parse(r.slice(19)) : null;
            return !!result;
        }, "the page checks the address (the file is a calendar)");
        check(!!result && result.returnValue === true && result.username === "Phoenix Holidays" && result.templateId === "com.webosphoenix.webcal"
              && result.credentials.common.url === ICS_URL, `... and answers the Accounts app (${JSON.stringify(result)})`);
        const created = await svc(st, "luna://com.palm.service.accounts/createAccount", {
            templateId: result.templateId, username: result.username, credentials: result.credentials, config: result.config,
            capabilityProviders: [{ id: "com.webosphoenix.webcal.calendar" }] });
        check(created.returnValue !== false, "the account is created");
        const find = async (kind) => ((await svc(st, "luna://com.palm.db/find", { query: { from: kind } })).results || [])
            .filter((o) => o.accountId === created.result._id);
        await until(async () => (await find("com.palm.calendarevent.dav:1")).length === 2, "its events are read in", 15000);
        const cal = (await find("com.palm.calendar.dav:1"))[0];
        check(!!cal && cal.isReadOnly === true && cal.name === "Phoenix Holidays", "into a read-only calendar of its name");
        check((await find("com.palm.calendarevent.dav:1")).map((e) => e.subject).sort().join() === "May Day,New Year", "the events, by name");
        // The Calendar app opens its card in a window of its own.
        const calStart = await context.newPage();
        await calStart.goto(`${APPS}/com.palm.app.calendar/index.html`);
        let calWin = null;
        await until(async () => {
            calWin = context.pages().find((p) => p !== calStart && /com\.palm\.app\.calendar/.test(p.url()));
            return !!calWin && /New Year/.test(await calWin.evaluate(() => document.body.innerText));
        }, "the Calendar app shows today's subscribed event", 20000);
        if (calWin) await calWin.screenshot({ path: path.join(outDir, "webcal-calendar.png") });

        check(errors.length === 0, `no page errors (${errors.slice(0, 5).join(" | ")})`);
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `${failures} FAILED` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
