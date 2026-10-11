// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The drives (connector.js) against the stand-in servers of
// test/fake-drives.cjs, over real HTTP: the kit's conformance suite for a
// drive (WebDAV and S3), then each provider through the kit's DOCUMENTS
// methods (listFiles, uploadFile, downloadFile, ...): signing in (app
// password, Nextcloud's Login Flow v2, S3 keys, OAuth with PKCE through the
// real OAuth service), small and chunked uploads, ranged downloads, folders,
// moves, copies, search, quota, offline and refused sign-ins, cancelling a
// transfer, and "not available in this build" without a client id. Then
// the file manager's side (the kit's drives.ts router): /media/drives,
// copying between the device and a drive, the cache and offline opening.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as kit from "@phoenix/connector-kit";
import * as synckit from "@phoenix/synckit";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

const require = createRequire(__filename);
const { createFakeDrives } = require("./test/fake-drives.cjs");
const oauthLib = require("../../../../services/oauth/oauthservice.js");
const drives = loadCommonJs(join(__dirname, "connector.js"));
const s3lib = loadCommonJs(join(__dirname, "lib", "s3.js"));
const SERVICE = "org.webosphoenix.service.drives";
const T = drives.TEMPLATES;
const template = (k: string) => JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", T[k], T[k] + ".json"), "utf8"));
const request = synckit.createRequest({ timeoutMs: 20000 });
const E = kit.FILE_ERRORS;
// The walks move 17-21 MB through the stand-in servers over real HTTP: 2-3 s
// each alone, past vitest's default 5 s on a busy machine (Box's walk took
// 5.1 s on 4 cores at a load of 11, and 18.5 s with 8 more busy processes).
vi.setConfig({ testTimeout: 60000 });

let fake: any;
beforeAll(async () => { fake = await createFakeDrives({ autoApprove: true }).start(0); });
afterAll(async () => { await fake.stop(); });

// ---- The conformance suite (a drive's checks) --------------------------------------------------

function fixture(k: string, params: () => any) {
    return {
        template: template(k),
        get validateParams() { return params(); },
        server: () => { fake.unauthorizedAll = false; fake.throttleSeconds = 0; return fake.conformance(request); }
    };
}
describe("conformance: a Nextcloud drive", () => {
    const fx = fixture("nextcloud", () => ({ username: "phoenix", password: "app-password-1", config: { server: fake.origin } }));
    for (const check of conformanceChecks(drives, fx as any)) it(check.name, () => check.run());
});
describe("conformance: an S3 bucket", () => {
    const fx = fixture("s3", () => ({ username: "PHOENIXKEY", password: "phoenix-secret",
                                      config: { preset: "minio", endpoint: fake.origin, bucket: "phoenix-files", region: "us-east-1" } }));
    for (const check of conformanceChecks(drives, fx as any)) it(check.name, () => check.run());
});

// ---- A world: db8, accounts, the OAuth service, the device's files ---------------------------------

function memoryFiles() {
    const data: Record<string, Uint8Array> = {};
    const join2 = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
    return {
        data,
        size: async (p: string) => { if (!data[p]) throw new Error("no file " + p); return data[p].length; },
        read: async (p: string, o: number, l: number) => data[p].slice(o, o + l),
        write: async (p: string, b: Uint8Array, append: boolean) => { data[p] = append && data[p] ? join2(data[p], b) : new Uint8Array(b); },
        rename: async (a: string, b: string) => { data[b] = data[a]; delete data[a]; },
        remove: async (p: string) => { delete data[p]; }
    };
}

async function world(opts?: { clients?: any }) {
    const db = memdb.createMemDb(memdb.KIND_PARENTS);
    const tempdb = memdb.createMemDb();
    const keys: Record<string, any> = {};
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    const ongoing: any[] = [];
    const sheets: string[] = [];
    const oauth = oauthLib.createOAuthService({
        request,
        keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
        crypto: { randomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)),
                  sha256: async (b: Uint8Array) => new Uint8Array(require("crypto").createHash("sha256").update(Buffer.from(b)).digest()) },
        redirectUri: "http://127.0.0.1:1/signed-in.html",
        // The browser sheet: the provider's page, its redirects followed, until the redirect address.
        sheet: async (url: string, prefix: string) => {
            sheets.push(url);
            let at = url;
            for (let i = 0; i < 5 && at.indexOf(prefix) !== 0; i++) {
                const r = await request({ method: "GET", url: at });
                if (!r.headers.location) throw new Error("no redirect from " + at);
                at = new URL(r.headers.location, at).href;
            }
            return at;
        }
    });
    let methods: any = {};
    const handlers: Record<string, any> = {
        "luna://org.webosphoenix.service.oauth/*": (p: any, uri: string) => (oauth as any)[uri.slice(uri.lastIndexOf("/") + 1)](p, SERVICE),
        "luna://org.webosphoenix.ongoing/*": (p: any, uri: string) => { ongoing.push(Object.assign({ op: uri.replace(/^.*\//, "") }, p)); return { returnValue: true }; },
        "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
        ["luna://" + SERVICE + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    };
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers });
    const files = memoryFiles();
    const clients = opts && "clients" in opts ? opts.clients : fake.clients();
    methods = kit.createConnectorService(drives, {
        luna: bus, request, periodicSync: false, files,
        systemConfig: async (name: string) => (name === "drives/clients.json" ? clients : null)
    });
    // What com.palm.service.accounts does with the sign-in's answer.
    async function addAccount(k: string, r: any, id?: string) {
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        const accountId = id || "acct-" + k;
        const t = template(k);
        accounts[accountId] = { _id: accountId, templateId: t.templateId, username: r.username, loc_name: t.loc_name, icon: t.icon,
                                capabilityProviders: t.capabilityProviders.map((c: any) => Object.assign({}, c)) };
        credentials[accountId] = r.credentials;
        expect((await methods.onCreate({ accountId, config: r.config })).returnValue).toBe(true);
        expect((await methods.onEnabled({ accountId, capabilityProviderId: t.capabilityProviders[0].id, enabled: true })).returnValue).toBe(true);
        return accountId;
    }
    return { methods, files, keys, accounts, credentials, ongoing, sheets, addAccount, bus };
}

const bytesOf = (n: number, seed = 7) => new Uint8Array(n).map((_x, i) => (i * seed + (i >> 10)) & 255);
const same = (a: Uint8Array, b: Uint8Array) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

// The same walk through every drive: list, upload small and large, download, folders, move, copy, search, remove.
async function walk(w: any, accountId: string, opts: { large: number; search?: string; quota?: boolean; chunkCounter?: () => number }) {
    const m = w.methods;
    const root = await m.listFiles({ accountId, path: "/" });
    expect(root.returnValue, JSON.stringify(root)).toBe(true);
    const small = bytesOf(3000);
    w.files.data["/media/internal/small.txt"] = small;
    const up = await m.uploadFile({ accountId, from: "/media/internal/small.txt", to: "/small.txt" });
    expect(up.returnValue, JSON.stringify(up)).toBe(true);
    expect(up.entry).toMatchObject({ name: "small.txt", path: "/small.txt", type: "file", size: 3000 });
    // Large: in chunks (an upload session, multipart, chunked upload), progress shown, then cleared.
    const big = bytesOf(opts.large, 13);
    w.files.data["/media/internal/big.bin"] = big;
    const before = opts.chunkCounter ? opts.chunkCounter() : 0;
    w.ongoing.length = 0;
    const upBig = await m.uploadFile({ accountId, from: "/media/internal/big.bin", to: "/big.bin" });
    expect(upBig.returnValue, JSON.stringify(upBig)).toBe(true);
    expect(upBig.entry.size).toBe(big.length);
    if (opts.chunkCounter) expect(opts.chunkCounter() - before).toBeGreaterThan(1);
    expect(w.ongoing.some((o: any) => o.op === "set" && /^Uploading big\.bin$/.test(o.title) && o.progress >= 0)).toBe(true);
    expect(w.ongoing[w.ongoing.length - 1].op).toBe("clear");
    // Download it back in ranges.
    const down = await m.downloadFile({ accountId, path: "/big.bin", to: "/media/internal/.phoenix/drive-cache/x/big.bin" });
    expect(down.returnValue, JSON.stringify(down)).toBe(true);
    expect(same(w.files.data["/media/internal/.phoenix/drive-cache/x/big.bin"], big)).toBe(true);
    expect(w.files.data["/media/internal/.phoenix/drive-cache/x/big.bin.part"]).toBeUndefined();
    // Not over a file without overwrite.
    const again = await m.uploadFile({ accountId, from: "/media/internal/small.txt", to: "/small.txt", overwrite: false });
    expect(again).toMatchObject({ returnValue: false, errorCode: E.EXISTS });
    // Folders, rename, move, copy.
    expect((await m.makeFolder({ accountId, path: "/Trip" })).returnValue).toBe(true);
    expect((await m.makeFolder({ accountId, path: "/Trip" }))).toMatchObject({ returnValue: false, errorCode: E.EXISTS });
    expect((await m.moveFile({ accountId, from: "/small.txt", to: "/Trip/notes.txt" })).returnValue).toBe(true);
    const trip = await m.listFiles({ accountId, path: "/Trip" });
    expect(trip.entries.map((e: any) => e.name)).toEqual(["notes.txt"]);
    const copy = await m.copyFile({ accountId, from: "/Trip/notes.txt", to: "/notes copy.txt" });
    if (copy.returnValue === false) expect(copy.errorCode).toBe(E.UNSUPPORTED);
    else {
        const c = await m.downloadFile({ accountId, path: "/notes copy.txt", to: "/media/internal/copy.txt" });
        expect(c.returnValue).toBe(true);
        expect(same(w.files.data["/media/internal/copy.txt"], small)).toBe(true);
    }
    // Search, where the drive has it.
    if (opts.search !== undefined) {
        const s = await m.searchFiles({ accountId, query: "notes" });
        expect(s.returnValue, JSON.stringify(s)).toBe(true);
        expect(s.entries.some((e: any) => e.path === "/Trip/notes.txt")).toBe(true);
    }
    if (opts.quota) {
        const q = await m.driveQuota({ accountId });
        expect(q.returnValue, JSON.stringify(q)).toBe(true);
        expect(q.used).toBeGreaterThan(0);
    }
    // Remove: a file, then a folder with what is in it.
    expect((await m.removeFile({ accountId, path: "/big.bin" })).returnValue).toBe(true);
    expect((await m.statFile({ accountId, path: "/big.bin" }))).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
    expect((await m.removeFile({ accountId, path: "/Trip" })).returnValue).toBe(true);
    expect((await m.listFiles({ accountId, path: "/Trip" }))).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
}

// ---- WebDAV: Nextcloud, ownCloud, any server -------------------------------------------------------

describe("WebDAV drives", () => {
    it("Nextcloud with an app password: browse, chunked upload, ranged download, search, quota", async () => {
        const w = await world();
        const r = await w.methods.checkCredentials({ templateId: T.nextcloud, username: "phoenix", password: "app-password-1", config: { server: fake.origin } });
        expect(r.config).toMatchObject({ provider: "nextcloud", serverUrl: fake.origin + "/remote.php/dav/files/phoenix/" });
        expect(r.credentials.common).toMatchObject({ user: "phoenix", password: "app-password-1", settings: { serverUrl: r.config.serverUrl } });
        const id = await w.addAccount("nextcloud", r);
        const list = await w.methods.listFiles({ accountId: id, path: "/" });
        expect(list.entries.map((e: any) => e.name).sort()).toEqual(["Documents", "Photos", "Shared"]);
        const photos = await w.methods.listFiles({ accountId: id, path: "/Photos" });
        expect(photos.entries.find((e: any) => e.name === "lake.png")).toMatchObject({ type: "file", mimeType: "image/png", path: "/Photos/lake.png" });
        const ranges = fake.ranges || 0;
        await walk(w, id, { large: 17 * 1024 * 1024, search: "notes", quota: true, chunkCounter: () => fake.chunks || 0 });
        expect((fake.ranges || 0) - ranges).toBeGreaterThan(2);
    });

    it("Nextcloud's Login Flow v2: the server's page gives an app password", async () => {
        const w = await world();
        const start = await w.methods.loginFlowStart({ server: fake.origin.replace(/^http:\/\//, "http://") });
        expect(start.returnValue, JSON.stringify(start)).toBe(true);
        expect(start.loginUrl).toMatch(/\/login\/v2\/flow\//);
        expect((await w.methods.loginFlowPoll({ server: start.server, pollEndpoint: start.pollEndpoint, pollToken: start.pollToken }))).toMatchObject({ done: false });
        // The user signs in on the server's page (in the browser).
        const page = await request({ method: "GET", url: start.loginUrl });
        const grant = /href='([^']+)'/.exec(page.body)![1];
        await request({ method: "GET", url: fake.origin + grant });
        const done = await w.methods.loginFlowPoll({ server: start.server, pollEndpoint: start.pollEndpoint, pollToken: start.pollToken });
        expect(done).toMatchObject({ returnValue: true, done: true, username: "phoenix@" + new URL(fake.origin).host });
        expect(done.credentials.common.password).toMatch(/^app-password-\d+$/);
        // A poll address elsewhere is refused.
        expect((await w.methods.loginFlowPoll({ server: start.server, pollEndpoint: "http://192.0.2.1/poll", pollToken: "x" })).returnValue).toBe(false);
        // Deleting the account deletes its app password on the server.
        const id = await w.addAccount("nextcloud", done);
        const deleted = fake.appPasswordDeleted || 0;
        expect((await w.methods.onDelete({ accountId: id })).returnValue).toBe(true);
        expect(fake.appPasswordDeleted).toBe(deleted + 1);
    });

    it("refuses a wrong password, and says when the server is not there", async () => {
        const w = await world();
        const bad = await w.methods.checkCredentials({ templateId: T.owncloud, username: "phoenix", password: "nope", config: { server: fake.origin } });
        expect(bad).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        const gone = await w.methods.checkCredentials({ templateId: T.webdav, username: "u", password: "p", config: { server: "http://127.0.0.1:9/dav/" } });
        expect(gone).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED" });
    });

    it("any WebDAV server: the address as given; one PUT; offline gives OFFLINE, not a crash", async () => {
        const w = await world();
        const r = await w.methods.checkCredentials({ templateId: T.webdav, username: "phoenix", password: "app-password-1",
                                                     config: { server: fake.origin + "/remote.php/dav/files/phoenix/Documents" } });
        expect(r.config.serverUrl).toBe(fake.origin + "/remote.php/dav/files/phoenix/Documents/");
        const id = await w.addAccount("webdav", r);
        const list = await w.methods.listFiles({ accountId: id, path: "/" });
        expect(list.entries.map((e: any) => e.name)).toContain("notes.txt");
        expect((await w.methods.searchFiles({ accountId: id, query: "x" }))).toMatchObject({ returnValue: false, errorCode: E.UNSUPPORTED });
        fake.offline = true;
        try {
            const off = await w.methods.listFiles({ accountId: id, path: "/" });
            expect(off).toMatchObject({ returnValue: false, errorCode: E.OFFLINE, offline: true });
            expect(off.errorText).toMatch(/connection/i);
        } finally {
            fake.offline = false;
        }
    });

    it("cancels a transfer between two chunks", async () => {
        const w = await world();
        const id = await w.addAccount("nextcloud", await w.methods.checkCredentials({ templateId: T.nextcloud, username: "phoenix", password: "app-password-1",
                                                                                     config: { server: fake.origin } }));
        w.files.data["/media/internal/huge.bin"] = bytesOf(25 * 1024 * 1024);
        const going = w.methods.uploadFile({ accountId: id, from: "/media/internal/huge.bin", to: "/huge.bin", transferId: "t-cancel" });
        await new Promise((r) => setTimeout(r, 20));
        const list = await w.methods.transfers({});
        expect(list.transfers.map((t: any) => t.id)).toContain("t-cancel");
        expect((await w.methods.cancelTransfer({ transferId: "t-cancel" })).returnValue).toBe(true);
        expect(await going).toMatchObject({ returnValue: false, errorCode: E.CANCELED });
        expect((await w.methods.statFile({ accountId: id, path: "/huge.bin" }))).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
    });
});

// ---- S3 ------------------------------------------------------------------------------------------

describe("S3-compatible storage", () => {
    it("signs requests as AWS's documentation's example (Signature V4)", () => {
        // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "GET Object".
        const req = { method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" } as any };
        s3lib.sign(req, { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }, "us-east-1",
                   Date.UTC(2013, 4, 24), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        expect(req.headers.Authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
            "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    });

    it("a bucket with an access key: folders as prefixes, multipart upload, ranged download, copy and move", async () => {
        const w = await world();
        const r = await w.methods.checkCredentials({ templateId: T.s3, username: "PHOENIXKEY", password: "phoenix-secret",
                                                     config: { preset: "minio", endpoint: fake.origin, bucket: "phoenix-files" } });
        expect(r.returnValue, JSON.stringify(r)).toBe(true);
        expect(r.username).toBe("phoenix-files@" + new URL(fake.origin).host);
        const id = await w.addAccount("s3", r);
        const list = await w.methods.listFiles({ accountId: id, path: "/" });
        expect(list.entries.map((e: any) => e.name + ":" + e.type).sort()).toEqual(["Documents:directory", "Photos:directory", "Shared:directory"]);
        expect((await w.methods.listFiles({ accountId: id, path: "/Shared" }))).toMatchObject({ returnValue: true, entries: [] });
        await walk(w, id, { large: 17 * 1024 * 1024, search: "notes", chunkCounter: () => fake.parts || 0 });
        const bad = await w.methods.checkCredentials({ templateId: T.s3, username: "PHOENIXKEY", password: "wrong",
                                                       config: { preset: "minio", endpoint: fake.origin, bucket: "phoenix-files" } });
        expect(bad).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
    });

    it("knows the presets' endpoints (Backblaze B2, Wasabi)", async () => {
        const w = await world();
        const info = await w.methods.providerInfo({ templateId: T.s3 });
        expect(info.presets.map((p: any) => p.id)).toEqual(["b2", "wasabi", "aws", "minio"]);
        expect(info.presets[0].endpoint).toBe("https://s3.{region}.backblazeb2.com");
    });
});

// ---- The OAuth drives ------------------------------------------------------------------------------

const OAUTH: [string, string, number, () => number][] = [
    ["dropbox", "phoenix@dropbox.test", 17 * 1024 * 1024, () => fake.dbxChunks || 0],
    ["onedrive", "phoenix@onedrive.test", 17 * 1024 * 1024, () => fake.graphChunks || 0],
    ["googledrive", "phoenix@gdrive.test", 17 * 1024 * 1024, () => fake.gdChunks || 0],
    ["box", "phoenix@box.test", 21 * 1024 * 1024, () => fake.boxParts || 0]
];

describe("OAuth drives", () => {
    for (const [k, user, large, chunks] of OAUTH) {
        it(k + ": signs in with PKCE, the token in the key store; the whole walk", async () => {
            const w = await world();
            const info = await w.methods.providerInfo({ templateId: T[k] });
            expect(info).toMatchObject({ returnValue: true, available: true });
            const r = await w.methods.signIn({ templateId: T[k] });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            expect(r.username).toBe(user);
            expect(Object.keys(r.credentials.common)).toEqual(["oauthKey"]);
            const key = w.keys["key:" + r.credentials.common.oauthKey];
            expect(key).toMatchObject({ owner: SERVICE });
            expect(JSON.stringify(r)).not.toContain(key.accessToken);
            expect(w.sheets[0]).toMatch(/code_challenge=[\w-]{43}&code_challenge_method=S256/);
            if (k === "googledrive") expect(decodeURIComponent(w.sheets[0])).toContain("scope=https://www.googleapis.com/auth/drive.file");
            const id = await w.addAccount(k, r);
            // The validator (Accounts' check) agrees with the sign-in.
            expect((await w.methods.checkCredentials({ templateId: T[k], config: r.config })).username).toBe(user);
            if (k === "googledrive") {
                // drive.file: only Phoenix's own files; the drive starts empty here.
                expect((await w.methods.listFiles({ accountId: id, path: "/" })).entries).toEqual([]);
            } else {
                const photos = await w.methods.listFiles({ accountId: id, path: "/Photos" });
                expect(photos.entries.map((e: any) => e.name).sort()).toEqual(["hills.png", "lake.png"]);
            }
            await walk(w, id, { large, search: "notes", quota: true, chunkCounter: chunks });
            // An expired token is refreshed by the OAuth service.
            fake.expireTokens();
            key.expiresAt = 1;
            expect((await w.methods.listFiles({ accountId: id, path: "/" })).returnValue).toBe(true);
            // Signed out: the token goes with the account.
            expect((await w.methods.onDelete({ accountId: id })).returnValue).toBe(true);
            expect(w.keys["key:" + r.credentials.common.oauthKey]).toBeUndefined();
        });
    }

    it("without a client id in the build: 'not available in this build', no sign-in page", async () => {
        const w = await world({ clients: { dropbox: fake.clients().dropbox } });
        const info = await w.methods.providerInfo({ templateId: T.box });
        expect(info).toMatchObject({ returnValue: true, available: false });
        expect(info.reason).toMatch(/Box is not available in this build/);
        const r = await w.methods.signIn({ templateId: T.box });
        expect(r).toMatchObject({ returnValue: false, errorCode: "NOT_AVAILABLE" });
        expect(w.sheets).toEqual([]);
        const none = await world({ clients: null });
        expect((await none.methods.providerInfo({ templateId: T.onedrive })).available).toBe(false);
    });

    it("a refused sign-in (expired, revoked) is AUTH for the files and 401 for the account", async () => {
        const w = await world();
        const id = await w.addAccount("dropbox", await w.methods.signIn({ templateId: T.dropbox }));
        fake.expireTokens();
        // The key's own refresh is refused too (the refresh token revoked).
        const creds = w.credentials[id].common;
        w.keys["key:" + creds.oauthKey].refreshToken = "rt-revoked";
        w.keys["key:" + creds.oauthKey].expiresAt = 1;
        const l = await w.methods.listFiles({ accountId: id, path: "/" });
        expect(l).toMatchObject({ returnValue: false, errorCode: E.AUTH });
        const s = await w.methods.sync({ accountId: id });
        expect(s).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
    });
});

// ---- The file manager's side: /media/drives ------------------------------------------------------

describe("drives as places of the file manager (drives.ts)", () => {
    async function routed() {
        const w = await world();
        const id = await w.addAccount("nextcloud", await w.methods.checkCredentials({ templateId: T.nextcloud, username: "phoenix", password: "app-password-1",
                                                                                     config: { server: fake.origin } }), "nc1");
        // The device's file manager for its own files, over the same memory.
        const local: any = {
            list: async (p: any) => ({ returnValue: true, path: p.path, entries: Object.keys(w.files.data).filter((k) => k.replace(/\/[^/]*$/, "") === p.path)
                .map((k) => ({ name: k.replace(/^.*\//, ""), path: k, type: "file", size: w.files.data[k].length, mtime: 0, mode: 0o644 })) }),
            stat: async (p: any) => (w.files.data[p.path] ? { returnValue: true, entry: { name: p.path.replace(/^.*\//, ""), path: p.path, type: "file",
                                                                                          size: w.files.data[p.path].length, mtime: 0 } }
                : { returnValue: false, errorCode: 1, errorText: "No such file" }),
            mkdir: async (p: any) => ({ returnValue: true, path: p.path }),
            remove: async (p: any) => { delete w.files.data[p.path]; return { returnValue: true, path: p.path }; },
            read: async (p: any) => (w.files.data[p.path] ? { returnValue: true, path: p.path, encoding: p.encoding || "utf8", size: w.files.data[p.path].length,
                data: Buffer.from(w.files.data[p.path]).toString(p.encoding === "base64" ? "base64" : "utf8") } : { returnValue: false, errorCode: 1, errorText: "No such file" }),
            write: async (p: any) => { w.files.data[p.path] = new Uint8Array(Buffer.from(p.data, p.encoding === "base64" ? "base64" : "utf8")); return { returnValue: true, path: p.path, size: w.files.data[p.path].length }; }
        };
        const router = kit.createDriveRouter({ call: (uri: string, params: any) => w.bus.call(uri, params), local });
        return { w, id, router };
    }

    it("lists the drive accounts under /media/drives, and their files under each", async () => {
        const { router } = await routed();
        expect(router.handles("/media/drives/nc1/Photos")).toBe(true);
        expect(router.handles("/media/drivesx")).toBe(false);
        const top = await router.list({ path: "/media/drives" });
        expect(top.entries).toEqual([expect.objectContaining({ name: "nc1", path: "/media/drives/nc1", type: "directory",
                                                               drive: expect.objectContaining({ accountId: "nc1", title: "Nextcloud", templateId: T.nextcloud }) })]);
        const photos = await router.list({ path: "/media/drives/nc1/Photos" });
        expect(photos.entries.map((e: any) => e.path).sort()).toEqual(["/media/drives/nc1/Photos/hills.png", "/media/drives/nc1/Photos/lake.png"]);
        expect(photos.entries[0].remote).toBe(true);
        expect((await router.list({ path: "/media/drives/nobody/x" }))).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
    });

    it("copies from the device to a drive (an upload) and back (a download)", async () => {
        const { w, router } = await routed();
        w.files.data["/media/internal/Pictures/shot.png"] = new Uint8Array(fake.picture);
        const up = await router.copy({ from: "/media/internal/Pictures/shot.png", to: "/media/drives/nc1/Photos/shot.png" });
        expect(up.returnValue, JSON.stringify(up)).toBe(true);
        expect(fake.trees.dav.byPath("/Photos/shot.png").bytes.length).toBe(fake.picture.length);
        const exists = await router.copy({ from: "/media/internal/Pictures/shot.png", to: "/media/drives/nc1/Photos/shot.png" });
        expect(exists).toMatchObject({ returnValue: false, errorCode: E.EXISTS });
        const down = await router.copy({ from: "/media/drives/nc1/Documents/notes.txt", to: "/media/internal/Documents/notes.txt" });
        expect(down.returnValue, JSON.stringify(down)).toBe(true);
        expect(Buffer.from(w.files.data["/media/internal/Documents/notes.txt"]).toString()).toMatch(/^Shopping/);
        const mv = await router.move({ from: "/media/drives/nc1/Photos/shot.png", to: "/media/drives/nc1/Shared/shot.png" });
        expect(mv.returnValue).toBe(true);
        expect(fake.trees.dav.byPath("/Shared/shot.png")).toBeTruthy();
    });

    it("opens a file through the cache, again without downloading, and offline from the cache", async () => {
        const { w, router } = await routed();
        const n = fake.requests.length;
        const o1 = await router.open({ path: "/media/drives/nc1/Photos/lake.png" });
        expect(o1).toMatchObject({ returnValue: true, path: "/media/internal/.phoenix/drive-cache/nc1/Photos/lake.png", remotePath: "/media/drives/nc1/Photos/lake.png" });
        expect(same(w.files.data[o1.path], new Uint8Array(fake.picture))).toBe(true);
        const gets = () => fake.requests.slice(n).filter((r: any) => r.method === "GET").length;
        const g1 = gets();
        const o2 = await router.open({ path: "/media/drives/nc1/Photos/lake.png" });
        expect(o2.cached).toBe(true);
        expect(gets()).toBe(g1);
        fake.offline = true;
        try {
            const o3 = await router.open({ path: "/media/drives/nc1/Photos/lake.png" });
            expect(o3).toMatchObject({ returnValue: true, stale: true, path: o1.path });
            const o4 = await router.open({ path: "/media/drives/nc1/Photos/hills.png" });
            expect(o4).toMatchObject({ returnValue: false, errorCode: E.OFFLINE });
        } finally {
            fake.offline = false;
        }
    });

    it("reads and writes a text file of a drive (the Files app's editor)", async () => {
        const { router } = await routed();
        const r = await router.read({ path: "/media/drives/nc1/Documents/notes.txt", encoding: "utf8" });
        expect(r).toMatchObject({ returnValue: true, path: "/media/drives/nc1/Documents/notes.txt" });
        expect(r.data).toMatch(/^Shopping/);
        const wr = await router.write({ path: "/media/drives/nc1/Documents/notes.txt", data: "Shopping: nothing.\n", encoding: "utf8" });
        expect(wr.returnValue, JSON.stringify(wr)).toBe(true);
        expect(fake.trees.dav.byPath("/Documents/notes.txt").bytes.toString()).toBe("Shopping: nothing.\n");
        expect((await router.write({ path: "/media/drives/nc1/Documents/notes.txt", data: "x", overwrite: false }))).toMatchObject({ returnValue: false, errorCode: E.EXISTS });
        expect((await router.mkdir({ path: "/media/drives/nc1/Documents/Old" })).returnValue).toBe(true);
        expect((await router.remove({ path: "/media/drives/nc1/Documents/Old" })).returnValue).toBe(true);
        expect((await router.quota({ path: "/media/drives/nc1" })).used).toBeGreaterThan(0);
    });
});
