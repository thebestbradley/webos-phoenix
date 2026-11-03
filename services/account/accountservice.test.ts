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
let devicePublicKey: string;

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
            deviceKey: async () => devicePublicKey,
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
    devicePublicKey = crypto.randomBytes(32).toString("base64");
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

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

describe("sign-in lifecycle", () => {
    it("an old session ending does not cancel a newer authorization awaiting approval", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            if (String(req.body).includes("grant_type=refresh_token")) {
                entered.resolve(); await release.promise;
                return { status: 400, body: JSON.stringify({ error: "invalid_grant" }) };
            }
            return device.request(req);
        } });
        await signedIn(svc);
        clock += 2 * 3600 * 1000;
        const old = svc.devices({}, "org.webosphoenix.settings");
        await entered.promise;
        const next = await svc.signIn({}, "org.webosphoenix.settings");
        release.resolve();
        expect(await old).toMatchObject({ errorCode: "SIGNED_OUT" });
        expect(await svc.getStatus({})).toMatchObject({ state: "signingIn", signIn: { userCode: next.signIn.userCode }, error: null });
        mock.approve(next.signIn.userCode);
        await until(async () => (await svc.getStatus({})).state === "signedIn");
        expect(await svc.getStatus({})).toMatchObject({ state: "signedIn", error: null });
        expect(mock.state.refresh.has(keystore["account:tokens"].refreshToken)).toBe(true);
    });

    it("cancel before approval preserves an existing signed-in account", async () => {
        const svc = service();
        await signedIn(svc);
        const token = { ...keystore["account:tokens"] };
        const profile = { ...state.account };
        await svc.signIn({}, "org.webosphoenix.settings");
        expect(await svc.cancelSignIn({}, "org.webosphoenix.settings")).toMatchObject({ state: "signedIn", account: profile });
        expect(keystore["account:tokens"]).toEqual(token);
    });

    it("a failed initial key-store write revokes the newly issued grant", async () => {
        let runPoll!: () => Promise<void>, issuedRefresh: string | undefined;
        const svc = service({
            timers: { set: (fn: () => Promise<void>) => { runPoll = fn; return 1; }, clear: () => {} },
            keystore: {
                get: async (id: string) => keystore[id],
                put: async (_id: string, value: Any) => { issuedRefresh = value.refreshToken; throw new Error("Key store unavailable"); },
                del: async (id: string) => { delete keystore[id]; },
            },
        });
        const st = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(st.signIn.userCode);
        await runPoll();
        // The local failure is visible before asynchronous revocation finishes.
        await until(async () => !mock.state.refresh.has(issuedRefresh));
        expect(issuedRefresh).toEqual(expect.any(String));
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", error: { errorText: "Key store unavailable" } });
    });

    it("an incomplete browser authorization reply never creates a credential record", async () => {
        const svc = service({ luna: { call: async () => ({ returnValue: true }) } });
        expect(await svc.signIn({ method: "browser" }, "org.webosphoenix.settings")).toMatchObject({ errorCode: "BAD_SERVER" });
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", signIn: null });
    });

    it("revokes a device grant approved while its response was being canceled", async () => {
        const entered = deferred(), release = deferred();
        let runPoll!: () => Promise<void>, issuedRefresh: string | undefined;
        const svc = service({
            timers: { set: (fn: () => Promise<void>) => { runPoll = fn; return 1; }, clear: () => {} },
            request: async (req: Any) => {
                const response = await device.request(req);
                if (String(req.body).includes("device_code") && req.url.endsWith("oauth/token") && response.status === 200) {
                    issuedRefresh = JSON.parse(response.body).refresh_token;
                    entered.resolve(); await release.promise;
                }
                return response;
            },
        });
        const st = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(st.signIn.userCode);
        const finishing = runPoll();
        await entered.promise;
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
        release.resolve();
        await finishing;
        expect(issuedRefresh).toEqual(expect.any(String));
        expect(mock.state.refresh.has(issuedRefresh)).toBe(false);
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", error: null });
    });

    it("cancel orders a started initial token write before deletion and revocation", async () => {
        const entered = deferred(), release = deferred();
        let runPoll!: () => Promise<void>, issuedRefresh: string | undefined;
        const svc = service({
            timers: { set: (fn: () => Promise<void>) => { runPoll = fn; return 1; }, clear: () => {} },
            keystore: {
                get: async (id: string) => keystore[id],
                put: async (id: string, value: Any) => {
                    if (id === "account:tokens") {
                        issuedRefresh = value.refreshToken;
                        entered.resolve(); await release.promise;
                    }
                    keystore[id] = value;
                },
                del: async (id: string) => { delete keystore[id]; },
            },
        });
        const st = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(st.signIn.userCode);
        const finishing = runPoll();
        await entered.promise;
        const canceled = svc.cancelSignIn({}, "org.webosphoenix.settings");
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", signIn: null });
        release.resolve();
        await canceled;
        await finishing;
        expect(issuedRefresh).toEqual(expect.any(String));
        expect(mock.state.refresh.has(issuedRefresh)).toBe(false);
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", error: null });
    });

    it("cancel during entitlement verification cannot restore signed-in state or cached claims", async () => {
        const entered = deferred(), release = deferred();
        let runPoll!: () => Promise<void>;
        const devicesBefore = [...mock.state.devices.keys()];
        const svc = service({
            timers: { set: (fn: () => Promise<void>) => { runPoll = fn; return 1; }, clear: () => {} },
            crypto: {
                sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
                sha512: async (b: Uint8Array) => { entered.resolve(); await release.promise; return new Uint8Array(crypto.createHash("sha512").update(b).digest()); },
                randomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)),
                deviceKey: async () => crypto.randomBytes(32).toString("base64"),
            },
        });
        const st = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(st.signIn.userCode);
        const finishing = runPoll();
        await entered.promise;
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
        release.resolve();
        await finishing;
        expect(state.entitlements).toBeNull();
        expect([...mock.state.devices.keys()]).toEqual(devicesBefore);
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", error: null });
    });

    it.each([["cancel", "profile"], ["cancel", "registration"], ["reset", "profile"], ["reset", "registration"]])(
        "%s during %s leaves no active grant or registered device", async (action, stage) => {
        const entered = deferred(), release = deferred();
        let runPoll!: () => Promise<void>;
        let issuedRefresh: string | undefined;
        const devicesBefore = [...mock.state.devices.keys()];
        const svc = service({
            timers: { set: (fn: () => Promise<void>) => { runPoll = fn; return 1; }, clear: () => {} },
            request: async (req: Any) => {
                const response = await device.request(req);
                if (String(req.body).includes("grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:device_code")) && response.status === 200)
                    issuedRefresh = JSON.parse(response.body).refresh_token;
                if ((stage === "profile" && req.url.endsWith("v1/me")) ||
                    (stage === "registration" && req.method === "POST" && req.url.endsWith("v1/devices"))) {
                    entered.resolve(); await release.promise;
                }
                return response;
            },
        });
        const st = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(st.signIn.userCode);
        const finishing = runPoll();
        await entered.promise;
        if (action === "reset") {
            devMode = true;
            expect(await svc.setServers({ servers: null }, "org.webosphoenix.settings")).toMatchObject({ returnValue: true });
        } else expect(await svc.cancelSignIn({}, "org.webosphoenix.settings")).toMatchObject({ state: "signedOut" });
        release.resolve();
        await finishing;
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(issuedRefresh).toEqual(expect.any(String));
        expect(mock.state.refresh.has(issuedRefresh)).toBe(false);
        expect([...mock.state.devices.keys()]).toEqual(devicesBefore);
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", account: null, error: null });
    });

    it("sign-out rejects a new sign-in and server switch until disconnect finishes", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            if (req.method === "DELETE") { entered.resolve(); await release.promise; }
            return device.request(req);
        } });
        await signedIn(svc);
        const signOut = svc.signOut({}, "org.webosphoenix.settings");
        await entered.promise;
        expect(await svc.signIn({}, "org.webosphoenix.settings")).toMatchObject({ errorCode: "BUSY" });
        devMode = true;
        expect(await svc.setServers({ servers: null }, "org.webosphoenix.settings")).toMatchObject({ errorCode: "BUSY" });
        release.resolve();
        expect(await signOut).toMatchObject({ state: "signedOut" });
        expect(await svc.signIn({}, "org.webosphoenix.settings")).toMatchObject({ state: "signingIn" });
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
    });

    it("reserves an attempt before discovery so a second sign-in is busy", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            if (req.url.endsWith("openid-configuration")) { entered.resolve(); await release.promise; }
            return device.request(req);
        } });
        const first = svc.signIn({}, "org.webosphoenix.settings");
        await entered.promise;
        const second = svc.signIn({}, "org.webosphoenix.settings");
        release.resolve();
        expect(await second).toMatchObject({ errorCode: "BUSY" });
        expect(await first).toMatchObject({ state: "signingIn" });
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
    });

    it("cancel prevents a late device-code response from reopening sign-in", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            const result = await device.request(req);
            if (req.url.endsWith("oauth/device/code")) { entered.resolve(); await release.promise; }
            return result;
        } });
        const signIn = svc.signIn({}, "org.webosphoenix.settings");
        await entered.promise;
        expect(await svc.cancelSignIn({}, "org.webosphoenix.settings")).toMatchObject({ state: "signedOut" });
        release.resolve();
        expect(await signIn).toMatchObject({ errorCode: "CANCELED" });
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", signIn: null });
    });

    it.each([true, false])("a late browser result cannot replace a newer device-code attempt (success: %s)", async (success) => {
        const entered = deferred(), release = deferred();
        const forgotten: string[] = [];
        const svc = service({ luna: { call: async (uri: string, params: Any) => {
            if (uri.endsWith("/authorize")) {
                entered.resolve(); await release.promise;
                return success ? { returnValue: true, keyId: "late-browser-key" } : { returnValue: false, errorCode: "ACCESS_DENIED" };
            }
            if (uri.endsWith("/forget")) forgotten.push(params.keyId);
            return { returnValue: true };
        } } });
        const browser = svc.signIn({ method: "browser" }, "org.webosphoenix.settings");
        await entered.promise;
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
        const next = await svc.signIn({}, "org.webosphoenix.settings");
        release.resolve();
        expect(await browser).toMatchObject({ errorCode: "CANCELED" });
        expect(await svc.getStatus({})).toMatchObject({ state: "signingIn", signIn: { userCode: next.signIn.userCode }, error: null });
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(forgotten).toEqual(success ? ["late-browser-key"] : []);
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
    });

    it("sign-out stops device-code polling before approval arrives", async () => {
        const svc = service();
        const signingIn = await svc.signIn({}, "org.webosphoenix.settings");
        expect(await svc.signOut({}, "org.webosphoenix.settings")).toMatchObject({ state: "signedOut", signIn: null });
        mock.approve(signingIn.signIn.userCode);
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut" });
        expect(keystore["account:tokens"]).toBeUndefined();
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
    });

    it("a server reset cancels an outstanding device-code attempt", async () => {
        const svc = service();
        await svc.signIn({}, "org.webosphoenix.settings");
        devMode = true;
        expect(await svc.setServers({ servers: null }, "org.webosphoenix.settings")).toMatchObject({ returnValue: true });
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", signIn: null });
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
    });
});

describe("refresh continuity", () => {
    it("asks the browser OAuth service to refresh after an API denial", async () => {
        keystore["account:tokens"] = { via: "browser", keyId: "browser-account" };
        state = { signedIn: true };
        const requests: Any[] = [];
        const svc = service({
            luna: { call: async (uri: string, params: Any) => {
                expect(uri).toBe("luna://org.webosphoenix.service.oauth/token");
                requests.push(params);
                return { returnValue: true, accessToken: params.refresh ? "new-access" : "old-access" };
            } },
            request: async (req: Any) => req.headers.Authorization === "Bearer new-access"
                ? { status: 200, body: JSON.stringify({ items: [] }) }
                : { status: 401, body: JSON.stringify({ error: "invalid_token" }) },
        });
        expect(await svc.devices({}, "org.webosphoenix.settings")).toMatchObject({ returnValue: true, items: [] });
        expect(requests).toEqual([{ keyId: "browser-account" }, { keyId: "browser-account", refresh: true }]);
        expect(keystore["account:tokens"]).toEqual({ via: "browser", keyId: "browser-account" });
    });

    it("a late 401 reuses the replacement token instead of rotating it again", async () => {
        const entered = deferred(), release = deferred();
        let holdDevices = true, rotations = 0;
        const svc = service({ request: async (req: Any) => {
            if (String(req.body).includes("grant_type=refresh_token")) rotations++;
            if (holdDevices && req.url.endsWith("v1/me/devices")) {
                holdDevices = false;
                entered.resolve();
                await release.promise;
                return { status: 401, body: JSON.stringify({ error: "invalid_token" }) };
            }
            return device.request(req);
        } });
        await signedIn(svc);
        const read = svc.devices({}, "org.webosphoenix.settings");
        await entered.promise;
        clock += 2 * 3600 * 1000;
        expect(await svc.backupSummary({}, "org.webosphoenix.settings")).toMatchObject({ returnValue: true });
        expect(rotations).toBe(1);
        release.resolve();
        expect(await read).toMatchObject({ returnValue: true });
        expect(rotations).toBe(1);
    });

    it("a late API denial cannot sign out a newer session", async () => {
        const entered = deferred(), release = deferred();
        let holdDevices = true;
        const svc = service({ request: async (req: Any) => {
            if (holdDevices && req.url.endsWith("v1/me/devices")) {
                holdDevices = false;
                entered.resolve();
                await release.promise;
                return { status: 401, body: JSON.stringify({ error: "invalid_token" }) };
            }
            return device.request(req);
        } });
        await signedIn(svc);
        const read = svc.devices({}, "org.webosphoenix.settings");
        await entered.promise;
        await signedIn(svc);
        const replacement = { ...keystore["account:tokens"] };
        release.resolve();
        expect(await read).toMatchObject({ errorCode: "SIGNED_OUT" });
        expect(keystore["account:tokens"]).toEqual(replacement);
        expect(await svc.getStatus({})).toMatchObject({ state: "signedIn", error: null });
    });

    it("releases a failed shared refresh so a later request can retry", async () => {
        const entered = deferred(), release = deferred();
        let rotations = 0;
        const svc = service({ request: async (req: Any) => {
            if (String(req.body).includes("grant_type=refresh_token") && ++rotations === 1) {
                entered.resolve();
                await release.promise;
                throw new Error("offline before sending");
            }
            return device.request(req);
        } });
        await signedIn(svc);
        clock += 2 * 3600 * 1000;
        const reads = Promise.all([svc.devices({}, "org.webosphoenix.settings"), svc.backupSummary({}, "org.webosphoenix.settings")]);
        await entered.promise;
        release.resolve();
        for (const result of await reads) expect(result).toMatchObject({ errorCode: "CONNECTION_FAILED" });
        expect(rotations).toBe(1);
        expect(await svc.devices({}, "org.webosphoenix.settings")).toMatchObject({ returnValue: true });
        expect(rotations).toBe(2);
    });

    it("orders a delayed key-store write before clearing the session", async () => {
        const entered = deferred(), release = deferred();
        let holdWrite = false;
        const overrideWritten = deferred();
        const svc = service({
            override: { read: () => override, write: (value: Any) => { override = value; overrideWritten.resolve(); } },
            keystore: {
            get: async (id: string) => keystore[id],
            put: async (id: string, value: Any) => {
                if (holdWrite && id === "account:tokens") {
                    entered.resolve();
                    await release.promise;
                }
                keystore[id] = value;
            },
            del: async (id: string) => { delete keystore[id]; },
        } });
        await signedIn(svc);
        holdWrite = true;
        clock += 2 * 3600 * 1000;
        const read = svc.refresh({});
        await entered.promise;
        devMode = true;
        const cleared = svc.setServers({ servers: null }, "org.webosphoenix.settings");
        await overrideWritten.promise;
        release.resolve();
        await cleared;
        await read;
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut" });
    });

    it("sign-out removes a pair rotated by another in-flight request", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            const response = await device.request(req);
            if (String(req.body).includes("grant_type=refresh_token")) {
                entered.resolve();
                await release.promise;
            }
            return response;
        } });
        const st = await signedIn(svc);
        clock += 2 * 3600 * 1000;
        const read = svc.devices({}, "org.webosphoenix.settings");
        await entered.promise;
        const signedOut = svc.signOut({}, "org.webosphoenix.settings");
        release.resolve();
        await read;
        expect(await signedOut).toMatchObject({ state: "signedOut" });
        expect(mock.state.devices.has(st.device.id)).toBe(false);
        expect(keystore["account:tokens"]).toBeUndefined();
    });

    it("shares one rotation across simultaneous expired-token requests", async () => {
        const entered = deferred(), release = deferred();
        let rotations = 0;
        const svc = service({ request: async (req: Any) => {
            const response = await device.request(req);
            if (String(req.body).includes("grant_type=refresh_token")) {
                rotations++;
                entered.resolve();
                await release.promise;
            }
            return response;
        } });
        await signedIn(svc);
        clock += 2 * 3600 * 1000;
        const reads = Promise.all([svc.devices({}, "org.webosphoenix.settings"), svc.backupSummary({}, "org.webosphoenix.settings")]);
        await entered.promise;
        release.resolve();
        for (const result of await reads) expect(result.returnValue).toBe(true);
        expect(rotations).toBe(1);
        expect(await svc.getStatus({})).toMatchObject({ state: "signedIn" });
        expect(mock.state.refresh.has(keystore["account:tokens"].refreshToken)).toBe(true);
    });

    it("does not restore tokens after the server configuration clears the session", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            const response = await device.request(req);
            if (String(req.body).includes("grant_type=refresh_token")) {
                entered.resolve();
                await release.promise;
            }
            return response;
        } });
        await signedIn(svc);
        clock += 2 * 3600 * 1000;
        const read = svc.refresh({});
        await entered.promise;
        devMode = true;
        expect(await svc.setServers({ servers: null }, "org.webosphoenix.settings")).toMatchObject({ returnValue: true });
        release.resolve();
        expect(await read).toMatchObject({ errorCode: "SIGNED_OUT" });
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut", account: null });
    });

    it.each([200, 400])("an old refresh reply (%s) cannot overwrite or clear a newer sign-in", async (responseStatus) => {
        const entered = deferred(), release = deferred();
        const svc = service({ request: async (req: Any) => {
            const response = await device.request(req);
            if (String(req.body).includes("grant_type=refresh_token")) {
                entered.resolve();
                await release.promise;
                return responseStatus === 400 ? { status: 400, body: JSON.stringify({ error: "invalid_grant" }) } : response;
            }
            return response;
        } });
        await signedIn(svc);
        clock += 2 * 3600 * 1000;
        const read = svc.devices({}, "org.webosphoenix.settings");
        await entered.promise;
        await signedIn(svc);
        const replacement = { ...keystore["account:tokens"] };
        release.resolve();
        expect(await read).toMatchObject({ errorCode: "SIGNED_OUT" });
        expect(keystore["account:tokens"]).toEqual(replacement);
        expect(await svc.getStatus({})).toMatchObject({ state: "signedIn", error: null });
    });
});

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
    it("does not expose the old backup password while a replacement sign-in is committing", async () => {
        const entered = deferred(), release = deferred();
        let holdProfile = false;
        const svc = service({ request: async (req: Any) => {
            if (holdProfile && req.url.endsWith("v1/me")) { entered.resolve(); await release.promise; }
            return device.request(req);
        } });
        await signedIn(svc);
        await svc.backupCredentials({}, "org.webosphoenix.service.backup");
        holdProfile = true;
        const attempt = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(attempt.signIn.userCode);
        await entered.promise;
        const result = await svc.backupCredentials({}, "org.webosphoenix.service.backup");
        release.resolve();
        await until(async () => (await svc.getStatus({})).state === "signedIn");
        expect(result).toMatchObject({ returnValue: false, errorCode: "SIGNED_OUT" });
    });

    it("links a replacement grant to the existing device when the same account signs in again", async () => {
        const svc = service();
        const first = await signedIn(svc);
        const token = keystore["account:tokens"].accessToken;
        const next = await signedIn(svc);
        expect(keystore["account:tokens"].accessToken).not.toBe(token);
        expect(next.device.id).toBe(first.device.id);
        expect(mock.state.tokens.get(keystore["account:tokens"].accessToken).device).toBe(next.device.id);
        const list = await svc.devices({}, "org.webosphoenix.settings");
        expect(list.items).toContainEqual(expect.objectContaining({ id: next.device.id, current: true }));
    });

    it("canceling a replacement registration preserves the previously linked device and grant", async () => {
        const entered = deferred(), release = deferred();
        let holdRegistration = false;
        const svc = service({ request: async (req: Any) => {
            const response = await device.request(req);
            if (holdRegistration && req.method === "POST" && req.url.endsWith("v1/devices")) {
                entered.resolve(); await release.promise;
            }
            return response;
        } });
        const first = await signedIn(svc);
        const oldRefresh = keystore["account:tokens"].refreshToken;
        holdRegistration = true;
        const attempt = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(attempt.signIn.userCode);
        await entered.promise;
        const replacementRefresh = keystore["account:tokens"].refreshToken;
        await svc.cancelSignIn({}, "org.webosphoenix.settings");
        release.resolve();
        await until(async () => !mock.state.refresh.has(replacementRefresh));
        expect(mock.state.devices.has(first.device.id)).toBe(true);
        expect(mock.state.refresh.has(oldRefresh)).toBe(true);
        expect(await svc.getStatus({})).toMatchObject({ state: "signedOut" });
    });

    it("does not reuse backup credentials after another device sign-in", async () => {
        const svc = service();
        await signedIn(svc);
        const first = await svc.backupCredentials({}, "org.webosphoenix.service.backup");
        mock.state.users.u_backup_other = { ...mock.state.users.u_test, id: "u_backup_other", email: "other@example.org" };
        const attempt = await svc.signIn({}, "org.webosphoenix.settings");
        mock.approve(attempt.signIn.userCode, "u_backup_other");
        await until(async () => (await svc.getStatus({})).state === "signedIn");
        const next = await svc.getStatus({});
        const second = await svc.backupCredentials({}, "org.webosphoenix.service.backup");
        expect(second).toMatchObject({ returnValue: true, username: next.device.id });
        expect(second.username).not.toBe(first.username);
    });

    it("shares concurrent backup credential requests within one device session", async () => {
        let requests = 0;
        const svc = service({ request: async (req: Any) => {
            if (req.url.endsWith("v1/backup/credentials")) requests++;
            return device.request(req);
        } });
        await signedIn(svc);
        const results = await Promise.all(Array.from({ length: 5 }, () => svc.backupCredentials({}, "org.webosphoenix.service.backup")));
        expect(results.every((result) => result.returnValue)).toBe(true);
        expect(new Set(results.map((result) => result.password)).size).toBe(1);
        expect(requests).toBe(1);
    });

    it("clears a backup write that was already started when the platform is reset", async () => {
        const entered = deferred(), release = deferred();
        const svc = service({ keystore: {
            get: async (id: string) => keystore[id],
            put: async (id: string, value: Any) => {
                if (id === "account:backup") { entered.resolve(); await release.promise; }
                keystore[id] = value;
            },
            del: async (id: string) => { delete keystore[id]; },
        } });
        await signedIn(svc);
        const pendingBackup = svc.backupCredentials({}, "org.webosphoenix.service.backup");
        await entered.promise;
        devMode = true;
        const reset = svc.setServers({ servers: mock.servers("root") }, "org.webosphoenix.settings");
        await until(async () => calls.some((call) => call.uri.endsWith("/getDevMode")));
        release.resolve();
        await reset;
        expect(await pendingBackup).toMatchObject({ returnValue: false, errorCode: "SIGNED_OUT" });
        expect(keystore["account:backup"]).toBeUndefined();
    });

    it("does not return a delayed cached backup password after sign-out", async () => {
        const entered = deferred(), release = deferred();
        let delay = false;
        const svc = service({ keystore: {
            get: async (id: string) => {
                const value = keystore[id];
                if (id === "account:backup" && delay) { entered.resolve(); await release.promise; }
                return value;
            },
            put: async (id: string, value: Any) => { keystore[id] = value; },
            del: async (id: string) => { delete keystore[id]; },
        } });
        await signedIn(svc);
        await svc.backupCredentials({}, "org.webosphoenix.service.backup");
        delay = true;
        const pendingBackup = svc.backupCredentials({}, "org.webosphoenix.service.backup");
        await entered.promise;
        await svc.signOut({}, "org.webosphoenix.settings");
        release.resolve();
        expect(await pendingBackup).toMatchObject({ returnValue: false, errorCode: "SIGNED_OUT" });
    });

    it("refuses a leftover cached password without a linked session", async () => {
        const svc = service();
        keystore["account:backup"] = { url: mock.api + "dav/backups/old/", username: "old", password: "old-secret" };
        expect(await svc.backupCredentials({}, "org.webosphoenix.service.backup")).toMatchObject({ errorCode: "SIGNED_OUT" });
    });

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
