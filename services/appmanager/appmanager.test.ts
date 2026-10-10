// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.applicationManager on OSE (appmanager.js): the legacy API over a
// fake SAM, with the simulator runtime's tables (its aliases and file
// types are checked against the runtime itself).

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(HERE, "..", "..");
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const am = require("./appmanager.js") as Any;

const APPS = [
    { id: "com.palm.app.email", title: "Email", icon: "icon.png", folderPath: "/usr/palm/applications/com.palm.app.email",
      mimeTypes: [{ mime: "message/rfc822" }] },
    { id: "com.palm.app.browser", title: "Web", icon: "/usr/palm/applications/com.palm.app.browser/icon.png" },
    { id: "org.webosphoenix.photos", title: "Photos", exhibitionMode: true },
    { id: "org.webosphoenix.music", title: "Music" },
    { id: "org.webosphoenix.maps", title: "Maps" },
    { id: "org.webosphoenix.phone", title: "Phone" },
    { id: "org.webosphoenix.settings", title: "Settings" },
    { id: "org.webosphoenix.videos", title: "Videos", mimeTypes: [{ mime: "video/mp4", extension: "mp4", stream: true }] },
    { id: "org.webosphoenix.pdfview", title: "PDF View", mimeTypes: [{ mime: "application/pdf", extension: "pdf" }] },
    { id: "com.example.mastodon", title: "Mastodon", siteScope: "https://mastodon.example/" },
    { id: "org.webosphoenix.agenda", title: "Agenda", exhibitionMode: true, exhibitionModeTitle: "Today" },
    { id: "com.palm.app.calendar.alarms", title: "Calendar", noWindow: true }
];

function world(opts: Any = {}) {
    const calls: Any[] = [];
    let saved: Any = null;
    const sam = (method: string, params: Any) => {
        calls.push({ method, params });
        if (method === "listApps") return Promise.resolve({ returnValue: true, apps: APPS });
        if (method === "launch") return Promise.resolve({ returnValue: true, appId: params.id, instanceId: "i-" + params.id });
        if (method === "getAppInfo") {
            const a = APPS.find((x) => x.id === params.id);
            return Promise.resolve(a ? { returnValue: true, appInfo: a } : { returnValue: false, errorText: "no" });
        }
        if (method === "listLaunchPoints") return Promise.resolve({ returnValue: true, launchPoints: APPS.map((a) => ({ id: a.id, title: a.title, launchPointId: a.id + "_default" })) });
        if (method === "running") return Promise.resolve({ returnValue: true, running: [{ id: "com.palm.app.email", processid: "1001" }] });
        if (method === "closeByAppId") return Promise.resolve({ returnValue: true });
        if (method === "addLaunchPoint") return Promise.resolve({ returnValue: true, launchPointId: "com.palm.app.browser_1" });
        return Promise.resolve({ returnValue: false, errorText: "unknown " + method });
    };
    const handlers = fs.readFileSync(path.join(REPO, "compat/rootfs/usr/palm/command-resource-handlers.json"), "utf8");
    const m = am.createAppManager({
        sam, readFile: (p: string) => (p === "/usr/palm/command-resource-handlers.json" ? handlers : null),
        registry: { load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), save: (o: Any) => { saved = JSON.parse(JSON.stringify(o)); } },
        now: () => opts.time || 0
    });
    const launches = () => calls.filter((c) => c.method === "launch").map((c) => c.params);
    return { m, calls, launches, saved: () => saved };
}

describe("com.palm.applicationManager on OSE", () => {
    it("launches through SAM, with Phoenix's aliases for the apps it replaced", async () => {
        const w = world();
        expect(await w.m.methods.launch({ id: "com.palm.app.maps", params: { address: "1 Main St" } }))
            .toEqual({ returnValue: true, processId: "i-org.webosphoenix.maps" });
        expect(await w.m.methods.launch({ id: "com.palm.app.backup" })).toMatchObject({ returnValue: true });
        expect(await w.m.methods.launch({ id: "com.palm.app.help", params: { target: "http://help.palm.com/phone/index.html" } }))
            .toMatchObject({ returnValue: true });
        expect(w.launches()).toEqual([
            { id: "org.webosphoenix.maps", params: { address: "1 Main St" } },
            { id: "org.webosphoenix.settings", params: { page: "backup" } },
            { id: "org.webosphoenix.help", params: { topic: "phone" } }
        ]);
    });

    it("runs an app without a window hidden (WebAppMgr's preload)", async () => {
        const w = world();
        await w.m.methods.launch({ id: "com.palm.app.calendar.alarms", params: { a: 1 } });
        expect(w.launches()).toEqual([{ id: "com.palm.app.calendar.alarms", params: { a: 1 }, preload: "partial" }]);
    });

    it("opens a target in the app for it: schemes, sites, the browser, files by type", async () => {
        const w = world();
        const open = (target: string) => w.m.methods.open({ target });
        await open("mailto:ada@example.com");
        await open("tel:5550100");
        await open("https://maps.google.com/?q=paris");
        await open("https://mastodon.example/@ada");
        await open("https://example.com/page");
        await open("/media/internal/Downloads/report.pdf");
        await open("file:///media/internal/DCIM/a.jpg");
        await open("https://example.com/film.mp4");
        expect(w.launches().map((l: Any) => l.id)).toEqual([
            "com.palm.app.email", "org.webosphoenix.phone", "org.webosphoenix.maps", "com.example.mastodon",
            "com.palm.app.browser", "org.webosphoenix.pdfview", "org.webosphoenix.photos", "org.webosphoenix.videos"
        ]);
        expect(w.launches()[0].params).toEqual({ target: "mailto:ada@example.com" });
        expect(await open("nosuch:thing")).toEqual({ returnValue: false, errorCode: -1, errorText: "No handler for nosuch:thing" });
        // By id, as launch.
        await w.m.methods.open({ id: "org.webosphoenix.music", params: { a: 1 } });
        expect(w.launches().pop()).toEqual({ id: "org.webosphoenix.music", params: { a: 1 } });
    });

    it("answers the handler queries as MimeSystem did", async () => {
        const w = world();
        expect(await w.m.methods.getHandlerForMimeType({ mimeType: "image/png" })).toEqual({ returnValue: true, appId: "org.webosphoenix.photos", mimeType: "image/png" });
        expect(await w.m.methods.getResourceInfo({ uri: "file:///media/internal/a.mp4" }))
            .toMatchObject({ returnValue: true, appIdByExtension: "org.webosphoenix.videos", mimeByExtension: "video/mp4", canStream: false });
        expect(await w.m.methods.getResourceInfo({ uri: "https://x.example/a.mp4" })).toMatchObject({ canStream: true });
        expect(await w.m.methods.mimeTypeForExtension({ extension: ".PDF" })).toMatchObject({ returnValue: true, mimeType: "application/pdf" });
        expect(await w.m.methods.getHandlerForExtension({ extension: "pdf" })).toMatchObject({ appId: "org.webosphoenix.pdfview", download: true });
        expect(await w.m.methods.getHandlerForUrl({ url: "sms:5550100" })).toMatchObject({ returnValue: true, appId: "org.webosphoenix.messaging" });
        const all = await w.m.methods.listAllHandlersForMime({ mime: "video/mp4" });
        expect(all.resourceHandlers.activeHandler.appId).toBe("org.webosphoenix.videos");
        expect(all.resourceHandlers.alternates.map((h: Any) => h.appId)).toEqual(["org.webosphoenix.photos"]);
        // Swapped: Photos opens MP4s now, and stays so (the registry is saved).
        const photos = all.resources.find((h: Any) => h.appId === "org.webosphoenix.photos");
        expect(await w.m.methods.swapResourceHandler({ mimeType: "video/mp4", index: photos.index })).toEqual({ subscribed: false, returnValue: true });
        expect((await w.m.methods.getHandlerForMimeType({ mimeType: "video/mp4" })).appId).toBe("org.webosphoenix.photos");
        expect(w.saved().activeResource["video/mp4"]).toBe(photos.index);
    });

    it("keeps the redirect handlers apps add, and their choice", async () => {
        const w = world();
        expect(await w.m.methods.addRedirectHandler({ appId: "org.webosphoenix.music", urlPattern: "^https?://music\\.example/" }))
            .toEqual({ subscribed: false, returnValue: true });
        expect(await w.m.methods.addRedirectHandler({ appId: "com.nope", urlPattern: "^x:" })).toMatchObject({ returnValue: false });
        await w.m.methods.open({ target: "https://music.example/album/1" });
        expect(w.launches().pop().id).toBe("org.webosphoenix.music");
        const list = await w.m.methods.listAllHandlersForUrl({ url: "mailto:x@y.z" });
        expect(list.redirectHandlers.activeHandler).toMatchObject({ appId: "com.palm.app.email", appName: "Email" });
        await w.m.methods.removeHandlersForAppId({ appId: "org.webosphoenix.music" });
        await w.m.methods.open({ target: "https://music.example/album/1" });
        expect(w.launches().pop().id).toBe("com.palm.app.browser");
    });

    it("gives SAM's app lists and processes in the legacy shapes", async () => {
        const w = world();
        const apps = await w.m.methods.listApps({});
        expect(apps.apps.find((a: Any) => a.id === "com.palm.app.email").icon).toBe("/usr/palm/applications/com.palm.app.email/icon.png");
        expect(w.calls.find((c: Any) => c.method === "listApps").params.properties).toContain("mimeTypes");
        expect(await w.m.methods.getAppInfo({ appId: "org.webosphoenix.music" })).toMatchObject({ returnValue: true, appInfo: { title: "Music" } });
        expect(await w.m.methods.getAppBasePath({ appId: "com.palm.app.email" })).toEqual({ returnValue: true,
            appId: "com.palm.app.email", basePath: "file:///usr/palm/applications/com.palm.app.email/index.html" });
        expect(await w.m.methods.getAppBasePath({ appId: "foobar" })).toMatchObject({ returnValue: false, errorText: "Invalid appId specified: foobar" });
        expect((await w.m.methods.searchApps({ keyword: "pho" })).apps).toEqual([
            { launchPoint: "org.webosphoenix.photos_default" }, { launchPoint: "org.webosphoenix.phone_default" }]);
        expect(await w.m.methods.running({})).toEqual({ returnValue: true, running: [{ id: "com.palm.app.email", processid: "1001" }] });
        expect(await w.m.methods.close({ processId: "1001" })).toEqual({ returnValue: true });
        expect(w.calls.find((c: Any) => c.method === "closeByAppId").params).toEqual({ id: "com.palm.app.email" });
        expect(await w.m.methods.addLaunchPoint({ id: "com.palm.app.browser", title: "News", params: "{\"url\":\"https://n.example\"}" }))
            .toEqual({ returnValue: true, launchPointId: "com.palm.app.browser_1" });
        expect(w.calls.find((c: Any) => c.method === "addLaunchPoint").params).toEqual({ id: "com.palm.app.browser", title: "News", params: { url: "https://n.example" } });
    });

    it("keeps the exhibitions the user turned on", async () => {
        const w = world();
        let r = await w.m.methods.listDockModeLaunchPoints({});
        expect(r.launchPoints.map((l: Any) => [l.id, l.enabled, l.exhibitionModeTitle])).toEqual([
            ["org.webosphoenix.photos", true, "Photos"], ["org.webosphoenix.agenda", false, "Today"]]);
        const heard: Any[] = [];
        const stop = w.m.watchDockMode((x: Any) => heard.push(x));
        expect(await w.m.methods.addDockModeLaunchPoint({ appId: "com.palm.app.agendaview" })).toEqual({ returnValue: true });
        expect(await w.m.methods.addDockModeLaunchPoint({ appId: "org.webosphoenix.music" })).toMatchObject({ returnValue: false });
        await new Promise((res) => setTimeout(res, 0));
        expect(heard.length).toBe(1);
        stop();
        r = await w.m.methods.listDockModeLaunchPoints({});
        expect(r.launchPoints.every((l: Any) => l.enabled)).toBe(true);
        expect(w.saved().exhibitionApps).toEqual(["org.webosphoenix.photos", "org.webosphoenix.agenda"]);
    });

    it("has the simulator runtime's aliases, file types and handlers", () => {
        const src = fs.readFileSync(path.join(REPO, "runtime/phoenix-runtime.js"), "utf8");
        // Each alias the service has is the runtime's, and the other way round.
        const block = /var APP_ALIASES = \{([\s\S]*?)\n    \};/.exec(src)![1];
        const keys = [...block.matchAll(/^\s*"([a-z0-9.\-]+)":/gm)].map((m) => m[1]).sort();
        expect(Object.keys(am.APP_ALIASES).sort()).toEqual(keys);
        for (const k of keys) {
            const v = am.APP_ALIASES[k];
            const id = typeof v === "string" ? v : v.id;
            expect(block).toContain(id);
        }
        for (const ext of Object.keys(am.MIME)) expect(src).toContain(ext + ": \"" + am.MIME[ext] + "\"");
        for (const h of am.HANDLERS) expect(src).toContain("{ prefix: \"" + h.prefix + "\", appId: \"" + h.appId + "\"");
    });

    it("has luna-service2 files for every method, and may launch through SAM", () => {
        const api = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/com.palm.applicationManager.api.json"), "utf8"));
        const listed = new Set(Object.values(api).flat().map((m: Any) => String(m).split("/")[1]));
        for (const name of [...am.METHODS, "launchPointChanges"]) expect(listed.has(name)).toBe(true);
        const perm = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/com.palm.applicationManager.perm.json"), "utf8"));
        // SAM's launch is application.launcher, oem only (webosose/sam files/sysbus/com.webos.sam.groups.json).
        expect(perm["com.palm.applicationManager"]).toEqual(["application.operation", "application.launcher"]);
        const role = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/com.palm.applicationManager.role.json"), "utf8"));
        expect(role.trustLevel).toBe("oem");
    });
});
