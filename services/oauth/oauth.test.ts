// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.oauth as a device runs it (device.js): the
// loopback listener on 127.0.0.1 for real, the sealed key store in a
// temporary folder, a fake provider (test/fake-provider.cjs) over HTTP,
// and a Sign In card played by a "browser" that asks pending for the
// address, loads the provider's page, presses Allow (or Deny) and follows
// the redirect to the listener. PKCE and state, the listener's rules,
// cancel, timeout, a second sign-in, refresh, revocation, encryption at
// rest, the old plain file moved in, wipe.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(__filename);
const { createDeviceOAuth, FIXED_PORT, SIGNIN_APP } = require("./device.js");
const { createFakeProvider } = require("./test/fake-provider.cjs");
const { createLoopback, isLoopback } = require("./loopback.js");
const { createFileKeyStore } = require("./keystore.js");
const synckit = require("../../apps/shared/synckit/src/index.js");

const OWNER = "org.webosphoenix.service.test";

function get(url: string, opts: { method?: string; body?: string } = {}): Promise<{ status: number; headers: any; body: string }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || "GET",
                                   headers: opts.body ? { "content-type": "application/x-www-form-urlencoded" } : {} }, (res) => {
            let b = "";
            res.on("data", (d) => { b += d; });
            res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: b }));
        });
        req.on("error", reject);
        req.end(opts.body || "");
    });
}

function portOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const s = net.connect(port, "127.0.0.1");
        s.on("connect", () => { s.destroy(); resolve(true); });
        s.on("error", () => resolve(false));
    });
}

// The user in the card: the provider's page, Allow or Deny, the redirect.
async function press(url: string, decision: "allow" | "deny") {
    const page = await get(url);
    expect(page.status, page.body).toBe(200);
    const fields: Record<string, string> = {};
    for (const m of page.body.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]] = m[2].replace(/&amp;/g, "&").replace(/&quot;/g, "\"");
    fields.decision = decision;
    const r = await get(new URL("/authorize", url).toString(), { method: "POST", body: new URLSearchParams(fields).toString() });
    expect(r.status).toBe(302);
    return r.headers.location as string;
}

let dir = "";
let provider: any;
let world: any;

function makeWorld(opts: any = {}) {
    const launches: any[] = [];
    const closes: number[] = [];
    const bars: any[] = [];
    const w: any = { launches, closes, bars, now: 1_000_000, decision: "allow", auto: true, seen: [] as string[] };
    w.device = createDeviceOAuth({
        request: synckit.createRequest({ userAgent: "test" }),
        fs, path, crypto, http, dir,
        launchCard: async (params: any) => {
            launches.push(params);
            if (!w.auto) return { returnValue: true };
            // The card's page: the address, then the provider's page.
            setTimeout(async () => {
                const r = await w.device.methods.pending({ session: params.session }, SIGNIN_APP);
                if (!r.returnValue) return;
                w.seen.push(r.url);
                const back = await press(r.url, w.decision);
                w.lastRedirect = back;
                const answer = await get(back);
                w.answer = answer;
            }, 0);
            return { returnValue: true };
        },
        closeCard: async () => { closes.push(Date.now()); },
        bar: (info: any) => bars.push(info),
        mayWipe: (c: string) => c === "com.palm.systemmanager",
        now: () => w.now,
        timeoutMs: opts.timeoutMs,
        fixedPort: opts.fixedPort
    });
    w.m = w.device.methods;
    return w;
}

function authorizeParams(extra: any = {}) {
    return Object.assign({ authorizationEndpoint: provider.authorizationEndpoint, tokenEndpoint: provider.tokenEndpoint,
                           revocationEndpoint: provider.revocationEndpoint, clientId: provider.clientId, scope: "files.read",
                           redirectUri: "http://127.0.0.1/oauth/callback" }, extra);
}

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-oauth-"));
    provider = await createFakeProvider({ redirectUris: ["http://127.0.0.1/oauth/callback"] }).start(0);
    world = makeWorld();
});
afterEach(async () => {
    await provider.stop();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the sign-in through the Sign In card", () => {
    it("signs in with PKCE S256 and state, on an ephemeral loopback port, and keeps the token sealed", async () => {
        const r = await world.m.authorize(authorizeParams(), OWNER);
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        expect(r.keyId).toMatch(/^[A-Za-z0-9_-]{20,}$/);
        // The card: launched with the session only; the address came from pending.
        expect(world.launches).toHaveLength(1);
        expect(Object.keys(world.launches[0])).toEqual(["session"]);
        const auth = new URL(world.seen[0]);
        const redirect = auth.searchParams.get("redirect_uri")!;
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
        expect(Number(new URL(redirect).port)).toBeGreaterThan(0);
        expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
        expect(auth.searchParams.get("state")!.length).toBeGreaterThanOrEqual(20);
        // The exchange carried the verifier whose S256 the challenge was (the provider checked it).
        const tr = provider.state().tokenRequests[0];
        expect(tr.grant_type).toBe("authorization_code");
        expect(tr.redirect_uri).toBe(redirect);
        expect(tr.code_verifier.length).toBeGreaterThanOrEqual(43);
        // The listener answered the card, then closed; the card was closed; the bar went.
        expect(world.answer.status).toBe(200);
        expect(world.answer.body).toContain("Signed in");
        expect(world.answer.body).not.toMatch(/code-|at-/);
        expect(await portOpen(Number(new URL(redirect).port))).toBe(false);
        expect(world.closes.length).toBe(1);
        expect(world.bars[0]).toMatchObject({ appId: SIGNIN_APP, host: "127.0.0.1:" + new URL(provider.base).port, secure: false });
        expect(world.bars[world.bars.length - 1]).toBeNull();
        // The token: to its owner only; not on disk in the clear.
        const t = await world.m.token({ keyId: r.keyId }, OWNER);
        expect(t.accessToken).toMatch(/^at-/);
        expect((await world.m.token({ keyId: r.keyId }, "org.webosphoenix.someoneelse")).errorCode).toBe("PERMISSION_DENIED");
        expect((await world.m.token({ keyId: r.keyId }, SIGNIN_APP)).errorCode).toBe("PERMISSION_DENIED");
        const sealed = fs.readFileSync(path.join(dir, "keys.enc"), "utf8");
        expect(sealed).not.toContain(t.accessToken);
        expect(sealed).not.toContain("rt-");
        expect(JSON.parse(sealed)).toMatchObject({ v: 1, alg: "A256GCM", key: "file" });
        expect(fs.statSync(path.join(dir, "keys.enc")).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.join(dir, "master.key")).mode & 0o777).toBe(0o600);
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    });

    it("listens on the fixed port when the redirect names it (providers that match exactly)", async () => {
        await provider.stop();
        provider = await createFakeProvider({ redirectUris: ["http://127.0.0.1:" + 47999 + "/oauth/callback"], exactRedirect: true }).start(0);
        world = makeWorld({ fixedPort: 47999 });
        const ru = await world.m.redirectUri({}, OWNER);
        expect(ru).toMatchObject({ redirectUri: "http://127.0.0.1/oauth/callback", fixedRedirectUri: "http://127.0.0.1:47999/oauth/callback" });
        const r = await world.m.authorize(authorizeParams({ redirectUri: ru.fixedRedirectUri }), OWNER);
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        expect(new URL(world.seen[0]).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:47999/oauth/callback");
        expect(FIXED_PORT).toBeGreaterThan(1024);
    });

    it("refuses a redirect the device cannot receive", async () => {
        for (const bad of ["https://example.org/callback", "http://localhost/oauth/callback", "http://127.0.0.1/other", "http://10.0.0.2/oauth/callback"]) {
            const r = await world.m.authorize(authorizeParams({ redirectUri: bad }), OWNER);
            expect(r.errorCode, bad).toBe("BAD_PARAMS");
        }
        expect(world.launches).toHaveLength(0);
    });

    it("ACCESS_DENIED when the user denies on the provider's page", async () => {
        world.decision = "deny";
        const r = await world.m.authorize(authorizeParams(), OWNER);
        expect(r.errorCode).toBe("ACCESS_DENIED");
        expect(provider.state().tokenRequests).toHaveLength(0);
    });

    it("CANCELED when the user closes the card, and the listener goes", async () => {
        world.auto = false;
        const p = world.m.authorize(authorizeParams(), OWNER);
        await new Promise((r) => setTimeout(r, 30));
        const pending = await world.m.pending({ session: world.launches[0].session }, SIGNIN_APP);
        const port = Number(new URL(new URL(pending.url).searchParams.get("redirect_uri")!).port);
        expect(await portOpen(port)).toBe(true);
        world.device.card.appClosed();
        const r = await p;
        expect(r.errorCode).toBe("CANCELED");
        expect(await portOpen(port)).toBe(false);
        // Closed by the user: the service does not close it again.
        expect(world.closes).toHaveLength(0);
        // The session is over: the card's page gets nothing.
        expect((await world.m.pending({ session: world.launches[0].session }, SIGNIN_APP)).errorCode).toBe("NOT_FOUND");
    });

    it("TIMEOUT when nothing comes back, and the card is closed", async () => {
        world = makeWorld({ timeoutMs: 60 });
        world.auto = false;
        const r = await world.m.authorize(authorizeParams(), OWNER);
        expect(r.errorCode).toBe("TIMEOUT");
        expect(world.closes).toHaveLength(1);
    });

    it("pending answers the Sign In card only, for its own session", async () => {
        world.auto = false;
        const p = world.m.authorize(authorizeParams(), OWNER);
        await new Promise((r) => setTimeout(r, 30));
        const session = world.launches[0].session;
        expect((await world.m.pending({ session }, "com.example.app")).errorCode).toBe("PERMISSION_DENIED");
        expect((await world.m.pending({ session: "guess" }, SIGNIN_APP)).errorCode).toBe("NOT_FOUND");
        const ok = await world.m.pending({ session }, SIGNIN_APP);
        expect(ok).toMatchObject({ returnValue: true, secure: false });
        expect(ok.url.indexOf(provider.authorizationEndpoint)).toBe(0);
        world.device.card.appClosed();
        await p;
    });

    it("a second sign-in replaces the open one once its card has gone", async () => {
        world.auto = false;
        const first = world.m.authorize(authorizeParams(), OWNER);
        await new Promise((r) => setTimeout(r, 30));
        world.auto = true;
        const second = world.m.authorize(authorizeParams(), OWNER);
        expect((await first).errorCode).toBe("CANCELED");
        // The first card's close event: the second card is launched after it.
        await new Promise((r) => setTimeout(r, 20));
        expect(world.launches).toHaveLength(1);
        world.device.card.appClosed();
        const r = await second;
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        expect(world.launches).toHaveLength(2);
    });

    it("a 401_UNAUTHORIZED when the code is not accepted", async () => {
        // The provider's answer reaches the listener, but the exchange fails (the code used up).
        world.auto = false;
        const p = world.m.authorize(authorizeParams(), OWNER);
        await new Promise((r) => setTimeout(r, 30));
        const pend = await world.m.pending({ session: world.launches[0].session }, SIGNIN_APP);
        const back = await press(pend.url, "allow");
        const u = new URL(back);
        u.searchParams.set("code", "code-forged");
        await get(u.toString());
        expect((await p).errorCode).toBe("401_UNAUTHORIZED");
    });
});

describe("the loopback listener", () => {
    it("binds 127.0.0.1 only, ignores other paths and other states, answers once", async () => {
        const lb = createLoopback({ http });
        const l = await lb.open({ state: "s1" });
        expect(l.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
        expect((await get("http://127.0.0.1:" + l.port + "/favicon.ico")).status).toBe(404);
        expect((await get(l.redirectUri + "?code=x&state=other")).status).toBe(400);
        const ok = await get(l.redirectUri + "?code=abc&state=s1");
        expect(ok.status).toBe(200);
        expect(ok.headers["cache-control"]).toBe("no-store");
        expect(await l.result).toBe("/oauth/callback?code=abc&state=s1");
        await new Promise((r) => setTimeout(r, 20));
        expect(await portOpen(l.port)).toBe(false);
    });

    it("close() ends it with null; a busy fixed port is BUSY", async () => {
        const lb = createLoopback({ http });
        const a = await lb.open({ state: "s" });
        await expect(lb.open({ port: a.port, state: "t" })).rejects.toMatchObject({ errorCode: "BUSY" });
        a.close();
        expect(await a.result).toBeNull();
    });

    it("knows its addresses", () => {
        expect(isLoopback("http://127.0.0.1/oauth/callback")).toBe(true);
        expect(isLoopback("http://127.0.0.1:5000/oauth/callback")).toBe(true);
        expect(isLoopback("https://127.0.0.1/oauth/callback")).toBe(false);
        expect(isLoopback("http://127.0.0.1.evil.example/oauth/callback")).toBe(false);
        expect(isLoopback("http://user@127.0.0.1/oauth/callback")).toBe(false);
    });
});

describe("tokens", () => {
    it("refreshes an expired token with the refresh token", async () => {
        await provider.stop();
        provider = await createFakeProvider({ expiresIn: 120 }).start(0);
        const r = await world.m.authorize(authorizeParams(), OWNER);
        const first = await world.m.token({ keyId: r.keyId }, OWNER);
        world.now += 3600 * 1000;
        const second = await world.m.token({ keyId: r.keyId }, OWNER);
        expect(second.returnValue).toBe(true);
        expect(second.accessToken).not.toBe(first.accessToken);
        expect(provider.state().refreshed).toBe(1);
        expect(provider.state().tokenRequests[1].grant_type).toBe("refresh_token");
        // A refresh token the provider no longer takes: 401_UNAUTHORIZED (sign in again).
        provider.dropRefreshTokens();
        world.now += 3600 * 1000;
        expect((await world.m.token({ keyId: r.keyId }, OWNER)).errorCode).toBe("401_UNAUTHORIZED");
    });

    it("forget revokes the token at the provider and deletes the key", async () => {
        const r = await world.m.authorize(authorizeParams(), OWNER);
        const t = await world.m.token({ keyId: r.keyId }, OWNER);
        expect((await world.m.forget({ keyId: r.keyId }, "org.webosphoenix.someoneelse")).errorCode).toBe("PERMISSION_DENIED");
        expect((await world.m.forget({ keyId: r.keyId }, OWNER)).returnValue).toBe(true);
        expect(provider.state().revoked).toContain(t.accessToken);
        expect(provider.state().revoked.some((x: string) => /^rt-/.test(x))).toBe(true);
        expect(provider.tokenLive(t.accessToken)).toBe(false);
        expect((await world.m.token({ keyId: r.keyId }, OWNER)).errorCode).toBe("NOT_FOUND");
    });

    it("client registrations are sealed too, and only their owner reads them", async () => {
        await world.m.client({ name: "mastodon.example", value: { clientId: "cid", clientSecret: "very-secret-value" } }, OWNER);
        expect((await world.m.client({ name: "mastodon.example" }, OWNER)).value.clientSecret).toBe("very-secret-value");
        expect((await world.m.client({ name: "mastodon.example", owner: OWNER }, "com.example.page")).errorCode).toBe("PERMISSION_DENIED");
        expect(fs.readFileSync(path.join(dir, "keys.enc"), "utf8")).not.toContain("very-secret-value");
    });
});

describe("the key store", () => {
    it("moves the old plain keys.json in, and leaves no plain copy", async () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "keys.json"), JSON.stringify({ "key:old": { owner: OWNER, accessToken: "plain-old-token", tokenType: "Bearer", expiresAt: 0 } }));
        const t = await world.m.token({ keyId: "old" }, OWNER);
        expect(t.accessToken).toBe("plain-old-token");
        expect(fs.existsSync(path.join(dir, "keys.json"))).toBe(false);
        expect(fs.readFileSync(path.join(dir, "keys.enc"), "utf8")).not.toContain("plain-old-token");
    });

    it("refuses a damaged or foreign store rather than overwrite it", async () => {
        const ks = createFileKeyStore({ fs, crypto, path, dir });
        await ks.put("a", { secret: "s" });
        const sealed = JSON.parse(fs.readFileSync(path.join(dir, "keys.enc"), "utf8"));
        sealed.data = Buffer.from("tampered").toString("base64");
        fs.writeFileSync(path.join(dir, "keys.enc"), JSON.stringify(sealed));
        await expect(ks.get("a")).rejects.toMatchObject({ errorCode: "KEYSTORE_DAMAGED" });
        await expect(ks.put("b", 1)).rejects.toMatchObject({ errorCode: "KEYSTORE_DAMAGED" });
        // Another device's key: the same.
        await ks.wipe();
        await ks.put("a", { secret: "s" });
        fs.writeFileSync(path.join(dir, "master.key"), crypto.randomBytes(32));
        await expect(ks.get("a")).rejects.toMatchObject({ errorCode: "KEYSTORE_DAMAGED" });
    });

    it("wipe: the system only; the store and its key are gone", async () => {
        const r = await world.m.authorize(authorizeParams(), OWNER);
        expect((await world.m.wipe({}, OWNER)).errorCode).toBe("PERMISSION_DENIED");
        expect((await world.m.wipe({}, "com.palm.systemmanager")).returnValue).toBe(true);
        expect(fs.existsSync(path.join(dir, "keys.enc"))).toBe(false);
        expect(fs.existsSync(path.join(dir, "master.key"))).toBe(false);
        expect((await world.m.token({ keyId: r.keyId }, OWNER)).errorCode).toBe("NOT_FOUND");
    });
});
