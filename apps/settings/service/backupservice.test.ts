// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device service (backupservice.js, lib/) with its device dependencies:
// Node's crypto, files in a temporary folder for the USB drive, and a real
// WebDAV server (WsgiDAV on 127.0.0.1: pip install wsgidav cheroot; those
// tests are skipped without it). The participants are fakes that speak the
// legacy preBackup / postRestore protocol.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createBackupService, KEEP } = require("./backupservice.js") as Any;
const archive = require("./lib/archive.js") as Any;
const nodeCrypto = require("./lib/node-crypto.js") as Any;
const request = require("./lib/node-http.js") as Any;
const wsgidav = require("./test/wsgidav.cjs") as Any;

const PASSPHRASE = "correct horse battery";

// A service whose USB drive lives under a test folder.
function makeUsbService() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-backup-test-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-backup-usb-"));
    const real = (p: string) => path.join(root, p);
    const state = { config: null as Any, restored: {} as Record<string, Any>, calls: [] as Any[], now: Date.UTC(2026, 9, 1, 6, 30, 0), failing: new Set<string>(), notes: "Buy milk" };
    const handlers: Record<string, (p: Any) => Any> = {
        "luna://com.example.notes/backup/preBackup": (p) => {
            if (state.failing.has("notes")) return { returnValue: false, errorText: "disk full" };
            fs.writeFileSync(path.join(p.tempDir, "notes.json"), JSON.stringify({ notes: state.notes }));
            return { returnValue: true, description: "Notes", version: "2", files: ["notes.json"] };
        },
        "luna://com.example.notes/backup/postRestore": (p) => {
            state.restored.notes = Object.fromEntries(p.files.map((f: string) => [f, fs.readFileSync(path.join(p.tempDir, f), "utf8")]));
            return { returnValue: true };
        },
        "luna://com.example.prefs/preBackup": (p) => {
            if (state.failing.has("prefs")) throw new Error("no such service");
            const file = path.join(p.tempDir, "prefs.db");
            fs.writeFileSync(file, "ringtone=Arcade");
            return { returnValue: true, description: "Preferences", version: "1.0", files: [file] };
        },
        "luna://com.example.prefs/postRestore": (p) => {
            state.restored.prefs = Object.fromEntries(p.files.map((f: string) => [f, fs.readFileSync(path.join(p.tempDir, f), "utf8")]));
            return { returnValue: true };
        },
        "luna://com.webos.service.systemservice/deviceInfo/query": () => ({ returnValue: true, modelName: "phoenix-sim", device_name: "Test Phone" })
    };
    const service = createBackupService({
        luna: {
            call: async (uri: string, params: Any) => {
                state.calls.push({ uri, params });
                const h = handlers[uri];
                if (!h) return { returnValue: true };
                return h(params);
            }
        },
        request,
        crypto: nodeCrypto,
        config: { load: () => (state.config ? JSON.parse(JSON.stringify(state.config)) : null), save: (o: Any) => { state.config = JSON.parse(JSON.stringify(o)); } },
        temp: {
            make: () => fs.mkdtempSync(path.join(base, "tmp-")),
            read: (f: string) => new Uint8Array(fs.readFileSync(f)),
            write: (f: string, d: Uint8Array) => fs.writeFileSync(f, Buffer.from(d)),
            remove: (d: string) => fs.rmSync(d, { recursive: true, force: true })
        },
        usb: {
            list: (dir: string) => (fs.existsSync(real(dir)) ? fs.readdirSync(real(dir)).map((name) => ({ name, size: fs.statSync(path.join(real(dir), name)).size })) : []),
            read: (f: string) => fs.readFileSync(real(f), "utf8"),
            write: (f: string, t: string) => fs.writeFileSync(real(f), t),
            remove: (f: string) => fs.rmSync(real(f), { force: true }),
            mkdir: (d: string) => fs.mkdirSync(real(d), { recursive: true })
        },
        participants: () => [
            { id: "com.example.prefs", preBackup: "preBackup", postRestore: "postRestore" },
            { id: "com.example.notes", preBackup: "backup/preBackup", postRestore: "backup/postRestore" }
        ],
        now: () => new Date(state.now)
    });
    const folder = real("/media/internal/backups");
    const files = () => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);
    const temps = () => fs.readdirSync(base);
    return { service, state, folder, files, temps };
}

describe("backups on the USB drive", () => {
    it("asks for a destination and a passphrase first", async () => {
        const { service, state } = makeUsbService();
        expect((await service.backupNow()).errorCode).toBe("NOT_CONFIGURED");
        await service.configure({ destination: { type: "usb" } });
        expect((await service.backupNow()).errorCode).toBe("NO_PASSPHRASE");
        expect((await service.configure({ passphrase: "short" })).errorCode).toBe("BAD_PARAMS");
        const st = await service.configure({ passphrase: PASSPHRASE });
        expect(st).toMatchObject({ configured: true, hasPassphrase: true, destination: { type: "usb", folder: "/media/internal/backups" } });
        // Only a derived key is kept, never the passphrase.
        expect(JSON.stringify(state.config)).not.toContain(PASSPHRASE);
    });

    it("backs every participant up into one encrypted file, and restores it", async () => {
        const { service, state, folder, files, temps } = makeUsbService();
        await service.configure({ destination: { type: "usb" }, passphrase: PASSPHRASE });
        const r = await service.backupNow();
        expect(r).toMatchObject({ returnValue: true, name: "phoenix-backup-20261001-063000.pbak", parts: ["com.example.notes", "com.example.prefs"] });
        expect(files()).toEqual(["phoenix-backup-20261001-063000.pbak"]);
        expect(temps()).toEqual([]);   // the temporary folder is gone
        // The participants were asked as legacy webOS asked them.
        const pre = state.calls.find((c) => c.uri === "luna://com.example.notes/backup/preBackup");
        expect(pre.params).toMatchObject({ tempDir: expect.any(String), dir: expect.any(String), maxTempBytes: expect.any(Number) });

        const text = fs.readFileSync(path.join(folder, r.name), "utf8");
        expect(text).not.toContain("Buy milk");
        expect(text).not.toContain("Arcade");
        const header = archive.headerOf(archive.parse(text));
        expect(header).toMatchObject({ format: "org.webosphoenix.backup", version: 1, device: { name: "Test Phone", model: "phoenix-sim" },
                                        kdf: { alg: "PBKDF2-SHA256", iterations: 600000 }, cipher: { alg: "AES-256-GCM" } });
        expect(header.parts.map((p: Any) => p.id)).toEqual(["com.example.notes", "com.example.prefs"]);
        expect((await service.inspect({ name: r.name })).header).toEqual(header);
        expect((await service.listBackups()).backups).toEqual([{ name: r.name, size: text.length, created: "2026-10-01T06:30:00.000Z" }]);
        expect((await service.getStatus({})).last).toMatchObject({ ok: true, name: r.name, size: text.length });

        expect((await service.restore({ name: r.name, passphrase: "wrong passphrase" })).errorCode).toBe("WRONG_PASSPHRASE");
        expect(state.restored).toEqual({});
        const done = await service.restore({ name: r.name, passphrase: PASSPHRASE });
        expect(done).toEqual({ returnValue: true, restored: ["com.example.notes", "com.example.prefs"], skipped: [] });
        expect(state.restored).toEqual({ notes: { "notes.json": "{\"notes\":\"Buy milk\"}" }, prefs: { "prefs.db": "ringtone=Arcade" } });
        expect(temps()).toEqual([]);
    });

    it("refuses a backup whose readable header was changed", async () => {
        const { service, folder } = makeUsbService();
        await service.configure({ destination: { type: "usb" }, passphrase: PASSPHRASE });
        const { name } = await service.backupNow();
        const file = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
        file.device.name = "Someone else's phone";
        fs.writeFileSync(path.join(folder, name), JSON.stringify(file));
        expect((await service.restore({ name, passphrase: PASSPHRASE })).errorCode).toBe("WRONG_PASSPHRASE");
        fs.writeFileSync(path.join(folder, name), "not a backup");
        expect((await service.restore({ name, passphrase: PASSPHRASE })).errorCode).toBe("NOT_A_BACKUP");
    });

    it("goes on without a participant that fails, and keeps the newest backups", async () => {
        const { service, state, files } = makeUsbService();
        await service.configure({ destination: { type: "usb" }, passphrase: PASSPHRASE });
        state.failing.add("prefs");
        expect((await service.backupNow()).parts).toEqual(["com.example.notes"]);
        state.failing.add("notes");
        expect(await service.backupNow()).toMatchObject({ returnValue: false, errorCode: "NOTHING_TO_BACK_UP" });
        expect((await service.getStatus({})).last).toMatchObject({ ok: false, errorCode: "NOTHING_TO_BACK_UP" });
        state.failing.clear();
        for (let i = 1; i <= KEEP + 1; i++) {
            state.now += 86400000;
            await service.backupNow();
        }
        expect(files()).toHaveLength(KEEP);
        expect(files()[0]).toBe("phoenix-backup-20261003-063000.pbak");
    });

    it("runs daily, and tells the system UI once when backups keep failing", async () => {
        const { service, state } = makeUsbService();
        await service.configure({ destination: { type: "usb" }, passphrase: PASSPHRASE, auto: true });
        const created = state.calls.find((c) => c.uri === "luna://com.palm.activitymanager/create");
        expect(created.params.activity).toMatchObject({ name: "org.webosphoenix.backup.daily", schedule: { interval: "24h" },
                                                        callback: { method: "luna://org.webosphoenix.service.backup/scheduled" } });
        expect((await service.scheduled({ $activity: { activityId: 7 } })).returnValue).toBe(true);
        expect(state.calls.some((c) => c.uri === "luna://com.palm.activitymanager/complete" && c.params.activityId === 7)).toBe(true);
        const told = () => state.calls.filter((c) => c.uri === "luna://com.palm.systemmanager/publishToSystemUI");
        state.failing.add("prefs").add("notes");
        state.now += 2 * 86400000;
        await service.scheduled({});
        expect(told()).toHaveLength(0);           // two days: not yet
        state.now += 4 * 86400000;
        await service.scheduled({});
        await service.scheduled({});
        expect(told()).toHaveLength(1);           // six days, once
        expect(told()[0].params).toEqual({ event: "subscribeToBackupStatus", message: { returnValue: true, notify: true, duration: 6 } });
        state.failing.clear();
        await service.scheduled({});
        await service.configure({ auto: false });
        expect(state.calls.some((c) => c.uri === "luna://com.palm.activitymanager/cancel")).toBe(true);
    });

    it("pushes its status to subscribers", async () => {
        const { service } = makeUsbService();
        const seen: string[] = [];
        const first = await service.getStatus({ subscribe: true }, (s: Any) => seen.push(s.state));
        expect(first.subscribed).toBe(true);
        await service.configure({ destination: { type: "usb" }, passphrase: PASSPHRASE });
        await service.backupNow();
        expect(seen).toEqual(["idle", "backingUp", "idle"]);
    });
});

describe.skipIf(!wsgidav.available())("backups on a WebDAV server", () => {
    let server: Any;
    beforeAll(async () => { server = await wsgidav.start(); });
    afterAll(async () => { await server?.stop(); });

    it("checks the server, then backs up, lists, restores and deletes there", async () => {
        const { service, state } = makeUsbService();
        const url = server.url + "/Phoenix Backups/";
        const bad = await service.configure({ destination: { type: "webdav", url, username: server.user, password: "nope" }, passphrase: PASSPHRASE });
        expect(bad.errorCode).toBe("UNAUTHORIZED");
        expect((await service.getStatus({})).configured).toBe(false);   // nothing saved
        expect((await service.configure({ destination: { type: "webdav", url: "ftp://x" } })).errorCode).toBe("BAD_URL");

        const ok = await service.configure({ destination: { type: "webdav", url, username: server.user, password: server.password }, passphrase: PASSPHRASE });
        expect(ok).toMatchObject({ configured: true, destination: { type: "webdav", url, username: server.user } });
        expect(JSON.stringify(ok)).not.toContain(server.password);       // the status never shows it
        expect(server.files("Phoenix Backups")).toEqual([]);              // the folder was made

        const r = await service.backupNow();
        expect(r.returnValue).toBe(true);
        expect(server.files("Phoenix Backups")).toEqual([r.name]);
        expect((await service.listBackups()).backups.map((b: Any) => b.name)).toEqual([r.name]);
        // A blank password keeps the stored one.
        await service.configure({ destination: { type: "webdav", url, username: server.user, password: "" } });
        state.restored = {};
        expect((await service.restore({ name: r.name, passphrase: PASSPHRASE })).restored).toHaveLength(2);
        expect(state.restored.notes).toEqual({ "notes.json": "{\"notes\":\"Buy milk\"}" });
        expect((await service.deleteBackup({ name: r.name })).returnValue).toBe(true);
        expect(server.files("Phoenix Backups")).toEqual([]);
    });
});
