// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/platform: servers.json and its override, signatures and the
// root's delegations, rollout buckets, the revocation list, the API's errors.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const platform = require("./index.js") as Any;
const keys = require("../../../../tools/platform-mock/keys.cjs") as Any;
const sha512 = async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest());
const sha256 = async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest());
const REPO = path.resolve(__dirname, "../../../..");

describe("servers.json", () => {
    it("the simulator's file: this computer's catalog and feed, no account server", () => {
        const image = platform.servers.parse(fs.readFileSync(path.join(REPO, "services/account/etc/palm/phoenix/servers.json"), "utf8"));
        const r = platform.servers.resolve(image, null, false);
        expect(r.catalog).toEqual({ url: "http://127.0.0.1:8088/v1/", key: null, root: null });
        expect(r.updates).toMatchObject({ url: "http://127.0.0.1:8088/updates/", channel: "stable", channels: ["stable", "beta", "dev"] });
        expect(r.revocations).toEqual({ url: "http://127.0.0.1:8088/v1/revoked.json" });
        expect(r.drivers.url).toBe("file:///usr/share/phoenix/hardware/sample/v1/");
        expect(r.account).toBeNull();
        expect(r.backup).toBeNull();
        expect(r.push).toBeNull();
        expect(r.assistant).toBeNull();
    });

    it("a production image: two hosts, paths below them, pinned keys", () => {
        const root = keys.keypair().publicKey;
        const r = platform.servers.resolve({
            feeds: "https://feeds.example.org", api: "https://api.example.org/",
            catalog: { url: "catalog/v1/", root }, updates: { url: "updates/", channel: "beta", root },
            revocations: { url: "revocations/v1/revoked.json" }, drivers: { url: "drivers/v1/", reportUrl: "drivers/v1/report" },
            account: { issuer: "https://api.example.org" }, push: { server: "https://push.example.org/" }, assistant: { url: "v1/assistant/" },
        }, null, false);
        expect(r.feeds).toBe("https://feeds.example.org/");
        expect(r.catalog).toEqual({ url: "https://feeds.example.org/catalog/v1/", key: null, root });
        expect(r.updates).toMatchObject({ url: "https://feeds.example.org/updates/", channel: "beta", root });
        expect(r.drivers).toEqual({ url: "https://feeds.example.org/drivers/v1/", key: null, reportUrl: "https://api.example.org/drivers/v1/report" });
        expect(r.account).toMatchObject({ issuer: "https://api.example.org", clientId: "phoenix-device" });
        expect(r.backup).toEqual({ credentials: "https://api.example.org/v1/backup/credentials", summary: "https://api.example.org/v1/backup/summary" });
        expect(r.push).toEqual({ server: "https://push.example.org/", channels: "https://api.example.org/v1/push/channels" });
        expect(r.assistant).toEqual({ url: "https://api.example.org/v1/assistant/" });
    });

    it("plain HTTP only for this computer; the override only in Developer Mode, and then also plain HTTP", () => {
        expect(platform.servers.resolve({ feeds: "http://feeds.example.org/", catalog: { url: "v1/" } }, null, false).catalog).toBeNull();
        const over = { feeds: "http://192.168.1.5:8099/feeds/", catalog: { url: "catalog/v1/" } };
        const image = { feeds: "https://feeds.example.org/", catalog: { url: "catalog/v1/", root: keys.keypair().publicKey } };
        expect(platform.servers.resolve(image, over, false).catalog.url).toBe("https://feeds.example.org/catalog/v1/");
        const on = platform.servers.resolve(image, over, true);
        expect(on.overridden).toBe(true);
        expect(on.catalog.url).toBe("http://192.168.1.5:8099/feeds/catalog/v1/");
        expect(on.catalog.root).toBe(image.catalog.root);   // fields the override leaves alone stay
        expect(() => platform.servers.checkOverride({ feeds: "ftp://x" })).toThrow(/http/);
        expect(() => platform.servers.checkOverride({ catalog: { key: "short" } })).toThrow(/Ed25519/);
        expect(() => platform.servers.checkOverride({ bogus: 1 })).toThrow(/unknown/);
    });

    it("load(): a broken image file counts as none", async () => {
        const logs: string[] = [];
        const r = await platform.load({ image: () => "{nope", override: () => null, devMode: () => false, log: (m: string) => logs.push(m) });
        expect(r.catalog).toBeNull();
        expect(logs[0]).toMatch(/not JSON/);
    });

    it("driverConfig: servers.json's drivers over catalog.json's Phoenix source, revoked keys kept", () => {
        const c = platform.driverConfig({ sources: [{ id: "phoenix", name: "P", url: null, key: null, revoked: ["X"] }] },
            { drivers: { url: "https://feeds.example.org/drivers/v1/", key: "K", reportUrl: "https://api.example.org/drivers/v1/report" } });
        expect(c).toEqual({ sources: [{ id: "phoenix", name: "P", url: "https://feeds.example.org/drivers/v1/", key: "K", revoked: ["X"] }],
                            reportUrl: "https://api.example.org/drivers/v1/report" });
    });
});

describe("signatures and delegations", () => {
    it("a detached signature over the exact bytes", async () => {
        const k = keys.keypair();
        const bytes = new TextEncoder().encode("{\"format\": 2}\n");
        expect(await platform.signed.verifyDetached(bytes, keys.sigFile(k, bytes), k.publicKey, sha512)).toBe(true);
        expect(await platform.signed.verifyDetached(new TextEncoder().encode("{\"format\": 3}\n"), keys.sigFile(k, bytes), k.publicKey, sha512)).toBe(false);
    });

    it("the root's delegation: its scope, its expiry, a revoked key", async () => {
        const root = keys.keypair(), a = keys.keypair(), b = keys.keypair();
        const kj = { key: a.publicKey, delegations: [keys.delegate(root, a, "catalog", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z"),
                                                     keys.delegate(root, b, "catalog", "2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z")] };
        const opts = { sha512, now: new Date("2026-10-11T00:00:00Z") };
        expect(await platform.signed.trustedKeys(kj, { root: root.publicKey }, "catalog", opts)).toEqual([a.publicKey, b.publicKey]);
        await expect(platform.signed.trustedKeys(kj, { root: root.publicKey }, "updates", opts)).rejects.toMatchObject({ code: "NO_DELEGATION" });
        expect(await platform.signed.trustedKeys(kj, { root: root.publicKey }, "catalog", Object.assign({}, opts, { now: new Date("2026-12-15T00:00:00Z") })))
            .toEqual([b.publicKey]);
        expect(await platform.signed.trustedKeys(kj, { root: root.publicKey }, "catalog", Object.assign({}, opts, { revokedKeys: [a.publicKey] })))
            .toEqual([b.publicKey]);
        // The text signed is fixed (the platform signs the same bytes).
        expect(new TextDecoder().decode(platform.signed.delegationMessage(kj.delegations[0])))
            .toBe(`phoenix-key-delegation:1\ncatalog\n${a.publicKey}\n2026-09-01T00:00:00Z\n2026-12-01T00:00:00Z\n`);
        // A pinned key needs no key.json.
        expect(await platform.signed.trustedKeys(null, { key: a.publicKey }, "catalog", opts)).toEqual([a.publicKey]);
        expect(await platform.signed.trustedKeys(null, {}, "catalog", opts)).toBeNull();
    });
});

describe("rollout", () => {
    it("a stable bucket per device and seed, below the percentage", async () => {
        const b = await platform.rollout.bucket("seed-1", "00112233445566778899aabbccddeeff", sha256);
        const h = crypto.createHash("sha256").update("seed-1:00112233445566778899aabbccddeeff").digest();
        expect(b).toBe(h.readUInt32BE(0) % 100);
        expect(await platform.rollout.check({ percent: b + 1, seed: "seed-1" }, "00112233445566778899aabbccddeeff", sha256)).toMatchObject({ eligible: true });
        expect(await platform.rollout.check({ percent: b, seed: "seed-1" }, "00112233445566778899aabbccddeeff", sha256)).toMatchObject({ eligible: false });
        expect(await platform.rollout.check(undefined, "x", sha256)).toMatchObject({ eligible: true });
        expect(await platform.rollout.check({ percent: 0, seed: "s" }, "x", sha256)).toMatchObject({ eligible: false });
    });
});

describe("the revocation list", () => {
    it("signed by a catalog key, current, not older than one taken", async () => {
        const k = keys.keypair();
        const doc = { format: 1, sequence: 3, generated: "2026-10-10T00:00:00Z", expires: "2026-10-24T00:00:00Z",
                      apps: [{ id: "com.example.bad", kind: "app", reason: "malware", date: "2026-10-10" },
                             { id: "org.example.feeds", kind: "connector", reason: "developer", date: "2026-10-09", text: "Replaced" }],
                      keys: [keys.keypair().publicKey] };
        const bytes = new TextEncoder().encode(JSON.stringify(doc));
        const opts = { sha512, now: new Date("2026-10-11T00:00:00Z") };
        const r = await platform.revocations.verify(bytes, keys.sigFile(k, bytes), [k.publicKey], opts);
        expect(r.apps).toEqual([
            { id: "com.example.bad", kind: "app", reason: "malware", remove: true, date: "2026-10-10", text: "" },
            { id: "org.example.feeds", kind: "connector", reason: "developer", remove: false, date: "2026-10-09", text: "Replaced" }]);
        expect(r.keys).toEqual(doc.keys);
        await expect(platform.revocations.verify(bytes, keys.sigFile(keys.keypair(), bytes), [k.publicKey], opts)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        await expect(platform.revocations.verify(bytes, keys.sigFile(k, bytes), [k.publicKey], Object.assign({ lastSequence: 4 }, opts))).rejects.toMatchObject({ code: "ROLLBACK" });
        await expect(platform.revocations.verify(bytes, keys.sigFile(k, bytes), [k.publicKey], { sha512, now: new Date("2026-11-01T00:00:00Z") })).rejects.toMatchObject({ code: "EXPIRED" });
    });
});

describe("the API's errors", () => {
    it("code and text from the body, Retry-After, backoff", () => {
        const e = platform.http.apiError({ status: 429, headers: { "retry-after": "30" }, body: JSON.stringify({ error: "Slow down", code: "QUOTA" }) });
        expect(e).toMatchObject({ code: "QUOTA", message: "Slow down", status: 429, retryAfter: 30000 });
        expect(platform.http.apiError({ status: 503, headers: {}, body: "<html>" })).toMatchObject({ code: "SERVER_ERROR" });
        expect(platform.http.backoff(0, 0, () => 0)).toBe(60000);
        expect(platform.http.backoff(3, 0, () => 0)).toBe(480000);
        expect(platform.http.backoff(30, 0, () => 0)).toBe(6 * 3600 * 1000);
        expect(platform.http.backoff(0, 120000, () => 0)).toBe(120000);
    });
});
