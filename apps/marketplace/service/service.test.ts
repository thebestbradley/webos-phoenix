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
// The connector kit's packer (FEEDS, the example connector, as `phoenix-connector pack` makes it).
import { pack } from "../../shared/connector-kit/src/tools/package";

const gzip = { gzip: async (b: Uint8Array) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b: Uint8Array) => new Uint8Array(zlib.gunzipSync(b)) };
const ipk = ipkLib.createIpk({ gzip });

function makeService(sources: Any[], preinstalled?: Any[], extra?: Any) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-mkt-"));
    const world = { state: null as Any, installed: {} as Record<string, Any>, installs: [] as Any[], toasts: [] as Any[], fail: null as string | null,
                    devMode: false, noIcons: false, pending: [] as Any[],
                    // The shell's layout (getSystemStatus formFactor): the device's class; "" until it says.
                    formFactor: "",
                    // The apps the device came with (not removable), by id: their versions.
                    builtins: {} as Record<string, string>,
                    // A catalog's index read only once this is let go (a refresh that takes a while); held: it was asked for.
                    holdIndex: null as Promise<void> | null, held: false };
    const luna = {
        call: async (uri: string, params: Any) => {
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: world.devMode ? "enabled" : "disabled" };
            if (uri.endsWith("/getSystemStatus")) return { returnValue: true, formFactor: world.formFactor };
            // As the launcher has them: the app's own icon, on the device (none when world.noIcons).
            // A built-in app is not removable; an installed update of one is, in its place.
            if (uri.endsWith("/listLaunchPoints")) return { returnValue: true, launchPoints: [
                ...Object.keys(world.installed).map((id) => ({
                    id, launchPointId: id + "_default", removable: true, icon: world.noIcons ? "" : `/usr/palm/applications/${id}/icon.png`,
                    ...(id in world.builtins ? { builtinVersion: world.builtins[id] } : {}) })),
                ...Object.keys(world.builtins).filter((id) => !world.installed[id]).map((id) => ({
                    id, launchPointId: id + "_default", removable: false, version: world.builtins[id], icon: `/usr/palm/applications/${id}/icon.png` }))] };
            if (uri.endsWith("/createToast")) { world.toasts.push(params); return { returnValue: true }; }
            return { returnValue: true };
        },
        // OSE's installer: reads the package it is given, as appinstalld does.
        subscribe: (uri: string, params: Any, onReply: (r: Any) => void) => {
            setTimeout(async () => {
                if (uri.endsWith("/install")) {
                    const bytes = new Uint8Array(fs.readFileSync(params.ipkUrl));
                    const pkg = await ipk.read(bytes);
                    world.installs.push({ id: params.id, pkg, developerMode: !!params.developerMode, firstParty: !!params.firstParty });
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
        luna, request: http.request, gzip,
        requestBytes: async (req: Any) => {
            if (world.holdIndex && /\/index\.json$/.test(req.url)) {
                world.held = true;
                await world.holdIndex;
            }
            return http.requestBytes(req);
        },
        crypto: {
            sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
            sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest())
        },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o: Any) => { world.state = JSON.parse(JSON.stringify(o)); } },
        temp: { write: (name: string, bytes: Uint8Array) => { const f = path.join(temp, name); fs.writeFileSync(f, bytes); return f; }, remove: (f: string) => fs.rmSync(f, { force: true }) },
        defaultSources: () => sources,
        preinstalled: preinstalled ? () => preinstalled : undefined,
        // The launcher's pending icons, as the runtime passes them on.
        pending: (st: Any) => world.pending.push(st),
        ...(extra || {})
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
                        iconGenerated: { text: "HT", color: "#1d4f7a", why: "manifest's icons are missing" } },
                      // A site that publishes no manifest (as Slack): the one Phoenix wrote for it, served by the catalog.
                      { id: "org.webosphoenix.pwa.quay", title: "Quay Chat", developer: "Quay Co", summary: "Chat on the quay",
                        categories: ["Communication"], featured: false, manifestBy: "phoenix", origin: site.url, icon: site.url + "/favicon.ico",
                        webManifest: { name: "Quay Chat", short_name: "Quay", start_url: site.url + "/chat/", scope: site.url + "/chat/",
                                       display: "standalone", theme_color: "#4a154b", background_color: "#ffffff",
                                       icons: [{ src: site.url + "/favicon.ico", sizes: "16x16 256x256", type: "image/x-icon" }] } }]
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

    it("installs a web app whose site publishes no manifest with the one the catalog wrote, as signed", async () => {
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const app = (await service.getApp({ sourceId: "phoenix", id: "org.webosphoenix.pwa.quay" })).app;
        // Served by the catalog, not the site; the index signs its SHA-256.
        const written = app.pwa.manifest as string;
        expect(written).toMatch(new RegExp("^" + catalog.catalogUrl + "manifests/org\\.webosphoenix\\.pwa\\.quay-[0-9a-f]{16}\\.webmanifest$"));
        const file = path.join(catalog.data, "public/v1/manifests", path.basename(written));
        expect(app.pwa).toEqual({ manifest: written, origin: site.url,
                                  sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
        expect((await fetch(written)).headers.get("content-type")).toBe("application/manifest+json");
        const r = await service.install({ sourceId: "phoenix", id: "org.webosphoenix.pwa.quay" });
        expect(r).toMatchObject({ returnValue: true, appId: "org.webosphoenix.pwa.quay", state: "installed" });
        const pkg = world.installs[0].pkg;
        // Its start page and scope on the site the index names, though the manifest is on the catalog's host.
        expect(pkg.apps[0].appinfo).toMatchObject({ id: "org.webosphoenix.pwa.quay", main: site.url + "/chat/", title: "Quay Chat", icon: "icon.png",
            phoenix: { pwa: { manifest: written, scope: site.url + "/chat/", display: "standalone", themeColor: "#4a154b" } } });
        // The site's favicon.ico, as the PNG its biggest picture is (Qt would draw its 16 px one).
        const icon = Buffer.from(pkg.files.find((f: Any) => f.path.endsWith("/icon.png")).data);
        expect(icon.subarray(0, 4).toString("latin1")).toBe("\x89PNG");
        expect(icon.subarray(16, 24).readUInt32BE(0)).toBe(256);
        // A copy that is not the one the index signed (a mirror's, say) is refused.
        const good = fs.readFileSync(file);
        fs.writeFileSync(file, good.toString().replace("/chat/\"", "/elsewhere/\""));
        try {
            const s2 = makeService(defaults());
            await s2.service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
            expect(await s2.service.install({ sourceId: "phoenix", id: "org.webosphoenix.pwa.quay" }))
                .toMatchObject({ returnValue: false, errorCode: "BAD_MANIFEST", errorText: "The web app's manifest is not the one the catalog signed" });
            expect(s2.world.installs).toEqual([]);
        } finally {
            fs.writeFileSync(file, good);
        }
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

    it("reads an app's update log: What's New from the signed index, the history from the detail it signs, an update's notes", async () => {
        const dev = await catalog.api("POST", "/api/accounts", { name: "Tess", email: "tess@example.com", role: "developer" });
        const rebuild = { version: "2.0.0", date: "2026-10-12", rebuild: true, replaces: "Tasks 1.0 (webOS 3.0.5)",
                          summary: "Tasks, rebuilt for webOS Phoenix.", new: ["Lists sync with your calendar accounts."] };
        const minor = { version: "2.1.0", date: "2026-11-02", summary: "Reminders for tasks with a due time.",
                        new: ["Set a reminder on any task with a due time."], fixed: ["A task moved to another list no longer shows in both."] };
        const pkg = (version: string, versions: Any[]) => servers.webApp("com.example.tasks", version, { files: [{
            path: "usr/palm/applications/com.example.tasks/changelog.json",
            data: JSON.stringify({ format: 1, unreleased: { new: ["Subtasks under any task."] }, versions }) }] });
        const publish = async (bytes: Uint8Array) => {
            const up = await catalog.api("POST", "/api/apps/packages", bytes, dev.token);
            expect(up.status).toBe(200);
            await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        };
        await publish(await pkg("2.0.0", [rebuild]));
        const { service } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const notes = (n: Any) => ({ improved: [], fixed: [], known: [], ...n });
        const { rebuild: _r, replaces: _p, ...rebuildNotes } = rebuild;
        const listed = (await service.browse({ section: "apps" })).apps.find((a: Any) => a.id === "com.example.tasks");
        expect(listed.whatsNew).toEqual(notes(rebuildNotes));
        expect(listed.versionHistory).toBeUndefined();
        expect(listed.detail).toBeUndefined();
        const app = (await service.getApp({ sourceId: "phoenix", id: "com.example.tasks" })).app;
        expect(app.whatsNew).toEqual(notes(rebuildNotes));
        expect(app.versionHistory).toEqual([notes(rebuild)]);
        expect(JSON.stringify(app)).not.toContain("Subtasks");

        // Installed, then an update: Installed Apps shows what the update brings.
        await service.install({ sourceId: "phoenix", id: "com.example.tasks" });
        await publish(await pkg("2.1.0", [minor, rebuild]));
        await service.refresh({});
        const mine = (await service.listInstalled()).apps.find((a: Any) => a.id === "com.example.tasks");
        expect(mine).toMatchObject({ version: "2.0.0", update: "2.1.0", whatsNew: notes(minor) });
        expect((await service.getApp({ sourceId: "phoenix", id: "com.example.tasks" })).app.versionHistory).toEqual([notes(minor), notes(rebuild)]);

        // A detail that is not the one the index signed: no history, What's New as signed.
        const idx = JSON.parse(fs.readFileSync(catalog.indexFile, "utf8"));
        const detail = path.join(catalog.data, "public/v1/apps", path.basename(idx.apps.find((a: Any) => a.id === "com.example.tasks").detail.url));
        const keep = fs.readFileSync(detail);
        fs.writeFileSync(detail, keep.toString().replace("Set a reminder", "Pay to set a reminder"));
        const other = makeService(defaults()).service;
        await other.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const forged = (await other.getApp({ sourceId: "phoenix", id: "com.example.tasks" })).app;
        expect(forged.whatsNew).toEqual(notes(minor));
        expect(forged.versionHistory).toBeUndefined();
        fs.writeFileSync(detail, keep);

        // An app without a log has neither.
        const plain = (await service.browse({ section: "apps" })).apps.find((a: Any) => a.id === "com.example.notes");
        expect(plain === undefined || (plain.whatsNew === undefined && plain.versionHistory === undefined)).toBe(true);
    });

    it("installs a newer version of a built-in app in its place, and removing it brings the built-in one back", async () => {
        const dev = await catalog.api("POST", "/api/accounts", { name: "Cal", email: "cal@example.com", role: "developer" });
        for (const [id, v] of [["com.example.calc", "2.0.0"], ["com.example.clock", "1.0.0"]]) {
            const up = await catalog.api("POST", "/api/apps/packages", await servers.webApp(id, v), dev.token);
            await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        }
        const { service, world } = makeService(defaults());
        world.builtins = { "com.example.calc": "1.5.0", "com.example.clock": "1.0.0" };
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const listed = (await service.browse({ section: "apps" })).apps;
        expect(listed.find((a: Any) => a.id === "com.example.calc")).toMatchObject({ builtin: { version: "1.5.0", replaced: false }, update: "2.0.0", installed: null });
        expect(listed.find((a: Any) => a.id === "com.example.clock")).toMatchObject({ builtin: { version: "1.0.0", replaced: false }, update: null });

        // Not newer than the built-in app: refused before anything is downloaded.
        expect(await service.install({ sourceId: "phoenix", id: "com.example.clock" })).toMatchObject({ returnValue: false, errorCode: "UNSUPPORTED" });
        expect(world.installs.some((i: Any) => i.id === "com.example.clock")).toBe(false);

        // Newer: it takes the built-in app's place.
        expect(await service.install({ sourceId: "phoenix", id: "com.example.calc" })).toMatchObject({ returnValue: true, appId: "com.example.calc" });
        expect((await service.getApp({ sourceId: "phoenix", id: "com.example.calc" })).app)
            .toMatchObject({ installed: { version: "2.0.0" }, update: null, builtin: { version: "1.5.0", replaced: true } });
        expect((await service.listInstalled()).apps).toEqual([expect.objectContaining({ id: "com.example.calc", version: "2.0.0", builtin: "1.5.0" })]);

        // Removed: the built-in one is back, and the Marketplace offers the update again.
        expect(await service.remove({ id: "com.example.calc" })).toMatchObject({ returnValue: true, builtin: "1.5.0" });
        expect((await service.listInstalled()).apps).toEqual([]);
        expect((await service.getApp({ sourceId: "phoenix", id: "com.example.calc" })).app)
            .toMatchObject({ installed: null, update: "2.0.0", builtin: { version: "1.5.0", replaced: false } });

        // Removed in the launcher (the built-in one back): forgotten here too.
        await service.install({ sourceId: "phoenix", id: "com.example.calc" });
        delete world.installed["com.example.calc"];
        expect((await service.listInstalled()).apps).toEqual([]);
    });

    // The publisher rules (packagesservice.js "Who may update an installed
    // app"): a catalog's package never replaces another publisher's app.
    it("never replaces another publisher's app: a developer's sideload, one put there another way, a built-in app from a catalog the user added", async () => {
        const dev = await catalog.api("POST", "/api/accounts", { name: "Pat", email: "pat@example.com", role: "developer" });
        for (const [id, v] of [["com.example.ledger", "1.0.0"], ["com.example.atlas", "1.0.0"], ["com.example.dial", "3.0.0"]]) {
            const up = await catalog.api("POST", "/api/apps/packages", await servers.webApp(id, v), dev.token);
            await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        }
        const spool = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-sideload-"));
        const sideload = { read: (n: string) => new Uint8Array(fs.readFileSync(path.join(spool, n))), remove: (n: string) => fs.rmSync(path.join(spool, n), { force: true }) };
        const { service, world } = makeService(defaults(), undefined, { sideload });
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        // A developer's sideload of com.example.ledger (nova install): the catalog's is another publisher's.
        world.devMode = true;
        fs.writeFileSync(path.join(spool, "a.ipk"), await servers.webApp("com.example.ledger", "0.9.0"));
        expect(await service.sideload({ file: "a.ipk", signer: "ed25519:DEV" })).toMatchObject({ returnValue: true, appId: "com.example.ledger" });
        const other = await service.install({ sourceId: "phoenix", id: "com.example.ledger" });
        expect(other).toMatchObject({ returnValue: false, errorCode: "OTHER_PUBLISHER", errorText: "This app is already installed from another publisher; remove it first" });
        expect(world.installs.filter((i: Any) => i.id === "com.example.ledger")).toHaveLength(1);
        // Removed, the catalog's installs.
        expect(await service.remove({ id: "com.example.ledger" })).toMatchObject({ returnValue: true });
        expect(await service.install({ sourceId: "phoenix", id: "com.example.ledger" })).toMatchObject({ returnValue: true, appId: "com.example.ledger" });
        // ... and a sideload no longer replaces it.
        fs.writeFileSync(path.join(spool, "b.ipk"), await servers.webApp("com.example.ledger", "2.0.0"));
        expect(await service.sideload({ file: "b.ipk", signer: "ed25519:DEV" })).toMatchObject({ returnValue: false, errorCode: "OTHER_PUBLISHER" });
        expect(world.installs.at(-1).pkg.control.Version).toBe("1.0.0");

        // An app on the device the Marketplace did not install (put there another way): not replaced.
        world.installed["com.example.atlas"] = {};
        expect(await service.install({ sourceId: "phoenix", id: "com.example.atlas" })).toMatchObject({ returnValue: false, errorCode: "OTHER_PUBLISHER" });
        expect(world.installs.some((i: Any) => i.id === "com.example.atlas")).toBe(false);

        // A built-in app from a catalog the user added (not one the device ships with): offered as nothing, refused.
        const added = makeService([], undefined, { sideload });
        added.world.builtins = { "com.example.dial": "2.0.0" };
        await added.service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const src = (await added.service.getSources()).sources[0];
        expect(src).toMatchObject({ builtin: false });
        const entry = (await added.service.getApp({ sourceId: src.id, id: "com.example.dial" })).app;
        expect(entry).toMatchObject({ update: null, verdict: { ok: false, text: "com.example.dial is built into this device and can't be replaced" } });
        expect(await added.service.install({ sourceId: src.id, id: "com.example.dial" })).toMatchObject({ returnValue: false, errorCode: "BUILT_IN" });
        expect(added.world.installs).toHaveLength(0);
    });

    it("keeps an app with the catalog it came from: an update signed with another key the user trusted since is another publisher's", async () => {
        const dev = await catalog.api("POST", "/api/accounts", { name: "Kim", email: "kim@example.com", role: "developer" });
        const up = await catalog.api("POST", "/api/apps/packages", await servers.webApp("com.example.tally", "1.0.0"), dev.token);
        await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        expect(await service.install({ sourceId: "phoenix", id: "com.example.tally" })).toMatchObject({ returnValue: true });
        expect(world.state.installed["com.example.tally"].signer).toBe(catalog.key);
        // The record says another key signed it (the source re-keyed by the user since).
        world.state.installed["com.example.tally"].signer = "OLDKEY";
        expect(await service.install({ sourceId: "phoenix", id: "com.example.tally" })).toMatchObject({ returnValue: false, errorCode: "OTHER_PUBLISHER" });
        // A record from before signers were kept: its catalog's still.
        delete world.state.installed["com.example.tally"].signer;
        expect(await service.install({ sourceId: "phoenix", id: "com.example.tally" })).toMatchObject({ returnValue: true });
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
        expect(all.map((a: Any) => [a.id, a.version])).toEqual([["org.example.homebrew", "0.9.1"], ["org.example.nativelib", "1.0"], ["org.example.hooked", "2.0"],
                                                                ["org.example.feeds", "0.1.0"], ["org.example.signin", "1.0.0"], ["org.example.borrowed", "1.0.0"]]);
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

    it("installs a Synergy connector only in Developer Mode (docs/SYNERGY-CONNECTORS.md section 5)", async () => {
        const { service, world } = makeService(defaults());
        await service.setSource({ id: "precentral", enabled: true });
        await service.refresh({ id: "precentral" });
        const refused = await service.install({ sourceId: "precentral", id: "org.example.feeds" });
        expect(refused).toMatchObject({ errorCode: "NEEDS_DEVMODE" });
        expect(refused.errorText).toMatch(/Synergy connector.*Developer Mode/);
        world.devMode = true;
        expect(await service.install({ sourceId: "precentral", id: "org.example.feeds" })).toMatchObject({ returnValue: true, appId: "org.example.feeds" });
        expect(world.installs.at(-1)).toMatchObject({ id: "org.example.feeds", developerMode: true });
    });

    // Rule C17 on the device (packagesservice.js "Sign-in pages"): a sign-in
    // page of its own runs in Accounts' frame with Accounts' groups, so only
    // Phoenix's own packages, from a Phoenix catalog the device ships with,
    // may have one; and the page must be the package's own app (C7).
    it("refuses a third party's package with a sign-in page of its own, in Developer Mode too, before the installer sees it", async () => {
        const { service, world } = makeService(defaults());
        await service.setSource({ id: "precentral", enabled: true });
        await service.refresh({ id: "precentral" });
        const refused = await service.install({ sourceId: "precentral", id: "org.example.signin" });
        expect(refused).toMatchObject({ returnValue: false, errorCode: "THIRD_PARTY_SIGNIN",
            errorText: "Custom sign-in pages from third-party connectors aren't supported yet; use the connector kit's standard sign-in" });
        world.devMode = true;
        expect(await service.install({ sourceId: "precentral", id: "org.example.signin" })).toMatchObject({ errorCode: "THIRD_PARTY_SIGNIN" });
        const borrowed = await service.install({ sourceId: "precentral", id: "org.example.borrowed" });
        expect(borrowed).toMatchObject({ errorCode: "BAD_PACKAGE" });
        expect(borrowed.errorText).toMatch(/must be the package's own app, org\.example\.borrowed/);
        expect(world.installs).toHaveLength(0);
        expect((await service.listInstalled()).apps).toEqual([]);
    });

    it("installs Phoenix's own connector with its sign-in page from the Phoenix catalog, and Accounts may frame it", async () => {
        // Jabber (apps/connectors/xmpp): Phoenix's, its own sign-in page, uploaded by an admin (Phoenix's namespaces).
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-xmpp-"));
        const packed = pack(path.resolve(__dirname, "../../connectors/xmpp"), out, { vendor: false, writeAppinfo: false,
                                                                                     namespaces: ["org.webosphoenix", "com.webosphoenix"] });
        const up = await catalog.api("POST", "/api/apps/packages", new Uint8Array(fs.readFileSync(packed.file)), catalog.admin);
        expect(up).toMatchObject({ status: 200, app: { kind: "connector" } });
        if (up.release.state !== "published") await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        const firstParty = [{ id: "org.webosphoenix.xmpp", sourceId: "phoenix", templates: ["com.webosphoenix.xmpp"] }];
        const { service, world } = makeService([{ ...defaults()[0], key: catalog.key, builtin: true }], undefined, { firstParty: () => firstParty });
        await service.refresh({});
        expect(await service.install({ sourceId: "phoenix", id: "org.webosphoenix.xmpp" })).toMatchObject({ returnValue: true, appId: "org.webosphoenix.xmpp" });
        expect(world.installs.at(-1)).toMatchObject({ id: "org.webosphoenix.xmpp", developerMode: false, firstParty: true });
        expect(world.state.installed["org.webosphoenix.xmpp"].signIn).toEqual(["com.webosphoenix.xmpp"]);
        expect(await service.checkSignInPage({ appId: "org.webosphoenix.xmpp", templateId: "com.webosphoenix.xmpp" })).toMatchObject({ allowed: true });
        // The same package from a catalog the user added: not Phoenix's own there.
        const other = makeService([{ ...defaults()[0], key: catalog.key }], undefined, { firstParty: () => firstParty });
        await other.service.removeSource({ id: "phoenix" });
        await other.service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        other.world.devMode = true;
        const added = (await other.service.getSources()).sources.find((x: Any) => x.url === catalog.catalogUrl);
        expect(await other.service.install({ sourceId: added.id, id: "org.webosphoenix.xmpp" })).toMatchObject({ errorCode: "THIRD_PARTY_SIGNIN" });
        fs.rmSync(out, { recursive: true, force: true });
    });

    // ---- Connector packages in the catalog (docs/SYNERGY-CONNECTORS.md C4) ----

    it("trusts a catalog whose key the device's sources give (the simulator's own local catalog) without asking", async () => {
        // Read once without a key (the simulator before its catalog ran), then given one: taken, and its fingerprint shown.
        const sources = defaults();
        const { service, world } = makeService(sources);
        expect((await service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ errorCode: "UNTRUSTED" });
        sources[0] = { ...sources[0], key: catalog.key };
        expect((await service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ ok: true });
        expect((await service.getSources()).sources[0]).toMatchObject({ trusted: true, fingerprint: catalog.fingerprint, error: null });
        // A key the user checked is not replaced by another the sources give.
        world.state.sources[0].keyFromDevice = false;
        sources[0] = { ...sources[0], key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
        expect((await service.refresh({ id: "phoenix" })).results[0]).toMatchObject({ ok: true });
    });

    // The Marketplace reads the catalogs each time it opens (and again when
    // the simulator's catalog starts): an install, a kind hidden or a catalog
    // turned off while the catalogs are read stays, and what was read is
    // taken (tools/test-connectors.cjs once found its Install button back
    // after the connector was installed: the refresh had written back the
    // state it read before the install).
    it("keeps what changes while the catalogs are read: an install that ends meanwhile stays installed", async () => {
        const { service, world } = makeService([...defaults(), { id: "other", name: "Other", kind: "preware", url: feed.feedUrl, enabled: true }]);
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const before = (await service.getSources()).sources.find((x: Any) => x.id === "phoenix").refreshed;
        let letGo = () => {};
        world.holdIndex = new Promise<void>((r) => { letGo = r; });
        const refreshing = service.refresh({});
        for (let i = 0; i < 200 && !world.held; i++) await new Promise((r) => setTimeout(r, 10));
        expect(world.held).toBe(true);
        expect(await service.install({ sourceId: "phoenix", id: "org.webosphoenix.pwa.tides" })).toMatchObject({ returnValue: true, state: "installed" });
        await service.setKind({ kind: "legacy", enabled: false });
        await service.setSource({ id: "other", enabled: false });
        letGo();
        const r = await refreshing;
        expect(r.results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: true });
        expect((await service.listInstalled()).apps.map((a: Any) => a.id)).toEqual(["org.webosphoenix.pwa.tides"]);
        expect((await service.getAvailability()).kinds.find((k: Any) => k.id === "legacy")).toMatchObject({ hidden: true });
        const sources = (await service.getSources()).sources;
        expect(sources.find((x: Any) => x.id === "other")).toMatchObject({ enabled: false });
        // What the refresh read is kept.
        expect(sources.find((x: Any) => x.id === "phoenix").refreshed).not.toBe(before);
        expect((await service.browse({ section: "web", category: "Travel" })).apps.map((a: Any) => a.id)).toContain("org.webosphoenix.pwa.tides");
    });

    it("installs a connector from the catalog in Developer Mode only, checked against the signed SHA-256", async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-feeds-"));
        const packed = pack(path.resolve(__dirname, "../../shared/connector-kit/examples/feeds"), out, { vendor: false });
        const dev = await catalog.api("POST", "/api/accounts", { name: "Fay", email: "fay@example.com", role: "developer" });
        const up = await catalog.api("POST", "/api/apps/packages", new Uint8Array(fs.readFileSync(packed.file)), dev.token);
        expect(up).toMatchObject({ status: 200, app: { kind: "connector" }, release: { state: "pending" } });
        await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        const { service, world } = makeService([{ ...defaults()[0], key: catalog.key }]);
        await service.refresh({});
        const types = (await service.listAccountTypes({ capability: "FEEDS" })).accountTypes;
        expect(types).toEqual([expect.objectContaining({ templateId: "org.example.feeds", sourceId: "phoenix",
                                                          package: { id: "org.example.feeds", builtin: false, preinstalled: false } })]);
        // Not an app of the Apps section: Connections installs it.
        expect((await service.browse({ section: "apps" })).apps.map((a: Any) => a.id)).not.toContain("org.example.feeds");
        expect((await service.getApp({ sourceId: "phoenix", id: "org.example.feeds" })).app).toMatchObject({ kind: "connector", installed: null });
        const refused = await service.install({ sourceId: "phoenix", id: "org.example.feeds" });
        expect(refused).toMatchObject({ errorCode: "NEEDS_DEVMODE" });
        expect(world.installs).toHaveLength(0);
        world.devMode = true;
        expect(await service.install({ sourceId: "phoenix", id: "org.example.feeds" })).toMatchObject({ returnValue: true, appId: "org.example.feeds" });
        expect(world.installs.at(-1)).toMatchObject({ id: "org.example.feeds", developerMode: true, firstParty: false });
        expect((await service.listInstalled()).apps).toEqual([expect.objectContaining({ id: "org.example.feeds", kind: "connector", version: "0.1.0" })]);
        fs.rmSync(out, { recursive: true, force: true });
    });

    it("a connector the device came with: installed from its catalog, removable, installed again without Developer Mode", async () => {
        // The device came with FEEDS (as Phoenix comes with the Fediverse): in the image, among the installed apps.
        const pre = [{ id: "org.example.feeds", sourceId: "phoenix", version: "0.1.0", title: "News Feed (example)" }];
        const { service, world } = makeService([{ ...defaults()[0], key: catalog.key, builtin: true }], pre);
        world.installed["org.example.feeds"] = {};
        await service.refresh({});
        expect((await service.listInstalled()).apps).toEqual([expect.objectContaining({ id: "org.example.feeds", sourceId: "phoenix", kind: "connector" })]);
        expect(await service.remove({ id: "org.example.feeds" })).toMatchObject({ returnValue: true });
        // Removed, it stays removed.
        expect((await service.listInstalled()).apps).toEqual([]);
        const r = await service.install({ sourceId: "phoenix", id: "org.example.feeds" });
        expect(r).toMatchObject({ returnValue: true, appId: "org.example.feeds" });
        expect(world.installs.at(-1)).toMatchObject({ id: "org.example.feeds", developerMode: false, firstParty: true });
        // The same package from a catalog the user added is a third party's: Developer Mode.
        const other = makeService([{ ...defaults()[0], key: catalog.key }], pre);
        await other.service.removeSource({ id: "phoenix" });
        await other.service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        const added = (await other.service.getSources()).sources.find((x: Any) => x.url === catalog.catalogUrl);
        expect(await other.service.install({ sourceId: added.id, id: "org.example.feeds" })).toMatchObject({ errorCode: "NEEDS_DEVMODE" });
    });

    it("offers each device what is on for its class, says why the rest is not, and hides the kinds the user hides (docs/APP-STORE.md 3.17)", async () => {
        const dev = await catalog.api("POST", "/api/accounts", { name: "Tess", email: "tess@example.com", role: "developer" });
        // A package made for tablets and desktops (appinfo.json phoenix.deviceClasses).
        const up = await catalog.api("POST", "/api/apps/packages", await servers.webApp("com.example.sketchpad", "1.0.0",
            { title: "Sketchpad", appinfo: { phoenix: { deviceClasses: ["tablet", "desktop"] } } }), dev.token);
        await catalog.api("POST", `/api/admin/releases/${up.release.id}/approve`, {}, catalog.admin);
        const { service, world } = makeService(defaults());
        await service.trustSource({ url: catalog.catalogUrl, key: catalog.key });
        await service.setSource({ id: "appmuseum", enabled: true });
        const ids = async (section: string) => (await service.browse({ section })).apps.map((a: Any) => a.id);

        world.formFactor = "tablet";
        const onTablet = (await service.browse({ section: "apps" })).apps.find((a: Any) => a.id === "com.example.sketchpad");
        expect(onTablet).toMatchObject({ appKind: "web", deviceClasses: ["tablet", "desktop"] });
        expect(onTablet.offHere).toBeUndefined();
        // The App Museum's own flags: Mojo Clock was for the Pre 3 only, a phone.
        expect(await ids("classics")).toEqual(["appmuseum.9001", "appmuseum.9003"]);

        world.formFactor = "phone";
        expect(await ids("apps")).not.toContain("com.example.sketchpad");
        expect((await service.search({ query: "sketchpad" })).apps).toEqual([]);
        expect(await ids("classics")).toEqual(["appmuseum.9001", "appmuseum.9002", "appmuseum.9003"]);
        expect((await service.getApp({ sourceId: "phoenix", id: "com.example.sketchpad" })).app.offHere)
            .toEqual({ reason: "app", text: "Not offered on phones: made for tablets and desktops" });
        expect(await service.install({ sourceId: "phoenix", id: "com.example.sketchpad" }))
            .toMatchObject({ returnValue: false, errorCode: "OFF_HERE", errorText: "Not offered on phones: made for tablets and desktops" });

        // The catalog's admin switches classic webOS apps off on phones: the App Museum's, every feed's.
        await catalog.api("POST", "/api/admin/availability", { off: { kinds: { legacy: ["phone"] } } }, catalog.admin);
        await service.refresh({});
        const classics = await service.browse({ section: "classics" });
        expect(classics.apps).toEqual([]);
        expect(classics.offHere).toEqual({ reason: "kind", text: "The Marketplace does not offer classic webOS apps on phones" });
        expect((await service.search({ query: "mojo clock" })).apps).toEqual([]);
        const onPhone = await service.getAvailability();
        expect(onPhone).toMatchObject({ deviceClass: "phone" });
        expect(onPhone.kinds.find((k: Any) => k.id === "legacy")).toMatchObject({ name: "Classic webOS apps", hidden: false, offByCatalog: true });
        expect(onPhone.deviceClasses.map((c: Any) => c.id)).toEqual(["phone", "tablet", "desktop"]);
        world.formFactor = "tablet";
        expect(await ids("classics")).toEqual(["appmuseum.9001", "appmuseum.9003"]);

        // Installed on the tablet, then the device is a phone: it stays, its page and Installed Apps say why it is not offered.
        expect(await service.install({ sourceId: "phoenix", id: "com.example.sketchpad" })).toMatchObject({ returnValue: true });
        world.formFactor = "phone";
        expect((await service.listInstalled()).apps.find((a: Any) => a.id === "com.example.sketchpad"))
            .toMatchObject({ appKind: "web", offHere: { reason: "app" } });
        expect((await service.getApp({ sourceId: "phoenix", id: "com.example.sketchpad" })).app)
            .toMatchObject({ installed: { version: "1.0.0" }, offHere: { reason: "app" } });

        // The user hides web apps on this device.
        const hidden = await service.setKind({ kind: "web", enabled: false });
        expect(hidden.kinds.find((k: Any) => k.id === "web")).toMatchObject({ hidden: true });
        expect(await ids("web")).toEqual([]);
        expect((await service.getApp({ sourceId: "phoenix", id: "org.webosphoenix.pwa.tides" })).app.offHere)
            .toEqual({ reason: "hidden", text: "You hid web apps on this device (Catalogs > Kinds of Apps)" });
        expect((await service.setKind({ kind: "android", enabled: false }))).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
        await service.setKind({ kind: "web", enabled: true });
        expect((await service.search({ query: "tide tables" })).apps.map((a: Any) => a.id)).toEqual(["org.webosphoenix.pwa.tides"]);
        // A device that has not said its class yet is offered everything.
        world.formFactor = "";
        expect(await ids("apps")).toContain("com.example.sketchpad");
        await catalog.api("POST", "/api/admin/availability", { off: {} }, catalog.admin);
    });
});

// ---- Sideloads: nova install (packagesservice.js sideload, "Who may update an installed app") ----
//
// novad writes a paired computer's package to the sideload folder and names
// it with that computer's key (signer). Android's and iOS's rule: an update
// only from the installed app's own key; a built-in app never.
describe("a developer's sideload (nova install)", () => {
    const phoenix = { id: "phoenix", name: "Phoenix Marketplace", kind: "phoenix", url: "https://catalog.example/v1/", key: "KEY", enabled: true };
    function device() {
        const spool = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-sideload-"));
        const sideload = { read: (n: string) => new Uint8Array(fs.readFileSync(path.join(spool, n))), remove: (n: string) => fs.rmSync(path.join(spool, n), { force: true }) };
        const made = makeService([phoenix], undefined, { sideload });
        made.world.devMode = true;
        // The image's apps (not removable).
        made.world.builtins = { "org.webosphoenix.email": "4.0.0", "com.example.calc": "1.5.0" };
        let n = 0;
        const put = async (id: string, v: string, extra?: Any) => {
            const name = "p" + (++n) + ".ipk";
            fs.writeFileSync(path.join(spool, name), await servers.webApp(id, v, extra));
            return name;
        };
        return { ...made, put, spool };
    }
    const A = "ed25519:AAAA", B = "ed25519:BBBB";

    it("installs a new app in Developer Mode, and the same key's update", async () => {
        const { service, world, put, spool } = device();
        const file = await put("com.example.mine", "1.0.0");
        expect(await service.sideload({ file, signer: A, signerName: "Dana's Mac" })).toEqual({ returnValue: true, appId: "com.example.mine", version: "1.0.0" });
        expect(world.installs.at(-1)).toMatchObject({ id: "com.example.mine", developerMode: false });
        expect(world.state.sideloaded["com.example.mine"]).toMatchObject({ signer: A, signerName: "Dana's Mac", version: "1.0.0" });
        // The folder's copy is gone once read.
        expect(fs.readdirSync(spool)).toEqual([]);
        expect(await service.sideload({ file: await put("com.example.mine", "1.1.0"), signer: A })).toMatchObject({ returnValue: true, version: "1.1.0" });
        expect(world.installs.at(-1).pkg.control.Version).toBe("1.1.0");
        // A package with install scripts: Developer Mode's installer path.
        expect(await service.sideload({ file: await put("com.example.hooks", "1.0.0", { scripts: { postinst: "#!/bin/sh\n" } }), signer: A }))
            .toMatchObject({ returnValue: true });
        expect(world.installs.at(-1)).toMatchObject({ id: "com.example.hooks", developerMode: true });
    });

    it("refuses an update from another key, and says to remove the app first", async () => {
        const { service, world, put } = device();
        await service.sideload({ file: await put("com.example.mine", "1.0.0"), signer: A });
        const r = await service.sideload({ file: await put("com.example.mine", "9.0.0"), signer: B });
        expect(r).toEqual({ returnValue: false, errorCode: "OTHER_PUBLISHER", errorText: "This app is already installed from another publisher; remove it first",
                            appId: "com.example.mine" });
        expect(world.installs.map((i: Any) => i.pkg.control.Version)).toEqual(["1.0.0"]);
        // Removed, the other key's installs.
        expect(await service.remove({ id: "com.example.mine" })).toMatchObject({ returnValue: true });
        expect(await service.sideload({ file: await put("com.example.mine", "9.0.0"), signer: B })).toMatchObject({ returnValue: true });
    });

    it("never replaces a built-in app, or an installed update of one", async () => {
        const { service, world, put } = device();
        for (const id of ["org.webosphoenix.email", "com.example.calc"]) {
            expect(await service.sideload({ file: await put(id, "99.0.0"), signer: A }))
                .toMatchObject({ returnValue: false, errorCode: "BUILT_IN", errorText: id + " is built into this device and can't be replaced" });
        }
        // The Marketplace's update of a built-in app (its record says so): still the image's app.
        world.installed["com.example.calc"] = {};
        world.state = Object.assign(world.state || {}, { installed: { "com.example.calc": { sourceId: "phoenix", catalogId: "com.example.calc", kind: "ipk", version: "2.0.0", builtin: "1.5.0" } } });
        expect(await service.sideload({ file: await put("com.example.calc", "99.0.0"), signer: A })).toMatchObject({ returnValue: false, errorCode: "BUILT_IN" });
        expect(world.installs).toHaveLength(0);
    });

    it("never replaces an app from a catalog, or one put on the device another way", async () => {
        const { service, world, put } = device();
        world.installed["com.example.notes"] = {};
        world.state = { installed: { "com.example.notes": { sourceId: "phoenix", catalogId: "com.example.notes", kind: "ipk", version: "1.0.0" } } };
        expect(await service.sideload({ file: await put("com.example.notes", "2.0.0"), signer: A })).toMatchObject({ returnValue: false, errorCode: "OTHER_PUBLISHER" });
        world.installed["com.example.other"] = {};
        expect(await service.sideload({ file: await put("com.example.other", "2.0.0"), signer: A })).toMatchObject({ returnValue: false, errorCode: "OTHER_PUBLISHER" });
        expect(world.installs).toHaveLength(0);
    });

    it("needs Developer Mode, a file in the folder and a signer; the catalogs' checks still apply", async () => {
        const { service, world, put } = device();
        world.devMode = false;
        expect(await service.sideload({ file: await put("com.example.mine", "1.0.0"), signer: A })).toMatchObject({ returnValue: false, errorCode: "NEEDS_DEVMODE" });
        world.devMode = true;
        expect(await service.sideload({ file: "../state.json", signer: A })).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
        expect(await service.sideload({ file: await put("com.example.mine", "1.0.0") })).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
        // A native app, as from a catalog.
        expect(await service.sideload({ file: await put("com.example.native", "1.0.0", { type: "native" }), signer: A })).toMatchObject({ returnValue: false, errorCode: "UNSUPPORTED" });
        // Its own sign-in page: C17, Developer Mode or not.
        const page = { path: "usr/palm/applications/com.example.chat/public/accounts/com.example.chat/com.example.chat.json",
                       data: JSON.stringify({ templateId: "com.example.chat", validator: { address: "palm://com.example.chat.service/check",
                                                                                          customUI: { appId: "com.example.chat", name: "signin.html" } } }) };
        expect(await service.sideload({ file: await put("com.example.chat", "1.0.0", { files: [page] }), signer: A })).toMatchObject({ returnValue: false, errorCode: "THIRD_PARTY_SIGNIN" });
        expect(world.installs).toHaveLength(0);
        // Not wired (the simulator): not available.
        const bare = makeService([phoenix]);
        expect(await bare.service.sideload({ file: "x.ipk", signer: A })).toMatchObject({ returnValue: false, errorCode: "UNSUPPORTED" });
    });
});

// ---- Sign-in pages: rule C17 on the device (packagesservice.js "Sign-in pages") ----
//
// The accounts library asks checkSignInPage before it frames a template's own
// sign-in page (compat lib/accounts/source/cross-app.js), so a package that
// never went through a catalog (a Developer Mode sideload, nova install) is
// refused too.
describe("a template's own sign-in page (checkSignInPage)", () => {
    const C17 = "Custom sign-in pages from third-party connectors aren't supported yet; use the connector kit's standard sign-in";
    const phoenix = { id: "phoenix", name: "Phoenix Marketplace", kind: "phoenix", url: "https://catalog.example/v1/", key: "KEY", enabled: true };
    const system = [{ templateId: "com.webosphoenix.dav", appId: "org.webosphoenix.dav" },
                    { templateId: "com.webosphoenix.webcal", appId: "org.webosphoenix.dav" },
                    { templateId: "com.palm.imap", appId: null }];
    const pre = [{ id: "org.webosphoenix.fediverse", sourceId: "phoenix", version: "1.0.0", templates: ["com.webosphoenix.fediverse"] }];
    const firstParty = [{ id: "org.webosphoenix.matrix", sourceId: "phoenix", templates: ["com.webosphoenix.matrix"] }];
    function device(sources: Any[] = [phoenix]) {
        const made = makeService(sources, pre, { systemTemplates: () => system, firstParty: () => firstParty });
        // The image's apps (not removable) and the connector it came with.
        made.world.builtins = { "org.webosphoenix.dav": "1.0.0", "com.palm.app.email": "4.0.0" };
        made.world.installed["org.webosphoenix.fediverse"] = {};
        return made;
    }
    const ask = (service: Any, appId: string, templateId: string) => service.checkSignInPage({ appId, templateId });

    it("frames the image's own pages: a built-in app with its template in the image", async () => {
        const { service } = device();
        expect(await ask(service, "org.webosphoenix.dav", "com.webosphoenix.dav")).toEqual(
            { returnValue: true, appId: "org.webosphoenix.dav", templateId: "com.webosphoenix.dav", allowed: true });
        expect(await ask(service, "org.webosphoenix.dav", "com.webosphoenix.webcal")).toMatchObject({ allowed: true });
    });

    it("frames a connector the image came with (preinstalled.json), for the templates it lists", async () => {
        const { service } = device();
        expect(await ask(service, "org.webosphoenix.fediverse", "com.webosphoenix.fediverse")).toMatchObject({ allowed: true });
        // Not one of its templates (another package's, naming its page): refused.
        expect(await ask(service, "org.webosphoenix.fediverse", "org.example.lure")).toMatchObject({ allowed: false, reason: "template", errorText: C17 });
    });

    it("refuses a sideloaded third party's page (installed outside the Marketplace), with C17's words", async () => {
        const { service, world } = device();
        world.installed["org.example.chat"] = {};
        expect(await ask(service, "org.example.chat", "org.example.chat")).toEqual(
            { returnValue: true, appId: "org.example.chat", templateId: "org.example.chat", allowed: false, reason: "app", errorText: C17 });
    });

    it("refuses a third party's template that names a built-in app's page (C7), and a template the image has not", async () => {
        const { service } = device();
        expect(await ask(service, "org.webosphoenix.dav", "org.example.lure")).toMatchObject({ allowed: false, reason: "template" });
        // The image's template with another app's page in it: not the image's pair.
        expect(await ask(service, "com.palm.app.email", "com.webosphoenix.dav")).toMatchObject({ allowed: false, reason: "template" });
    });

    it("refuses a sideloaded app with Phoenix's id that the Marketplace did not install (preinstalled.json firstParty is not enough)", async () => {
        const { service, world } = device();
        world.installed["org.webosphoenix.matrix"] = {};
        expect(await ask(service, "org.webosphoenix.matrix", "com.webosphoenix.matrix")).toMatchObject({ allowed: false, reason: "app" });
    });

    it("frames Phoenix's own package installed from a Phoenix catalog the device ships with, for its templates", async () => {
        const { service, world } = device();
        world.installed["org.webosphoenix.matrix"] = {};
        world.installed["org.webosphoenix.drives"] = {};
        world.state = { installed: {
            "org.webosphoenix.matrix": { sourceId: "phoenix", catalogId: "org.webosphoenix.matrix", kind: "connector", version: "1.0.0" },
            "org.webosphoenix.drives": { sourceId: "phoenix", catalogId: "org.webosphoenix.drives", kind: "connector", version: "1.0.0",
                                         signIn: ["com.webosphoenix.drive.webdav"] } } };
        // preinstalled.json's list (a record from before templates were recorded) or the templates recorded at install.
        expect(await ask(service, "org.webosphoenix.matrix", "com.webosphoenix.matrix")).toMatchObject({ allowed: true });
        expect(await ask(service, "org.webosphoenix.drives", "com.webosphoenix.drive.webdav")).toMatchObject({ allowed: true });
        expect(await ask(service, "org.webosphoenix.drives", "com.webosphoenix.drive.mega")).toMatchObject({ allowed: false, reason: "template" });
    });

    it("refuses an install from a catalog the user added, and from a Phoenix catalog whose key nobody checked", async () => {
        const added = device([phoenix, { id: "mine", name: "Mine", kind: "phoenix", url: "https://mine.example/", key: "MINE", enabled: true }]);
        added.world.installed["org.webosphoenix.matrix"] = {};
        added.world.state = { sources: [{ id: "mine", name: "Mine", kind: "phoenix", url: "https://mine.example/", key: "MINE", enabled: true, builtin: false }],
                              installed: { "org.webosphoenix.matrix": { sourceId: "mine", kind: "connector", signIn: ["com.webosphoenix.matrix"] } } };
        expect(await ask(added.service, "org.webosphoenix.matrix", "com.webosphoenix.matrix")).toMatchObject({ allowed: false, reason: "app" });
        const unkeyed = device([{ ...phoenix, key: null }]);
        unkeyed.world.installed["org.webosphoenix.matrix"] = {};
        unkeyed.world.state = { installed: { "org.webosphoenix.matrix": { sourceId: "phoenix", kind: "connector", signIn: ["com.webosphoenix.matrix"] } } };
        expect(await ask(unkeyed.service, "org.webosphoenix.matrix", "com.webosphoenix.matrix")).toMatchObject({ allowed: false, reason: "app" });
        // A third party's id from Phoenix's own catalog: not Phoenix's namespace.
        const theirs = device();
        theirs.world.installed["org.example.feeds"] = {};
        theirs.world.state = { installed: { "org.example.feeds": { sourceId: "phoenix", kind: "connector", signIn: ["org.example.feeds"] } } };
        expect(await ask(theirs.service, "org.example.feeds", "org.example.feeds")).toMatchObject({ allowed: false, reason: "app" });
    });

    it("forgets a record once its app is gone, so a later sideload of that id is refused", async () => {
        const { service, world } = device();
        world.state = { installed: { "org.webosphoenix.matrix": { sourceId: "phoenix", kind: "connector", signIn: ["com.webosphoenix.matrix"] } } };
        // Removed from the launcher (not the Marketplace): the next check forgets it.
        expect(await ask(service, "org.webosphoenix.matrix", "com.webosphoenix.matrix")).toMatchObject({ allowed: false, reason: "app" });
        world.installed["org.webosphoenix.matrix"] = {};
        expect(await ask(service, "org.webosphoenix.matrix", "com.webosphoenix.matrix")).toMatchObject({ allowed: false, reason: "app" });
    });

    it("needs an app and a template", async () => {
        const { service } = device();
        expect(await service.checkSignInPage({ appId: "org.webosphoenix.dav" })).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
        expect(await service.checkSignInPage({})).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
    });
});
