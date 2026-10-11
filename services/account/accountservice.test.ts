// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.account (accountservice.js) against the mock
// platform (tools/platform-mock/server.cjs): not set up without a server,
// the device authorization grant (approve, deny, slow_down, expiry),
// the device's registration, signed entitlements and their offline grace,
// the cloud clients, Developer Mode's override, who may call what.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const account = require("./accountservice.js") as Any;
const platform = require("@phoenix/platform") as Any;
const device = require("@phoenix/platform/src/device.js") as Any;
const mockLib = require("../../tools/platform-mock/server.cjs") as Any;

let mock: Any;
let keystore: Record<string, Any>;
let state: Any;
let override: Any;
let devMode: boolean;
let calls: { uri: string; params: Any }[];
let image: Any;
let clock: number;
let offline: boolean;

function service(extra: Any = {}) {
    return account.createAccountService(Object.assign({
        request: (req: Any) => offline ? Promise.reject(new Error("offline")) : device.request(req),
        requestBytes: (req: Any) => offline ? Promise.reject(new Error("offline")) : device.request(req),
        luna: { call: async (uri: string, params: Any) => {
            calls.push({ uri, params });
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: devMode ? "enabled" : "disabled" };
            return { returnValue: true };
        } },
        keystore: { get: async (id: string) => keystore[id], put: async (id: string, v: Any) => { keystore[id] = v; }, del: async (id: string) => { delete keystore[id]; } },
        state: { load: () => state && JSON.parse(JSON.stringify(state)), save: (o: Any) => { state = JSON.parse(JSON.stringify(o)); } },
        servers: () => platform.load({ image: () => image, override: () => override, devMode: () => devMode }),
        override: { read: () => override, write: (o: Any) => { override = o; } },
        crypto: {
            sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
            sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()),
            randomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)),
            deviceKey: async () => crypto.randomBytes(32).toString("base64"),
        },
        device: async () => ({ name: "Test TouchPad", model: "test", compatible: "phoenix-test", osVersion: "1.0.0", build: 100 }),
        // Polls at once: the mock's interval is 0.
        timers: { set: (fn: () => void) => setTimeout(fn, 5), clear: (h: Any) => clearTimeout(h) },
        now: () => new Date(clock),
    }, extra));
}
const until = async (fn: () => Promise<boolean>, ms = 5000) => {
    const end = Date.now() + ms;
    while (!(await fn())) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); }
};

beforeAll(async () => { mock = await mockLib.start({ interval: 0 }); });
afterAll(async () => { await mock.close(); });
beforeEach(() => {
    keystore = {};
    state = null;
    override = null;
    devMode = false;
    calls = [];
    clock = Date.now();
    offline = false;
    image = JSON.stringify(mock.servers("root"));
});

async function signedIn(svc: Any) {
    const st = await svc.signIn({ method: "code" }, "org.webosphoenix.settings");
    expect(st).toMatchObject({ state: "signingIn", signIn: { method: "code", userCode: expect.stringMatching(/^[0-9A-F]{4}-[0-9A-F]{4}$/) } });
    expect(st.signIn.verificationUriComplete).toBe(mock.url + "/account/link?user_code=" + st.signIn.userCode);
    mock.approve(st.signIn.userCode);
    await until(async () => (await svc.getStatus({})).state === "signedIn");
    return svc.getStatus({});
}

describe("not set up", () => {
    it("without an account server everything says NOT_SET_UP, and nothing is asked of the network", async () => {
        image = JSON.stringify({ format: 1, feeds: "http://127.0.0.1:1/", api: null });
        const svc = service({ request: () => { throw new Error("no network expected"); } });
        expect(await svc.getStatus({})).toMatchObject({ state: "notSetUp", account: null, services: null });
        for (const m of ["signIn", "entitlements", "backupSummary", "pushRegister", "assistantProvider"])
            expect(await svc[m]({ provider: "graph" })).toMatchObject({ returnValue: false, errorCode: expect.stringMatching(/NOT_SET_UP|BAD_PARAMS/) });
        expect(await svc.signIn({})).toMatchObject({ errorCode: "NOT_SET_UP" });
    });
});

describe("signing in with a code (RFC 8628)", () => {
    it("shows the code, polls, registers the device and reads the signed entitlements", async () => {
        const svc = service();
        const st = await signedIn(svc);
        expect(st.account).toMatchObject({ id: "u_test", email: "test@example.org", plan: "cloud" });
        expect(st.device.id).toMatch(/^d_/);
        expect(st.entitlements).toMatchObject({ plan: "cloud", verified: true, current: true, features: { backup: { quotaBytes: expect.any(Number) } } });
        expect(mock.state.devices.get(st.device.id)).toMatchObject({ name: "Test TouchPad", compatible: "phoenix-test", build: 100 });
        expect(keystore["account:tokens"]).toMatchObject({ via: "code", accessToken: expect.stringMatching(/^at_/) });
        expect(JSON.stringify(state)).not.toMatch(/at_|rt_/);   // tokens only in the key store
        expect(calls.some((c) => c.uri.endsWith("/createToast") && /Signed in to your Phoenix Account as test@example.org/.test(c.params.message))).toBe(true);
    });

    it("turned down, or expired, says so", async () => {
        const svc = service();
        const st = await svc.signIn({}, "org.webosphoenix.settings");
        mock.deny(st.signIn.userCode);
        await until(async () => (await svc.getStatus({})).state === "signedOut");
        expect((await svc.getStatus({})).error).toMatchObject({ errorCode: "ACCESS_DENIED" });
        await svc.signIn({}, "org.webosphoenix.settings");
        clock += 11 * 60 * 1000;
        await until(async () => (await svc.getStatus({})).state === "signedOut");
        expect((await svc.getStatus({})).error).toMatchObject({ errorCode: "EXPIRED" });
    });

    it("refreshes an expired access token (rotating the refresh token), and a refused one signs out", async () => {
        const svc = service();
        await signedIn(svc);
        const first = keystore["account:tokens"];
        clock += 2 * 3600 * 1000;
        expect(await svc.refresh({})).toMatchObject({ state: "signedIn" });
        expect(keystore["account:tokens"].refreshToken).not.toBe(first.refreshToken);
        expect(mock.state.refresh.has(first.refreshToken)).toBe(false);
        mock.state.refresh.clear();
        clock += 2 * 3600 * 1000;
        expect(await svc.refresh({})).toMatchObject({ errorCode: "SIGNED_OUT" });
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", error: { errorCode: "SIGNED_OUT" } });
    });

    it("signing out unregisters the device and revokes the tokens", async () => {
        const svc = service();
        const st = await signedIn(svc);
        const t = keystore["account:tokens"];
        expect(await svc.signOut({}, "org.webosphoenix.settings")).toMatchObject({ state: "signedOut" });
        expect(mock.state.devices.has(st.device.id)).toBe(false);
        expect(mock.state.refresh.has(t.refreshToken)).toBe(false);
        expect(keystore["account:tokens"]).toBeUndefined();
    });
});

describe("entitlements", () => {
    it("a wrong signature is refused; offline, the kept copy holds through the grace days", async () => {
        const svc = service();
        await signedIn(svc);
        expect(await svc.entitlements({})).toMatchObject({ entitlements: { verified: true } });
        offline = true;
        expect(await svc.entitlements({})).toMatchObject({ entitlements: { offline: true, current: true } });
        clock += 40 * 86400000;
        expect((await svc.entitlements({})).entitlements.current).toBe(false);
        offline = false;
        clock = Date.now();
        const pinned = JSON.parse(image);
        pinned.account.key = platform.b64.toBase64(crypto.randomBytes(32));
        image = JSON.stringify(pinned);
        expect(await svc.entitlements({})).toMatchObject({ errorCode: "BAD_SIGNATURE" });
    });
});

describe("cloud services", () => {
    it("backup credentials (for the backup service only), the summary, push channels, the token relay, the assistant", async () => {
        const svc = service();
        const st = await signedIn(svc);
        expect(await svc.backupCredentials({}, "org.webosphoenix.settings")).toMatchObject({ errorCode: "NOT_ALLOWED" });
        const c = await svc.backupCredentials({}, "org.webosphoenix.service.backup");
        expect(c).toMatchObject({ returnValue: true, url: mock.api + "dav/backups/" + st.device.id + "/", username: st.device.id });
        expect((await svc.backupCredentials({}, "org.webosphoenix.service.backup")).password).toBe(c.password);   // kept, asked once
        const sum = await svc.backupSummary({}, "org.webosphoenix.service.backup");
        expect(sum).toMatchObject({ returnValue: true, quotaBytes: expect.any(Number), usedBytes: expect.any(Number) });
        expect(sum.devices).toContainEqual(expect.objectContaining({ deviceId: st.device.id, name: "Test TouchPad", files: [] }));

        const ep = await svc.pushEndpoint({ app: "com.example.connector" });
        expect(ep.endpoint).toMatch(new RegExp("^" + mock.url + "/push/up[0-9a-f]{32}\\?up=1$"));
        expect((await svc.pushEndpoint({ app: "com.example.connector" })).endpoint).toBe(ep.endpoint);
        const ch = await svc.pushRegister({ provider: "graph", endpoint: "https://push.example.org/upabc?up=1", p256dh: "BPk", auth: "a1" });
        expect(ch).toMatchObject({ returnValue: true, channelId: expect.stringMatching(/^ch_/), url: expect.stringContaining("/relay/graph/") });
        expect(await svc.pushRenew({ channelId: ch.channelId })).toMatchObject({ returnValue: true, expiresAt: expect.any(String) });
        expect(await svc.pushDrop({ channelId: ch.channelId })).toEqual({ returnValue: true });
        expect(await svc.pushRegister({ provider: "slack", endpoint: "https://x", p256dh: "a", auth: "b" })).toMatchObject({ errorCode: "BAD_PARAMS" });

        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        const au = await svc.tokenRelay({ provider: "slack", step: "authorizeUrl", codeChallenge: challenge, state: "s1", redirectUri: "http://127.0.0.1/oauth/callback" });
        const r = await fetch(au.url, { redirect: "manual" });
        const back = new URL(r.headers.get("location")!);
        expect(back.searchParams.get("state")).toBe("s1");
        expect(await svc.tokenRelay({ provider: "slack", step: "redeem", handle: back.searchParams.get("handle"), codeVerifier: "wrong" }))
            .toMatchObject({ errorCode: "BAD_VERIFIER" });
        const tok = await svc.tokenRelay({ provider: "slack", step: "redeem", handle: back.searchParams.get("handle"), codeVerifier: verifier });
        expect(tok).toMatchObject({ returnValue: true, accessToken: expect.stringMatching(/^provider_at_/) });
        expect(mock.state.broker.size).toBe(0);

        expect(await svc.assistantProvider({}, "org.webosphoenix.settings")).toMatchObject({ errorCode: "NOT_ALLOWED" });
        const ap = await svc.assistantProvider({}, "org.webosphoenix.assistant");
        expect(ap).toMatchObject({ baseUrl: mock.api + "v1/assistant/", entitled: true });
        const chat = await fetch(ap.baseUrl + "chat/completions", { method: "POST", headers: { Authorization: "Bearer " + ap.apiKey, "Content-Type": "application/json" },
                                                                    body: JSON.stringify({ model: "phoenix-assistant", messages: [{ role: "user", content: "hi" }] }) });
        expect((await chat.json()).choices[0].message.content).toBe("Mock answer to: hi");
    });
});

describe("Developer Mode's override", () => {
    it("only in Developer Mode; a new server drops the old sign-in", async () => {
        image = JSON.stringify({ format: 1, feeds: "https://feeds.example.org/", api: null });
        const svc = service();
        expect(await svc.setServers({ servers: mock.servers("root") }, "org.webosphoenix.settings")).toMatchObject({ errorCode: "NEEDS_DEVMODE" });
        devMode = true;
        expect(await svc.setServers({ servers: { bogus: true } }, "org.webosphoenix.settings")).toMatchObject({ errorCode: "BAD_PARAMS" });
        const r = await svc.setServers({ servers: mock.servers("root") }, "org.webosphoenix.settings");
        expect(r).toMatchObject({ returnValue: true, devMode: true, servers: { overridden: true, api: mock.api } });
        expect((await svc.getStatus({})).state).toBe("signedOut");
        devMode = false;   // Developer Mode off: the image's servers again
        expect((await svc.getStatus({})).state).toBe("notSetUp");
        devMode = true;
        await signedIn(svc);
        expect((await svc.setServers({ servers: null }, "org.webosphoenix.settings")).servers.overridden).toBe(false);
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.setServers({ servers: null }, "com.example.app")).toMatchObject({ errorCode: "NOT_ALLOWED" });
    });
});
