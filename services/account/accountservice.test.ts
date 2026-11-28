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

    // 26 November 2026: the 2.0 Revision 15 VM image (no RAUC, no device-tree
    // model, BUILD_ID the image's 14-digit DATETIME) and the simulator (osVersion
    // "" before an update slot has a version) were refused with 422; 1.0's images
    // and simulator sent the same.
    it.each([
        ["a VM image", { name: "PINE64 PineTab2", model: "PINE64 PineTab2", compatible: "phoenix-vm-arm64", osVersion: "1.0.0", build: 20261126153551 },
         { name: "PINE64 PineTab2", model: "PINE64 PineTab2", compatible: "phoenix-vm-arm64", osVersion: "1.0.0", build: 20261126153551 }],
        ["a device that could read nothing", { name: "", model: "", compatible: "", osVersion: "", build: 0 },
         { name: "Phoenix device", model: "", compatible: "", osVersion: "", build: 0 }],
        ["the simulator before a slot has a version", { name: "Phoenix Simulator", model: "phoenix-sim", compatible: "phoenix-sim", osVersion: "", build: 0 },
         { name: "Phoenix Simulator", compatible: "phoenix-sim", osVersion: "", build: 0 }],
    ])("registers %s without empty fields", async (_what, dev, stored) => {
        const bodies: Any[] = [];
        const svc = service({
            device: async () => dev,
            request: (req: Any) => {
                if (req.method === "POST" && req.url.endsWith("v1/devices")) bodies.push(JSON.parse(req.body));
                return device.request(req);
            },
        });
        const st = await signedIn(svc);
        expect(bodies).toHaveLength(1);
        expect(Object.values(bodies[0])).not.toContain("");
        expect(bodies[0]).not.toHaveProperty("build", 0);
        expect(mock.state.devices.get(st.device.id)).toMatchObject(stored);
    });

    it("the mock refuses what the platform refuses: empty strings, a compatible with other characters, a build it can't store", async () => {
        await signedIn(service());
        const post = (body: Any) => device.request({
            method: "POST", url: mock.url + "/api/v1/devices", body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + keystore["account:tokens"].accessToken },
        });
        const ok = { publicKey: crypto.randomBytes(32).toString("base64"), name: "x" };
        for (const bad of [{ model: "" }, { osVersion: "" }, { compatible: "" }, { compatible: "pine tab/2" }, { build: 2 ** 53 }, { build: -1 }, { build: 1.5 }])
            expect((await post({ ...ok, ...bad })).status, JSON.stringify(bad)).toBe(422);
        expect((await post({ ...ok, build: 20261126153551 })).status).toBe(201);
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

// The edge cases of signing in, as Phoenix-Web-Services' live run plays them
// against the real platform (its tests/Device/signin-live.cjs): each ends in a
// clear state, signed in with one set of keys or signed out with none left,
// and the copy says what happened and what to do.
describe("signing in: the edge cases", () => {
    const S = "org.webosphoenix.settings";
    const tokenUrl = (req: Any) => req.method === "POST" && /\/oauth\/token$/.test(req.url);
    const statusOf = (svc: Any) => svc.getStatus({}, S);
    afterAll(() => { mock.state.deviceOnly = false; });

    it("two Sign In taps at once are one sign-in: one device code, and the code shown is the one polled", async () => {
        const svc = service();
        const codes = mock.state.deviceCodes.size, devices = mock.state.devices.size;
        const [a, b] = await Promise.all([svc.signIn({ method: "code" }, S), svc.signIn({ method: "code" }, S)]);
        expect(a).toMatchObject({ returnValue: true, state: "signingIn" });
        expect(b).toMatchObject({ returnValue: true, state: "signingIn" });
        expect(b.signIn.userCode).toBe(a.signIn.userCode);
        expect(mock.state.deviceCodes.size).toBe(codes + 1);
        mock.approve(a.signIn.userCode);
        await until(async () => (await statusOf(svc)).state === "signedIn");
        expect(mock.state.devices.size).toBe(devices + 1);
        // A tap on the other way while it starts is BUSY, not a second sign-in.
        await svc.signOut({}, S);
        const [c, d] = await Promise.all([svc.signIn({ method: "code" }, S), svc.signIn({ method: "browser" }, S)]);
        expect(c.returnValue).toBe(true);
        expect(d).toMatchObject({ returnValue: false, errorCode: "BUSY" });
        await svc.cancelSignIn({}, S);
    });

    it("offline when Sign In is tapped: CONNECTION_FAILED that says what to do, without a socket's words", async () => {
        const svc = service();
        offline = true;
        const r = await svc.signIn({ method: "code" }, S);
        expect(r).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED" });
        expect(r.errorText).toMatch(/Check this device's connection and try again/);
        expect(r.errorText).not.toMatch(/offline|ECONN|127\.0\.0\.1/);
        expect((await statusOf(svc)).state).toBe("signedOut");
    });

    it("the network drops mid-poll: it says so and keeps asking; back, the approval is seen and the note goes", async () => {
        const svc = service();
        const st = await svc.signIn({ method: "code" }, S);
        offline = true;
        await until(async () => (await statusOf(svc)).error?.errorCode === "CONNECTION_FAILED");
        const away = await statusOf(svc);
        expect(away.state).toBe("signingIn");
        expect(away.signIn.userCode).toBe(st.signIn.userCode);
        expect(away.error.errorText).toMatch(/still trying/);
        mock.approve(st.signIn.userCode);
        offline = false;
        await until(async () => (await statusOf(svc)).state === "signedIn");
        expect((await statusOf(svc)).error).toBeNull();
    });

    it("500 and 503 from the token endpoint: still waiting, it says the server has trouble, then signs in", async () => {
        let failing = true;
        const svc = service({ request: (req: Any) => failing && tokenUrl(req)
            ? Promise.resolve({ status: (Math.random() < 0.5 ? 500 : 503), headers: { "content-type": "text/html" }, body: "<html>Service Unavailable</html>" })
            : device.request(req) });
        const st = await svc.signIn({ method: "code" }, S);
        await until(async () => (await statusOf(svc)).error?.errorCode === "SERVER_ERROR");
        const s1 = await statusOf(svc);
        expect(s1.state).toBe("signingIn");
        expect(s1.error.errorText).toMatch(/having trouble; still trying/);
        mock.approve(st.signIn.userCode);
        failing = false;
        await until(async () => (await statusOf(svc)).state === "signedIn");
        expect((await statusOf(svc)).error).toBeNull();
        // Cancel takes the note away with the sign-in.
        await svc.signOut({}, S);
        failing = true;
        await svc.signIn({ method: "code" }, S);
        await until(async () => (await statusOf(svc)).error !== null);
        expect(await svc.cancelSignIn({}, S)).toMatchObject({ state: "signedOut", error: null });
    });

    it("never waits past the code's expiry by this device's clock, however long the backoff", async () => {
        const waits: number[] = [];
        const svc = service({
            request: (req: Any) => tokenUrl(req) ? Promise.reject(new Error("offline")) : device.request(req),
            timers: { set: (fn: () => void, ms: number) => { waits.push(ms); return setTimeout(fn, 5); }, clear: (h: Any) => clearTimeout(h) },
        });
        await svc.signIn({ method: "code" }, S);
        await until(async () => waits.length > 6);
        expect(Math.max(...waits)).toBeGreaterThan(5000);   // backing off
        clock += 9 * 60 * 1000 + 59 * 1000;                  // a second of the code left
        const n = waits.length;
        await until(async () => waits.length > n + 1);
        expect(Math.max(...waits.slice(n + 1))).toBeLessThanOrEqual(1000);
        clock += 2000;
        await until(async () => (await statusOf(svc)).state === "signedOut");
        expect((await statusOf(svc)).error).toMatchObject({ errorCode: "EXPIRED", errorText: expect.stringMatching(/sign in again/) });
    });

    it("turned down, expired, or a code the server no longer knows: signed out, and the copy says what to do", async () => {
        let gone = false;
        const svc = service({ request: (req: Any) => gone && tokenUrl(req)
            ? Promise.resolve({ status: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "invalid_grant", error_description: "The provided authorization grant is invalid" }) })
            : device.request(req) });
        let st = await svc.signIn({}, S);
        mock.deny(st.signIn.userCode);
        await until(async () => (await statusOf(svc)).state === "signedOut");
        expect((await statusOf(svc)).error).toMatchObject({ errorCode: "ACCESS_DENIED", errorText: expect.stringMatching(/turned down; sign in again/) });
        await svc.signIn({}, S);
        clock += 11 * 60 * 1000;
        await until(async () => (await statusOf(svc)).state === "signedOut");
        expect((await statusOf(svc)).error).toMatchObject({ errorCode: "EXPIRED", errorText: expect.stringMatching(/expired.*sign in again/) });
        clock = Date.now();
        st = await svc.signIn({}, S);
        gone = true;
        await until(async () => (await statusOf(svc)).state === "signedOut");
        expect((await statusOf(svc)).error).toMatchObject({ errorCode: "EXPIRED", errorText: "This code no longer works; sign in again for a new one." });
    });

    it("Cancel, then the old code approved anyway: the device is not signed in and keeps no tokens", async () => {
        const svc = service();
        const st = await svc.signIn({ method: "code" }, S);
        await svc.cancelSignIn({}, S);
        mock.approve(st.signIn.userCode);
        await new Promise((r) => setTimeout(r, 100));
        expect((await statusOf(svc)).state).toBe("signedOut");
        expect(keystore["account:tokens"]).toBeUndefined();
    });

    it("a sign-in that cannot finish (the account unreadable) revokes the tokens it got and keeps none", async () => {
        const issued: Any[] = [];
        let meDown = true;
        const svc = service({ request: async (req: Any) => {
            if (meDown && /\/v1\/me$/.test(req.url)) throw new Error("connection reset");
            const res = await device.request(req);
            if (tokenUrl(req) && res.status === 200) issued.push(JSON.parse(res.body));
            return res;
        } });
        const st = await svc.signIn({ method: "code" }, S);
        mock.approve(st.signIn.userCode);
        await until(async () => (await statusOf(svc)).state === "signedOut" && issued.length === 1);
        await until(async () => !mock.state.refresh.has(issued[0].refresh_token) && !keystore["account:tokens"]);
        const out = await statusOf(svc);
        expect(out.error).toMatchObject({ errorCode: "CONNECTION_FAILED", errorText: expect.stringMatching(/Check this device's connection/) });
        expect(keystore["account:tokens"]).toBeUndefined();
        meDown = false;
        const again = await svc.signIn({ method: "code" }, S);
        mock.approve(again.signIn.userCode);
        await until(async () => (await statusOf(svc)).state === "signedIn");
    });

    // Seen live against Phoenix-Web-Services under its preview lock: its
    // device-api limit (60 a minute from one address) answered GET /v1/me
    // with 429 while the device finished signing in.
    it("rate limited (429) while finishing: signed out with nothing kept, and the copy says to try again shortly", async () => {
        let limited = true;
        const svc = service({ request: (req: Any) => limited && /\/v1\/me$/.test(req.url)
            ? Promise.resolve({ status: 429, headers: { "content-type": "text/html", "retry-after": "30" }, body: "<html>Too Many Requests</html>" })
            : device.request(req) });
        const st = await svc.signIn({ method: "code" }, S);
        mock.approve(st.signIn.userCode);
        await until(async () => (await statusOf(svc)).state === "signedOut" && !keystore["account:tokens"]);
        expect((await statusOf(svc)).error).toMatchObject({ errorCode: "RATE_LIMITED", errorText: expect.stringMatching(/busy\. Wait a minute, then sign in again/) });
        limited = false;
        const again = await svc.signIn({ method: "code" }, S);
        mock.approve(again.signIn.userCode);
        await until(async () => (await statusOf(svc)).state === "signedIn");
    });

    it("the device removed on the website: the next call signs it out, says so, and nothing is kept", async () => {
        const svc = service();
        const st = await signedIn(svc);
        for (const [t, rec] of mock.state.tokens) if (rec.user === "u_test") mock.state.tokens.delete(t);
        mock.state.refresh.clear();
        expect(await svc.refresh({}, S)).toMatchObject({ returnValue: false, errorCode: "SIGNED_OUT" });
        const out = await statusOf(svc);
        expect(out).toMatchObject({ state: "signedOut", account: null, device: null });
        expect(out.error.errorText).toMatch(/signed out from the website.*Sign in again/);
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(st.device.id).toBeTruthy();
    });

    it("a refresh the server fails (503) or cannot be reached: still signed in, and the copy says to try again", async () => {
        let down: "503" | "offline" | null = null;
        const svc = service({ request: (req: Any) => down === "503" && tokenUrl(req)
            ? Promise.resolve({ status: 503, headers: { "content-type": "text/html" }, body: "<html>Service Unavailable</html>" })
            : down === "offline" ? Promise.reject(new Error("offline")) : device.request(req) });
        await signedIn(svc);
        clock += 2 * 3600 * 1000;   // the access token has expired
        down = "503";
        expect(await svc.refresh({}, S)).toMatchObject({ returnValue: false, errorCode: "SERVER_ERROR", errorText: expect.stringMatching(/having trouble\. Try again/) });
        down = "offline";
        expect(await svc.refresh({}, S)).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED" });
        expect((await statusOf(svc)).state).toBe("signedIn");
        down = null;
        expect(await svc.refresh({}, S)).toMatchObject({ returnValue: true, state: "signedIn" });
    });

    // The browser sign-in, with the OAuth service played here (its own tests:
    // services/oauth/oauth.test.ts).
    function browserService(oauth: Record<string, (p: Any) => Any>, extra: Any = {}) {
        return service(Object.assign({ luna: { call: async (uri: string, params: Any) => {
            calls.push({ uri, params });
            const m = /service\.oauth\/(\w+)$/.exec(uri);
            if (m) return oauth[m[1]] ? oauth[m[1]](params) : { returnValue: true };
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: devMode ? "enabled" : "disabled" };
            return { returnValue: true };
        } } }, extra));
    }
    function liveToken() {
        const t = "at_live" + crypto.randomBytes(6).toString("hex");
        mock.state.tokens.set(t, { user: "u_test", scope: "openid account backup push reviews assistant", device: null, expires: Date.now() + 3600 * 1000 });
        return t;
    }
    const called = (what: string) => calls.filter((c) => c.uri.endsWith("service.oauth/" + what));

    it("browser: two taps at once open one card", async () => {
        let answer: (r: Any) => void = () => {};
        const svc = browserService({ authorize: () => new Promise((r) => { answer = r; }) });
        const a = svc.signIn({ method: "browser" }, S), b = svc.signIn({ method: "browser" }, S);
        await until(async () => called("authorize").length > 0);
        await new Promise((r) => setTimeout(r, 50));
        expect(called("authorize")).toHaveLength(1);
        answer({ returnValue: false, errorCode: "CANCELED", errorText: "The sign-in was closed" });
        expect(await a).toMatchObject({ errorCode: "CANCELED" });
        expect(await b).toMatchObject({ errorCode: "CANCELED" });
    });

    it("browser: Cancel with the card open closes it, and what the card brings afterwards is forgotten, never signed in", async () => {
        let answer: (r: Any) => void = () => {};
        const svc = browserService({ authorize: () => new Promise((r) => { answer = r; }) });
        const p = svc.signIn({ method: "browser" }, S);
        await until(async () => (await statusOf(svc)).state === "signingIn");
        expect(await svc.cancelSignIn({}, S)).toMatchObject({ state: "signedOut", error: null });
        expect(called("cancel")).toHaveLength(1);
        answer({ returnValue: true, keyId: "k-late", scope: "account" });
        await p;
        expect((await statusOf(svc)).state).toBe("signedOut");
        expect(keystore["account:tokens"]).toBeUndefined();
        expect(called("forget").map((c) => c.params.keyId)).toEqual(["k-late"]);
    });

    it.each([
        ["CANCELED", "CANCELED", /closed before it finished; sign in again/],
        ["TIMEOUT", "TIMEOUT", /took too long; sign in again/],
        ["ACCESS_DENIED", "ACCESS_DENIED", /turned down; sign in again/],
        ["CONNECTION_FAILED", "CONNECTION_FAILED", /Check this device's connection/],
        ["500_SERVER_ERROR", "SERVER_ERROR", /having trouble\. Try again/],
        ["401_UNAUTHORIZED", "UNAUTHORIZED", /did not accept this sign-in; sign in again/],
    ])("browser: the OAuth service's %s is %s, with what to do", async (theirs, ours, copy) => {
        const svc = browserService({ authorize: () => ({ returnValue: false, errorCode: theirs, errorText: "The token endpoint answered 500" }) });
        expect(await svc.signIn({ method: "browser" }, S)).toMatchObject({ returnValue: false, errorCode: ours, errorText: expect.stringMatching(copy) });
        expect(await statusOf(svc)).toMatchObject({ state: "signedOut", error: { errorCode: ours, errorText: expect.stringMatching(copy) } });
    });

    it("browser: a sign-in that cannot finish forgets the OAuth service's key", async () => {
        const at = liveToken();
        let meDown = true;
        const svc = browserService({ authorize: () => ({ returnValue: true, keyId: "k-new", scope: "account" }), token: () => ({ returnValue: true, accessToken: at }) },
                                   { request: (req: Any) => meDown && /\/v1\/me$/.test(req.url) ? Promise.reject(new Error("reset")) : device.request(req) });
        expect(await svc.signIn({ method: "browser" }, S)).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED" });
        expect(called("forget").map((c) => c.params.keyId)).toEqual(["k-new"]);
        expect(keystore["account:tokens"]).toBeUndefined();
        meDown = false;
    });

    it("browser: the token refused (the device removed on the website): renewed once, then signed out and its key forgotten", async () => {
        let at = liveToken();
        const asked: Any[] = [];
        const svc = browserService({
            authorize: () => ({ returnValue: true, keyId: "k1", scope: "account" }),
            token: (p: Any) => { asked.push(p); return p.refresh ? { returnValue: false, errorCode: "401_UNAUTHORIZED", errorText: "The token endpoint answered 400 (invalid_grant)" } : { returnValue: true, accessToken: at }; },
        });
        expect(await svc.signIn({ method: "browser" }, S)).toMatchObject({ state: "signedIn" });
        mock.state.tokens.delete(at);   // revoked on the server
        expect(await svc.refresh({}, S)).toMatchObject({ returnValue: false, errorCode: "SIGNED_OUT" });
        expect(asked.some((p) => p.refresh === true)).toBe(true);
        expect(called("forget").map((c) => c.params.keyId)).toEqual(["k1"]);
        expect(await statusOf(svc)).toMatchObject({ state: "signedOut", error: { errorCode: "SIGNED_OUT", errorText: expect.stringMatching(/Sign in again/) } });
        expect(keystore["account:tokens"]).toBeUndefined();
        at = "";
    });

    it("browser: a refresh the server fails stays signed in, as SERVER_ERROR", async () => {
        const at = liveToken();
        let failing = false;
        const svc = browserService({
            authorize: () => ({ returnValue: true, keyId: "k2", scope: "account" }),
            token: () => failing ? { returnValue: false, errorCode: "500_SERVER_ERROR", errorText: "The token endpoint answered 503" } : { returnValue: true, accessToken: at },
        });
        await svc.signIn({ method: "browser" }, S);
        failing = true;
        expect(await svc.refresh({}, S)).toMatchObject({ returnValue: false, errorCode: "SERVER_ERROR", errorText: expect.stringMatching(/having trouble/) });
        expect((await statusOf(svc)).state).toBe("signedIn");
        expect(called("forget")).toHaveLength(0);
    });
});

describe("the sign-ins the server offers", () => {
    afterAll(() => { mock.state.deviceOnly = false; });
    it("reports code and browser from discovery, and offers browser only where the server has it", async () => {
        mock.state.deviceOnly = false;
        const svc = service();
        expect((await svc.getStatus({}, "org.webosphoenix.settings")).methods).toBeNull();   // not read yet: read once, quietly
        await until(async () => (await svc.getStatus({}, "org.webosphoenix.settings")).methods !== null);
        expect((await svc.getStatus({}, "org.webosphoenix.settings")).methods).toEqual(["code", "browser"]);
    });
    it("signed in already: a second sign-in is refused, and the tokens kept stay the only ones", async () => {
        mock.state.deviceOnly = false;
        const svc = service();
        await signedIn(svc);
        const before = JSON.stringify(keystore);
        for (const method of ["code", "browser"]) {
            const r = await svc.signIn({ method }, "org.webosphoenix.settings");
            expect(r).toMatchObject({ returnValue: false, errorCode: "SIGNED_IN" });
        }
        expect(calls.some((c) => c.uri.includes("service.oauth/authorize"))).toBe(false);
        expect(JSON.stringify(keystore)).toBe(before);
        expect((await svc.getStatus({}, "org.webosphoenix.settings")).state).toBe("signedIn");
    });
    it("a server that signs in with a code only (Phoenix-Web-Services' preview): no browser, and signIn browser says so at once", async () => {
        mock.state.deviceOnly = true;
        const svc = service();
        await svc.getStatus({}, "org.webosphoenix.settings");
        await until(async () => (await svc.getStatus({}, "org.webosphoenix.settings")).methods !== null);
        const st = await svc.getStatus({}, "org.webosphoenix.settings");
        expect(st.methods).toEqual(["code"]);
        const r = await svc.signIn({ method: "browser" }, "org.webosphoenix.settings");
        expect(r).toMatchObject({ returnValue: false, errorCode: "UNSUPPORTED" });
        expect(calls.some((c) => c.uri.includes("service.oauth/authorize"))).toBe(false);
        expect((await svc.getStatus({}, "org.webosphoenix.settings")).state).toBe("signedOut");
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

describe("another device's position (location sharing)", () => {
    const share = (body: Any) => fetch(mock.api + "v1/conformance/location", { method: "POST", headers: { Authorization: "Bearer " + mock.token, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

    it("is off on the device until Settings turns it on, and then asks nothing of the network", async () => {
        const svc = service({ request: () => { throw new Error("no network expected"); } });
        expect(await svc.locationRelay({}, "com.webos.service.location")).toEqual({ returnValue: true, enabled: false, sharing: false, position: null, reason: "OFF" });
        expect(await svc.setLocationRelay({ enabled: true }, "com.webos.service.location")).toMatchObject({ errorCode: "NOT_ALLOWED" });
        expect(await svc.setLocationRelay({ enabled: "yes" }, "org.webosphoenix.settings")).toMatchObject({ errorCode: "BAD_PARAMS" });
        expect(await svc.locationRelay({}, "org.example.app")).toMatchObject({ errorCode: "NOT_ALLOWED" });
    });

    it("gives the account's fresh position, with its source and age, and says why when there is none", async () => {
        const svc = service();
        expect(await svc.setLocationRelay({ enabled: true }, "org.webosphoenix.settings")).toEqual({ returnValue: true, enabled: true });
        expect(await svc.locationRelay({}, "com.webos.service.location")).toMatchObject({ enabled: true, position: null, reason: "SIGNED_OUT" });
        await signedIn(svc);
        await share({ enabled: false });
        expect(await svc.locationRelay({}, "com.webos.service.location")).toMatchObject({ returnValue: true, enabled: true, sharing: false, position: null, reason: "SHARING_OFF" });

        await share({ enabled: true, position: { latitude: 51.5007, longitude: -0.1246, accuracy: 9, name: "iPad", timestamp: Date.now() - 20000 } });
        clock += 16000;   // past the reuse window
        const r = await svc.locationRelay({}, "com.webos.service.location");
        expect(r).toMatchObject({ returnValue: true, enabled: true, sharing: true, reason: null,
                                  position: { latitude: 51.5007, longitude: -0.1246, accuracy: 9, source: { kind: "browser", name: "iPad", deviceId: null } } });
        expect(r.position.age).toBeGreaterThanOrEqual(19);
        expect(typeof r.position.timestamp).toBe("number");

        // Read again within 15 s: the same reply, aged, without asking the server.
        const asked = mock.state.log.filter((l: string) => l.endsWith("v1/me/location")).length;
        clock += 5000;
        const again = await svc.locationRelay({}, "org.webosphoenix.settings");
        expect(again.position.age).toBe(r.position.age + 5);
        expect(mock.state.log.filter((l: string) => l.endsWith("v1/me/location")).length).toBe(asked);

        // Off on the device: no position, at once.
        await svc.setLocationRelay({ enabled: false }, "org.webosphoenix.settings");
        expect(await svc.locationRelay({}, "com.webos.service.location")).toMatchObject({ enabled: false, position: null, reason: "OFF" });
    });

    it("never hands a device its own shared position, nor one gone stale, and goes on offline", async () => {
        const svc = service();
        const st = await signedIn(svc);
        await svc.setLocationRelay({ enabled: true }, "org.webosphoenix.settings");
        await share({ enabled: true });
        mock.state.locations.u_test.position = { latitude: 1, longitude: 2, accuracy: 5, measured: Date.now(), kind: "device", name: "Test TouchPad", deviceId: st.device.id };
        expect(await svc.locationRelay({}, "com.webos.service.location")).toMatchObject({ sharing: true, position: null, reason: "OWN_POSITION" });

        mock.state.locations.u_test.position = { latitude: 1, longitude: 2, accuracy: 5, measured: Date.now(), kind: "browser", name: "iPad", deviceId: null };
        clock += 16000;
        expect((await svc.locationRelay({}, "com.webos.service.location")).position).toMatchObject({ latitude: 1, longitude: 2 });
        clock += 1800 * 1000;   // the cached reply ages past 30 minutes on this device's clock
        offline = true;
        expect(await svc.locationRelay({}, "com.webos.service.location")).toMatchObject({ returnValue: true, position: null, reason: "CONNECTION_FAILED" });
    });
});
