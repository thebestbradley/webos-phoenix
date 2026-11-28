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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
        remove: async (p: string) => { delete data[p]; },
        removeTree: async (p: string) => { Object.keys(data).filter((k) => k === p || k.indexOf(p + "/") === 0).forEach((k) => { delete data[k]; }); }
    };
}

async function world(opts?: { clients?: any; env?: any }) {
    const db = memdb.createMemDb(memdb.KIND_PARENTS);
    const tempdb = memdb.createMemDb();
    const keys: Record<string, any> = {};
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    const ongoing: any[] = [];
    const sheets: string[] = [];
    // closed: the person closes the sign-in sheet (on Google's page or its Picker).
    const sheet = { closed: false };
    const oauth = oauthLib.createOAuthService({
        request,
        keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
        crypto: { randomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)),
                  sha256: async (b: Uint8Array) => new Uint8Array(require("crypto").createHash("sha256").update(Buffer.from(b)).digest()) },
        redirectUri: "http://127.0.0.1:1/signed-in.html",
        // The browser sheet: the provider's page, its redirects followed, until the redirect address.
        sheet: async (url: string, prefix: string) => {
            sheets.push(url);
            if (sheet.closed) return null;
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
    methods = kit.createConnectorService(drives, Object.assign({
        luna: bus, request, periodicSync: false, files,
        systemConfig: async (name: string) => (name === "drives/clients.json" ? clients : null)
    }, (opts && opts.env) || {}));
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
    return { methods, files, keys, accounts, credentials, ongoing, sheets, sheet, addAccount, bus };
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
            expect(Object.keys(r.credentials.common)).toEqual(k === "googledrive" ? ["oauthKey", "settings"] : ["oauthKey"]);
            const key = w.keys["key:" + r.credentials.common.oauthKey];
            expect(key).toMatchObject({ owner: SERVICE });
            expect(JSON.stringify(r)).not.toContain(key.accessToken);
            expect(w.sheets[0]).toMatch(/code_challenge=[\w-]{43}&code_challenge_method=S256/);
            if (k === "googledrive") {
                expect(decodeURIComponent(w.sheets[0])).toContain("scope=https://www.googleapis.com/auth/drive.file&");
                expect(r.config.access).toBe("drive.file");
            }
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

    // Google Drive: the person chooses what Phoenix may see (the owner, 27 November 2026).
    describe("Google Drive: files you open with Phoenix, or all your Drive", () => {
        const idOf = (p: string) => fake.trees.googledrive.byPath(p).id;
        const names = (l: any) => l.entries.map((e: any) => e.name).sort();
        // (The other tests' files stay in the stand-in drive; what Phoenix may see starts afresh.)
        beforeEach(() => { fake.gd.picks = []; fake.gd.fullScopeApproved = true; fake.gd.appFiles.clear(); });

        it("files you open with Phoenix: drive.file with Google's Picker; only the app's files and the picked ones", async () => {
            const w = await world();
            expect(await w.methods.providerInfo({ templateId: T.googledrive })).toMatchObject({ available: true, fullScopeApproved: false });
            const shown = fake.gd.pickerShown;
            fake.gd.picks = [idOf("/Photos/lake.png")];
            const r = await w.methods.signIn({ templateId: T.googledrive, access: "drive.file" });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            const asked = new URL(w.sheets[0]).searchParams;
            expect(asked.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
            expect([asked.get("trigger_onepick"), asked.get("allow_multiple"), asked.get("prompt")]).toEqual(["true", "true", "consent"]);
            expect(fake.gd.pickerShown).toBe(shown + 1);
            expect(r.config.access).toBe("drive.file");
            expect(r.credentials.common.settings).toEqual({ access: "drive.file" });
            const id = await w.addAccount("googledrive", r, "gd-file");
            // The picked picture, at the top (its folder is not Phoenix's to see); not the rest of the drive.
            expect(names(await w.methods.listFiles({ accountId: id, path: "/" }))).toEqual(["lake.png"]);
            expect(await w.methods.listFiles({ accountId: id, path: "/Photos" })).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
            const got = await w.methods.downloadFile({ accountId: id, path: "/lake.png", to: "/media/internal/lake.png" });
            expect(got.returnValue, JSON.stringify(got)).toBe(true);
            expect(same(w.files.data["/media/internal/lake.png"], fake.picture)).toBe(true);
            // Search finds the picked file, not the person's other notes.
            expect((await w.methods.searchFiles({ accountId: id, query: "notes" })).entries).toEqual([]);
            expect((await w.methods.searchFiles({ accountId: id, query: "lake" })).entries.map((e: any) => e.path)).toEqual(["/lake.png"]);
            // What Phoenix saves there is its own, in a folder it made too.
            w.files.data["/media/internal/memo.txt"] = bytesOf(100);
            expect((await w.methods.makeFolder({ accountId: id, path: "/From Phoenix" })).returnValue).toBe(true);
            expect((await w.methods.uploadFile({ accountId: id, from: "/media/internal/memo.txt", to: "/From Phoenix/memo.txt" })).returnValue).toBe(true);
            expect(names(await w.methods.listFiles({ accountId: id, path: "/" }))).toEqual(["From Phoenix", "lake.png"]);
            expect(names(await w.methods.listFiles({ accountId: id, path: "/From Phoenix" }))).toEqual(["memo.txt"]);
            // Signing in again picks more: the notes, from a folder of the person's.
            fake.gd.picks = [idOf("/Documents/notes.txt")];
            const again = await w.methods.signIn({ templateId: T.googledrive, access: "drive.file", accountId: id });
            expect(again.returnValue, JSON.stringify(again)).toBe(true);
            w.credentials[id] = again.credentials;
            expect(names(await w.methods.listFiles({ accountId: id, path: "/" }))).toEqual(["From Phoenix", "lake.png", "notes.txt"]);
        });

        it("all your Drive: the drive scope, no Picker; the whole drive", async () => {
            const w = await world({ clients: Object.assign(fake.clients(), { googledrive: Object.assign(fake.clients().googledrive, { scope: "drive" }) }) });
            expect((await w.methods.providerInfo({ templateId: T.googledrive })).fullScopeApproved).toBe(true);
            const r = await w.methods.signIn({ templateId: T.googledrive, access: "drive" });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            const asked = new URL(w.sheets[0]).searchParams;
            expect(asked.get("scope")).toBe("https://www.googleapis.com/auth/drive");
            expect(asked.get("trigger_onepick")).toBeNull();
            expect(r.config.access).toBe("drive");
            const id = await w.addAccount("googledrive", r, "gd-all");
            expect(names(await w.methods.listFiles({ accountId: id, path: "/" }))).toEqual(expect.arrayContaining(["Documents", "Photos", "Shared"]));
            expect(names(await w.methods.listFiles({ accountId: id, path: "/Photos" }))).toEqual(["hills.png", "lake.png"]);
            const found = await w.methods.searchFiles({ accountId: id, query: "notes" });
            expect(found.returnValue, JSON.stringify(found)).toBe(true);
            expect(found.entries.map((e: any) => e.path)).toContain("/Documents/notes.txt");
        });

        it("all your Drive before Google has approved Phoenix: refused on Google's page; changing access later by signing in again", async () => {
            const w = await world();
            fake.gd.fullScopeApproved = false;
            expect(await w.methods.signIn({ templateId: T.googledrive, access: "drive" })).toMatchObject({ returnValue: false, errorCode: "ACCESS_DENIED" });
            // Files you open with Phoenix instead; later, all of it, once approved (Change Access: a sign-in again).
            const r = await w.methods.signIn({ templateId: T.googledrive, access: "drive.file" });
            const id = await w.addAccount("googledrive", r, "gd-change");
            expect(names(await w.methods.listFiles({ accountId: id, path: "/" }))).toEqual([]);
            fake.gd.fullScopeApproved = true;
            const all = await w.methods.signIn({ templateId: T.googledrive, access: "drive", accountId: id });
            expect(all.returnValue, JSON.stringify(all)).toBe(true);
            expect(all.credentials.common.settings).toEqual({ access: "drive" });
            w.credentials[id] = all.credentials;
            // The old key went; the account now sees the whole drive though its first config said drive.file.
            expect(w.keys["key:" + r.credentials.common.oauthKey]).toBeUndefined();
            expect(names(await w.methods.listFiles({ accountId: id, path: "/" }))).toEqual(expect.arrayContaining(["Documents", "Photos", "Shared"]));
        });
    });

    // Google Drive as a person meets it, both access choices (the owner, 28 November 2026).
    describe("Google Drive: the edge cases", () => {
        const gt = () => fake.trees.googledrive;
        const idOf = (p: string) => gt().byPath(p).id;
        const names = (l: any) => (l.entries || []).map((e: any) => e.name).sort();
        const keyIds = (w: any) => Object.keys(w.keys).filter((k) => k.indexOf("key:") === 0);
        const allClients = () => Object.assign(fake.clients(), { googledrive: Object.assign(fake.clients().googledrive, { scope: "drive" }) });
        const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        beforeEach(() => {
            Object.assign(fake.gd, { picks: [], fullScopeApproved: true, as: "phoenix@gdrive.test", grantOnly: null, quotaFull: false, onChunk: null, bytesPerSec: 0 });
            fake.gd.appFiles.clear();
            fake.offline = false;
        });
        async function signedIn(w: any, access: string, id: string, picks?: string[]) {
            fake.gd.picks = picks || [];
            const r = await w.methods.signIn({ templateId: T.googledrive, access });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            return { r, id: await w.addAccount("googledrive", r, id) };
        }
        async function again(w: any, id: string, access: string, picks?: string[]) {
            fake.gd.picks = picks || [];
            const r = await w.methods.signIn({ templateId: T.googledrive, access, accountId: id });
            expect(r.returnValue, JSON.stringify(r)).toBe(true);
            w.credentials[id] = r.credentials;
            return r;
        }
        const root = async (w: any, id: string, path = "/") => names(await w.methods.listFiles({ accountId: id, path }));

        it("the Picker closed, nothing picked, then more picked from the account: it stays signed in", async () => {
            const w = await world();
            // The sheet closed on Google's page or its Picker: no account, no key kept.
            w.sheet.closed = true;
            expect(await w.methods.signIn({ templateId: T.googledrive, access: "drive.file" })).toMatchObject({ returnValue: false, errorCode: "CANCELED" });
            expect(keyIds(w)).toEqual([]);
            w.sheet.closed = false;
            // Nothing picked: an account with only what Phoenix saves to it.
            const { r, id } = await signedIn(w, "drive.file", "gd-none", []);
            expect(await root(w, id)).toEqual([]);
            expect((await w.methods.sync({ accountId: id })).returnValue).toBe(true);
            // Change what Phoenix may see: the Picker again. Google's revocation
            // ends the whole grant (the new token too), so the old key is only
            // forgotten on the device, not revoked.
            const revoked = fake.revoked || 0;
            await again(w, id, "drive.file", [idOf("/Photos/lake.png")]);
            expect(fake.revoked || 0).toBe(revoked);
            expect(w.keys["key:" + r.credentials.common.oauthKey]).toBeUndefined();
            expect(await root(w, id)).toEqual(["lake.png"]);
            expect((await w.methods.sync({ accountId: id })).returnValue).toBe(true);
        });

        it("signing in again as another Google account is refused; the account keeps its own sign-in", async () => {
            const w = await world();
            const { r, id } = await signedIn(w, "drive.file", "gd-mine", [idOf("/Photos/lake.png")]);
            fake.gd.as = "someone.else@gdrive.test";
            const before = keyIds(w);
            const other = await w.methods.signIn({ templateId: T.googledrive, access: "drive.file", accountId: id });
            expect(other).toMatchObject({ returnValue: false, errorCode: "WRONG_ACCOUNT" });
            expect(other.errorText).toMatch(/someone\.else@gdrive\.test/);
            expect(other.errorText).toMatch(/phoenix@gdrive\.test/);
            expect(keyIds(w)).toEqual(before);
            expect(w.keys["key:" + r.credentials.common.oauthKey]).toBeDefined();
            expect(await root(w, id)).toEqual(["lake.png"]);
        });

        it("files you open with Phoenix, all your Drive, then back: each sign-in's choice; the page shows the account's", async () => {
            const w = await world({ clients: allClients() });
            const { id } = await signedIn(w, "drive.file", "gd-switch", [idOf("/Photos/lake.png")]);
            expect(await w.methods.providerInfo({ templateId: T.googledrive, accountId: id })).toMatchObject({ returnValue: true, access: "drive.file" });
            await again(w, id, "drive");
            expect((await w.methods.providerInfo({ templateId: T.googledrive, accountId: id })).access).toBe("drive");
            expect(await root(w, id)).toEqual(expect.arrayContaining(["Documents", "Photos", "Shared"]));
            await again(w, id, "drive.file");
            expect((await w.methods.providerInfo({ templateId: T.googledrive, accountId: id })).access).toBe("drive.file");
            // What was picked is Phoenix's still; nothing else is.
            expect(await root(w, id)).toEqual(["lake.png"]);
        });

        it("all your Drive asked, only per-file access ticked on Google's page: the account says files you open with Phoenix", async () => {
            const w = await world({ clients: allClients() });
            fake.gd.grantOnly = "https://www.googleapis.com/auth/drive.file";
            const { r, id } = await signedIn(w, "drive", "gd-partial");
            expect(r.credentials.common.settings).toEqual({ access: "drive.file" });
            expect(await root(w, id)).toEqual([]);
        });

        it("the token expires mid-upload: refreshed, the upload goes on; one Google refuses before its time here is refreshed and tried again", async () => {
            const w = await world();
            const { r, id } = await signedIn(w, "drive.file", "gd-token");
            const key = w.keys["key:" + r.credentials.common.oauthKey];
            const big = bytesOf(9 * 1024 * 1024, 5);
            w.files.data["/media/internal/big9.bin"] = big;
            const refreshes = fake.refreshes || 0;
            fake.gd.onChunk = () => { fake.gd.onChunk = null; fake.expireTokens(); key.expiresAt = 1; };
            const up = await w.methods.uploadFile({ accountId: id, from: "/media/internal/big9.bin", to: "/big9.bin" });
            expect(up.returnValue, JSON.stringify(up)).toBe(true);
            expect(fake.refreshes).toBeGreaterThan(refreshes);
            expect(same(new Uint8Array(gt().byPath("/big9.bin").bytes), big)).toBe(true);
            // Expired at Google, not yet here (a clock that differs): a 401, a refresh, the call again.
            fake.expireTokens();
            const list = await w.methods.listFiles({ accountId: id, path: "/" });
            expect(list.returnValue, JSON.stringify(list)).toBe(true);
            fake.expireTokens();
            const down = await w.methods.downloadFile({ accountId: id, path: "/big9.bin", to: "/media/internal/back9.bin" });
            expect(down.returnValue, JSON.stringify(down)).toBe(true);
            expect(same(w.files.data["/media/internal/back9.bin"], big)).toBe(true);
        });

        it("Phoenix removed at Google (the refresh token revoked): the account is flagged, Files says sign in again; signing in again mends it", async () => {
            const w = await world();
            const { id } = await signedIn(w, "drive.file", "gd-revoked", [idOf("/Photos/lake.png")]);
            expect((await w.methods.sync({ accountId: id })).returnValue).toBe(true);
            fake.revokeGrant("googledrive", "phoenix@gdrive.test");
            expect(await w.methods.listFiles({ accountId: id, path: "/" })).toMatchObject({ returnValue: false, errorCode: E.AUTH });
            expect(await w.methods.sync({ accountId: id })).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            const states = async () => (await w.bus.tempdb.find({ from: "com.palm.account.syncstate:1", where: [{ prop: "accountId", op: "=", val: id }] }))
                .map((x: any) => x.syncState);
            expect(await states()).toEqual(["ERROR"]);
            await again(w, id, "drive.file");
            expect((await w.methods.sync({ accountId: id })).returnValue).toBe(true);
            expect(await states()).toEqual(["IDLE"]);
            expect(await root(w, id)).toEqual(["lake.png"]);
        });

        it("a file deleted on Google while open here: the next open says it is gone, and the device's copy goes too", async () => {
            const w = await world();
            const gone = gt().put("/Documents/gone.txt", Buffer.from("soon gone"));
            const { id } = await signedIn(w, "drive.file", "gd-gone", [gone.id]);
            const router = deviceRouter(w);
            const o1 = await router.open({ path: "/media/drives/" + id + "/gone.txt" });
            expect(o1.returnValue, JSON.stringify(o1)).toBe(true);
            expect(Buffer.from(w.files.data[o1.path]).toString()).toBe("soon gone");
            gone.trashed = true;
            expect(await router.open({ path: "/media/drives/" + id + "/gone.txt" })).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
            expect(w.files.data[o1.path]).toBeUndefined();
            // Deleted while it downloads: not found, nothing half-written left.
            gone.trashed = false;
            const entry = (await w.methods.statFile({ accountId: id, path: "/gone.txt" })).entry;
            expect(entry.name).toBe("gone.txt");
            gone.trashed = true;
            expect(await w.methods.downloadFile({ accountId: id, path: "/gone.txt", to: "/media/internal/gone.txt" })).toMatchObject({ returnValue: false, errorCode: E.NOT_FOUND });
            expect(Object.keys(w.files.data).filter((k) => /\/gone\.txt/.test(k) && k.indexOf("/media/internal/") === 0 && k.indexOf("drive-cache") < 0)).toEqual([]);
        });

        it("the same name in two folders, and twice in one: each its own entry, each opens its own file", async () => {
            const w = await world({ clients: allClients() });
            const a = idOf("/Documents/notes.txt"), b = gt().put("/Shared/notes.txt", Buffer.from("Shared notes\n")).id;
            const { id } = await signedIn(w, "drive.file", "gd-same", [a, b]);
            const top = (await w.methods.listFiles({ accountId: id, path: "/" })).entries;
            expect(top.map((e: any) => e.name).sort()).toEqual(["notes (2).txt", "notes.txt"]);
            expect(top.map((e: any) => e.id).sort()).toEqual([a, b].sort());
            for (const e of top) {
                const to = "/media/internal/" + e.name;
                expect((await w.methods.downloadFile({ accountId: id, path: e.path, to })).returnValue).toBe(true);
                expect(Buffer.from(w.files.data[to]).toString()).toBe(gt().nodes.get(e.id).bytes.toString());
            }
            // Drive lets one folder have two of a name; a name already there is not given to the second.
            const twins = gt().mkdirp("/Twins");
            gt().add(twins.id, "dup.txt", "file", Buffer.from("one"));
            gt().add(twins.id, "dup.txt", "file", Buffer.from("two"));
            gt().add(twins.id, "dup (2).txt", "file", Buffer.from("real"));
            const w2 = await world({ clients: allClients() });
            const all = await signedIn(w2, "drive", "gd-same-all");
            const list = (await w2.methods.listFiles({ accountId: all.id, path: "/Twins" })).entries;
            expect(list.map((e: any) => e.name).sort()).toEqual(["dup (2).txt", "dup (3).txt", "dup.txt"]);
            const texts: string[] = [];
            for (const e of list) {
                const got = await w2.methods.downloadFile({ accountId: all.id, path: e.path, to: "/media/internal/t-" + e.name });
                expect(got.returnValue, JSON.stringify(got)).toBe(true);
                texts.push(e.name + "=" + Buffer.from(w2.files.data["/media/internal/t-" + e.name]).toString());
            }
            expect(texts).toContain("dup (2).txt=real");
            expect(texts.map((x) => x.replace(/^.*=/, "")).sort()).toEqual(["one", "real", "two"]);
        });

        it("a large file on a slow network: each request has the time its bytes need", async () => {
            // Requests may take 2 s; the network moves 2 MB a second: each part takes longer than that.
            const w = await world({ env: { timeoutMs: 2000 } });
            const { id } = await signedIn(w, "drive.file", "gd-slow");
            fake.gd.bytesPerSec = 2 * 1024 * 1024;
            try {
                // 6 MB in one request (3 s), 9 MB in parts (8 MB: 4 s), 9 MB back in ranges.
                w.files.data["/media/internal/mid.bin"] = bytesOf(6 * 1024 * 1024, 3);
                const mid = await w.methods.uploadFile({ accountId: id, from: "/media/internal/mid.bin", to: "/mid.bin" });
                expect(mid.returnValue, JSON.stringify(mid)).toBe(true);
                const big = bytesOf(9 * 1024 * 1024, 11);
                w.files.data["/media/internal/slow.bin"] = big;
                const up = await w.methods.uploadFile({ accountId: id, from: "/media/internal/slow.bin", to: "/slow.bin" });
                expect(up.returnValue, JSON.stringify(up)).toBe(true);
                const down = await w.methods.downloadFile({ accountId: id, path: "/slow.bin", to: "/media/internal/slow-back.bin" });
                expect(down.returnValue, JSON.stringify(down)).toBe(true);
                expect(same(w.files.data["/media/internal/slow-back.bin"], big)).toBe(true);
            } finally {
                fake.gd.bytesPerSec = 0;
            }
        });

        it("offline, then back: Files says so; an upload cut off leaves nothing half there; all works again", async () => {
            const w = await world();
            const { id } = await signedIn(w, "drive.file", "gd-offline", [idOf("/Photos/lake.png")]);
            fake.offline = true;
            try {
                expect(await w.methods.listFiles({ accountId: id, path: "/" })).toMatchObject({ returnValue: false, errorCode: E.OFFLINE, offline: true });
            } finally {
                fake.offline = false;
            }
            w.files.data["/media/internal/cut.bin"] = bytesOf(9 * 1024 * 1024, 17);
            fake.gd.onChunk = () => { fake.gd.onChunk = null; fake.offline = true; };
            try {
                expect(await w.methods.uploadFile({ accountId: id, from: "/media/internal/cut.bin", to: "/cut.bin" })).toMatchObject({ returnValue: false, errorCode: E.OFFLINE });
            } finally {
                fake.offline = false;
            }
            expect(await root(w, id)).toEqual(["lake.png"]);
            expect((await w.methods.uploadFile({ accountId: id, from: "/media/internal/cut.bin", to: "/cut.bin" })).returnValue).toBe(true);
            expect(await root(w, id)).toEqual(["cut.bin", "lake.png"]);
        });

        it("a full Drive: an upload or a copy says the Drive is full; folders and reading still work", async () => {
            const w = await world();
            const { id } = await signedIn(w, "drive.file", "gd-full", [idOf("/Photos/lake.png")]);
            fake.gd.quotaFull = true;
            w.files.data["/media/internal/s.txt"] = bytesOf(10);
            w.files.data["/media/internal/b.bin"] = bytesOf(9 * 1024 * 1024);
            for (const [from, to] of [["/media/internal/s.txt", "/s.txt"], ["/media/internal/b.bin", "/b.bin"]]) {
                const r = await w.methods.uploadFile({ accountId: id, from, to });
                expect(r, to).toMatchObject({ returnValue: false, errorCode: E.QUOTA });
                expect(r.errorText).toMatch(/Google Drive is full/);
            }
            expect(await w.methods.copyFile({ accountId: id, from: "/lake.png", to: "/lake copy.png" })).toMatchObject({ returnValue: false, errorCode: E.QUOTA });
            expect((await w.methods.makeFolder({ accountId: id, path: "/Later" })).returnValue).toBe(true);
            expect(await root(w, id)).toEqual(["Later", "lake.png"]);
            expect((await w.methods.driveQuota({ accountId: id })).returnValue).toBe(true);
        });

        it("two Google accounts: each its own files; removing one leaves the other signed in", async () => {
            const w = await world();
            const a = await signedIn(w, "drive.file", "gd-a", [idOf("/Photos/lake.png")]);
            fake.gd.as = "second@gdrive.test";
            const b = await signedIn(w, "drive.file", "gd-b", [idOf("/Photos/hills.png")]);
            expect([a.r.username, b.r.username]).toEqual(["phoenix@gdrive.test", "second@gdrive.test"]);
            expect(await root(w, a.id)).toEqual(["lake.png"]);
            expect(await root(w, b.id)).toEqual(["hills.png"]);
            expect((await w.methods.onDelete({ accountId: a.id })).returnValue).toBe(true);
            delete w.accounts[a.id];
            expect(w.keys["key:" + a.r.credentials.common.oauthKey]).toBeUndefined();
            expect(await root(w, b.id)).toEqual(["hills.png"]);
        });

        it("removing the account: its key, the device's copies of its files and Google's grant go; not a grant Phoenix's Google account uses too", async () => {
            const w = await world();
            const { r, id } = await signedIn(w, "drive.file", "gd-remove", [idOf("/Photos/lake.png")]);
            const router = deviceRouter(w);
            const o = await router.open({ path: "/media/drives/" + id + "/lake.png" });
            expect(o.returnValue, JSON.stringify(o)).toBe(true);
            expect(w.files.data[o.path]).toBeDefined();
            // The same Google account in Accounts as Google (Contacts, Calendar), signed in with the same Google project.
            w.accounts["g-contacts"] = { _id: "g-contacts", templateId: "com.webosphoenix.google", username: "phoenix@gdrive.test", capabilityProviders: [] };
            const revoked = fake.revoked || 0;
            expect((await w.methods.onDelete({ accountId: id })).returnValue).toBe(true);
            expect(w.keys["key:" + r.credentials.common.oauthKey]).toBeUndefined();
            const CACHE = "/media/internal/.phoenix/drive-cache/";
            expect(Object.keys(w.files.data).filter((k) => k.indexOf(CACHE + id + "/") === 0)).toEqual([]);
            const index = JSON.parse(Buffer.from(w.files.data[CACHE + "index.json"] || new Uint8Array(0)).toString() || "{}");
            expect(Object.keys(index).filter((k) => k.indexOf(CACHE + id + "/") === 0)).toEqual([]);
            // Not revoked: Google would end the Google account's grant too.
            expect(fake.revoked || 0).toBe(revoked);
            delete w.accounts[id];
            // Without another account of that Google account: revoked at Google.
            delete w.accounts["g-contacts"];
            const two = await signedIn(w, "drive.file", "gd-remove-2");
            expect((await w.methods.onDelete({ accountId: two.id })).returnValue).toBe(true);
            expect(fake.revoked || 0).toBeGreaterThan(revoked);
        });

        it("a file shared with the person: picked, at the top and read only; with all your Drive, under Shared with me", async () => {
            const t = gt();
            const bobs = t.add("elsewhere", "Bob's folder", "folder");
            bobs.foreign = true;
            const plan = t.add(bobs.id, "plan.txt", "file", Buffer.from("The plan\n"));
            Object.assign(plan, { sharedWithMe: true, viewOnly: true });
            const w = await world({ clients: allClients() });
            const { id } = await signedIn(w, "drive.file", "gd-shared", [plan.id]);
            const top = (await w.methods.listFiles({ accountId: id, path: "/" })).entries;
            expect(top).toEqual([expect.objectContaining({ name: "plan.txt", path: "/plan.txt", readOnly: true })]);
            expect((await w.methods.searchFiles({ accountId: id, query: "plan" })).entries.map((e: any) => e.path)).toEqual(["/plan.txt"]);
            expect((await w.methods.downloadFile({ accountId: id, path: "/plan.txt", to: "/media/internal/plan.txt" })).returnValue).toBe(true);
            expect(Buffer.from(w.files.data["/media/internal/plan.txt"]).toString()).toBe("The plan\n");
            // All your Drive: under Shared with me, as Drive's own pages have it.
            const all = await signedIn(w, "drive", "gd-shared-all");
            expect(await root(w, all.id)).toContain("Shared with me");
            const shared = (await w.methods.listFiles({ accountId: all.id, path: "/Shared with me" })).entries;
            expect(shared).toEqual([expect.objectContaining({ name: "plan.txt", path: "/Shared with me/plan.txt", readOnly: true })]);
            expect((await w.methods.downloadFile({ accountId: all.id, path: "/Shared with me/plan.txt", to: "/media/internal/plan2.txt" })).returnValue).toBe(true);
            expect((await w.methods.searchFiles({ accountId: all.id, query: "plan" })).entries.map((e: any) => e.path)).toContain("/Shared with me/plan.txt");
            w.files.data["/media/internal/x.txt"] = bytesOf(5);
            expect(await w.methods.uploadFile({ accountId: all.id, from: "/media/internal/x.txt", to: "/Shared with me/x.txt" })).toMatchObject({ returnValue: false, errorCode: E.PERMISSION });
            expect(await w.methods.makeFolder({ accountId: all.id, path: "/Shared with me/X" })).toMatchObject({ returnValue: false, errorCode: E.PERMISSION });
        });

        it("Google's own documents: Docs export as .docx; a Form opens in the browser, never as an empty file; a shortcut is what it points to", async () => {
            const t = gt();
            const g = t.mkdirp("/Google");
            const add = (name: string, mime: string, extra?: any) => Object.assign(t.add(g.id, name, "file", Buffer.alloc(0)), { mime }, extra || {});
            add("Report", "application/vnd.google-apps.document");
            add("Big report", "application/vnd.google-apps.document", { exportTooLarge: true });
            const form = add("Survey", "application/vnd.google-apps.form");
            add("Lake picture", "application/vnd.google-apps.shortcut", { shortcutTo: idOf("/Photos/lake.png") });
            add("Photos link", "application/vnd.google-apps.shortcut", { shortcutTo: idOf("/Photos") });
            const w = await world({ clients: allClients() });
            const { id } = await signedIn(w, "drive", "gd-docs");
            const list = (await w.methods.listFiles({ accountId: id, path: "/Google" })).entries;
            const by = (n: string) => list.find((e: any) => e.name === n);
            expect(by("Report.docx")).toMatchObject({ type: "file", readOnly: true, mimeType: DOCX });
            expect(by("Survey")).toMatchObject({ type: "file", readOnly: true, webUrl: expect.stringContaining(form.id) });
            expect(by("Lake picture")).toMatchObject({ type: "file", mimeType: "image/png" });
            expect(by("Photos link")).toMatchObject({ type: "directory" });
            const doc = await w.methods.downloadFile({ accountId: id, path: "/Google/Report.docx", to: "/media/internal/Report.docx" });
            expect(doc.returnValue, JSON.stringify(doc)).toBe(true);
            expect(Buffer.from(w.files.data["/media/internal/Report.docx"]).toString()).toBe("exported Report");
            const survey = await w.methods.downloadFile({ accountId: id, path: "/Google/Survey", to: "/media/internal/Survey" });
            expect(survey).toMatchObject({ returnValue: false, errorCode: E.UNSUPPORTED });
            expect(survey.errorText).toMatch(/browser/);
            expect(w.files.data["/media/internal/Survey"]).toBeUndefined();
            const bigDoc = await w.methods.downloadFile({ accountId: id, path: "/Google/Big report.docx", to: "/media/internal/Big.docx" });
            expect(bigDoc).toMatchObject({ returnValue: false, errorCode: E.TOO_LARGE });
            expect(bigDoc.errorText).toMatch(/browser/);
            const pic = await w.methods.downloadFile({ accountId: id, path: "/Google/Lake picture", to: "/media/internal/lake-cut.png" });
            expect(pic.returnValue, JSON.stringify(pic)).toBe(true);
            expect(same(w.files.data["/media/internal/lake-cut.png"], fake.picture)).toBe(true);
            expect(await root(w, id, "/Google/Photos link")).toEqual(["hills.png", "lake.png"]);
            // A Google document is not overwritten with a file's bytes.
            w.files.data["/media/internal/r.docx"] = bytesOf(50);
            expect(await w.methods.uploadFile({ accountId: id, from: "/media/internal/r.docx", to: "/Google/Report.docx", overwrite: true }))
                .toMatchObject({ returnValue: false, errorCode: E.PERMISSION });
        });
    });

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

// The device's file manager over a world's memory, and the kit's router for /media/drives over it.
function deviceRouter(w: any) {
    // The device's file manager for its own files, over the same memory.
    const CACHE = "/media/internal/.phoenix/drive-cache";
    const dirs = new Set<string>(["/media", "/media/internal"]);
    const local: any = {
        list: async (p: any) => ({ returnValue: true, path: p.path, entries: Object.keys(w.files.data).filter((k) => k.replace(/\/[^/]*$/, "") === p.path)
            .map((k) => ({ name: k.replace(/^.*\//, ""), path: k, type: "file", size: w.files.data[k].length, mtime: 0, mode: 0o644 })) }),
        stat: async (p: any) => (w.files.data[p.path] ? { returnValue: true, entry: { name: p.path.replace(/^.*\//, ""), path: p.path, type: "file",
                                                                                      size: w.files.data[p.path].length, mtime: 0 } }
            : { returnValue: false, errorCode: 1, errorText: "No such file" }),
        // As the device's: one level, and only once; on a new device
        // /media/internal/.phoenix and the transfer folder are missing
        // (the drives service's downloads make the cache's other folders).
        mkdir: async (p: any) => {
            if (dirs.has(p.path)) return { returnValue: false, errorCode: E.EXISTS, errorText: "Already exists: " + p.path };
            const up = p.path.replace(/\/[^/]*$/, "");
            if (up.indexOf("/media/internal/") === 0 && !dirs.has(up))
                return { returnValue: false, errorCode: 1, errorText: "ENOENT: no such file or directory, mkdir '" + p.path + "'" };
            dirs.add(p.path);
            return { returnValue: true, path: p.path };
        },
        remove: async (p: any) => { delete w.files.data[p.path]; return { returnValue: true, path: p.path }; },
        read: async (p: any) => (w.files.data[p.path] ? { returnValue: true, path: p.path, encoding: p.encoding || "utf8", size: w.files.data[p.path].length,
            data: Buffer.from(w.files.data[p.path]).toString(p.encoding === "base64" ? "base64" : "utf8") } : { returnValue: false, errorCode: 1, errorText: "No such file" }),
        write: async (p: any) => {
            const parent = p.path.replace(/\/[^/]*$/, "");
            if (parent === CACHE + "/.transfer" && !dirs.has(parent)) return { returnValue: false, errorCode: 1, errorText: "ENOENT: no such file or directory, open '" + p.path + "'" };
            w.files.data[p.path] = new Uint8Array(Buffer.from(p.data, p.encoding === "base64" ? "base64" : "utf8")); return { returnValue: true, path: p.path, size: w.files.data[p.path].length }; }
    };
    return kit.createDriveRouter({ call: (uri: string, params: any) => w.bus.call(uri, params), local });
}

describe("drives as places of the file manager (drives.ts)", () => {
    async function routed() {
        const w = await world();
        const id = await w.addAccount("nextcloud", await w.methods.checkCredentials({ templateId: T.nextcloud, username: "phoenix", password: "app-password-1",
                                                                                     config: { server: fake.origin } }), "nc1");
        return { w, id, router: deviceRouter(w) };
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
