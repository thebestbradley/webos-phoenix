// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The SFTP drive: Phoenix's SSH client (lib/ssh) and the drive (lib/sftp.js,
// connector.js) against the stand-in server of test/fake-sftp.cjs (the
// client's own transport in its server role, SFTP over files in memory):
// the kit's conformance suite for a drive; the key formats (Node's own
// PKCS #1 / #8 / SEC 1 exports, OpenSSH's from ssh-keygen when it is
// installed); every key exchange, cipher and MAC; keys exchanged again
// mid-transfer; the sign-in methods; the host key trusted on first use and
// a changed one refused loudly; then the drive through the kit's DOCUMENTS
// methods: sign-in with a key made on the device, folders, chunked upload,
// ranged download, moves, copies (on the server and through the device),
// quota, a cancelled upload leaving nothing, and the account's removal
// taking its key. tools/test-sftp.cjs does the same against OpenSSH.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as kit from "@phoenix/connector-kit";
import { conformanceChecks } from "../../../shared/connector-kit/src/conformance";
import { loadCommonJs } from "../../../shared/connector-kit/src/test-support";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

const require = createRequire(__filename);
const { createFakeSftp, pipe } = require("./test/fake-sftp.cjs");
const oauthLib = require("../../../../services/oauth/oauthservice.js");
const drives = loadCommonJs(join(__dirname, "connector.js"));
const ssh = {
    keys: require("./lib/ssh/keys.js"), client: require("./lib/ssh/client.js"), sftp: require("./lib/ssh/sftp.js"),
    transport: require("./lib/ssh/transport.js"), wire: require("./lib/ssh/wire.js")
};
const SERVICE = "org.webosphoenix.service.drives";
const TEMPLATE = "com.webosphoenix.drive.sftp";
const template = JSON.parse(readFileSync(join(__dirname, "..", "public", "accounts", TEMPLATE, TEMPLATE + ".json"), "utf8"));
const E = kit.FILE_ERRORS;
vi.setConfig({ testTimeout: 60000 });

function which(cmd: string) { try { return execFileSync("sh", ["-c", "command -v " + cmd]).toString().trim(); } catch (e) { return ""; } }
const bytesOf = (n: number, seed = 7) => new Uint8Array(n).map((_x, i) => (i * seed + (i >> 11)) & 255);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// A client straight over the fake's pipe.
async function connectTo(server: any, o: any) {
    return ssh.client.start(adapt(server.socket()), Object.assign({ username: "ada", verifyHostKey: async () => true }, o));
}
function adapt(sock: any) {
    return { write: (b: Uint8Array) => sock.writeBytes(b), onData: (f: any) => sock.onBytes(f), onClose: (f: any) => sock.onClose(f), close: () => sock.close() };
}

// ---- Key formats ---------------------------------------------------------------------------------

describe("SSH keys", () => {
    it("reads Ed25519, RSA and ECDSA keys from PKCS #8, PKCS #1 and SEC 1, signs and verifies", () => {
        const ed = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
        const rsa1 = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }) as string;
        const rsa8 = generateKeyPairSync("rsa", { modulusLength: 3072 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
        const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "sec1", format: "pem" }) as string;
        const ec384 = generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
        const expect_ = [["ssh-ed25519", ed], ["ssh-rsa", rsa1], ["ssh-rsa", rsa8], ["ecdsa-sha2-nistp256", ec], ["ecdsa-sha2-nistp384", ec384]];
        for (const [type, pem] of expect_) {
            const key = ssh.keys.parsePrivateKey(pem);
            expect(key.type).toBe(type);
            const blob = ssh.keys.publicBlob(key);
            const data = new TextEncoder().encode("the exchange hash");
            for (const alg of ssh.keys.SIG_ALGS[type]) {
                const sig = ssh.keys.sign(key, data, alg);
                expect(ssh.keys.verify(blob, sig, data, alg)).toBe(true);
                expect(ssh.keys.verify(blob, sig, new TextEncoder().encode("another"), alg)).toBe(false);
            }
            // Kept in OpenSSH's format and read back the same.
            const again = ssh.keys.parsePrivateKey(ssh.keys.formatPrivateKey(key));
            expect(same(ssh.keys.publicBlob(again), blob)).toBe(true);
            const line = ssh.keys.publicKeyLine(key, "me@phoenix");
            expect(line.startsWith(type + " AAAA")).toBe(true);
            expect(same(ssh.keys.parsePublicKeyLine(line).blob, blob)).toBe(true);
            expect(ssh.keys.fingerprint(blob)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
        }
    });

    it("refuses keys with a passphrase, short RSA keys, public keys and PuTTY's, with what to do", () => {
        const enc = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "secret" }) as string;
        expect(() => ssh.keys.parsePrivateKey(enc)).toThrow(/passphrase/);
        try { ssh.keys.parsePrivateKey(enc); } catch (e: any) { expect(e.errorCode).toBe("KEY_ENCRYPTED"); }
        const short = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs1", format: "pem" }) as string;
        expect(() => ssh.keys.parsePrivateKey(short)).toThrow(/2048/);
        expect(() => ssh.keys.parsePrivateKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA== me")).toThrow(/public key/);
        expect(() => ssh.keys.parsePrivateKey("PuTTY-User-Key-File-3: ssh-ed25519\n")).toThrow(/PuTTYgen/);
        expect(() => ssh.keys.parsePrivateKey("hello")).toThrow(/Not a private key/);
    });

    it.skipIf(!which("ssh-keygen"))("reads what ssh-keygen writes, with ssh-keygen's fingerprints, and ssh-keygen reads Phoenix's", () => {
        const dir = mkdtempSync(join(tmpdir(), "phoenix-keys-"));
        try {
            for (const [t, bits] of [["ed25519", ""], ["rsa", "3072"], ["ecdsa", "256"]]) {
                const f = join(dir, "id_" + t);
                execFileSync("ssh-keygen", ["-q", "-t", t].concat(bits ? ["-b", bits] : []).concat(["-N", "", "-C", "test@phoenix", "-f", f]));
                const key = ssh.keys.parsePrivateKey(readFileSync(f, "utf8"));
                expect(key.comment).toBe("test@phoenix");
                const fp = execFileSync("ssh-keygen", ["-l", "-f", f + ".pub"]).toString().split(" ")[1];
                expect(ssh.keys.fingerprint(ssh.keys.publicBlob(key))).toBe(fp);
                expect(ssh.keys.publicKeyLine(key).split(" ")[1]).toBe(readFileSync(f + ".pub", "utf8").split(" ")[1]);
            }
            // A key made on the device, as ssh-keygen sees it.
            const made = ssh.keys.generateEd25519("phoenix-device");
            const f = join(dir, "made");
            require("node:fs").writeFileSync(f, ssh.keys.formatPrivateKey(made), { mode: 0o600 });
            const pub = execFileSync("ssh-keygen", ["-y", "-f", f]).toString().trim().split(" ");
            expect(pub.slice(0, 2).join(" ")).toBe(ssh.keys.publicKeyLine(made, "").trim());
            // A passphrase: refused, with the way out.
            execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "pass phrase", "-f", join(dir, "locked")]);
            expect(() => ssh.keys.parsePrivateKey(readFileSync(join(dir, "locked"), "utf8"))).toThrow(/ssh-keygen -p/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---- The transport and authentication ---------------------------------------------------------------

describe("SSH transport and sign-in", () => {
    const T = ssh.transport;
    it("every key exchange, cipher and MAC, with the server's signature checked", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } } });
        let n = 0;
        for (const kex of T.KEX_ORDER) for (const cipher of T.CIPHER_ORDER) for (const mac of cipher.startsWith("chacha") ? [T.MAC_ORDER[0]] : T.MAC_ORDER) {
            let seen: any;
            const c = await connectTo(server, { password: "pw", kexAlgorithms: [kex], ciphers: [cipher], macs: [mac],
                                                verifyHostKey: async (i: any) => { seen = i; return true; } });
            const s = await ssh.sftp.createSftp(await c.openSubsystem("sftp"));
            expect(await s.realpath(".")).toBe("/home/ada");
            expect(seen.fingerprint).toBe(server.hostKey.fingerprint);
            c.close();
            n++;
        }
        expect(n).toBe(T.KEX_ORDER.length * 9);
        await server.stop();
    });

    it("keys are exchanged again during a transfer, and nothing is lost", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } } });
        const c = await connectTo(server, { password: "pw", rekeyBytes: 256 * 1024 });
        const s = await ssh.sftp.createSftp(await c.openSubsystem("sftp"));
        const data = bytesOf(3 * 1024 * 1024 + 17);
        const h = await s.open("/home/ada/big.bin", 2 | 8 | 16);
        await s.writeAll(h, 0, data);
        await s.close(h);
        const h2 = await s.open("/home/ada/big.bin", 1);
        expect(same(await s.readRange(h2, 0, data.length), data)).toBe(true);
        expect(same(server.read("/home/ada/big.bin"), data)).toBe(true);
        c.close();
        await server.stop();
    });

    it("signs in with a password, keyboard-interactive, or Ed25519, RSA and ECDSA keys; refuses what it should", async () => {
        const ed = ssh.keys.generateEd25519("ed");
        const rsa = ssh.keys.parsePrivateKey(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }) as string);
        const ec = ssh.keys.parsePrivateKey(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "sec1", format: "pem" }) as string);
        const server = createFakeSftp({ users: { ada: { password: "pw", keys: [ed, rsa, ec].map((k) => ssh.keys.publicKeyLine(k)) } } });
        for (const key of [ed, rsa, ec]) (await connectTo(server, { key })).close();
        (await connectTo(server, { password: "pw" })).close();
        const stranger = ssh.keys.generateEd25519("x");
        await expect(connectTo(server, { key: stranger })).rejects.toMatchObject({ errorCode: "401_UNAUTHORIZED" });
        await expect(connectTo(server, { password: "nope" })).rejects.toMatchObject({ errorCode: "401_UNAUTHORIZED" });
        await expect(connectTo(server, { username: "bob", password: "pw" })).rejects.toMatchObject({ errorCode: "401_UNAUTHORIZED" });
        // A host key refused: nothing more is sent.
        await expect(connectTo(server, { password: "pw", verifyHostKey: async () => false })).rejects.toMatchObject({ errorCode: "HOST_KEY_REJECTED" });
        await server.stop();
    });

    it("a server that says it has too many connections is left alone for a while", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } } });
        server.throttle(600);
        const t0 = Date.now();
        await expect(connectTo(server, { password: "pw" })).rejects.toMatchObject({ errorCode: "503_SERVICE_UNAVAILABLE" });
        try { await connectTo(server, { password: "pw" }); } catch (e: any) { expect(e.retryAt).toBeGreaterThanOrEqual(t0 + 590 * 1000); }
        await server.stop();
    });

    it("a peer that does not speak SSH, or sends garbage after the keys, is a protocol error", async () => {
        const p = pipe();
        const c = ssh.client.start(adapt(p.client), { username: "x", password: "y", verifyHostKey: async () => true });
        p.server.write(new TextEncoder().encode("HTTP/1.1 400 Bad Request\r\n\r\n" + "x".repeat(600)));
        await expect(c).rejects.toMatchObject({ errorCode: "SSH_PROTOCOL" });
    });
});

// ---- The drive: the conformance suite ---------------------------------------------------------------

let current: any = null;
describe("conformance: an SFTP drive", () => {
    const fx = {
        template,
        get validateParams() {
            return { username: "ada", password: "app-pw", config: { server: "files.example", hostKey: current.hostKey } };
        },
        server: () => {
            current = createFakeSftp({ users: { ada: { password: "app-pw" } } });
            return current;
        },
        environment: (server: any) => ({ net: server.net() })
    };
    for (const check of conformanceChecks(drives, fx as any)) it(check.name, () => check.run());
});

// ---- The drive through the kit, with keys in the OAuth service's store --------------------------------

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

async function world(server: any) {
    const db = memdb.createMemDb(memdb.KIND_PARENTS);
    const tempdb = memdb.createMemDb();
    const keys: Record<string, any> = {};
    const accounts: Record<string, any> = {};
    const credentials: Record<string, any> = {};
    const toasts: any[] = [];
    const oauth = oauthLib.createOAuthService({
        request: async () => ({ status: 500, headers: {}, body: "" }),
        keystore: { get: async (k: string) => keys[k], put: async (k: string, v: any) => { keys[k] = v; }, del: async (k: string) => { delete keys[k]; } },
        crypto: { randomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)), sha256: async () => new Uint8Array(32) },
        redirectUri: "http://127.0.0.1:1/x", sheet: async () => null
    });
    let methods: any = {};
    const handlers: Record<string, any> = {
        "luna://org.webosphoenix.service.oauth/*": (p: any, uri: string) => (oauth as any)[uri.slice(uri.lastIndexOf("/") + 1)](p, SERVICE),
        "luna://com.webos.notification/createToast": (p: any) => { toasts.push(p); return { returnValue: true }; },
        "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
        ["luna://" + SERVICE + "/*"]: (p: any, uri: string) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    };
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers });
    const files = memoryFiles();
    methods = kit.createConnectorService(drives, { luna: bus, request: server.request, periodicSync: false, files, net: server.net() });
    let n = 0;
    async function create(params: any) {
        const v = await methods.checkCredentials(Object.assign({ templateId: TEMPLATE }, params));
        if (!v.returnValue) return v;
        const id = "sftp-" + (++n);
        accounts[id] = { _id: id, templateId: TEMPLATE, username: v.username,
                         capabilityProviders: [{ id: TEMPLATE + ".files", capability: "DOCUMENTS" }] };
        await bus.call("luna://com.palm.service.accounts/writeCredentials", { accountId: id, credentials: v.credentials });
        await methods.onCreate({ accountId: id, config: v.config });
        await methods.onEnabled({ accountId: id, capabilityProviderId: TEMPLATE + ".files", enabled: true });
        return Object.assign({ accountId: id }, v);
    }
    return { methods, keys, accounts, files, toasts, create, bus };
}

describe("SFTP drive", () => {
    it("signs in with a key made on the device, after the server's key is trusted; then a walk through the files", async () => {
        const server = createFakeSftp({ users: { ada: { keys: [] } }, files: { "/home/ada/Photos/beach.jpg": bytesOf(300000, 3), "/home/ada/notes.txt": "hello" } });
        const w = await world(server);
        // The sign-in page: a key, its public half to put on the server.
        const made = await w.methods.sftpMakeKey({ comment: "ada's phone" });
        expect(made.returnValue).toBe(true);
        expect(made.publicKey).toMatch(/^ssh-ed25519 AAAA\S+ adasphone$/);
        expect(made.description).toBe("ED25519");
        const stored = w.keys["client:" + SERVICE + ":sftp-key:" + made.keyId];
        expect(stored.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
        // Not on the server yet: the server does not take it.
        const host = await w.methods.sftpHostKey({ server: "files.example" });
        expect(host.returnValue).toBe(true);
        expect(host.hostKey.fingerprint).toBe(server.hostKey.fingerprint);
        expect(host.hostKey.description).toBe("ED25519");
        const refused = await w.create({ username: "ada", config: { server: "files.example", sshKey: made.keyId, hostKey: host.hostKey } });
        expect(refused).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        expect(refused.errorText).toMatch(/authorized_keys/);
        // Without trusting the server's key first: refused.
        server.authorize("ada", made.publicKey);
        const untrusted = await w.create({ username: "ada", config: { server: "files.example", sshKey: made.keyId } });
        expect(untrusted).toMatchObject({ returnValue: false, errorCode: "HOST_KEY_UNKNOWN" });
        const a = await w.create({ username: "ada", config: { server: "files.example", sshKey: made.keyId, hostKey: host.hostKey } });
        expect(a.returnValue).toBe(true);
        expect(a.username).toBe("ada@files.example");
        expect(a.config).toMatchObject({ provider: "sftp", host: "files.example", port: 22, root: "/home/ada", auth: "key", sshKey: made.keyId });
        expect(a.credentials.common.password).toBeUndefined();
        expect(JSON.stringify(a.credentials)).not.toMatch(/PRIVATE KEY/);
        const id = a.accountId;
        const M = w.methods;

        const top = await M.listFiles({ accountId: id, path: "/" });
        expect(top.returnValue).toBe(true);
        expect(top.entries.map((e: any) => e.name + ":" + e.type).sort()).toEqual(["Photos:directory", "notes.txt:file"]);
        const photos = await M.listFiles({ accountId: id, path: "/Photos" });
        expect(photos.entries[0]).toMatchObject({ name: "beach.jpg", path: "/Photos/beach.jpg", type: "file", size: 300000, mimeType: "image/jpeg" });
        expect((await M.listFiles({ accountId: id, path: "/notes.txt" })).errorCode).toBe(E.NOT_DIR);
        expect((await M.statFile({ accountId: id, path: "/nothing" })).errorCode).toBe(E.NOT_FOUND);

        // A download in ranges of 64 KB.
        const down = await M.downloadFile({ accountId: id, path: "/Photos/beach.jpg", to: "/tmp/beach.jpg" });
        expect(down.returnValue).toBe(true);
        expect(same(w.files.data["/tmp/beach.jpg"], server.read("/home/ada/Photos/beach.jpg"))).toBe(true);

        // A 20 MB upload in 8 MB chunks, written beside the file, then renamed in.
        const big = bytesOf(20 * 1024 * 1024 + 5, 13);
        w.files.data["/media/internal/big.bin"] = big;
        const up = await M.uploadFile({ accountId: id, from: "/media/internal/big.bin", to: "/Photos/big.bin" });
        expect(up.returnValue).toBe(true);
        expect(up.entry.size).toBe(big.length);
        expect(same(server.read("/home/ada/Photos/big.bin"), big)).toBe(true);
        expect(Object.keys(server.files.nodes).filter((p: string) => /phoenix-part/.test(p))).toEqual([]);
        expect((await M.uploadFile({ accountId: id, from: "/media/internal/big.bin", to: "/Photos/big.bin", overwrite: false })).errorCode).toBe(E.EXISTS);

        // Folders, moves, copies (on the server with copy-data), quota.
        expect((await M.makeFolder({ accountId: id, path: "/Trip" })).returnValue).toBe(true);
        expect((await M.makeFolder({ accountId: id, path: "/Trip" })).errorCode).toBe(E.EXISTS);
        expect((await M.makeFolder({ accountId: id, path: "/No/Such" })).errorCode).toBe(E.NOT_FOUND);
        expect((await M.moveFile({ accountId: id, from: "/Photos/beach.jpg", to: "/Trip/beach.jpg" })).returnValue).toBe(true);
        expect((await M.copyFile({ accountId: id, from: "/Trip", to: "/Trip copy" })).returnValue).toBe(true);
        expect(same(server.read("/home/ada/Trip copy/beach.jpg"), bytesOf(300000, 3))).toBe(true);
        expect((await M.copyFile({ accountId: id, from: "/notes.txt", to: "/Trip/beach.jpg" })).errorCode).toBe(E.EXISTS);
        expect((await M.moveFile({ accountId: id, from: "/notes.txt", to: "/Trip/beach.jpg" })).errorCode).toBe(E.EXISTS);
        expect((await M.moveFile({ accountId: id, from: "/notes.txt", to: "/Trip/beach.jpg", overwrite: true })).returnValue).toBe(true);
        expect(new TextDecoder().decode(server.read("/home/ada/Trip/beach.jpg"))).toBe("hello");
        const q = await M.driveQuota({ accountId: id });
        expect(q.returnValue).toBe(true);
        expect(q.total).toBeGreaterThan(q.used);
        expect(q.used).toBeGreaterThan(20 * 1024 * 1024);
        // A folder with what is in it.
        expect((await M.removeFile({ accountId: id, path: "/Trip copy" })).returnValue).toBe(true);
        expect(server.files.get("/home/ada/Trip copy")).toBe(null);

        // The account removed: its key goes from the store.
        expect((await M.sftpPublicKey({ accountId: id })).publicKey).toBe(made.publicKey);
        expect((await M.onDelete({ accountId: id })).returnValue).toBe(true);
        expect(w.keys["client:" + SERVICE + ":sftp-key:" + made.keyId]).toBeUndefined();
        await server.stop();
    });

    it("a copy without copy-data goes through the device; a cancelled upload leaves nothing", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } }, files: { "/home/ada/a.bin": bytesOf(5 * 1024 * 1024 + 9) },
                                        extensions: { "posix-rename@openssh.com": "1" } });
        const w = await world(server);
        const host = await w.methods.sftpHostKey({ server: "files.example" });
        const a = await w.create({ username: "ada", password: "pw", config: { server: "sftp://files.example/", hostKey: host.hostKey } });
        expect(a.returnValue).toBe(true);
        expect(a.credentials.common.password).toBe("pw");
        const M = w.methods, id = a.accountId;
        expect((await M.copyFile({ accountId: id, from: "/a.bin", to: "/b.bin" })).returnValue).toBe(true);
        expect(same(server.read("/home/ada/b.bin"), bytesOf(5 * 1024 * 1024 + 9))).toBe(true);
        expect((await M.driveQuota({ accountId: id })).errorCode).toBe(E.UNSUPPORTED);
        // Cancelled between two chunks.
        w.files.data["/media/internal/c.bin"] = bytesOf(30 * 1024 * 1024);
        const up = M.uploadFile({ accountId: id, from: "/media/internal/c.bin", to: "/c.bin", transferId: "t-c" });
        // Once it is under way (its first megabytes written).
        for (let i = 0; i < 400; i++) {
            const t = (await M.transfers({})).transfers.filter((x: any) => x.id === "t-c")[0];
            if (t && t.done > 0) break;
            await new Promise((r) => setTimeout(r, 10));
        }
        expect((await M.cancelTransfer({ transferId: "t-c" })).returnValue).toBe(true);
        expect((await up).errorCode).toBe(E.CANCELED);
        expect(Object.keys(server.files.nodes).filter((p: string) => /\/\.?c\.bin/.test(p))).toEqual([]);
        await server.stop();
    });

    it("a changed host key is refused loudly; signing in again shows both keys", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } } });
        const w = await world(server);
        const host = await w.methods.sftpHostKey({ server: "files.example" });
        const a = await w.create({ username: "ada", password: "pw", config: { server: "files.example", hostKey: host.hostKey } });
        expect((await w.methods.listFiles({ accountId: a.accountId, path: "/" })).returnValue).toBe(true);
        // The server is replaced (or someone is in between): a different key.
        const other = createFakeSftp({ users: { ada: { password: "pw" } } });
        server.dropConnections();
        const w2net = other.net();
        (w as any).methods = null;
        const methods = kit.createConnectorService(drives, { luna: w.bus, request: other.request, periodicSync: false, files: w.files, net: w2net });
        const l = await methods.listFiles({ accountId: a.accountId, path: "/" });
        expect(l).toMatchObject({ returnValue: false, errorCode: E.AUTH, reason: "HOST_KEY_CHANGED" });
        expect(l.errorText).toMatch(/WARNING: the key of files.example has changed/);
        expect(l.errorText).toContain(host.hostKey.fingerprint);
        expect(l.errorText).toContain(other.hostKey.fingerprint);
        expect(w.toasts.filter((t) => /Server key changed/.test(t.title || (t.message || "")))).toHaveLength(1);
        // Again: refused again, the notification not repeated.
        expect((await methods.listFiles({ accountId: a.accountId, path: "/" })).reason).toBe("HOST_KEY_CHANGED");
        expect(w.toasts.filter((t) => /Server key changed/.test(t.title || (t.message || "")))).toHaveLength(1);
        // The sign-in page asks with the account: the change is said.
        const again = await methods.sftpHostKey({ server: "files.example", accountId: a.accountId });
        expect(again).toMatchObject({ returnValue: true, changed: true, known: false, previous: { fingerprint: host.hostKey.fingerprint } });
        expect(again.hostKey.fingerprint).toBe(other.hostKey.fingerprint);
        await server.stop();
        await other.stop();
    });

    it("imports keys in OpenSSH's and PEM formats; refuses one with a passphrase; forgets a key no account took", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } } });
        const w = await world(server);
        const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }) as string;
        const imported = await w.methods.sftpImportKey({ privateKey: pem });
        expect(imported).toMatchObject({ returnValue: true, description: "RSA 2048" });
        expect(imported.publicKey).toMatch(/^ssh-rsa AAAA/);
        const enc = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "x" }) as string;
        expect(await w.methods.sftpImportKey({ privateKey: enc })).toMatchObject({ returnValue: false, errorCode: "KEY_ENCRYPTED" });
        expect((await w.methods.sftpForgetKey({ keyId: imported.keyId })).returnValue).toBe(true);
        expect(w.keys["client:" + SERVICE + ":sftp-key:" + imported.keyId]).toBeUndefined();
        await server.stop();
    });

    it("reads addresses as people type them", () => {
        const cases: [string, any][] = [["nas.local", { host: "nas.local", port: 22 }], ["nas.local:2222", { host: "nas.local", port: 2222 }],
                                       ["sftp://me@NAS.local:2200/srv/files", { host: "nas.local", port: 2200, user: "me", path: "/srv/files" }],
                                       ["[fd00::2]:22", { host: "fd00::2", port: 22 }]];
        for (const [raw, want] of cases) expect(drives._sftpAddress(raw)).toEqual(want);
        expect(() => drives._sftpAddress("nas.local:70000")).toThrow(/port/);
        expect(() => drives._sftpAddress("")).toThrow(/needed/);
    });
});

describe("the device's sockets carry bytes (kit device.ts nodeNet)", () => {
    it.skipIf(!existsSync(join(__dirname, "test", "fake-sftp.cjs")))("a binary connection over Node's net to a real TCP server", async () => {
        const server = createFakeSftp({ users: { ada: { password: "pw" } }, host: "127.0.0.1" });
        const port = await server.listen(0);
        const { nodeNet } = await import("../../../shared/connector-kit/src/device");
        const net = kit.createNet({ env: nodeNet(), hosts: ["127.0.0.1"], now: () => Date.now() });
        expect(net.supports).toMatchObject({ tcp: true, binary: true });
        const c = await ssh.client.connect({ net, host: "127.0.0.1", port, username: "ada", password: "pw", verifyHostKey: async () => true });
        const s = await ssh.sftp.createSftp(await c.openSubsystem("sftp"));
        expect(await s.realpath(".")).toBe("/home/ada");
        c.close();
        await server.stop();
    });
});
