#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The application manager and the app installer of runtime/phoenix-runtime.js
// (com.palm.applicationManager, com.palm.appinstaller), against
// tools/serve-rootfs.py's installer: launch points apps add and remove
// (addLaunchPoint, removeLaunchPoint, launchPointChanges), getSizeOfApps,
// dock mode launch points, the handler registry (redirect and resource
// handlers, swapped and removed), install progress for the launcher
// (installStatus host messages, installProgressQuery), notifyOnChange,
// queryInstallCapacity, getUserInstalledAppSizes and revoke (an Ed25519
// signature by a trusted catalog key), in headless Chromium.
//
//   node tools/test-appmanager.cjs [--out DIR]

"use strict";
const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const servers = require(path.join(REPO, "apps/marketplace/service/test/servers.cjs"));
const AM = "luna://com.palm.applicationManager/";
const AI = "luna://com.palm.appinstaller/";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}

async function main() {
    const { chromium } = loadPlaywright();
    const port = await servers.freePort();
    const origin = `http://127.0.0.1:${port}`;
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    let browser;
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(origin + "/apps.json")).ok) break; } catch (e) { /* not up */ }
            if (i > 100) throw new Error("serve-rootfs did not start");
            await new Promise((r) => setTimeout(r, 100));
        }
        browser = await chromium.launch();
        const page = await (await browser.newContext({ viewport: { width: 320, height: 452 } })).newPage();
        const errors = [], host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
        });
        await page.goto(`${origin}/usr/palm/applications/com.palm.app.calculator/index.html`);
        await page.evaluate(() => localStorage.clear());
        await page.goto(`${origin}/usr/palm/applications/com.palm.app.calculator/index.html`);
        await page.waitForFunction(() => !!window.__phoenixRuntime);

        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        // A subscription: its replies collect in window.__subs[name].
        const subscribe = (name, uri, params) => page.evaluate(([n, u, p]) => {
            window.__subs = window.__subs || {};
            window.__subs[n] = [];
            const b = new PalmServiceBridge();
            window["__bridge_" + n] = b;
            b.onservicecallback = (s) => window.__subs[n].push(JSON.parse(s));
            b.call(u, JSON.stringify(Object.assign({ subscribe: true }, p || {})));
        }, [name, uri, params]);
        const replies = (name) => page.evaluate((n) => window.__subs[n], name);
        const launcherApps = async () => (await (await fetch(origin + "/apps.json")).json());

        // ---- Launch points an app adds (the browser's Add to Launcher) ------------------------
        await subscribe("lpc", AM + "launchPointChanges", {});
        const added = await luna(AM + "addLaunchPoint", { id: "com.palm.app.browser", title: "Example", icon: "images/bookmark-icon-default.png",
                                                          params: { url: "https://example.com/" } });
        check(added.returnValue === true && /^\d{8}$/.test(added.launchPointId), "addLaunchPoint: an eight-digit launch point id");
        const lps = (await luna(AM + "listLaunchPoints", {})).launchPoints;
        const lp = lps.find((x) => x.launchPointId === added.launchPointId);
        check(!!lp && lp.id === "com.palm.app.browser" && lp.title === "Example" && lp.removable === true
              && lp.icon === "/usr/palm/applications/com.palm.app.browser/images/bookmark-icon-default.png"
              && lp.params.url === "https://example.com/", "listLaunchPoints has it, its icon made absolute");
        await page.waitForTimeout(100);
        check((await replies("lpc")).some((r) => r.change === "added" && r.launchPointId === added.launchPointId), "launchPointChanges: added");
        const entry = (await launcherApps()).find((a) => a.id === added.launchPointId);
        check(!!entry && entry.page === "favorites" && entry.dynamic === true && /launchParams=/.test(entry.main), "the launcher gets it on Favorites, launching the browser with its params");
        check((await luna(AM + "addLaunchPoint", { id: "com.example.none", title: "X", icon: "", params: {} })).errorText === "Unable to find id: com.example.none",
              "addLaunchPoint: an unknown app is refused");
        const notFound = await luna(AM + "removeLaunchPoint", { launchPointId: "00000001" });
        check(notFound.returnValue === false && notFound.errorText === "launch point [00000001] not found", "removeLaunchPoint: an unknown one, in LunaSysMgr's words");
        check((await luna(AM + "removeLaunchPoint", { launchPointId: "com.palm.app.browser_default" })).returnValue === false, "an app's own launch point cannot be removed");
        check((await luna(AM + "removeLaunchPoint", { launchPointId: added.launchPointId })).returnValue === true, "removeLaunchPoint");
        await page.waitForTimeout(100);
        check((await replies("lpc")).some((r) => r.change === "removed" && r.launchPointId === added.launchPointId), "launchPointChanges: removed");

        // ---- Sizes, dock mode ---------------------------------------------------------------
        const sizes = await luna(AM + "getSizeOfApps", { appIds: ["com.palm.app.browser", "com.example.none"] });
        check(sizes.returnValue && sizes.subscribed === false && sizes["com.palm.app.browser"] > 10000 && sizes["com.example.none"] === 0, "getSizeOfApps: bytes per app");
        // The exhibitions in detail: tools/test-exhibition.cjs.
        const dock = await luna(AM + "listDockModeLaunchPoints", {});
        check(dock.returnValue && dock.maxApps === 3 && dock.launchPoints.some((lp) => lp.id === "org.webosphoenix.photos" && lp.enabled)
              && dock.launchPoints.every((lp) => lp.exhibitionModeTitle), "listDockModeLaunchPoints: the exhibition apps, Photos on");
        check((await luna(AM + "addDockModeLaunchPoint", { appId: "com.example.none" })).returnValue === false, "addDockModeLaunchPoint: an unknown app is refused");
        check((await luna(AM + "listDockPoints", {})).dockPoints.length === 0, "listDockPoints: empty, as on webOS");
        check((await luna(AM + "running", {})).returnValue === false, "running needs a shell (phoenix-sim answers it)");

        // ---- Redirect handlers ----------------------------------------------------------------
        check((await luna(AM + "getHandlerForUrl", { url: "mailto:someone@example.com" })).appId === "com.palm.app.email", "getHandlerForUrl: mailto: is Email's");
        check((await luna(AM + "getHandlerForUrl", { url: "https://example.com/" })).appId === "com.palm.app.browser", "a web page is the browser's");
        check((await luna(AM + "addRedirectHandler", { appId: "org.webosphoenix.maps", urlPattern: "^osm:", schemeForm: "yes" })).errorCode
              === "schemeForm parameter incorrectly specified (should be a boolean value)", "addRedirectHandler: schemeForm must be a boolean");
        check((await luna(AM + "addRedirectHandler", { appId: "org.webosphoenix.maps", urlPattern: "^osm:", schemeForm: true })).returnValue, "addRedirectHandler");
        check((await luna(AM + "addRedirectHandler", { appId: "com.palm.app.browser", urlPattern: "^osm:", schemeForm: true })).returnValue, "a second app for the same scheme");
        let all = await luna(AM + "listAllHandlersForUrl", { url: "osm:52.5,13.4" });
        check(all.redirectHandlers.activeHandler.appId === "org.webosphoenix.maps" && all.redirectHandlers.activeHandler.appName === "Maps"
              && all.redirectHandlers.alternates.length === 1, "listAllHandlersForUrl: the first is active, the other an alternate");
        check((await luna(AM + "swapRedirectHandler", { url: "^osm:", index: all.redirectHandlers.alternates[0].index })).returnValue, "swapRedirectHandler");
        check((await luna(AM + "getHandlerForUrl", { url: "osm:52.5,13.4" })).appId === "com.palm.app.browser", "the swapped one is used");
        check((await luna(AM + "swapRedirectHandler", { url: "^osm:", index: 99999 })).errorCode === "swap failed (incorrect index for url, perhaps?)", "a wrong index is refused");

        // ---- Resource handlers ------------------------------------------------------------------
        check((await luna(AM + "mimeTypeForExtension", { extension: "mp3" })).mimeType === "audio/mpeg", "mimeTypeForExtension");
        check((await luna(AM + "getHandlerForExtension", { extension: "pdf" })).appId === "org.webosphoenix.pdfview", "getHandlerForExtension");
        check((await luna(AM + "addResourceHandler", { appId: "org.webosphoenix.docview", shouldDownload: true, extension: "nope" })).errorCode
              === "Cannot find mime type for extension [nope]", "addResourceHandler: an unknown extension is refused");
        check((await luna(AM + "addResourceHandler", { appId: "org.webosphoenix.docview", shouldDownload: true, mimeType: "application/pdf" })).returnValue, "addResourceHandler");
        all = await luna(AM + "listAllHandlersForMime", { mime: "application/pdf" });
        const doc = (all.resourceHandlers.alternates || []).find((h) => h.appId === "org.webosphoenix.docview");
        check(all.resourceHandlers.activeHandler.appId === "org.webosphoenix.pdfview" && !!doc && doc.index >= 1000, "listAllHandlersForMime: added as an alternate");
        check((await luna(AM + "swapResourceHandler", { mimeType: "application/pdf", index: doc.index })).returnValue, "swapResourceHandler");
        check((await luna(AM + "getHandlerForMimeType", { mimeType: "application/pdf" })).appId === "org.webosphoenix.docview", "the swapped one opens PDFs");
        check((await luna(AM + "removeHandlersForAppId", { appId: "org.webosphoenix.docview" })).returnValue
              && (await luna(AM + "getHandlerForMimeType", { mimeType: "application/pdf" })).appId === "org.webosphoenix.pdfview", "removeHandlersForAppId");
        await luna(AM + "removeHandlersForAppId", { appId: "org.webosphoenix.maps" });
        await luna(AM + "removeHandlersForAppId", { appId: "com.palm.app.browser" });

        // ---- Installing: the launcher's progress, notifyOnChange, sizes --------------------------
        await subscribe("all", AI + "notifyOnChange", {});
        await subscribe("notes", AI + "notifyOnChange", { appId: "com.example.notes" });
        check((await replies("notes"))[0].appId === "com.example.notes" && (await replies("all"))[0].appId === "*", "notifyOnChange: one app, or every app (*)");
        const ipk = Buffer.from(await servers.webApp("com.example.notes", "1.0.0", { title: "Example Notes" }));
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/notes.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), ipk.toString("base64"));
        host.length = 0;
        await subscribe("install", "luna://com.webos.appInstallService/install", { id: "com.example.notes", ipkUrl: "/tmp/notes.ipk" });
        await page.waitForFunction(() => window.__subs.install.some((r) => r.statusValue === 30 || r.statusValue === 24), null, { timeout: 15000 });
        const statuses = host.filter((m) => m.type === "installStatus" && m.payload.appId === "com.example.notes").map((m) => m.payload);
        check(statuses.length >= 3 && statuses[0].state === "installing" && statuses.some((s) => s.progress === 50 && s.title === "Example Notes" && /^data:image\/png;base64,/.test(s.icon))
              && statuses[statuses.length - 1].state === "installed", "the launcher hears the install: installing (with the app's title and icon), then installed");
        await page.waitForTimeout(200);
        check((await replies("notes")).some((r) => r.statusChange === "INSTALLED" && r.version === "1.0.0") && (await replies("all")).some((r) => r.appId === "com.example.notes" && r.statusChange === "INSTALLED"),
              "notifyOnChange: INSTALLED");
        const appSizes = await luna(AI + "getUserInstalledAppSizes", {});
        const mine = appSizes.apps.find((a) => a.appName === "com.example.notes");
        check(!!mine && mine.size > 0 && appSizes.totalSize >= mine.size, "getUserInstalledAppSizes: KB per app the user installed");
        check((await launcherApps()).find((a) => a.id === "com.example.notes").installed === true, "the launcher knows it was installed by the user (Downloads)");

        // ---- Capacity ----------------------------------------------------------------------------------
        const cap = await luna(AI + "queryInstallCapacity", { packageId: "com.example.other", size: "300", uncompressedSize: "1200" });
        check(cap.returnValue && cap.result === 0 && cap.spaceNeededInKB === "1500", "queryInstallCapacity: package + unpacked");
        const cap2 = await luna(AI + "queryInstallCapacity", { packageId: "com.example.other", size: 300 });
        check(cap2.spaceNeededInKB === "900", "queryInstallCapacity: unpacked taken as twice the package");
        const huge = await luna(AI + "queryInstallCapacity", { packageId: "com.example.other", size: String(1024 * 1024 * 1024 * 64) });
        check(huge.result === 3, "queryInstallCapacity: not enough space for download (1) and install (2)");
        check((await luna(AI + "queryInstallCapacity", { packageId: "x" })).errorText === "missing size parameter", "queryInstallCapacity: size is needed");

        // ---- A failed install --------------------------------------------------------------------------
        const hooked = Buffer.from(await servers.webApp("com.example.hooked", "2.0", { title: "Hooked", scripts: { postinst: "#!/bin/sh\necho hi\n" } }));
        await page.evaluate((b64) => __phoenixRuntime.tmpFiles.write("/tmp/hooked.ipk", Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), hooked.toString("base64"));
        host.length = 0;
        await subscribe("hooked", "luna://com.webos.appInstallService/install", { id: "com.example.hooked", ipkUrl: "/tmp/hooked.ipk" });
        await page.waitForFunction(() => window.__subs.hooked.some((r) => r.statusValue === 24), null, { timeout: 15000 });
        const last = host.filter((m) => m.type === "installStatus" && m.payload.appId === "com.example.hooked").pop();
        check(!!last && last.payload.state === "failed" && /Developer Mode/.test(last.payload.reason), "a failed install: the launcher hears why");
        const q = await luna(AI + "installProgressQuery", { appId: "com.example.hooked" });
        check(q.returnValue && q.state === "failed", "installProgressQuery: failed");
        check((await luna(AI + "installProgressQuery", { appId: "com.example.none" })).returnValue === false, "installProgressQuery: nothing being installed");

        // ---- Revoke ----------------------------------------------------------------------------------------
        const bad = await luna(AI + "revoke", { item: JSON.stringify({ payload: { signature: Buffer.alloc(64).toString("base64"), appId: ["com.example.notes"] } }) });
        check(bad.returnValue === false && bad.errorCode === "verify failed", "revoke: a bad signature is refused");
        const keys = crypto.generateKeyPairSync("ed25519");
        const pub = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
        await page.evaluate((k) => localStorage.setItem("phoenix:marketplace:state", JSON.stringify({ sources: [{ id: "test", kind: "phoenix", key: k, enabled: true }] })), pub);
        const sig = crypto.sign(null, Buffer.from("com.example.notes"), keys.privateKey).toString("base64");
        check((await luna(AI + "revoke", { item: JSON.stringify({ payload: { signature: sig, appId: ["com.example.notes"] } }) })).returnValue, "revoke: signed by a trusted catalog");
        await page.waitForFunction(() => window.__subs.notes.some((r) => r.statusChange === "REMOVED"), null, { timeout: 10000 });
        check((await replies("notes")).some((r) => r.statusChange === "REMOVED" && r.cause === "REVOKED"), "notifyOnChange: REMOVED, cause REVOKED");
        check(!(await launcherApps()).some((a) => a.id === "com.example.notes"), "the revoked app is gone");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
    console.log(failures ? `${failures} failed` : "all passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
