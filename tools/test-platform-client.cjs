#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The platform conformance suite (docs/PLATFORM-CLIENT.md, "Conformance"):
// the device's own code (the services as a device runs them, in Node)
// against a Phoenix platform, end to end, with every file and reply checked
// against the contract (docs/platform-api/*.schema.json):
//
//   servers   GET <api>/v1/servers.json resolves (keys pinned: the roots)
//   catalog   the index verified through the root's delegation; a web app
//             package and a connector installed (Developer Mode for the
//             connector, as on a device), their size and SHA-256 checked;
//             an update with a staged rollout offered only at 100%, then
//             installed by updateAll; a key rotation followed; a malware
//             revocation removes the app, a developer one warns, a revoked
//             app does not install again
//   updates   a signed format 2 feed through the root's delegation; a
//             staged rollout; download, RAUC install (test/fake-rauc.cjs),
//             restart, mark-good; a revoked build dropped
//   account   OIDC discovery, the device code approved, the device
//             registered, signed entitlements, refresh, sign-out
//   cloud     Phoenix Cloud backup through the backup service (an encrypted
//             backup written to the platform's WebDAV and restored), push
//             endpoint and relay channel, the OAuth token relay, the
//             assistant proxy
//   ui        (--ui) the same in the simulator's pages in Chromium:
//             Settings > Updates finds, downloads and installs the
//             platform's update; Settings > Phoenix Account signs in with
//             the code; screenshots in --out
//
//   node tools/test-platform-client.cjs [--ui] [--tablet] [--out DIR]
//        starts the mock platform (tools/platform-mock/server.cjs) itself
//   node tools/test-platform-client.cjs --api https://api.staging.example.org/ --token TOKEN [--ui]
//        runs against a real platform's staging server: it must serve
//        GET <api>/v1/servers.json and the conformance controls
//        (<api>/v1/conformance/*, Bearer TOKEN) of docs/platform-api/openapi.yaml
//
// Needs Node 22; --ui also Playwright's Chromium and the apps built
// (NODE_PATH="$(npm root -g)").

"use strict";

const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const REPO = path.resolve(__dirname, "..");
// The services require("@phoenix/platform") as a device's node_modules has it.
process.env.NODE_PATH = [path.join(REPO, "apps/node_modules")].concat((process.env.NODE_PATH || "").split(":").filter(Boolean)).join(":");
require("module").Module._initPaths();

const platform = require(path.join(REPO, "apps/shared/platform/src/index.js"));
const device = require(path.join(REPO, "apps/shared/platform/src/device.js"));
const schema = require("./platform-mock/schema.cjs");
const mockLib = require("./platform-mock/server.cjs");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const UI = args.includes("--ui");
const tablet = args.includes("--tablet");
const outDir = arg("--out", path.join(REPO, "build", "platform-client-tests"));

let failures = 0, passes = 0;
function check(cond, what, detail) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}${!cond && detail ? "\n     " + detail : ""}`);
    if (cond) passes++; else failures++;
    return cond;
}
function conforms(file, ref, value, what) {
    const problems = schema.validate(file, ref, value);
    return check(problems.length === 0, what + " follows " + file + (ref ? ref.replace(/^#\/\$defs\//, " ") : ""), problems.slice(0, 5).join("; "));
}
const sha = (alg) => async (b) => new Uint8Array(crypto.createHash(alg).update(Buffer.from(b)).digest());
const cryptoDeps = { sha256: sha("sha256"), sha512: sha("sha512"), randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 15000);
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("timed out: " + what);
        await sleep(100);
    }
}

// ---- The platform under test ----------------------------------------------------------------

async function platformUnderTest() {
    if (arg("--api")) {
        const api = arg("--api").replace(/\/*$/, "/");
        const token = arg("--token");
        if (!token) throw new Error("--token: the staging server's conformance token");
        return { api, token, close: async () => {}, mock: null };
    }
    const mock = await mockLib.start({ interval: 1 });
    return { api: mock.api, token: mock.token, close: () => mock.close(), mock };
}
async function http(method, url, body, headers) {
    const r = await device.request({ method, url, headers: Object.assign({ Accept: "application/json" }, body !== undefined ? { "Content-Type": "application/json" } : {}, headers || {}),
                                     body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = JSON.parse(r.body); } catch (e) { json = null; }
    return Object.assign(r, { json });
}

// ---- Device pieces -------------------------------------------------------------------------------

const ipk = require(path.join(REPO, "apps/marketplace/service/lib/ipk.js")).createIpk({
    gzip: { gzip: async (b) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b) => new Uint8Array(zlib.gunzipSync(b)) }
});

function marketplace(serversFn) {
    const { createPackagesService } = require(path.join(REPO, "apps/marketplace/service/packagesservice.js"));
    const nodeHttp = require(path.join(REPO, "apps/marketplace/service/lib/node-http.js"));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-conf-mkt-"));
    const world = { state: null, installed: {}, installs: [], toasts: [], devMode: false };
    const luna = {
        call: async (uri, params) => {
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: world.devMode ? "enabled" : "disabled" };
            if (uri.endsWith("/listLaunchPoints")) return { returnValue: true, launchPoints: Object.keys(world.installed).map((id) => ({ id, launchPointId: id + "_default" })) };
            if (uri.endsWith("/listApps")) return { returnValue: true, apps: Object.keys(world.installed).map((id) => ({ id })) };
            if (uri.endsWith("/createToast")) { world.toasts.push(params); return { returnValue: true }; }
            return { returnValue: true };
        },
        // OSE's installer: reads the package, as appinstalld does.
        subscribe: (uri, params, onReply) => {
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
        luna, request: nodeHttp.request, requestBytes: nodeHttp.requestBytes, crypto: cryptoDeps,
        gzip: { gzip: async (b) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b) => new Uint8Array(zlib.gunzipSync(b)) },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o) => { world.state = JSON.parse(JSON.stringify(o)); } },
        temp: { write: (name, bytes) => { const f = path.join(temp, name); fs.writeFileSync(f, bytes); return f; }, remove: (f) => fs.rmSync(f, { force: true }) },
        defaultSources: () => JSON.parse(fs.readFileSync(path.join(REPO, "apps/marketplace/service/etc/palm/marketplace/sources.json"), "utf8")).sources,
        servers: serversFn
    });
    return { service, world, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

function updates(serversFn, compatible) {
    const updatesLib = require(path.join(REPO, "services/updates/updatesservice.js"));
    const node = require(path.join(REPO, "services/updates/lib/node.js"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-conf-upd-"));
    process.env.FAKE_RAUC_STATE = path.join(dir, "rauc.json");
    fs.writeFileSync(path.join(dir, "rauc.json"), JSON.stringify({ compatible, booted: "rootfs.0", primary: "rootfs.0",
                                                                  slots: { "rootfs.0": { version: "1.0.0", build: 100 }, "rootfs.1": null } }));
    const osRelease = (b) => fs.writeFileSync(path.join(dir, "os-release"), `NAME="webOS Phoenix"\nVERSION_ID=${b.version}\nBUILD_ID=${b.build}\n`);
    osRelease({ version: "1.0.0", build: 100 });
    const world = { state: null, calls: [] };
    const make = () => updatesLib.createUpdatesService({
        rauc: node.createRauc({ command: path.join(REPO, "services/updates/test/fake-rauc.cjs"), osRelease: path.join(dir, "os-release") }),
        request: node.request, requestBytes: node.requestBytes, download: node.download, crypto: cryptoDeps,
        files: { path: (n) => path.join(dir, "downloads", n), exists: (f) => fs.existsSync(f), remove: (f) => fs.rmSync(f, { force: true }) },
        power: async () => ({ percent: 90, charging: false }),
        luna: { call: async (uri, params) => { world.calls.push({ uri, params }); return { returnValue: true }; } },
        servers: serversFn,
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o) => { world.state = JSON.parse(JSON.stringify(o)); } }
    });
    // The bootloader: start the primary slot.
    const restart = () => {
        const st = JSON.parse(fs.readFileSync(path.join(dir, "rauc.json"), "utf8"));
        st.booted = st.primary;
        fs.writeFileSync(path.join(dir, "rauc.json"), JSON.stringify(st));
        osRelease(st.slots[st.booted]);
    };
    const calls = () => { try { return fs.readFileSync(path.join(dir, "rauc.json.calls"), "utf8").split("\n").filter(Boolean); } catch (e) { return []; } };
    return { make, world, restart, calls, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function account(serversFn, overrideStore) {
    const lib = require(path.join(REPO, "services/account/accountservice.js"));
    const world = { keys: {}, state: null, toasts: [] };
    let svc = null;
    svc = lib.createAccountService({
        request: device.request, requestBytes: device.request,
        luna: { call: async (uri, params) => {
            if (uri.endsWith("/getDevMode")) return { returnValue: true, status: "enabled" };
            if (uri.endsWith("/createToast")) { world.toasts.push(params); return { returnValue: true }; }
            return { returnValue: true };
        } },
        keystore: { get: async (id) => world.keys[id], put: async (id, v) => { world.keys[id] = v; }, del: async (id) => { delete world.keys[id]; } },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o) => { world.state = JSON.parse(JSON.stringify(o)); } },
        servers: serversFn,
        override: overrideStore,
        crypto: Object.assign({ deviceKey: async () => crypto.randomBytes(32).toString("base64") }, cryptoDeps),
        device: async () => ({ name: "Conformance device", model: "conformance", compatible: "phoenix-conformance", osVersion: "1.0.0", build: 100 })
    });
    return { svc, world };
}

// ---- The suite ----------------------------------------------------------------------------------

async function main() {
    const P = await platformUnderTest();
    const control = (what, body) => http("POST", P.api + "v1/conformance/" + what, body, { Authorization: "Bearer " + P.token });
    const temps = [];
    try {
        // -- servers.json --
        console.log("== servers");
        const sj = await http("GET", P.api + "v1/servers.json");
        check(sj.status === 200, "GET v1/servers.json answers 200 (" + sj.status + ")");
        conforms("servers.schema.json", null, sj.json, "the platform's servers.json");
        let override = sj.json;
        const serversFn = () => platform.load({ image: () => null, override: () => override, devMode: () => true });
        const sv = await serversFn();
        check(sv.catalog && sv.catalog.root && sv.updates && sv.updates.root && sv.account,
              "resolved: catalog and updates with their roots pinned, an account issuer");

        // -- The catalog --
        console.log("== catalog");
        const pk = await mockLib.samplePackages(ipk);
        const pk2 = await mockLib.samplePackages(ipk, { appVersion: "1.1.0" });
        const b64 = (u8) => Buffer.from(u8).toString("base64");
        const appEntry = (version, pkg, rollout) => Object.assign({ id: "org.example.mockapp", kind: "ipk", title: "Mock App", summary: "A conformance app",
                                                                    categories: ["Utilities"], version, package: b64(pkg) }, rollout ? { rollout } : {});
        const conEntry = { id: "org.example.mockfeeds", kind: "connector", title: "Mock Feeds", summary: "A conformance connector", categories: ["News"],
                           version: "0.1.0", package: b64(pk.connector) };
        const accountType = { templateId: "org.example.mockfeeds", title: "Mock Feeds", provider: "Example", summary: "News feeds",
                              capabilities: [{ capability: "CONTACTS" }], auth: { type: "none" }, server: "user", privacy: { dataGoesTo: "the feed's site", phoenixServers: "none" },
                              package: { id: "org.example.mockfeeds" } };
        let r = await control("revocations", { apps: [] });
        check(r.status === 200, "control: an empty revocation list published (" + r.status + ")");
        r = await control("catalog", { apps: [appEntry("1.0.0", pk.app), conEntry], accounts: [accountType] });
        check(r.status === 200, "control: a catalog published (" + r.status + ")");
        const kj = await http("GET", sv.catalog.url + "key.json");
        conforms("feeds.schema.json", "#/$defs/keyFile", kj.json, "catalog/v1/key.json");
        const idx = await http("GET", sv.catalog.url + "index.json");
        conforms("feeds.schema.json", "#/$defs/catalogIndex", idx.json, "catalog/v1/index.json");
        check(/no-cache/.test(String(idx.headers["cache-control"] || "")), "index.json is served no-cache");
        const rv = await http("GET", sv.revocations.url);
        conforms("feeds.schema.json", "#/$defs/revocationList", rv.json, "revocations/v1/revoked.json");

        const M = marketplace(serversFn);
        temps.push(M.cleanup);
        let res = await M.service.refresh({});
        check((res.results.find((x) => x.id === "phoenix") || {}).ok === true, "the Marketplace reads the catalog through the root's delegation", JSON.stringify(res.results));
        const browse = await M.service.browse({ section: "apps" });
        check(browse.apps.some((a) => a.id === "org.example.mockapp"), "browse lists the app");
        const types = await M.service.listAccountTypes({});
        check(types.accountTypes.some((t) => t.templateId === "org.example.mockfeeds"), "Connections' account types list the connector's");
        res = await M.service.install({ sourceId: "phoenix", id: "org.example.mockapp" });
        check(res.returnValue && res.state === "installed", "the app installs (package size and SHA-256 checked)", JSON.stringify(res));
        res = await M.service.install({ sourceId: "phoenix", id: "org.example.mockfeeds" });
        check(res.errorCode === "NEEDS_DEVMODE", "a third-party connector needs Developer Mode");
        M.world.devMode = true;
        res = await M.service.install({ sourceId: "phoenix", id: "org.example.mockfeeds" });
        check(res.returnValue && M.world.installs.some((i) => i.id === "org.example.mockfeeds" && i.developerMode), "... and installs in Developer Mode");
        M.world.devMode = false;
        await control("catalog", { apps: [appEntry("1.1.0", pk2.app, { percent: 0, seed: "mockapp-1.1.0" }), conEntry], accounts: [accountType] });
        await M.service.refresh({});
        check((await M.service.listInstalled({})).apps.find((a) => a.id === "org.example.mockapp").update === null, "an update at 0% rollout is not offered");
        await control("catalog", { apps: [appEntry("1.1.0", pk2.app, { percent: 100, seed: "mockapp-1.1.0" }), conEntry], accounts: [accountType] });
        res = await M.service.updateAll({});
        check(res.updated && res.updated.includes("org.example.mockapp") && M.world.installs.at(-1).version === "1.1.0", "at 100% it is offered and updateAll installs it");
        r = await control("rotate", { scope: "catalog" });
        check(r.status === 200, "control: the catalog's online key rotated");
        await control("catalog", { apps: [appEntry("1.1.0", pk2.app), conEntry], accounts: [accountType] });
        res = await M.service.refresh({});
        check((res.results.find((x) => x.id === "phoenix") || {}).ok === true, "the rotated key, delegated by the root, is followed");
        await control("revocations", { apps: [{ id: "org.example.mockapp", kind: "app", reason: "malware", date: "2026-10-10" },
                                              { id: "org.example.mockfeeds", kind: "connector", reason: "developer", date: "2026-10-10" }] });
        await M.service.refresh({});
        check(!M.world.installed["org.example.mockapp"] && /was removed/.test((M.world.toasts.find((t) => /Mock App/.test(t.message)) || {}).message || ""),
              "a malware revocation removes the app and says so");
        check(!!M.world.installed["org.example.mockfeeds"] && M.world.toasts.some((t) => /Mock Feeds was withdrawn/.test(t.message)),
              "a developer's withdrawal of a connector warns and keeps it");
        res = await M.service.install({ sourceId: "phoenix", id: "org.example.mockapp" });
        check(res.errorCode === "REVOKED", "a revoked app does not install again");

        // -- System updates --
        console.log("== updates");
        const COMPAT = "phoenix-conformance";
        const bundle = (v, b) => `[update]\ncompatible=${COMPAT}\nversion=${v}\nbuild=${b}\n\n[image.rootfs]\nfilename=rootfs.ext4\n` + "#".repeat(4096) + "\n";
        r = await control("updates", { compatible: COMPAT, channel: "stable", version: "1.1.0", build: 110, notes: ["Conformance"],
                                       bundleBase64: Buffer.from(bundle("1.1.0", 110)).toString("base64"), rollout: { percent: 0, seed: "c110" } });
        check(r.status === 200, "control: a release published (" + r.status + ")");
        const ukj = await http("GET", sv.updates.url + "key.json");
        conforms("feeds.schema.json", "#/$defs/keyFile", ukj.json, "updates/key.json");
        const feed = await http("GET", sv.updates.url + COMPAT + "/stable.json");
        conforms("feeds.schema.json", "#/$defs/updateFeed", feed.json, "updates/<compatible>/stable.json");
        const U = updates(serversFn, COMPAT);
        temps.push(U.cleanup);
        let st = await U.make().check({});
        check(st.returnValue && st.verified === true && st.available === null && st.rollout && st.rollout.waiting,
              "a signed feed, verified through the root's delegation; at 0% the device waits", JSON.stringify(st.error || st.rollout));
        await control("updates", { compatible: COMPAT, channel: "stable", version: "1.1.0", build: 110, notes: ["Conformance"],
                                   bundleBase64: Buffer.from(bundle("1.1.0", 110)).toString("base64"), rollout: { percent: 100, seed: "c110" } });
        st = await U.make().check({});
        check(st.available && st.available.build === 110, "at 100% the release is offered");
        const bundleUrl = new URL(st.available.url);
        const ranged = await device.request({ method: "GET", url: bundleUrl.href, headers: { Range: "bytes=10-" } });
        check(ranged.status === 206, "the bundle answers a range request (resumed downloads): " + ranged.status);
        st = await U.make().download({});
        check(st.state === "ready", "downloaded, checked and written to the other slot", JSON.stringify(st.error));
        st = await U.make().installNow({});
        check(st.returnValue === true && U.world.calls.some((c) => c.uri.endsWith("/machineReboot")), "Install Now restarts");
        U.restart();
        st = await U.make().getStatus({});
        check(st.current.build === 110 && U.calls().includes("status mark-good"), "after the restart: the new system, marked good");
        await control("updates", { compatible: COMPAT, channel: "beta", version: "1.2.0", build: 120,
                                   bundleBase64: Buffer.from(bundle("1.2.0", 120)).toString("base64") });
        const u2 = U.make();
        await u2.setPreferences({ channel: "beta" });
        st = await u2.check({});
        check(st.available && st.available.build === 120, "the beta channel");
        st = await u2.download({});
        await control("updates", { compatible: COMPAT, channel: "beta", release: null, revoked: [120] });
        st = await u2.check({});
        check(st.available === null && st.state === "idle", "a revoked build that was prepared is dropped");

        // -- The account --
        console.log("== account");
        const disc = await http("GET", sv.account.issuer + "/.well-known/openid-configuration");
        conforms("api.schema.json", "#/$defs/openidConfiguration", disc.json, "the discovery document");
        check(disc.json && disc.json.issuer === sv.account.issuer, "its issuer is servers.json's");
        const A = account(serversFn, { read: () => override, write: (o) => { override = o; } });
        st = await A.svc.signIn({ method: "code" }, "org.webosphoenix.settings");
        check(st.state === "signingIn" && st.signIn && /^[A-Z0-9-]{4,}$/.test(st.signIn.userCode || ""), "sign-in shows a code", JSON.stringify(st.error || st.signIn));
        r = await control("approve", { user_code: st.signIn && st.signIn.userCode });
        check(r.status === 200, "control: the code approved");
        st = await until(async () => { const s = await A.svc.getStatus({}); return s.state === "signedIn" ? s : null; }, 20000, "signed in");
        check(st.account && st.device && st.entitlements && st.entitlements.verified, "signed in: the account, this device registered, signed entitlements");
        const tok = A.world.keys["account:tokens"];
        const me = await http("GET", P.api + "v1/me", undefined, { Authorization: "Bearer " + tok.accessToken });
        conforms("api.schema.json", "#/$defs/me", me.json, "GET v1/me");
        const ent = await http("GET", P.api + "v1/me/entitlements", undefined, { Authorization: "Bearer " + tok.accessToken });
        conforms("api.schema.json", "#/$defs/entitlements", ent.json, "GET v1/me/entitlements");
        check(!!ent.headers["x-phoenix-signature"], "the entitlements carry X-Phoenix-Signature");
        const devs = await http("GET", P.api + "v1/me/devices", undefined, { Authorization: "Bearer " + tok.accessToken });
        conforms("api.schema.json", "#/$defs/deviceList", devs.json, "GET v1/me/devices");
        const bad = await http("GET", P.api + "v1/me", undefined, { Authorization: "Bearer nope" });
        check(bad.status === 401, "a wrong token: 401");
        conforms("api.schema.json", "#/$defs/error", bad.json, "the 401");

        // -- Cloud services --
        console.log("== cloud");
        const backupLib = require(path.join(REPO, "apps/settings/service/backupservice.js"));
        const store = {};
        const backupWorld = { config: null, restored: null };
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-conf-bak-"));
        temps.push(() => fs.rmSync(tmpBase, { recursive: true, force: true }));
        const backup = backupLib.createBackupService({
            luna: { call: async (uri, params) => {
                if (uri === "luna://org.webosphoenix.service.account/backupCredentials") return A.svc.backupCredentials({}, "org.webosphoenix.service.backup");
                if (uri === "luna://com.example.notes/preBackup") { fs.writeFileSync(path.join(params.tempDir, "notes.json"), "{\"notes\":\"Buy milk\"}"); return { returnValue: true, files: ["notes.json"], version: "1" }; }
                if (uri === "luna://com.example.notes/postRestore") { backupWorld.restored = fs.readFileSync(path.join(params.tempDir, params.files[0]), "utf8"); return { returnValue: true }; }
                return { returnValue: true };
            } },
            request: require(path.join(REPO, "apps/settings/service/lib/node-http.js")),
            crypto: require(path.join(REPO, "apps/settings/service/lib/node-crypto.js")),
            config: { load: () => backupWorld.config && JSON.parse(JSON.stringify(backupWorld.config)), save: (o) => { backupWorld.config = JSON.parse(JSON.stringify(o)); } },
            temp: { make: () => fs.mkdtempSync(path.join(tmpBase, "t-")), read: (f) => new Uint8Array(fs.readFileSync(f)), write: (f, d) => fs.writeFileSync(f, Buffer.from(d)),
                    remove: (d) => fs.rmSync(d, { recursive: true, force: true }) },
            usb: { list: () => [], read: () => "", write: () => {}, remove: () => {}, mkdir: () => {} },
            participants: () => [{ id: "com.example.notes", preBackup: "preBackup", postRestore: "postRestore" }]
        });
        st = await backup.configure({ destination: { type: "phoenix" }, passphrase: "correct horse battery" });
        check(st.returnValue && st.destination && st.destination.type === "phoenix", "Backup: Phoenix Cloud set up from the account", JSON.stringify(st));
        const made = await backup.backupNow();
        check(made.returnValue && /\.pbak$/.test(made.name || ""), "an encrypted backup is written to the platform's WebDAV", JSON.stringify(made));
        const sum = await A.svc.backupSummary({}, "org.webosphoenix.service.backup");
        conforms("api.schema.json", "#/$defs/backupSummary", sum, "GET v1/backup/summary");
        check(sum.devices.some((d) => d.deviceId === st.destination.username && d.files.some((f) => f.name === made.name)), "the summary lists it under this device");
        const back = await backup.restore({ name: made.name, passphrase: "correct horse battery" });
        check(back.returnValue && backupWorld.restored === "{\"notes\":\"Buy milk\"}", "and it restores with the passphrase", JSON.stringify(back));
        const ep = await A.svc.pushEndpoint({ app: "org.example.mockfeeds" });
        check(ep.returnValue && /\?up=1$/.test(ep.endpoint), "a UnifiedPush endpoint on the push server");
        const ch = await A.svc.pushRegister({ provider: "graph", endpoint: "https://push.example.org/uptest?up=1", p256dh: "BPkey", auth: "auth1" });
        check(ch.returnValue === true, "a relay channel registered", JSON.stringify(ch));
        if (ch.returnValue) {
            conforms("api.schema.json", "#/$defs/pushChannel", { channelId: ch.channelId, url: ch.url, expiresAt: ch.expiresAt }, "POST v1/push/channels");
            check((await A.svc.pushRenew({ channelId: ch.channelId })).returnValue && (await A.svc.pushDrop({ channelId: ch.channelId })).returnValue, "renewed and dropped");
        }
        const verifier = crypto.randomBytes(32).toString("base64url");
        const au = await A.svc.tokenRelay({ provider: "slack", step: "authorizeUrl", state: "s1", redirectUri: "http://127.0.0.1/oauth/callback",
                                            codeChallenge: crypto.createHash("sha256").update(verifier).digest("base64url") });
        const hop = await device.request({ method: "GET", url: au.url });
        const back2 = hop.headers.location ? new URL(hop.headers.location) : null;
        check(hop.status === 302 && back2 && back2.searchParams.get("state") === "s1" && back2.searchParams.get("handle"), "the token relay comes back with a handle");
        if (back2) {
            const t = await A.svc.tokenRelay({ provider: "slack", step: "redeem", handle: back2.searchParams.get("handle"), codeVerifier: verifier });
            check(t.returnValue && typeof t.accessToken === "string", "... which redeems with the PKCE verifier");
        }
        const ap = await A.svc.assistantProvider({}, "org.webosphoenix.assistant");
        check(ap.returnValue && /\/$/.test(ap.baseUrl), "the assistant provider: the proxy's address and the account's token");
        const providers = require(path.join(REPO, "apps/assistant/service/lib/providers.js"));
        const req = providers.chatRequest({ type: "phoenix", baseUrl: ap.baseUrl.replace(/\/$/, ""), model: "phoenix-assistant" },
                                          { system: "Be brief.", messages: [{ role: "user", text: "Hello" }] }, ap.apiKey);
        const chat = await device.request(req);
        conforms("api.schema.json", "#/$defs/chatCompletion", JSON.parse(chat.body), "POST v1/assistant/chat/completions");
        check(typeof providers.parseChat("phoenix", chat.status, chat.body).text === "string", "the assistant reads the answer");
        st = await A.svc.signOut({}, "org.webosphoenix.settings");
        check(st.state === "signedOut", "signed out");
        const after = await http("GET", P.api + "v1/me", undefined, { Authorization: "Bearer " + tok.accessToken });
        check(after.status === 401, "the device's token no longer works");

        if (UI) await ui(P, control, override);
    } finally {
        for (const t of temps) { try { t(); } catch (e) { /* gone */ } }
        await P.close();
    }
    console.log(failures ? `\n${failures} check(s) failed, ${passes} passed` : `\nAll ${passes} checks passed.`);
    process.exit(failures ? 1 : 0);
}

// ---- In the simulator's pages ---------------------------------------------------------------

function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

async function ui(P, control, servers) {
    console.log("== ui (Chromium)");
    if (!fs.existsSync(path.join(REPO, "apps/settings/dist/index.html"))) {
        check(false, "apps/settings/dist is built (cd apps && npm run build -w @phoenix/settings)");
        return;
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    // Installed apps go to a folder of their own (as a device's /media/cryptofs/apps).
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-conf-installed-"));
    const rootfs = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--installed-dir", installedDir], { stdio: "ignore" });
    let browser;
    try {
        await until(async () => { try { return (await fetch(origin + "/apps.json")).ok; } catch (e) { return false; } }, 20000, "serve-rootfs");
        browser = await chromium.launch();
        const page = await (await browser.newContext({ viewport: tablet ? { width: 1024, height: 740 } : { width: 320, height: 520 } })).newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, name + ".png") }); };
        const settings = (params) => `${origin}/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=` + encodeURIComponent(JSON.stringify(params));
        await page.goto(settings({ page: "updates" }));
        // Developer Mode on, and its override: the platform under test (what
        // Settings > Developer Mode > Platform Servers does).
        await page.evaluate((sv) => {
            localStorage.clear();
            localStorage.setItem("phoenix:devMode", "true");
            localStorage.setItem("phoenix:platform:servers", JSON.stringify(sv));
        }, servers);
        await control("updates", { compatible: "phoenix-sim", channel: "stable", version: "0.2.0", build: 2, notes: ["Signed by the platform", "Staged at 100%"],
                                   bundleBase64: Buffer.from("[update]\ncompatible=phoenix-sim\nversion=0.2.0\nbuild=2\n").toString("base64"),
                                   rollout: { percent: 100, seed: "sim-2" } });
        await page.goto(settings({ page: "updates" }));
        await page.waitForSelector("[data-testid=check-updates]");
        await shot("1-updates-idle");
        await page.click("[data-testid=check-updates]");
        await page.waitForSelector("[data-testid=update-download]", { timeout: 15000 });
        check(/signed and was checked/.test(await page.textContent("[data-testid=update-verified]")), "Settings > Updates: the platform's signed release is found");
        check(/Signed by the platform/.test(await page.textContent("[data-testid=update-notes]")), "... with its notes");
        await shot("2-updates-available");
        await page.click("[data-testid=update-download]");
        await page.waitForSelector("[data-testid=update-install]", { timeout: 20000 });
        await shot("3-updates-ready");
        await page.click("[data-testid=update-install]");
        await page.waitForTimeout(1500);
        await page.goto(settings({ page: "updates" }));
        await page.waitForSelector("[data-testid=update-current]");
        check(/0\.2\.0/.test(await page.textContent("[data-testid=update-current]")), "after the restart: 0.2.0 is running");
        await shot("4-updates-installed");

        await page.goto(settings({ page: "account" }));
        await page.waitForSelector("[data-testid=account-sign-in]", { timeout: 15000 });
        await shot("5-account-signed-out");
        await page.click("[data-testid=account-sign-in]");
        await page.waitForSelector("[data-testid=account-code]", { timeout: 15000 });
        const code = (await page.textContent("[data-testid=account-code]")).trim();
        await page.waitForSelector("[data-testid=account-qr] svg", { timeout: 15000 }).catch(() => null);
        check(await page.locator("[data-testid=account-qr] svg").count() === 1, "Settings > Phoenix Account: the code and its QR code");
        await shot("6-account-code");
        await control("approve", { user_code: code });
        await page.waitForSelector("[data-testid=account-email]", { timeout: 20000 });
        check(/test@example\.org|@/.test(await page.textContent("[data-testid=account-email]")), "approved: signed in, the account shown");
        await shot("7-account-signed-in");
        await page.goto(settings({ page: "devmode" }));
        await page.waitForSelector("[data-testid=devmode-servers-api]", { timeout: 15000 });
        check(/127\.0\.0\.1/.test(await page.textContent("[data-testid=devmode-servers-api]")) || !!arg("--api"), "Developer Mode shows the servers in use");
        await page.locator("[data-testid=devmode-servers-use]").scrollIntoViewIfNeeded();
        await shot("8-devmode-servers");
        // A backup to Phoenix Cloud from this (signed-in) device, for the new one below.
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const bb = new PalmServiceBridge();
            bb.onservicecallback = (x) => res(JSON.parse(x));
            bb.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        const cfg = await luna("luna://org.webosphoenix.service.backup/configure", { destination: { type: "phoenix" }, passphrase: "correct horse battery" });
        const made = await luna("luna://org.webosphoenix.service.backup/backupNow", {});
        check(cfg.returnValue && made.returnValue, "Settings > Backup: Phoenix Cloud, a backup made", JSON.stringify(cfg.returnValue ? made : cfg));
        if (made.returnValue) await firstUseUi(browser, origin, control, servers, errors, made.name);
        check(errors.length === 0, "no page errors", errors.join("; "));
        await marketplaceUi(browser, origin, control, servers, errors);
    } finally {
        if (browser) await browser.close();
        rootfs.kill();
        fs.rmSync(installedDir, { recursive: true, force: true });
    }
}

// First Use on a new device (its own browser context: an empty store) whose
// image's servers.json is the platform under test: the Phoenix Account step
// signs in with the code, and Restore lists the account's cloud backups and
// restores the other device's.
async function firstUseUi(browser, origin, control, servers, errors, backupName) {
    console.log("== ui: First Use");
    const ctx = await browser.newContext({ viewport: tablet ? { width: 1024, height: 740 } : { width: 320, height: 520 } });
    await ctx.route("**/etc/palm/phoenix/servers.json", (rt) => rt.fulfill({ contentType: "application/json", body: JSON.stringify(servers) }));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, name + ".png") }); };
    const url = `${origin}/usr/palm/applications/org.webosphoenix.firstuse/index.html`;
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.goto(url);
    await page.click("[data-testid=next]");
    await page.waitForSelector("[data-testid=step-wifi]");
    await page.click("[data-testid=skip]");
    await page.waitForSelector("[data-testid=step-hardware], [data-testid=step-account]");
    if (await page.locator("[data-testid=step-hardware]").count()) await page.click("[data-testid=skip]");
    await page.waitForSelector("[data-testid=step-account]");
    await page.click("[data-testid=account-sign-in]");
    await page.waitForSelector("[data-testid=account-code]", { timeout: 15000 });
    await page.waitForSelector("[data-testid=account-qr] svg", { timeout: 15000 }).catch(() => null);
    check(await page.locator("[data-testid=account-qr] svg").count() === 1, "First Use: the Phoenix Account step shows the code and its QR code");
    await shot("14-firstuse-account");
    await control("approve", { user_code: (await page.textContent("[data-testid=account-code]")).trim() });
    await page.waitForFunction(() => /Signed in as/.test(document.body.innerText), null, { timeout: 20000 });
    await page.click("[data-testid=next]");
    await page.waitForSelector("[data-testid=restore-start]");
    await page.click("[data-testid=restore-start]");
    check(/Phoenix Cloud/.test(await page.textContent("[data-testid=restore-type]")), "Restore offers Phoenix Cloud first");
    await page.click("[data-testid=next]");
    const row = `[data-testid='restore-file-${backupName}']`;
    await page.waitForSelector(row, { timeout: 20000 });
    await shot("15-firstuse-cloud-backups");
    await page.click(row);
    await page.fill("[data-testid=restore-pass]", "correct horse battery");
    await page.click("[data-testid=restore-confirm]");
    await page.waitForFunction(() => /Restored/.test(document.body.innerText), null, { timeout: 30000 });
    check(true, "the other device's cloud backup restores on the new one");
    await shot("16-firstuse-restored");
    await ctx.close();
}

// The Marketplace and Connections with the platform's catalog as the
// image's servers.json names it (no Developer Mode): a package installed,
// its staged update, and a connector installed from Connections.
async function marketplaceUi(browser, origin, control, servers, errors) {
    console.log("== ui: Marketplace and Connections");
    const { pack } = require(path.join(REPO, "apps/shared/connector-kit/lib/tools/package.js"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-conf-pack-"));
    const P = "luna://org.webosphoenix.service.packages/";
    try {
        const feeds = pack(path.join(REPO, "apps/shared/connector-kit/examples/feeds"), out, { vendor: false });
        const meta = JSON.parse(fs.readFileSync(path.join(REPO, "apps/shared/connector-kit/examples/feeds/catalog.json"), "utf8")).accountTypes[0];
        const tpl = JSON.parse(fs.readFileSync(path.join(REPO, "apps/shared/connector-kit/examples/feeds/public/accounts/org.example.feeds/org.example.feeds.json"), "utf8"));
        // As the catalog writes a connector's account type (server/marketplace Catalog::connectorTypes).
        const accountType = Object.assign({}, meta, { icon: "icons/org.example.feeds.svg", package: { id: "org.example.feeds", builtin: false },
            capabilities: (tpl.capabilityProviders || []).map((c) => Object.assign({ capability: c.capability }, c.readOnlyData ? { direction: "read-only" } : {})) });
        const pkgs = await mockLib.samplePackages(ipk);
        const pkgs2 = await mockLib.samplePackages(ipk, { appVersion: "1.1.0" });
        const b64 = (u8) => Buffer.from(u8).toString("base64");
        const app = (v, p, rollout) => Object.assign({ id: "org.example.mockapp", kind: "ipk", title: "Mock App", summary: "From the platform's catalog",
                                                       categories: ["Utilities"], version: v, package: b64(p) }, rollout ? { rollout } : {});
        const connector = { id: "org.example.feeds", kind: "connector", title: "News Feed (example)", summary: "A connector from the platform's catalog",
                            categories: ["News"], version: "0.1.0", package: b64(fs.readFileSync(feeds.file)) };
        await control("revocations", { apps: [] });
        let r = await control("catalog", { apps: [app("1.0.0", pkgs.app), connector], accounts: [accountType] });
        check(r.status === 200, "control: the catalog with an app and a connector");

        const ctx = await browser.newContext({ viewport: tablet ? { width: 1024, height: 740 } : { width: 320, height: 520 } });
        // The image's servers.json: the platform under test.
        await ctx.route("**/etc/palm/phoenix/servers.json", (rt) => rt.fulfill({ contentType: "application/json", body: JSON.stringify(servers) }));
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, name + ".png") }); };
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const bb = new PalmServiceBridge();
            bb.onservicecallback = (x) => res(JSON.parse(x));
            bb.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        const appUrl = (params) => `${origin}/usr/palm/applications/org.webosphoenix.marketplace/index.html` + (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");
        await page.goto(appUrl());
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl());
        await page.click("[data-testid=tab-apps]");
        await page.waitForSelector("[data-testid='app-org.example.mockapp']", { timeout: 20000 });
        const src = (await luna(P + "getSources", {})).sources.find((s) => s.id === "phoenix");
        check(src && src.trusted && src.pinned && !src.error, "the catalog is trusted through the image's pinned root, without asking", JSON.stringify(src));
        await shot("9-marketplace-apps");
        await page.click("[data-testid='app-org.example.mockapp']");
        await page.click("[data-testid=install-app]");
        await page.waitForSelector("[data-testid=open-app]", { timeout: 20000 });
        const served = await fetch(origin + "/usr/palm/applications/org.example.mockapp/index.html");
        check(served.status === 200 && (await served.text()).includes("Mock App 1.0.0"), "Marketplace: the platform's package installs");
        await shot("10-marketplace-installed");
        await control("catalog", { apps: [app("1.1.0", pkgs2.app, { percent: 100, seed: "ui-1.1.0" }), connector], accounts: [accountType] });
        await luna(P + "refresh", {});
        await page.goto(appUrl({ section: "updates" }));
        await page.waitForSelector("[data-testid=update-all]", { timeout: 15000 });
        check(/1\.0\.0 → 1\.1\.0/.test(await page.textContent("[data-testid='installed-org.example.mockapp']")), "its update (rollout 100%) is offered");
        await shot("11-marketplace-update");
        await page.click("[data-testid=update-all]");
        await page.waitForFunction(() => /Updated 1 app/.test(document.body.innerText), null, { timeout: 20000 });
        check((await (await fetch(origin + "/usr/palm/applications/org.example.mockapp/index.html")).text()).includes("1.1.0"), "Update All installs it");

        await page.goto(appUrl());
        await page.click("[data-testid=tab-connections]");
        await page.waitForSelector("[data-testid='account-org.example.feeds']", { timeout: 15000 });
        await shot("12-connections");
        await page.click("[data-testid='account-org.example.feeds']");
        await page.waitForSelector("[data-testid=connector-install]");
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "enabled" });
        await page.click("[data-testid=connector-install]");
        await page.waitForSelector("[data-testid=set-up]", { timeout: 30000 });
        const tpls = await luna("luna://com.palm.service.accounts/listAccountTemplates", {});
        check(tpls.results.some((t) => t.templateId === "org.example.feeds"), "Connections: the platform's connector installs (Developer Mode), Accounts has its template");
        await shot("13-connections-installed");
        await luna("luna://com.webos.service.devmode/setDevMode", { status: "disabled" });

        await control("revocations", { apps: [{ id: "org.example.mockapp", kind: "app", reason: "malware", date: "2026-10-11" }] });
        await luna(P + "refresh", {});
        const gone = await fetch(origin + "/usr/palm/applications/org.example.mockapp/index.html");
        check(gone.status === 404, "a malware revocation removes the app from the device");
        await ctx.close();
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
