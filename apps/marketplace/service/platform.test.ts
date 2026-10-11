// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Marketplace's service with the platform (docs/PLATFORM-CLIENT.md, "The
// app catalog"): the Phoenix catalog's address and keys from servers.json,
// the offline root's delegation and a key rotation, the signed revocation
// list (malware removed, other reasons warned, no reinstall), staged
// rollouts of app updates, and not set up. Against the mock platform
// (tools/platform-mock/server.cjs); OSE's installer is a fake.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createPackagesService } = require("./packagesservice.js") as Any;
const http = require("./lib/node-http.js") as Any;
const ipkLib = require("./lib/ipk.js") as Any;
const platform = require("@phoenix/platform") as Any;
const mockLib = require("../../../tools/platform-mock/server.cjs") as Any;

const gzip = { gzip: async (b: Uint8Array) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b: Uint8Array) => new Uint8Array(zlib.gunzipSync(b)) };
const ipk = ipkLib.createIpk({ gzip });
const SOURCES = JSON.parse(fs.readFileSync(path.join(__dirname, "etc/palm/marketplace/sources.json"), "utf8")).sources;

let mock: Any;
let pin: string;
let image: Any;

function makeService() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-mkt-"));
    const world = { state: null as Any, installed: {} as Record<string, Any>, toasts: [] as Any[], devMode: false, installs: [] as Any[] };
    const luna = {
        call: async (uri: string, params: Any) => {
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: world.devMode ? "enabled" : "disabled" };
            if (uri.endsWith("/listLaunchPoints")) return { returnValue: true, launchPoints: Object.keys(world.installed).map((id) => ({ id, launchPointId: id + "_default" })) };
            if (uri.endsWith("/listApps")) return { returnValue: true, apps: Object.keys(world.installed).map((id) => ({ id })) };
            if (uri.endsWith("/createToast")) { world.toasts.push(params); return { returnValue: true }; }
            return { returnValue: true };
        },
        subscribe: (uri: string, params: Any, onReply: (r: Any) => void) => {
            setTimeout(async () => {
                if (uri.endsWith("/install")) {
                    const pkg = await ipk.read(new Uint8Array(fs.readFileSync(params.ipkUrl)));
                    world.installs.push({ id: params.id, version: pkg.control.Version, developerMode: !!params.developerMode });
                    world.installed[params.id] = pkg;
                    onReply({ returnValue: true, id: params.id, statusValue: 30, details: { state: "installed" } });
                } else if (uri.endsWith("/remove")) {
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
            sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()),
            randomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)),
        },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o: Any) => { world.state = JSON.parse(JSON.stringify(o)); } },
        temp: { write: (name: string, bytes: Uint8Array) => { const f = path.join(temp, name); fs.writeFileSync(f, bytes); return f; }, remove: (f: string) => fs.rmSync(f, { force: true }) },
        defaultSources: () => SOURCES,
        servers: () => platform.load({ image: () => image ?? JSON.stringify(mock.servers(pin)), override: () => null, devMode: () => false }),
    });
    return { service, world };
}

let pkgs: Any;
beforeAll(async () => {
    mock = await mockLib.start({});
    pkgs = await mockLib.samplePackages(ipk);
});
afterAll(async () => { await mock.close(); });
beforeEach(() => {
    pin = "root";
    image = null;
    mock.publishRevocations({ apps: [] });
    mock.publishCatalog({ apps: [
        { id: "org.example.mockapp", kind: "ipk", title: "Mock App", version: "1.0.0", categories: ["Utilities"], package: Buffer.from(pkgs.app) },
        { id: "org.example.mockfeeds", kind: "connector", title: "Mock Feeds", version: "0.1.0", categories: ["News"], package: Buffer.from(pkgs.connector) },
    ] });
});

describe("the Phoenix catalog from servers.json", () => {
    it("is read with the root's delegation, without asking the user; a key rotation is followed", async () => {
        const { service } = makeService();
        const r = await service.refresh({});
        expect(r.results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: true });
        const src = (await service.getSources({})).sources.find((s: Any) => s.id === "phoenix");
        expect(src).toMatchObject({ url: mock.feeds + "catalog/v1/", trusted: true, pinned: true, insecure: false, notSetUp: false });
        expect((await service.browse({ section: "apps" })).apps.map((a: Any) => a.id)).toEqual(["org.example.mockapp"]);
        mock.rotate("catalog");
        mock.publishCatalog({ apps: [{ id: "org.example.mockapp", kind: "ipk", title: "Mock App", version: "1.0.0", package: Buffer.from(pkgs.app) }] });
        expect((await service.refresh({})).results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: true });
    });

    it("an index signed by a key the root did not delegate is refused", async () => {
        const { service } = makeService();
        await service.refresh({});
        const keys = require("../../../tools/platform-mock/keys.cjs");
        mock.publishCatalog({ apps: [], signWith: keys.keypair() });
        expect((await service.refresh({})).results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: false, errorCode: "BAD_SIGNATURE" });
    });

    it("a pinned online key works the same; nothing pinned asks the user (fingerprint)", async () => {
        pin = "key";
        let { service } = makeService();
        expect((await service.refresh({})).results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: true });
        pin = "none";
        ({ service } = makeService());
        const r = (await service.refresh({})).results.find((x: Any) => x.id === "phoenix");
        expect(r).toMatchObject({ ok: false, errorCode: "UNTRUSTED", pending: { fingerprint: mock.keys.catalog.fingerprint } });
    });

    it("no catalog in servers.json: not set up", async () => {
        image = JSON.stringify({ format: 1, feeds: null });
        const { service } = makeService();
        expect((await service.refresh({})).results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: false, errorCode: "NOT_SET_UP" });
        expect((await service.getSources({})).sources.find((s: Any) => s.id === "phoenix")).toMatchObject({ notSetUp: true });
    });

    it("says which third-party catalogs are plain HTTP (Q65)", async () => {
        const { service } = makeService();
        const srcs = (await service.getSources({})).sources;
        expect(srcs.find((s: Any) => s.id === "precentral").insecure).toBe(true);
        expect(srcs.find((s: Any) => s.id === "appmuseum").insecure).toBe(false);
    });
});

describe("revocations", () => {
    it("malware: removed and the user told why; never installed again", async () => {
        const { service, world } = makeService();
        await service.refresh({});
        expect(await service.install({ sourceId: "phoenix", id: "org.example.mockapp" })).toMatchObject({ returnValue: true, state: "installed" });
        mock.publishRevocations({ apps: [{ id: "org.example.mockapp", kind: "app", reason: "malware", date: "2026-10-10" }] });
        await service.refresh({});
        expect(world.installed["org.example.mockapp"]).toBeUndefined();
        expect(world.toasts.at(-1).message).toBe("Mock App was removed: it was found to be harmful.");
        expect(await service.install({ sourceId: "phoenix", id: "org.example.mockapp" })).toMatchObject({ returnValue: false, errorCode: "REVOKED" });
        expect((await service.getApp({ sourceId: "phoenix", id: "org.example.mockapp" })).app.revoked).toMatchObject({ reason: "malware" });
        // Said once.
        const n = world.toasts.length;
        await service.refresh({});
        expect(world.toasts.length).toBe(n);
    });

    it("another reason (a connector its developer withdrew): warned, kept, offered for removal", async () => {
        const { service, world } = makeService();
        world.devMode = true;
        await service.refresh({});
        expect(await service.install({ sourceId: "phoenix", id: "org.example.mockfeeds" })).toMatchObject({ returnValue: true });
        mock.publishRevocations({ apps: [{ id: "org.example.mockfeeds", kind: "connector", reason: "developer", date: "2026-10-10", text: "Replaced by News" }] });
        await service.refresh({});
        expect(world.installed["org.example.mockfeeds"]).toBeDefined();
        expect(world.toasts.at(-1).message).toMatch(/^Mock Feeds was withdrawn from the Marketplace because its developer withdrew it\. You can remove it/);
        const inst = (await service.listInstalled({})).apps.find((a: Any) => a.id === "org.example.mockfeeds");
        expect(inst.revoked).toEqual({ reason: "developer", text: "Replaced by News", date: "2026-10-10" });
    });

    it("an unsigned or older list is not taken; a revoked catalog key is not used", async () => {
        const { service, world } = makeService();
        await service.refresh({});
        await service.install({ sourceId: "phoenix", id: "org.example.mockapp" });
        const keys = require("../../../tools/platform-mock/keys.cjs");
        mock.publishRevocations({ apps: [{ id: "org.example.mockapp", reason: "malware", date: "2026-10-10" }], signWith: keys.keypair() });
        await service.refresh({});
        expect(world.installed["org.example.mockapp"]).toBeDefined();
        expect(world.state.revocationsError).toMatchObject({ errorCode: "BAD_SIGNATURE" });
        // The current key revoked (it leaked): the catalog is not read with it
        // (an older key still delegated does not sign this index either).
        mock.publishRevocations({ apps: [], keys: [mock.keys.catalog.publicKey] });
        expect((await service.refresh({})).results.find((x: Any) => x.id === "phoenix")).toMatchObject({ ok: false, errorCode: expect.stringMatching(/^(NO_DELEGATION|BAD_SIGNATURE)$/) });
    });
});

describe("staged rollout of app updates", () => {
    it("an update with a rollout reaches this device only in its percentage", async () => {
        const { service, world } = makeService();
        await service.refresh({});
        await service.install({ sourceId: "phoenix", id: "org.example.mockapp" });
        const v2 = await mockLib.samplePackages(ipk, { appVersion: "1.1.0" });
        mock.publishCatalog({ apps: [{ id: "org.example.mockapp", kind: "ipk", title: "Mock App", version: "1.1.0", package: Buffer.from(v2.app),
                                       rollout: { percent: 0, seed: "mockapp-1.1.0" } }] });
        await service.refresh({});
        expect((await service.listInstalled({})).apps[0].update).toBeNull();
        expect((await service.updateAll({})).updated).toEqual([]);
        mock.publishCatalog({ apps: [{ id: "org.example.mockapp", kind: "ipk", title: "Mock App", version: "1.1.0", package: Buffer.from(v2.app),
                                       rollout: { percent: 100, seed: "mockapp-1.1.0" } }] });
        await service.refresh({});
        expect((await service.listInstalled({})).apps[0].update).toBe("1.1.0");
        expect((await service.updateAll({})).updated).toEqual(["org.example.mockapp"]);
        expect(world.installs.at(-1)).toMatchObject({ id: "org.example.mockapp", version: "1.1.0" });
        expect(world.state.rolloutId).toMatch(/^[0-9a-f]{32}$/);
    });
});
