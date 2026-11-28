// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix's token relay end to end: Box in the drives, signed in with no
// client secret on the device, against a real Phoenix-Web-Services
// (php -S, a fresh SQLite database) and the Box stand-in of
// test/fake-drives.cjs, whose token endpoint asks for the secret as Box's
// does. The chain is the device's: the drives connector ("relay": true in
// drives/clients.json) -> the OAuth service (PKCE, the fixed loopback
// redirect) -> the account service's tokenRelay with the device's Phoenix
// token -> POST /v1/oauth-broker/box/exchange (and /refresh) -> the
// stand-in's token endpoint with Phoenix's id and secret.
//
// Runs only with a checkout of Phoenix-Web-Services whose dependencies are
// installed (docs/SYNERGY-CONNECTORS.md "The token relay"):
//   PWS_DIR=/path/to/Phoenix-Web-Services [PHP=php8.4] npx vitest run connectors/drives/service/relay-e2e.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as kit from "@phoenix/connector-kit";
import * as synckit from "@phoenix/synckit";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

const require = createRequire(__filename);
const { createFakeDrives } = require("./test/fake-drives.cjs");
const oauthLib = require("../../../../services/oauth/oauthservice.js");
const accountLib = require("../../../../services/account/accountservice.js");
const platform = require("@phoenix/platform");
const device = require("@phoenix/platform/src/device.js");
const drives = loadCommonJs(path.join(__dirname, "connector.js"));

const PWS = process.env.PWS_DIR || "";
const PHP = process.env.PHP || "php";
const SERVICE = "org.webosphoenix.service.drives";
const OAUTH_SERVICE = "org.webosphoenix.service.oauth";
const request = synckit.createRequest({ timeoutMs: 20000 });

function freePort(): Promise<number> {
    return new Promise((resolve) => {
        const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
    });
}

describe.skipIf(!PWS)("Phoenix's token relay against Phoenix-Web-Services and the Box stand-in", () => {
    const secret = "box-" + crypto.randomBytes(12).toString("hex");
    let tmp = "", api = "", phoenixToken = "", log = "", serversJson = "";
    let mint: () => string = () => "";
    let php: ChildProcess | null = null;
    let fake: any;

    beforeAll(async () => {
        fake = await createFakeDrives({ autoApprove: true }).start(0);
        fake.boxSecret = secret;
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-relay-e2e-"));
        const port = await freePort();
        api = "http://127.0.0.1:" + port + "/";
        const env = {
            ...process.env, APP_ENV: "local", APP_DEBUG: "false", APP_URL: api.replace(/\/$/, ""), LOG_CHANNEL: "stderr",
            // The cache (the relay's limits, its used codes) in this run's own database: a file cache would outlive it.
            DB_CONNECTION: "sqlite", DB_DATABASE: path.join(tmp, "db.sqlite"), CACHE_STORE: "database", SESSION_DRIVER: "array", QUEUE_CONNECTION: "sync",
            PHOENIX_TESTING_ROOT: path.join(tmp, "platform"),
            RELAY_BOX_CLIENT_ID: "phoenix-test-box", RELAY_BOX_CLIENT_SECRET: secret, RELAY_BOX_TOKEN_URL: fake.origin + "/oauth/box/token"
        };
        fs.writeFileSync(env.DB_DATABASE, "");
        const run = (args: string[]) => {
            const r = spawnSync(PHP, args, { cwd: PWS, env, encoding: "utf8", input: "", timeout: 120000 });
            if (r.status !== 0) throw new Error(args.join(" ") + ": " + r.stdout + r.stderr);
            return r.stdout;
        };
        run(["artisan", "migrate", "--force", "--no-interaction"]);
        run(["artisan", "platform:prepare-testing", "--url", api.replace(/\/$/, "")]);
        // A verified account, a registered device and a Phoenix token bound to it (what the device's sign-in leaves).
        mint = () => { const out = run([path.join(__dirname, "test", "relay-e2e-mint.php"), PWS]); try { return JSON.parse(out).token; } catch (e) { throw new Error("mint: " + out.slice(0, 1500)); } };
        phoenixToken = mint();
        php = spawn(PHP, ["-S", "127.0.0.1:" + port, path.join(PWS, "vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php")],
                    { cwd: path.join(PWS, "public"), env, stdio: ["ignore", "pipe", "pipe"] });
        php.stdout!.on("data", (d) => { log += d; });
        php.stderr!.on("data", (d) => { log += d; });
        for (let i = 0; i < 100; i++) {
            try { if ((await request({ method: "GET", url: api + "api/health" })).status === 200) break; } catch (e) { /* starting */ }
            await new Promise((r) => setTimeout(r, 100));
        }
        // The image's servers.json, as the platform serves it for a test device.
        serversJson = (await request({ method: "GET", url: api + "v1/servers.json" })).body;
    }, 180000);
    afterEach(() => { fake.boxTokenAnswer = null; fake.boxSecret = secret; });
    afterAll(async () => {
        if (php) php.kill();
        if (fake) await fake.stop();
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    function world(opts: { phoenixToken?: string; servers?: string; clients?: any } = {}) {
        const keys: Record<string, any> = {};
        const accountKeys: Record<string, any> = { "account:tokens": { via: "code", accessToken: opts.phoenixToken ?? phoenixToken, refreshToken: null, tokenType: "Bearer", scope: "account", expiresAt: null } };
        let accountState: any = { signedIn: true };
        const account = accountLib.createAccountService({
            request: (req: any) => device.request(req),
            requestBytes: (req: any) => device.request(req),
            luna: { call: async () => ({ returnValue: true }) },
            keystore: { get: async (k: string) => accountKeys[k], put: async (k: string, v: any) => { accountKeys[k] = v; }, del: async (k: string) => { delete accountKeys[k]; } },
            state: { load: () => accountState, save: (o: any) => { accountState = o; } },
            servers: () => platform.load({ image: () => opts.servers ?? serversJson, override: () => null }),
            override: { read: () => null, write: () => {} },
            crypto: { sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
                      sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()),
                      randomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)), deviceKey: async () => crypto.randomBytes(32).toString("base64") },
            device: async () => ({ name: "Relay E2E", model: "test", compatible: "phoenix-test", osVersion: "1.0.0", build: 1 }),
            now: () => new Date()
        });
        const relayed: any[] = [];
        const oauth = oauthLib.createOAuthService({
            request,
            keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
            crypto: { randomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)),
                      sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(Buffer.from(b)).digest()) },
            redirectUri: "http://127.0.0.1/oauth/callback",
            fixedRedirectUri: "http://127.0.0.1:47613/oauth/callback",
            // The provider's page: its redirects followed until the loopback redirect (the Sign In card's part).
            sheet: async (url: string, prefix: string) => {
                let at = url;
                for (let i = 0; i < 5 && at.indexOf(prefix) !== 0; i++) {
                    const r = await request({ method: "GET", url: at });
                    if (!r.headers.location) throw new Error("no redirect from " + at + ": " + r.status);
                    at = new URL(r.headers.location, at).href;
                }
                return at;
            },
            relay: async (p: any) => { relayed.push(p); return account.tokenRelay(p, OAUTH_SERVICE); }
        });
        const accounts: Record<string, any> = {};
        const credentials: Record<string, any> = {};
        let methods: any = {};
        const bus = memdb.createFakeBus({
            db: memdb.createMemDb(memdb.KIND_PARENTS), tempdb: memdb.createMemDb(), accounts, credentials,
            handlers: {
                "luna://org.webosphoenix.service.oauth/*": (p: any, uri: string) => (oauth as any)[uri.slice(uri.lastIndexOf("/") + 1)](p, SERVICE),
                "luna://org.webosphoenix.ongoing/*": () => ({ returnValue: true }),
                "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
                ["luna://" + SERVICE + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
            }
        });
        const clients = opts.clients ?? { box: { ...fake.clients().box, relay: true } };
        methods = kit.createConnectorService(drives, {
            luna: bus, request, periodicSync: false, files: { size: async () => 0, read: async () => new Uint8Array(0), write: async () => {}, rename: async () => {}, remove: async () => {} },
            systemConfig: async (name: string) => (name === "drives/clients.json" ? clients : null)
        });
        return { methods, keys, relayed, accounts, credentials, account, oauth, state: () => accountState };
    }

    it("signs in to Box and refreshes through the relay; the secret never reaches the device", async () => {
        const w = world();
        expect((await w.methods.providerInfo({ templateId: drives.TEMPLATES.box })).available).toBe(true);
        const r = await w.methods.signIn({ templateId: drives.TEMPLATES.box });
        expect(r.returnValue, JSON.stringify(r) + "\n" + log.slice(-2000)).toBe(true);
        expect(r.username).toBe("phoenix@box.test");
        expect(w.relayed[0]).toMatchObject({ provider: "box", step: "exchange", redirectUri: "http://127.0.0.1:47613/oauth/callback" });
        const key = w.keys["key:" + r.credentials.common.oauthKey];
        expect(key).toMatchObject({ owner: SERVICE, relay: "box", clientSecret: "", accessToken: expect.stringMatching(/^at-box-/) });

        // The drive's files with that token; an expired one is renewed through the relay.
        const accountId = "acct-box";
        const t = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "accounts", drives.TEMPLATES.box, drives.TEMPLATES.box + ".json"), "utf8"));
        w.accounts[accountId] = { _id: accountId, templateId: t.templateId, username: r.username, capabilityProviders: t.capabilityProviders };
        w.credentials[accountId] = r.credentials;
        expect((await w.methods.onCreate({ accountId, config: r.config })).returnValue).toBe(true);
        expect((await w.methods.listFiles({ accountId, path: "/Photos" })).entries.map((e: any) => e.name).sort()).toEqual(["hills.png", "lake.png"]);
        fake.expireTokens();
        key.expiresAt = 1;
        expect((await w.methods.listFiles({ accountId, path: "/" })).returnValue).toBe(true);
        expect(w.relayed[w.relayed.length - 1]).toMatchObject({ provider: "box", step: "refresh" });
        expect(key.accessToken).toMatch(/^at-box-/);

        expect(JSON.stringify(w.keys) + JSON.stringify(w.relayed) + JSON.stringify(r)).not.toContain(secret);
        // The server did both; its log has no secret, code or token.
        expect(log).toContain("/v1/oauth-broker/box/exchange");
        expect(log).toContain("/v1/oauth-broker/box/refresh");
        expect(log).not.toContain(secret);
        expect(log).not.toContain(w.relayed[0].code);
        expect(log).not.toContain(key.accessToken);
    });

    it("refuses a device without its Phoenix token, and a refused code is a refused sign-in", async () => {
        const anonymous = world({ phoenixToken: "not-a-token" });
        const r = await anonymous.methods.signIn({ templateId: drives.TEMPLATES.box });
        expect(r.returnValue).toBe(false);
        expect(Object.keys(anonymous.keys)).toEqual([]);
        // The stand-in refuses Phoenix's own secret (invalid_client: rotated at Box): the server's to fix,
        // so not "sign in again" (401_UNAUTHORIZED) here, and the server's log says so.
        fake.boxSecret = "rotated";
        const w = world();
        expect(await w.methods.signIn({ templateId: drives.TEMPLATES.box })).toMatchObject({ returnValue: false, errorCode: "500_SERVER_ERROR" });
        expect(Object.keys(w.keys)).toEqual([]);
        expect(log).toContain("the provider refused Phoenix");
    });

    // A signed-in Box account whose token has expired, with its own Phoenix account (the relay's limits are per account).
    async function signedInBox(opts: { clients?: any } = {}) {
        const w = world({ phoenixToken: mint(), ...opts });
        const r = await w.methods.signIn({ templateId: drives.TEMPLATES.box });
        expect(r.returnValue, JSON.stringify(r) + "\n" + log.slice(-2000)).toBe(true);
        const accountId = "acct-" + crypto.randomBytes(4).toString("hex");
        const t = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "accounts", drives.TEMPLATES.box, drives.TEMPLATES.box + ".json"), "utf8"));
        w.accounts[accountId] = { _id: accountId, templateId: t.templateId, username: r.username, capabilityProviders: t.capabilityProviders };
        w.credentials[accountId] = r.credentials;
        expect((await w.methods.onCreate({ accountId, config: r.config })).returnValue).toBe(true);
        const key = w.keys["key:" + r.credentials.common.oauthKey];
        key.expiresAt = 1;
        return { w, r, key, accountId };
    }

    it("a provider that times out, fails, answers HTML, redirects, sends too much or no token: the provider is away, not the sign-in refused", async () => {
        const answers: Record<string, (res: any) => void> = {
            "a 500": (res) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "server_error" })); },
            "HTML": (res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html>Box is down " + secret + "</html>"); },
            "a redirect": (res) => { res.writeHead(302, { Location: fake.origin + "/oauth/box/token-elsewhere" }); res.end(); },
            "no access token": (res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ refresh_token: "rt-x", token_type: "bearer" })); },
            "4 MB": (res) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.write("{\"access_token\":\"at-box-huge\",\"pad\":\"");
                let n = 0;
                const more = () => { while (n < 4096) { n++; if (!res.write("x".repeat(1024))) return void res.once("drain", more); } res.end("\"}"); };
                res.on("error", () => {});
                more();
            },
            "no answer": (res) => { setTimeout(() => res.destroy(), 25000); }
        };
        const { w, key, accountId } = await signedInBox();
        for (const [name, answer] of Object.entries(answers)) {
            fake.boxTokenAnswer = (res: any) => { answer(res); return true; };
            const started = Date.now();
            const l = await w.methods.listFiles({ accountId, path: "/" });
            expect(l, name).toMatchObject({ returnValue: false });
            expect(l.errorCode, name).not.toBe(kit.FILE_ERRORS.AUTH);
            expect(Date.now() - started, name).toBeLessThan(25000);
            // The key keeps its refresh token for the next try.
            expect(key.refreshToken, name).toMatch(/^rt-box-/);
            expect(JSON.stringify(l), name).not.toContain(secret);
        }
        fake.boxTokenAnswer = null;
        expect((await w.methods.listFiles({ accountId, path: "/" })).returnValue).toBe(true);
        expect(log).not.toContain(secret);
        expect(log).not.toContain("at-box-huge");
    }, 120000);

    it("a refresh the provider refuses there flags the account; a removed account stays removed though its refresh was in flight", async () => {
        const a = await signedInBox();
        a.key.refreshToken = "rt-revoked";
        expect(await a.w.methods.listFiles({ accountId: a.accountId, path: "/" })).toMatchObject({ returnValue: false, errorCode: kit.FILE_ERRORS.AUTH });
        expect(await a.w.methods.sync({ accountId: a.accountId })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });

        const b = await signedInBox();
        let answered: () => void = () => {};
        const inFlight = new Promise<void>((r) => { answered = r; });
        fake.boxTokenAnswer = (res: any) => {
            fake.boxTokenAnswer = null;
            // The provider answers only once the account is gone on the device.
            inFlight.then(() => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ access_token: "at-box-late", refresh_token: "rt-box-late", expires_in: 3600 })); });
            return true;
        };
        const keyId = b.r.credentials.common.oauthKey;
        const listing = b.w.methods.listFiles({ accountId: b.accountId, path: "/" });
        for (let i = 0; i < 100 && !b.w.relayed.some((x: any) => x.step === "refresh"); i++) await new Promise((r) => setTimeout(r, 20));
        expect((await b.w.oauth.forget({ keyId }, SERVICE)).returnValue).toBe(true);
        answered();
        expect((await listing).returnValue).toBe(false);
        expect(b.w.keys["key:" + keyId]).toBeUndefined();
        expect(JSON.stringify(b.w.keys)).not.toContain("at-box-late");
    }, 60000);

    it("signed out of Phoenix while a refresh is in flight: that refresh lands, the next is refused with a reason, the account is not flagged", async () => {
        const { w, key, accountId } = await signedInBox();
        let release: () => void = () => {};
        const held = new Promise<void>((r) => { release = r; });
        fake.boxTokenAnswer = (res: any, f: URLSearchParams) => {
            fake.boxTokenAnswer = null;
            held.then(() => {
                const t = { access_token: "at-box-" + crypto.randomBytes(4).toString("hex"), refresh_token: f.get("refresh_token"), token_type: "bearer", expires_in: 3600 };
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(t));
            });
            return true;
        };
        const listing = w.methods.listFiles({ accountId, path: "/" });
        for (let i = 0; i < 100 && !w.relayed.some((x: any) => x.step === "refresh"); i++) await new Promise((r) => setTimeout(r, 20));
        expect((await w.account.signOut({}, "org.webosphoenix.settings")).returnValue).toBe(true);
        release();
        await listing;
        expect(key.accessToken).toMatch(/^at-box-/);
        key.expiresAt = 1;
        const l = await w.methods.listFiles({ accountId, path: "/" });
        expect(l).toMatchObject({ returnValue: false, errorText: expect.stringMatching(/Phoenix/) });
        expect(l.errorCode).not.toBe(kit.FILE_ERRORS.AUTH);
        const s = await w.methods.sync({ accountId });
        expect(s.returnValue).toBe(false);
        expect(s.errorCode).not.toBe("401_UNAUTHORIZED");
        expect(key.refreshToken).toMatch(/^rt-box-/);
    }, 60000);

    it("the relay unreachable: a quick, clear failure; a secret left in clients.json is never sent", async () => {
        const dead = "http://127.0.0.1:" + (await freePort()) + "/";
        const w = world({ servers: JSON.stringify(JSON.parse(serversJson)).split(api).join(dead), clients: { box: { ...fake.clients().box, relay: true, clientSecret: "stray-secret-in-the-file" } } });
        const started = Date.now();
        const r = await w.methods.signIn({ templateId: drives.TEMPLATES.box });
        expect(r).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED", errorText: expect.stringMatching(/token relay/) });
        expect(Date.now() - started).toBeLessThan(10000);
        expect(Object.keys(w.keys)).toEqual([]);
        // And with the relay there: signed in through it, the stray secret neither sent to Box nor to the relay.
        fake.tokenForms.length = 0;
        const { w: w2 } = await signedInBox({ clients: { box: { ...fake.clients().box, relay: true, clientSecret: "stray-secret-in-the-file" } } });
        expect(w2.relayed[0]).toMatchObject({ step: "exchange" });
        expect(fake.tokenForms.length).toBeGreaterThan(0);
        expect(JSON.stringify(fake.tokenForms) + JSON.stringify(w2.relayed) + JSON.stringify(w2.keys)).not.toContain("stray-secret-in-the-file");
        expect(log).not.toContain("stray-secret-in-the-file");
    }, 60000);

    it("the relay's per-account limit: a clear wait with the server's Retry-After, no hang, the account not flagged", async () => {
        const { w, key, accountId } = await signedInBox();
        // Spend this Phoenix account's 10 calls a minute (the sign-in was one).
        let limited: any = null;
        for (let i = 0; i < 12 && !limited; i++) {
            const r = await w.account.tokenRelay({ provider: "box", step: "refresh", refreshToken: "rt-not-box-s" }, OAUTH_SERVICE);
            if (r.errorCode === "RATE_LIMITED") limited = r;
        }
        expect(limited).toMatchObject({ returnValue: false, errorCode: "RATE_LIMITED", retryAfter: expect.any(Number) });
        const before = Date.now();
        const l = await w.methods.listFiles({ accountId, path: "/" });
        expect(l).toMatchObject({ returnValue: false, errorCode: kit.FILE_ERRORS.RATE_LIMITED, errorText: expect.stringMatching(/token relay is busy/) });
        expect(l.retryAt).toBeGreaterThan(before);
        expect(l.retryAt).toBeLessThanOrEqual(before + 61000);
        expect(Date.now() - before).toBeLessThan(5000);
        expect(key.refreshToken).toMatch(/^rt-box-/);
        // Until then the account does not ask again.
        expect(await w.methods.sync({ accountId })).toMatchObject({ returnValue: true, skipped: "backoff" });
    }, 60000);
});
