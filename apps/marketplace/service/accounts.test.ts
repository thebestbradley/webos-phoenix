// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The account types of a Phoenix catalog (lib/accounts.js; the index's
// "accounts", docs/SYNERGY-CONNECTORS.md 2.1) through the service: an index
// signed here with Node's crypto, served by a fake HTTP. Malformed entries
// are left out, icons are resolved against the index, and an index from
// before (no "accounts") has none.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createPackagesService } = require("./packagesservice.js") as Any;
const accounts = require("./lib/accounts.js") as Any;

const BASE = "https://apps.example.org/v1/";

function catalogServer(index: Any) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const der = publicKey.export({ type: "spki", format: "der" });
    const key = Buffer.from(der.subarray(der.length - 32)).toString("base64");
    const files: Record<string, Uint8Array | string> = {};
    const publish = (idx: Any) => {
        const bytes = new TextEncoder().encode(JSON.stringify(idx));
        files[BASE + "index.json"] = bytes;
        files[BASE + "index.json.sig"] = crypto.sign(null, bytes, privateKey).toString("base64");
    };
    publish(index);
    return {
        key, publish,
        request: async (r: Any) => (typeof files[r.url] === "string" ? { status: 200, headers: {}, body: files[r.url] } : { status: 404, headers: {}, body: "" }),
        requestBytes: async (r: Any) => (files[r.url] instanceof Uint8Array ? { status: 200, headers: {}, bytes: files[r.url] } : { status: 404, headers: {}, bytes: new Uint8Array() }),
    };
}

function makeService(server: Any) {
    const world = { state: null as Any };
    const service = createPackagesService({
        luna: { call: async () => ({ returnValue: true }), subscribe: () => () => {} },
        request: server.request, requestBytes: server.requestBytes,
        gzip: {}, crypto: {
            sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
            sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()),
        },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o: Any) => { world.state = JSON.parse(JSON.stringify(o)); } },
        temp: { write: () => "", remove: () => {} },
        defaultSources: () => [{ id: "phoenix", name: "Phoenix Marketplace", kind: "phoenix", url: BASE, key: server.key, enabled: true }],
    });
    return { service, world };
}

const index = (extra: Any) => ({ version: 1, build: 3, generated: "2026-10-01T00:00:00Z", expires: "2099-01-01T00:00:00Z",
                                  source: { id: "phoenix", name: "Phoenix Marketplace" }, categories: [], apps: [], ...extra });

const DAV = {
    templateId: "org.webosphoenix.dav", title: "CalDAV & CardDAV", provider: "Any DAV server", icon: "icons/accounts/dav-96.png",
    summary: "Contacts and calendars on your own server.",
    capabilities: [{ capability: "CONTACTS", direction: "two-way" }, { capability: "CALENDAR", direction: "two-way" }],
    protocols: ["caldav", "carddav"], auth: { type: "password", registration: "none" }, server: "user",
    privacy: { dataGoesTo: "the server you enter", e2ee: false, phoenixServers: "none" }, push: "poll", status: "beta",
    package: { id: "org.webosphoenix.dav", builtin: true }, help: "https://webosphoenix.org/help/dav", featured: true,
};
const IMAP = {
    templateId: "com.palm.imap", title: "IMAP", provider: "Any mail server", icon: "https://cdn.example.org/imap.png",
    capabilities: [{ capability: "MAIL" }], protocols: ["imap", "smtp"], auth: { type: "password", registration: "none" }, server: "user",
    privacy: { dataGoesTo: "your mail server", e2ee: false, phoenixServers: "none" }, push: "poll", status: "stable",
    package: { id: "com.palm.imap", builtin: true },
};

describe("account types in the catalog", () => {
    it("are read from the signed index, malformed entries left out, icons resolved against it", async () => {
        const server = catalogServer(index({ accounts: [
            DAV, IMAP,
            { title: "No template" },                                  // no templateId
            { templateId: "not an id", title: "Bad" },
            { ...IMAP, title: "IMAP again" },                          // the same template twice: the first
            { templateId: "com.example.odd", capabilities: ["IM", { capability: "lowercase" }, 7], auth: "password",
              icon: "javascript:alert(1)", privacy: "secret", push: "carrier-pigeon", status: "gold", help: "ftp://x" },
        ] }));
        const { service } = makeService(server);
        expect((await service.refresh({})).results[0]).toMatchObject({ id: "phoenix", ok: true });
        const types = (await service.listAccountTypes({})).accountTypes;
        expect(types.map((t: Any) => t.templateId)).toEqual(["org.webosphoenix.dav", "com.palm.imap", "com.example.odd"]);
        expect(types[0]).toMatchObject({
            sourceId: "phoenix", title: "CalDAV & CardDAV", icon: BASE + "icons/accounts/dav-96.png", featured: true, status: "beta",
            capabilities: [{ capability: "CONTACTS", direction: "two-way" }, { capability: "CALENDAR", direction: "two-way" }],
            privacy: { dataGoesTo: "the server you enter", e2ee: false, phoenixServers: "none" }, package: { id: "org.webosphoenix.dav", builtin: true },
        });
        expect(types[1].icon).toBe("https://cdn.example.org/imap.png");
        expect(types[1].title).toBe("IMAP");
        // What did not fit is dropped or plain.
        expect(types[2]).toMatchObject({ title: "com.example.odd", icon: "", capabilities: [{ capability: "IM" }], auth: { type: "", registration: "none" },
                                         privacy: null, push: "poll", status: "stable", help: "", package: { id: "", builtin: false } });
    });

    it("are filtered by capability, as listAccountTemplates is", async () => {
        const { service } = makeService(catalogServer(index({ accounts: [DAV, IMAP] })));
        await service.refresh({});
        const ids = async (capability: Any) => (await service.listAccountTypes({ capability })).accountTypes.map((t: Any) => t.templateId);
        expect(await ids("MAIL")).toEqual(["com.palm.imap"]);
        expect(await ids(["CALENDAR", "MAIL"])).toEqual(["org.webosphoenix.dav", "com.palm.imap"]);
        expect(await ids(["PHOTO"])).toEqual([]);
    });

    it("are found by search: title, provider, capability and protocol", async () => {
        const { service } = makeService(catalogServer(index({ accounts: [DAV, IMAP] })));
        await service.refresh({});
        const found = async (query: string) => (await service.search({ query })).accountTypes.map((t: Any) => t.templateId);
        expect(await found("caldav")).toEqual(["org.webosphoenix.dav"]);
        expect(await found("calendar")).toEqual(["org.webosphoenix.dav"]);
        expect(await found("mail server")).toEqual(["com.palm.imap"]);
        expect(await found("imap")).toEqual(["com.palm.imap"]);
        expect(await found("nothing")).toEqual([]);
        expect((await service.search({ query: "" })).accountTypes).toEqual([]);
    });

    it("an index from before has none, and so has a catalog read before this version", async () => {
        const server = catalogServer(index({}));
        const { service, world } = makeService(server);
        await service.refresh({});
        expect((await service.listAccountTypes({})).accountTypes).toEqual([]);
        // State saved by an older service: its index has no "accounts" at all.
        delete world.state.indexes.phoenix.accounts;
        expect((await service.listAccountTypes({})).accountTypes).toEqual([]);
        expect((await service.search({ query: "mail" })).accountTypes).toEqual([]);
        // The catalog switched off: none.
        server.publish(index({ build: 4, accounts: [IMAP] }));
        await service.refresh({});
        expect((await service.listAccountTypes({})).accountTypes).toHaveLength(1);
        await service.setSource({ id: "phoenix", enabled: false });
        expect((await service.listAccountTypes({})).accountTypes).toEqual([]);
    });

    it("an icon by size, as the draft feed has it: the largest", () => {
        expect(accounts.iconUrl({ 48: "a-48.png", 96: "a-96.png" }, BASE)).toBe(BASE + "a-96.png");
        expect(accounts.iconUrl("/icons/x.png", BASE)).toBe("https://apps.example.org/icons/x.png");
        expect(accounts.iconUrl("data:image/png;base64,AAAA", BASE)).toBe("");
        expect(accounts.iconUrl("", BASE)).toBe("");
    });
});
