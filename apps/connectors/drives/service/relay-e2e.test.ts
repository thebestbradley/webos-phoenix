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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
            DB_CONNECTION: "sqlite", DB_DATABASE: path.join(tmp, "db.sqlite"), CACHE_STORE: "file", SESSION_DRIVER: "array", QUEUE_CONNECTION: "sync",
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
        phoenixToken = JSON.parse(run([path.join(__dirname, "test", "relay-e2e-mint.php"), PWS])).token;
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
    afterAll(async () => {
        if (php) php.kill();
        if (fake) await fake.stop();
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    function world(opts: { phoenixToken?: string } = {}) {
        const keys: Record<string, any> = {};
        const accountKeys: Record<string, any> = { "account:tokens": { via: "code", accessToken: opts.phoenixToken ?? phoenixToken, refreshToken: null, tokenType: "Bearer", scope: "account", expiresAt: null } };
        let accountState: any = { signedIn: true };
        const account = accountLib.createAccountService({
            request: (req: any) => device.request(req),
            requestBytes: (req: any) => device.request(req),
            luna: { call: async () => ({ returnValue: true }) },
            keystore: { get: async (k: string) => accountKeys[k], put: async (k: string, v: any) => { accountKeys[k] = v; }, del: async (k: string) => { delete accountKeys[k]; } },
            state: { load: () => accountState, save: (o: any) => { accountState = o; } },
            servers: () => platform.load({ image: () => serversJson, override: () => null }),
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
        const clients = { box: { ...fake.clients().box, relay: true } };
        methods = kit.createConnectorService(drives, {
            luna: bus, request, periodicSync: false, files: { size: async () => 0, read: async () => new Uint8Array(0), write: async () => {}, rename: async () => {}, remove: async () => {} },
            systemConfig: async (name: string) => (name === "drives/clients.json" ? clients : null)
        });
        return { methods, keys, relayed, accounts, credentials };
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
        // The stand-in refuses Phoenix's secret: PROVIDER_REFUSED there, 401_UNAUTHORIZED here.
        fake.boxSecret = "rotated";
        try {
            const w = world();
            expect(await w.methods.signIn({ templateId: drives.TEMPLATES.box })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        } finally {
            fake.boxSecret = secret;
        }
    });
});
