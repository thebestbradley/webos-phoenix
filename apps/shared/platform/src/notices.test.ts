// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/platform notices.js: the system notices feed (docs/NOTICES.md):
// the signature, expiry and rollback, each notice's checks, the audience
// filter and the actions a notice may have; servers.json's "notices".

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const platform = require("./index.js") as Any;
const notices = platform.notices;
const keys = require("../../../../tools/platform-mock/keys.cjs") as Any;
const sha512 = async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest());
const REPO = path.resolve(__dirname, "../../../..");

const NOW = new Date("2026-11-02T16:00:00Z");
const ORIGINS = ["https://webosphoenix.example", "https://feeds.webosphoenix.example"];

function notice(extra: Any = {}) {
    return { id: "7f0c2a4e-1111-4222-8333-944445555666", severity: "info", title: "Phoenix 1.0.3 is ready",
             body: "Fixes Wi-Fi reconnects and the Email sync delay.", starts: "2026-11-02T15:00:00Z", ends: "2026-11-16T00:00:00Z",
             action: { kind: "update" }, ...extra };
}
function feed(list: Any[], extra: Any = {}) {
    return { format: 1, sequence: 42, generated: "2026-11-02T15:00:00Z", expires: "2026-11-09T15:00:00Z", notices: list, ...extra };
}
const bytesOf = (doc: Any) => new TextEncoder().encode(typeof doc === "string" ? doc : JSON.stringify(doc));
const opts = (extra: Any = {}) => ({ sha512, now: NOW, origins: ORIGINS, ...extra });

describe("the notices feed: signature, expiry, rollback", () => {
    it("signed by a pinned notices key, current: its notices, checked", async () => {
        const k = keys.keypair();
        const bytes = bytesOf(feed([notice()]));
        const r = await notices.verify(bytes, keys.sigFile(k, bytes), [keys.keypair().publicKey, k.publicKey], opts());
        expect(r).toMatchObject({ sequence: 42, generated: "2026-11-02T15:00:00Z", expires: "2026-11-09T15:00:00Z" });
        expect(r.notices).toEqual([{
            id: "7f0c2a4e-1111-4222-8333-944445555666", severity: "info", title: "Phoenix 1.0.3 is ready",
            body: "Fixes Wi-Fi reconnects and the Email sync delay.", starts: "2026-11-02T15:00:00.000Z", ends: "2026-11-16T00:00:00.000Z",
            audience: { channels: [], compatible: [], minBuild: null, maxBuild: null, locales: [] },
            action: { kind: "update", appId: "org.webosphoenix.settings", params: { page: "updates" } }, dismissible: true }]);
    });

    it("refuses a wrong signature, no key, an expired or older feed, and what is not a feed", async () => {
        const k = keys.keypair();
        const bytes = bytesOf(feed([notice()]));
        const sig = keys.sigFile(k, bytes);
        await expect(notices.verify(bytes, keys.sigFile(keys.keypair(), bytes), [k.publicKey], opts())).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        await expect(notices.verify(bytes, "", [k.publicKey], opts())).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        // One byte changed after signing.
        const changed = bytesOf(JSON.stringify(feed([notice()])).replace("1.0.3", "1.0.4"));
        await expect(notices.verify(changed, sig, [k.publicKey], opts())).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        await expect(notices.verify(bytes, sig, [], opts())).rejects.toMatchObject({ code: "UNTRUSTED" });
        await expect(notices.verify(bytes, sig, [k.publicKey], opts({ now: new Date("2026-11-10T00:00:00Z") }))).rejects.toMatchObject({ code: "EXPIRED" });
        await expect(notices.verify(bytes, sig, [k.publicKey], opts({ lastSequence: 43 }))).rejects.toMatchObject({ code: "ROLLBACK" });
        // The same sequence again is the same feed (re-read): taken.
        await expect(notices.verify(bytes, sig, [k.publicKey], opts({ lastSequence: 42 }))).resolves.toMatchObject({ sequence: 42 });
        for (const bad of ["{nope", feed([], { format: 2 }), feed([], { notices: {} }), feed([], { sequence: "42" }), feed([], { expires: undefined }), feed([], { expires: "soon" })]) {
            const b = bytesOf(bad);
            await expect(notices.verify(b, keys.sigFile(k, b), [k.publicKey], opts())).rejects.toMatchObject({ code: "BAD_FEED" });
        }
    });

    it("refuses a file over 64 KB before reading it; reads 20 notices at most", async () => {
        const k = keys.keypair();
        const big = bytesOf(feed([notice({ body: "x".repeat(70000) })]));
        await expect(notices.verify(big, keys.sigFile(k, big), [k.publicKey], opts())).rejects.toMatchObject({ code: "BAD_FEED" });
        const many = bytesOf(feed(Array.from({ length: 25 }, (_, i) => notice({ id: "n" + i }))));
        const r = await notices.verify(many, keys.sigFile(k, many), [k.publicKey], opts());
        expect(r.notices.map((n: Any) => n.id)).toEqual(Array.from({ length: 20 }, (_, i) => "n" + i));
    });
});

describe("a notice, checked on its own", () => {
    const one = (n: Any) => notices.normalizeNotice(n, { origins: ORIGINS });

    it("leaves out what is not a notice; keeps the others", async () => {
        expect(one(notice({ severity: "urgent" }))).toBeNull();
        expect(one(notice({ severity: undefined }))).toBeNull();
        expect(one(notice({ id: "<script>" }))).toBeNull();
        expect(one(notice({ id: 7 }))).toBeNull();
        expect(one(notice({ title: " \u0007 " }))).toBeNull();
        expect(one(notice({ starts: "tomorrow" }))).toBeNull();
        const k = keys.keypair();
        const bytes = bytesOf(feed([notice({ id: "a", severity: "bogus" }), notice({ id: "b" }), notice({ id: "b", title: "Again" }),
                                    notice({ id: "c", ends: "2026-11-01T00:00:00Z" }), "text", null]));
        const r = await notices.verify(bytes, keys.sigFile(k, bytes), [k.publicKey], opts());
        expect(r.notices.map((n: Any) => n.id)).toEqual(["b"]);   // the bad severity, the second "b" and the ended one left out
    });

    it("plain text only: control and direction characters out, never HTML, at most 60 and 300 characters", () => {
        const n = one(notice({ title: "Sync\u0000 is\ndown\u202e; we're on it <b>now</b>", body: "a\u200b\u2066b\r\n\tc " + "é".repeat(400) }));
        expect(n.title).toBe("Sync is down; we're on it <b>now</b>");   // shown as text, as it is
        expect(n.body.startsWith("ab c éé")).toBe(true);
        expect(n.body.length).toBe(300);
        expect(one(notice({ title: "T".repeat(80) })).title).toBe("T".repeat(60));
        // An emoji cut in half at the limit goes whole.
        expect(one(notice({ title: "x".repeat(59) + "\u{1F525}" })).title).toBe("x".repeat(59));
        expect(one(notice({ body: undefined })).body).toBe("");
    });

    it("the action: Settings > Updates, allowlisted apps, links on the platform's own https origin; anything else is left out, the notice stays", () => {
        const act = (a: Any) => one(notice({ action: a })).action;
        expect(act({ kind: "update" })).toEqual({ kind: "update", appId: "org.webosphoenix.settings", params: { page: "updates" } });
        expect(act({ kind: "app", appId: "org.webosphoenix.settings", params: { page: "backup" } }))
            .toEqual({ kind: "app", appId: "org.webosphoenix.settings", params: { page: "backup" } });
        expect(act({ kind: "app", appId: "org.webosphoenix.marketplace", params: { appId: "org.example.tides" } }))
            .toEqual({ kind: "app", appId: "org.webosphoenix.marketplace", params: { appId: "org.example.tides" } });
        expect(act({ kind: "app", appId: "org.webosphoenix.marketplace" })).toEqual({ kind: "app", appId: "org.webosphoenix.marketplace", params: {} });
        expect(act({ kind: "url", url: "https://webosphoenix.example/news/1.0.3" }))
            .toEqual({ kind: "url", url: "https://webosphoenix.example/news/1.0.3", appId: "com.palm.app.browser",
                       params: { target: "https://webosphoenix.example/news/1.0.3" } });
        // The browser as an "app": its target is a link, checked as one.
        expect(act({ kind: "app", appId: "com.palm.app.browser", params: { target: "https://feeds.webosphoenix.example/status" } }))
            .toMatchObject({ kind: "url", url: "https://feeds.webosphoenix.example/status" });
        const refused = [
            { kind: "app", appId: "org.webosphoenix.terminal" },
            { kind: "app", appId: "com.palm.app.phone", params: { number: "900" } },
            { kind: "app", appId: "org.webosphoenix.settings", params: "page=devmode" },
            { kind: "app", appId: "org.webosphoenix.settings", params: { blob: "x".repeat(3000) } },
            { kind: "app", appId: "com.palm.app.browser", params: { target: "https://evil.example/" } },
            { kind: "app", appId: "com.palm.app.browser" },
            { kind: "url", url: "http://webosphoenix.example/news" },
            { kind: "url", url: "https://evil.example/webosphoenix.example" },
            { kind: "url", url: "https://webosphoenix.example.evil.example/" },
            { kind: "url", url: "https://user:pw@webosphoenix.example/" },
            { kind: "url", url: "javascript:alert(1)" },
            { kind: "url", url: "file:///etc/passwd" },
            { kind: "launch", appId: "org.webosphoenix.settings" },
            "update",
        ];
        for (const a of refused) {
            const n = one(notice({ action: a }));
            expect(n, JSON.stringify(a)).not.toBeNull();
            expect(n.action, JSON.stringify(a)).toBeNull();
        }
        // Without the platform's origins no link is allowed at all.
        expect(notices.normalizeNotice(notice({ action: { kind: "url", url: "https://webosphoenix.example/" } }), {}).action).toBeNull();
    });
});

describe("the audience", () => {
    const device = { channel: "beta", compatible: "phoenix-vm-arm64", build: 20261020, locale: "de-DE" };
    const n = (audience: Any, extra: Any = {}) => notices.normalizeNotice(notice({ audience, ...extra }), { origins: ORIGINS });

    it("every field optional, empty is everyone; each one given must match", () => {
        expect(notices.matches(n(undefined), device, NOW)).toBe(true);
        expect(notices.matches(n({ channels: [], compatible: [], locales: [] }), device, NOW)).toBe(true);
        expect(notices.matches(n({ channels: ["beta", "dev"] }), device, NOW)).toBe(true);
        expect(notices.matches(n({ channels: ["stable"] }), device, NOW)).toBe(false);
        expect(notices.matches(n({ compatible: ["phoenix-vm-arm64"] }), device, NOW)).toBe(true);
        expect(notices.matches(n({ compatible: ["phoenix-pinephonepro"] }), device, NOW)).toBe(false);
        expect(notices.matches(n({ minBuild: 0, maxBuild: 20261101 }), device, NOW)).toBe(true);
        expect(notices.matches(n({ minBuild: 20261021 }), device, NOW)).toBe(false);
        expect(notices.matches(n({ maxBuild: 20261019 }), device, NOW)).toBe(false);
        expect(notices.matches(n({ locales: ["de"] }), device, NOW)).toBe(true);
        expect(notices.matches(n({ locales: ["de_de"] }), device, NOW)).toBe(true);
        expect(notices.matches(n({ locales: ["en", "en-GB"] }), device, NOW)).toBe(false);
        // A field the device does not know does not match one that is asked for.
        expect(notices.matches(n({ maxBuild: 5 }), { channel: "beta" }, NOW)).toBe(false);
        expect(notices.matches(n({ locales: ["de"] }), {}, NOW)).toBe(false);
    });

    it("its time window", () => {
        expect(notices.matches(n(undefined, { starts: "2026-11-03T00:00:00Z" }), device, NOW)).toBe(false);
        expect(notices.matches(n(undefined, { ends: "2026-11-02T16:00:00Z" }), device, NOW)).toBe(false);
        expect(notices.matches(n(undefined, { starts: undefined, ends: undefined }), device, NOW)).toBe(true);
        expect(notices.active([n(undefined, { id: "later", starts: "2026-12-01T00:00:00Z" }), n(undefined, { id: "now" })], device, NOW)
            .map((x: Any) => x.id)).toEqual(["now"]);
    });

    it("an audience the device does not understand leaves the notice out (never everyone)", () => {
        expect(n({ channels: "beta" })).toBeNull();
        expect(n({ channels: ["Beta!"] })).toBeNull();
        expect(n({ minBuild: "20261020" })).toBeNull();
        expect(n({ maxBuild: 1.5 })).toBeNull();
        expect(n({ locales: [7] })).toBeNull();
        expect(n("everyone")).toBeNull();
    });
});

describe("servers.json's notices", () => {
    it("relative to the feeds, its keys pinned; the platform's own origins for links", () => {
        const k = keys.keypair().publicKey;
        const r = platform.servers.resolve({
            feeds: "https://feeds.example.org/", api: "https://api.example.org/",
            notices: { url: "notices/v1/notices.json", keys: [k, "short", k], site: "https://example.org" },
        }, null, false);
        expect(r.notices).toEqual({ url: "https://feeds.example.org/notices/v1/notices.json", keys: [k], site: "https://example.org/" });
        expect(notices.originsOf(r)).toEqual(["https://feeds.example.org", "https://api.example.org", "https://example.org"]);
        expect(platform.servers.resolve({ feeds: "https://feeds.example.org/" }, null, false).notices).toBeNull();
        expect(() => platform.servers.checkOverride({ notices: { keys: ["short"] } })).toThrow(/Ed25519/);
        expect(() => platform.servers.checkOverride({ notices: { keys: k } })).toThrow(/Ed25519/);
        expect(platform.servers.checkOverride({ notices: { url: "notices/v1/notices.json", keys: [k] } })).toBeTruthy();
        // Plain http (this computer's servers) is no origin a notice may link to.
        expect(notices.originsOf(platform.servers.resolve({ feeds: "http://127.0.0.1:8088/" }, null, false))).toEqual([]);
    });

    it("the simulator's: the sample feed, signed with the sample key it pins", async () => {
        const image = platform.servers.parse(fs.readFileSync(path.join(REPO, "services/account/etc/palm/phoenix/servers.json"), "utf8"));
        const r = platform.servers.resolve(image, null, false);
        expect(r.notices.url).toBe("file:///usr/share/phoenix/notices/sample/notices.json");
        expect(r.notices.keys).toHaveLength(1);
        const dir = path.join(REPO, "server/notices/sample/public");
        const bytes = new Uint8Array(fs.readFileSync(path.join(dir, "notices.json")));
        const doc = await notices.verify(bytes, fs.readFileSync(path.join(dir, "notices.json.sig"), "utf8"), r.notices.keys,
                                         { sha512, now: NOW, origins: notices.originsOf(r) });
        expect(doc.notices.length).toBeGreaterThan(0);
        expect(doc.notices.map((x: Any) => x.severity)).toContain("info");
    });
});
