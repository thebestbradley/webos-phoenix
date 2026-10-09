// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device service (packagesservice.js) against the real catalog service
// (server/marketplace with PHP's built-in server; skipped without PHP and its
// sodium and pdo_sqlite extensions), a web app site, an App Museum stand-in
// and a Preware feed (test/servers.cjs). OSE's installer is a fake that
// checks it was handed a real .ipk; the simulator's real one is tested in
// tools/test-marketplace.cjs.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createPackagesService } = require("./packagesservice.js") as Any;
const http = require("./lib/node-http.js") as Any;
const ipkLib = require("./lib/ipk.js") as Any;
const servers = require("./test/servers.cjs") as Any;

const gzip = { gzip: async (b: Uint8Array) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b: Uint8Array) => new Uint8Array(zlib.gunzipSync(b)) };
const ipk = ipkLib.createIpk({ gzip });

function makeService(sources: Any[]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-mkt-"));
    const world = { state: null as Any, installed: {} as Record<string, Any>, installs: [] as Any[], toasts: [] as Any[], fail: null as string | null,
                    devMode: false, noIcons: false, pending: [] as Any[] };
    const luna = {
        call: async (uri: string, params: Any) => {
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: world.devMode ? "enabled" : "disabled" };
            // As the launcher has them: the app's own icon, on the device (none when world.noIcons).
            if (uri.endsWith("/listLaunchPoints")) return { returnValue: true, launchPoints: Object.keys(world.installed).map((id) => ({
                id, launchPointId: id + "_default", removable: true, icon: world.noIcons ? "" : `/usr/palm/applications/${id}/icon.png` })) };
            if (uri.endsWith("/createToast")) { world.toasts.push(params); return { returnValue: true }; }
            return { returnValue: true };
        },
        // OSE's installer: reads the package it is given, as appinstalld does.
        subscribe: (uri: string, params: Any, onReply: (r: Any) => void) => {
            setTimeout(async () => {
                if (uri.endsWith("/install")) {
                    const bytes = new Uint8Array(fs.readFileSync(params.ipkUrl));
                    const pkg = await ipk.read(bytes);
                    world.installs.push({ id: params.id, pkg, developerMode: !!params.developerMode });
                    if (world.fail) return onReply({ returnValue: true, id: params.id, statusValue: 24, details: { state: "install failed", reason: world.fail } });
                    world.installed[params.id] = pkg;
                    onReply({ returnValue: true, id: params.id, statusValue: 13, details: { state: "installing" } });
                    onReply({ returnValue: true, id: params.id, statusValue: 30, details: { state: "installed" } });
                } else if (uri.endsWith("/remove")) {
                    if (!world.installed[params.id]) return onReply({ returnValue: false, errorCode: -2, errorText: "No such id" });
                    delete world.installed[params.id];
                    onReply({ returnValue: true, id: params.id, statusValue: 31, details: { state: "removed" } });
                }
            }, 5);
            return () => {};
        }
    };
    const service = createPackagesService({
        luna, request: http.request, requestBytes: http.requestBytes, gzip,
        crypto: {
            sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
            sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest())
        },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o: Any) => { world.state = JSON.parse(JSON.stringify(o)); } },
        temp: { write: (name: string, bytes: Uint8Array) => { const f = path.join(temp, name); fs.writeFileSync(f, bytes); return f; }, remove: (f: string) => fs.rmSync(f, { force: true }) },
        defaultSources: () => sources,
        // The launcher's pending icons, as the runtime passes them on.
        pending: (st: Any) => world.pending.push(st)
    });
    return { service, world };
}

describe.skipIf(!servers.phpAvailable())("the Marketplace against the catalog service", () => {
    let catalog: Any, site: Any, museum: Any, feed: Any;
    beforeAll(async () => {
        site = await servers.startSite();
        catalog = await servers.startCatalog({
            curated: [{ id: "org.webosphoenix.pwa.tides", title: "Tides", developer: "Tide Co", summary: "Tide tables", categories: ["Travel"],
                        featured: true, manifest: site.manifestUrl, origin: site.url, icon: site.url + "/app/icon-192.png" },
                      // Its icons all broken: the probe found the manifest good and the catalog makes its icon.
                      { id: "org.webosphoenix.pwa.harbour", title: "Harbour Times", developer: "Harbour Co", summary: "Harbour clocks",
                        categories: ["Travel"], featured: false, manifest: site.manifestUrl, origin: site.url, icon: "",
                        iconGenerated: { text: "HT", color: "#1d4f7a", why: "manifest's icons are missing" } }]
        });
        museum = await servers.startMuseum();
        feed = await servers.startFeed();
    }, 60000);
    afterAll(async () => {
        await Promise.all([catalog?.stop(), site?.close(), museum?.close(), feed?.close()]);
    });

    const defaults = () => [
        { id: "phoenix", name: "Phoenix Marketplace", kind: "phoenix", url: catalog.catalogUrl, key: null, enabled: true },
        { id: "appmuseum", name: "App Museum II", kind: "appmuseum", url: museum.url + "/", enabled: false },
        { id: "precentral", name: "PreCentral", kind: "preware", url: feed.feedUrl, enabled: false }
    ];

    it("trusts a catalog only after its key is checked, then reads it", async () => {
        const { service } = makeService(defaults());
        const r = await service.refresh({});
        const ph = r.results.find((x: Any) => x.id === "phoenix");
        expect(ph).toMatchObject({ ok: false, errorCode: "UNTRUSTED", pending: { key: catalog.key, fingerprint: catalog.fingerprint } });
        expect((await service.browse({ section: "featured" })).apps).toEqual([]);
        const t = await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        expect(t.results[0]).toMatchObject({ ok: true });
        expect((await service.getSources()).sources[0]).toMatchObject({ id: "phoenix", trusted: true, fingerprint: catalog.fingerprint });
        const first = await service.browse({ section: "featured" });
        expect(first.apps).toHaveLength(20);   // a page
        expect(first.more).toBe(true);
        expect(first.apps[0].featured).toBe(true);
        expect((await service.browse({ section: "featured", page: 1 })).apps.length).toBeGreaterThan(0);
        const web = await service.browse({ section: "web", category: "Travel" });
        expect(web.apps.map((a: Any) => a.id)).toContain("org.webosphoenix.pwa.tides");
        expect((await service.search({ query: "tide tables" })).apps.map((a: Any) => a.id)).toEqual(["org.webosphoenix.pwa.tides"]);
    });

    it("refuses an index that is not signed by the trusted key, and an older one", async () => {
        const { service } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const good = fs.readFileSync(catalog.indexFile, "utf8");
        fs.writeFileSync(catalog.indexFile, good.replace("Tide tables", "Tide tablez"));
        expect((await service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ ok: false, errorCode: "BAD_SIGNATURE" });
        fs.writeFileSync(catalog.indexFile, good);
        const old = { index: good, sig: fs.readFileSync(catalog.indexFile + ".sig", "utf8") };
        catalog.php(["publish"]);
        expect((await service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ ok: true });
        fs.writeFileSync(catalog.indexFile + ".sig", old.sig);
        fs.writeFileSync(catalog.indexFile, old.index);
        expect((await service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ ok: false, errorCode: "ROLLBACK" });
        catalog.php(["publish"]);
        // A different key is refused too.
        const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
        const s2 = makeService(defaults());
        await s2.service.trustSource({ url: catalog.catalogUrl, key: other });
        expect((await s2.service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ ok: false, errorCode: "BAD_SIGNATURE" });
    });

    it("installs a web app as an .ipk made from its manifest", async () => {
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const seen: string[] = [];
        const r = await service.install({ sourceId: "phoenix", id: "org.webosphoenix.pwa.tides" }, (s: Any) => seen.push(s.state));
        expect(r).toMatchObject({ returnValue: true, appId: "org.webosphoenix.pwa.tides", state: "installed" });
        expect(seen).toEqual(["downloading", "checking", "installing", "installed"]);
        const pkg = world.installs[0].pkg;
        const info = pkg.apps[0].appinfo;
        expect(info).toMatchObject({ id: "org.webosphoenix.pwa.tides", type: "web", main: site.url + "/app/?source=pwa", title: "Tides",
                                     icon: "icon.png", splashicon: "icon-256x256.png", vendor: "Tide Co",
                                     phoenix: { pwa: { scope: site.url + "/app/", display: "standalone", themeColor: "#1d4f7a" } } });
        const icon = pkg.files.find((f: Any) => f.path.endsWith("/icon.png"));
        expect(Buffer.from(icon.data).subarray(16, 24).readUInt32BE(0)).toBe(192);   // the 192 px icon, not the maskable one
        // Its icon: its own on the device, as the launcher shows it; the catalog's kept as the fallback.
        const catalogIcon = (await service.getApp({ sourceId: "phoenix", id: "org.webosphoenix.pwa.tides" })).app.icon;
        expect((await service.listInstalled()).apps).toEqual([expect.objectContaining({ id: "org.webosphoenix.pwa.tides", kind: "pwa", update: null,
            icon: "/usr/palm/applications/org.webosphoenix.pwa.tides/icon.png", catalogIcon })]);
        expect(catalogIcon).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/icons\/copy\//);
        const page = (await service.getApp({ sourceId: "phoenix", id: "org.webosphoenix.pwa.tides" })).app;
        expect(page.installed).toMatchObject({ sourceId: "phoenix" });
        expect(page.ownIcon).toBe("/usr/palm/applications/org.webosphoenix.pwa.tides/icon.png");
        // A launcher with no icon for it: the catalog's.
        world.noIcons = true;
        expect((await service.listInstalled()).apps[0]).toMatchObject({ icon: catalogIcon, catalogIcon });
        world.noIcons = false;
        expect((await service.remove({ id: "org.webosphoenix.pwa.tides" })).returnValue).toBe(true);
        expect((await service.listInstalled()).apps).toEqual([]);
    });

    it("installs a web app whose icons are all broken with the icon the catalog made", async () => {
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const app = (await service.getApp({ sourceId: "phoenix", id: "org.webosphoenix.pwa.harbour" })).app;
        expect(app.icon).toBe(catalog.catalogUrl.replace(/index\.json$/, "") + "icons/org.webosphoenix.pwa.harbour.svg");
        site.setManifest({ name: "Harbour Times", start_url: "/app/", icons: [{ src: "gone-192.png", sizes: "192x192", type: "image/png" }] });
        try {
            const r = await service.install({ sourceId: "phoenix", id: "org.webosphoenix.pwa.harbour" });
            expect(r).toMatchObject({ returnValue: true, appId: "org.webosphoenix.pwa.harbour" });
        } finally {
            site.setManifest({ name: "Tide Tables for Sailors", short_name: "Tides", start_url: "/app/", icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }] });
        }
        const pkg = world.installs[0].pkg;
        expect(pkg.apps[0].appinfo.icon).toBe("icon.svg");
        const svg = Buffer.from(pkg.files.find((f: Any) => f.path.endsWith("/icon.svg")).data).toString();
        expect(svg).toMatch(/^<svg [^>]*>.*>HT<\/text><\/svg>/s);
        expect(svg).toContain('fill="#1d4f7a"');
    });

    it("keeps a web app on its own site when its manifest points elsewhere", async () => {
        const { service } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        site.setManifest({ name: "Tides", start_url: "https://evil.example/", icons: [] });
        const r = await service.install({ sourceId: "phoenix", id: "org.webosphoenix.pwa.tides" });
        site.setManifest({ name: "Tide Tables for Sailors", short_name: "Tides", start_url: "/app/", icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }] });
        // A start URL on another origin than the site falls back to the site, as browsers do.
        expect(r.returnValue).toBe(true);
    });

    it("installs a developer's package, checks it against the signed SHA-256, and updates it", async () => {
        const dev = await catalog.api("POST", "/api/accounts", { name: "Dana", email: "dana@example.com", role: "developer" });
        const v1 = await servers.webApp("com.example.notes", "1.0.0");
        const up = await catalog.api("POST", "/api/apps/packages", v1, dev.token);
        await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        expect((await service.browse({ section: "apps" })).apps.map((a: Any) => a.id)).toEqual(["com.example.notes"]);
        const r = await service.install({ sourceId: "phoenix", id: "com.example.notes" });
        expect(r).toMatchObject({ returnValue: true, appId: "com.example.notes" });
        expect(world.installs.at(-1).pkg.control.Version).toBe("1.0.0");

        // A package that is not the one the catalog signed.
        const file = path.join(catalog.data, "public/v1/packages/com.example.notes_1.0.0_all.ipk");
        const keep = fs.readFileSync(file);
        fs.writeFileSync(file, Buffer.from(await servers.webApp("com.example.notes", "1.0.0", { title: "Evil" })));
        const bad = await service.install({ sourceId: "phoenix", id: "com.example.notes" });
        expect(bad).toMatchObject({ returnValue: false, errorCode: "BAD_PACKAGE" });
        fs.writeFileSync(file, keep);

        // An update.
        const v2 = await catalog.api("POST", "/api/apps/packages", await servers.webApp("com.example.notes", "1.1.0"), dev.token);
        await catalog.api("POST", `/api/admin/releases/${v2.release.id}/approve`, {}, catalog.admin);
        await service.refresh({});
        expect((await service.listInstalled()).apps).toEqual([expect.objectContaining({ id: "com.example.notes", version: "1.0.0", update: "1.1.0" })]);
        const all = await service.updateAll();
        expect(all).toMatchObject({ updated: ["com.example.notes"], failed: [] });
        expect((await service.listInstalled()).apps[0]).toMatchObject({ version: "1.1.0", update: null });

        // Removed in the launcher: forgotten here too.
        delete world.installed["com.example.notes"];
        expect((await service.listInstalled()).apps).toEqual([]);
    });

    it("tells of updates once a day", async () => {
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        await service.install({ sourceId: "phoenix", id: "com.example.notes" });
        world.state.installed["com.example.notes"].version = "0.9";
        const r = await service.scheduled({ $activity: { activityId: 3 } });
        expect(r.updates).toBe(1);
        expect(world.toasts[0]).toMatchObject({ message: "1 app update in the Marketplace", onclick: { appId: "org.webosphoenix.marketplace" } });
    });

    it("installs Classics from the App Museum, and refuses Mojo apps", async () => {
        const { service, world } = makeService(defaults());
        expect((await service.browse({ section: "classics" })).apps).toEqual([]);
        await service.setSource({ id: "appmuseum", enabled: true });
        const classics = (await service.browse({ section: "classics", category: "Productivity" })).apps;
        expect(classics).toEqual([expect.objectContaining({ id: "appmuseum.9001", kind: "classic", title: "Classic Notes",
                                                               icon: museum.url + "/AppImages/9001/icon-256.png", devices: ["Pre3", "TouchPad"] })]);
        expect((await service.search({ query: "mojo" })).apps.map((a: Any) => a.id)).toEqual(["appmuseum.9002"]);
        const ok = await service.install({ sourceId: "appmuseum", id: "appmuseum.9001" });
        expect(ok).toMatchObject({ returnValue: true, appId: "com.example.classicnotes" });
        // The launcher's pending icon: none from the App Museum's details (the
        // launcher draws the initial), then the package's own once read.
        const icons = world.pending.filter((st: Any) => st.appId === "com.example.classicnotes" || st.catalogId === "appmuseum.9001")
            .map((st: Any) => [st.state, st.icon.slice(0, 22)]);
        expect(icons[0]).toEqual(["downloading", ""]);
        expect(icons.filter(([state]: string[]) => state === "installing" || state === "installed"))
            .toEqual(expect.arrayContaining([["installing", "data:image/png;base64,"]]));
        expect(icons.every(([state, icon]: string[]) => state === "downloading" || state === "checking" || icon === "data:image/png;base64,")).toBe(true);
        expect(world.installs.at(-1).id).toBe("com.example.classicnotes");
        await new Promise((r) => setTimeout(r, 50));
        expect(museum.counted).toEqual(["9001"]);
        const mojo = await service.install({ sourceId: "appmuseum", id: "appmuseum.9002" });
        expect(mojo).toMatchObject({ returnValue: false, errorCode: "NEEDS_MOJO" });
        // An Enyo app with a native PDK plugin installs; the plugin is named
        // as what this device cannot run yet.
        const hybrid = await service.install({ sourceId: "appmuseum", id: "appmuseum.9003" });
        expect(hybrid).toMatchObject({ returnValue: true, appId: "com.example.classicoffice", skipped: ["native plugin (docservice)"] });
    });

    it("reads a Preware feed: web apps install, native ones and changed downloads do not", async () => {
        const { service } = makeService(defaults());
        await service.setSource({ id: "precentral", enabled: true });
        const all = (await service.browse({ section: "classics" })).apps.filter((a: Any) => a.kind === "preware");
        expect(all.map((a: Any) => [a.id, a.version])).toEqual([["org.example.homebrew", "0.9.1"], ["org.example.nativelib", "1.0"], ["org.example.hooked", "2.0"]]);
        expect(all[0]).toMatchObject({ description: "Line one\nLine two", license: "GPL-2.0", developer: { name: "Homebrewer" } });
        expect(all[1].verdict).toMatchObject({ ok: false });
        const native = await service.install({ sourceId: "precentral", id: "org.example.nativelib" });
        expect(native).toMatchObject({ errorCode: "UNSUPPORTED" });
        expect(native.errorText).toMatch(/native webOS app, compiled for armv7 processors.*planned/);
        expect(await service.install({ sourceId: "precentral", id: "org.example.homebrew" })).toMatchObject({ returnValue: true });
        feed.corrupt();
        await service.remove({ id: "org.example.homebrew" });
        expect(await service.install({ sourceId: "precentral", id: "org.example.homebrew" })).toMatchObject({ errorCode: "BAD_PACKAGE" });
    });

    it("installs a package with install scripts and services only in Developer Mode, and says so to the installer", async () => {
        const { service, world } = makeService(defaults());
        await service.setSource({ id: "precentral", enabled: true });
        await service.refresh({ id: "precentral" });
        const refused = await service.install({ sourceId: "precentral", id: "org.example.hooked" });
        expect(refused).toMatchObject({ errorCode: "NEEDS_DEVMODE" });
        expect(refused.errorText).toMatch(/install scripts.*Developer Mode/);
        expect(world.installs).toHaveLength(0);
        world.devMode = true;
        expect(await service.install({ sourceId: "precentral", id: "org.example.hooked" })).toMatchObject({ returnValue: true, appId: "org.example.hooked" });
        expect(world.installs.at(-1)).toMatchObject({ id: "org.example.hooked", developerMode: true });
        expect(world.installs.at(-1).pkg.scripts).toEqual(["postinst"]);
    });
});
